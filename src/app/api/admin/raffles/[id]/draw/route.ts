import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { syncPendingOrdersForRaffle } from "@/lib/mercadoPagoOrders";
import { createSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type RaffleDrawState = {
  id: string;
  status: string;
  winning_number: number | null;
  winner_order_id: string | null;
  drawn_at: string | null;
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
      .select("id,number,order_id,orders(id,buyer_name,buyer_whatsapp,buyer_contact,buyer_email)")
      .eq("raffle_id", raffleId)
      .eq("status", "paid")
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

function toDrawResult(
  raffleId: string,
  number: number,
  order: OrderSummary | null | undefined,
  drawnAt: string | null,
  alreadyDrawn = false
) {
  return {
    raffleId,
    winningNumber: number,
    orderId: order?.id ?? null,
    drawnAt,
    alreadyDrawn,
    buyerName: order?.buyer_name ?? null,
    buyerWhatsapp: order?.buyer_whatsapp ?? null,
    buyerContact: order?.buyer_contact ?? null,
    buyerEmail: order?.buyer_email ?? null
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin(request);

    if ("response" in auth) {
      return auth.response;
    }

    const { id } = await context.params;
    const admin = createSupabaseAdmin();
    await syncPendingOrdersForRaffle(admin, id);

    const { data: raffle, error: raffleError } = await admin
      .from("raffles")
      .select("id,status,winning_number,winner_order_id,drawn_at")
      .eq("id", id)
      .single();

    if (raffleError || !raffle) {
      return NextResponse.json(
        { error: raffleError?.message ?? "Campanha nao encontrada." },
        { status: 404 }
      );
    }

    const drawState = raffle as RaffleDrawState;

    if (drawState.winning_number && drawState.winner_order_id) {
      const { data: existingOrder } = await admin
        .from("orders")
        .select("id,buyer_name,buyer_whatsapp,buyer_contact,buyer_email")
        .eq("id", drawState.winner_order_id)
        .maybeSingle();

      return NextResponse.json(
        toDrawResult(
          id,
          drawState.winning_number,
          (existingOrder as OrderSummary | null) ?? null,
          drawState.drawn_at,
          true
        )
      );
    }

    const paidRows = await fetchPaidNumberRows(admin, id);
    const paidNumbers = paidRows.filter((row) => row.order_id);

    if (paidNumbers.length === 0) {
      return NextResponse.json(
        { error: "Ainda nao ha numeros pagos para sortear." },
        { status: 409 }
      );
    }

    const winner = paidNumbers[randomInt(paidNumbers.length)];
    const order = getOrder(winner);
    const drawnAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("raffles")
      .update({
        status: "drawn",
        winning_number: winner.number,
        winner_order_id: winner.order_id,
        drawn_at: drawnAt
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json(toDrawResult(id, winner.number, order, drawnAt));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}
