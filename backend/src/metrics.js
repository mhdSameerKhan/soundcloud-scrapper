/**
 * Performance instrumentation and metrics tracker for SoundCloud Scraper & Audio Engine
 */

class MetricsTracker {
  constructor() {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.streamsStarted = 0;
    this.streamsCompleted = 0;
    this.streamFailures = 0;
    this.exitCodes = {};

    // Sliding windows for recent latencies (in ms)
    this.historyLimit = 50;
    this.metadataExtractionTimes = [];
    this.streamResolutionTimes = [];
    this.timeToFirstUpstreamByteTimes = [];
    this.timeToFirstClientByteTimes = [];
    this.fullDownloadTimes = [];
  }

  _push(arr, val) {
    if (typeof val !== 'number' || isNaN(val)) return;
    arr.push(val);
    if (arr.length > this.historyLimit) arr.shift();
  }

  _avg(arr) {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / arr.length) * 10) / 10;
  }

  recordMetadataExtraction(durationMs) {
    this._push(this.metadataExtractionTimes, durationMs);
  }

  recordStreamResolution(durationMs) {
    this._push(this.streamResolutionTimes, durationMs);
  }

  recordFirstUpstreamByte(durationMs) {
    this._push(this.timeToFirstUpstreamByteTimes, durationMs);
  }

  recordFirstClientByte(durationMs) {
    this._push(this.timeToFirstClientByteTimes, durationMs);
  }

  recordFullDownload(durationMs) {
    this._push(this.fullDownloadTimes, durationMs);
  }

  recordCacheHit() {
    this.cacheHits++;
  }

  recordCacheMiss() {
    this.cacheMisses++;
  }

  recordStreamStart() {
    this.streamsStarted++;
  }

  recordStreamEnd() {
    this.streamsCompleted++;
  }

  recordStreamFailure(codeOrMessage) {
    this.streamFailures++;
    const key = String(codeOrMessage || 'unknown');
    this.exitCodes[key] = (this.exitCodes[key] || 0) + 1;
  }

  getStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 
      ? `${Math.round((this.cacheHits / totalRequests) * 1000) / 10}%`
      : '0%';

    return {
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate
      },
      streams: {
        started: this.streamsStarted,
        completed: this.streamsCompleted,
        failures: this.streamFailures,
        exitCodes: this.exitCodes
      },
      timings: {
        metadataExtractionMs: {
          latest: this.metadataExtractionTimes[this.metadataExtractionTimes.length - 1] || null,
          avg: this._avg(this.metadataExtractionTimes)
        },
        streamResolutionMs: {
          latest: this.streamResolutionTimes[this.streamResolutionTimes.length - 1] || null,
          avg: this._avg(this.streamResolutionTimes)
        },
        timeToFirstUpstreamByteMs: {
          latest: this.timeToFirstUpstreamByteTimes[this.timeToFirstUpstreamByteTimes.length - 1] || null,
          avg: this._avg(this.timeToFirstUpstreamByteTimes)
        },
        timeToFirstClientByteMs: {
          latest: this.timeToFirstClientByteTimes[this.timeToFirstClientByteTimes.length - 1] || null,
          avg: this._avg(this.timeToFirstClientByteTimes)
        },
        fullDownloadAndConversionMs: {
          latest: this.fullDownloadTimes[this.fullDownloadTimes.length - 1] || null,
          avg: this._avg(this.fullDownloadTimes)
        }
      }
    };
  }
}

const metrics = new MetricsTracker();

module.exports = metrics;
