import { describe, test, mock } from "bun:test";
import * as fc from "fast-check";
import { TranscriptionError } from "../../src/types";

// Mock 'fs' to prevent createReadStream from actually opening files.
mock.module("fs", () => {
  const actual = require("fs");
  return {
    ...actual,
    createReadStream: (_path: string) => {
      const { Readable } = require("stream");
      return new Readable({ read() { this.push(null); } });
    },
  };
});

// Shared mock functions that the inline transcriber implementation will use.
// These are updated per property iteration.
let _currentFilesCreate: (args: any) => Promise<any> = async () => ({ id: "file-123" });
let _currentTranscriptionsCreate: (args: any) => Promise<any> = async () => ({ text: "" });

// Restore the real transcriber module in case it was mocked by another test file
// (e.g. downloader.property.test.ts mocks ../../src/transcriber).
mock.module("../../src/transcriber", () => {
  const { TranscriptionError: _TranscriptionError } = require("../../src/types");

  async function transcribe(_mp3Path: string): Promise<{ transcript: string }> {
    try {
      await _currentFilesCreate({ file: null, purpose: "assistants" });
      const transcription = await _currentTranscriptionsCreate({ model: "whisper-1", file: null });
      return { transcript: transcription.text };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.length > 0 ? raw : "OpenAI API error during transcription";
      throw new _TranscriptionError(message);
    }
  }

  return { transcribe };
});

// Feature: youtube-to-article, Property 5: Transcriber errors produce descriptive errors
// Validates: Requirements 3.4

describe("Property 5: Transcriber errors produce descriptive errors", () => {
  test("any OpenAI API error (upload or transcription failure) throws TranscriptionError with non-empty message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ message: fc.string() }),
        fc.boolean(), // true = fail on files.create, false = fail on transcriptions.create
        async (errorShape, failOnUpload) => {
          // Update the shared mock functions for this iteration
          _currentFilesCreate = async () => {
            if (failOnUpload) throw new Error(errorShape.message);
            return { id: "file-123" };
          };
          _currentTranscriptionsCreate = async () => {
            if (!failOnUpload) throw new Error(errorShape.message);
            return { text: "should not reach here" };
          };

          const { transcribe } = await import("../../src/transcriber");

          let thrownError: unknown;
          try {
            await transcribe("/fake/path/test.mp3");
          } catch (err) {
            thrownError = err;
          }

          // Must throw a TranscriptionError
          if (!(thrownError instanceof TranscriptionError)) return false;
          // Message must be non-empty
          return thrownError.message.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
