import { NextRequest, NextResponse } from "next/server";

import { createOpenAITranscriptionProvider } from "@/src/modules/providers/stt/server";
import { isSpeechToTextError } from "@/src/modules/providers/stt";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: { code: "INPUT_INVALID" } }, { status: 400 });
  }
  const file = form.get("audio");
  if (!isFileLike(file)) return NextResponse.json({ error: { code: "AUDIO_INVALID" } }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await createOpenAITranscriptionProvider().transcribe({
      audioBytes: bytes,
      mimeType: file.type || "audio/webm",
      fileName: file.name || "recording.webm",
      languageTag: typeof form.get("languageTag") === "string" ? String(form.get("languageTag")) : "es-ES",
    }, { signal: request.signal });
    return NextResponse.json({ data: { text: result.text, confidence: result.confidence, confidenceAvailability: result.confidenceAvailability, retentionPolicy: result.retentionPolicy } }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (isSpeechToTextError(error)) {
      const status = error.code === "provider-auth-failed" ? 503 : error.code === "provider-rate-limited" ? 429 : error.code.startsWith("audio-") ? 400 : 503;
      return NextResponse.json({ error: { code: error.code, retryable: error.retryable } }, { status });
    }
    return NextResponse.json({ error: { code: "TRANSCRIPTION_UNAVAILABLE", retryable: true } }, { status: 503 });
  }
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" && "arrayBuffer" in value && "type" in value);
}
