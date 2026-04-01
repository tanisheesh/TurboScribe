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

  // Fallback: if XML parsing fails, try to intelligently format the plain text
  // Strip any partial tags first
  let cleaned = raw.replace(/<[^>]+>/g, "").trim();
  
  // If there are already paragraph breaks, preserve them
  if (cleaned.includes("\n\n")) {
    return cleaned.replace(/\n{3,}/g, "\n\n");
  }
  
  // Otherwise, try to add paragraph breaks at sentence boundaries
  // Split into sentences
  const sentences = cleaned.match(/[^.!?]+[.!?]+(\s|$)/g) || [cleaned];
  
  // Group sentences into paragraphs (3-4 sentences each)
  const paragraphs: string[] = [];
  const title = sentences[0]?.trim() || "";
  paragraphs.push(title);
  
  for (let i = 1; i < sentences.length; i += 3) {
    const para = sentences.slice(i, i + 3).join(" ").trim();
    if (para) paragraphs.push(para);
  }
  
  return paragraphs.join("\n\n");
}

function trimToMaxWords(text: string, maxWords: number): string {
  // Count words while preserving structure
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();

  // Need to trim - reconstruct from original text preserving newlines
  let wordCount = 0;
  let result = '';
  
  // Split by lines first to preserve structure
  const lines = text.trim().split('\n');
  
  for (const line of lines) {
    const lineWords = line.trim().split(/\s+/).filter(w => w.length > 0);
    
    if (wordCount + lineWords.length <= maxWords) {
      result += (result ? '\n' : '') + line;
      wordCount += lineWords.length;
    } else {
      // Add remaining words from this line
      const remaining = maxWords - wordCount;
      if (remaining > 0) {
        const partialLine = lineWords.slice(0, remaining).join(' ');
        result += (result ? '\n' : '') + partialLine;
        
        // Try to end at sentence boundary
        const lastSentenceEnd = Math.max(
          result.lastIndexOf('. '),
          result.lastIndexOf('! '),
          result.lastIndexOf('? ')
        );
        if (lastSentenceEnd > 0) {
          result = result.slice(0, lastSentenceEnd + 1).trim();
        }
      }
      break;
    }
  }
  
  return result;
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
    
    // Check if XML tags are present
    const hasXMLTags = raw.includes("<TITLE>") && raw.includes("<SECTION>");
    
    if (!hasXMLTags && attempt < 3) {
      console.log(`[articleGenerator] Attempt ${attempt}: No XML tags found, retrying with stricter prompt...`);
      // Retry with the raw output as context to force proper formatting
      try {
        response = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
            { role: "assistant", content: raw },
            { role: "user", content: "Please reformat your response using EXACTLY the XML structure specified: <TITLE>, <INTRO>, <SECTION> with <HEADING> and <BODY>. Do not write plain paragraphs." }
          ],
          temperature: 0.5,
        });
        const retryRaw = response.choices[0]?.message?.content ?? "";
        const retryHasXML = retryRaw.includes("<TITLE>") && retryRaw.includes("<SECTION>");
        
        if (retryHasXML) {
          const parsed = parseStructuredArticle(retryRaw);
          const article = trimToMaxWords(parsed, 300);
          const wordCount = article.trim().split(/\s+/).length;
          console.log(`[articleGenerator] Retry successful: ${wordCount} words with XML tags`);
          if (wordCount >= 200 && wordCount <= 300) {
            return { article };
          }
          lastArticle = article;
          continue;
        }
      } catch (retryErr) {
        console.log(`[articleGenerator] Retry failed, continuing with original...`);
      }
    }
    
    const parsed = parseStructuredArticle(raw);
    const article = trimToMaxWords(parsed, 300);
    const wordCount = article.trim().split(/\s+/).length;
    console.log(`[articleGenerator] Attempt ${attempt}: ${wordCount} words${hasXMLTags ? ' (XML)' : ' (fallback)'}`);
    lastArticle = article;

    if (wordCount >= 200 && wordCount <= 300) {
      return { article };
    }
  }

  return { article: lastArticle };
}
