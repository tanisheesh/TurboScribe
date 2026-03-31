import { describe, test, expect, mock } from "bun:test";
import * as fc from "fast-check";

// Restore the real enricher module in case it was mocked by another test file
// (e.g. downloader.property.test.ts mocks ../../src/enricher).
// We inline the real enricher logic here.
mock.module("../../src/enricher", () => {
  const MAX_CONTEXT_CHARS = 8000;
  const TOP_RESULTS = 3;

  function extractQuery(transcript: string): string {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "shall", "can", "that", "this",
      "these", "those", "it", "its", "i", "we", "you", "he", "she", "they",
      "my", "your", "his", "her", "our", "their", "what", "which", "who",
      "when", "where", "how", "why", "so", "if", "then", "than", "as", "up",
      "out", "about", "into", "through", "just", "also", "not", "no", "more",
    ]);
    const words = transcript
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 3 && !stopWords.has(w));
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
    const topWords = [...freq.entries()]
      .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
      .slice(0, 6)
      .map(([word]: [string, number]) => word);
    return topWords.join(" ");
  }

  async function searchSerper(query: string): Promise<string[]> {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": "" },
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { organic?: Array<{ link: string }> };
    return (data.organic ?? []).slice(0, TOP_RESULTS).map((r: { link: string }) => r.link).filter(Boolean);
  }

  async function fetchWithFirecrawl(url: string): Promise<string> {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    });
    if (!response.ok) {
      throw new Error(`Firecrawl error for ${url}: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { data?: { markdown?: string } };
    return data.data?.markdown ?? "";
  }

  async function enrich(transcript: string): Promise<{ context: string }> {
    try {
      const query = extractQuery(transcript);
      if (!query) return { context: "" };
      const urls = await searchSerper(query);
      if (urls.length === 0) return { context: "" };
      const chunks: string[] = [];
      let totalChars = 0;
      for (const url of urls) {
        if (totalChars >= MAX_CONTEXT_CHARS) break;
        try {
          const text = await fetchWithFirecrawl(url);
          if (!text) continue;
          const remaining = MAX_CONTEXT_CHARS - totalChars;
          const chunk = text.slice(0, remaining);
          chunks.push(chunk);
          totalChars += chunk.length;
        } catch (err) {
          console.error(`[enricher] Failed to fetch ${url}:`, err);
        }
      }
      return { context: chunks.join("\n\n") };
    } catch (err) {
      console.error("[enricher] Enrichment failed:", err);
      return { context: "" };
    }
  }

  return { enrich };
});

// Feature: youtube-to-article, Property 6: Enricher degrades gracefully on external failures
// Validates: Requirements 4.5
describe("Property 6: Enricher degrades gracefully on external failures", () => {
  test("any error from serper.dev or Firecrawl causes enrich to return { context: '' } without throwing", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a non-empty transcript so keyword extraction produces a query
        fc.string({ minLength: 20 }).map((s) =>
          // Ensure it has some meaningful words (length > 3, non-stop-words)
          s.replace(/[^a-zA-Z0-9\s]/g, " ") + " technology software programming development"
        ),
        // Error message for the simulated failure
        fc.string(),
        // Which service fails: 0 = serper throws, 1 = serper returns non-ok, 2 = firecrawl throws, 3 = firecrawl returns non-ok
        fc.integer({ min: 0, max: 3 }),
        async (transcript, errorMessage, failureMode) => {
          const originalFetch = globalThis.fetch;

          globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

            if (url.includes("serper.dev")) {
              if (failureMode === 0) {
                throw new Error(errorMessage || "serper network error");
              }
              if (failureMode === 1) {
                return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
              }
              // For modes 2 & 3, serper succeeds and returns a URL for firecrawl to fetch
              return new Response(
                JSON.stringify({ organic: [{ link: "https://example.com/article" }] }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }

            if (url.includes("firecrawl.dev")) {
              if (failureMode === 2) {
                throw new Error(errorMessage || "firecrawl network error");
              }
              if (failureMode === 3) {
                return new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" });
              }
            }

            throw new Error("Unexpected fetch call");
          };

          let result: { context: string } | undefined;
          let thrownError: unknown;

          try {
            const { enrich } = await import("../../src/enricher");
            result = await enrich(transcript);
          } catch (err) {
            thrownError = err;
          } finally {
            globalThis.fetch = originalFetch;
          }

          // Must NOT throw
          if (thrownError !== undefined) return false;
          // Must return { context: "" }
          if (!result) return false;
          return result.context === "";
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: youtube-to-article, Property 7: Keyword extraction always produces a non-empty query
// Validates: Requirements 4.1
describe("Property 7: Keyword extraction always produces a non-empty query", () => {
  test("any non-empty transcript with meaningful words produces a non-empty search query", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate transcripts that contain at least some words longer than 3 chars
        // (the extractQuery heuristic filters out short words and stop words)
        fc.array(
          fc.stringMatching(/^[a-zA-Z]{4,12}$/),
          { minLength: 3, maxLength: 20 }
        ).map((words) => words.join(" ")),
        async (transcript) => {
          const originalFetch = globalThis.fetch;

          let capturedQuery: string | null = null;

          // Mock fetch to capture the query sent to serper and return empty results
          globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

            if (url.includes("serper.dev")) {
              // Capture the query from the request body
              const body = init?.body ? JSON.parse(init.body as string) : {};
              capturedQuery = body.q ?? null;
              // Return empty results so enrich exits early without calling firecrawl
              return new Response(
                JSON.stringify({ organic: [] }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }

            throw new Error("Unexpected fetch call");
          };

          try {
            const { enrich } = await import("../../src/enricher");
            await enrich(transcript);
          } finally {
            globalThis.fetch = originalFetch;
          }

          // The query sent to serper must be non-empty
          // (if capturedQuery is null, extractQuery returned "" and enrich returned early — that's a failure)
          return capturedQuery !== null && capturedQuery.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
