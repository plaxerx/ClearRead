const test = require('node:test');
const assert = require('node:assert/strict');
const youtube = require('../youtube.js');

test('extracts caption tracks from YouTube player JSON', () => {
  const scripts = [
    'window.ytInitialPlayerResponse={"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc\\u0026lang=en","languageCode":"en","kind":"asr"}]}}};'
  ];
  const tracks = youtube.findCaptionTracks(scripts);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].languageCode, 'en');
  assert.equal(tracks[0].baseUrl, 'https://www.youtube.com/api/timedtext?v=abc&lang=en');
});

test('prefers a manual caption track in the user language', () => {
  const chosen = youtube.pickCaptionTrack([
    { languageCode: 'es', baseUrl: 'es' },
    { languageCode: 'en', kind: 'asr', baseUrl: 'auto-en' },
    { languageCode: 'en-US', baseUrl: 'manual-en' }
  ], ['en-US', 'en']);
  assert.equal(chosen.baseUrl, 'manual-en');
});

test('parses JSON3 captions into timestamped, deduplicated rows', () => {
  const rows = youtube.parseJson3Transcript({
    events: [
      { tStartMs: 0, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
      { tStartMs: 1000, segs: [{ utf8: 'Hello world' }] },
      { tStartMs: 65000, segs: [{ utf8: 'Second section' }] },
      { tStartMs: 70000, segs: [{ utf8: '[Music]' }] }
    ]
  });
  assert.deepEqual(rows, [
    { seconds: 0, time: '0:00', text: 'Hello world' },
    { seconds: 65, time: '1:05', text: 'Second section' }
  ]);
});

test('formats hour-long timestamps', () => {
  assert.equal(youtube.formatTimestamp(3723), '1:02:03');
});

test('falls back to timed-text XML captions', () => {
  const rows = youtube.parseTimedTextXml(
    '<transcript><text start="0">Tom &amp; Jerry</text><text start="65.2">Next &lt;topic&gt;</text></transcript>'
  );
  assert.deepEqual(rows, [
    { seconds: 0, time: '0:00', text: 'Tom & Jerry' },
    { seconds: 65.2, time: '1:05', text: 'Next' }
  ]);
});
