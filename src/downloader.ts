import { tmpdir } from "os";
import { unlink } from "fs/promises";
import { DownloadError, type DownloadResult } from "./types";

const YT_DLP = process.env.YT_DLP_PATH ?? "yt-dlp";
const FFMPEG_DIR = process.env.FFMPEG_DIR ?? "";

// Only allow safe video ID characters — prevents shell injection
const SAFE_VIDEO_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export async function downloadAudio(videoId: string): Promise<DownloadResult> {
  if (!SAFE_VIDEO_ID.test(videoId)) {
    throw new DownloadError(`Invalid video ID: ${videoId}`);
  }

  const mp3Path = `${tmpdir()}/${videoId}.mp3`;
  
  // Let yt-dlp use default clients (works best without forcing specific clients)
  // Deno is enabled by default for JS challenges
  // EJS scripts will be downloaded from GitHub (more reliable than npm on servers)
  const args = [
    YT_DLP,
    "-f", "bestaudio",
    "-x",
    "--audio-format", "mp3",
    "-o", mp3Path,
    "--no-check-certificates",
    // Enable remote EJS scripts from GitHub (more reliable on servers)
    "--remote-components", "ejs:github",
    // Add rate limiting to avoid bot detection
    "--sleep-interval", "1",
    "--max-sleep-interval", "3",
    "--retries", "5",
    "--fragment-retries", "5",
  ];
  
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  console.log(`[downloader] Downloading audio (default clients, Deno runtime, rate-limited)...`);

  const proc = Bun.spawn(args, { 
    stderr: "pipe",
    env: { ...process.env }
  });
  
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new DownloadError(stderr || `yt-dlp exited with code ${exitCode}`);
  }

  console.log(`[downloader] ✓ Audio downloaded successfully`);
  return { mp3Path };
}

export async function cleanupAudio(mp3Path: string): Promise<void> {
  await unlink(mp3Path);
}
