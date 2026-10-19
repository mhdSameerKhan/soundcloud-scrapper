const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { PORT, CACHE_DIR, YTDLP_BIN, FFMPEG_DIR } = require('./config');
const routes = require('./routes');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// API Routes
app.use('/api', routes);

// Root Welcome Route
app.get('/', (req, res) => {
  res.json({
    name: 'SoundCloud Scraper & Audio Engine API',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health: 'GET /api/health',
      scrape: 'POST /api/scrape or GET /api/scrape?url=...',
      stream: 'GET /api/stream?id=...&url=...',
      download: 'GET /api/download?id=...&url=...'
    }
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎧 SoundCloud Scraper Backend running on port ${PORT}`);
  console.log(`📁 Cache Directory: ${CACHE_DIR}`);
  console.log(`⚙️  yt-dlp binary: ${YTDLP_BIN}`);
  console.log(`🎬 ffmpeg directory: ${FFMPEG_DIR || 'System PATH'}`);
  console.log(`📡 Healthcheck: http://localhost:${PORT}/api/health`);
  console.log(`===============================================`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  server.close(() => {
    console.log('Backend server closed gracefully');
    process.exit(0);
  });
});
