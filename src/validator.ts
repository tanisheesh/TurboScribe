const WATCH_URL_RE = /^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]+)/;
const SHORT_URL_RE = /^https:\/\/youtu\.be\/([a-zA-Z0-9_-]+)/;

export function validateYouTubeUrl(
  url: string
): { valid: true; videoId: string } | { valid: false; error: string } {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL must be a non-empty string" };
  }

  const watchMatch = url.match(WATCH_URL_RE);
  if (watchMatch) {
    return { valid: true, videoId: watchMatch[1] };
  }

  const shortMatch = url.match(SHORT_URL_RE);
  if (shortMatch) {
    return { valid: true, videoId: shortMatch[1] };
  }

  return {
    valid: false,
    error:
      "Invalid YouTube URL. Expected https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID",
  };
}
