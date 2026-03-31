import { createReadStream } from "fs";
import Groq from "groq-sdk";
import { config } from "./config";
import { TranscriptionError } from "./types";

// ── Strategy 1: YouTube captions (fast, free, no API) ──────────────────────

async function fetchCaptions(videoId: string): Promise<string> {
  console.log(`[transcriber] Attempting to fetch captions for ${videoId}`);
  
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!pageRes.ok) {
    console.log(`[transcriber] Video page fetch failed: ${pageRes.status}`);
    throw new Error(`Video page fetch failed: ${pageRes.status}`);
  }

  const html = await pageRes.text();
  
  // Try multiple patterns to extract captions
  let match = html.match(/"captions":\s*(\{"playerCaptionsTracklistRenderer":.+?\})\s*,"videoDetails"/s);
  if (!match) {
    match = html.match(/"captions":\s*(\{[^}]+captionTracks[^}]+\})/s);
  }
  
  if (!match) {
    console.log(`[transcriber] No captions found in page HTML`);
    throw new Error("No captions found");
  }

  const captionsData = JSON.parse(match[1]);
  const tracks: any[] = captionsData?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  
  if (!tracks.length) {
    console.log(`[transcriber] No caption tracks available`);
    throw new Error("No caption tracks");
  }

  const track = tracks.find((t: any) => t.languageCode === "en")
    ?? tracks.find((t: any) => t.languageCode?.startsWith("en"))
    ?? tracks[0];

  console.log(`[transcriber] Found caption track: ${track.languageCode || 'unknown'}`);

  const captionRes = await fetch(track.baseUrl + "&fmt=json3", {
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  
  if (!captionRes.ok) {
    console.log(`[transcriber] Caption fetch failed: ${captionRes.status}`);
    throw new Error(`Caption fetch failed: ${captionRes.status}`);
  }

  const captionJson = await captionRes.json() as any;
  const text = (captionJson?.events ?? [])
    .filter((e: any) => e.segs)
    .flatMap((e: any) => e.segs.map((s: any) => (s.utf8 ?? "").replace(/\n/g, " ")))
    .filter((t: string) => t.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    console.log(`[transcriber] Caption text empty after parsing`);
    throw new Error("Caption text empty");
  }
  
  console.log(`[transcriber] Captions fetched successfully: ${text.split(/\s+/).length} words`);
  return text;
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
    const transcript = await fetchCaptions(videoId);
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
