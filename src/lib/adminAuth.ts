import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import {
  createSupabaseAdmin,
  createSupabaseForToken,
  getBearerToken
} from "@/lib/supabaseServer";

type AdminAuthResult =
  | {
      user: User;
    }
  | {
      response: NextResponse;
    };

export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const token = getBearerToken(request);

  if (!token) {
    return { response: NextResponse.json({ error: "Login necessario." }, { status: 401 }) };
  }

  const userClient = createSupabaseForToken(token);
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { response: NextResponse.json({ error: "Sessao invalida." }, { status: 401 }) };
  }

  const admin = createSupabaseAdmin();
  const { data: adminRow, error: adminError } = await admin
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return {
      response: NextResponse.json(
        { error: "Apenas administradores podem executar esta acao." },
        { status: 403 }
      )
    };
  }

  return { user };
}
