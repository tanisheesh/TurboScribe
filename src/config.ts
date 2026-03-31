import type { AppConfig } from "./types";

export const config: AppConfig = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  serperApiKey: process.env.SERPER_API_KEY ?? "",
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? "",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
};
