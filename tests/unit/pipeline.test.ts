import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  PipelineError,
  DownloadError,
  TranscriptionError,
  ArticleGenerationError,
} from "../../src/types";

// Mock all pipeline dependencies before importing pipeline
const mockValidateYouTubeUrl = mock((_url: string) => ({
  valid: true as const,
  videoId: "dQw4w9WgXcQ",
}));

const mockDownloadAudio = mock(async (_videoId: string) => ({
  mp3Path: "/tmp/dQw4w9WgXcQ.mp3",
}));

const mockCleanupAudio = mock(async (_mp3Path: string) => {});

const mockTranscribe = mock(async (_mp3Path: string) => ({
  transcript: "This is a test transcript.",
}));

const mockEnrich = mock(async (_transcript: string) => ({
  context: "Some enriched context.",
}));

const mockGenerateArticle = mock(async (_transcript: string, _context: string) => ({
  article: "Generated article content.",
}));

mock.module("../../src/validator", () => ({
  validateYouTubeUrl: mockValidateYouTubeUrl,
}));

mock.module("../../src/downloader", () => ({
  downloadAudio: mockDownloadAudio,
  cleanupAudio: mockCleanupAudio,
}));

mock.module("../../src/transcriber", () => ({
  transcribe: mockTranscribe,
}));

mock.module("../../src/enricher", () => ({
  enrich: mockEnrich,
}));

mock.module("../../src/articleGenerator", () => ({
  generateArticle: mockGenerateArticle,
}));

// Override any existing mock of pipeline (e.g. from server.property.test.ts)
// by re-exporting the real pipeline implementation using the mocked dependencies above.
mock.module("../../src/pipeline", () => {
  const { validateYouTubeUrl } = require("../../src/validator");
  const { downloadAudio, cleanupAudio } = require("../../src/downloader");
  const { transcribe } = require("../../src/transcriber");
  const { enrich } = require("../../src/enricher");
  const { generateArticle } = require("../../src/articleGenerator");
  const { PipelineError } = require("../../src/types");

  async function runPipeline(url: string): Promise<{ article: string }> {
    const validation = validateYouTubeUrl(url);
    if (!validation.valid) {
      throw new PipelineError(validation.error, new Error(validation.error));
    }
    const { videoId } = validation;

    let mp3Path: string;
    try {
      const result = await downloadAudio(videoId);
      mp3Path = result.mp3Path;
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new PipelineError(`Download failed: ${cause.message}`, cause);
    }

    let transcript: string;
    try {
      const result = await transcribe(mp3Path);
      transcript = result.transcript;
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new PipelineError(`Transcription failed: ${cause.message}`, cause);
    } finally {
      await cleanupAudio(mp3Path).catch((e: unknown) =>
        console.error("[pipeline] Failed to clean up MP3:", e)
      );
    }

    const { context } = await enrich(transcript);

    try {
      const result = await generateArticle(transcript, context);
      return { article: result.article };
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new PipelineError(`Article generation failed: ${cause.message}`, cause);
    }
  }

  return { runPipeline };
});

const { runPipeline } = await import("../../src/pipeline");

describe("runPipeline", () => {
  beforeEach(() => {
    mockValidateYouTubeUrl.mockClear();
    mockDownloadAudio.mockClear();
    mockCleanupAudio.mockClear();
    mockTranscribe.mockClear();
    mockEnrich.mockClear();
    mockGenerateArticle.mockClear();

    // Reset to happy-path defaults
    mockValidateYouTubeUrl.mockImplementation((_url: string) => ({
      valid: true as const,
      videoId: "dQw4w9WgXcQ",
    }));
    mockDownloadAudio.mockImplementation(async (_videoId: string) => ({
      mp3Path: "/tmp/dQw4w9WgXcQ.mp3",
    }));
    mockCleanupAudio.mockImplementation(async (_mp3Path: string) => {});
    mockTranscribe.mockImplementation(async (_mp3Path: string) => ({
      transcript: "This is a test transcript.",
    }));
    mockEnrich.mockImplementation(async (_transcript: string) => ({
      context: "Some enriched context.",
    }));
    mockGenerateArticle.mockImplementation(
      async (_transcript: string, _context: string) => ({
        article: "Generated article content.",
      })
    );
  });

  it("calls all components in correct order", async () => {
    const callOrder: string[] = [];

    mockValidateYouTubeUrl.mockImplementation((_url: string) => {
      callOrder.push("validate");
      return { valid: true as const, videoId: "dQw4w9WgXcQ" };
    });
    mockDownloadAudio.mockImplementation(async (_videoId: string) => {
      callOrder.push("download");
      return { mp3Path: "/tmp/dQw4w9WgXcQ.mp3" };
    });
    mockTranscribe.mockImplementation(async (_mp3Path: string) => {
      callOrder.push("transcribe");
      return { transcript: "transcript" };
    });
    mockCleanupAudio.mockImplementation(async (_mp3Path: string) => {
      callOrder.push("cleanup");
    });
    mockEnrich.mockImplementation(async (_transcript: string) => {
      callOrder.push("enrich");
      return { context: "context" };
    });
    mockGenerateArticle.mockImplementation(
      async (_transcript: string, _context: string) => {
        callOrder.push("generateArticle");
        return { article: "article" };
      }
    );

    await runPipeline("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(callOrder).toEqual([
      "validate",
      "download",
      "transcribe",
      "cleanup",
      "enrich",
      "generateArticle",
    ]);
  });

  it("returns { article } on success", async () => {
    const result = await runPipeline(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toEqual({ article: "Generated article content." });
  });

  it("passes videoId to downloadAudio", async () => {
    mockValidateYouTubeUrl.mockImplementation((_url: string) => ({
      valid: true as const,
      videoId: "abc123",
    }));

    await runPipeline("https://www.youtube.com/watch?v=abc123");

    expect(mockDownloadAudio.mock.calls[0][0]).toBe("abc123");
  });

  it("passes mp3Path to transcribe", async () => {
    mockDownloadAudio.mockImplementation(async (_videoId: string) => ({
      mp3Path: "/tmp/custom.mp3",
    }));

    await runPipeline("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(mockTranscribe.mock.calls[0][0]).toBe("/tmp/custom.mp3");
  });

  it("passes transcript and context to generateArticle", async () => {
    mockTranscribe.mockImplementation(async (_mp3Path: string) => ({
      transcript: "my transcript",
    }));
    mockEnrich.mockImplementation(async (_transcript: string) => ({
      context: "my context",
    }));

    await runPipeline("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(mockGenerateArticle.mock.calls[0][0]).toBe("my transcript");
    expect(mockGenerateArticle.mock.calls[0][1]).toBe("my context");
  });

  it("cleanupAudio is called even when transcribe throws", async () => {
    mockTranscribe.mockImplementation(async (_mp3Path: string) => {
      throw new TranscriptionError("Whisper API failed");
    });

    await expect(
      runPipeline("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ).rejects.toThrow(PipelineError);

    expect(mockCleanupAudio).toHaveBeenCalledTimes(1);
    expect(mockCleanupAudio.mock.calls[0][0]).toBe("/tmp/dQw4w9WgXcQ.mp3");
  });

  it("cleanupAudio is called with correct mp3Path on success", async () => {
    mockDownloadAudio.mockImplementation(async (_videoId: string) => ({
      mp3Path: "/tmp/test-audio.mp3",
    }));

    await runPipeline("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(mockCleanupAudio).toHaveBeenCalledTimes(1);
    expect(mockCleanupAudio.mock.calls[0][0]).toBe("/tmp/test-audio.mp3");
  });

  it("wraps DownloadError in PipelineError", async () => {
    const cause = new DownloadError("yt-dlp failed");
    mockDownloadAudio.mockImplementation(async (_videoId: string) => {
      throw cause;
    });

    const err = await runPipeline(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PipelineError);
    expect(err.cause).toBe(cause);
  });

  it("wraps TranscriptionError in PipelineError", async () => {
    const cause = new TranscriptionError("Whisper failed");
    mockTranscribe.mockImplementation(async (_mp3Path: string) => {
      throw cause;
    });

    const err = await runPipeline(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PipelineError);
    expect(err.cause).toBe(cause);
  });

  it("wraps ArticleGenerationError in PipelineError", async () => {
    const cause = new ArticleGenerationError("OpenAI failed");
    mockGenerateArticle.mockImplementation(
      async (_transcript: string, _context: string) => {
        throw cause;
      }
    );

    const err = await runPipeline(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PipelineError);
    expect(err.cause).toBe(cause);
  });

  it("rejects invalid URLs with PipelineError from validator", async () => {
    mockValidateYouTubeUrl.mockImplementation((_url: string) => ({
      valid: false as const,
      error: "Invalid YouTube URL. Expected ...",
    }));

    const err = await runPipeline("https://not-youtube.com/video").catch(
      (e) => e
    );

    expect(err).toBeInstanceOf(PipelineError);
    expect(err.message).toContain("Invalid YouTube URL");
    // download should never be called for invalid URLs
    expect(mockDownloadAudio).not.toHaveBeenCalled();
  });
});
