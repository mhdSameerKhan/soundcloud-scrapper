const express = require('express');
const fs = require('fs');
const path = require('path');
const { scrapeTrackInfo, ensureTrackCached, getSystemHealth } = require('./ytdlp');

const router = express.Router();

function sanitizeFilename(name) {
  return (name || 'track')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .substring(0, 100);
}

// Health & System Info
router.get('/health', async (req, res) => {
  try {
    const health = await getSystemHealth();
    res.json({
      status: 'ok',
      service: 'SoundCloud Scraper & Audio Engine',
      timestamp: new Date().toISOString(),
      ...health
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Scrape SoundCloud Metadata
router.all('/scrape', async (req, res) => {
  const url = req.body?.url || req.query?.url;
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a "url" in query parameter or request body'
    });
  }

  try {
    const track = await scrapeTrackInfo(url);

    // Build stream and download URLs for convenience
    const queryParams = new URLSearchParams({
      id: track.id,
      url: track.webpageUrl || url,
      title: track.title,
      artist: track.artist
    }).toString();

    const streamUrl = `/api/stream?${queryParams}`;
    const downloadUrl = `/api/download?${queryParams}`;

    // Pre-cache track in the background immediately so it's ready when the user clicks Play
    ensureTrackCached(track.webpageUrl || url, track.id).catch(err => {
      console.warn(`[Precache] Background caching for track ${track.id} failed:`, err.message);
    });

    res.json({
      success: true,
      track: {
        ...track,
        streamUrl,
        downloadUrl
      }
    });
  } catch (err) {
    console.error('Error during scrape:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to scrape SoundCloud track'
    });
  }
});

// Stream Audio for UI Audio Player (Supports HTTP Range Requests for instant seeking & full playback)
router.get('/stream', async (req, res) => {
  const { url, id } = req.query;

  if (!url && !id) {
    return res.status(400).json({ error: 'Missing track URL or ID' });
  }

  try {
    const filePath = await ensureTrackCached(url, id);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Track audio file not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Range request: "bytes=START-END"
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg'
      });

      fileStream.pipe(res);
    } else {
      // Full file request
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes'
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('Streaming error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to stream track' });
    }
  }
});

// Download Audio as MP3 File
router.get('/download', async (req, res) => {
  const { url, id, title, artist } = req.query;

  if (!url && !id) {
    return res.status(400).json({ error: 'Missing track URL or ID' });
  }

  try {
    const filePath = await ensureTrackCached(url, id);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Track audio file not found' });
    }

    const cleanTitle = sanitizeFilename(title || 'Track');
    const cleanArtist = sanitizeFilename(artist || 'SoundCloud');
    const downloadFilename = `${cleanArtist} - ${cleanTitle}.mp3`;

    res.download(filePath, downloadFilename, err => {
      if (err && !res.headersSent) {
        console.error('Error during file download:', err);
        res.status(500).json({ error: 'Failed to download file' });
      }
    });
  } catch (err) {
    console.error('Download preparation error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to prepare download' });
    }
  }
});

module.exports = router;
