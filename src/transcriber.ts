import { createReadStream } from "fs";
import Groq from "groq-sdk";
import { config } from "./config";
import { TranscriptionError } from "./types";
import { YoutubeTranscript } from "youtube-transcript";

// ── Strategy 1: YouTube Transcript API (fast, free, reliable) ──────────────

async function fetchTranscript(videoId: string): Promise<string> {
  console.log(`[transcriber] Fetching transcript for ${videoId} using youtube-transcript`);
  
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    
    if (!transcriptItems || transcriptItems.length === 0) {
      throw new Error("No transcript available");
    }

    const text = transcriptItems
      .map((item: any) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      throw new Error("Transcript text empty");
    }

    console.log(`[transcriber] ✓ Transcript fetched: ${text.split(/\s+/).length} words`);
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[transcriber] ✗ Transcript fetch failed: ${msg}`);
    throw new Error(msg);
  }
}

// ── Strategy 2: Groq Whisper fallback (requires mp3Path) ───────────────────

async function whisperFallback(mp3Path: string): Promise<string> {
  const groq = new Groq({ apiKey: config.groqApiKey });

  // Retry up to 3 times on 5xx errors
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const transcription = await groq.audio.transcriptions.create({
        model: "whisper-large-v3-turbo",
        file: createReadStream(mp3Path) as unknown as File,
      });
      if (!transcription.text) throw new Error("Whisper returned empty transcript");
      return transcription.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is5xx = msg.includes("500") || msg.includes("502") || msg.includes("503");
      if (is5xx && attempt < 3) {
        console.log(`[transcriber] Whisper attempt ${attempt} failed with 5xx, retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Whisper failed after 3 attempts");
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function transcribeFromCaptions(videoId: string): Promise<{ transcript: string }> {
  try {
    const transcript = await fetchTranscript(videoId);
    return { transcript };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new TranscriptionError(raw);
  }
}

export async function transcribeFromAudio(mp3Path: string): Promise<{ transcript: string }> {
  try {
    const transcript = await whisperFallback(mp3Path);
    return { transcript };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.length > 0 ? raw : "Groq Whisper error";
    throw new TranscriptionError(message);
  }
}
