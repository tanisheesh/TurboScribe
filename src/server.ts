import { config } from "./config";
import { runPipeline } from "./pipeline";
import puppeteer from "puppeteer-core";

const publicDir = import.meta.dir + "/../public";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
};

// Simple in-memory rate limiter: max 5 requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

async function serveStatic(pathname: string): Promise<Response> {
  let filePath: string;
  if (pathname === "/") filePath = `${publicDir}/index.html`;
  else if (pathname === "/generate-page") filePath = `${publicDir}/generate.html`;
  else filePath = `${publicDir}${pathname}`;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not Found", { status: 404 });
    const ext = filePath.slice(filePath.lastIndexOf("."));
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    return new Response(file, { headers: { "Content-Type": contentType } });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// SSE streaming endpoint — streams progress events then final result
async function handleGenerateSSE(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("cf-connecting-ip")
    ?? "unknown";

  if (isRateLimited(ip)) {
    return Response.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ error: "Request body is missing or invalid JSON" }, { status: 400 });
  }

  if (
    body === null || typeof body !== "object" ||
    !("url" in body) ||
    typeof (body as Record<string, unknown>).url !== "string"
  ) {
    return Response.json({ error: "Missing required field: url" }, { status: 400 });
  }

  const { url } = body as { url: string };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const { article, sources } = await runPipeline(url, (step) => send("progress", { step }));
        send("done", { article, sources });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// PDF generation endpoint
async function handlePDF(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { article, sources } = body as { article: string; sources?: string[] };
  if (!article) return Response.json({ error: "Missing article" }, { status: 400 });

  const year = new Date().getFullYear();

  // Build sources HTML
  const sourcesHtml = sources && sources.length > 0
    ? `<div class="sources">
        <div class="sources-label">Sources</div>
        ${sources.map((url, i) => `<div class="source-item"><span class="source-num">[${i+1}]</span> <a href="${url}">${url}</a></div>`).join("")}
       </div>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Space+Mono:wght@400;700&family=Lora:wght@400;600&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #e2e8f0; font-family: 'Space Grotesk', sans-serif; padding: 0; }

  .page-header { text-align: center; padding: 18px 0 12px; border-bottom: 1px solid #1e1e2e; margin-bottom: 20px; }
  .site-name { font-family: 'Space Mono', monospace; font-size: 15pt; font-weight: 700; color: #a855f7; display: block; }
  .tagline { font-size: 8.5pt; color: #64748b; display: block; margin-top: 3px; }
  .divider { border: none; border-top: 1px solid #1e1e2e; margin: 14px 0; }

  .article-card { background: #111118; border: 1px solid #1e1e2e; border-radius: 8px; padding: 24px 28px; }
  .article-title { text-align: center; font-family: 'Space Grotesk', sans-serif; font-size: 15pt; font-weight: 700; color: #e2e8f0; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #1e1e2e; }
  .article-body { font-family: 'Lora', serif; font-size: 10pt; line-height: 1.85; color: #cbd5e1; }
  .article-body h2 { font-family: 'Space Grotesk', sans-serif; font-size: 10pt; font-weight: 700; color: #a855f7; margin: 14px 0 4px; }
  .article-body p { margin-bottom: 10px; }

  .sources { margin-top: 18px; padding-top: 12px; border-top: 1px solid #1e1e2e; }
  .sources-label { font-family: 'Space Mono', monospace; font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
  .source-item { font-size: 7.5pt; margin-bottom: 4px; word-break: break-all; }
  .source-num { color: #64748b; margin-right: 4px; }
  .source-item a { color: #06b6d4; text-decoration: none; }

  .page-footer { text-align: center; font-family: 'Space Mono', monospace; font-size: 7pt; color: #64748b; padding: 10px 0 0; border-top: 1px solid #1e1e2e; margin-top: 18px; }
  .page-footer a { color: #a855f7; text-decoration: none; }
</style>
</head>
<body>
  <div class="page-header">
    <span class="site-name">TubeScribe</span>
    <span class="tagline">YouTube to Article · tubescribe.app</span>
  </div>
  <hr class="divider"/>
  <div class="article-card" id="article-content">
    <div class="article-title" id="article-title"></div>
    <div class="article-body" id="article-body"></div>
    ${sourcesHtml}
  </div>
  <div class="page-footer">
    © ${year} TubeScribe &nbsp;·&nbsp; <a href="https://tanisheesh.is-a.dev/">Made with ❤ by Tanish Poddar</a>
  </div>
  <script>
    const raw = ${JSON.stringify(article)};
    const cleaned = raw.replace(/\\*\\*(.+?)\\*\\*/g, '$1').replace(/\\*(.+?)\\*/g, '$1');
    const lines = cleaned.trim().split('\\n');
    let titleDone = false;
    let paraBuffer = [];
    const body = document.getElementById('article-body');

    const flushPara = () => {
      if (!paraBuffer.length) return;
      const p = document.createElement('p');
      p.textContent = paraBuffer.join(' ');
      body.appendChild(p);
      paraBuffer = [];
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushPara(); continue; }
      if (!titleDone) {
        document.getElementById('article-title').textContent = line;
        titleDone = true;
        continue;
      }
      const isHeading = line.length <= 60 && !line.endsWith('.') && !line.endsWith(',') && paraBuffer.length === 0;
      if (isHeading && body.children.length > 0) {
        flushPara();
        const h = document.createElement('h2');
        h.textContent = line;
        body.appendChild(h);
      } else {
        paraBuffer.push(line);
      }
    }
    flushPara();
  </script>
</body>
</html>`;

  try {
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      margin: { top: "15mm", right: "18mm", bottom: "15mm", left: "18mm" },
      printBackground: true,
    });

    await browser.close();

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"tubescribe-article.pdf\"",
      },
    });
  } catch (err) {
    console.error("[pdf] Error:", err);
    return Response.json({ error: "PDF generation failed" }, { status: 500 });
  }
}

// JSON endpoint kept for tests
async function handleGenerate(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ error: "Request body is missing or invalid JSON" }, { status: 400 });
  }

  if (
    body === null || typeof body !== "object" ||
    !("url" in body) ||
    typeof (body as Record<string, unknown>).url !== "string"
  ) {
    return Response.json({ error: "Missing required field: url" }, { status: 400 });
  }

  const { url } = body as { url: string };
  try {
    const { article } = await runPipeline(url);
    return Response.json({ article });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

const server = Bun.serve({
  port: config.port,
  idleTimeout: 255, // 5 minutes — enough for download + transcription
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "GET" && (pathname === "/" || pathname === "/generate-page" || pathname.startsWith("/app") || pathname.startsWith("/favicon"))) {
      return serveStatic(pathname);
    }

    // SSE streaming endpoint used by the frontend
    if (req.method === "POST" && pathname === "/generate-stream") {
      return handleGenerateSSE(req);
    }

    // PDF generation endpoint
    if (req.method === "POST" && pathname === "/export-pdf") {
      return handlePDF(req);
    }

    // JSON endpoint kept for tests
    if (req.method === "POST" && pathname === "/generate") {
      return handleGenerate(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server listening on port ${server.port}`);
