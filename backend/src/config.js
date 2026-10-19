const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT || 5000;
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Locate yt-dlp binary
function resolveBinary(name) {
  // 1. Explicit env var
  if (name === 'yt-dlp' && process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  if (name === 'ffmpeg' && process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  // 2. Check ../bin/ (workspace local)
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? `${name}.exe` : name;
  const localBinPaths = [
    path.join(__dirname, '..', '..', 'bin', binaryName),
    path.join(__dirname, '..', 'bin', binaryName),
    path.join(process.cwd(), 'bin', binaryName)
  ];

  for (const binPath of localBinPaths) {
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  }

  // 3. Fallback to system command in PATH
  return name;
}

// Locate ffmpeg folder for yt-dlp --ffmpeg-location flag
function resolveFfmpegLocation() {
  if (process.env.FFMPEG_DIR && fs.existsSync(process.env.FFMPEG_DIR)) {
    return process.env.FFMPEG_DIR;
  }

  const isWindows = process.platform === 'win32';
  const ffmpegExe = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
  const localBinDirs = [
    path.join(__dirname, '..', '..', 'bin'),
    path.join(__dirname, '..', 'bin'),
    path.join(process.cwd(), 'bin')
  ];

  for (const binDir of localBinDirs) {
    if (fs.existsSync(path.join(binDir, ffmpegExe))) {
      return binDir;
    }
  }

  return null;
}

const YTDLP_BIN = resolveBinary('yt-dlp');
const FFMPEG_BIN = resolveBinary('ffmpeg');
const FFMPEG_DIR = resolveFfmpegLocation();

module.exports = {
  PORT,
  CACHE_DIR,
  YTDLP_BIN,
  FFMPEG_BIN,
  FFMPEG_DIR
};
