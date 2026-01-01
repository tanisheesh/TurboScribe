import { describe, it, expect, mock, beforeEach } from "bun:test";

// Use port 3001 to match the integration test's mocked config port,
// since Bun runs all test files in the same process and the server module
// is cached after the first import (integration test runs first on port 3001).
mock.module("../../src/config", () => ({
  config: {
    port: 3001,
    openaiApiKey: "test-key",
    serperApiKey: "test-key",
    firecrawlApiKey: "test-key",
  },
}));

// Mock pipeline before importing server
const mockRunPipeline = mock(async (_url: string) => ({ article: "Test article content" }));

mock.module("../../src/pipeline", () => ({
  runPipeline: mockRunPipeline,
}));

// Import server — reuses the already-running instance if cached
await import("../../src/server");

// Give the server a moment to start
await new Promise((r) => setTimeout(r, 50));

const BASE = "http://localhost:3001";

describe("server routing", () => {
  beforeEach(() => {
    mockRunPipeline.mockClear();
    mockRunPipeline.mockImplementation(async (_url: string) => ({ article: "Test article content" }));
  });

  it("GET / returns HTML", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
  });

  it("GET /app.js returns JavaScript", async () => {
    const res = await fetch(`${BASE}/app.js`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("javascript");
  });

  it("POST /generate with valid url calls runPipeline and returns article", async () => {
    const res = await fetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { article: string };
    expect(body.article).toBe("Test article content");
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline.mock.calls[0][0]).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("POST /generate with missing body returns 400", async () => {
    const res = await fetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("POST /generate with missing url field returns 400", async () => {
    const res = await fetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notUrl: "something" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("url");
  });

  it("POST /generate returns 500 when pipeline throws", async () => {
    mockRunPipeline.mockImplementation(async () => {
      throw new Error("Pipeline failed");
    });

    const res = await fetch(`${BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Pipeline failed");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${BASE}/unknown-path`);
    expect(res.status).toBe(404);
  });
});
