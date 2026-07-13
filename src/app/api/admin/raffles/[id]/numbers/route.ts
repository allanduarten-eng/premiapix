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

const pageSize = 1000;

function getOrder(row: PaidNumberRow) {
  return Array.isArray(row.orders) ? row.orders[0] : row.orders;
}

async function fetchPaidNumberRows(admin: ReturnType<typeof createSupabaseAdmin>, raffleId: string) {
  const rows: PaidNumberRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("raffle_numbers")
      .select(
        "id,number,order_id,paid_at,orders(id,buyer_name,buyer_whatsapp,buyer_contact,buyer_email)"
      )
      .eq("raffle_id", raffleId)
      .eq("status", "paid")
      .order("number", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    rows.push(...((data ?? []) as PaidNumberRow[]));

    if (!data || data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
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

    const paidRows = await fetchPaidNumberRows(admin, id);
    const numbers = paidRows.map((row) => {
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
