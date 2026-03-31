import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// We'll replace globalThis.fetch for each test
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Helper to build a mock fetch that handles serper and firecrawl
function mockFetch(
  serperHandler: (init?: RequestInit) => Promise<Response>,
  firecrawlHandler: (init?: RequestInit) => Promise<Response>
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    if (url.includes("serper.dev")) return serperHandler(init);
    if (url.includes("firecrawl.dev")) return firecrawlHandler(init);
    throw new Error(`Unexpected fetch to: ${url}`);
  };
}

function serperOk(urls: string[]): (init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(
      JSON.stringify({ organic: urls.map((link) => ({ link })) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
}

function serperEmpty(): (init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(JSON.stringify({ organic: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function firecrawlOk(content: string): (init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(
      JSON.stringify({ data: { markdown: content } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
}

// A transcript with no meaningful keywords (all short/stop words)
const EMPTY_TRANSCRIPT = "the a an and or but in on at to for of with by";

// A transcript with meaningful keywords
const RICH_TRANSCRIPT =
  "machine learning algorithms neural networks training datasets optimization gradient descent backpropagation";

describe("enrich", () => {
  it("returns { context: '' } when transcript has no meaningful keywords", async () => {
    // fetch should never be called — enrich exits early
    (globalThis as any).fetch = async () => {
      throw new Error("fetch should not be called");
    };

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(EMPTY_TRANSCRIPT);
    expect(result).toEqual({ context: "" });
  });

  it("returns { context: '' } when serper returns no results", async () => {
    (globalThis as any).fetch = mockFetch(
      serperEmpty(),
      async () => { throw new Error("firecrawl should not be called"); }
    );

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(RICH_TRANSCRIPT);
    expect(result).toEqual({ context: "" });
  });

  it("returns { context: '' } when serper throws", async () => {
    (globalThis as any).fetch = mockFetch(
      async () => { throw new Error("network error"); },
      async () => { throw new Error("firecrawl should not be called"); }
    );

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(RICH_TRANSCRIPT);
    expect(result).toEqual({ context: "" });
  });

  it("returns { context: '' } when serper returns a non-ok response", async () => {
    (globalThis as any).fetch = mockFetch(
      async () => new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" }),
      async () => { throw new Error("firecrawl should not be called"); }
    );

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(RICH_TRANSCRIPT);
    expect(result).toEqual({ context: "" });
  });

  it("returns combined context from multiple URLs on success", async () => {
    const urls = [
      "https://example.com/article1",
      "https://example.com/article2",
    ];

    (globalThis as any).fetch = mockFetch(
      serperOk(urls),
      firecrawlOk("some content")
    );

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(RICH_TRANSCRIPT);

    // Both articles contribute — context should contain content from both
    expect(result.context).toContain("some content");
    // Two chunks joined by "\n\n"
    expect(result.context).toBe("some content\n\nsome content");
  });

  it("skips a URL when firecrawl throws but returns context from other URLs", async () => {
    const urls = [
      "https://example.com/bad",
      "https://example.com/good",
    ];

    let callCount = 0;
    (globalThis as any).fetch = mockFetch(
      serperOk(urls),
      async () => {
        callCount++;
        if (callCount === 1) throw new Error("firecrawl failed");
        return new Response(
          JSON.stringify({ data: { markdown: "good content" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    );

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(RICH_TRANSCRIPT);

    // Should still return content from the second URL
    expect(result.context).toBe("good content");
  });

  it("caps context at ~8000 chars", async () => {
    // Each article returns 5000 chars; combined they'd be 10000+ without a cap.
    // The enricher slices each chunk to the remaining budget (MAX_CONTEXT_CHARS=8000),
    // so the total content chars are capped at 8000 (separators may add a few bytes).
    const longContent = "x".repeat(5000);
    const urls = [
      "https://example.com/article1",
      "https://example.com/article2",
    ];

    (globalThis as any).fetch = mockFetch(
      serperOk(urls),
      firecrawlOk(longContent)
    );

    const { enrich } = await import("../../src/enricher");
    const result = await enrich(RICH_TRANSCRIPT);

    // Allow a small overage for "\n\n" separators between chunks
    expect(result.context.length).toBeLessThanOrEqual(8010);
    // But total content (excluding separators) must not exceed 8000
    const contentOnly = result.context.split("\n\n").join("");
    expect(contentOnly.length).toBeLessThanOrEqual(8000);
  });
});
