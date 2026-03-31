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
  
  // Use Bun as JS runtime (already installed in container)
  // and enable remote EJS scripts from npm
  const args = [
    YT_DLP,
    "-f", "bestaudio",
    "-x",
    "--audio-format", "mp3",
    "-o", mp3Path,
    "--no-check-certificates",
    // Enable Bun as JavaScript runtime for YouTube challenges
    "--js-runtimes", "bun",
    // Enable remote EJS scripts from npm (Bun supports this)
    "--remote-components", "ejs:npm",
    // Use android_creator client (less bot detection)
    "--extractor-args", "youtube:player_client=android_creator",
    "--user-agent", "com.google.android.apps.youtube.creator/24.06.103 (Linux; U; Android 14) gzip",
    "--retries", "5",
    "--fragment-retries", "5",
  ];
  
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  console.log(`[downloader] Downloading with Bun JS runtime and Android Creator client...`);

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
