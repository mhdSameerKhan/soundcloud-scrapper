const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { YTDLP_BIN, FFMPEG_BIN, FFMPEG_DIR, CACHE_DIR } = require('./config');
const metrics = require('./metrics');

// In-progress downloads map to prevent duplicate concurrent downloads for the same track
const activeDownloads = new Map();

// In-memory stream info cache (TTL: 25 minutes to avoid expired AWS CloudFront URLs)
const streamInfoCache = new Map();
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const secNum = Math.floor(seconds);
  const hours = Math.floor(secNum / 3600);
  const minutes = Math.floor((secNum % 3600) / 60);
  const secs = secNum % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function getBestThumbnail(thumbnails, defaultThumb) {
  if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
    return defaultThumb || null;
  }
  const preferred = thumbnails.find(t => t.id === 'original' || t.id === 't500x500' || t.width >= 500);
  if (preferred && preferred.url) {
    return preferred.url;
  }
  const last = thumbnails[thumbnails.length - 1];
  return (last && last.url) ? last.url : defaultThumb;
}

/**
 * Validates SoundCloud URL to prevent SSRF and malicious input
 */
function validateSoundCloudUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required');
  }

  const trimmed = url.trim();

  // Allow scsearch prefix for searching
  if (/^scsearch(\d+)?:/i.test(trimmed)) {
    return trimmed;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Please provide a valid SoundCloud URL (e.g., https://soundcloud.com/artist/track)');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are allowed.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isSoundCloud = hostname === 'soundcloud.com' || 
                        hostname.endsWith('.soundcloud.com') || 
                        hostname === 'snd.sc';

  if (!isSoundCloud) {
    throw new Error('Please provide a valid SoundCloud URL (e.g., https://soundcloud.com/artist/track)');
  }

  return trimmed;
}

/**
 * Sanitizes track ID to prevent path traversal
 */
function sanitizeTrackId(id) {
  if (!id) return null;
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
  return safe || null;
}

/**
 * Scrapes metadata for a SoundCloud track without downloading the audio file
 * Also captures the direct audio stream URL and HTTP headers for progressive playback
 */
async function scrapeTrackInfo(url) {
  const startTime = Date.now();
  const validUrl = validateSoundCloudUrl(url);

  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      validUrl
    ];

    execFile(YTDLP_BIN, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      metrics.recordMetadataExtraction(durationMs);

      if (error) {
        return reject(new Error(stderr || error.message || 'Failed to scrape SoundCloud track'));
      }

      try {
        const raw = JSON.parse(stdout.trim());
        const bestThumbnail = getBestThumbnail(raw.thumbnails, raw.thumbnail);
        const trackId = String(raw.id || raw.display_id || Date.now());

        const trackData = {
          id: trackId,
          title: raw.title || raw.track || 'Unknown Title',
          artist: raw.artist || raw.uploader || 'Unknown Artist',
          artistUrl: raw.uploader_url || null,
          duration: raw.duration || 0,
          durationFormatted: raw.duration_string || formatDuration(raw.duration),
          thumbnail: bestThumbnail,
          webpageUrl: raw.webpage_url || validUrl,
          genre: raw.genre || (raw.genres && raw.genres[0]) || null,
          description: raw.description || '',
          uploadDate: raw.upload_date || null,
          likes: raw.like_count || null,
          reposts: raw.repost_count || null,
          commentCount: raw.comment_count || null,
          formatsCount: raw.formats ? raw.formats.length : 0
        };

        // Cache resolved stream details for instantaneous audio playback without re-scraping
        if (raw.url) {
          const streamInfo = {
            id: trackId,
            webpageUrl: trackData.webpageUrl,
            streamUrl: raw.url,
            httpHeaders: raw.http_headers || {},
            duration: trackData.duration,
            acodec: raw.acodec,
            protocol: raw.protocol,
            expiresAt: Date.now() + STREAM_CACHE_TTL_MS
          };

          streamInfoCache.set(trackId, streamInfo);
          streamInfoCache.set(validUrl, streamInfo);
          if (trackData.webpageUrl !== validUrl) {
            streamInfoCache.set(trackData.webpageUrl, streamInfo);
          }
        }

        resolve(trackData);
      } catch (parseErr) {
        reject(new Error(`Failed to parse metadata from yt-dlp: ${parseErr.message}`));
      }
    });
  });
}

/**
 * Resolves direct stream URL and headers, utilizing in-memory cache or on-demand fetch
 */
async function resolveStreamInfo(url, trackId) {
  const startTime = Date.now();
  const safeId = sanitizeTrackId(trackId);

  // Check cache by trackId or URL
  let cached = (safeId && streamInfoCache.get(safeId)) || 
               (url && streamInfoCache.get(url.trim()));

  if (cached && cached.expiresAt > Date.now()) {
    metrics.recordStreamResolution(Date.now() - startTime);
    return cached;
  }

  // If not cached or expired, scrape track info to retrieve fresh stream URL
  if (url) {
    await scrapeTrackInfo(url);
    cached = (safeId && streamInfoCache.get(safeId)) || streamInfoCache.get(url.trim());
    metrics.recordStreamResolution(Date.now() - startTime);
    return cached;
  }

  return null;
}

/**
 * Evicts stale or failed stream URL from cache
 */
function evictStreamInfo(trackId, url) {
  const safeId = sanitizeTrackId(trackId);
  if (safeId) streamInfoCache.delete(safeId);
  if (url) streamInfoCache.delete(url.trim());
}

/**
 * Checks if a track is currently downloading in the background
 */
function isTrackDownloading(trackId, url) {
  const safeId = sanitizeTrackId(trackId);
  const lockKey = safeId || (url ? url.trim() : null);
  return lockKey ? activeDownloads.has(lockKey) : false;
}

/**
 * Creates a progressive MP3 audio stream using FFmpeg without waiting for full download
 */
function createProgressiveAudioStream({ streamUrl, httpHeaders, startTime = 0 }) {
  const t0 = Date.now();
  let firstByteRecorded = false;
  let stderrData = '';

  const ffmpegArgs = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5'
  ];

  // Pass upstream User-Agent header if available
  const userAgent = httpHeaders?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  ffmpegArgs.push('-headers', `User-Agent: ${userAgent}\r\n`);

  // Fast seek if a start offset is specified
  if (startTime && startTime > 0) {
    ffmpegArgs.push('-ss', String(startTime));
  }

  // Progressive MP3 transcoding with transparent audio quality
  ffmpegArgs.push(
    '-i', streamUrl,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    '-f', 'mp3',
    'pipe:1'
  );

  const ffmpegExe = FFMPEG_BIN || 'ffmpeg';
  const child = spawn(ffmpegExe, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  metrics.recordStreamStart();

  child.stderr.on('data', chunk => {
    stderrData += chunk.toString();
  });

  child.stdout.once('data', () => {
    if (!firstByteRecorded) {
      firstByteRecorded = true;
      const latency = Date.now() - t0;
      metrics.recordFirstUpstreamByte(latency);
    }
  });

  child.on('close', code => {
    metrics.recordStreamEnd();
    if (code !== 0 && code !== null) {
      metrics.recordStreamFailure(code);
      if (!firstByteRecorded) {
        child.stdout.emit('error', new Error(`FFmpeg exited with code ${code}: ${stderrData.slice(-200)}`));
      }
    }
  });

  child.on('error', err => {
    metrics.recordStreamFailure(err.message);
    if (!firstByteRecorded) {
      child.stdout.emit('error', err);
    }
  });

  return {
    stream: child.stdout,
    childProcess: child
  };
}

/**
 * Downloads and prepares the full song as MP3 in local cache
 * Ensures full song download without length limits or quality caps
 */
async function ensureTrackCached(url, trackId) {
  const t0 = Date.now();
  const safeId = sanitizeTrackId(trackId);
  const targetMp3 = safeId ? path.join(CACHE_DIR, `${safeId}.mp3`) : null;

  // Strict check that path is within CACHE_DIR
  if (targetMp3 && !targetMp3.startsWith(CACHE_DIR)) {
    throw new Error('Invalid track path');
  }

  // If already cached and valid size (> 10KB)
  if (targetMp3 && fs.existsSync(targetMp3)) {
    const stats = fs.statSync(targetMp3);
    if (stats.size > 10240) {
      return targetMp3;
    }
  }

  // Prevent multiple simultaneous downloads of the exact same track
  const lockKey = safeId || (url ? url.trim() : null);
  if (!lockKey) {
    throw new Error('Track ID or URL is required for caching');
  }

  if (activeDownloads.has(lockKey)) {
    return activeDownloads.get(lockKey);
  }

  const downloadPromise = new Promise((resolve, reject) => {
    const outTemplate = safeId 
      ? path.join(CACHE_DIR, `${safeId}.%(ext)s`)
      : path.join(CACHE_DIR, `%(id)s.%(ext)s`);

    const args = [
      '--no-playlist',
      '--no-warnings',
      '-N', '3', // 3 concurrent fragment downloads - balanced to prevent CPU/network starvation
      '--socket-timeout', '15',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '3', // Fast transparent audio quality matching SoundCloud source bitrate
      '-o', outTemplate
    ];

    if (FFMPEG_DIR) {
      args.push('--ffmpeg-location', FFMPEG_DIR);
    }

    const validUrl = validateSoundCloudUrl(url);
    args.push(validUrl);

    const child = spawn(YTDLP_BIN, args);
    let stderrData = '';

    child.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    child.on('close', code => {
      activeDownloads.delete(lockKey);
      metrics.recordFullDownload(Date.now() - t0);

      if (code !== 0) {
        return reject(new Error(`yt-dlp download failed (code ${code}): ${stderrData}`));
      }

      // Check resulting file
      if (targetMp3 && fs.existsSync(targetMp3)) {
        return resolve(targetMp3);
      }

      // If safeId was not predefined, find the newly created file in CACHE_DIR
      const files = fs.readdirSync(CACHE_DIR)
        .filter(f => f.endsWith('.mp3'))
        .map(f => ({ name: f, time: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 0) {
        resolve(path.join(CACHE_DIR, files[0].name));
      } else {
        reject(new Error('Downloaded file could not be located in cache'));
      }
    });

    child.on('error', err => {
      activeDownloads.delete(lockKey);
      reject(err);
    });
  });

  activeDownloads.set(lockKey, downloadPromise);
  return downloadPromise;
}

/**
 * Check versions of yt-dlp, ffmpeg, and current metrics
 */
function getSystemHealth() {
  return new Promise(resolve => {
    execFile(YTDLP_BIN, ['--version'], (err, stdout) => {
      const ytdlpVersion = err ? `Error: ${err.message}` : stdout.trim();
      
      const ffmpegBin = FFMPEG_DIR ? path.join(FFMPEG_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : 'ffmpeg';
      execFile(ffmpegBin, ['-version'], (fErr, fStdout) => {
        const ffmpegAvailable = !fErr;
        const ffmpegLine = fStdout ? fStdout.split('\n')[0] : (fErr ? fErr.message : 'Not found');

        resolve({
          status: 'ok',
          ytdlp: {
            path: YTDLP_BIN,
            version: ytdlpVersion,
            available: !err
          },
          ffmpeg: {
            dir: FFMPEG_DIR,
            available: ffmpegAvailable,
            details: ffmpegLine
          },
          cacheDir: CACHE_DIR,
          metrics: metrics.getStats()
        });
      });
    });
  });
}

module.exports = {
  validateSoundCloudUrl,
  sanitizeTrackId,
  scrapeTrackInfo,
  resolveStreamInfo,
  evictStreamInfo,
  isTrackDownloading,
  createProgressiveAudioStream,
  ensureTrackCached,
  getSystemHealth
};
