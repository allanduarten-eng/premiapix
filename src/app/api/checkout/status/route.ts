import { NextResponse } from "next/server";
import {
  expirePendingReservations,
  syncLocalOrderWithMercadoPago
} from "@/lib/mercadoPagoOrders";
import { createSupabaseAdmin } from "@/lib/supabaseServer";

type StatusBody = {
  orderId?: string;
};

type LocalOrder = {
  id: string;
  status: string;
  raffle_id: string;
  mp_order_id: string | null;
  mp_payment_id: string | null;
};

export async function POST(request: Request) {
  try {
    const { orderId } = (await request.json()) as StatusBody;

    if (!orderId) {
      return NextResponse.json({ error: "Informe o pedido." }, { status: 400 });
    }

    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("orders")
      .select("id,status,raffle_id,mp_order_id,mp_payment_id")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Pedido nao encontrado." },
        { status: 404 }
      );
    }

    const order = data as LocalOrder;
    await syncLocalOrderWithMercadoPago(admin, order);
    await expirePendingReservations(admin, order.raffle_id);

    const { data: refreshed, error: refreshError } = await admin
      .from("orders")
      .select("id,status,raffle_id,mp_order_id,mp_payment_id")
      .eq("id", orderId)
      .maybeSingle();

    if (refreshError || !refreshed) {
      return NextResponse.json(
        { error: refreshError?.message ?? "Pedido nao encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      orderId: refreshed.id,
      status: refreshed.status,
      paid: refreshed.status === "paid",
      expired: refreshed.status === "expired" || refreshed.status === "cancelled"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}
