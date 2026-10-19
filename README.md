# SoundRip Pro — SoundCloud Scraper, Streamer & MP3 Downloader 🎧

A full-stack, production-ready tool to scrape SoundCloud song metadata, extract high-resolution artwork, play complete tracks directly in your browser with zero duration caps, and download lossless MP3 audio files.

Powered by **yt-dlp** and **FFmpeg**.

---

## ⚡ Features

- **Metadata & Artwork Scraping**: Extracts track title, artist name, profile link, duration, upload date, genre, and highest-resolution album cover art.
- **Full In-Browser Song Playback**: Zero time caps or audio cuts. Full HTTP 206 Range Request streaming ensures immediate seeking to any second of the song.
- **Lossless MP3 Downloader**: One-click download button automatically converts audio streams into clean, tagged MP3 files with proper artist and track naming.
- **Separated Architecture**: Completely separated `backend/` and `frontend/` directories, ready for independent deployment on cloud platforms.
- **Stunning Dark Glassmorphic UI**: Neon SoundCloud accents (`#ff5500`), animated audio visualizer waves, responsive bottom player station, and quick sample tracks.

---

## 📂 Project Architecture

```
SoundCloud Scrapper/tool/
├── bin/                       # Local Windows binaries
│   ├── yt-dlp.exe             # Latest yt-dlp standalone engine
│   ├── ffmpeg.exe             # FFmpeg audio muxer/transcoder
│   └── ffprobe.exe            # Media stream analyzer
│
├── backend/                   # Independent Backend Service
│   ├── src/
│   │   ├── config.js          # Binary path resolver & environment config
│   │   ├── ytdlp.js           # yt-dlp scraping & downloading engine
│   │   ├── routes.js          # REST API endpoints
│   │   └── server.js          # Express app entrypoint
│   ├── cache/                 # Temporary audio cache with Range support
│   ├── Dockerfile             # Production Linux container with yt-dlp + ffmpeg
│   ├── render.yaml            # Render.com blueprint
│   ├── package.json
│   └── .env.example
│
├── frontend/                  # Independent Frontend SPA
│   ├── src/
│   │   ├── App.jsx            # Main player interface & state management
│   │   ├── App.css            # Custom glassmorphic styling & audio waves
│   │   ├── index.css          # Design system & tokens
│   │   └── main.jsx
│   ├── public/                # Static assets & favicon
│   ├── Dockerfile             # Multi-stage production container with Nginx
│   ├── nginx.conf             # Nginx reverse proxy & SPA router config
│   ├── vercel.json            # Vercel deployment config
│   ├── netlify.toml           # Netlify deployment config
│   └── package.json
│
├── docker-compose.yml         # Unified Docker compose deployment
├── start.bat                  # One-click Windows launch script
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- On Windows, standalone `yt-dlp.exe` and `ffmpeg.exe` are already bundled in the `bin/` directory.

### 1. Start the Backend
```bash
cd backend
npm install
npm run dev     # Starts on http://localhost:5000
```

### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev     # Starts on http://localhost:5173
```

### 3. Open in Browser
Visit **`http://localhost:5173`** to use the application!

*Or simply double-click `start.bat` on Windows to launch both services simultaneously.*

---

## 🌐 Independent Server Deployment Guide

The backend and frontend are decoupled and can be deployed independently onto different cloud servers or VPS:

### 1. Deploying the Backend Server

#### Option A: Docker (Railway, Fly.io, DigitalOcean, or VPS)
The `backend/Dockerfile` comes pre-configured with Linux `yt-dlp` and `ffmpeg`:
```bash
cd backend
docker build -t soundcloud-backend .
docker run -d -p 5000:5000 -v sc_cache:/app/cache soundcloud-backend
```

#### Option B: Render.com
1. Connect your Git repository to [Render.com](https://render.com).
2. Select **Blueprint** and point to `backend/render.yaml` (or create a **Web Service** from Docker).
3. Set Health Check path to `/api/health`.

---

### 2. Deploying the Frontend

#### Option A: Vercel / Netlify / Cloudflare Pages
1. Deploy the `frontend/` directory to Vercel or Netlify.
2. In the deployment settings, configure the environment variable:
   ```env
   VITE_API_BASE_URL=https://your-backend-server.onrender.com
   ```
3. The included `vercel.json` and `netlify.toml` automatically configure SPA routing.

#### Option B: Docker / Nginx
```bash
cd frontend
docker build -t soundcloud-frontend .
docker run -d -p 80:80 soundcloud-frontend
```

---

## 📡 API Reference (Backend)

| Method | Endpoint | Description | Query / Body Params |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Service health, yt-dlp version, and ffmpeg status | None |
| `POST` / `GET` | `/api/scrape` | Scrapes metadata & cover art for a track | `url`: SoundCloud song URL |
| `GET` | `/api/stream` | Streams audio with HTTP Range (Partial Content 206) | `id`: Track ID, `url`: Track URL |
| `GET` | `/api/download` | Downloads full track as an MP3 attachment | `id`, `url`, `title`, `artist` |

### Example cURL Requests

**Scrape Metadata:**
```bash
curl -X POST http://localhost:5000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/rudeboy2025/late-night-melancholy"}'
```

**Stream Audio with Seeking:**
```bash
curl -i -H "Range: bytes=0-1048576" \
  "http://localhost:5000/api/stream?id=839493820&url=https://soundcloud.com/rudeboy2025/late-night-melancholy"
```

**Download Clean MP3:**
```bash
curl -OJ "http://localhost:5000/api/download?id=839493820&url=https://soundcloud.com/rudeboy2025/late-night-melancholy&title=Late+Night+Melancholy&artist=Rude+Boy"
```

---

## 🔒 License
MIT License. Built for education and personal media archival.
