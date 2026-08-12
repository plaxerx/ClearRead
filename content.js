// Clear Read: content script. Panel UI, page/Reddit extraction, analysis triggers.

let scorePanel = null;
let selectionTimeout = null;
let currentSelection = '';
let currentMode = 'text';
let currentImageSrc = '';
let currentData = null;
let clearReadEnabled = true;
let clearReadProviderLabel = 'Claude';
let lastContextTarget = null;
let lastContextPos = { x: 0, y: 0 };
let panelDismissed = false; // true after user explicitly closes. Stay closed until new selection
let panelMoved = false;     // true once dragged. Stop auto-positioning over the selection

// Fetch enabled state and theme on load
chrome.runtime.sendMessage({ type: 'GET_ENABLED' }).then(r => {
  clearReadEnabled = r?.enabled !== false;
}).catch(() => {});

chrome.runtime.sendMessage({ type: 'GET_THEME' }).then(r => {
  if (r?.theme) applyTheme(r.theme);
}).catch(() => {});

chrome.runtime.sendMessage({ type: 'GET_PROVIDER' }).then(r => {
  if (r?.label) updateProviderBranding(r.label);
}).catch(() => {});

function updateProviderBranding(label) {
  clearReadProviderLabel = label || 'Claude';
  if (scorePanel) {
    const brand = scorePanel.querySelector('.cr-footer-brand');
    if (brand) brand.textContent = `Powered by ${clearReadProviderLabel}`;
  }
  if (redditNote?.root) {
    const brand = redditNote.root.querySelector('.cr-footer-brand');
    if (brand) brand.textContent = `Powered by ${clearReadProviderLabel}`;
  }
}

function applyTheme(theme) {
  if (!scorePanel) return;
  scorePanel.classList.remove('cr-light', 'cr-dark');
  if (theme === 'light') scorePanel.classList.add('cr-light');
  if (theme === 'dark')  scorePanel.classList.add('cr-dark');
}

// Track right-clicked element
document.addEventListener('contextmenu', (e) => {
  lastContextTarget = e.target;
  lastContextPos = { x: e.clientX, y: e.clientY };
}, true);

// ── DOM image extractor ───────────────────────────────────────────────────────
function extractImageSrc(el) {
  if (!el) return null;
  let node = el;
  for (let i = 0; i < 8; i++) {
    if (!node || node === document.body) break;
    if (node.tagName === 'IMG' && node.src) return node.src;
    if (node.tagName === 'CANVAS') {
      try { return node.toDataURL('image/png'); } catch(e) {}
    }
    if (node.tagName === 'VIDEO') {
      if (node.poster) return node.poster;
      try {
        const c = document.createElement('canvas');
        c.width = node.videoWidth || 640; c.height = node.videoHeight || 360;
        c.getContext('2d').drawImage(node, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      } catch(e) {}
    }
    const bg = window.getComputedStyle(node).backgroundImage || '';
    const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (m && m[1] && !m[1].startsWith('data:image/svg')) return m[1];
    if (node.tagName === 'PICTURE') {
      const img = node.querySelector('img');
      if (img?.currentSrc || img?.src) return img.currentSrc || img.src;
    }
    const lazy = node.dataset?.src || node.dataset?.lazySrc ||
                 node.dataset?.original || node.getAttribute('data-src') || node.getAttribute('data-lazy');
    if (lazy) return lazy;
    const childImg = node.querySelector('img');
    if (childImg?.src) return childImg.src;
    node = node.parentElement;
  }
  return null;
}

// ── SVG icon helpers ──────────────────────────────────────────────────────────
const SVG_LOGO = `<svg width="20" height="20" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:var(--gen-fg)">
  <circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="9" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1"/>
  <circle cx="9" cy="6.5" r="0.9" fill="currentColor"/>
  <circle cx="11.2" cy="10.4" r="0.9" fill="currentColor"/>
  <circle cx="6.8" cy="10.4" r="0.9" fill="currentColor"/>
  <line x1="9" y1="7.4" x2="9" y2="6.5" stroke="currentColor" stroke-width="0.8"/>
  <line x1="10.3" y1="10" x2="11.2" y2="10.4" stroke="currentColor" stroke-width="0.8"/>
  <line x1="7.7" y1="10" x2="6.8" y2="10.4" stroke="currentColor" stroke-width="0.8"/>
  <line x1="13.6" y1="13.6" x2="20" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const SVG_TEXT_MODE = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
  <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="#26215C" stroke-width="1.2"/>
  <line x1="1" y1="4.5" x2="12" y2="4.5" stroke="#26215C" stroke-width="1"/>
  <line x1="4" y1="4.5" x2="4" y2="12" stroke="#26215C" stroke-width="1"/>
</svg>`;

const SVG_IMAGE_MODE = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
  <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="#042C53" stroke-width="1.2"/>
  <circle cx="4.5" cy="4.5" r="1.2" fill="#042C53"/>
  <path d="M1 9 L4.5 6 L7 8 L9.5 5.5 L12 9" stroke="#042C53" stroke-width="1" stroke-linejoin="round" fill="none"/>
</svg>`;

const SVG_CAT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--text-2)">
  <circle cx="8" cy="9.5" r="5" fill="none" stroke="currentColor" stroke-width="1.1"/>
  <polygon points="4,5.5 2.2,2.5 5.5,4.2" fill="currentColor"/>
  <polygon points="12,5.5 13.8,2.5 10.5,4.2" fill="currentColor"/>
  <rect x="4.5" y="7.8" width="7" height="2.2" rx="1.1" fill="currentColor"/>
  <circle cx="6.2" cy="8.9" r="0.85" fill="var(--bg)"/>
  <circle cx="9.8" cy="8.9" r="0.85" fill="var(--bg)"/>
  <path d="M7 11.8 Q8 12.6 9 11.8" stroke="currentColor" stroke-width="0.9" fill="none" stroke-linecap="round"/>
</svg>`;

const SVG_ROBOT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--text-2)">
  <rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.1"/>
  <path d="M5.5 1.5 L5.5 4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M10.5 1.5 L10.5 4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  <circle cx="6" cy="8.5" r="1" fill="currentColor"/>
  <circle cx="10" cy="8.5" r="1" fill="currentColor"/>
  <path d="M6 11 Q8 9.5 10 11" stroke="currentColor" stroke-width="0.9" fill="none" stroke-linecap="round"/>
</svg>`;

const SVG_SCALES = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--text-2)">
  <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  <line x1="4" y1="5" x2="3.2" y2="8.5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>
  <line x1="6" y1="5" x2="6.8" y2="8.5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>
  <line x1="10" y1="5" x2="9.2" y2="8.5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>
  <line x1="12" y1="5" x2="12.8" y2="8.5" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>
  <path d="M2.8 9 Q5 9.8 7.2 9" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>
  <path d="M8.8 8.5 Q11 9 13.2 8.5" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>
  <line x1="6" y1="14" x2="10" y2="14" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;

// Mode bar icon, label, and loading copy. One row per analysis mode.
// Pages, videos and documents render in the side panel now, not here.
const MODE_UI = {
  text:  { icon: SVG_TEXT_MODE,  label: 'Text analysis',  loading: 'Analyzing text...' },
  image: { icon: SVG_IMAGE_MODE, label: 'Image analysis', loading: 'Analyzing image...' }
};

// ── Panel creation ────────────────────────────────────────────────────────────
function createScorePanel() {
  // Mount inside Shadow DOM so host-page CSS (Reddit, etc.) can't bleed in
  const host = document.createElement('div');
  host.id = 'clear-read-host';
  host.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject extension styles FIRST so layout/colors paint without waiting on fonts
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadow.appendChild(styleLink);

  // Preconnect to speed up the Google Fonts fetch
  if (!document.head.querySelector('link[data-cr-preconnect]')) {
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
    pre1.setAttribute('data-cr-preconnect', '1');
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
    pre2.setAttribute('data-cr-preconnect', '1');
    document.head.appendChild(pre1);
    document.head.appendChild(pre2);
  }

  // Inject Google Fonts. Trimmed to only the weights actually used (lighter fetch)
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700&family=Inter:wght@400;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap';
  shadow.appendChild(fontLink);

  const panel = document.createElement('div');
  panel.id = 'ai-score-panel';
  panel.innerHTML = `
    <div class="cr-header">
      <div class="cr-scanline"></div>
      <div class="cr-logo">
        ${SVG_LOGO}
        <span class="cr-title">Clear Read</span>
      </div>
      <button class="cr-close" id="cr-close">✕</button>
    </div>

    <div class="cr-mode-bar text" id="cr-mode-bar">
      <span id="cr-mode-icon">${SVG_TEXT_MODE}</span>
      <span class="cr-mode-label" id="cr-mode-label">Text analysis</span>
    </div>

    <div id="cr-source" class="cr-source" style="display:none;">
      <div class="cr-source-row">
        <span class="cr-source-icon" id="cr-source-icon">📰</span>
        <span class="cr-source-domain" id="cr-source-domain"></span>
        <span class="cr-source-badge" id="cr-source-badge"></span>
      </div>
      <p class="cr-source-note" id="cr-source-note"></p>
    </div>

    <div class="cr-summary" id="cr-summary" style="display:none;">
      <span class="cr-tldr-tag" id="cr-tldr-tag">TL;DR</span>
      <p id="cr-summary-text"></p>
    </div>

    <div class="cr-loading" id="cr-loading">
      <div class="cr-spinner"></div>
      <p id="cr-loading-msg">Analyzing...</p>
    </div>

    <div id="cr-text-results" style="display:none;">
      <div class="cr-scores">
        <div class="cr-too-short" id="cr-too-short">⚠ Text too short for reliable scoring</div>

        <div class="cr-metric" id="cr-copycat-metric">
          <div class="cr-metric-header">
            ${SVG_CAT}
            <span class="cr-metric-label">Copycat</span>
            <span class="cr-cat-chip" id="cr-copycat-chip"></span>
          </div>
          <p class="cr-metric-note" id="cr-copycat-note"></p>
          <div class="cr-source-url" id="cr-plagiarism-url">
            <a class="cr-source-url-link" id="cr-plagiarism-link" href="#" target="_blank" rel="noopener noreferrer">
              <span>🔗</span><span class="cr-source-url-text" id="cr-plagiarism-text"></span>
            </a>
            <span class="cr-source-confidence" id="cr-plagiarism-confidence"></span>
          </div>
        </div>

        <div class="cr-metric" id="cr-ai-metric">
          <div class="cr-metric-header">
            ${SVG_ROBOT}
            <span class="cr-metric-label">AI Generated</span>
            <span class="cr-cat-chip" id="cr-ai-chip"></span>
          </div>
          <p class="cr-metric-note" id="cr-ai-note"></p>
        </div>

        <div class="cr-metric" id="cr-bias-metric">
          <div class="cr-metric-header">
            ${SVG_SCALES}
            <span class="cr-metric-label">Political Bias</span>
          </div>
          <div class="cr-bias-track-wrap">
            <div class="cr-bias-labels">
              <span>LEFT</span><span>CENTER</span><span>RIGHT</span>
            </div>
            <div class="cr-bias-track">
              <div class="cr-bias-needle" id="cr-bias-needle"></div>
            </div>
          </div>
          <p class="cr-metric-note" id="cr-bias-note"></p>
        </div>
      </div>
    </div>

    <div id="cr-image-results" style="display:none;" class="cr-image-results">
      <div class="cr-image-hero">
        <div style="flex:1;min-width:0;">
          <span class="cr-image-verdict-chip" id="cr-img-verdict"></span>
          <p class="cr-image-insight" id="cr-img-insight"></p>
          <span class="cr-generator-tag" id="cr-generator" style="display:none;"></span>
        </div>
      </div>
      <div id="cr-artifacts-wrap" style="display:none;">
        <p class="cr-artifacts-label">Artifacts detected</p>
        <div class="cr-artifacts-list" id="cr-artifacts-list"></div>
      </div>
    </div>

    <div class="cr-error" id="cr-error">
      <span>⚠️</span>
      <p id="cr-error-msg">Analysis failed. Check your API key in settings.</p>
    </div>

    <div class="cr-footer">
      <span class="cr-footer-brand">Powered by ${clearReadProviderLabel}</span>
      <button class="cr-copy-btn" id="cr-copy-btn">Copy analysis</button>
    </div>
  `;

  shadow.appendChild(panel);
  panel.querySelector('#cr-close').addEventListener('click', hidePanel);
  panel.querySelector('#cr-copy-btn').addEventListener('click', copyAnalysis);
  makeDraggable(panel, host);

  // Store shadow root reference on the panel for querySelector calls
  panel._shadow = shadow;
  panel._host = host;
  return panel;
}

// ── Dragging ──────────────────────────────────────────────────────────────────
// Grab the header to move the panel out of the way of whatever it is covering.
// Pointer events (not mouse) so a capture keeps working when the cursor crosses
// an iframe or leaves the window mid-drag.
function makeDraggable(panel, host) {
  const grip = panel.querySelector('.cr-header');
  if (!grip) return;
  let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false;

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('#cr-close')) return;
    dragging = true;
    panelMoved = true; // stop later runs from re-anchoring it under the cursor
    startX = e.clientX;
    startY = e.clientY;
    originLeft = parseFloat(host.style.left) || 0;
    originTop  = parseFloat(host.style.top)  || 0;
    grip.setPointerCapture(e.pointerId);
    panel.classList.add('cr-dragging');
    e.preventDefault();
  });

  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = panel.offsetWidth || 300, h = panel.offsetHeight || 200;
    // Clamp to the document so the panel can't be thrown off-screen entirely.
    const maxLeft = window.scrollX + window.innerWidth  - w - 4;
    const maxTop  = window.scrollY + window.innerHeight - h - 4;
    host.style.left = `${Math.min(Math.max(4, originLeft + e.clientX - startX), Math.max(4, maxLeft))}px`;
    host.style.top  = `${Math.min(Math.max(4, originTop  + e.clientY - startY), Math.max(4, maxTop))}px`;
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    grip.releasePointerCapture?.(e.pointerId);
    panel.classList.remove('cr-dragging');
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ── Panel positioning ─────────────────────────────────────────────────────────
function positionPanel(x, y) {
  // Once the user has dragged it somewhere, leave it there.
  if (panelMoved) return;
  const W = 300, H = 520, M = 12;
  const sx = window.scrollX, sy = window.scrollY;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x + sx + M;
  let top  = y + sy + M;
  if (left + W > sx + vw - M) left = x + sx - W - M;
  if (top  + H > sy + vh - M) top  = y + sy - H - M;
  const host = scorePanel._host || scorePanel;
  host.style.left        = `${Math.max(sx + M, left)}px`;
  host.style.top         = `${Math.max(sy + M, top)}px`;
  host.style.position    = 'absolute';
  host.style.zIndex      = '2147483647';
  host.style.pointerEvents = 'all';
}

function clearPanelContent() {
  if (!scorePanel) return;
  const q = id => scorePanel.querySelector(id);

  // Clear source block
  if (q('#cr-source-domain'))  q('#cr-source-domain').textContent  = '';
  if (q('#cr-source-badge'))   q('#cr-source-badge').textContent   = '';
  if (q('#cr-source-note'))    q('#cr-source-note').textContent    = '';
  if (q('#cr-source'))         q('#cr-source').style.display       = 'none';

  // Clear summary. Reset the tag too, or a page/BS run leaks its label into the next text run
  if (q('#cr-summary-text'))   q('#cr-summary-text').textContent   = '';
  if (q('#cr-tldr-tag'))       q('#cr-tldr-tag').textContent       = 'TL;DR';
  if (q('#cr-summary'))        q('#cr-summary').style.display      = 'none';

  // Clear text category chips and notes
  const clearMetric = (id) => {
    const chip = q(`#cr-${id}-chip`);
    const note = q(`#cr-${id}-note`);
    if (chip) { chip.textContent = ''; chip.className = 'cr-cat-chip na'; }
    if (note) note.textContent = '';
  };
  clearMetric('copycat');
  clearMetric('ai');

  // Clear bias needle to center
  const needle = q('#cr-bias-needle');
  if (needle)  { needle.style.transition = 'none'; needle.style.left = '50%'; needle.classList.remove('na'); }
  if (q('#cr-bias-note')) q('#cr-bias-note').textContent = '';

  // Clear plagiarism URL
  if (q('#cr-plagiarism-url')) q('#cr-plagiarism-url').style.display = 'none';
  if (q('#cr-plagiarism-link')) q('#cr-plagiarism-link').href = '#';
  if (q('#cr-plagiarism-text')) q('#cr-plagiarism-text').textContent = '';

  // Clear too-short banner
  if (q('#cr-too-short')) q('#cr-too-short').style.display = 'none';

  // Clear image results
  if (q('#cr-img-verdict')) { q('#cr-img-verdict').textContent = ''; q('#cr-img-verdict').className = 'cr-image-verdict-chip'; }
  if (q('#cr-img-insight')) q('#cr-img-insight').textContent = '';
  if (q('#cr-generator'))   { q('#cr-generator').textContent = ''; q('#cr-generator').style.display = 'none'; }
  if (q('#cr-artifacts-wrap'))  q('#cr-artifacts-wrap').style.display  = 'none';
  if (q('#cr-artifacts-list'))  q('#cr-artifacts-list').innerHTML       = '';

  // Clear error
  if (q('#cr-error'))     q('#cr-error').style.display      = 'none';
  if (q('#cr-error-msg')) q('#cr-error-msg').textContent     = '';

  // Reset current data
  currentData = null;
}

function showPanel(x, y, mode) {
  if (!scorePanel) scorePanel = createScorePanel();
  panelDismissed = false;
  currentMode = mode;
  // Apply saved theme when panel first created
  chrome.runtime.sendMessage({ type: 'GET_THEME' }).then(r => {
    if (r?.theme) applyTheme(r.theme);
  }).catch(() => {});

  // Wipe all previous analysis content before showing new run
  clearPanelContent();

  // Mode bar
  const modeUi = MODE_UI[mode] || MODE_UI.text;
  const bar = scorePanel.querySelector('#cr-mode-bar');
  bar.className = `cr-mode-bar ${mode}`;
  scorePanel.querySelector('#cr-mode-icon').innerHTML = modeUi.icon;
  scorePanel.querySelector('#cr-mode-label').textContent = modeUi.label;

  // Reset to loading state
  scorePanel.querySelector('#cr-loading').style.display = 'flex';
  scorePanel.querySelector('#cr-loading-msg').textContent = modeUi.loading;
  scorePanel.querySelector('#cr-text-results').style.display = 'none';
  scorePanel.querySelector('#cr-image-results').style.display = 'none';
  scorePanel.querySelector('#cr-error').style.display = 'none';
  scorePanel.querySelector('#cr-source').style.display = 'none';
  scorePanel.querySelector('#cr-summary').style.display = 'none';

  positionPanel(x, y);
  if (scorePanel._host) scorePanel._host.style.display = '';
  scorePanel.classList.add('visible');
}

function hidePanel() {
  panelDismissed = true;
  panelMoved = false; // closing is the reset. The next run positions itself again
  if (scorePanel) {
    scorePanel.classList.remove('visible');
    setTimeout(() => {
      if (!scorePanel.classList.contains('visible') && scorePanel._host) {
        scorePanel._host.style.display = 'none';
      }
    }, 200);
  }
}

// ── Client-side pre-flight: skip API for selections that are too short ────────
// The gate that decides whether a highlight is worth paying for. Also gates the
// mouseup handler, so the panel never opens on a selection we'd refuse to send.
const MIN_TEXT_CHARS = 160;
const URL_PATTERN = /^(https?:\/\/|www\.)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;

function shouldSkipAnalysis(text) {
  const t = text.trim();

  // Single word. No context to score
  if (!t.includes(' ')) return 'single_word';

  if (t.length < MIN_TEXT_CHARS) return 'too_short';

  // Looks like a URL even with spaces (e.g. "https://example.com /path")
  if (URL_PATTERN.test(t.replace(/\s+/g, ''))) return 'url';

  return null; // fine to send
}

function showClientTooShort(reason) {
  if (!scorePanel) return;
  scorePanel.querySelector('#cr-loading').style.display = 'none';

  // Show source block blank, summary with message, scores hidden
  scorePanel.querySelector('#cr-source').style.display = 'none';

  const summaryEl = scorePanel.querySelector('#cr-summary');
  const summaryText = scorePanel.querySelector('#cr-summary-text');
  const msgs = {
    single_word: 'Select a sentence or more for analysis.',
    too_short:   'Selection too short. Highlight a full sentence or more.',
    url:         'URL selected. Highlight surrounding text for analysis.'
  };
  summaryText.textContent = msgs[reason] || 'Selection too short.';
  scorePanel.querySelector('#cr-tldr-tag').style.display = 'none';
  summaryEl.style.display = 'block';

  scorePanel.querySelector('#cr-text-results').style.display  = 'none';
  scorePanel.querySelector('#cr-image-results').style.display = 'none';
  scorePanel.querySelector('#cr-error').style.display         = 'none';
}

// ── Qualitative category scales ───────────────────────────────────────────────
// Chips replace raw percentages everywhere except the bias/tilt bars.
// tone maps to a semantic color: 'good' green, 'warn' amber, 'bad' red, 'mid' blue
const COPYCAT_SCALE = [
  { max: 25, label: 'Appears Original', tone: 'good' },
  { max: 50, label: 'Lightly Sourced',  tone: 'mid'  },
  { max: 75, label: 'Likely Copied',    tone: 'warn' },
  { max: 101, label: 'Direct Copy',     tone: 'bad'  },
];

const AI_SCALE = [
  { max: 10,  label: 'Definitely Human', tone: 'good' },
  { max: 30,  label: 'Likely Human',     tone: 'good' },
  { max: 43,  label: 'Possibly Human',   tone: 'mid'  },
  { max: 57,  label: 'Tossup',           tone: 'mid'  },
  { max: 70,  label: 'Possibly AI',      tone: 'warn' },
  { max: 90,  label: 'Likely AI',        tone: 'warn' },
  { max: 101, label: 'Definitely AI',    tone: 'bad'  },
];

// Image verdict tiers
function imageVerdict(score) {
  if (score >= 85) return { label: 'Very Likely AI',   tone: 'bad'  };
  if (score >= 60) return { label: 'Possibly AI',      tone: 'warn' };
  if (score >= 35) return { label: 'Uncertain',        tone: 'mid'  };
  return            { label: 'Likely Authentic', tone: 'good' };
}

// ── Render text results ───────────────────────────────────────────────────────
function showTextResults(data) {
  currentData = { mode: 'text', data };
  scorePanel.querySelector('#cr-loading').style.display = 'none';
  scorePanel.querySelector('#cr-text-results').style.display = 'block';

  // Source classification
  const sourceWrap = scorePanel.querySelector('#cr-source');
  if (data.source_type && data.source_type !== null) {
    const icons = {
      community_board: '💬', social_media: '📱', corporate_news: '📰',
      independent_news: '📰', public_broadcaster: '📡', government: '🏛️',
      academic: '🎓', encyclopedia: '📖', satire: '🎭',
      blog: '✍️', aggregator: '🔗', unknown: '🌐'
    };
    const labels = {
      community_board: 'Community Board', social_media: 'Social Media',
      corporate_news: 'Corporate News', independent_news: 'Independent News',
      public_broadcaster: 'Public Broadcaster', government: 'Government Website',
      academic: 'Academic / Research', encyclopedia: 'Encyclopedia',
      satire: 'Satire', blog: 'Blog / Newsletter',
      aggregator: 'Aggregator', unknown: 'Unknown Source'
    };
    scorePanel.querySelector('#cr-source-icon').textContent = icons[data.source_type] || '🌐';
    scorePanel.querySelector('#cr-source-domain').textContent = data.source_domain || '';
    scorePanel.querySelector('#cr-source-badge').textContent = labels[data.source_type] || 'Unknown';
    scorePanel.querySelector('#cr-source-note').textContent = data.source_note || '';
    sourceWrap.style.display = 'block';
  } else {
    sourceWrap.style.display = 'none';
  }

  // Summary. TL;DR of the text content
  if (data.summary) {
    scorePanel.querySelector('#cr-summary-text').textContent = data.summary;
    scorePanel.querySelector('#cr-tldr-tag').style.display = '';
    scorePanel.querySelector('#cr-summary').style.display = 'block';
  }

  // Too short
  const tooShort = scorePanel.querySelector('#cr-too-short');
  tooShort.style.display = data.too_short ? 'block' : 'none';

  // Category chip helper. Qualitative label instead of % + bar
  const setChip = (id, score, scale) => {
    const chip = scorePanel.querySelector(`#cr-${id}-chip`);
    const noteEl = scorePanel.querySelector(`#cr-${id}-note`);
    if (score === null || score === undefined) {
      chip.textContent = '';
      chip.className = 'cr-cat-chip na';
      if (noteEl) noteEl.textContent = '';
      return;
    }
    const tier = scale.find(t => score < t.max) || scale[scale.length - 1];
    chip.textContent = tier.label;
    chip.className = `cr-cat-chip chip-${tier.tone}`;
    if (noteEl) noteEl.textContent = note(id) || '';
  };

  // notes pulled per metric
  const noteMap = { copycat: data.copycat_note, ai: data.ai_note };
  function note(id) { return noteMap[id]; }

  setChip('copycat', data.copycat_score, COPYCAT_SCALE);
  setChip('ai', data.ai_score, AI_SCALE);

  // Bias needle
  const needle = scorePanel.querySelector('#cr-bias-needle');
  if (data.bias_score === null || data.bias_score === undefined || data.too_short) {
    needle.classList.add('na');
    needle.style.left = '50%';
    scorePanel.querySelector('#cr-bias-note').textContent = '';
  } else {
    needle.classList.remove('na');
    const pos = ((Math.max(-100, Math.min(100, data.bias_score)) + 100) / 200) * 100;
    needle.style.transition = 'none';
    needle.style.left = '50%';
    requestAnimationFrame(() => {
      needle.style.transition = 'left 0.7s cubic-bezier(0.4,0,0.2,1)';
      needle.style.left = `${pos}%`;
    });
    scorePanel.querySelector('#cr-bias-note').textContent = data.bias_note || '';
  }

  // Plagiarism source URL
  const urlWrap = scorePanel.querySelector('#cr-plagiarism-url');
  if (data.source_url) {
    scorePanel.querySelector('#cr-plagiarism-link').href = data.source_url;
    scorePanel.querySelector('#cr-plagiarism-text').textContent = data.source_domain || data.source_url;
    const confLabels = { exact: '● Exact', 'near-exact': '◐ Near-exact', partial: '○ Partial' };
    scorePanel.querySelector('#cr-plagiarism-confidence').textContent = confLabels[data.match_confidence] || '';
    urlWrap.style.display = 'flex';
  } else {
    urlWrap.style.display = 'none';
  }
}

// ── Render image results ──────────────────────────────────────────────────────
function showImageResults(data) {
  currentData = { mode: 'image', data };
  scorePanel.querySelector('#cr-loading').style.display = 'none';
  scorePanel.querySelector('#cr-image-results').style.display = 'block';

  const score = Math.round(data.ai_score);

  // Verdict chip (qualitative. No percentage)
  const v = imageVerdict(score);
  const verdict = scorePanel.querySelector('#cr-img-verdict');
  verdict.textContent = v.label;
  verdict.className = `cr-image-verdict-chip chip-${v.tone}`;

  // Insight (non-repetitive summary)
  scorePanel.querySelector('#cr-img-insight').textContent = data.ai_note || '';

  // Generator tag
  const genEl = scorePanel.querySelector('#cr-generator');
  if (data.likely_generator) {
    genEl.textContent = data.likely_generator;
    genEl.style.display = 'inline-flex';
  } else {
    genEl.style.display = 'none';
  }

  // Artifacts
  const artWrap = scorePanel.querySelector('#cr-artifacts-wrap');
  const artList = scorePanel.querySelector('#cr-artifacts-list');
  if (data.artifacts && data.artifacts.length > 0) {
    artList.innerHTML = data.artifacts.map(a => `<div class="cr-artifact-item">${a}</div>`).join('');
    artWrap.style.display = 'block';
  } else {
    artWrap.style.display = 'none';
  }
}

// ── Error ─────────────────────────────────────────────────────────────────────
function showError(msg) {
  if (!scorePanel) return;
  scorePanel.querySelector('#cr-loading').style.display = 'none';
  const errEl = scorePanel.querySelector('#cr-error');
  errEl.style.display = 'flex';
  if (msg) scorePanel.querySelector('#cr-error-msg').textContent = msg;
}

// ── Copy analysis ─────────────────────────────────────────────────────────────
function copyAnalysis() {
  if (!currentData) return;
  const btn = scorePanel.querySelector('#cr-copy-btn');
  const { mode, data } = currentData;
  let text = '';

  if (mode === 'text') {
    const domain = data.source_domain || window.location.hostname;
    const srcType = data.source_type ? data.source_type.replace(/_/g,' ') : 'unknown';
    const catLabel = (score, scale) => {
      if (score === null || score === undefined) return 'N/A';
      return (scale.find(t => score < t.max) || scale[scale.length - 1]).label;
    };
    text = `Clear Read Analysis  ${domain}\n`;
    text += `Source: ${srcType}${data.source_note ? ` · ${data.source_note}` : ''}\n\n`;
    text += data.summary ? `Summary: ${data.summary}\n\n` : '';
    text += data.too_short ? '[Text too short for reliable analysis]\n' : '';
    if (!data.too_short) {
      if (data.copycat_score !== null) text += `Copycat: ${catLabel(data.copycat_score, COPYCAT_SCALE)}${data.copycat_note ? `: ${data.copycat_note}` : ''}\n`;
      if (data.ai_score !== null)      text += `AI Generated: ${catLabel(data.ai_score, AI_SCALE)}${data.ai_note ? `: ${data.ai_note}` : ''}\n`;
      if (data.bias_score !== null)    text += `Political Bias: ${data.bias_score > 0 ? '+' : ''}${data.bias_score}${data.bias_note ? `: ${data.bias_note}` : ''}\n`;
      if (data.source_url)             text += `Plagiarism source: ${data.source_url}\n`;
    }
  } else {
    text = `Clear Read Image Analysis\n\n`;
    text += `Verdict: ${imageVerdict(Math.round(data.ai_score)).label}\n`;
    if (data.ai_note) text += `Insight: ${data.ai_note}\n`;
    if (data.likely_generator) text += `Likely generator: ${data.likely_generator}\n`;
    if (data.artifacts && data.artifacts.length > 0) {
      text += `\nArtifacts detected:\n`;
      data.artifacts.forEach(a => { text += `  · ${a}\n`; });
    }
  }

  text += `\nAnalyzed by Clear Read · github.com/plaxerx/ClearRead`;

  navigator.clipboard.writeText(text.trim()).then(() => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy analysis'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => showToast('Copy failed. Try again'));
}

// ── Analysis runners ──────────────────────────────────────────────────────────
async function runTextAnalysis(text) {
  if (!scorePanel) return;
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    showError('Extension not ready. Please refresh the page.'); return;
  }

  // Pre-flight: skip API call entirely for short selections, single words, or URLs
  const skipReason = shouldSkipAnalysis(text);
  if (skipReason) {
    showClientTooShort(skipReason);
    return;
  }

  try {
    const domain = window.location.hostname.replace(/^www\./, '');
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text, domain });
    if (!response) { showError('No response. Try refreshing.'); return; }
    response.error ? showError(response.error) : showTextResults(response.data);
  } catch(err) {
    showError(err.message.includes('Extension context invalidated')
      ? 'Extension was reloaded. Please refresh this page.'
      : 'Error: ' + err.message);
  }
}

async function runImageAnalysis(srcUrl) {
  if (!scorePanel) return;
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    showError('Extension not ready. Please refresh the page.'); return;
  }
  clearPanelContent();
  scorePanel.querySelector('#cr-loading').style.display = 'flex';
  scorePanel.querySelector('#cr-image-results').style.display = 'none';
  scorePanel.querySelector('#cr-error').style.display = 'none';
  scorePanel.querySelector('#cr-loading-msg').textContent = 'Analyzing image...';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE_IMAGE', srcUrl });
    if (!response) { showError('No response. Try refreshing.'); return; }
    response.error ? showError(response.error) : showImageResults(response.data);
  } catch(err) {
    showError(err.message.includes('Extension context invalidated')
      ? 'Extension was reloaded. Please refresh this page.'
      : 'Error: ' + err.message);
  }
}

// Chrome renders PDFs in a plugin document that content scripts can't read. The body
// holds an <embed> and getSelection() comes back empty. The side panel offers the
// file-upload path instead, which does work.
function crIsPdfDocument() {
  return document.contentType === 'application/pdf'
    || !!document.querySelector('embed[type="application/pdf"]');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  let toast = document.getElementById('cr-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cr-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('visible'), 2800);
}

// ── Enabled state sync ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ENABLED_CHANGED') {
    clearReadEnabled = message.enabled;
    if (!message.enabled) {
      if (scorePanel) hidePanel();
      document.getElementById('cr-reddit-tldr-btn')?.remove();
      document.getElementById('cr-reddit-float-btn')?.remove();
      if (redditNote) { redditNote.host.remove(); redditNote = null; }
    }
  }
  if (message.type === 'THEME_CHANGED') {
    applyTheme(message.theme);
    if (redditNote) {
      redditNote.root.classList.remove('cr-light', 'cr-dark');
      if (message.theme === 'light') redditNote.root.classList.add('cr-light');
      if (message.theme === 'dark')  redditNote.root.classList.add('cr-dark');
    }
  }
  if (message.type === 'PROVIDER_CHANGED') {
    updateProviderBranding(message.label);
  }
  if (message.type === 'CLOSE_PANEL') {
    hidePanel();
  }
  if (message.type === 'GET_CONTEXT_IMAGE') {
    const src = extractImageSrc(lastContextTarget);
    sendResponse(src ? { srcUrl: src, x: lastContextPos.x, y: lastContextPos.y } : null);
    return true;
  }
  if (message.type === 'SHOW_NO_IMAGE_TOAST') {
    showToast('No image found at that element');
  }
  if (message.type === 'EXTRACT_FOR_PANEL') {
    extractForPanel().then(sendResponse);
    return true;
  }
});

// ── Image panel trigger ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_IMAGE_PANEL') {
    currentImageSrc = message.srcUrl;
    let x = message.x || window.innerWidth / 2;
    let y = message.y || window.innerHeight / 2;
    if (!message.x) {
      const img = document.querySelector(`img[src="${message.srcUrl}"]`);
      if (img) { const r = img.getBoundingClientRect(); x = r.right; y = r.bottom; }
    }
    showPanel(x, y, 'image');
    runImageAnalysis(message.srcUrl);
  }
});

// ── Text selection ────────────────────────────────────────────────────────────
document.addEventListener('mouseup', (e) => {
  clearTimeout(selectionTimeout);
  if (!clearReadEnabled) return;

  // Right/middle click must not kick off a text analysis. A right-click on a long
  // selection is how the BS check is invoked, and it would otherwise pay for both.
  if (e.button !== 0) return;

  // Block if click was inside the panel host (shadow DOM. Target is the host element)
  if (scorePanel && scorePanel._host && scorePanel._host.contains(e.target)) return;

  selectionTimeout = setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';

    if (text.length >= MIN_TEXT_CHARS) {
      // New selection. Always show, reset dismissed state
      panelDismissed = false;
      currentSelection = text;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPanel(rect.right, rect.bottom, 'text');
      runTextAnalysis(text);
    } else if (text.length === 0 && !panelDismissed) {
      // Only auto-hide on deselect if user hasn't manually closed
      hidePanel();
    }
  }, 200);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePanel(); });

// ═══════════════════════════════════════════════════════════════════════════
// Reddit thread TL;DR. Button next to Share, community-note above comments
// ═══════════════════════════════════════════════════════════════════════════
let redditNote = null; // { host, root }

const CR_BOT_SCALE = [
  { max: 20,  label: 'Organic Discussion', tone: 'good' },
  { max: 45,  label: 'Some Repetition',    tone: 'mid'  },
  { max: 70,  label: 'Copy-Paste Heavy',   tone: 'warn' },
  { max: 101, label: 'Bot-Like Activity',  tone: 'bad'  },
];

function crIsRedditCommentsPage() {
  return location.hostname.endsWith('reddit.com') && /\/comments\//.test(location.pathname);
}

function crFindShareAnchor() {
  // Strategy 1: known custom elements / slots (new Reddit, varies by rollout)
  const known = document.querySelector(
    'shreddit-post-share-button, [slot="share-button"], [data-post-click-location="share"]'
  );
  if (known) return known;

  // Strategy 2: find a control whose visible text or aria-label is "Share",
  // scoped to the post's action row (not comment share buttons).
  const post = document.querySelector('shreddit-post') || document.body;
  const controls = post.querySelectorAll('button, a[role="button"], [role="button"]');
  for (const el of controls) {
    const label = (el.getAttribute('aria-label') || el.innerText || '').trim().toLowerCase();
    if (label === 'share' || label.startsWith('share')) {
      // Walk up to the outermost wrapper that still sits in the action row,
      // so we insert as a sibling pill rather than inside the button.
      let node = el;
      while (node.parentElement &&
             node.parentElement !== post &&
             node.parentElement.children.length < 8 &&
             !node.parentElement.matches('shreddit-post')) {
        const p = node.parentElement;
        // stop climbing once the parent holds multiple action pills
        if (p.children.length > 2) break;
        node = p;
      }
      return node;
    }
  }
  return null;
}

function crFindNoteAnchor() {
  const tree = document.querySelector('shreddit-comment-tree') || document.getElementById('comment-tree');
  if (tree) return tree;
  const tools = document.querySelector('shreddit-comments-page-tools');
  if (tools?.nextElementSibling) return tools.nextElementSibling;
  // Fallback: insert before the first comment
  const firstComment = document.querySelector('shreddit-comment');
  if (firstComment) {
    // climb to a top-level container so the note isn't nested inside a comment
    let n = firstComment;
    while (n.parentElement && n.parentElement.tagName !== 'BODY' &&
           !n.parentElement.querySelector('shreddit-comment-tree')) {
      if (n.parentElement.querySelectorAll('shreddit-comment').length > 1) break;
      n = n.parentElement;
    }
    return n;
  }
  return null;
}

function injectRedditButton() {
  const anchor = crFindShareAnchor();
  if (!anchor || document.getElementById('cr-reddit-tldr-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'cr-reddit-tldr-btn';
  btn.setAttribute('type', 'button');
  btn.style.cssText = [
    'display:inline-flex', 'align-items:center', 'gap:6px',
    'height:2.5rem', 'padding:0 14px', 'margin-left:8px',
    'border:none', 'border-radius:9999px', 'cursor:pointer',
    'background:#1E5FA8', 'color:#ffffff',
    'font-weight:700', 'font-size:13px', 'line-height:1',
    'font-family:inherit', 'vertical-align:middle', 'white-space:nowrap'
  ].join(';');
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 22 22" fill="none" style="flex-shrink:0">
    <circle cx="9" cy="9" r="6.5" stroke="#fff" stroke-width="1.8"/>
    <line x1="13.6" y1="13.6" x2="20" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  </svg><span>TL;DR</span>`;
  btn.addEventListener('mouseenter', () => { btn.style.background = '#174a84'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#1E5FA8'; });
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    runRedditAnalysis();
  });

  anchor.insertAdjacentElement('afterend', btn);
}

function injectRedditFloatingButton() {
  if (document.getElementById('cr-reddit-float-btn') || document.getElementById('cr-reddit-tldr-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'cr-reddit-float-btn';
  btn.type = 'button';
  btn.style.cssText = [
    'position:fixed', 'right:20px', 'bottom:20px', 'z-index:2147483646',
    'display:inline-flex', 'align-items:center', 'gap:7px',
    'padding:11px 16px', 'border:none', 'border-radius:9999px', 'cursor:pointer',
    'background:#1E5FA8', 'color:#fff', 'font-weight:700', 'font-size:13px',
    'font-family:-apple-system,sans-serif', 'line-height:1',
    'box-shadow:0 4px 16px rgba(0,0,0,0.3)'
  ].join(';');
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 22 22" fill="none">
    <circle cx="9" cy="9" r="6.5" stroke="#fff" stroke-width="1.8"/>
    <line x1="13.6" y1="13.6" x2="20" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  </svg><span>Thread TL;DR</span>`;
  btn.addEventListener('click', (e) => { e.preventDefault(); runRedditAnalysis(); });
  document.body.appendChild(btn);
}

function crScrapeThread() {
  const post = document.querySelector('shreddit-post');
  const title = post?.getAttribute('post-title') || document.title.replace(/ : r\/.*$/, '');
  const comments = [];
  let totalChars = 0;

  document.querySelectorAll('shreddit-comment').forEach(c => {
    if (comments.length >= 90 || totalChars > 14000) return;
    const body = c.querySelector('[slot="comment"]');
    let text = body ? body.innerText.trim().replace(/\s+/g, ' ') : '';
    if (!text || text === '[deleted]' || text === '[removed]') return;
    if (text.length > 400) text = text.slice(0, 400) + '…';
    const author = c.getAttribute('author') || '?';
    const score  = c.getAttribute('score') || '0';
    const depth  = c.getAttribute('depth') || '0';
    const line = `[${score}|d${depth}] ${author}: ${text}`;
    comments.push(line);
    totalChars += line.length;
  });

  return { title, payload: comments.join('\n'), count: comments.length };
}

function buildRedditNote() {
  const host = document.createElement('div');
  host.id = 'cr-reddit-note-host';
  host.style.cssText = 'display:block;margin:12px 0;';
  const shadow = host.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadow.appendChild(styleLink);

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700&family=Inter:wght@400;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap';
  shadow.appendChild(fontLink);

  const root = document.createElement('div');
  root.className = 'cr-note';
  root.innerHTML = `
    <div class="cr-header">
      <div class="cr-scanline"></div>
      <div class="cr-logo">
        ${SVG_LOGO}
        <span class="cr-title">Clear Read</span>
        <span class="cr-note-kind">Community TL;DR</span>
      </div>
      <button class="cr-close" id="cr-note-close">✕</button>
    </div>
    <div class="cr-loading" id="cr-note-loading">
      <div class="cr-spinner"></div>
      <span>Reading the thread...</span>
    </div>
    <div id="cr-note-body" style="display:none;">
      <div class="cr-summary">
        <span class="cr-tldr-tag">TL;DR</span>
        <p id="cr-note-tldr"></p>
      </div>
      <div class="cr-note-sec" id="cr-note-themes-wrap">
        <p class="cr-note-sec-label">What people are talking about</p>
        <div id="cr-note-themes"></div>
      </div>
      <div class="cr-note-sec cr-note-meters">
        <div class="cr-note-meter">
          <p class="cr-note-sec-label">Discussion lean</p>
          <div class="cr-bias-labels"><span>LEFT</span><span>CENTER</span><span>RIGHT</span></div>
          <div class="cr-bias-track"><div class="cr-bias-needle" id="cr-note-needle"></div></div>
          <p class="cr-metric-note" id="cr-note-lean-note"></p>
        </div>
        <div class="cr-note-meter">
          <p class="cr-note-sec-label">Bot / copy-paste</p>
          <span class="cr-cat-chip na" id="cr-note-bot-chip"></span>
          <p class="cr-metric-note" id="cr-note-bot-note"></p>
        </div>
      </div>
      <div class="cr-note-sec">
        <p class="cr-note-sec-label">Top comments</p>
        <p class="cr-note-text" id="cr-note-top"></p>
        <p class="cr-note-sec-label" style="margin-top:9px;">Bottom comments</p>
        <p class="cr-note-text" id="cr-note-bottom"></p>
        <p class="cr-note-sec-label" style="margin-top:9px;">Controversial</p>
        <p class="cr-note-text" id="cr-note-contro"></p>
      </div>
    </div>
    <div class="cr-error" id="cr-note-error" style="display:none;">
      <span id="cr-note-error-msg"></span>
    </div>
    <div class="cr-footer">
      <span class="cr-footer-brand">Powered by ${clearReadProviderLabel}</span>
    </div>`;
  shadow.appendChild(root);

  root.querySelector('#cr-note-close').addEventListener('click', () => {
    host.remove();
    redditNote = null;
  });

  // Apply saved theme
  chrome.runtime.sendMessage({ type: 'GET_THEME' }).then(r => {
    root.classList.remove('cr-light', 'cr-dark');
    if (r?.theme === 'light') root.classList.add('cr-light');
    if (r?.theme === 'dark')  root.classList.add('cr-dark');
  }).catch(() => {});

  return { host, root };
}

async function runRedditAnalysis() {
  if (!clearReadEnabled) return;
  const anchor = crFindNoteAnchor();
  if (!anchor || !anchor.parentNode) {
    console.warn('[Clear Read] Could not find the comment tree to place the note.');
    return;
  }

  // Fresh note each run
  if (redditNote) { redditNote.host.remove(); redditNote = null; }
  redditNote = buildRedditNote();
  anchor.parentNode.insertBefore(redditNote.host, anchor);
  redditNote.host.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const root = redditNote.root;
  const showErr = (msg) => {
    root.querySelector('#cr-note-loading').style.display = 'none';
    root.querySelector('#cr-note-body').style.display = 'none';
    const e = root.querySelector('#cr-note-error');
    e.style.display = 'flex';
    root.querySelector('#cr-note-error-msg').textContent = msg;
  };

  const { title, payload, count } = crScrapeThread();
  if (count < 5 || payload.length < 500) {
    showErr('Not enough discussion to analyze yet. Check back when the thread grows.');
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE_REDDIT_THREAD', title, payload });
    if (!redditNote) return; // closed while loading
    if (response?.error) { showErr(response.error); return; }
    renderRedditNote(response.data);
  } catch (err) {
    showErr('Analysis failed: ' + (err?.message || 'unknown error'));
  }
}

function renderRedditNote(data) {
  const root = redditNote.root;
  root.querySelector('#cr-note-loading').style.display = 'none';
  root.querySelector('#cr-note-body').style.display = 'block';

  root.querySelector('#cr-note-tldr').textContent = data.tldr || '';

  // Themes
  const themesEl = root.querySelector('#cr-note-themes');
  themesEl.innerHTML = '';
  (data.themes || []).slice(0, 3).forEach(th => {
    const row = document.createElement('div');
    row.className = 'cr-note-theme';
    const t = document.createElement('span');
    t.className = 'cr-note-theme-t';
    t.textContent = th.t || '';
    const s = document.createElement('span');
    s.className = 'cr-note-theme-s';
    s.textContent = th.s || '';
    row.appendChild(t); row.appendChild(s);
    themesEl.appendChild(row);
  });
  root.querySelector('#cr-note-themes-wrap').style.display = (data.themes || []).length ? 'block' : 'none';

  // Lean needle (-100..100 → 0..100%)
  const needle = root.querySelector('#cr-note-needle');
  const lean = typeof data.lean === 'number' ? Math.max(-100, Math.min(100, data.lean)) : 0;
  needle.style.left = `${50 + lean / 2}%`;
  root.querySelector('#cr-note-lean-note').textContent = data.lean_note || (lean === 0 ? 'Apolitical discussion' : '');

  // Bot chip
  const botChip = root.querySelector('#cr-note-bot-chip');
  const bs = typeof data.bot_score === 'number' ? data.bot_score : null;
  if (bs === null) {
    botChip.textContent = ''; botChip.className = 'cr-cat-chip na';
  } else {
    const tier = CR_BOT_SCALE.find(t => bs < t.max) || CR_BOT_SCALE[CR_BOT_SCALE.length - 1];
    botChip.textContent = tier.label;
    botChip.className = `cr-cat-chip chip-${tier.tone}`;
  }
  root.querySelector('#cr-note-bot-note').textContent = data.bot_note || '';

  root.querySelector('#cr-note-top').textContent    = data.top || '';
  root.querySelector('#cr-note-bottom').textContent = data.bottom || '';
  root.querySelector('#cr-note-contro').textContent = data.controversial || '';
}

// SPA-safe injection. Reddit navigates client-side and lazy-renders the action row
if (location.hostname.endsWith('reddit.com')) {
  let crRedditTries = 0;

  const crTryInject = () => {
    if (!clearReadEnabled) return;
    if (!crIsRedditCommentsPage()) {
      document.getElementById('cr-reddit-tldr-btn')?.remove();
      return;
    }
    if (document.getElementById('cr-reddit-tldr-btn')) return;
    injectRedditButton();
    if (!document.getElementById('cr-reddit-tldr-btn')) {
      crRedditTries++;
      // After ~10s of failing to find the Share button, fall back to a floating pill
      // so the feature is still reachable if Reddit changes its DOM.
      if (crRedditTries === 7) {
        console.warn('[Clear Read] Share button not found. Using floating TL;DR button.');
        injectRedditFloatingButton();
      }
    } else {
      crRedditTries = 0;
      document.getElementById('cr-reddit-float-btn')?.remove();
    }
  };

  // React to Reddit's client-side rendering
  const crObserver = new MutationObserver(() => crTryInject());
  crObserver.observe(document.body, { childList: true, subtree: true });

  // Backstop poll (covers cases the observer misses)
  setInterval(crTryInject, 1500);
  crTryInject();
}

// ═══════════════════════════════════════════════════════════════════════════
// Whole-page TL;DR. Triggered from the extension popup
// ═══════════════════════════════════════════════════════════════════════════
const CR_PAGE_NOISE = 'nav,header,footer,aside,script,style,noscript,iframe,form,button,select,svg,video,audio,[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"],.sidebar,.comments,#comments,.ad,.ads,[class*="cookie"],[id*="cookie"]';

function crCleanText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(CR_PAGE_NOISE).forEach(n => n.remove());
  return (clone.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function crMetaContent(selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.content?.trim();
    if (value) return value;
  }
  return '';
}

function crWordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function crFitLongText(text, maxChars) {
  if (text.length <= maxChars) return text;
  const headChars = Math.round(maxChars * 0.8);
  return `${text.slice(0, headChars)}\n\n[Middle content omitted for length]\n\n${text.slice(-(maxChars - headChars))}`;
}

function extractPageContent() {
  const selectors = [
    'article', 'main', '[role="main"]', '[itemprop="articleBody"]',
    '.article-body', '.article-content', '.entry-content', '.post-content',
    '.story-body', '.main-content'
  ];
  const candidates = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
  let best = { text: '', score: -Infinity };

  for (const element of candidates) {
    const text = crCleanText(element);
    if (text.length < 300) continue;
    const linkText = [...element.querySelectorAll('a')].reduce((total, link) => total + (link.innerText || '').length, 0);
    const linkDensity = Math.min(1, linkText / Math.max(1, text.length));
    const paragraphs = element.querySelectorAll('p').length;
    const headings = element.querySelectorAll('h1,h2,h3').length;
    const score = text.length * (1 - linkDensity * 0.75) + Math.min(paragraphs, 40) * 120 + Math.min(headings, 12) * 80;
    if (score > best.score) best = { text, score };
  }

  if (best.text.length < 600) best.text = crCleanText(document.body);
  const text = crFitLongText(best.text, 80000);
  return {
    kind: 'page',
    title: crMetaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      || document.querySelector('h1')?.innerText?.trim()
      || document.title,
    text,
    meta: {
      author: crMetaContent(['meta[name="author"]', 'meta[property="article:author"]']),
      published: crMetaContent(['meta[property="article:published_time"]', 'meta[name="date"]', 'meta[itemprop="datePublished"]']),
      description: crMetaContent(['meta[name="description"]', 'meta[property="og:description"]']),
      wordCount: crWordCount(text)
    }
  };
}

function crIsYouTubeVideo() {
  return /(^|\.)youtube\.com$/i.test(location.hostname)
    && (/^\/watch\b/.test(location.pathname) || /^\/shorts\//.test(location.pathname));
}

function crYouTubeVideoId() {
  if (/^\/shorts\//.test(location.pathname)) return location.pathname.split('/')[2] || '';
  return new URL(location.href).searchParams.get('v') || '';
}

function crSampleTranscriptRows(rows, maxChars = 120000) {
  const render = values => values.map(row => `[${row.time}] ${row.text}`).join('\n');
  const full = render(rows);
  if (full.length <= maxChars) return full;

  const windows = 12;
  const perWindow = Math.floor(maxChars / windows);
  const chunks = [];
  for (let windowIndex = 0; windowIndex < windows; windowIndex++) {
    const start = Math.floor((rows.length * windowIndex) / windows);
    let chunk = '';
    for (let i = start; i < rows.length && chunk.length < perWindow; i++) {
      chunk += `${chunk ? '\n' : ''}[${rows[i].time}] ${rows[i].text}`;
    }
    if (chunk) chunks.push(chunk);
  }
  return chunks.join('\n[Transcript sample gap]\n');
}

async function extractYouTubeContent() {
  const helpers = globalThis.ClearReadYouTube;
  if (!helpers) throw new Error('YouTube transcript tools did not load. Reload the extension and refresh the tab.');

  const scriptTexts = [...document.scripts]
    .map(script => script.textContent || '')
    .filter(text => text.includes('captionTracks'));
  const videoId = crYouTubeVideoId();
  let tracks = helpers.findCaptionTracks(scriptTexts).filter(track => {
    try {
      const trackVideoId = new URL(track.baseUrl).searchParams.get('v');
      return !videoId || !trackVideoId || trackVideoId === videoId;
    } catch (_) { return false; }
  });
  if (!tracks.length) {
    const watchResponse = await fetch(location.href, { credentials: 'include' });
    if (watchResponse.ok) {
      const watchHtml = await watchResponse.text();
      tracks = helpers.findCaptionTracks([watchHtml]).filter(track => {
        try {
          const trackVideoId = new URL(track.baseUrl).searchParams.get('v');
          return !videoId || !trackVideoId || trackVideoId === videoId;
        } catch (_) { return false; }
      });
    }
  }
  const track = helpers.pickCaptionTrack(tracks, navigator.languages || [navigator.language || 'en']);
  if (!track?.baseUrl) {
    throw new Error('No captions are available for this video. Clear Read needs a captioned video to make a reliable TL;DR.');
  }

  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');
  const response = await fetch(captionUrl.toString(), { credentials: 'include' });
  if (!response.ok) throw new Error(`Could not load YouTube captions (${response.status}).`);
  const captionBody = await response.text();
  let rows = [];
  try { rows = helpers.parseJson3Transcript(JSON.parse(captionBody)); }
  catch (_) { rows = helpers.parseTimedTextXml(captionBody); }
  if (rows.length < 3) throw new Error('YouTube returned an empty transcript for this video.');

  const text = crSampleTranscriptRows(rows);
  const video = document.querySelector('video');
  return {
    kind: 'video',
    title: crMetaContent(['meta[property="og:title"]', 'meta[name="title"]']) || document.title.replace(/\s*-\s*YouTube\s*$/i, ''),
    text,
    meta: {
      channel: document.querySelector('ytd-channel-name a, #channel-name a')?.textContent?.trim() || '',
      description: crMetaContent(['meta[property="og:description"]', 'meta[name="description"]']),
      duration: video && Number.isFinite(video.duration) ? helpers.formatTimestamp(video.duration) : '',
      language: track.languageCode || '',
      captionKind: track.kind === 'asr' ? 'auto-generated captions' : 'creator captions',
      wordCount: crWordCount(text)
    }
  };
}

async function extractForPanel() {
  try {
    if (crIsPdfDocument()) return { isPdf: true };
    const isVideo = crIsYouTubeVideo();
    const extracted = isVideo ? await extractYouTubeContent() : extractPageContent();
    if (!extracted.text || extracted.text.length < 400) {
      return { error: isVideo
        ? 'Not enough caption text is available to summarize this video.'
        : 'Not enough readable content on this page.' };
    }
    return {
      kind: extracted.kind,
      title: extracted.title,
      text: extracted.text,
      meta: extracted.meta,
      domain: window.location.hostname.replace(/^www\./, '')
    };
  } catch (err) {
    return { error: err?.message || 'Could not read this page.' };
  }
}
