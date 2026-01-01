import { describe, test, expect, mock } from "bun:test";
import * as fc from "fast-check";
import { tmpdir } from "os";
import { writeFile, access } from "fs/promises";
import { DownloadError } from "../../src/types";

// ─── Property 3 Setup ────────────────────────────────────────────────────────
// We test downloadAudio directly by monkey-patching Bun.spawn before each call.

// Feature: youtube-to-article, Property 3: Downloader errors produce descriptive errors
// Validates: Requirements 2.3
describe("Property 3: Downloader errors produce descriptive errors", () => {
  test("any non-zero exit code from youtube-dl throws DownloadError with non-empty message", async () => {
    const { downloadAudio } = await import("../../src/downloader");

    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.integer({ min: 1, max: 255 }),
        async (stderr, exitCode) => {
          const originalSpawn = Bun.spawn;

          // Build a fake stderr ReadableStream
          const stderrStream = new ReadableStream<Uint8Array>({
            start(controller) {
              if (stderr.length > 0) {
                controller.enqueue(new TextEncoder().encode(stderr));
              }
              controller.close();
            },
          });

          (Bun as any).spawn = () => ({
            exited: Promise.resolve(exitCode),
            stderr: stderrStream,
          });

          let thrownError: unknown;
          try {
            await downloadAudio("test-video-id");
          } catch (err) {
            thrownError = err;
          } finally {
            (Bun as any).spawn = originalSpawn;
          }

          // Must throw a DownloadError
          if (!(thrownError instanceof DownloadError)) return false;
          // Message must be non-empty
          return thrownError.message.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4 Setup ────────────────────────────────────────────────────────
// Mock all pipeline dependencies except the real cleanupAudio, so we can write
// a real temp file and verify it gets deleted by the pipeline's finally block.

// Feature: youtube-to-article, Property 4: Temporary MP3 files are always cleaned up
// Validates: Requirements 2.4
describe("Property 4: Temporary MP3 files are always cleaned up", () => {
  test("temp MP3 file no longer exists after pipeline completes (success or failure after transcription)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Use safe video IDs (alphanumeric) to avoid filesystem issues
        fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/),
        async (videoId) => {
          const mp3Path = `${tmpdir()}/${videoId}.mp3`;

          // Mock the downloader to write a real temp file
          mock.module("../../src/downloader", () => ({
            downloadAudio: async (_id: string) => {
              await writeFile(mp3Path, "fake audio data");
              return { mp3Path };
            },
            cleanupAudio: async (path: string) => {
              const { unlink } = await import("fs/promises");
              await unlink(path);
            },
          }));

          // Mock transcriber to succeed
          mock.module("../../src/transcriber", () => ({
            transcribe: async (_path: string) => ({ transcript: "test transcript" }),
          }));

          // Mock enricher to succeed
          mock.module("../../src/enricher", () => ({
            enrich: async (_transcript: string) => ({ context: "" }),
          }));

          // Mock article generator to succeed
          mock.module("../../src/articleGenerator", () => ({
            generateArticle: async (_transcript: string, _context: string) => ({
              article: "Test article content.",
            }),
          }));

          // Re-import pipeline after mocking
          const { runPipeline } = await import("../../src/pipeline");

          try {
            await runPipeline(`https://www.youtube.com/watch?v=${videoId.padEnd(11, "x").slice(0, 11)}`);
          } catch {
            // Pipeline may throw (e.g. PipelineError) — cleanup should still happen
          }

          // Assert the temp file no longer exists
          let fileExists = false;
          try {
            await access(mp3Path);
            fileExists = true;
          } catch {
            fileExists = false;
          }

          return !fileExists;
        }
      ),
      { numRuns: 100 }
    );
  });
});
