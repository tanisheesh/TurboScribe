// quick test
import { YoutubeTranscript } from "youtube-transcript";

try {
  const t = await YoutubeTranscript.fetchTranscript("HeQX2HjkcNo", { lang: "en" });
  console.log("✅ English transcript found:");
  console.log(t.slice(0, 3));
} catch (err) {
  console.log("❌ English not available, trying default:");
  const t = await YoutubeTranscript.fetchTranscript("HeQX2HjkcNo");
  console.log(t.slice(0, 3));
}

