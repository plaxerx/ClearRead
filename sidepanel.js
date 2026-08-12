// Clear Read: side panel. Hosts the page TL;DR and the merged document check.
//
// The floating panel in content.js still handles highlights and images, because
// those want to sit next to whatever you selected. Anything you read top to bottom
// lives here instead, so it stays put while the page scrolls under it.

import { extractDocumentText, MAX_DOC_CHARS } from './docparse.js';

const el = id => document.getElementById(id);
const panes = ['home', 'loading', 'error', 'result'];

let lastResult = null;
let boundTabId = null;

function showPane(name) {
  panes.forEach(p => { el(`pane-${p}`).hidden = p !== name; });
}

// The chip names what is running. On the landing screen there is no mode yet,
// and labelling a side panel "Side panel" tells the reader nothing.
function setMode(label) {
  const chip = el('cr-sp-mode');
  chip.textContent = label || '';
  chip.hidden = !label;
}

function showLoading(msg, sub = '') {
  el('loading-msg').textContent = msg;
  el('loading-sub').textContent = sub;
  showPane('loading');
}

function showError(msg) {
  el('error-msg').textContent = msg;
  showPane('error');
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('cr-light', 'cr-dark');
  if (theme === 'light') root.classList.add('cr-light');
  if (theme === 'dark')  root.classList.add('cr-dark');
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Active tab ────────────────────────────────────────────────────────────────
async function activeTab() {
  if (boundTabId) {
    try { return await chrome.tabs.get(boundTabId); } catch { /* tab closed */ }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ── Page TL;DR ────────────────────────────────────────────────────────────────
async function runPageTldr() {
  setMode('Page');
  showLoading('Reading the page...', 'Extracting the main content first.');
  const tab = await activeTab();
  if (!tab) { showError('No active tab to read.'); return; }

  let extracted;
  try {
    extracted = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_FOR_PANEL' });
  } catch {
    showError('Cannot reach that page. Reload the tab and try again. Content scripts only load on page load.');
    return;
  }
  if (!extracted || extracted.error) {
    showError(extracted?.error || 'Nothing readable found on that page.');
    return;
  }

  if (extracted.kind === 'video') setMode('Video');
  showLoading(
    extracted.kind === 'video' ? 'Reading the transcript...' : 'Summarizing...',
    `${extracted.meta?.wordCount || 0} words in`
  );

  const response = await chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE', ...extracted });
  if (!response) { showError('No response from the analyzer.'); return; }
  if (response.error) { showError(response.error); return; }

  lastResult = { mode: extracted.kind === 'video' ? 'video' : 'page', data: response.data, title: extracted.title, url: tab.url };
  renderPage(response.data, extracted.title);
}

// ── Document check ────────────────────────────────────────────────────────────
async function runDocumentFromFile(file) {
  setMode('Document');
  showLoading(`Reading ${file.name}...`, 'Nothing has been sent anywhere yet.');

  let doc;
  try {
    doc = await extractDocumentText(file, (page, total) => {
      showLoading(`Reading ${file.name}...`, `Page ${page} of ${total}`);
    });
  } catch (err) {
    showError(err.message);
    return;
  }

  await analyzeDocumentText({
    text: doc.text.slice(0, MAX_DOC_CHARS),
    title: doc.name,
    source: 'file',
    label: `${doc.name} · ${doc.pages ? `${doc.pages} pages · ` : ''}${doc.chars.toLocaleString()} chars`
  });
}

async function runDocumentFromPage() {
  setMode('Document');
  showLoading('Reading this page...');
  const tab = await activeTab();
  if (!tab) { showError('No active tab to read.'); return; }

  let extracted;
  try {
    extracted = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_FOR_PANEL' });
  } catch {
    showError('Cannot reach that page. Reload the tab and try again.');
    return;
  }
  if (extracted?.isPdf) {
    showError('Chrome\'s PDF viewer is sealed off from extensions. Download the PDF and drop the file in here instead. That path works.');
    return;
  }
  if (!extracted || extracted.error) { showError(extracted?.error || 'Nothing readable on that page.'); return; }

  await analyzeDocumentText({
    text: extracted.text,
    title: extracted.title,
    domain: extracted.domain,
    source: 'page',
    label: extracted.title
  });
}

async function analyzeDocumentText({ text, title, domain, source, label }) {
  showLoading('Checking the claims and the terms...', 'This one takes a while.');
  const response = await chrome.runtime.sendMessage({
    type: 'ANALYZE_DOCUMENT', text, title, domain, source
  });
  if (!response) { showError('No response from the analyzer.'); return; }
  if (response.error) { showError(response.error); return; }
  lastResult = { mode: 'document', data: response.data, title, label };
  renderDocument(response.data, label);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function section(title, inner) {
  if (!inner) return '';
  return `<div class="cr-sp-sec"><h3>${esc(title)}</h3>${inner}</div>`;
}

function bullets(items) {
  if (!items?.length) return '';
  return `<ul class="cr-sp-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function renderPage(data, title) {
  const body = el('result-body');
  const parts = [];
  parts.push(`<div class="cr-sp-file"><b>${esc(title || 'This page')}</b><span>${data.content_type || ''}</span></div>`);
  parts.push(section('TL;DR', `<p class="cr-sp-lede">${esc(data.tldr)}</p>`));
  parts.push(section('Key points', bullets(data.points)));
  if (data.why_it_matters) parts.push(section('Why it matters', `<p class="cr-sp-note">${esc(data.why_it_matters)}</p>`));
  parts.push(section('Notable details', bullets(data.notable_details)));
  if (data.timeline?.length) {
    parts.push(section('Timeline', `<ul class="cr-sp-list">${data.timeline.map(t =>
      `<li><b>${esc(t.time)}</b> ${esc(t.title)}: ${esc(t.summary)}</li>`).join('')}</ul>`));
  }
  parts.push(section('Keep in mind', bullets(data.caveats)));
  body.innerHTML = parts.filter(Boolean).join('');
  showPane('result');
}

function renderDocument(data, label) {
  const body = el('result-body');
  const parts = [];

  parts.push(`<div class="cr-sp-file"><b>${esc(label || 'Document')}</b><span>${esc((data.doc_type || '').replace(/_/g, ' '))}</span></div>`);
  parts.push(section('What this is', `<p class="cr-sp-lede">${esc(data.doc_tldr)}</p>`
    + (data.verdict_note ? `<p class="cr-sp-note">${esc(data.verdict_note)}</p>` : '')
    + (data.the_ask ? `<p class="cr-sp-note"><b>The ask:</b> ${esc(data.the_ask)}</p>` : '')));

  if (data.flags?.length) {
    parts.push(section('Where the BS is', `<ul class="cr-sp-list">${data.flags.map(f =>
      `<li>“${esc(f.quote)}”<br><b>Plainly:</b> ${esc(f.plain)}<br><b>Ask:</b> ${esc(f.ask)}</li>`).join('')}</ul>`));
  }
  parts.push(section('What holds up', bullets(data.holds_up)));

  if (data.clauses?.length) {
    parts.push(section('The shenanigans', `<ul class="cr-sp-list">${data.clauses.map(c =>
      `<li><b>[${esc(c.risk)}]</b> “${esc(c.quote)}”<br><b>Means:</b> ${esc(c.plain)}<br><b>Redline:</b> ${esc(c.counter)}</li>`).join('')}</ul>`));
  }
  if (data.asymmetries?.length) {
    parts.push(section('Them vs. you', `<ul class="cr-sp-list">${data.asymmetries.map(a =>
      `<li><b>Them:</b> ${esc(a.them)}<br><b>You:</b> ${esc(a.you)}</li>`).join('')}</ul>`));
  }
  if (data.exits?.length) {
    parts.push(section('Ways out', `<ul class="cr-sp-list">${data.exits.map(x =>
      `<li><b>${esc(x.route)}</b> (${esc(x.strength)})<br>${esc(x.how)}<br><i>${esc(x.basis)}</i></li>`).join('')}</ul>`));
  }
  parts.push(section('Your leverage', bullets(data.leverage)));
  parts.push(section('What is missing', bullets(data.missing)));

  if (data.jargon?.length) {
    parts.push(section('Jargon, decoded', `<ul class="cr-sp-list">${data.jargon.map(j =>
      `<li><b>${esc(j.term)}</b>: ${esc(j.means)}</li>`).join('')}</ul>`));
  }
  if (data.for_pro?.length) {
    parts.push(section('Take to a professional', `<ul class="cr-sp-list">${data.for_pro.map(q =>
      `<li><b>[${esc(q.who)}]</b> ${esc(q.question)}<br><i>${esc(q.stakes)}</i></li>`).join('')}</ul>`));
  }
  if (data.truncated) {
    parts.push(`<p class="cr-sp-truncated">Long document. The middle was sampled, not read in full.</p>`);
  }
  parts.push(`<p class="cr-sp-truncated">Not legal, financial or tax advice. No attorney-client relationship.</p>`);

  body.innerHTML = parts.filter(Boolean).join('');
  showPane('result');
}

// ── Copy ──────────────────────────────────────────────────────────────────────
function copyResult() {
  if (!lastResult) return;
  const text = el('result-body').innerText.trim()
    + '\n\nAnalyzed by Clear Read · github.com/plaxerx/ClearRead';
  navigator.clipboard.writeText(text).then(() => {
    const b = el('btn-copy');
    b.textContent = 'Copied';
    setTimeout(() => { b.textContent = 'Copy analysis'; }, 1800);
  });
}

// ── Wiring ────────────────────────────────────────────────────────────────────
const dropzone = el('dropzone');
const fileInput = el('file-input');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) runDocumentFromFile(fileInput.files[0]);
  fileInput.value = ''; // let the same file be picked twice in a row
});

['dragenter', 'dragover'].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', e => {
  const file = e.dataTransfer?.files?.[0];
  if (file) runDocumentFromFile(file);
});

el('btn-page').addEventListener('click', runPageTldr);
el('btn-page-doc').addEventListener('click', runDocumentFromPage);
el('btn-copy').addEventListener('click', copyResult);
const goHome = () => { setMode(''); showPane('home'); };
el('btn-back').addEventListener('click', goHome);
el('btn-back-error').addEventListener('click', goHome);

// The popup routes its two buttons through here so the click that opens the panel
// is the same gesture that starts the work.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SIDE_PANEL_TASK') {
    boundTabId = msg.tabId ?? null;
    if (msg.task === 'page') runPageTldr();
    if (msg.task === 'document') showPane('home');
    if (msg.task === 'selection' && msg.text) {
      setMode('Document');
      analyzeDocumentText({
        text: msg.text, title: msg.title || 'Selected text',
        source: 'selection', label: 'Selected text'
      });
    }
  }
  if (msg.type === 'THEME_CHANGED') applyTheme(msg.theme);
  if (msg.type === 'PROVIDER_CHANGED') el('cr-sp-brand-label').textContent = `Powered by ${msg.label}`;
});

(async () => {
  const [theme, provider] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_THEME' }),
    chrome.runtime.sendMessage({ type: 'GET_PROVIDER' })
  ]);
  applyTheme(theme?.theme || 'system');
  if (provider?.label) el('cr-sp-brand-label').textContent = `Powered by ${provider.label}`;

  const tab = await activeTab();
  if (tab && /^https?:\/\/(?:[^/]+\.)?youtube\.com\/(?:watch|shorts)/i.test(tab.url || '')) {
    el('btn-page-label').textContent = 'TL;DR this video';
  }
})();
