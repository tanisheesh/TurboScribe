<p align="center">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="#0a0a0f"/>
    <text x="16" y="22" text-anchor="middle"
      font-family="monospace" font-weight="700" font-size="14"
      fill="url(#g)">TS</text>
  </svg>
</p>

<h1 align="center">TurboScribe</h1>

<p align="center">
  <strong>Turn any YouTube video into a clean, concise article — instantly.</strong>
</p>

<p align="center">
  <a href="https://turboscribe.tanisheesh.in">
    <img src="https://img.shields.io/badge/live_demo-a855f7-a855f7?style=flat-square" alt="Live Demo">
  </a>
  <img src="https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/Groq-F55036?style=flat-square" alt="Groq">
  <img src="https://img.shields.io/badge/license-GPL--3.0-a855f7?style=flat-square" alt="License">
</p>

---

## What is TubeScribe?

TubeScribe takes any YouTube URL and produces a polished, under-300-word article in seconds — no signup, no manual steps. It fetches the video's captions via the Supadata API (which uses residential proxies to bypass datacenter IP blocks), enriches the transcript with relevant web context from Serper and Firecrawl, then sends everything to LLaMA 3.3-70B on Groq to write a clean, structured article. Videos in any language are automatically translated to English. The result can be viewed in the browser or downloaded as a formatted PDF.

> **Live demo →** [turboscribe.tanisheesh.in](https://turboscribe.tanisheesh.in)

---

## What you get

- **Multi-language transcription** — captions fetched via Supadata for any language; Groq Whisper is the automatic fallback for videos with no captions.
- **Web enrichment** — Serper.dev finds relevant sources, Firecrawl extracts clean text, up to 8 000 chars of context passed to the LLM.
- **AI article generation** — LLaMA 3.3-70B on Groq writes a structured 220-300-word English article; retries with stricter prompting if XML output format is not met.
- **SSE streaming** — real-time progress events (download → transcribe → enrich → generate) displayed in the browser; no polling needed.
- **PDF export** — Puppeteer renders the article into a branded A4 PDF downloadable from the browser.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun 1 (TypeScript, ESM) |
| Server | Bun built-in HTTP server |
| Transcription | Supadata API (primary) · Groq Whisper-large-v3-turbo (fallback) |
| Audio download | yt-dlp + ffmpeg (fallback path only) |
| Web enrichment | Serper.dev (search) · Firecrawl (web scraping) |
| AI | Groq · LLaMA 3.3-70B |
| PDF | Puppeteer-core + Chromium |
| Testing | Bun test · fast-check (property-based) |
| Infra | Docker (single container) |

---

## Engineering Decisions

**Why Supadata over direct YouTube caption fetching?**
YouTube blocks transcript requests from datacenter IPs (Vercel, Railway, etc.). Supadata routes through residential proxies, making the primary caption path work reliably in any hosted environment without requiring yt-dlp at all.

**Why SSE over WebSockets for progress updates?**
The pipeline is a one-way server-to-client stream with four discrete steps. SSE is simpler to implement and operate than WebSockets, requires no persistent connection management, and fits the request-response model of a Bun HTTP server natively.

**Why LLaMA 3.3-70B via Groq over the OpenAI API?**
Groq's inference is significantly faster (sub-second token generation) and free at this scale, which matters for a no-signup demo. The project still imports the `openai` package for SDK compatibility, but all calls route to Groq.

**What would you do differently in v2?**
Add a proper job queue (BullMQ or Bun's native queue when stable) so long-running pipeline jobs survive server restarts, and store generated articles in a database so users can revisit them without regenerating.

---

## Docs

| Document | Description |
|---|---|
| [PRD](docs/PRD.md) | Product requirements — goals, user stories, non-goals |
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, component breakdown |
| [Decisions](docs/DECISIONS.md) | Every major technical decision and why |
| [Setup](docs/SETUP.md) | Local dev setup, env vars, deployment |

---

## Author

**Tanish Poddar** — [tanisheesh.in](https://tanisheesh.in) · [LinkedIn](https://linkedin.com/in/tanisheesh) · [GitHub](https://github.com/tanisheesh)
