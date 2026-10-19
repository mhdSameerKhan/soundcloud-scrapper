const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { YTDLP_BIN, FFMPEG_DIR, CACHE_DIR } = require('./config');

// In-progress downloads map to prevent duplicate concurrent downloads for the same track
const activeDownloads = new Map();

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
  // Try to find original or 500x500 thumbnail
  const preferred = thumbnails.find(t => t.id === 'original' || t.id === 't500x500' || t.width >= 500);
  if (preferred && preferred.url) {
    return preferred.url;
  }
  // Fallback to the last one (usually highest quality) or default
  const last = thumbnails[thumbnails.length - 1];
  return (last && last.url) ? last.url : defaultThumb;
}

/**
 * Scrapes metadata for a SoundCloud track without downloading the audio file
 */
async function scrapeTrackInfo(url) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      return reject(new Error('URL is required'));
    }

    const trimmedUrl = url.trim();

    // Verify it looks like a valid URL or search string
    const isSoundCloud = /soundcloud\.com/i.test(trimmedUrl);
    const isSearch = /^scsearch/i.test(trimmedUrl);
    if (!isSoundCloud && !isSearch) {
      return reject(new Error('Please provide a valid SoundCloud URL (e.g., https://soundcloud.com/artist/track)'));
    }

    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      trimmedUrl
    ];

    execFile(YTDLP_BIN, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message || 'Failed to scrape SoundCloud track'));
      }

      try {
        const raw = JSON.parse(stdout.trim());
        const bestThumbnail = getBestThumbnail(raw.thumbnails, raw.thumbnail);

        const trackData = {
          id: String(raw.id || raw.display_id || Date.now()),
          title: raw.title || raw.track || 'Unknown Title',
          artist: raw.artist || raw.uploader || 'Unknown Artist',
          artistUrl: raw.uploader_url || null,
          duration: raw.duration || 0,
          durationFormatted: raw.duration_string || formatDuration(raw.duration),
          thumbnail: bestThumbnail,
          webpageUrl: raw.webpage_url || trimmedUrl,
          genre: raw.genre || (raw.genres && raw.genres[0]) || null,
          description: raw.description || '',
          uploadDate: raw.upload_date || null,
          likes: raw.like_count || null,
          reposts: raw.repost_count || null,
          commentCount: raw.comment_count || null,
          formatsCount: raw.formats ? raw.formats.length : 0
        };

        resolve(trackData);
      } catch (parseErr) {
        reject(new Error(`Failed to parse metadata from yt-dlp: ${parseErr.message}`));
      }
    });
  });
}

/**
 * Downloads and prepares the full song as MP3 in local cache
 * Ensures full song download without length limits or quality caps
 */
async function ensureTrackCached(url, trackId) {
  const safeId = trackId ? String(trackId).replace(/[^a-zA-Z0-9_-]/g, '') : null;
  const targetMp3 = safeId ? path.join(CACHE_DIR, `${safeId}.mp3`) : null;

  // If already cached and valid size (> 10KB)
  if (targetMp3 && fs.existsSync(targetMp3)) {
    const stats = fs.statSync(targetMp3);
    if (stats.size > 10240) {
      return targetMp3;
    }
  }

  // Prevent multiple simultaneous downloads of the exact same track
  const lockKey = safeId || url;
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
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0', // Highest audio quality VBR/CBR
      '-o', outTemplate
    ];

    if (FFMPEG_DIR) {
      args.push('--ffmpeg-location', FFMPEG_DIR);
    }

    args.push(url.trim());

    const child = spawn(YTDLP_BIN, args);
    let stderrData = '';

    child.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    child.on('close', code => {
      activeDownloads.delete(lockKey);

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
 * Check versions of yt-dlp and ffmpeg
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
          cacheDir: CACHE_DIR
        });
      });
    });
  });
}

module.exports = {
  scrapeTrackInfo,
  ensureTrackCached,
  getSystemHealth
};
