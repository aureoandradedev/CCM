"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Redimensiona no navegador (máx. 1200 px, WebP) e sobe no Storage do Supabase
 * usando a sessão do admin (policy `admin write product images`).
 */
export async function resizeToWebp(file: File, max = 1200, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter a imagem."))), "image/webp", quality));
}

export async function uploadImage(bucket: "produtos" | "banners", folder: string, file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Envie um arquivo de imagem.");
  const blob = await resizeToWebp(file);
  const path = `${folder}/${Date.now().toString(36)}.webp`;
  const sb = createClient();
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000", upsert: true });
  if (error) throw new Error(error.message);
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
