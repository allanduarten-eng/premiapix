import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type MercadoPagoWebhookBody = {
  action?: string;
  data?: {
    id?: string | number;
  };
  id?: string | number;
  type?: string;
  topic?: string;
};

type MercadoPagoOrderResponse = {
  external_reference?: string;
  id?: string;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: Array<{
      id?: string;
      status?: string;
      status_detail?: string;
    }>;
  };
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

function eventIdFromUrl(url: URL) {
  return url.searchParams.get("data.id") || url.searchParams.get("id");
}

function eventIdFromBody(body: MercadoPagoWebhookBody | null) {
  const bodyId = body?.data?.id || body?.id;
  return bodyId ? String(bodyId) : null;
}

function eventTypeFromUrl(url: URL) {
  return url.searchParams.get("type") || url.searchParams.get("topic");
}

function eventTypeFromBody(body: MercadoPagoWebhookBody | null) {
  return body?.type || body?.topic || body?.action || null;
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

function isOrderEvent(id: string, type: string | null) {
  return id.startsWith("ORD") || type?.toLowerCase().includes("order");
}

function isProcessedOrder(orderData: MercadoPagoOrderResponse) {
  const payment = orderData.transactions?.payments?.[0];

  return (
    (orderData.status === "processed" && orderData.status_detail === "accredited") ||
    (payment?.status === "processed" && payment?.status_detail === "accredited")
  );
}

async function markOrderPaid(localOrderId: string, mpOrderId: string | null, mpPaymentId: string | null) {
  const admin = createSupabaseAdmin();

  await admin
    .from("orders")
    .update({
      status: "paid",
      mp_order_id: mpOrderId,
      mp_payment_id: mpPaymentId
    })
    .eq("id", localOrderId);

  await admin
    .from("raffle_numbers")
    .update({
      status: "paid",
      reserved_until: null,
      paid_at: new Date().toISOString()
    })
    .eq("order_id", localOrderId);
}

async function releaseOrder(localOrderId: string, status: "cancelled" | "expired") {
  const admin = createSupabaseAdmin();

  await admin.from("orders").update({ status }).eq("id", localOrderId);
  await admin
    .from("raffle_numbers")
    .update({
      status: "available",
      user_id: null,
      order_id: null,
      reserved_until: null
    })
    .eq("order_id", localOrderId);
}

async function handleOrderNotification(orderId: string) {
  const orderResponse = await fetch(`https://api.mercadopago.com/v1/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`
    }
  });

  if (!orderResponse.ok) {
    return;
  }

  const orderData = (await orderResponse.json()) as MercadoPagoOrderResponse;
  const localOrderId = orderData.external_reference;
  const payment = orderData.transactions?.payments?.[0];

  if (!localOrderId) {
    return;
  }

  if (isProcessedOrder(orderData)) {
    await markOrderPaid(localOrderId, String(orderData.id), payment?.id ? String(payment.id) : null);
    return;
  }

  if (orderData.status === "expired") {
    await releaseOrder(localOrderId, "expired");
    return;
  }

  if (orderData.status === "canceled" || orderData.status === "failed") {
    await releaseOrder(localOrderId, "cancelled");
  }
}

async function handlePaymentNotification(paymentId: string) {
  const paymentResponse = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`
      }
    }
  );

  if (!paymentResponse.ok) {
    return;
  }

  const paymentData = await paymentResponse.json();
  const orderId = paymentData.external_reference;

  if (paymentData.status === "approved" && orderId) {
    await markOrderPaid(orderId, null, String(paymentData.id));
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const urlEventId = eventIdFromUrl(url);
    const rawBody = await request.text();
    const body = parseJsonBody(rawBody);
    const eventId = urlEventId || eventIdFromBody(body);
    const eventType = eventTypeFromUrl(url) || eventTypeFromBody(body);
    const signatureDataId = url.searchParams.get("data.id") || eventIdFromBody(body);

    if (hasWebhookSecret() && !isValidWebhookSignature(request, signatureDataId)) {
      return new Response("Invalid signature", { status: 401 });
    }

    if (!eventId) {
      return okResponse();
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Mercado Pago token ausente." }, { status: 500 });
    }

    if (isOrderEvent(eventId, eventType)) {
      await handleOrderNotification(eventId);
      return okResponse();
    }

    await handlePaymentNotification(eventId);
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
