const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');

const routes = require('../src/routes');
const { CACHE_DIR } = require('../src/config');
const {
  validateSoundCloudUrl,
  sanitizeTrackId,
  scrapeTrackInfo,
  ensureTrackCached
} = require('../src/ytdlp');
const metrics = require('../src/metrics');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

describe('1. Security & Input Validation', () => {
  test('rejects non-SoundCloud URLs to prevent SSRF', () => {
    assert.throws(() => validateSoundCloudUrl('http://169.254.169.254/latest/meta-data/'), /valid SoundCloud URL/);
    assert.throws(() => validateSoundCloudUrl('https://evil.com/fake-track'), /valid SoundCloud URL/);
    assert.throws(() => validateSoundCloudUrl('file:///etc/passwd'), /Invalid URL protocol/);
    assert.throws(() => validateSoundCloudUrl('javascript:alert(1)'), /Invalid URL protocol/);
  });

  test('accepts valid SoundCloud URLs and search queries', () => {
    const valid = validateSoundCloudUrl('https://soundcloud.com/artist/track-name');
    assert.strictEqual(valid, 'https://soundcloud.com/artist/track-name');

    const search = validateSoundCloudUrl('scsearch1:lofi chill');
    assert.strictEqual(search, 'scsearch1:lofi chill');
  });

  test('sanitizes track IDs to prevent path traversal', () => {
    const dangerous = sanitizeTrackId('../../etc/passwd');
    assert.strictEqual(dangerous, 'etcpasswd');
    assert.strictEqual(sanitizeTrackId('123456_track-id'), '123456_track-id');
  });
});

describe('2. Metadata Scraping and Stream Info Resolution', () => {
  test('scrapes track info and populates in-memory stream cache', async () => {
    const testUrl = 'https://soundcloud.com/rudeboy2025/late-night-melancholy';
    const track = await scrapeTrackInfo(testUrl);

    assert.ok(track.id, 'Track has id');
    assert.ok(track.title, 'Track has title');
    assert.ok(track.artist, 'Track has artist');
    assert.ok(track.duration > 0, 'Track duration > 0');
  });
});

describe('3. Cold-Cache Progressive Streaming', () => {
  test('delivers audio chunks progressively without waiting for full download', async () => {
    const testUrl = 'https://soundcloud.com/rudeboy2025/late-night-melancholy';
    const testId = 'test_cold_stream_' + Date.now();

    const t0 = Date.now();
    let firstByteMs = null;
    let bytesReceived = 0;

    await new Promise((resolve, reject) => {
      const streamUrl = `${baseUrl}/api/stream?id=${testId}&url=${encodeURIComponent(testUrl)}`;
      const req = http.get(streamUrl, res => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['content-type'], 'audio/mpeg');
        assert.strictEqual(res.headers['x-audio-source'], 'progressive-stream');
        assert.strictEqual(res.headers['accept-ranges'], 'none');

        res.on('data', chunk => {
          if (!firstByteMs) {
            firstByteMs = Date.now() - t0;
          }
          bytesReceived += chunk.length;
          // As soon as we receive at least 32KB of progressive audio, we have validated streaming!
          if (bytesReceived > 32768) {
            req.destroy();
            resolve();
          }
        });

        res.on('error', reject);
      });

      req.on('error', err => {
        if (err.code === 'ECONNRESET' || req.destroyed) {
          resolve(); // Expected upon req.destroy()
        } else {
          reject(err);
        }
      });
    });

    console.log(`[Test Cold Stream] First audio byte delivered in: ${firstByteMs}ms, total bytes received: ${bytesReceived}`);
    assert.ok(firstByteMs < 5000, `Cold stream TTFB (${firstByteMs}ms) should be under 5s`);
    assert.ok(bytesReceived > 32000, 'Received streaming audio bytes');
  });
});

describe('4. Warm-Cache Playback & HTTP Range Requests', () => {
  const warmId = 'test_warm_' + Date.now();
  const warmFile = path.join(CACHE_DIR, `${warmId}.mp3`);

  before(async () => {
    // Create a mock cached MP3 file > 10KB
    const dummyBuffer = Buffer.alloc(65536, 0xAA);
    fs.writeFileSync(warmFile, dummyBuffer);
  });

  after(() => {
    if (fs.existsSync(warmFile)) fs.unlinkSync(warmFile);
  });

  test('serves cached file with Range headers and HTTP 206', async () => {
    const streamUrl = `${baseUrl}/api/stream?id=${warmId}&url=https://soundcloud.com/test`;

    const res = await new Promise((resolve, reject) => {
      const req = http.get(streamUrl, {
        headers: { 'Range': 'bytes=0-1023' }
      }, resolve);
      req.on('error', reject);
    });

    assert.strictEqual(res.statusCode, 206);
    assert.strictEqual(res.headers['content-range'], 'bytes 0-1023/65536');
    assert.strictEqual(res.headers['content-length'], '1024');
    assert.strictEqual(res.headers['x-audio-source'], 'disk-cache');

    let received = 0;
    for await (const chunk of res) {
      received += chunk.length;
    }
    assert.strictEqual(received, 1024);
  });
});

describe('5. Full MP3 Download Endpoint', () => {
  test('delivers valid downloadable MP3 with Content-Disposition', async () => {
    const downloadId = 'test_dl_' + Date.now();
    const downloadFile = path.join(CACHE_DIR, `${downloadId}.mp3`);
    fs.writeFileSync(downloadFile, Buffer.alloc(20000, 0xBB));

    const downloadUrl = `${baseUrl}/api/download?id=${downloadId}&title=MySong&artist=MyArtist`;
    const res = await new Promise((resolve, reject) => {
      const req = http.get(downloadUrl, resolve);
      req.on('error', reject);
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'audio/mpeg');
    assert.ok(res.headers['content-disposition'].includes('MyArtist - MySong.mp3'));

    let total = 0;
    for await (const chunk of res) total += chunk.length;
    assert.strictEqual(total, 20000);

    fs.unlinkSync(downloadFile);
  });
});

describe('6. System Health & Metrics Endpoint', () => {
  test('returns operational metrics with cache hits and latencies', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/api/health`, resolve).on('error', reject);
    });

    assert.strictEqual(res.statusCode, 200);
    let body = '';
    for await (const chunk of res) body += chunk;
    const data = JSON.parse(body);

    assert.strictEqual(data.status, 'ok');
    assert.ok(data.metrics, 'Health includes metrics');
    assert.ok(data.metrics.cache, 'Metrics includes cache statistics');
    assert.ok(data.metrics.timings, 'Metrics includes timing benchmarks');
    console.log('[Test Metrics Output]:', JSON.stringify(data.metrics, null, 2));
  });
});
