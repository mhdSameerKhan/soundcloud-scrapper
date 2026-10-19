import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Download,
  Music,
  ExternalLink,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Repeat,
  Sparkles,
  Search,
  CheckCircle2,
  AlertCircle,
  Radio,
  Server,
  Layers,
  Clock,
  User,
  Disc3,
  Loader2
} from 'lucide-react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const SAMPLE_TRACKS = [
  {
    name: 'Chill Lofi Piano',
    url: 'https://soundcloud.com/rudeboy2025/late-night-melancholy'
  },
  {
    name: 'Synthwave / Retro',
    url: 'https://soundcloud.com/scsearch:synthwave chill beat'
  },
  {
    name: 'Deep Ambient Lounge',
    url: 'https://soundcloud.com/scsearch:ambient lofi dream'
  }
];

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const sec = Math.floor(seconds);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [track, setTrack] = useState(null);
  const [history, setHistory] = useState([]);
  const [backendStatus, setBackendStatus] = useState({ online: false, checking: true, details: null });

  // Audio Playback State
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [audioBuffering, setAudioBuffering] = useState(false);

  // Check Backend Health
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (res.ok) {
          const data = await res.json();
          setBackendStatus({ online: true, checking: false, details: data });
        } else {
          setBackendStatus({ online: false, checking: false, details: null });
        }
      } catch {
        setBackendStatus({ online: false, checking: false, details: null });
      }
    }
    checkHealth();
  }, []);

  // Sync Audio Volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Audio Event Listeners
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || track?.duration || 0);
      setAudioBuffering(false);
    }
  };

  const handleEnded = () => {
    if (!isLooping) {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  // Scrape Track Function
  const handleScrape = async (targetUrl) => {
    const queryUrl = (targetUrl || url).trim();
    if (!queryUrl) {
      setError('Please enter a SoundCloud track URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: queryUrl })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to scrape SoundCloud track');
      }

      setTrack(data.track);
      setUrl(queryUrl);

      // Add to session history without duplicates
      setHistory(prev => {
        const filtered = prev.filter(t => t.id !== data.track.id);
        return [data.track, ...filtered.slice(0, 7)];
      });

      // Reset playback state for new track
      setIsPlaying(false);
      setCurrentTime(0);
    } catch (err) {
      setError(err.message || 'Network error connecting to backend service');
    } finally {
      setLoading(false);
    }
  };

  // Play / Pause Toggle
  const togglePlay = () => {
    if (!audioRef.current || !track) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setAudioBuffering(true);
      audioRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setAudioBuffering(false);
        })
        .catch(err => {
          console.error('Playback failed:', err);
          setAudioBuffering(false);
          setIsPlaying(false);
        });
    }
  };

  // Seek Slider
  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  // Skip -10s / +10s
  const handleSkip = (seconds) => {
    if (audioRef.current) {
      const nextTime = Math.max(0, Math.min(duration || 0, audioRef.current.currentTime + seconds));
      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  // Direct Audio Download (Clean MP3)
  const handleDownload = () => {
    if (!track) return;
    setDownloading(true);

    const downloadEndpoint = `${API_BASE}${track.downloadUrl}`;
    const anchor = document.createElement('a');
    anchor.href = downloadEndpoint;
    anchor.setAttribute('download', `${track.artist} - ${track.title}.mp3`);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => {
      setDownloading(false);
    }, 2500);
  };

  return (
    <div className="app-container">
      {/* Hidden Audio Engine */}
      {track && (
        <audio
          ref={audioRef}
          src={`${API_BASE}${track.streamUrl}`}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onWaiting={() => setAudioBuffering(true)}
          onPlaying={() => setAudioBuffering(false)}
          loop={isLooping}
          preload="metadata"
        />
      )}

      {/* Top Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">
            <Radio size={24} />
          </div>
          <div>
            <div className="brand-title">
              SoundRip <span className="brand-badge">Pro v1.0</span>
            </div>
          </div>
        </div>

        <div className="status-badge" title={backendStatus.details?.ytdlp?.version || 'Backend API'}>
          <div className={`status-dot ${backendStatus.online ? '' : 'offline'}`} />
          <span>{backendStatus.online ? 'yt-dlp Engine Active' : 'Backend Connecting...'}</span>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <h1 className="hero-title">SoundCloud Audio Scraper & Player</h1>
        <p className="hero-subtitle">
          Extract full-track metadata, high-resolution artwork, and stream or download complete songs with zero length limits.
        </p>

        {/* URL Input Form */}
        <div className="search-card">
          <form className="search-form" onSubmit={(e) => { e.preventDefault(); handleScrape(); }}>
            <div className="search-icon-wrapper">
              <Search size={22} />
            </div>
            <input
              id="soundcloud-url-input"
              type="text"
              className="search-input"
              placeholder="Paste SoundCloud song URL here (e.g., https://soundcloud.com/artist/song)..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
            />
            <button
              id="scrape-submit-button"
              type="submit"
              className="btn-scrape"
              disabled={loading || !url.trim()}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Scraping...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Fetch Song
                </>
              )}
            </button>
          </form>
        </div>

        {/* Quick Sample Tracks */}
        <div className="quick-samples">
          <span className="quick-label">Try instant samples:</span>
          {SAMPLE_TRACKS.map((sample, idx) => (
            <button
              key={idx}
              className="sample-chip"
              onClick={() => {
                setUrl(sample.url);
                handleScrape(sample.url);
              }}
            >
              {sample.name}
            </button>
          ))}
        </div>
      </section>

      {/* Error Alert */}
      {error && (
        <div className="alert-error">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Scraped Track Presentation Card */}
      {track && (
        <main className="track-card">
          {/* Album Artwork */}
          <div className="artwork-container">
            <img
              src={track.thumbnail || '/favicon.svg'}
              alt={track.title}
              className={`artwork-img ${isPlaying ? 'vinyl-active' : ''}`}
            />
            <div className="artwork-overlay-badge">
              <Clock size={12} style={{ display: 'inline', marginRight: 4 }} />
              {track.durationFormatted}
            </div>
          </div>

          {/* Track Details & Action Buttons */}
          <div className="track-info">
            <div>
              <div className="track-badge-row">
                {track.genre && <span className="genre-badge">{track.genre}</span>}
                <span className="engine-badge">yt-dlp scraped</span>
                <span className="engine-badge">Lossless MP3</span>
              </div>

              <h2 className="track-title">{track.title}</h2>

              <div className="artist-row">
                <User size={16} color="var(--sc-orange)" />
                <span className="artist-name">{track.artist}</span>
                {track.artistUrl && (
                  <a
                    href={track.artistUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="artist-link"
                    title="View Artist on SoundCloud"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>

              {/* Technical Metadata Stats */}
              <div className="track-stats">
                <div className="stat-item">
                  <span className="stat-label">Full Length</span>
                  <span className="stat-value">{track.durationFormatted}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Audio Quality</span>
                  <span className="stat-value">320 kbps (Max)</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Track ID</span>
                  <span className="stat-value">#{track.id}</span>
                </div>
                {track.uploadDate && (
                  <div className="stat-item">
                    <span className="stat-label">Release</span>
                    <span className="stat-value">{track.uploadDate}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Prominent Action Buttons */}
            <div className="action-buttons">
              <button
                id="main-play-button"
                className={`btn-play-primary ${isPlaying ? 'playing' : ''}`}
                onClick={togglePlay}
              >
                {audioBuffering ? (
                  <Loader2 size={20} className="spin" />
                ) : isPlaying ? (
                  <Pause size={20} fill="#ffffff" />
                ) : (
                  <Play size={20} fill="#ffffff" />
                )}
                <span>{isPlaying ? 'Pause Track' : 'Play Full Song'}</span>
              </button>

              <button
                id="main-download-button"
                className="btn-download-primary"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Preparing MP3...
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    Download MP3
                  </>
                )}
              </button>

              <a
                href={track.webpageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-circle-action"
                title="Open on SoundCloud"
              >
                <ExternalLink size={18} />
              </a>
            </div>
          </div>
        </main>
      )}

      {/* History / Previous Scrapes */}
      {history.length > 1 && (
        <section className="history-section">
          <div className="section-header">
            <h3 className="section-title">Session Scrape History</h3>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              {history.length} tracks cached
            </span>
          </div>

          <div className="history-grid">
            {history.map((item) => (
              <div
                key={item.id}
                className="history-card"
                onClick={() => {
                  setTrack(item);
                  setUrl(item.webpageUrl || '');
                }}
              >
                <img
                  src={item.thumbnail || '/favicon.svg'}
                  alt={item.title}
                  className="history-thumb"
                />
                <div className="history-details">
                  <div className="history-title">{item.title}</div>
                  <div className="history-artist">{item.artist} • {item.durationFormatted}</div>
                </div>
                {track?.id === item.id && isPlaying && (
                  <div className="equalizer-wave playing">
                    <div className="eq-bar" />
                    <div className="eq-bar" />
                    <div className="eq-bar" />
                    <div className="eq-bar" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Architecture & Deployment Quick Reference */}
      <section className="deploy-panel">
        <div className="deploy-title">
          <Server size={18} color="var(--sc-orange)" />
          <span>Independent Deployment Architecture</span>
        </div>
        <div className="deploy-grid">
          <div className="deploy-box">
            <h4>Backend Server (`backend/`)</h4>
            <p>Runs Node.js + Express with native yt-dlp & FFmpeg. Includes Dockerfile & render.yaml for 1-click cloud deployment.</p>
            <code className="code-snippet">cd backend && docker build -t sc-backend .</code>
          </div>
          <div className="deploy-box">
            <h4>Frontend Server (`frontend/`)</h4>
            <p>Vite + React SPA. Static build deployable to Vercel, Netlify, Cloudflare Pages, or AWS S3.</p>
            <code className="code-snippet">cd frontend && npm run build</code>
          </div>
        </div>
      </section>

      {/* Fixed Bottom Full Audio Player Station */}
      {track && (
        <aside className="audio-station" aria-label="Audio Player Station">
          <div className="audio-station-inner">
            {/* Left: Thumbnail & Info */}
            <div className="station-track-info">
              <img
                src={track.thumbnail || '/favicon.svg'}
                alt={track.title}
                className="station-thumb"
              />
              <div className="station-text">
                <div className="station-title">{track.title}</div>
                <div className="station-artist">{track.artist}</div>
              </div>
            </div>

            {/* Center: Play Controls & Progress Bar */}
            <div className="station-controls-center">
              <div className="playback-buttons">
                <button
                  className={`btn-circle-action ${isLooping ? 'active' : ''}`}
                  onClick={() => setIsLooping(!isLooping)}
                  title={isLooping ? 'Repeat: Enabled' : 'Repeat: Disabled'}
                >
                  <Repeat size={16} />
                </button>

                <button
                  className="btn-circle-action"
                  onClick={() => handleSkip(-10)}
                  title="Rewind 10 seconds"
                >
                  <RotateCcw size={17} />
                </button>

                <button
                  id="station-play-pause-btn"
                  className="btn-play-pause-main"
                  onClick={togglePlay}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {audioBuffering ? (
                    <Loader2 size={20} className="spin" />
                  ) : isPlaying ? (
                    <Pause size={20} />
                  ) : (
                    <Play size={20} style={{ marginLeft: 2 }} />
                  )}
                </button>

                <button
                  className="btn-circle-action"
                  onClick={() => handleSkip(10)}
                  title="Skip forward 10 seconds"
                >
                  <RotateCw size={17} />
                </button>

                <button
                  className="btn-circle-action"
                  onClick={handleDownload}
                  title="Download MP3"
                >
                  <Download size={16} />
                </button>
              </div>

              {/* Timeline Slider with Range */}
              <div className="progress-row">
                <span className="time-text">{formatTime(currentTime)}</span>
                <input
                  id="audio-progress-slider"
                  type="range"
                  className="progress-slider"
                  min="0"
                  max={duration || track.duration || 100}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                />
                <span className="time-text">
                  {formatTime(duration || track.duration)}
                </span>
              </div>
            </div>

            {/* Right: Volume Slider & Visualizer */}
            <div className="station-controls-right">
              {isPlaying && (
                <div className="equalizer-wave playing" style={{ marginRight: 12 }}>
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                  <div className="eq-bar" />
                </div>
              )}

              <button
                className="btn-circle-action"
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>

              <input
                id="audio-volume-slider"
                type="range"
                className="volume-slider"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  if (isMuted) setIsMuted(false);
                }}
              />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
