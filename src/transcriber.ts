import { createReadStream } from "fs";
import Groq from "groq-sdk";
import { config } from "./config";
import { TranscriptionError } from "./types";

// ── Strategy 1: YouTube Transcript via direct API ──────────────────────

async function fetchTranscript(videoId: string): Promise<string> {
  console.log(`[transcriber] Fetching transcript for ${videoId}`);
  
  try {
    // Get video page to extract transcript data
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch video page: ${response.status}`);
    }

    const html = await response.text();

    // Extract captions/transcript URL from page
    const captionsRegex = /"captionTracks":\s*(\[.*?\])/;
    const match = html.match(captionsRegex);

    if (!match) {
      throw new Error("No transcript available for this video");
    }

    const captionTracks = JSON.parse(match[1]);
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error("No transcript tracks found");
    }

    // Prefer English, fallback to first available
    const track = captionTracks.find((t: any) => t.languageCode === "en" || t.languageCode?.startsWith("en")) || captionTracks[0];

    if (!track.baseUrl) {
      throw new Error("No transcript URL found");
    }

    // Fetch the actual transcript
    const transcriptResponse = await fetch(track.baseUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!transcriptResponse.ok) {
      throw new Error(`Failed to fetch transcript: ${transcriptResponse.status}`);
    }

    const transcriptXml = await transcriptResponse.text();

    // Parse XML to extract text
    const textRegex = /<text[^>]*>(.*?)<\/text>/g;
    const texts: string[] = [];
    let textMatch;

    while ((textMatch = textRegex.exec(transcriptXml)) !== null) {
      const text = textMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, " ")
        .trim();
      if (text) texts.push(text);
    }

    if (texts.length === 0) {
      throw new Error("No transcript text found");
    }

    const transcript = texts.join(" ").replace(/\s+/g, " ").trim();
    console.log(`[transcriber] ✓ Transcript fetched: ${transcript.split(/\s+/).length} words`);
    return transcript;

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
