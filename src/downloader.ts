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
  const args = [YT_DLP, "-x", "--audio-format", "mp3", "-o", mp3Path];
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

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
