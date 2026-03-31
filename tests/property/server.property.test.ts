import { describe, test, expect, mock } from "bun:test";
import * as fc from "fast-check";
import { DownloadError, TranscriptionError, ArticleGenerationError } from "../../src/types";

// Feature: youtube-to-article, Property 10: Server returns HTTP 500 for all unhandled pipeline errors

// Use port 3001 to match the integration test's mocked config port (shared process, cached module).
mock.module("../../src/config", () => ({
  config: {
    port: 3001,
    openaiApiKey: "test-key",
    serperApiKey: "test-key",
    firecrawlApiKey: "test-key",
  },
}));

// Mock pipeline before importing server so the server uses our mock
const mockRunPipeline = mock(async (_url: string) => ({ article: "ok" }));

mock.module("../../src/pipeline", () => ({
  runPipeline: mockRunPipeline,
}));

// Import server to ensure it's running (reuses existing instance if already started)
await import("../../src/server");
await new Promise((r) => setTimeout(r, 50));

const BASE = "http://localhost:3001";

// Property 10: Server returns HTTP 500 for all unhandled pipeline errors
// Validates: Requirements 7.4
describe("Property 10: Server returns HTTP 500 for all unhandled pipeline errors", () => {
  test("any error thrown by the pipeline causes POST /generate to return HTTP 500 with non-empty error field", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate various error types and messages
        fc.string({ minLength: 1 }).chain((msg) =>
          fc.constantFrom(
            new DownloadError(msg),
            new TranscriptionError(msg),
            new ArticleGenerationError(msg),
            new Error(msg)
          )
        ),
        async (error) => {
          mockRunPipeline.mockImplementation(async () => {
            throw error;
          });

          const res = await fetch(`${BASE}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
          });

          if (res.status !== 500) return false;

          const body = await res.json() as { error?: string };
          return typeof body.error === "string" && body.error.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
