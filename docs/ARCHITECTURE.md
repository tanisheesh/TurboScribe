# TubeScribe — Architecture

<!--
Companion to PRD.md.
PRD says WHAT the system does. This says HOW.
Audience: an engineer who needs to understand the system well
enough to build it, debug it, or extend it.
-->

---

## 1. Stack

| Layer | Tech |
|---|---|
| Runtime | Bun 1 (TypeScript, ESM modules) |
| Server | Bun built-in HTTP server (`Bun.serve`) |
| Transcription (primary) | Supadata API v1 — residential-proxy YouTube caption fetch |
| Transcription (fallback) | Groq Whisper-large-v3-turbo via audio download |
| Audio download | yt-dlp + ffmpeg (fallback path only) |
| Web enrichment | Serper.dev (Google search API) · Firecrawl v1 (web scraping) |
| AI / LLM | Groq · LLaMA 3.3-70B-Versatile |
| PDF generation | Puppeteer-core + Chromium (headless) |
| Testing | Bun test · fast-check (property-based) |
| Hosting | Docker (single container, port 3000) |

---

## 2. Components

```
src/
  server.ts          HTTP server — routing, rate limiting, SSE, PDF endpoint
  pipeline.ts        Orchestrates the four-step transcript-to-article pipeline
  validator.ts       YouTube URL validation — extracts video ID, rejects bad input
  transcriber.ts     Supadata caption fetch (primary) + Groq Whisper (fallback)
  downloader.ts      yt-dlp audio download — only invoked when captions unavailable
  enricher.ts        Keyword extraction → Serper search → Firecrawl scrape
  articleGenerator.ts  LLaMA 3.3-70B call — structured XML prompt, parse, trim
  config.ts          Reads env vars into a typed AppConfig object
  types.ts           Shared interfaces and typed error classes
```

### server.ts

Bun's built-in HTTP server handles all routing. Serves static files from `/public`, exposes a Server-Sent Events endpoint (`POST /generate-stream`) for the browser, a plain JSON endpoint (`POST /generate`) kept for tests, and a PDF export endpoint (`POST /export-pdf`). Applies an in-memory per-IP rate limiter (5 requests/min, cleaned every 5 min) before touching the pipeline. Does not perform any article-generation work inline — delegates immediately to `runPipeline`.

### pipeline.ts

The orchestration layer. Validates the URL, then runs four steps in sequence: transcribe (captions), optionally download then transcribe (audio), enrich, generate. Accepts an optional `ProgressCallback` so the server can stream step names to the client via SSE without the pipeline knowing about HTTP.

### transcriber.ts

Two strategies exposed as separate functions. `transcribeFromCaptions` calls the Supadata API, which uses residential proxies to bypass YouTube's datacenter IP blocks; handles async job polling for long videos. `transcribeFromAudio` calls Groq Whisper-large-v3-turbo with up to 3 retries on 5xx errors. The pipeline tries captions first; audio is the fallback.

### downloader.ts

Calls `yt-dlp` as a subprocess to download the best audio stream, converts to MP3 via ffmpeg, saves to the OS temp directory. Validates the video ID against a safelist regex before constructing the command — no shell injection possible. Cleans up the MP3 after transcription.

### enricher.ts

Extracts the top 6 most frequent non-stop words from the transcript as a search query, calls Serper.dev, then Firecrawl-scrapes the top 3 organic results for clean markdown. Accumulates up to 8 000 chars of context (to avoid blowing LLM context). Enrichment failures are swallowed — the pipeline continues with an empty context rather than erroring.

### articleGenerator.ts

Calls LLaMA 3.3-70B on Groq with a strict XML-structured system prompt (TITLE / INTRO / SECTION tags). Parses the XML response into plain text. If the model returns plain paragraphs instead of XML, retries once with a stricter prompt continuation. Trims output to max 300 words, ending at a sentence boundary. Returns the best result after up to 3 attempts.

---

## 3. Data Flow

```
[Browser] POST /generate-stream { url }
  → server.ts: rate-limit check → runPipeline(url, onProgress)
      → validator.ts: extract videoId or throw
      → transcriber.ts: Supadata API → transcript string
          (on failure) → downloader.ts: yt-dlp → mp3Path
                       → transcriber.ts: Groq Whisper → transcript string
      → enricher.ts: extractQuery → Serper.dev → Firecrawl × 3 → context + sources[]
      → articleGenerator.ts: Groq LLaMA 3.3-70B → article string
  → SSE stream: progress events ("transcribe", "enrich", "generate") + final "done" event
[Browser] renders article + sources, offers PDF download button

[Browser] POST /export-pdf { article, sources }
  → server.ts: Puppeteer renders branded HTML → PDF binary → attachment download
```

1. Browser POSTs the YouTube URL to `/generate-stream`; server opens an SSE stream.
2. Pipeline validates URL and extracts the video ID.
3. Supadata fetches captions; on failure, yt-dlp downloads audio and Groq Whisper transcribes.
4. Enricher derives a search query, fetches top-3 web results, trims to 8 000 chars.
5. LLaMA 3.3-70B writes a 220-300-word XML-structured article in English; parser flattens to plain text.
6. SSE `done` event delivers `{ article, sources }` to the browser.
7. User optionally clicks "Export PDF" — browser POSTs article text to `/export-pdf`, receives a formatted A4 PDF.

---

## 4. API Routes

| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Serves `public/index.html` — landing page |
| `GET` | `/generate-page` | Serves `public/generate.html` — article generation UI |
| `GET` | `/favicon.svg` | Serves the project SVG favicon |
| `POST` | `/generate-stream` | SSE — streams pipeline progress events then final article |
| `POST` | `/generate` | JSON — same pipeline, synchronous, used by integration tests |
| `POST` | `/export-pdf` | Puppeteer renders article + sources to A4 PDF, returns binary |

---

## 5. AI / LLM Design

### Input

Structured plain text: `Transcript:\n{transcript}\n\nSupplementary context:\n{context}`. Never raw HTML or untrusted web content in the `user` turn — context is extracted markdown from Firecrawl, which strips scripts and ads.

### System prompt strategy

Instructs the model to always write in English regardless of transcript language (handles Hindi, Chinese, Spanish, etc.). Mandates a strict XML output format (`<TITLE>`, `<INTRO>`, `<SECTION>/<HEADING>/<BODY>`). Word count target 220-270. No markdown (`**`, `##`). Output ONLY the XML structure — nothing else.

### Response schema

```
<TITLE>Article title</TITLE>
<INTRO>2-3 sentence intro paragraph.</INTRO>
<SECTION>
  <HEADING>Section Heading</HEADING>
  <BODY>2-4 sentence body paragraph.</BODY>
</SECTION>
```

### Validation

Regex-parsed XML tags. If `<TITLE>` and `<SECTION>` are not both present, treated as a formatting failure. On failure, the model is prompted with a continuation message asking it to reformat into the XML structure. Falls back to sentence-boundary paragraph splitting if XML parsing still yields nothing.

### Failure handling

Up to 3 generation attempts. Each attempt checks word count (200-300 range). If after 3 attempts the word count is still outside range, the best result so far is returned anyway. ArticleGenerationError is thrown only on Groq API-level failures (network, 5xx).

---

## 6. Security

- **API keys:** All keys (`GROQ_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, `SUPADATA_API_KEY`) read from env vars only. No keys committed to source. `.env` is gitignored.
- **Shell injection:** `downloadAudio` validates `videoId` against `/^[a-zA-Z0-9_-]{1,64}$/` before constructing the yt-dlp command. Non-matching IDs are rejected with a `DownloadError`.
- **Rate limiting:** In-memory per-IP counter — 5 requests per 60-second window. Returns HTTP 429 before touching the pipeline.
- **Input validation:** YouTube URL validated with strict regex before any external API is called; non-matching URLs are rejected with a typed `PipelineError`.
- **PDF rendering:** Puppeteer runs with `--no-sandbox` inside Docker (standard practice in containerised CI). Article content is JSON-serialised into the HTML as a string literal — no arbitrary HTML injection.

---

## 7. Error Handling & Reliability

| Failure | Behaviour |
|---|---|
| Supadata caption fetch fails | Falls back to yt-dlp download + Groq Whisper automatically |
| Groq Whisper 5xx | Retried up to 3 times with 2s delay; throws `TranscriptionError` after exhaustion |
| Serper / Firecrawl fails | Enrichment returns `{ context: "", sources: [] }` — pipeline continues with no web context |
| LLM returns plain text instead of XML | One retry with stricter continuation prompt; falls back to sentence-split paragraphs |
| LLM API error | Throws `ArticleGenerationError` — SSE sends `error` event to browser |
| PDF Puppeteer error | Returns HTTP 500 JSON; browser shows error — does not crash the server |
| Rate limit exceeded | Returns HTTP 429 before pipeline starts; SSE stream is never opened |

---

## 8. Deployment

1. Single Docker image built from `oven/bun:1` base — includes Bun, yt-dlp, ffmpeg, Deno (yt-dlp JS runtime), and Chromium (for PDF).
2. Container exposes port 3000; `Bun.serve` listens on `process.env.PORT` (defaults to 3000).
3. All env vars (`GROQ_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, `SUPADATA_API_KEY`) injected at container runtime — not baked into the image.
4. No database, no migrations, no persistent state — fully stateless container, deployable to any container host (Railway, Fly.io, etc.).

---

## 9. Explicit Scope Cuts

- **User accounts / history** — no database in v1; articles are ephemeral. Would require Postgres + auth for v2.
- **Playlist / batch processing** — single-video scope keeps the pipeline simple and the rate limiter trivial.
- **Real-time collaboration** — the app is single-user per generation; no shared state needed.
- **Caching generated articles** — same URL could regenerate differently due to LLM temperature; deferred until a database exists.
