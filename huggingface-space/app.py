import spaces
import os
import re
import math
import urllib.parse
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, JSONResponse
from pydantic import BaseModel
import gradio as gr
import yt_dlp
import uvicorn

CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 1. FastAPI Application
custom_app = FastAPI(title="SoundCloud Scraper & Audio Engine")

custom_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    url: str

def format_duration(seconds):
    if not seconds or math.isnan(seconds):
        return "0:00"
    sec = int(seconds)
    hours = sec // 3600
    minutes = (sec % 3600) // 60
    secs = sec % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"

def get_best_thumbnail(thumbnails, default_thumb=None):
    if not thumbnails:
        return default_thumb
    for t in thumbnails:
        if t.get("id") in ("original", "t500x500") or t.get("width", 0) >= 500:
            return t.get("url")
    return thumbnails[-1].get("url") if thumbnails else default_thumb

def extract_track_info(url: str):
    ydl_opts = {
        'skip_download': True,
        'no_warnings': True,
        'quiet': True,
        'noplaylist': True,
        'geo_bypass': True,
        'geo_bypass_country': 'US'
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url.strip(), download=False)
        if 'entries' in info:
            info = info['entries'][0]

        best_thumb = get_best_thumbnail(info.get('thumbnails'), info.get('thumbnail'))
        track_id = str(info.get('id', ''))
        title = info.get('title') or info.get('track') or 'Unknown Title'
        artist = info.get('artist') or info.get('uploader') or 'Unknown Artist'
        duration = info.get('duration') or 0

        encoded_title = urllib.parse.quote(title)
        encoded_artist = urllib.parse.quote(artist)
        encoded_url = urllib.parse.quote(url.strip())

        stream_url = f"/api/stream?id={track_id}&url={encoded_url}&title={encoded_title}&artist={encoded_artist}"
        download_url = f"/api/download?id={track_id}&url={encoded_url}&title={encoded_title}&artist={encoded_artist}"

        return {
            "id": track_id,
            "title": title,
            "artist": artist,
            "artistUrl": info.get('uploader_url'),
            "duration": duration,
            "durationFormatted": info.get('duration_string') or format_duration(duration),
            "thumbnail": best_thumb,
            "webpageUrl": info.get('webpage_url') or url.strip(),
            "genre": info.get('genre') or (info.get('genres') and info['genres'][0]),
            "description": info.get('description', ''),
            "uploadDate": info.get('upload_date'),
            "streamUrl": stream_url,
            "downloadUrl": download_url
        }

def download_and_cache(url: str, track_id: str):
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '', str(track_id)) if track_id else "track"
    target_path = CACHE_DIR / f"{safe_id}.mp3"

    if target_path.exists() and target_path.stat().st_size > 10240:
        return target_path

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': str(CACHE_DIR / f"{safe_id}.%(ext)s"),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '320',
        }],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'geo_bypass': True,
        'geo_bypass_country': 'US'
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url.strip()])

    if target_path.exists():
        return target_path

    for f in CACHE_DIR.glob(f"{safe_id}*.mp3"):
        return f

    raise HTTPException(status_code=500, detail="Audio extraction failed")

# REST API Endpoints
@custom_app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "SoundCloud Scraper & Audio Engine (Hugging Face)",
        "ytdlp_version": yt_dlp.version.__version__
    }

@custom_app.post("/api/scrape")
def api_scrape_post(req: ScrapeRequest):
    try:
        track = extract_track_info(req.url)
        return {"success": True, "track": track}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@custom_app.get("/api/scrape")
def api_scrape_get(url: str = Query(...)):
    try:
        track = extract_track_info(url)
        return {"success": True, "track": track}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@custom_app.get("/api/stream")
def api_stream(request: Request, url: str, id: str):
    try:
        file_path = download_and_cache(url, id)
        file_size = file_path.stat().st_size
        range_header = request.headers.get("range")

        if range_header:
            range_match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if range_match:
                start = int(range_match.group(1))
                end = int(range_match.group(2)) if range_match.group(2) else file_size - 1

                if start >= file_size or end >= file_size:
                    return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

                chunk_size = (end - start) + 1
                with open(file_path, "rb") as f:
                    f.seek(start)
                    data = f.read(chunk_size)

                return Response(
                    content=data,
                    status_code=206,
                    headers={
                        "Content-Range": f"bytes {start}-{end}/{file_size}",
                        "Accept-Ranges": "bytes",
                        "Content-Length": str(chunk_size),
                        "Content-Type": "audio/mpeg"
                    }
                )

        return FileResponse(
            path=str(file_path),
            media_type="audio/mpeg",
            headers={"Accept-Ranges": "bytes"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@custom_app.get("/api/download")
def api_download(url: str, id: str, title: Optional[str] = "Track", artist: Optional[str] = "SoundCloud"):
    try:
        file_path = download_and_cache(url, id)
        safe_artist = re.sub(r'[<>:"/\\|?*]', '', artist or "SoundCloud").strip()
        safe_title = re.sub(r'[<>:"/\\|?*]', '', title or "Track").strip()
        filename = f"{safe_artist} - {safe_title}.mp3"

        return FileResponse(
            path=str(file_path),
            filename=filename,
            media_type="audio/mpeg"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. Built-in Gradio Interface (Decorated with @spaces.GPU for ZeroGPU verification)
@spaces.GPU
def gradio_fetch_song(url):
    if not url or not url.strip():
        return None, "Please provide a valid SoundCloud URL", None, None

    try:
        track = extract_track_info(url)
        audio_path = download_and_cache(url, track["id"])
        
        info_md = f"""
### 🎵 **{track['title']}**
- **Artist:** {track['artist']}  
- **Duration:** {track['durationFormatted']}  
- **Genre:** {track['genre'] or 'SoundCloud'}  
- **Track ID:** `{track['id']}`
"""
        return track["thumbnail"], info_md, str(audio_path), str(audio_path)
    except Exception as e:
        return None, f"⚠️ Error: {str(e)}", None, None

# Using gr.Interface which ZeroGPU's AST scanner directly detects and validates
demo = gr.Interface(
    fn=gradio_fetch_song,
    inputs=gr.Textbox(
        label="SoundCloud Track URL",
        placeholder="Paste SoundCloud song URL (e.g. https://soundcloud.com/artist/song)...",
        lines=1
    ),
    outputs=[
        gr.Image(label="Album Cover Art", type="filepath"),
        gr.Markdown(label="Track Details"),
        gr.Audio(label="Play Full Song (No Length Limits)", type="filepath"),
        gr.File(label="Download Full MP3 File")
    ],
    title="🎧 SoundCloud Scraper, Streamer & MP3 Downloader",
    description="Full-track in-browser streaming and 320kbps MP3 downloader powered by **yt-dlp** and **FFmpeg**."
)

# 3. Mount Gradio onto FastAPI
app = gr.mount_gradio_app(custom_app, demo, path="/")

# 4. Start Uvicorn ASGI Server
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
