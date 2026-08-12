const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// docparse.js is an ES module that lazily imports pdf.js, so it can be loaded in
// Node as long as nothing touches a PDF. Import it through a tiny ESM shim.
const MODULE = path.join(__dirname, '..', 'docparse.js');

async function load() {
  return import('file://' + MODULE.replace(/\\/g, '/'));
}

// Builds a real .docx in memory: a ZIP holding word/document.xml, deflated.
async function makeDocx(documentXml) {
  const { deflateRawSync, crc32 } = require('node:zlib');
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(documentXml, 'utf8');
  const comp = deflateRawSync(body);
  const crc = crc32 ? crc32(body) : require('node:zlib').crc32(body);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);

  const localChunk = Buffer.concat([local, name, comp]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralChunk = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralChunk.length, 12);
  eocd.writeUInt32LE(localChunk.length, 16);

  return Buffer.concat([localChunk, centralChunk, eocd]);
}

function asFile(buffer, filename) {
  return {
    name: filename,
    size: buffer.length,
    type: '',
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length),
    text: async () => buffer.toString('utf8')
  };
}

test('reads text out of a real deflated DOCX', async () => {
  const { extractDocumentText } = await load();
  const xml = '<w:document><w:body>'
    + '<w:p><w:r><w:t>Section 1. Dues</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Member agrees to pay </w:t></w:r><w:r><w:t>all fines imposed.</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const buf = await makeDocx(xml);
  const out = await extractDocumentText(asFile(buf, 'dues.docx'));
  assert.equal(out.kind, 'docx');
  assert.match(out.text, /Section 1\. Dues/);
  // Runs inside one paragraph must join without a break between them.
  assert.match(out.text, /Member agrees to pay all fines imposed\./);
});

test('drops tracked deletions so removed terms are not read as live', async () => {
  const { extractDocumentText } = await load();
  const xml = '<w:document><w:body><w:p>'
    + '<w:r><w:t>Fee is </w:t></w:r>'
    + '<w:del><w:r><w:delText>$500</w:delText></w:r></w:del>'
    + '<w:ins><w:r><w:t>$750</w:t></w:r></w:ins>'
    + '</w:p></w:body></w:document>';
  const buf = await makeDocx(xml);
  const out = await extractDocumentText(asFile(buf, 'redline.docx'));
  assert.match(out.text, /\$750/);
  assert.doesNotMatch(out.text, /\$500/);
});

test('unescapes XML entities', async () => {
  const { extractDocumentText } = await load();
  const xml = '<w:document><w:body><w:p><w:r><w:t>Tom &amp; Jerry &lt;LLC&gt;</w:t></w:r></w:p></w:body></w:document>';
  const buf = await makeDocx(xml);
  const out = await extractDocumentText(asFile(buf, 'e.docx'));
  assert.equal(out.text, 'Tom & Jerry <LLC>');
});

test('reads plain text files', async () => {
  const { extractDocumentText } = await load();
  const buf = Buffer.from('  just some terms  ', 'utf8');
  const out = await extractDocumentText(asFile(buf, 'notes.txt'));
  assert.equal(out.text, 'just some terms');
  assert.equal(out.kind, 'text');
});

test('rejects formats it cannot read, by name', async () => {
  const { extractDocumentText } = await load();
  const buf = Buffer.from('x');
  await assert.rejects(() => extractDocumentText(asFile(buf, 'old.doc')), /Save it as \.docx or PDF/);
  await assert.rejects(() => extractDocumentText(asFile(buf, 'deck.key')), /Use PDF, DOCX, or plain text/);
});

test('rejects oversized files before reading them', async () => {
  const { extractDocumentText } = await load();
  const fake = { name: 'huge.pdf', size: 41 * 1024 * 1024, type: 'application/pdf' };
  await assert.rejects(() => extractDocumentText(fake), /over 40MB/);
});
