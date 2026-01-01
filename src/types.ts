// Request / Response types
export interface GenerateRequest {
  url: string;
}

export interface GenerateResponse {
  article: string;
}

export interface ErrorResponse {
  error: string;
}

// Internal pipeline types
export interface DownloadResult {
  mp3Path: string;
}

export interface TranscriptResult {
  transcript: string;
}

export interface EnrichResult {
  context: string;
  sources: string[];
}

export interface ArticleResult {
  article: string;
}

// Environment configuration
export interface AppConfig {
  port: number;
  serperApiKey: string;
  firecrawlApiKey: string;
  groqApiKey: string;
  youtubeApiKey: string;
  supadataApiKey: string;
}

// Error types
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export class ArticleGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleGenerationError";
  }
}

export class PipelineError extends Error {
  cause: DownloadError | TranscriptionError | ArticleGenerationError | Error;

  constructor(
    message: string,
    cause: DownloadError | TranscriptionError | ArticleGenerationError | Error
  ) {
    super(message);
    this.name = "PipelineError";
    this.cause = cause;
  }
}
