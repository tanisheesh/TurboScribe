import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { validateYouTubeUrl } from "../../src/validator";

// Feature: youtube-to-article, Property 1: Invalid URLs are always rejected
// Validates: Requirements 1.3
describe("Property 1: Invalid URLs are always rejected", () => {
  test("any string that is not a valid YouTube URL returns { valid: false }", () => {
    const nonYouTubeArbitrary = fc.oneof(
      // Random strings
      fc.string(),
      // URLs from other domains
      fc.webUrl().filter(
        (url) =>
          !url.includes("youtube.com") && !url.includes("youtu.be")
      )
    );

    fc.assert(
      fc.property(nonYouTubeArbitrary, (url) => {
        const result = validateYouTubeUrl(url);
        return result.valid === false;
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: youtube-to-article, Property 2: Both YouTube URL formats are accepted
// Validates: Requirements 1.4
describe("Property 2: Both YouTube URL formats are accepted", () => {
  test("any valid 11-char video ID is accepted in both URL formats and produces the same videoId", () => {
    const videoIdArbitrary = fc.stringMatching(/^[a-zA-Z0-9_-]{11}$/);

    fc.assert(
      fc.property(videoIdArbitrary, (id) => {
        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        const shortUrl = `https://youtu.be/${id}`;

        const watchResult = validateYouTubeUrl(watchUrl);
        const shortResult = validateYouTubeUrl(shortUrl);

        if (!watchResult.valid || !shortResult.valid) return false;

        return watchResult.videoId === id && shortResult.videoId === id;
      }),
      { numRuns: 100 }
    );
  });
});
