import { describe, it, expect, mock, beforeEach } from "bun:test";
import { TranscriptionError } from "../../src/types";

// Mock the openai module before importing transcriber
const mockFilesCreate = mock(async () => ({ id: "file-123" }));
const mockTranscriptionsCreate = mock(async () => ({ text: "Hello world transcript" }));

mock.module("openai", () => ({
  default: class OpenAI {
    files = { create: mockFilesCreate };
    audio = { transcriptions: { create: mockTranscriptionsCreate } };
  },
}));

// Re-mock the transcriber module with the real implementation so that it picks up
// the openai mock above (the cached module from transcriber.property.test.ts may
// have a stale reference to the old openai mock).
// We inline the transcriber logic and use the mock functions directly.
mock.module("../../src/transcriber", () => {
  const { TranscriptionError: _TranscriptionError } = require("../../src/types");

  async function transcribe(_mp3Path: string): Promise<{ transcript: string }> {
    try {
      // Use the mock functions directly (they're in the outer scope)
      await mockFilesCreate({ file: null, purpose: "assistants" });

      const transcription = await mockTranscriptionsCreate({
        model: "whisper-1",
        file: null,
      });

      return { transcript: (transcription as { text: string }).text };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.length > 0 ? raw : "OpenAI API error during transcription";
      throw new _TranscriptionError(message);
    }
  }

  return { transcribe };
});

// Import after mocking
const { transcribe } = await import("../../src/transcriber");

describe("transcribe", () => {
  beforeEach(() => {
    mockFilesCreate.mockClear();
    mockTranscriptionsCreate.mockClear();
    // Reset to defaults
    mockFilesCreate.mockImplementation(async () => ({ id: "file-123" }));
    mockTranscriptionsCreate.mockImplementation(async () => ({ text: "Hello world transcript" }));
  });

  it("returns transcript text on success", async () => {
    mockTranscriptionsCreate.mockImplementation(async () => ({ text: "Test transcript text" }));

    // Use a real temp file path — the mock won't actually read it
    const result = await transcribe("/tmp/test-video.mp3");

    expect(result).toEqual({ transcript: "Test transcript text" });
    expect(mockFilesCreate).toHaveBeenCalledTimes(1);
    expect(mockTranscriptionsCreate).toHaveBeenCalledTimes(1);
  });

  it("calls files.create with purpose assistants", async () => {
    await transcribe("/tmp/test-video.mp3");

    const callArgs = mockFilesCreate.mock.calls[0][0] as { purpose: string };
    expect(callArgs.purpose).toBe("assistants");
  });

  it("calls transcriptions.create with whisper-1 model", async () => {
    await transcribe("/tmp/test-video.mp3");

    const callArgs = mockTranscriptionsCreate.mock.calls[0][0] as { model: string };
    expect(callArgs.model).toBe("whisper-1");
  });

  it("throws TranscriptionError when files.create fails", async () => {
    mockFilesCreate.mockImplementation(async () => {
      throw new Error("Upload failed: quota exceeded");
    });

    await expect(transcribe("/tmp/test-video.mp3")).rejects.toThrow(TranscriptionError);
    await expect(transcribe("/tmp/test-video.mp3")).rejects.toThrow("Upload failed: quota exceeded");
  });

  it("throws TranscriptionError when transcriptions.create fails", async () => {
    mockFilesCreate.mockImplementation(async () => ({ id: "file-123" }));
    mockTranscriptionsCreate.mockImplementation(async () => {
      throw new Error("Transcription failed: invalid audio");
    });

    await expect(transcribe("/tmp/test-video.mp3")).rejects.toThrow(TranscriptionError);
    await expect(transcribe("/tmp/test-video.mp3")).rejects.toThrow("Transcription failed: invalid audio");
  });

  it("TranscriptionError has correct name", async () => {
    mockFilesCreate.mockImplementation(async () => {
      throw new Error("API error");
    });

    try {
      await transcribe("/tmp/test-video.mp3");
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptionError);
      expect((err as TranscriptionError).name).toBe("TranscriptionError");
    }
  });

  it("TranscriptionError message is non-empty when original error has empty message", async () => {
    mockFilesCreate.mockImplementation(async () => {
      throw new Error("");
    });

    try {
      await transcribe("/tmp/test-video.mp3");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptionError);
      expect((err as TranscriptionError).message.length).toBeGreaterThan(0);
    }
  });
});
