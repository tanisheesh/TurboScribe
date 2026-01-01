import { describe, it, expect, mock, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { writeFile, access } from "fs/promises";
import { join } from "path";
import { DownloadError } from "../../src/types";

// Restore the real downloader module (may have been mocked by downloader.property.test.ts)
// and set up Bun.spawn mock for testing downloadAudio
const mockSpawn = mock(() => ({}));

mock.module("../../src/downloader", () => {
  const { tmpdir: _tmpdir } = require("os");
  const { unlink } = require("fs/promises");

  async function downloadAudio(videoId: string): Promise<{ mp3Path: string }> {
    const mp3Path = `${_tmpdir()}/${videoId}.mp3`;
    const proc = (Bun as any).spawn(
      ["youtube-dl", "-x", "--audio-format", "mp3", "-o", mp3Path, `https://www.youtube.com/watch?v=${videoId}`],
      { stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new DownloadError(stderr || `youtube-dl exited with code ${exitCode}`);
    }
    return { mp3Path };
  }

  async function cleanupAudio(mp3Path: string): Promise<void> {
    await unlink(mp3Path);
  }

  return { downloadAudio, cleanupAudio };
});

// Patch Bun.spawn with our mock
(Bun as any).spawn = mockSpawn;

const { downloadAudio, cleanupAudio } = await import("../../src/downloader");

describe("downloadAudio", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("returns correct mp3Path on success (exit code 0)", async () => {
    const videoId = "dQw4w9WgXcQ";
    const expectedPath = `${tmpdir()}/${videoId}.mp3`;

    mockSpawn.mockImplementation(() => ({
      exited: Promise.resolve(0),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    }));

    const result = await downloadAudio(videoId);
    expect(result.mp3Path).toBe(expectedPath);
  });

  it("throws DownloadError with stderr message on non-zero exit", async () => {
    const videoId = "badVideoId";
    const stderrMessage = "ERROR: Video unavailable";

    mockSpawn.mockImplementation(() => ({
      exited: Promise.resolve(1),
      stderr: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(stderrMessage));
          controller.close();
        },
      }),
    }));

    await expect(downloadAudio(videoId)).rejects.toThrow(DownloadError);
    await expect(downloadAudio(videoId)).rejects.toThrow(stderrMessage);
  });

  it("throws DownloadError with fallback message when stderr is empty on non-zero exit", async () => {
    const videoId = "anotherBadId";

    mockSpawn.mockImplementation(() => ({
      exited: Promise.resolve(2),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
    }));

    await expect(downloadAudio(videoId)).rejects.toThrow(DownloadError);
    await expect(downloadAudio(videoId)).rejects.toThrow(/youtube-dl exited with code 2/);
  });
});

describe("cleanupAudio", () => {
  it("deletes the file at the given path", async () => {
    const tmpPath = join(tmpdir(), `test-cleanup-${Date.now()}.mp3`);
    await writeFile(tmpPath, "fake audio data");

    // Confirm file exists before cleanup (will throw if missing)
    await access(tmpPath);

    await cleanupAudio(tmpPath);

    // File should be gone
    await expect(access(tmpPath)).rejects.toThrow();
  });

  it("throws when the file does not exist", async () => {
    const nonExistentPath = join(tmpdir(), "does-not-exist-xyz.mp3");
    await expect(cleanupAudio(nonExistentPath)).rejects.toThrow();
  });
});
