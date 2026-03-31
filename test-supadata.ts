import { Supadata } from '@supadata/js';

const s = new Supadata({ apiKey: 'sd_9df04dc7b66a23f04c143d5f22f7028d' });
const r = await s.transcript({ 
  url: 'https://youtube.com/watch?v=HeQX2HjkcNo', 
  text: true 
});

// Handle both direct transcript and async job cases
if ("jobId" in r) {
  console.log("Got jobId:", r.jobId);
  let job = await s.transcript.getJobStatus(r.jobId);
  while (job.status === "queued" || job.status === "active") {
    await new Promise(resolve => setTimeout(resolve, 2000));
    job = await s.transcript.getJobStatus(r.jobId);
  }
  if (job.status === "completed" && job.result) {
    const content = job.result.content;
    const text = typeof content === "string" ? content : content.map((c: any) => c.text).join(" ");
    console.log("✅ Transcript fetched!");
    console.log("Word count:", text.split(/\s+/).length);
    console.log("First 100 words:", text.split(/\s+/).slice(0, 100).join(" "));
  } else {
    const errorMsg = typeof job.error === "string" ? job.error : job.error?.message || "Unknown error";
    console.log("❌ Job failed:", errorMsg);
  }
} else {
  console.log("✅ Transcript fetched!");
  console.log("Language:", r.lang);
  const text = typeof r.content === "string" ? r.content : r.content.map((c: any) => c.text).join(" ");
  console.log("Word count:", text.split(/\s+/).length);
  console.log("First 100 words:", text.split(/\s+/).slice(0, 100).join(" "));
}

