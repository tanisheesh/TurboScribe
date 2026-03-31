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
  const args = [
    YT_DLP,
    "-x",
    "--audio-format", "mp3",
    "-o", mp3Path,
    "--no-check-certificates",
    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    // Use web client and add more options to bypass bot detection
    "--extractor-args", "youtube:player_client=web,android",
    "--extractor-args", "youtube:skip=dash,hls",
    // Add cookies from browser simulation
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    "--add-header", "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    // Retry and rate limiting
    "--retries", "3",
    "--fragment-retries", "3",
    "--sleep-interval", "1",
    "--max-sleep-interval", "3",
  ];
  
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  console.log(`[downloader] Running: ${args.slice(0, 10).join(" ")} ...`);

  const proc = Bun.spawn(args, { stderr: "pipe" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new DownloadError(stderr || `yt-dlp exited with code ${exitCode}`);
  }

  return { mp3Path };
}

export async function cleanupAudio(mp3Path: string): Promise<void> {
  await unlink(mp3Path);
}
