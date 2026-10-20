const express = require('express');
const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');
const {
  validateSoundCloudUrl,
  sanitizeTrackId,
  scrapeTrackInfo,
  resolveStreamInfo,
  evictStreamInfo,
  isTrackDownloading,
  createProgressiveAudioStream,
  ensureTrackCached,
  getSystemHealth
} = require('./ytdlp');
const metrics = require('./metrics');

const router = express.Router();

function sanitizeFilename(name) {
  return (name || 'track')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .substring(0, 100);
}

/**
 * Helper to serve a fully cached file supporting HTTP Range requests
 */
function serveCachedFileWithRange(filePath, fileSize, range, res) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Audio-Source', 'disk-cache');

  if (range) {
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
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg'
    });

    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg'
    });

    fs.createReadStream(filePath).pipe(res);
  }
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

    // Build stream and download URLs for frontend
    const queryParams = new URLSearchParams({
      id: track.id,
      url: track.webpageUrl || url,
      title: track.title,
      artist: track.artist
    }).toString();

    const streamUrl = `/api/stream?${queryParams}`;
    const downloadUrl = `/api/download?${queryParams}`;

    // Pre-cache track in the background immediately so it's ready when user downloads or replays
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

// Stream Audio for UI Audio Player
// Uses progressive streaming on cold cache and instant range requests on warm cache
router.get('/stream', async (req, res) => {
  const t0 = Date.now();
  const { url, id, t } = req.query;

  if (!url && !id) {
    return res.status(400).json({ error: 'Missing track URL or ID' });
  }

  const safeId = sanitizeTrackId(id);
  const targetMp3 = safeId ? path.join(CACHE_DIR, `${safeId}.mp3`) : null;
  const range = req.headers.range;

  // 1. WARM CACHE PATH: If complete MP3 file is already cached, serve immediately with Range support
  if (targetMp3 && fs.existsSync(targetMp3)) {
    const stat = fs.statSync(targetMp3);
    if (stat.size > 10240) {
      metrics.recordCacheHit();
      metrics.recordFirstClientByte(Date.now() - t0);
      return serveCachedFileWithRange(targetMp3, stat.size, range, res);
    }
  }

  // 2. COLD CACHE PATH: Progressive streaming without waiting for complete download
  metrics.recordCacheMiss();

  // Trigger background caching if not already running for this track
  if (url && !isTrackDownloading(safeId || id, url)) {
    ensureTrackCached(url, safeId || id).catch(err => {
      console.warn(`[BackgroundCache] Caching track ${id} failed:`, err.message);
    });
  }

  try {
    const streamInfo = await resolveStreamInfo(url, safeId || id);
    if (!streamInfo || !streamInfo.streamUrl) {
      return res.status(404).json({ error: 'Could not resolve audio stream for track' });
    }

    // Abort if client already disconnected during resolution
    if (req.destroyed || res.writableEnded) {
      return;
    }

    const startTime = (t && !isNaN(parseFloat(t))) ? Math.max(0, parseFloat(t)) : 0;

    const { stream, childProcess } = createProgressiveAudioStream({
      streamUrl: streamInfo.streamUrl,
      httpHeaders: streamInfo.httpHeaders,
      startTime
    });

    // Cleanup: isolate childProcess so only this playback instance is terminated on client abort
    const cleanup = () => {
      if (childProcess && !childProcess.killed) {
        try {
          childProcess.kill('SIGTERM');
        } catch (_) {}
      }
    };

    req.on('close', cleanup);
    res.on('finish', cleanup);

    let clientByteSent = false;

    stream.on('data', () => {
      if (!clientByteSent) {
        clientByteSent = true;
        metrics.recordFirstClientByte(Date.now() - t0);
      }
    });

    stream.on('error', err => {
      console.error('[ProgressiveStream] Stream error:', err.message);
      evictStreamInfo(safeId || id, url);
      cleanup();
      if (!res.headersSent) {
        res.status(502).json({ error: 'Upstream audio stream failed. Please try again.' });
      }
    });

    // Progressive live stream: do NOT advertise byte ranges since it is dynamic live transcode
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
      'Accept-Ranges': 'none',
      'X-Audio-Source': 'progressive-stream',
      'Cache-Control': 'no-cache, no-store'
    });

    stream.pipe(res);
  } catch (err) {
    console.error('Streaming initialization error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to stream track' });
    }
  }
});

// Download Audio as MP3 File
// Always guarantees a complete, high-quality, fully tagged MP3 file
router.get('/download', async (req, res) => {
  const { url, id, title, artist } = req.query;

  if (!url && !id) {
    return res.status(400).json({ error: 'Missing track URL or ID' });
  }

  const safeId = sanitizeTrackId(id);

  try {
    const filePath = await ensureTrackCached(url, safeId || id);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Track audio file could not be generated' });
    }

    const stat = fs.statSync(filePath);
    if (stat.size <= 10240) {
      return res.status(500).json({ error: 'Downloaded file is incomplete' });
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
