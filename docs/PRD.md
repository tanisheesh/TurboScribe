# TubeScribe — Product Requirements Document

**Status:** Final
**Owner:** Tanish Poddar
**One-liner:** Turn any YouTube video into a clean, concise English article in seconds — no signup required.

---

## 1. Problem

Reading is faster than watching. A 20-minute YouTube video contains maybe 2 500 words of actual information, but most people don't have 20 minutes — they want the key ideas in 90 seconds. Existing solutions either require a paid account, produce walls of raw transcript text with no editing, or fail entirely on videos from non-English channels. TubeScribe solves this: paste a link, get a polished article, export to PDF if needed.

---

## 2. Goals (v1 / MVP)

1. Accept any valid YouTube URL (standard `watch?v=` and short `youtu.be/` formats).
2. Retrieve a transcript reliably from hosted environments — not just localhost — including videos where YouTube blocks datacenter IP caption requests.
3. Support videos in any language; always produce English output.
4. Enrich the article with relevant web context, not just the raw transcript.
5. Generate a well-structured article of 220-300 words using an LLM — no signup, no cost to the user.
6. Stream real-time progress to the browser so the user knows the pipeline is running.
7. Export the article as a formatted A4 PDF.
8. Deployed with a working live demo URL, zero configuration required from the visitor.

---

## 3. Non-Goals (explicit scope cuts)

- **User accounts or article history** — storing generated articles requires a database and auth; deferred to v2. Articles are ephemeral.
- **Playlist or batch processing** — single-video scope keeps latency predictable and the rate limiter simple.
- **Paid / metered tiers** — v1 is free and rate-limited by IP; billing infrastructure is out of scope.
- **Webhook or API access** — the product is a web UI; a public API for third-party integration is a v2 concern.
- **Mobile app** — the web UI is responsive; a native app adds distribution overhead with no clear v1 benefit.

---

## 4. Users

**Primary:** Anyone who wants to quickly digest a YouTube video's content — students, researchers, professionals scanning for relevant information — without having to watch the whole video.

**Secondary:** Recruiters and engineers evaluating this as a portfolio piece; they need the live demo to work on real YouTube URLs without any setup.

---

## 5. User Stories

1. *As a user,* I paste a YouTube URL and click generate so that I receive a clean article without watching the video.
2. *As a user,* I watch a real-time progress indicator (download → transcribe → enrich → generate) so that I know the pipeline is running and haven't lost my request.
3. *As a user,* I paste a URL for a Hindi or Chinese YouTube video so that I still get an article written in English.
4. *As a user,* I click "Export PDF" so that I can download a formatted, printable version of the article to share or file.
5. *As a user,* I paste a YouTube URL from a video with no captions so that the system falls back to audio transcription and still produces an article.
6. *As a developer,* I run the Docker image with my own API keys so that I can self-host TubeScribe without code changes.

---

## 6. Functional Requirements

### 6.1 URL Validation

- The system must accept both `https://www.youtube.com/watch?v=VIDEO_ID` and `https://youtu.be/VIDEO_ID` formats.
- Any other URL format must be rejected with a clear error message before any external API is called.
- The video ID must be extracted and validated against `[a-zA-Z0-9_-]{1,64}` before being passed to downstream services.

### 6.2 Transcription

- The primary path must use the Supadata API to fetch YouTube captions — including videos where direct datacenter requests are blocked.
- Transcripts in any language must be passed as-is to the article generator, which handles translation.
- On Supadata failure, the system must automatically fall back to downloading audio via yt-dlp and transcribing with Groq Whisper-large-v3-turbo.
- Whisper failures must be retried up to 3 times with 2-second delays on 5xx errors.

### 6.3 Web Enrichment

- The enricher must extract a search query from the transcript using keyword frequency (excluding stop words).
- It must call Serper.dev to retrieve the top 3 organic search results.
- It must scrape each result with Firecrawl and accumulate up to 8 000 characters of clean markdown context.
- Enrichment failures must be non-fatal — the pipeline must continue with empty context rather than erroring.

### 6.4 Article Generation

- The LLM must be instructed to always write in English regardless of transcript language.
- The system prompt must mandate a strict XML structure: `<TITLE>`, `<INTRO>`, `<SECTION>/<HEADING>/<BODY>`.
- Generated articles must be 220-300 words. Articles outside this range must trigger a retry (up to 3 attempts).
- If the model returns plain text instead of XML, the system must retry with a stricter continuation prompt.
- The final article must be trimmed to a sentence boundary if over 300 words.

### 6.5 Streaming & UI

- Progress events must be streamed via Server-Sent Events with step names: `transcribe`, `download`, `enrich`, `generate`.
- A `done` event must deliver `{ article, sources }` as JSON.
- An `error` event must deliver `{ error: string }` on pipeline failure — the stream must not hang.
- Rate limiting must reject requests over 5 per IP per minute with HTTP 429 before the pipeline starts.

### 6.6 PDF Export

- The export endpoint must accept `{ article, sources }` and return a binary PDF.
- The PDF must render in A4 format with the TubeScribe branding (dark theme, Space Grotesk / Lora fonts).
- Sources must be listed with numbered references at the bottom of the PDF.

---

## 7. Non-Functional Requirements

- **Latency:** SSE first event within 2s of request receipt. End-to-end pipeline under 30s for a typical 10-minute video with captions.
- **Reliability:** No request silently hangs — every pipeline path either completes, emits an `error` SSE event, or times out at the server's 255-second idle timeout.
- **Security:** API keys in env vars only — never committed to source. Video ID validated against an allowlist regex before yt-dlp is invoked (no shell injection).
- **Cost:** Enrichment context capped at 8 000 chars; article word count capped at 300. A single request cannot generate runaway Groq token spend.
- **Accessibility:** Web UI is responsive (mobile-friendly). No login required — accessible to anyone with the URL.

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Live demo reliability | Caption path works on a standard YouTube URL with no setup |
| Multi-language coverage | Hindi / Chinese / Spanish videos produce English articles |
| End-to-end latency (caption path) | Under 15 seconds for a typical 10-minute video |
| PDF export | Renders without error; readable when printed |

---

## 9. Risks & Open Questions

- **YouTube blocking Supadata proxies** — residential proxy services can be blocked or rate-limited. Mitigated by the Whisper audio fallback, but the fallback adds 10-20 seconds and requires yt-dlp to be available in the container.
- **Groq rate limits on free tier** — on-demand calls (not per-page-load) reduce exposure. If the demo goes viral, the free tier could exhaust quickly; no mitigation beyond rate limiting in v1.
- **yt-dlp breaking changes** — YouTube frequently changes its streaming protocol. yt-dlp is updated regularly; the Docker image pins to the latest release at build time.
- **Open question:** Should article caching be added even without user accounts (keyed by video ID) to reduce repeat API spend?

---

## 10. v2 Candidates

- **Article history with user accounts** — store generated articles in Postgres so users can revisit them; requires auth (Clerk or similar).
- **Playlist / batch mode** — accept a YouTube playlist URL and generate articles for multiple videos in a queue.
- **Article length options** — let users choose between a brief summary (150 words) and a deeper article (500 words).
- **Custom export formats** — Markdown download, Notion import, plain text — in addition to PDF.
- **Shareable article links** — generate a public slug URL for each article so users can share directly.
