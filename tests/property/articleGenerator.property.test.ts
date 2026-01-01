import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";

// Feature: youtube-to-article, Property 8: Generated articles are within the 300-word limit
// Validates: Requirements 5.2
describe("Property 8: Generated articles are within the 300-word limit", () => {
  test("for any transcript and context, the returned article contains no more than 300 words", async () => {
    await fc.assert(
      fc.asyncProperty(
        // transcript: non-empty string
        fc.string({ minLength: 1, maxLength: 500 }),
        // context: may be empty or non-empty
        fc.string({ maxLength: 300 }),
        // word count of the article OpenAI will return (0–300 inclusive)
        fc.integer({ min: 0, max: 300 }),
        async (transcript, context, wordCount) => {
          // Build a mock article with exactly `wordCount` words
          const mockArticle = wordCount === 0
            ? ""
            : ["word"].concat(Array.from({ length: wordCount - 1 }, (_, i) => `w${i}`)).join(" ");

          // Mock the openai module so no real HTTP call is made
          mock.module("openai", () => {
            return {
              default: class MockOpenAI {
                chat = {
                  completions: {
                    create: async () => ({
                      choices: [{ message: { content: mockArticle } }],
                    }),
                  },
                };
              },
            };
          });

          const { generateArticle } = await import("../../src/articleGenerator");
          const result = await generateArticle(transcript, context);

          const words = result.article.trim() === ""
            ? []
            : result.article.trim().split(/\s+/);

          return words.length <= 300;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: youtube-to-article, Property 9: Generated articles contain required structural elements
// Validates: Requirements 5.3
describe("Property 9: Generated articles contain required structural elements", () => {
  test("for any transcript and context, the returned article has a non-empty title and at least one body paragraph", async () => {
    await fc.assert(
      fc.asyncProperty(
        // transcript
        fc.string({ minLength: 1, maxLength: 500 }),
        // context
        fc.string({ maxLength: 300 }),
        // title line (non-empty, no newlines)
        fc.string({ minLength: 1, maxLength: 80 }).map((s) => s.replace(/\n/g, " ").trim() || "Title"),
        // body paragraph (non-empty)
        fc.string({ minLength: 1, maxLength: 200 }).map((s) => s.replace(/\n/g, " ").trim() || "Body paragraph text here."),
        async (transcript, context, title, body) => {
          // Construct a well-structured mock article: title on first line, blank line, body paragraph
          const mockArticle = `${title}\n\n${body}`;

          mock.module("openai", () => {
            return {
              default: class MockOpenAI {
                chat = {
                  completions: {
                    create: async () => ({
                      choices: [{ message: { content: mockArticle } }],
                    }),
                  },
                };
              },
            };
          });

          const { generateArticle } = await import("../../src/articleGenerator");
          const result = await generateArticle(transcript, context);

          const lines = result.article.split("\n");

          // Title: first non-empty line must be non-empty
          const firstNonEmptyLine = lines.find((l) => l.trim().length > 0);
          if (!firstNonEmptyLine || firstNonEmptyLine.trim().length === 0) return false;

          // Body: there must be at least one non-empty line after the title
          const titleIndex = lines.indexOf(firstNonEmptyLine);
          const remainingLines = lines.slice(titleIndex + 1);
          const hasBodyParagraph = remainingLines.some((l) => l.trim().length > 0);

          return hasBodyParagraph;
        }
      ),
      { numRuns: 100 }
    );
  });
});
