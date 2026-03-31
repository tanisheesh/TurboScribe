import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";

const PORT = 3001;
const realFetch = globalThis.fetch;

mock.module("../../src/config", () => ({
  config: {
    port: PORT,
    openaiApiKey: "test-openai-key",
    serperApiKey: "test-serper-key",
    firecrawlApiKey: "test-firecrawl-key",
  },
}));

const mockTranscribe = mock(async (_mp3Path: string) => ({
  transcript: "This is a test transcript about machine learning and neural networks.",
}));

mock.module("../../src/transcriber", () => ({
  transcribe: mockTranscribe,
}));

const mockGenerateArticle = mock(async (_transcript: string, _context: string) => ({
  article: "# Test Article\n\nThis is the generated article content.",
}));

mock.module("../../src/articleGenerator", () => ({
  generateArticle: mockGenerateArticle,
}));

const originalSpawn = Bun.spawn.bind(Bun);

function makeDefaultSpawnMock() {
  return (_cmd: string[], _opts?: unknown) => ({
    exited: Promise.resolve(0),
    stderr: new ReadableStream({ start(c: ReadableStreamDefaultController) { c.close(); } }),
  });
}

const fetchState = { externalShouldFail: false };

function makeFetchMock() {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url instanceof Request ? url.url : String(url);
    if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
      return realFetch(url as string, init);
    }
    if (fetchState.externalShouldFail) {
      return new Response("Service Unavailable", { status: 503 });
    }
    if (urlStr.includes("serper.dev")) {
      return new Response(
        JSON.stringify({ organic: [{ link: "https://example.com/article" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("firecrawl.dev")) {
      return new Response(
        JSON.stringify({ data: { markdown: "Some enriched context about machine learning." } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  };
}

beforeAll(async () => {
  (Bun as unknown as Record<string, unknown>).spawn = makeDefaultSpawnMock();
  globalThis.fetch = makeFetchMock() as unknown as typeof fetch;
  await import("../../src/server");
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(() => {
  (Bun as unknown as Record<string, unknown>).spawn = originalSpawn;
  globalThis.fetch = realFetch;
});

const BASE = `http://localhost:${PORT}`;

function resetToHappyPath() {
  mockTranscribe.mockClear();
  mockGenerateArticle.mockClear();
  fetchState.externalShouldFail = false;
  mockTranscribe.mockImplementation(async (_mp3Path: string) => ({
    transcript: "This is a test transcript about machine learning and neural networks.",
  }));
  mockGenerateArticle.mockImplementation(async (_transcript: string, _context: string) => ({
    article: "# Test Article\n\nThis is the generated article content.",
  }));
  (Bun as unknown as Record<string, unknown>).spawn = makeDefaultSpawnMock();
  globalThis.fetch = makeFetchMock() as unknown as typeof fetch;
}

describe("Integration: POST /generate pipeline", () => {
  it("returns 200 { article: string } for a valid YouTube URL", async () => {
    resetToHappyPath();
    const res = await realFetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { article: string };
    expect(typeof body.article).toBe("string");
    expect(body.article.length).toBeGreaterThan(0);
    expect((body as Record<string, unknown>).error).toBeUndefined();
  });

  it("deletes the temp MP3 file even when transcription throws", async () => {
    resetToHappyPath();
    const videoId = "dQw4w9WgXcQ";
    const testMp3Path = `${tmpdir()}\\${videoId}.mp3`;
    writeFileSync(testMp3Path, "fake mp3 data");
    expect(existsSync(testMp3Path)).toBe(true);
    mockTranscribe.mockImplementation(async (_mp3Path: string) => {
      throw new Error("Whisper API unavailable");
    });
    const res = await realFetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(existsSync(testMp3Path)).toBe(false);
  });

  it("returns 200 { article: string } even when serper and firecrawl fail", async () => {
    resetToHappyPath();
    fetchState.externalShouldFail = true;
    const res = await realFetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { article: string };
    expect(typeof body.article).toBe("string");
    expect(body.article.length).toBeGreaterThan(0);
  });

  it("returns 500 { error: string } for an invalid YouTube URL", async () => {
    resetToHappyPath();
    const res = await realFetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://not-youtube.com/video" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
