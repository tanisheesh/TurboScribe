import { config } from "./config";
import type { EnrichResult } from "./types";

const MAX_CONTEXT_CHARS = 8000;
const TOP_RESULTS = 3;

/**
 * Extracts a search query from the transcript using a simple heuristic:
 * strips common stop words and returns the top frequent meaningful words.
 */
function extractQuery(transcript: string): string {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "that", "this",
    "these", "those", "it", "its", "i", "we", "you", "he", "she", "they",
    "my", "your", "his", "her", "our", "their", "what", "which", "who",
    "when", "where", "how", "why", "so", "if", "then", "than", "as", "up",
    "out", "about", "into", "through", "just", "also", "not", "no", "more",
  ]);

  const words = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word);

  return topWords.join(" ");
}

async function searchSerper(query: string): Promise<string[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": config.serperApiKey,
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { organic?: Array<{ link: string }> };
  return (data.organic ?? [])
    .slice(0, TOP_RESULTS)
    .map((r) => r.link)
    .filter(Boolean);
}

async function fetchWithFirecrawl(url: string): Promise<string> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.firecrawlApiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl error for ${url}: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { data?: { markdown?: string } };
  return data.data?.markdown ?? "";
}

export async function enrich(transcript: string): Promise<EnrichResult> {
  try {
    const query = extractQuery(transcript);
    if (!query) {
      return { context: "", sources: [] };
    }

    const urls = await searchSerper(query);
    if (urls.length === 0) {
      return { context: "", sources: [] };
    }

    const chunks: string[] = [];
    let totalChars = 0;

    for (const url of urls) {
      if (totalChars >= MAX_CONTEXT_CHARS) break;
      try {
        const text = await fetchWithFirecrawl(url);
        if (!text) continue;
        const remaining = MAX_CONTEXT_CHARS - totalChars;
        const chunk = text.slice(0, remaining);
        chunks.push(chunk);
        totalChars += chunk.length;
      } catch (err) {
        console.error(`[enricher] Failed to fetch ${url}:`, err);
      }
    }

    return { context: chunks.join("\n\n"), sources: urls.slice(0, 3) };
  } catch (err) {
    console.error("[enricher] Enrichment failed:", err);
    return { context: "", sources: [] };
  }
}
