// Clear Read: YouTube caption parsing helpers.
(function initClearReadYouTube(global) {
  function extractJsonValueAfter(source, marker) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) return null;
    let start = markerIndex + marker.length;
    while (/\s|:/.test(source[start] || '')) start++;
    const opener = source[start];
    if (opener !== '[' && opener !== '{') return null;
    const closer = opener === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === opener) depth++;
      if (char === closer) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(source.slice(start, i + 1)); }
          catch (_) { return null; }
        }
      }
    }
    return null;
  }

  function findCaptionTracks(scriptTexts) {
    for (const source of scriptTexts || []) {
      if (!source || !source.includes('captionTracks')) continue;
      const tracks = extractJsonValueAfter(source, '"captionTracks"');
      if (Array.isArray(tracks) && tracks.length) return tracks;
    }
    return [];
  }

  function pickCaptionTrack(tracks, preferredLanguages) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const preferred = (preferredLanguages || ['en']).map(value => String(value).toLowerCase());
    const score = track => {
      const code = String(track.languageCode || '').toLowerCase();
      const base = code.split('-')[0];
      const preferredIndex = preferred.findIndex(lang => lang === code || lang === base || lang.split('-')[0] === base);
      const languageScore = preferredIndex < 0 ? 0 : 100 - preferredIndex;
      const manualScore = track.kind === 'asr' ? 0 : 10;
      const defaultScore = track.isDefault ? 3 : 0;
      return languageScore + manualScore + defaultScore;
    };
    return [...tracks].sort((a, b) => score(b) - score(a))[0];
  }

  function formatTimestamp(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function parseJson3Transcript(payload) {
    const rows = [];
    for (const event of payload?.events || []) {
      const text = (event.segs || []).map(seg => seg.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!text || text === '[Music]' || text === '[Applause]') continue;
      const seconds = (Number(event.tStartMs) || 0) / 1000;
      const previous = rows[rows.length - 1];
      if (previous && previous.text === text) continue;
      rows.push({ seconds, time: formatTimestamp(seconds), text });
    }
    return rows;
  }

  function decodeXmlText(value) {
    return String(value || '')
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function parseTimedTextXml(xml) {
    const rows = [];
    const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = pattern.exec(String(xml || '')))) {
      const startMatch = match[1].match(/\bstart="([^"]+)"/i);
      const seconds = Number(startMatch?.[1]) || 0;
      const text = decodeXmlText(match[2]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!text || text === '[Music]' || text === '[Applause]') continue;
      const previous = rows[rows.length - 1];
      if (previous && previous.text === text) continue;
      rows.push({ seconds, time: formatTimestamp(seconds), text });
    }
    return rows;
  }

  const api = {
    extractJsonValueAfter, findCaptionTracks, pickCaptionTrack,
    formatTimestamp, parseJson3Transcript, parseTimedTextXml
  };
  global.ClearReadYouTube = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
