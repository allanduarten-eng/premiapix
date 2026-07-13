import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type MercadoPagoWebhookBody = {
  data?: {
    id?: string | number;
  };
  id?: string | number;
  type?: string;
  topic?: string;
};

const okResponse = () => new Response("OK", { status: 200 });

function parseJsonBody(rawBody: string) {
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as MercadoPagoWebhookBody;
  } catch {
    return null;
  }
}

function paymentIdFromUrl(url: URL) {
  const queryId = url.searchParams.get("data.id") || url.searchParams.get("id");
  const type = url.searchParams.get("type") || url.searchParams.get("topic");

  if (queryId && (!type || type === "payment")) {
    return queryId;
  }

  return null;
}

function paymentIdFromBody(body: MercadoPagoWebhookBody | null) {
  const bodyId = body?.data?.id || body?.id;
  const bodyType = body?.type || body?.topic;

  if (bodyId && (!bodyType || bodyType === "payment")) {
    return String(bodyId);
  }

  return null;
}

function signatureParts(signature: string) {
  return signature.split(",").reduce<Record<string, string>>((parts, item) => {
    const [key, value] = item.split("=");

    if (key && value) {
      parts[key.trim()] = value.trim();
    }

    return parts;
  }, {});
}

function hasWebhookSecret() {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  return Boolean(secret && !secret.includes("cole_"));
}

function isValidWebhookSignature(request: Request, dataId: string | null) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;

  if (!secret || secret.includes("cole_")) {
    return true;
  }

  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  if (!xSignature) {
    return false;
  }

  const parts = signatureParts(xSignature);
  const timestamp = parts.ts;
  const receivedHash = parts.v1;

  if (!timestamp || !receivedHash) {
    return false;
  }

  let manifest = "";

  if (dataId) {
    manifest += `id:${dataId.toLowerCase()};`;
  }

  if (xRequestId) {
    manifest += `request-id:${xRequestId};`;
  }

  manifest += `ts:${timestamp};`;

  const calculatedHash = createHmac("sha256", secret).update(manifest).digest("hex");
  const received = Buffer.from(receivedHash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");

  return received.length === calculated.length && timingSafeEqual(received, calculated);
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const queryPaymentId = paymentIdFromUrl(url);
    const signatureDataId = url.searchParams.get("data.id");
    const rawBody = await request.text();
    const body = parseJsonBody(rawBody);
    const paymentId = queryPaymentId || paymentIdFromBody(body);

    if (hasWebhookSecret() && !isValidWebhookSignature(request, signatureDataId)) {
      return new Response("Invalid signature", { status: 401 });
    }

    if (!paymentId) {
      return okResponse();
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Mercado Pago token ausente." }, { status: 500 });
    }

    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`
        }
      }
    );

    if (!paymentResponse.ok) {
      return okResponse();
    }

    const paymentData = await paymentResponse.json();
    const orderId = paymentData.external_reference;

    if (paymentData.status !== "approved" || !orderId) {
      return okResponse();
    }

    const admin = createSupabaseAdmin();

    await admin
      .from("orders")
      .update({
        status: "paid",
        mp_payment_id: String(paymentData.id)
      })
      .eq("id", orderId);

    await admin
      .from("raffle_numbers")
      .update({
        status: "paid",
        reserved_until: null,
        paid_at: new Date().toISOString()
      })
      .eq("order_id", orderId);

    return okResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return okResponse();
}

export async function HEAD() {
  return okResponse();
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS, POST"
    }
  });
}
