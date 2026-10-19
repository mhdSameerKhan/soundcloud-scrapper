# Production Dockerfile for SoundCloud Scraper Backend (Compatible with Hugging Face Spaces, Render, Railway & VPS)
FROM node:20-slim

# Install system dependencies: ffmpeg, curl, python3, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set up user with UID 1000 (Required for Hugging Face Spaces non-root execution)
RUN useradd -m -u 1000 user

WORKDIR /app

# Ensure proper directory ownership
RUN chown -R user:user /app

# Copy package files
COPY --chown=user:user package*.json ./

# Switch to non-root user
USER user

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source
COPY --chown=user:user . .

# Ensure cache directory exists and is writable
RUN mkdir -p /app/cache

# Hugging Face Spaces listens on port 7860 by default
ENV PORT=7860
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 7860

CMD ["npm", "start"]
