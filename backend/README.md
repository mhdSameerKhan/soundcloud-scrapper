---
title: SoundCloud Scraper Audio API
emoji: 🎧
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# SoundCloud Scraper & Audio Engine API

High-performance backend API powered by **Express.js**, **yt-dlp**, and **FFmpeg**.

## API Endpoints

- `GET /` — API welcome and documentation
- `GET /api/health` — Service healthcheck, yt-dlp version, and ffmpeg status
- `POST /api/scrape` — Extracts track metadata, title, duration, uploader, and high-res cover art
- `GET /api/stream?id=...&url=...` — Streams audio with HTTP Range support for seeking
- `GET /api/download?id=...&url=...` — Downloads complete track as a clean, high-quality MP3
