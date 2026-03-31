import { validateYouTubeUrl } from "./validator";
import { downloadAudio, cleanupAudio } from "./downloader";
import { transcribeFromCaptions, transcribeFromAudio } from "./transcriber";
import { enrich } from "./enricher";
import { generateArticle } from "./articleGenerator";
import { PipelineError } from "./types";

export type PipelineStep = "download" | "transcribe" | "enrich" | "generate";
export type ProgressCallback = (step: PipelineStep) => void;

export async function runPipeline(
  url: string,
  onProgress?: ProgressCallback
): Promise<{ article: string; sources: string[] }> {
  const validation = validateYouTubeUrl(url);
  if (!validation.valid) {
    throw new PipelineError(validation.error, new Error(validation.error));
  }

  const { videoId } = validation;

  // Step 1 & 2: Transcribe — try captions first, fallback to Whisper
  onProgress?.("download");
  onProgress?.("transcribe");

  let transcript: string;

  try {
    // Fast path: YouTube captions
    const result = await transcribeFromCaptions(videoId);
    transcript = result.transcript;
    console.log("[pipeline] Used YouTube captions");
  } catch (captionErr) {
    // Fallback: download audio + Groq Whisper
    console.log("[pipeline] Captions unavailable, falling back to Whisper:", (captionErr as Error).message);

    let mp3Path: string;
    try {
      const result = await downloadAudio(videoId);
      mp3Path = result.mp3Path;
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new PipelineError(`Download failed: ${cause.message}`, cause);
    }

    try {
      const result = await transcribeFromAudio(mp3Path);
      transcript = result.transcript;
      console.log("[pipeline] Used Groq Whisper fallback");
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new PipelineError(`Transcription failed: ${cause.message}`, cause);
    } finally {
      await cleanupAudio(mp3Path!).catch((e: unknown) => {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") console.error("[pipeline] Failed to clean up MP3:", e);
      });
    }
  }

  // Step 3: Enrich
  onProgress?.("enrich");
  const { context, sources } = await enrich(transcript);

  // Step 4: Generate article
  onProgress?.("generate");
  try {
    const result = await generateArticle(transcript, context);
    return { article: result.article, sources };
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new PipelineError(`Article generation failed: ${cause.message}`, cause);
  }
}
