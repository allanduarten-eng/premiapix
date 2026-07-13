import { NextResponse } from "next/server";
import { brand } from "@/lib/brand";
import {
  createSupabaseAdmin,
  createSupabaseForToken,
  getBearerToken
} from "@/lib/supabaseServer";

type CheckoutBody = {
  rifaId?: string;
  numerosSelecionados?: number[];
  email?: string;
  nomeComprador?: string;
  whatsapp?: string;
  contato?: string;
};

function normalizeWhatsapp(value?: string) {
  return value?.replace(/\D/g, "") ?? "";
}

function normalizeOrderId(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return null;
}

function moneyString(value: number | string) {
  return Number(value).toFixed(2);
}

export async function POST(request: Request) {
  let reservedOrderId: string | null = null;

  try {
    const token = getBearerToken(request);

    if (
      !process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      process.env.MERCADO_PAGO_ACCESS_TOKEN.includes("cole_")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Configure MERCADO_PAGO_ACCESS_TOKEN no .env.local."
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as CheckoutBody;
    const buyerName = body.nomeComprador?.trim();
    const buyerWhatsapp = normalizeWhatsapp(body.whatsapp);
    const buyerContact = body.contato?.trim() || null;

    if (!body.rifaId || !Array.isArray(body.numerosSelecionados)) {
      return NextResponse.json(
        { success: false, error: "Dados da campanha invalidos." },
        { status: 400 }
      );
    }

    if (!buyerName || buyerName.length < 2) {
      return NextResponse.json(
        { success: false, error: "Informe o nome do comprador." },
        { status: 400 }
      );
    }

    if (buyerWhatsapp.length < 10 || buyerWhatsapp.length > 13) {
      return NextResponse.json(
        { success: false, error: "Informe um WhatsApp valido com DDD." },
        { status: 400 }
      );
    }

    const numerosSelecionados = body.numerosSelecionados.map(Number);

    if (
      numerosSelecionados.length === 0 ||
      numerosSelecionados.some((number) => !Number.isInteger(number) || number <= 0)
    ) {
      return NextResponse.json(
        { success: false, error: "Escolha numeros validos." },
        { status: 400 }
      );
    }

    let userEmail: string | undefined;

    if (token) {
      const userClient = createSupabaseForToken(token);
      const {
        data: { user }
      } = await userClient.auth.getUser();

      userEmail = user?.email ?? undefined;
    }

    const payerEmail =
      body.email ||
      userEmail ||
      process.env.MERCADO_PAGO_DEFAULT_PAYER_EMAIL ||
      brand.defaultPayerEmail;

    const admin = createSupabaseAdmin();
    const { data: rawOrderId, error: reserveError } = await admin.rpc(
      "create_guest_pending_order",
      {
        p_raffle_id: body.rifaId,
        p_numbers: numerosSelecionados,
        p_buyer_email: payerEmail,
        p_buyer_name: buyerName,
        p_buyer_whatsapp: buyerWhatsapp,
        p_buyer_contact: buyerContact
      }
    );
    const orderId = normalizeOrderId(rawOrderId);
    reservedOrderId = orderId;

    if (reserveError || !orderId) {
      return NextResponse.json(
        {
          success: false,
          error:
            reserveError?.message === "numbers_unavailable"
              ? "Algum numero acabou de ficar indisponivel."
              : reserveError?.message ?? "Nao foi possivel reservar os numeros."
        },
        { status: 409 }
      );
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id,total,raffle_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", orderId);
      await admin
        .from("raffle_numbers")
        .update({
          status: "available",
          user_id: null,
          order_id: null,
          reserved_until: null
        })
        .eq("order_id", orderId);

      return NextResponse.json(
        { success: false, error: "Pedido criado, mas nao foi encontrado." },
        { status: 500 }
      );
    }

    const { data: raffle } = await admin
      .from("raffles")
      .select("title")
      .eq("id", order.raffle_id)
      .maybeSingle();

    const totalAmount = moneyString(order.total);
    const paymentResponse = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": String(order.id)
      },
      body: JSON.stringify({
        type: "online",
        external_reference: String(order.id),
        total_amount: totalAmount,
        payer: {
          email: payerEmail,
          first_name: buyerName.split(" ")[0]
        },
        transactions: {
          payments: [
            {
              amount: totalAmount,
              description: `Cotas da campanha ${raffle?.title ?? order.raffle_id}`,
              payment_method: {
                id: "pix",
                type: "bank_transfer"
              }
            }
          ]
        }
      })
    });

    const paymentData = await paymentResponse.json();

    if (!paymentResponse.ok) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      await admin
        .from("raffle_numbers")
        .update({
          status: "available",
          user_id: null,
          order_id: null,
          reserved_until: null
        })
        .eq("order_id", order.id);

      return NextResponse.json(
        {
          success: false,
          error:
            paymentData.message ||
            paymentData.errors?.[0]?.message ||
            "Erro ao criar pagamento no Mercado Pago."
        },
        { status: 502 }
      );
    }

    const payment = paymentData.transactions?.payments?.[0];
    const paymentMethod = payment?.payment_method;
    const isPaid =
      paymentData.status === "processed" ||
      (payment?.status === "processed" && payment?.status_detail === "accredited");

    await admin
      .from("orders")
      .update({
        status: isPaid ? "paid" : "pending",
        mp_order_id: String(paymentData.id),
        mp_payment_id: payment?.id ? String(payment.id) : null,
        pix_qr_code: paymentMethod?.qr_code ?? null,
        pix_qr_code_base64: paymentMethod?.qr_code_base64 ?? null
      })
      .eq("id", order.id);

    if (isPaid) {
      await admin
        .from("raffle_numbers")
        .update({
          status: "paid",
          reserved_until: null,
          paid_at: new Date().toISOString()
        })
        .eq("order_id", order.id);
    }

    reservedOrderId = null;

    return NextResponse.json({
      success: true,
      orderId: order.id,
      copiaECola: paymentMethod?.qr_code,
      qrCodeBase64: paymentMethod?.qr_code_base64
    });
  } catch (error) {
    if (reservedOrderId) {
      const admin = createSupabaseAdmin();
      await admin.from("orders").update({ status: "cancelled" }).eq("id", reservedOrderId);
      await admin
        .from("raffle_numbers")
        .update({
          status: "available",
          user_id: null,
          order_id: null,
          reserved_until: null
        })
        .eq("order_id", reservedOrderId);
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro interno."
      },
      { status: 500 }
    );
  }
}
