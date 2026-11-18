"use server";

import { assertRole } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

export async function uploadReceivingPhoto(sessionId: string, itemId: string, formData: FormData) {
  await assertRole(["recebedor"]);

  const file = formData.get("photo") as File | null;
  if (!file) throw new Error("Nenhuma foto enviada.");

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Formato não suportado. Use JPEG, PNG ou WebP.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Foto muito grande. Máximo 5 MB.");

  const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${sessionId}/${itemId}/${crypto.randomUUID()}.${ext}`;

  const sb = await createClient();
  const { error } = await sb.storage.from("recebimento").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) throw new Error(`Falha no upload: ${error.message}`);

  return { path };
}

export async function getSignedPhotoUrl(path: string): Promise<string> {
  await assertRole(["recebedor"]);
  const sb = await createClient();
  const { data, error } = await sb.storage.from("recebimento").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("Não foi possível gerar URL da foto.");
  return data.signedUrl;
}
