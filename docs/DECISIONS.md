# Engineering Decisions — TubeScribe

<!--
This is not user documentation. This is for technical interviewers
and senior engineers who want to understand WHY the system is built
the way it is.
-->

---

## Decision 1 — Supadata API over direct YouTube caption fetching

**Context:** YouTube blocks transcript requests originating from datacenter IPs (Vercel, Railway, Fly.io). The `youtube-transcript` npm package works fine on localhost but fails in production because YouTube 429s or 403s datacenter ranges.

**Decision:** Use the Supadata API as the primary transcript source. Supadata routes requests through residential proxies, making caption fetches work from any hosting environment without a VPN or proxy setup on the server side.

**Reason:** Eliminates the most common production failure mode (captions unavailable) without requiring the operator to maintain a proxy or pay for a VPN. The `@supadata/js` SDK handles async job polling for long videos automatically.

**Tradeoff:** Adds a third-party API dependency and a paid API key requirement. Also adds latency for long videos that return a `jobId` rather than an immediate result (polling loop with 2-second intervals). The Whisper audio fallback exists precisely because Supadata can still fail.

---

## Decision 2 — Groq Whisper audio fallback with yt-dlp

**Context:** Some YouTube videos have no captions at all (live recordings, auto-captions disabled, private uploads). The caption path fails silently; without a fallback, those videos produce no output.

**Decision:** When Supadata throws, the pipeline downloads the best audio stream via `yt-dlp`, converts to MP3 via ffmpeg, and passes the file to Groq Whisper-large-v3-turbo for transcription.

**Reason:** Groq Whisper is faster and cheaper than OpenAI Whisper at equivalent accuracy. Running it as a fallback — not the primary path — means the extra container weight (yt-dlp, ffmpeg, Deno runtime) only matters when captions are unavailable.

**Tradeoff:** The Docker image is significantly larger due to ffmpeg, Deno (required as yt-dlp's JS runtime), and yt-dlp. Cold starts are slower. The fallback also adds 10-20 seconds to pipeline time and depends on yt-dlp keeping pace with YouTube's format changes.

---

## Decision 3 — SSE (Server-Sent Events) over WebSockets for progress streaming

**Context:** The pipeline takes 5-30 seconds; the browser needs to show real-time progress without polling. The choices were SSE, WebSockets, or long-polling.

**Decision:** Use SSE via a `ReadableStream` passed directly to `new Response()` in Bun's HTTP server.

**Reason:** The pipeline is a unidirectional server-to-client stream — there is no data the browser needs to send after the initial POST. SSE fits this model exactly, requires no separate WebSocket server or upgrade handshake, and is natively supported in Bun without additional libraries. The `ReadableStream` + `Response` pattern lets the same request that carries the YouTube URL also stream the progress events.

**Tradeoff:** SSE does not support binary frames; the pipeline result (article text and source URLs) must be JSON-encoded in the `data:` field. For this use case that's fine. SSE also reconnects automatically on disconnect, which could cause duplicate pipeline runs if the client reconnects mid-job — acceptable risk at this scale, but would need a job-ID deduplication layer in v2.

---

## Decision 4 — LLM output via structured XML prompt, not JSON mode

**Context:** The article generator needs consistent structure (title, intro, sections) that the frontend can parse and render reliably. The options were: free-form text, JSON mode, or a custom XML schema.

**Decision:** System prompt mandates a strict XML format (`<TITLE>`, `<INTRO>`, `<SECTION>/<HEADING>/<BODY>`), parsed with regex on the server before delivering plain text to the browser.

**Reason:** JSON mode in Groq's LLaMA models is less reliable at preserving long prose (it tends to escape or truncate). XML tags are less ambiguous than markdown headers when the content itself contains markdown-like text. Regex parsing of known XML tags is deterministic; a JSON parser on model output can throw on malformed escapes.

**Tradeoff:** If the model ignores the XML tags entirely, the fallback parser tries to reconstruct paragraph structure from plain text — which is less reliable than a proper JSON schema validator. The retry-with-continuation-prompt strategy mitigates this but adds latency on the rare failure path.

---

## Decision 5 — PDF generation via Puppeteer in the same container

**Context:** The app needed a "Export to PDF" feature. Options: client-side `window.print()`, a serverless function calling a PDF library (pdfmake, jsPDF), or server-side headless Chrome.

**Decision:** Puppeteer-core + Chromium running inside the same Docker container renders the article HTML and returns a binary PDF.

**Reason:** Client-side `window.print()` produces inconsistent output across browsers and cannot control fonts or layout reliably. pdfmake and jsPDF require reimplementing the entire article layout in a PDF-specific API. Puppeteer renders the same HTML/CSS as the browser — the PDF looks exactly like the page, dark theme and all, with zero layout duplication.

**Tradeoff:** Adds Chromium to the Docker image (+300MB), increasing image size and memory usage. Each PDF request spawns and tears down a browser instance — not suitable for high concurrency, but acceptable for an on-demand export button.

---

## What I'd do differently in v2

- **Persistent job store** — instead of a stateless pipeline, use a queue (BullMQ or Bun's native queue when stable) backed by Redis or Postgres, so jobs survive server restarts and users can retrieve their article later.
- **Article caching by video ID** — the same video URL always produces similar output; caching in a database would eliminate repeat API spend for popular videos.
- **Chromium sidecar** — move Puppeteer to a dedicated container or serverless function (Browserless, etc.) instead of bundling it in the main image, keeping the core image lean.
- **Proper token budgeting** — currently the article generator has a word-count heuristic; in v2, count actual tokens before the Groq call and trim the input rather than the output.

---

## Explicit non-decisions (deferred to v2)

| Feature | Why deferred |
|---|---|
| User accounts and article history | Requires a database, auth provider, and session management — adds significant operational complexity for an MVP that can run stateless |
| Webhook / public API | No external integrations targeted in v1; the web UI is the product |
| Playlist / batch mode | Single-video scope makes latency predictable and rate-limiting trivial; batch requires a queue |
| Multi-language output | LLaMA always writes in English — acceptable for v1; locale-aware prompting is a v2 feature |
