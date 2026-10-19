---
title: SoundCloud Scraper API
emoji: 🎧
colorFrom: red
colorTo: yellow
sdk: gradio
app_file: app.py
pinned: false
---

# SoundCloud Scraper, Streamer & MP3 Downloader API

Powered by **yt-dlp**, **FFmpeg**, and **FastAPI**.

## Available REST API Endpoints:

- `GET /api/health` — Service healthcheck and version status
- `POST /api/scrape` or `GET /api/scrape?url=...` — Scrapes metadata & album cover art
- `GET /api/stream?id=...&url=...` — Streams audio with seeking support
- `GET /api/download?id=...&url=...` — Downloads full track as an MP3 file
