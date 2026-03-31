import Groq from "groq-sdk";
import { config } from "./config";
import { ArticleGenerationError } from "./types";

const SYSTEM_PROMPT = `You are an expert writer. You will receive a transcript that may be in ANY language. Always write the article in English only, regardless of the transcript language.

OUTPUT FORMAT — follow this EXACTLY:

<TITLE>
Write the article title here
</TITLE>

<INTRO>
Write a 2-3 sentence introduction paragraph here.
</INTRO>

<SECTION>
<HEADING>Section Heading Here</HEADING>
<BODY>Write the section paragraph here. 2-4 sentences.</BODY>
</SECTION>

<SECTION>
<HEADING>Section Heading Here</HEADING>
<BODY>Write the section paragraph here. 2-4 sentences.</BODY>
</SECTION>

<SECTION>
<HEADING>Section Heading Here</HEADING>
<BODY>Write the section paragraph here. 2-4 sentences.</BODY>
</SECTION>

RULES:
- Transcript may be in Hindi, Chinese, Spanish, or any other language — ALWAYS translate and write in English
- Total word count of all text combined: between 220 and 270 words
- Use the XML tags exactly as shown — they will be stripped before display
- No markdown, no **, no ##
- Output ONLY the XML structure above, nothing else`;

function getClient(): Groq {
  return new Groq({ apiKey: config.groqApiKey });
}

function parseStructuredArticle(raw: string): string {
  // Try XML tag parsing first
  const titleMatch = raw.match(/<TITLE>\s*([\s\S]*?)\s*<\/TITLE>/i);
  const introMatch = raw.match(/<INTRO>\s*([\s\S]*?)\s*<\/INTRO>/i);
  const sectionRegex = /<SECTION>\s*<HEADING>([\s\S]*?)<\/HEADING>\s*<BODY>([\s\S]*?)<\/BODY>\s*<\/SECTION>/gi;

  const sections: string[] = [];
  let match;
  while ((match = sectionRegex.exec(raw)) !== null) {
    // Use double newline between heading and body for proper paragraph breaks
    sections.push(`${match[1].trim()}\n\n${match[2].trim()}`);
  }

  if (titleMatch && (introMatch || sections.length > 0)) {
    const parts = [titleMatch[1].trim()];
    // Double newline after title
    if (introMatch) parts.push("\n", introMatch[1].trim());
    // Double newline before each section
    for (const s of sections) parts.push("\n", s);
    return parts.join("\n");
  }

  // Fallback: if XML parsing fails, clean up and normalize
  // Strip any partial tags and collapse excessive newlines
  return raw.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function trimToMaxWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();

  const candidate = words.slice(0, maxWords).join(" ");
  const lastSentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );

  if (lastSentenceEnd > 0) {
    return candidate.slice(0, lastSentenceEnd + 1).trim();
  }
  return candidate;
}

export async function generateArticle(
  transcript: string,
  context: string
): Promise<{ article: string }> {
  const groq = getClient();

  const userContent = context
    ? `Transcript:\n${transcript}\n\nSupplementary context:\n${context}`
    : `Transcript:\n${transcript}`;

  let lastArticle = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ArticleGenerationError(message);
    }

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = parseStructuredArticle(raw);
    const article = trimToMaxWords(parsed, 300);
    const wordCount = article.trim().split(/\s+/).length;
    console.log(`[articleGenerator] Attempt ${attempt}: ${wordCount} words`);
    lastArticle = article;

    if (wordCount >= 200 && wordCount <= 300) {
      return { article };
    }
  }

  return { article: lastArticle };
}
