# Production Dockerfile for SoundCloud Scraper Backend (Render, Railway & VPS)
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

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source
COPY . .

# Ensure cache directory exists and has full write permissions
RUN mkdir -p /app/cache && chmod -R 777 /app/cache

ENV PORT=5000
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 5000

CMD ["npm", "start"]
