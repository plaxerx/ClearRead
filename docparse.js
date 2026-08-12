// Clear Read: document text extraction for the side panel.
//
// PDF goes through the vendored pdf.js. DOCX is unzipped here rather than with a
// library: a .docx is a ZIP, and Chrome can inflate raw deflate streams natively,
// so the only thing missing is ~60 lines of central-directory parsing.

// pdf.js is a megabyte and most documents are not PDFs, so it loads on first use
// rather than on import. This also keeps the module importable outside a browser.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdfjs/pdf.mjs').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
      return mod;
    });
  }
  return pdfjsPromise;
}

export const MAX_DOC_CHARS = 120000;
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.rtf'];

export function describeAccept() {
  return '.pdf,.docx,.txt,.md,.markdown,.rtf';
}

// ── ZIP ───────────────────────────────────────────────────────────────────────
// Reads the end-of-central-directory record, walks the file headers, and inflates
// the one entry we care about. Stored (method 0) and deflated (method 8) only,
// which is everything Word actually emits.

function findEocd(view, bytes) {
  // The record is 22 bytes plus an optional comment, so scan back from the end.
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buffer, wantedName) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEocd(view, bytes);
  if (eocd < 0) throw new Error('That file is not a valid DOCX (no ZIP directory found).');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method     = view.getUint16(p + 10, true);
    const compSize   = view.getUint32(p + 20, true);
    const nameLen    = view.getUint16(p + 28, true);
    const extraLen   = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff   = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (name === wantedName) {
      // The local header repeats the name and extra fields with its own lengths.
      const lNameLen  = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + compSize);
      return method === 0 ? raw : await inflateRaw(raw);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

function docxXmlToText(xml) {
  return xml
    // Paragraph and line breaks become real newlines before tags are stripped.
    .replace(/<w:p[ >][\s\S]*?(?=<w:p[ >]|$)/g, m => m + '\n')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    // Drop deleted text so tracked-change markup does not read as live terms.
    .replace(/<w:delText[\s\S]*?<\/w:delText>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(file) {
  const buffer = await file.arrayBuffer();
  const doc = await readZipEntry(buffer, 'word/document.xml');
  if (!doc) throw new Error('No document body found inside that DOCX.');
  const text = docxXmlToText(new TextDecoder().decode(doc));
  if (!text) throw new Error('That DOCX has no readable text in it.');
  return { text, kind: 'docx', pages: null };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function extractPdf(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      // Non-embedded fonts need this to map glyphs back to unicode, so without it
      // getTextContent can return mojibake on otherwise ordinary PDFs.
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/')
    }).promise;
  } catch (err) {
    if (/password/i.test(err?.message || '')) {
      throw new Error('That PDF is password-protected. Unlock it and try again.');
    }
    throw new Error(`Could not read that PDF: ${err.message}`);
  }

  const parts = [];
  let chars = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress?.(n, pdf.numPages);
    const content = await (await pdf.getPage(n)).getTextContent();
    // Items carry their own line breaks in hasEOL; without it everything runs together.
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    const pageText = lines.join('\n').replace(/[ \t]+/g, ' ').trim();
    if (pageText) { parts.push(pageText); chars += pageText.length; }
    if (chars > MAX_DOC_CHARS * 1.5) break; // enough to hit the cap after trimming
  }

  const text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    throw new Error('That PDF has no selectable text. It is probably a scan. Clear Read cannot OCR it.');
  }
  return { text, kind: 'pdf', pages: pdf.numPages };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function extractDocumentText(file, onProgress) {
  const name = (file.name || '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));

  if (file.size > 40 * 1024 * 1024) throw new Error('That file is over 40MB. Trim it down first.');

  let result;
  if (ext === '.pdf' || file.type === 'application/pdf') {
    result = await extractPdf(file, onProgress);
  } else if (ext === '.docx') {
    result = await extractDocx(file);
  } else if (TEXT_EXTENSIONS.includes(ext) || (file.type || '').startsWith('text/')) {
    result = { text: (await file.text()).trim(), kind: 'text', pages: null };
  } else if (ext === '.doc') {
    throw new Error('Legacy .doc is not supported. Save it as .docx or PDF first.');
  } else if (ext === '.pages') {
    throw new Error('Pages files are not supported. Export to PDF or DOCX first.');
  } else {
    throw new Error(`Cannot read ${ext || 'that file type'}. Use PDF, DOCX, or plain text.`);
  }

  if (!result.text) throw new Error('That file came back empty.');
  return { ...result, name: file.name, chars: result.text.length };
}
