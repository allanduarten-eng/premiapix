import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const bucketName = "raffle-images";
const maxImageSize = 5 * 1024 * 1024;

async function ensureBucket() {
  const admin = createSupabaseAdmin();
  const { error: getError } = await admin.storage.getBucket(bucketName);

  if (!getError) {
    return admin;
  }

  const { error: createError } = await admin.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: maxImageSize,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
  });

  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    throw createError;
  }

  return admin;
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  if (contentType === "image/gif") {
    return "gif";
  }

  return "jpg";
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);

    if ("response" in auth) {
      return auth.response;
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie uma imagem da campanha." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "O arquivo precisa ser uma imagem." }, { status: 400 });
    }

    if (file.size > maxImageSize) {
      return NextResponse.json(
        { error: "A imagem deve ter no maximo 5 MB." },
        { status: 400 }
      );
    }

    const admin = await ensureBucket();
    const path = `${new Date().getFullYear()}/${randomUUID()}.${extensionFor(file.type)}`;
    const { error: uploadError } = await admin.storage
      .from(bucketName)
      .upload(path, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data } = admin.storage.from(bucketName).getPublicUrl(path);

    return NextResponse.json({
      path,
      publicUrl: data.publicUrl
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno." },
      { status: 500 }
    );
  }
}
