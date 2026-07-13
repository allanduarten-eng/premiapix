import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { syncPendingOrdersForRaffle } from "@/lib/mercadoPagoOrders";
import { createSupabaseAdmin } from "@/lib/supabaseServer";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type OrderSummary = {
  id: string;
  buyer_name: string | null;
  buyer_whatsapp: string | null;
  buyer_contact: string | null;
  buyer_email: string | null;
};

type PaidNumberRow = {
  id: string;
  number: number;
  order_id: string | null;
  paid_at: string | null;
  orders: OrderSummary | OrderSummary[] | null;
};

function getOrder(row: PaidNumberRow) {
  return Array.isArray(row.orders) ? row.orders[0] : row.orders;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin(request);

    if ("response" in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const admin = createSupabaseAdmin();
    await syncPendingOrdersForRaffle(admin, id);

    const { data, error } = await admin
      .from("raffle_numbers")
      .select(
        "id,number,order_id,paid_at,orders(id,buyer_name,buyer_whatsapp,buyer_contact,buyer_email)"
      )
      .eq("raffle_id", id)
      .eq("status", "paid")
      .order("number", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const numbers = ((data ?? []) as PaidNumberRow[]).map((row) => {
      const order = getOrder(row);

      return {
        id: row.id,
        number: row.number,
        orderId: row.order_id,
        paidAt: row.paid_at,
        buyerName: order?.buyer_name ?? null,
        buyerWhatsapp: order?.buyer_whatsapp ?? null,
        buyerContact: order?.buyer_contact ?? null,
        buyerEmail: order?.buyer_email ?? null
      };
    });

    return NextResponse.json({ numbers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}
