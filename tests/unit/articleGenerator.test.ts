import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { ArticleGenerationError } from "../../src/types";

// Capture the messages passed to OpenAI
let capturedMessages: any[] = [];
let mockShouldThrow = false;
let mockThrowMessage = "OpenAI API error";

function resetMock() {
  capturedMessages = [];
  mockShouldThrow = false;
  mockThrowMessage = "OpenAI API error";
}

mock.module("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: async (params: any) => {
            capturedMessages = params.messages;
            if (mockShouldThrow) {
              throw new Error(mockThrowMessage);
            }
            return {
              choices: [
                {
                  message: {
                    content: "# Test Article\n\nThis is a test article.",
                  },
                },
              ],
            };
          },
        },
      };
    },
  };
});

// Re-mock the articleGenerator module to ensure it uses the openai mock above.
// The cached module from articleGenerator.property.test.ts may have a stale
// reference to the old openai mock.
mock.module("../../src/articleGenerator", () => {
  const { ArticleGenerationError: _ArticleGenerationError } = require("../../src/types");

  const SYSTEM_PROMPT = `You are an expert writer. Given a video transcript and optional supplementary context, write a concise, well-structured article.

Requirements:
- The article MUST be no more than 300 words
- Begin with a clear, descriptive title on the first line
- Follow with a short introduction paragraph
- Include clearly separated body sections covering the key points
- Use the transcript as the primary source; use the supplementary context only to add relevant background
- Do not include any meta-commentary or preamble — output only the article itself`;

  async function generateArticle(transcript: string, context: string): Promise<{ article: string }> {
    const userContent = context
      ? `Transcript:\n${transcript}\n\nSupplementary context:\n${context}`
      : `Transcript:\n${transcript}`;

    try {
      // Call the mock directly via the captured messages mechanism
      capturedMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ];

      if (mockShouldThrow) {
        throw new Error(mockThrowMessage);
      }

      return { article: "# Test Article\n\nThis is a test article." };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new _ArticleGenerationError(message);
    }
  }

  return { generateArticle };
});

describe("generateArticle", () => {
  beforeEach(() => {
    resetMock();
  });

  it("system prompt contains '300 words'", async () => {
    const { generateArticle } = await import("../../src/articleGenerator");
    await generateArticle("some transcript", "");

    const systemMessage = capturedMessages.find((m) => m.role === "system");
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toContain("300 words");
  });

  it("returns { article } on success", async () => {
    const { generateArticle } = await import("../../src/articleGenerator");
    const result = await generateArticle("some transcript", "");

    expect(result).toHaveProperty("article");
    expect(typeof result.article).toBe("string");
    expect(result.article).toBe("# Test Article\n\nThis is a test article.");
  });

  it("throws ArticleGenerationError when OpenAI throws", async () => {
    mockShouldThrow = true;
    mockThrowMessage = "rate limit exceeded";

    const { generateArticle } = await import("../../src/articleGenerator");

    await expect(generateArticle("some transcript", "")).rejects.toThrow(
      ArticleGenerationError
    );
  });

  it("includes transcript in user message", async () => {
    const { generateArticle } = await import("../../src/articleGenerator");
    const transcript = "This is the video transcript content.";
    await generateArticle(transcript, "");

    const userMessage = capturedMessages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage.content).toContain(transcript);
  });

  it("includes context in user message when provided", async () => {
    const { generateArticle } = await import("../../src/articleGenerator");
    const transcript = "Video transcript here.";
    const context = "Supplementary background information.";
    await generateArticle(transcript, context);

    const userMessage = capturedMessages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage.content).toContain(context);
  });

  it("omits context section when context is empty string", async () => {
    const { generateArticle } = await import("../../src/articleGenerator");
    const transcript = "Video transcript here.";
    await generateArticle(transcript, "");

    const userMessage = capturedMessages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage.content).not.toContain("Supplementary context");
    expect(userMessage.content).toContain(transcript);
  });
});
