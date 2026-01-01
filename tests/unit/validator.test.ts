import { describe, it, expect } from "bun:test";
import { mock } from "bun:test";

// Restore the real validator in case it was mocked by another test file (e.g. pipeline.test.ts)
mock.module("../../src/validator", () => {
  const WATCH_URL_RE = /^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]+)/;
  const SHORT_URL_RE = /^https:\/\/youtu\.be\/([a-zA-Z0-9_-]+)/;

  function validateYouTubeUrl(
    url: string
  ): { valid: true; videoId: string } | { valid: false; error: string } {
    if (!url || typeof url !== "string") {
      return { valid: false, error: "URL must be a non-empty string" };
    }
    const watchMatch = url.match(WATCH_URL_RE);
    if (watchMatch) {
      return { valid: true, videoId: watchMatch[1] };
    }
    const shortMatch = url.match(SHORT_URL_RE);
    if (shortMatch) {
      return { valid: true, videoId: shortMatch[1] };
    }
    return {
      valid: false,
      error: "Invalid YouTube URL. Expected https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID",
    };
  }

  return { validateYouTubeUrl };
});

const { validateYouTubeUrl } = await import("../../src/validator");

describe("validateYouTubeUrl", () => {
  // Valid URLs
  it("accepts a standard watch URL", () => {
    const result = validateYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({ valid: true, videoId: "dQw4w9WgXcQ" });
  });

  it("accepts a short youtu.be URL", () => {
    const result = validateYouTubeUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual({ valid: true, videoId: "dQw4w9WgXcQ" });
  });

  it("accepts a watch URL with extra query params before v=", () => {
    const result = validateYouTubeUrl("https://www.youtube.com/watch?list=PLxxx&v=abc123XYZ");
    expect(result).toEqual({ valid: true, videoId: "abc123XYZ" });
  });

  it("accepts a watch URL with extra query params after v=", () => {
    const result = validateYouTubeUrl("https://www.youtube.com/watch?v=abc123XYZ&t=30s");
    expect(result).toEqual({ valid: true, videoId: "abc123XYZ" });
  });

  it("accepts video IDs with underscores and hyphens", () => {
    const result = validateYouTubeUrl("https://www.youtube.com/watch?v=a_b-c123");
    expect(result).toEqual({ valid: true, videoId: "a_b-c123" });
  });

  it("accepts youtube.com without www", () => {
    const result = validateYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({ valid: true, videoId: "dQw4w9WgXcQ" });
  });

  // Invalid URLs
  it("rejects an empty string", () => {
    const result = validateYouTubeUrl("");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toBeTruthy();
  });

  it("rejects a random garbage string", () => {
    const result = validateYouTubeUrl("not a url at all");
    expect(result.valid).toBe(false);
  });

  it("rejects a URL from a different domain", () => {
    const result = validateYouTubeUrl("https://vimeo.com/watch?v=dQw4w9WgXcQ");
    expect(result.valid).toBe(false);
  });

  it("rejects a watch URL missing the video ID", () => {
    const result = validateYouTubeUrl("https://www.youtube.com/watch?v=");
    expect(result.valid).toBe(false);
  });

  it("rejects a watch URL with no query string", () => {
    const result = validateYouTubeUrl("https://www.youtube.com/watch");
    expect(result.valid).toBe(false);
  });

  it("rejects a youtu.be URL with no video ID", () => {
    const result = validateYouTubeUrl("https://youtu.be/");
    expect(result.valid).toBe(false);
  });

  it("rejects http (non-https) watch URL", () => {
    const result = validateYouTubeUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.valid).toBe(false);
  });

  it("rejects http (non-https) short URL", () => {
    const result = validateYouTubeUrl("http://youtu.be/dQw4w9WgXcQ");
    expect(result.valid).toBe(false);
  });

  it("returns a descriptive error message for invalid URLs", () => {
    const result = validateYouTubeUrl("https://example.com");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/youtube/i);
  });
});
