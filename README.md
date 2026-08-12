# Clear Read

Summarize content, flag any bias or AI-generation, call out any smelly bs. Fight AI using AI! Consulting firms need not apply.

**Alpha.** Not on the Chrome Web Store. Load it unpacked and bring your own API key.

## What it does

Nothing runs on its own. Every mode is something you trigger.

| Mode | Trigger | What you get |
|---|---|---|
| **Text** | Highlight 160+ characters | TL;DR, an AI-generated rating on a 7-point human-to-AI scale, a copycat check that links the original if it finds one, a political bias bar, and who owns and funds the site. Drag the panel by its header to get it out of the way |
| **Image** | Right-click an image | AI-generation verdict, the artifacts behind it, and a guess at the generator |
| **Page** | Toolbar icon | Opens in the side panel, so it stays put while you scroll. Takeaway, key points, why it matters, caveats |
| **Video** | Toolbar icon on a captioned YouTube page | Same as Page, plus a clickable timeline |
| **Reddit** | Blue TL;DR button next to Share | Thread summary, the themes, discussion lean, bot likelihood, and what the top, bottom and controversial comments actually say |
| **Document** | Drop a file in the side panel, right-click a selection, or check the page you're on | See below |

Summaries are capped at 10% of the original, targeting 5%. A summary you could've got by skimming isn't a summary.

## Document check

A vendor document is usually a pitch and a contract at the same time, so there's no mode to pick. It looks for both and reports whichever is actually there.

Takes **PDF, DOCX, or plain text**. PDFs are read locally with a bundled copy of pdf.js; nothing leaves your machine until the text is extracted and you're looking at it.

| Section | What it does |
|---|---|
| **What this is** | The document in plain words, plus what they want from you |
| **Where the BS is** | Their exact words, what it means in plain English, and the one question that would confirm or kill it |
| **What holds up** | The parts that survive. A specific pitch is supposed to score low |
| **The shenanigans** | Flagged clauses across 21 types, each with what it means and the redline to send back |
| **Them vs. you** | The asymmetry table, which is the clearest read on one-sidedness you'll get |
| **Ways out** | Notice windows, vendor-side triggers, failed conditions, and commonly-unenforceable terms, rated strong, moderate or thin |
| **Your leverage** | What you hold and can trade |
| **Jargon** | A decoder, and questions formatted to paste into an email to a lawyer |

Eleven claim flag types: unfalsifiable, vague metric, fake precision, no mechanism, cherry-pick, correlation, name-drop, circular, hidden cost, urgency, no agency.

Ways out won't suggest breach, fraud or misrepresentation.

It doesn't state legal conclusions. "This clause is unenforceable" is out of bounds, "ask whether this reads as a penalty rather than liquidated damages in your state" is the point. That's deliberate, not a gap I haven't gotten to yet. Not legal, financial or tax advice.

## Requirements

A key from one of these. There's no backend and no account.

- **Anthropic**: `claude-sonnet-5`
- **OpenAI**: Responses API, `gpt-5.6-luna` for fast scoring and `gpt-5.6-sol` for pages, videos and documents

Both OpenAI roles are configurable in settings.

## Installation

1. Download or clone this repo
2. Open `chrome://extensions`
3. Turn on **Developer mode**, top right
4. **Load unpacked**, select the folder
5. Click the Clear Read icon, pick your provider, paste the key

The key sits in local Chrome storage and only ever goes to the provider you picked.

## What it costs you

You pay the provider directly, per call. Four things keep that down.

- Selections under 160 characters never reach the API. Single words and URLs get filtered before anything is sent. If you can't be bothered to read a tweet-length string yourself, this isn't for you.
- Around 90 common domains are classified locally for free, and when the domain is known the source taxonomy drops out of the prompt entirely.
- Identical text comes back from a 24-hour local cache.
- The plagiarism search only fires when copycat confidence is already high.

The document check never runs on the highlight path, so it costs nothing until you ask for it.

## Known limits

- **Chrome's PDF viewer still can't be read** by any extension, so "check this page" won't work on one. Download the PDF and drop the file into the side panel instead. That path works.
- **Scanned PDFs won't work.** If there's no selectable text there's nothing to extract, and Clear Read won't OCR it.
- New Reddit only. `old.reddit.com` has a different DOM, and the scraper only reads comments that are already loaded (no "load more" yet).
- Reddit moves its buttons around. If the anchor isn't found, the trigger falls back to a floating pill.
- The repo carries ~4MB of vendored pdf.js. That's the price of reading PDFs without a build step.
- Agreements past 120k characters get the middle sampled. Head and tail are kept because termination and arbitration clauses live at the end. The panel tells you when that happened.
- It's a language model. The scores are a reason to look closer, not a verdict.

## Development

No build step. Edit the files, reload the unpacked extension, hard-refresh the test tab. Content scripts only inject on page load, so an already-open tab keeps running the old code after a reload.

```bash
node --check background.js content.js domains.js settings.js youtube.js
```

```bash
node --test "tests/*.test.js"
```

## Vendored

[pdf.js](https://github.com/mozilla/pdf.js) v6.2.108, Apache-2.0, in `vendor/pdfjs`. Unmodified build output. It loads on first use, so it costs nothing unless you actually open a PDF.

## Credits

Made by [plaxerx](https://github.com/plaxerx), with development assistance from an AI, which is either ironic or the whole point.

## License

GPL-3.0, see [LICENSE](LICENSE). Derivatives stay open.
