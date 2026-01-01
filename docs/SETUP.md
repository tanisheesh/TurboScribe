# Local Setup — TurboScribe

> **Just want to try it?** Use the live demo at [turboscribe.tanisheesh.in](https://turboscribe.tanisheesh.in) — no setup needed.
> This guide is for running TurboScribe locally or self-hosting it.

---

## Prerequisites

- **Bun 1.x** — [bun.sh](https://bun.sh) (runtime, package manager, test runner)
- **Docker + Docker Compose** — required for the audio fallback path (yt-dlp, ffmpeg, Chromium for PDF)
- API keys for: Groq, Supadata, Serper.dev, Firecrawl (see env vars below)

> The audio-download fallback and PDF export require yt-dlp, ffmpeg, and Chromium — these are only available inside Docker. Running `bun run start` outside Docker works for the caption path and article generation, but audio fallback and PDF export will fail.

---

## 1. Clone and install

```bash
git clone https://github.com/tanisheesh/TurboScribe
cd TurboScribe
bun install
```

---

## 2. Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) → API Keys |
| `SUPADATA_API_KEY` | [supadata.ai](https://supadata.ai) → Dashboard → API Keys |
| `SERPER_API_KEY` | [serper.dev](https://serper.dev) → Dashboard → API Key |
| `FIRECRAWL_API_KEY` | [firecrawl.dev](https://firecrawl.dev) → Dashboard → API Keys |
| `PORT` | Optional — defaults to `3000` |
| `YT_DLP_PATH` | Optional — defaults to `yt-dlp` on PATH (Docker sets this automatically) |
| `FFMPEG_DIR` | Optional — directory containing ffmpeg binary (Docker sets this automatically) |
| `CHROMIUM_PATH` | Optional — path to Chromium executable (Docker sets this to `/usr/bin/chromium`) |

---

## 3. Run locally (caption path only, no Docker)

```bash
bun run start
```

TurboScribe will be running at `http://localhost:3000`.

> Audio fallback and PDF export will fail without yt-dlp/ffmpeg/Chromium. Use Docker for full functionality.

---

## 4. Run with Docker (full functionality)

```bash
docker build -t tubescribe .
docker run -p 3000:3000 \
  -e GROQ_API_KEY=your_key \
  -e SUPADATA_API_KEY=your_key \
  -e SERPER_API_KEY=your_key \
  -e FIRECRAWL_API_KEY=your_key \
  tubescribe
```

TurboScribe will be running at `http://localhost:3000`.

---

## 5. Run tests

```bash
bun test
```

Tests are organised in three layers:

| Directory | Type | Coverage |
|---|---|---|
| `tests/unit/` | Unit tests | Each module in isolation with mocked dependencies |
| `tests/property/` | Property-based tests (fast-check) | Invariant checks across generated inputs |
| `tests/integration/` | Integration tests | Full `runPipeline` with mocked external APIs |

---

## 6. Deploy to production

The recommended deployment is a single Docker container on any container host (Railway, Fly.io, Render, etc.).

1. Build and push the image to your container registry.
2. Set the five env vars (`GROQ_API_KEY`, `SUPADATA_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, and optionally `PORT`) in the host's environment configuration.
3. Expose port 3000 (or whatever `PORT` is set to).
4. No database migrations, no persistent volumes required — the container is fully stateless.

---

## Known local-only limitations

- **Audio download fallback** — requires `yt-dlp` and `ffmpeg` on PATH. Not available outside Docker on most developer machines.
- **PDF export** — requires Chromium. Set `CHROMIUM_PATH` to your local Chromium binary, or use Docker.
- **Supadata rate limits** — the free tier has a monthly transcript quota. Shared across all requests if self-hosting without per-user isolation.
