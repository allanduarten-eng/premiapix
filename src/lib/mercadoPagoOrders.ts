import type { SupabaseClient } from "@supabase/supabase-js";

type MercadoPagoPayment = {
  id?: string;
  status?: string;
  status_detail?: string;
};

export type MercadoPagoOrderResponse = {
  external_reference?: string;
  id?: string;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: MercadoPagoPayment[];
  };
};

type LocalOrder = {
  id: string;
  status: string;
  mp_order_id: string | null;
  mp_payment_id: string | null;
};

export function hasMercadoPagoToken() {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  return Boolean(token && !token.includes("cole_"));
}

export function isMercadoPagoOrderPaid(orderData: MercadoPagoOrderResponse) {
  const payment = orderData.transactions?.payments?.[0];

  return (
    (orderData.status === "processed" && orderData.status_detail === "accredited") ||
    (payment?.status === "processed" && payment?.status_detail === "accredited")
  );
}

export async function fetchMercadoPagoOrder(mpOrderId: string) {
  const response = await fetch(`https://api.mercadopago.com/v1/orders/${mpOrderId}`, {
    headers: {
      Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MercadoPagoOrderResponse;
}

export async function markLocalOrderPaid(
  admin: SupabaseClient,
  localOrderId: string,
  mpOrderId: string | null,
  mpPaymentId: string | null
) {
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

export async function releaseLocalOrder(
  admin: SupabaseClient,
  localOrderId: string,
  status: "cancelled" | "expired"
) {
  await admin.from("orders").update({ status }).eq("id", localOrderId);
  await admin
    .from("raffle_numbers")
    .update({
      status: "available",
      user_id: null,
      order_id: null,
      reserved_until: null
    })
    .eq("order_id", localOrderId)
    .eq("status", "reserved");
}

export async function expirePendingReservations(admin: SupabaseClient, raffleId?: string) {
  await admin.rpc("expire_pending_orders", {
    p_raffle_id: raffleId ?? null
  });
}

export async function syncLocalOrderWithMercadoPago(
  admin: SupabaseClient,
  order: LocalOrder
) {
  if (!hasMercadoPagoToken() || !order.mp_order_id || order.status !== "pending") {
    return order.status;
  }

  const orderData = await fetchMercadoPagoOrder(order.mp_order_id);

  if (!orderData) {
    return order.status;
  }

  const payment = orderData.transactions?.payments?.[0];

  if (isMercadoPagoOrderPaid(orderData)) {
    await markLocalOrderPaid(
      admin,
      order.id,
      String(orderData.id ?? order.mp_order_id),
      payment?.id ? String(payment.id) : order.mp_payment_id
    );
    return "paid";
  }

  if (orderData.status === "expired") {
    await releaseLocalOrder(admin, order.id, "expired");
    return "expired";
  }

  if (orderData.status === "canceled" || orderData.status === "failed") {
    await releaseLocalOrder(admin, order.id, "cancelled");
    return "cancelled";
  }

  return order.status;
}

export async function syncPendingOrdersForRaffle(
  admin: SupabaseClient,
  raffleId: string
) {
  const { data } = await admin
    .from("orders")
    .select("id,status,mp_order_id,mp_payment_id")
    .eq("raffle_id", raffleId)
    .eq("status", "pending")
    .not("mp_order_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const orders = (data ?? []) as LocalOrder[];

  for (const order of orders) {
    await syncLocalOrderWithMercadoPago(admin, order);
  }

  await expirePendingReservations(admin, raffleId);
}
