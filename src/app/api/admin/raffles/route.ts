import { NextResponse } from "next/server";
import {
  createSupabaseAdmin,
  createSupabaseForToken,
  getBearerToken
} from "@/lib/supabaseServer";

type CreateRaffleBody = {
  title?: string;
  prizeTitle?: string;
  description?: string;
  imageUrl?: string;
  pricePerNumber?: number;
  totalNumbers?: number;
  drawAt?: string | null;
  status?: "draft" | "open";
};

export async function POST(request: Request) {
  try {
    const token = getBearerToken(request);

    if (!token) {
      return NextResponse.json({ error: "Login necessario." }, { status: 401 });
    }

    const userClient = createSupabaseForToken(token);
    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
    }

    const body = (await request.json()) as CreateRaffleBody;
    const title = body.title?.trim();
    const prizeTitle = body.prizeTitle?.trim();
    const pricePerNumber = Number(body.pricePerNumber);
    const totalNumbers = Number(body.totalNumbers);

    if (!title || !prizeTitle) {
      return NextResponse.json(
        { error: "Informe nome da campanha e premio." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(pricePerNumber) || pricePerNumber <= 0) {
      return NextResponse.json({ error: "Valor por numero invalido." }, { status: 400 });
    }

    if (!Number.isInteger(totalNumbers) || totalNumbers < 10 || totalNumbers > 10000) {
      return NextResponse.json(
        { error: "Quantidade de numeros deve ficar entre 10 e 10000." },
        { status: 400 }
      );
    }

    const admin = createSupabaseAdmin();
    const { data: adminRow, error: adminError } = await admin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !adminRow) {
      return NextResponse.json(
        { error: "Apenas administradores podem criar campanhas." },
        { status: 403 }
      );
    }

    const { data, error } = await admin
      .from("raffles")
      .insert({
        title,
        prize_title: prizeTitle,
        description: body.description?.trim() || null,
        image_url: body.imageUrl?.trim() || null,
        price_per_number: pricePerNumber,
        total_numbers: totalNumbers,
        draw_at: body.drawAt || null,
        status: body.status === "draft" ? "draft" : "open",
        created_by: user.id
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const token = getBearerToken(request);

    if (!token) {
      return NextResponse.json({ error: "Login necessario." }, { status: 401 });
    }

    const userClient = createSupabaseForToken(token);
    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
    }

    const { id } = (await request.json()) as { id?: string };

    if (!id) {
      return NextResponse.json({ error: "Informe a campanha para excluir." }, { status: 400 });
    }

    const admin = createSupabaseAdmin();
    const { data: adminRow, error: adminError } = await admin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError || !adminRow) {
      return NextResponse.json(
        { error: "Apenas administradores podem excluir campanhas." },
        { status: 403 }
      );
    }

    const { error } = await admin.from("raffles").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}
