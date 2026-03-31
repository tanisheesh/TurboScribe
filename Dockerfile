FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies including Deno (recommended JS runtime for yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-minimal \
    ca-certificates \
    curl \
    unzip \
    chromium \
    fonts-liberation \
    --no-install-recommends \
    && update-ca-certificates \
    # Install Deno (recommended JS runtime for yt-dlp)
    && curl -fsSL https://deno.land/install.sh | sh \
    && mv /root/.deno/bin/deno /usr/local/bin/deno \
    # Install yt-dlp
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV DENO_DIR=/tmp/deno_cache

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
