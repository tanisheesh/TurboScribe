// YouTube to Article — client-side state machine
// States: idle | loading | result | error

const inputSection = document.getElementById("input-section");
const loadingSection = document.getElementById("loading-section");
const articleSection = document.getElementById("article-section");
const errorSection = document.getElementById("error-section");
const urlInput = document.getElementById("url-input");
const submitBtn = document.getElementById("submit-btn");
const newLinkBtn = document.getElementById("new-link-btn");
const articleBody = document.getElementById("article-body");

/** @param {"idle"|"loading"|"result"|"error"} state */
function setState(state) {
  inputSection.style.display = state === "idle" || state === "error" ? "flex" : "none";
  loadingSection.style.display = state === "loading" ? "flex" : "none";
  articleSection.style.display = state === "result" ? "flex" : "none";

  urlInput.disabled = state === "loading";
  submitBtn.disabled = state === "loading";

  if (state !== "error") {
    errorSection.style.display = "none";
    errorSection.textContent = "";
  }
}

function showError(message) {
  errorSection.style.display = "block";
  errorSection.textContent = message;
  setState("error");
}

/**
 * Convert plain-text article into HTML.
 * Treats the first non-empty line as the title (h1),
 * subsequent lines starting with "##" or "**...**" as section headings (h2),
 * and everything else as paragraphs.
 */
function renderArticle(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "<p>No content.</p>";

  let html = "";
  let firstLine = true;

  for (const line of lines) {
    if (firstLine) {
      // Strip leading markdown heading markers if present
      const title = line.replace(/^#+\s*/, "");
      html += `<h1>${escapeHtml(title)}</h1>`;
      firstLine = false;
      continue;
    }

    if (/^#{1,3}\s/.test(line)) {
      html += `<h2>${escapeHtml(line.replace(/^#+\s*/, ""))}</h2>`;
    } else {
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  return html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleSubmit() {
  const url = urlInput.value.trim();
  if (!url) {
    showError("Please enter a YouTube URL.");
    return;
  }

  setState("loading");

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || `Server error (${res.status}). Please try again.`);
      return;
    }

    articleBody.innerHTML = renderArticle(data.article);
    setState("result");
  } catch (err) {
    showError("Network error. Please check your connection and try again.");
  }
}

function handleNewLink() {
  urlInput.value = "";
  articleBody.innerHTML = "";
  setState("idle");
  urlInput.focus();
}

submitBtn.addEventListener("click", handleSubmit);
newLinkBtn.addEventListener("click", handleNewLink);

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSubmit();
});

// Start in idle state
setState("idle");
