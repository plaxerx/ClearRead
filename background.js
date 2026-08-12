// Clear Read: Background Service Worker

importScripts('domains.js');

const PLAGIARISM_THRESHOLD = 85;
const CACHE_MAX = 50;       // max cached text analyses
const CACHE_TTL = 86400000; // 24h in ms
const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-luna',
  openaiSummary: 'gpt-5.6-sol'
};

const TEXT_PROMPT_BASE = `You are an expert text analyst. Analyze the text and return ONLY a valid JSON object (no markdown, no prose).

Fields:
- copycat_score (0-100|null): likelihood text is copied/plagiarized
- ai_score (0-100|null): likelihood written by an AI model
- bias_score (-100..100|null): political bias, -100 far left, 0 neutral, +100 far right
- copycat_note, ai_note, bias_note (string ≤60 chars|null): brief reason for each
- summary (string ≤160 chars): a plain-language TL;DR of what the text actually says. Its core claim or takeaway, not a description of your analysis
- too_short (bool): true if under ~160 chars or too little context. Then set all scores/notes null

AI signals: uniform sentence rhythm (low burstiness); hedging ("it's important to note"); formulaic both-sides framing and tidy conclusions; buzzwords (delve, tapestry, multifaceted, underscore, realm, navigate, landscape); em-dash triads; lack of typos, voice, opinion, or specific lived detail. Polished human writing can mimic these. Weigh holistically, don't over-flag.

Return ONLY:
{"too_short":bool,"copycat_score":num|null,"ai_score":num|null,"bias_score":num|null,"copycat_note":str|null,"ai_note":str|null,"bias_note":str|null,"summary":str{{SOURCE_FIELDS}}}`;

// Appended ONLY when the domain isn't already classified locally
const SOURCE_TAXONOMY = `

Also classify the source domain factually (no quality/reliability judgments):
- source_type: community_board | social_media | corporate_news | independent_news | public_broadcaster | government | academic | encyclopedia | satire | blog | aggregator | unknown
- source_note (≤90 chars|null): factual ownership/funding/content model. corporate_news → name parent company; independent_news/public_broadcaster → funding model; community_board/social_media → "user-generated…"; else describe plainly. Never comment on accuracy or trust.
- source_domain (string|null): domain with www. stripped
Add these to the JSON: "source_type","source_note","source_domain".`;

const IMAGE_SYSTEM_PROMPT = `You are an expert AI-generated image detector. Analyze the provided image and return ONLY a valid JSON object (no markdown, no explanation).

Examine carefully for: unnatural skin texture, extra/missing fingers, inconsistent lighting, warped backgrounds, garbled text, overly smooth gradients, symmetry artifacts, glassy eyes, impossible geometry, telltale signs of specific generators (Midjourney, DALL-E, Stable Diffusion, Firefly, etc.)

Return ONLY:
{
  "ai_score": number (0-100),
  "ai_note": "string (max 100 chars). A CONTEXTUAL insight that explains WHY this image could not be a real photograph or edited photo. Focus on physical or technical impossibilities, not just listing artifacts. E.g. 'The volumetric lighting and sub-surface skin scattering are computationally rendered, not photographically possible' or 'Specular highlights on hair strands show no consistent light source, ruling out photography or retouching'. Do NOT repeat the artifacts list.",
  "artifacts": ["string (array of up to 4 specific visual artifacts, each max 60 chars)"],
  "likely_generator": "string or null",
  "summary": "string (max 120 chars)"
}`;

// ── Document check ────────────────────────────────────────────────────────────
// A vendor document is usually a pitch and a contract at the same time. The deck
// that sells you the thing and the terms that bind you to it. Making the reader
// pick a mode up front meant picking the wrong one about half the time, so this
// looks for both and reports whichever is actually there.
const BS_FLAG_TYPES = [
  'unfalsifiable', 'vague_metric', 'fake_precision', 'no_mechanism', 'cherry_pick',
  'correlation', 'name_drop', 'circular', 'hidden_cost', 'urgency', 'no_agency'
];

const TERMS_CLAUSE_TYPES = [
  'auto_renew', 'notice_trap', 'acceleration', 'no_refund', 'exclusivity',
  'unilateral_change', 'fee_escalator', 'incorporation_by_reference',
  'asymmetric_termination', 'as_is', 'liability_cap', 'indemnity', 'arbitration',
  'venue', 'data_rights', 'auto_debit', 'survival', 'assignment',
  'unilateral_suspension', 'no_sla', 'unbounded_obligation'
];

const DOC_TYPES = [
  'pitch_deck', 'proposal', 'sow', 'quote', 'tos', 'order_form', 'msa', 'eula',
  'saas_agreement', 'privacy_policy', 'membership_terms', 'lease', 'mixed', 'other'
];

const DOC_PROMPT = `You are reading a document on behalf of the person being sold to or asked to sign. Read it through two lenses at once and report both.

LENS 1. THE CLAIMS. Bullshit is a claim that cannot be checked, cannot be wrong, or looks like a number but isn't one. Jargon by itself is not bullshit; jargon standing in for an absent mechanism is. Judge the claims, not the tone, the industry, or the politics.

Claim flag types:
- unfalsifiable: no outcome would prove it wrong ("drives synergies", "future-proof")
- vague_metric: a number with no baseline, denominator, sample, or time window ("up to 40% more efficient")
- fake_precision: decimals implying rigor the method can't support ("$4.7B TAM")
- no_mechanism: a result promised with no account of how it happens
- cherry_pick: one case study, a best case, or a survivor presented as typical
- correlation: a causal claim resting on correlation or co-occurrence
- name_drop: credibility borrowed from logos, clients, schools, or frameworks instead of evidence
- circular: the claim restates itself as its own proof
- hidden_cost: the result is stated; the work, time, headcount, or switching cost to get it is not
- urgency: manufactured scarcity, deadline, or fear of missing out
- no_agency: who actually does the work is unnamed ("efficiencies will be realized")

LENS 2. THE TERMS. Report what the document does to the person signing it, and what a balanced version would say instead.

Shenanigan types:
- auto_renew: renews itself unless the customer acts
- notice_trap: the cancellation window is narrow, oddly timed, or demands a specific method
- acceleration: leaving early means paying the rest of the term anyway
- no_refund: money paid is not coming back under any circumstance
- exclusivity: the customer may not use anyone else
- unilateral_change: the vendor can change the deal; the customer only gets told
- fee_escalator: prices rise at renewal to whatever the vendor's list price is by then
- incorporation_by_reference: binds the customer to documents at a URL the vendor controls and can edit
- asymmetric_termination: the vendor can exit on terms the customer cannot
- as_is: delivered with no warranty and no fitness promise
- liability_cap: the vendor's exposure is capped at a trivial amount
- indemnity: the customer covers the vendor's losses, not the reverse
- arbitration: courts and class actions are waived
- venue: disputes happen in the vendor's home state under the vendor's law
- data_rights: the vendor keeps, uses, or shares the customer's data
- auto_debit: standing authorization to pull money from an account
- survival: obligations outlive the agreement
- assignment: the vendor may hand the contract to someone else; the customer may not
- unilateral_suspension: the vendor can cut off service at its discretion
- no_sla: no uptime, support, or performance commitment at all
- unbounded_obligation: the customer's duty has no ceiling, definition, or end

APPLY ONLY WHAT FITS. Many documents are only one of these things. A pure terms-of-service has no pitch: return an empty flags array and null bs_score. A pure pitch deck has no binding terms: return an empty clauses array and null tilt. Do not manufacture findings to fill a section, and do not stretch a marketing line into a contract clause.

You are not the reader's lawyer, accountant, or advisor, and this is not advice. Your job is to get them ready to talk to one: strip the jargon, name what the document actually does, and hand over well-framed questions. Never state a legal conclusion. "This clause is unenforceable" is out of bounds; "ask whether this reads as a penalty rather than liquidated damages in your state" is the job. Enforceability varies by jurisdiction. When a clause is one courts commonly narrow or refuse to enforce, raise it as a question, never as a verdict. Never invent a claim or a clause that isn't in the text.

Return ONLY a valid JSON object (no markdown, no prose):
{
"doc_type": one of: pitch_deck, proposal, sow, quote, tos, order_form, msa, eula, saas_agreement, privacy_policy, membership_terms, lease, mixed, other,
"doc_tldr": str ≤200. What this document is and what it does to the reader, in plain words,
"verdict_note": str ≤120. The single most costly or least supportable thing in it, named plainly,
"the_ask": str ≤90 | null. What they want from the reader (money, a signature, a meeting, headcount),
"bs_score": 0-100 | null. How much of the case rests on claims that can't be checked. null when the document makes no case,
"tilt": -100..100 | null. Who the agreement favors. -100 entirely the customer, 0 genuinely balanced, +100 entirely the vendor. Judge by remedies, exits, and who carries risk, not by tone. null when nothing here binds anyone,
"flags": [{"quote": str ≤90. Their words, verbatim, "type": one of the claim flag types, "plain": str ≤110. What the claim actually says once the jargon is gone, "ask": str ≤100. The one question to the vendor that would confirm or kill it}]. Up to 5, worst first,
"holds_up": [str ≤120]. Up to 4 claims that are specific, checkable, or genuinely useful, and what makes them real,
"clauses": [{"quote": str ≤100. Verbatim from the text, "type": one of the shenanigan types, "plain": str ≤110. What it means for the customer in practice, "risk": "low" | "medium" | "high", "counter": str ≤110. The specific redline to ask for}]. Up to 6, worst first,
"asymmetries": [{"them": str ≤90. What the vendor may do, "you": str ≤90. What the customer may do in that same situation}]. Up to 4, only where the text genuinely treats the sides differently,
"exits": [{"route": str ≤50, "how": str ≤120. The concrete step and its timing, "basis": str ≤90. The clause number or doctrine it rests on, "strength": "strong" | "moderate" | "thin"}]. Up to 4 legitimate ways out: notice windows and the date they fall on, vendor-side triggers the customer can cause honestly, conditions precedent never met, and terms commonly held unenforceable. Never suggest breach, fraud, misrepresentation, or hiding anything,
"leverage": [str ≤110]. Up to 4 things the customer actually holds and can trade: renewal timing, exclusivity being asked for, references, volume, payment terms, a competing bid,
"missing": [str ≤100]. Up to 4 things a serious, balanced version of this document would contain and this one doesn't,
"jargon": [{"term": str ≤40. The buzzword or legalese as it appears, "means": str ≤110. What it actually denotes here, or "nothing specific" when that is the honest answer}]. Up to 6, only terms present in the text, skip if the document is already plain,
"for_pro": [{"question": str ≤150. Phrased so a professional can act on it: name the clause or claim, name the mechanism, ask the narrow question, "who": "lawyer" | "accountant" | "technical" | "either", "stakes": str ≤110. What turns on the answer, in dollars or concrete exposure wherever the document lets you compute it}]. Up to 5, ordered by how much money or risk rides on the answer
}
Quote their exact words. Every "counter" must be something a customer could hand a vendor as a redline. Every "for_pro" question must be narrow enough to answer in one meeting. Never "is this contract fair?". If the document is genuinely fair and well-supported, say so and keep the lists short rather than manufacturing grievances.`;

const strArray = max => ({ type: 'array', items: { type: 'string' }, maxItems: max });
const objArray = (max, props) => ({
  type: 'array',
  maxItems: max,
  items: { type: 'object', additionalProperties: false, properties: props, required: Object.keys(props) }
});

const DOC_SCHEMA = {
  name: 'clear_read_document',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      doc_type: { type: 'string', enum: DOC_TYPES },
      doc_tldr: { type: 'string' },
      verdict_note: { type: 'string' },
      the_ask: { type: ['string', 'null'] },
      bs_score: { type: ['number', 'null'] },
      tilt: { type: ['number', 'null'] },
      flags: objArray(5, {
        quote: { type: 'string' },
        type: { type: 'string', enum: BS_FLAG_TYPES },
        plain: { type: 'string' },
        ask: { type: 'string' }
      }),
      holds_up: strArray(4),
      clauses: objArray(6, {
        quote: { type: 'string' },
        type: { type: 'string', enum: TERMS_CLAUSE_TYPES },
        plain: { type: 'string' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        counter: { type: 'string' }
      }),
      asymmetries: objArray(4, { them: { type: 'string' }, you: { type: 'string' } }),
      exits: objArray(4, {
        route: { type: 'string' },
        how: { type: 'string' },
        basis: { type: 'string' },
        strength: { type: 'string', enum: ['strong', 'moderate', 'thin'] }
      }),
      leverage: strArray(4),
      missing: strArray(4),
      jargon: objArray(6, { term: { type: 'string' }, means: { type: 'string' } }),
      for_pro: objArray(5, {
        question: { type: 'string' },
        who: { type: 'string', enum: ['lawyer', 'accountant', 'technical', 'either'] },
        stakes: { type: 'string' }
      })
    },
    required: [
      'doc_type', 'doc_tldr', 'verdict_note', 'the_ask', 'bs_score', 'tilt', 'flags',
      'holds_up', 'clauses', 'asymmetries', 'exits', 'leverage', 'missing', 'jargon', 'for_pro'
    ]
  }
};

const SOURCE_SEARCH_PROMPT = `You are a plagiarism source finder. Use web_search to find the original source. Return ONLY JSON:
If found: { "source_url": "https://...", "source_title": "string", "source_domain": "string", "match_confidence": "exact" | "near-exact" | "partial" }
If not found: { "source_url": null, "source_title": null, "source_domain": null, "match_confidence": "none" }`;

// ── Init ──────────────────────────────────────────────────────────────────────

const CONTEXT_MENU_ITEMS = [
  { id: 'clear-read-smart', title: '◈ Clear Read. Analyze image',        contexts: ['all'] },
  { id: 'clear-read-doc',   title: '◈ Clear Read. Check this as a document', contexts: ['selection'] }
];

// Always re-register context menu on every service worker startup (not just onInstalled)
// This is required in MV3. Context menus don't persist across browser restarts
function initExtension() {
  chrome.storage.local.get(['enabled'], (r) => {
    const enabled = r.enabled !== false;
    if (r.enabled === undefined) chrome.storage.local.set({ enabled: true });
    updateIcon(enabled);
    registerContextMenu(enabled);
  });
}

chrome.runtime.onInstalled.addListener(initExtension);
chrome.runtime.onStartup.addListener(initExtension);

// Also run immediately when service worker activates
initExtension();

// ── Icon + context menu helpers ───────────────────────────────────────────────
function updateIcon(enabled) {
  const s = enabled ? '' : '_off';
  chrome.action.setIcon({ path: { 16: `icons/icon16${s}.png`, 48: `icons/icon48${s}.png`, 128: `icons/icon128${s}.png` } });
  chrome.action.setTitle({ title: enabled ? 'Clear Read. Enabled' : 'Clear Read. Disabled' });
}

function registerContextMenu(enabled) {
  chrome.contextMenus.removeAll(() => {
    if (!enabled) return;
    CONTEXT_MENU_ITEMS.forEach(item => {
      chrome.contextMenus.create(item, () => {
        if (chrome.runtime.lastError) console.warn('Context menu:', chrome.runtime.lastError.message);
      });
    });
  });
}

// ── Context menu ──────────────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'clear-read-doc') {
    chrome.storage.local.get(['enabled'], async (r) => {
      if (r.enabled === false) return;
      try {
        // The click is the user gesture sidePanel.open() requires, so it has to
        // happen here rather than after any await on storage.
        await chrome.sidePanel.open({ tabId: tab.id });
        chrome.runtime.sendMessage({
          type: 'SIDE_PANEL_TASK', task: 'selection', tabId: tab.id,
          text: info.selectionText || '', title: tab.title || ''
        }).catch(() => {});
      } catch { /* panel unavailable on this surface */ }
    });
    return;
  }
  if (info.menuItemId !== 'clear-read-smart') return;
  chrome.storage.local.get(['enabled'], (r) => {
    if (r.enabled === false) return;
    // Ask content script for the image it found at the right-clicked element
    chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT_IMAGE' }, (response) => {
      if (chrome.runtime.lastError || !response?.srcUrl) {
        // Nothing found. Notify user
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_NO_IMAGE_TOAST' }).catch(() => {});
        return;
      }
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_IMAGE_PANEL',
        srcUrl: response.srcUrl,
        x: response.x,
        y: response.y
      }).catch(() => {});
    });
  });
});

// ── Messages ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_TEXT')  { analyzeText(msg.text, msg.domain).then(sendResponse); return true; }
  if (msg.type === 'ANALYZE_IMAGE') { analyzeImage(msg.srcUrl).then(sendResponse); return true; }
  if (msg.type === 'ANALYZE_REDDIT_THREAD') { analyzeRedditThread(msg.title, msg.payload).then(sendResponse); return true; }
  if (msg.type === 'ANALYZE_PAGE') { analyzePage(msg).then(sendResponse); return true; }
  if (msg.type === 'ANALYZE_DOCUMENT') { analyzeDocument(msg).then(sendResponse); return true; }

  if (msg.type === 'SAVE_API_SETTINGS') {
    saveApiConfig(msg).then(() => {
      chrome.tabs.query({}, (tabs) => {
        const label = providerLabel(msg.provider);
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'PROVIDER_CHANGED', provider: msg.provider, label }).catch(() => {}));
      });
      sendResponse({ success: true });
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'GET_API_SETTINGS') {
    getApiConfig(msg.provider).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_PROVIDER') {
    getApiConfig().then(config => sendResponse({ provider: config.provider, label: providerLabel(config.provider) }));
    return true;
  }
  // Legacy popup compatibility for installations upgrading from <=2.3.1.
  if (msg.type === 'SAVE_API_KEY') {
    getApiConfig().then(config => saveApiConfig({
      provider: config.provider, key: msg.key,
      model: config.model, summaryModel: config.summaryModel
    }))
      .then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.type === 'GET_API_KEY') {
    getApiConfig().then(config => sendResponse({ key: config.key }));
    return true;
  }
  if (msg.type === 'GET_ENABLED') {
    chrome.storage.local.get(['enabled'], (r) => sendResponse({ enabled: r.enabled !== false }));
    return true;
  }
  if (msg.type === 'GET_THEME') {
    chrome.storage.local.get(['theme'], (r) => sendResponse({ theme: r.theme || 'system' }));
    return true;
  }
  if (msg.type === 'SET_THEME') {
    chrome.storage.local.set({ theme: msg.theme }, () => {
      // Broadcast theme change to all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'THEME_CHANGED', theme: msg.theme }).catch(() => {}));
      });
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.type === 'SET_ENABLED') {
    chrome.storage.local.set({ enabled: msg.enabled }, () => {
      updateIcon(msg.enabled);
      registerContextMenu(msg.enabled);
      // Notify all open tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'ENABLED_CHANGED', enabled: msg.enabled }).catch(() => {}));
      });
      sendResponse({ success: true });
    });
    return true;
  }
});

// ── AI provider adapters ──────────────────────────────────────────────────────
function providerLabel(provider) {
  return provider === 'openai' ? 'OpenAI' : 'Claude';
}

async function getApiConfig(requestedProvider) {
  const saved = await chrome.storage.local.get([
    'provider', 'apiKey', 'anthropicApiKey', 'openaiApiKey', 'openaiModel', 'openaiSummaryModel'
  ]);
  const provider = ['anthropic', 'openai'].includes(requestedProvider)
    ? requestedProvider
    : (['anthropic', 'openai'].includes(saved.provider) ? saved.provider : DEFAULT_PROVIDER);
  const key = provider === 'openai'
    ? (saved.openaiApiKey || '')
    : (saved.anthropicApiKey || saved.apiKey || '');
  const model = provider === 'openai'
    ? (saved.openaiModel || DEFAULT_MODELS.openai)
    : DEFAULT_MODELS.anthropic;
  const summaryModel = provider === 'openai'
    ? (saved.openaiSummaryModel || DEFAULT_MODELS.openaiSummary)
    : DEFAULT_MODELS.anthropic;
  return { provider, key, model, summaryModel };
}

async function saveApiConfig({ provider, key, model, summaryModel }) {
  if (!['anthropic', 'openai'].includes(provider)) throw new Error('Unsupported AI provider.');
  const changes = { provider };
  if (provider === 'openai') {
    changes.openaiApiKey = key;
    changes.openaiModel = (model || DEFAULT_MODELS.openai).trim();
    changes.openaiSummaryModel = (summaryModel || DEFAULT_MODELS.openaiSummary).trim();
  } else {
    changes.anthropicApiKey = key;
  }
  await chrome.storage.local.set(changes);
}

async function callClaude(apiKey, options) {
  // Sonnet 5 runs adaptive thinking by default; disable it for instant JSON output.
  // Thinking tokens would count against max_tokens and add seconds of latency.
  const body = { thinking: { type: 'disabled' }, ...options };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let e = {}; try { e = JSON.parse(t); } catch(_) {}
    if (r.status === 401) throw new Error(`Auth failed (401): ${e.error?.message || 'Invalid API key'}`);
    if (r.status === 403) throw new Error(`Forbidden (403): ${e.error?.message || 'Access denied'}`);
    if (r.status === 429) throw new Error('Rate limited. Try again in a moment.');
    throw new Error(`API error ${r.status}: ${e.error?.message || t || 'Unknown error'}`);
  }
  return r.json();
}

function toOpenAIContent(content) {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return { type: 'input_text', text: part.text };
    if (part.type === 'image' && part.source?.type === 'base64') {
      return {
        type: 'input_image',
        image_url: `data:${part.source.media_type};base64,${part.source.data}`,
        detail: 'auto'
      };
    }
    throw new Error(`Unsupported OpenAI input type: ${part.type}`);
  });
}

async function callOpenAI(apiKey, options) {
  const body = {
    model: options.model,
    instructions: options.system,
    input: options.messages.map(message => ({
      role: message.role,
      content: toOpenAIContent(message.content)
    })),
    max_output_tokens: options.max_tokens,
    store: false
  };
  if (/^gpt-5(?:\.|-|$)/i.test(options.model)) {
    body.reasoning = { effort: options.reasoning_effort || 'none' };
  }
  if (options.json_schema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: options.json_schema.name,
        strict: true,
        schema: options.json_schema.schema
      }
    };
  }
  if (options.tools?.length) body.tools = [{ type: 'web_search' }];

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let e = {}; try { e = JSON.parse(t); } catch(_) {}
    const message = e.error?.message || t || 'Unknown error';
    if (r.status === 401) throw new Error(`Auth failed (401): ${message}`);
    if (r.status === 403) throw new Error(`Forbidden (403): ${message}`);
    if (r.status === 429) throw new Error('Rate limited. Try again in a moment.');
    throw new Error(`API error ${r.status}: ${message}`);
  }
  return r.json();
}

function extractModelText(provider, response) {
  if (provider === 'anthropic') {
    return (response.content || []).filter(block => block.type === 'text').map(block => block.text || '').join('\n');
  }
  return (response.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text || '')
    .join('\n');
}

async function callModel(config, options) {
  const { reasoning_effort, json_schema, ...common } = options;
  const request = { ...common, model: options.model || config.model };
  const response = config.provider === 'openai'
    ? await callOpenAI(config.key, { ...request, reasoning_effort, json_schema })
    : await callClaude(config.key, request);
  const text = extractModelText(config.provider, response);
  if (!text && config.provider === 'openai') {
    const refusal = (response.output || [])
      .flatMap(item => item.content || [])
      .find(part => part.type === 'refusal')?.refusal;
    if (refusal) throw new Error(`OpenAI refused this analysis: ${refusal}`);
  }
  return text;
}

function missingKeyError(config) {
  return `No ${providerLabel(config.provider)} API key set. Click the Clear Read icon to add one.`;
}

function cacheNamespace(config) {
  return `${config.provider}:${config.model}|`;
}

// Every prompt asks for a bare JSON object, but models still occasionally wrap it
// in prose or a code fence. Pull the outermost braces out and parse those.
function parseJsonBlock(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Long inputs keep their head and tail and drop the middle. headRatio decides the
// split: the default favours the opening, but agreements need most of the tail,
// where termination, arbitration, and venue clauses live.
function truncateHeadTail(text, maxChars, headRatio = 0.8) {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.round(maxChars * headRatio))
    + '\n\n[Middle content omitted for length]\n\n'
    + text.slice(-Math.round(maxChars * (1 - headRatio)));
}

// ── Lightweight text hash for caching ────────────────────────────────────────
function hashText(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return 'a' + (h >>> 0).toString(36);
}

async function getCachedAnalysis(key) {
  const { analysisCache } = await chrome.storage.local.get(['analysisCache']);
  if (!analysisCache || !analysisCache[key]) return null;
  const entry = analysisCache[key];
  if (Date.now() - entry.ts > CACHE_TTL) return null; // expired
  return entry.data;
}

async function setCachedAnalysis(key, data) {
  const { analysisCache } = await chrome.storage.local.get(['analysisCache']);
  const cache = analysisCache || {};
  cache[key] = { data, ts: Date.now() };
  // Evict oldest if over limit
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => cache[a].ts - cache[b].ts);
    delete cache[keys[0]];
  }
  chrome.storage.local.set({ analysisCache: cache });
}

async function analyzeText(text, domain) {
  const config = await getApiConfig();
  if (!config.key) return { error: missingKeyError(config) };
  const truncated = text.length > 3000 ? text.substring(0, 3000) + '...' : text;

  // ── Cache check. Identical text+domain returns instantly, no API call ──────
  const cacheKey = hashText('v24|' + cacheNamespace(config) + truncated + '|' + (domain || ''));
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return { data: cached, cached: true };

  // ── Local domain lookup. Resolve source type for free when we know it ──────
  const localSource = lookupDomain(domain);

  // Build the system prompt: lean (text-only) when we already know the source,
  // full (text + source taxonomy) only when the domain is unknown.
  const needsSourceClassification = domain && !localSource;
  const systemPrompt = TEXT_PROMPT_BASE.replace(
    '{{SOURCE_FIELDS}}',
    needsSourceClassification ? ',"source_type":str,"source_note":str|null,"source_domain":str' : ''
  ) + (needsSourceClassification ? SOURCE_TAXONOMY : '');

  const domainLine = needsSourceClassification ? `\n\nSource domain: ${domain}` : '';

  try {
    const raw = await callModel(config, {
      max_tokens: 680, system: systemPrompt,
      messages: [{ role: 'user', content: `Analyze this text:${domainLine}\n\n${truncated}` }]
    });
    const data = parseJsonBlock(raw);
    if (!data) return { error: 'Could not parse analysis response.' };
    if (data.too_short !== true && typeof data.copycat_score !== 'number' && typeof data.ai_score !== 'number')
      return { error: 'Unexpected response format.' };
    if (!data.too_short && data.copycat_score >= PLAGIARISM_THRESHOLD) {
      try {
        const src = await findSource(config, truncated);
        if (src?.source_url) {
          // Self-match: if the found source is the same site we're on, it's not plagiarism
          const srcDomain  = (src.source_domain || '').replace(/^www\./, '');
          const pageDomain = (domain || '').replace(/^www\./, '');
          const isSelf = srcDomain && pageDomain && (
            srcDomain === pageDomain ||
            srcDomain.endsWith('.' + pageDomain) ||
            pageDomain.endsWith('.' + srcDomain)
          );
          if (!isSelf) {
            Object.assign(data, src);
          } else {
            data.copycat_score = Math.min(data.copycat_score, 18);
            data.copycat_note = 'Original content from this site';
          }
        }
      } catch(e) { console.warn('Source search failed:', e.message); }
    }

    // Merge local source classification (free, accurate) over whatever the model returned
    if (localSource) {
      data.source_type   = localSource[0];
      data.source_note   = localSource[1];
      data.source_domain = (domain || '').replace(/^www\./, '');
    }

    // Cache the final result for fast, free repeat lookups
    await setCachedAnalysis(cacheKey, data);

    return { data };
  } catch(err) { return { error: err.message }; }
}

async function analyzeImage(srcUrl) {
  const config = await getApiConfig();
  if (!config.key) return { error: missingKeyError(config) };
  try {
    const imgR = await fetch(srcUrl);
    if (!imgR.ok) throw new Error(`Could not fetch image (${imgR.status})`);
    const mediaType = (imgR.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(mediaType))
      return { error: `Unsupported image type: ${mediaType}` };
    const bytes = new Uint8Array(await imgR.arrayBuffer());
    if (bytes.length > 5*1024*1024) return { error: 'Image too large (max 5MB).' };
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    const raw = await callModel(config, {
      max_tokens: 680, system: IMAGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Analyze this image for AI generation artifacts.' }
      ]}]
    });
    const data = parseJsonBlock(raw);
    if (!data) return { error: 'Could not parse image analysis response.' };
    if (typeof data.ai_score !== 'number') return { error: 'Unexpected image response format.' };
    return { data, mode: 'image' };
  } catch(err) { return { error: err.message }; }
}

async function findSource(config, text) {
  const excerpt = text.substring(0, 300).trim();
  const raw = await callModel(config, {
    max_tokens: 1400, system: SOURCE_SEARCH_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: `Find the original source:\n\n"${excerpt}"` }]
  });
  return parseJsonBlock(raw);
}

// ── Reddit thread analysis ────────────────────────────────────────────────────
const REDDIT_PROMPT = `You analyze Reddit comment threads. Input: post title, then comments as lines "[score|d<depth>] author: text". Higher depth = reply. Return ONLY valid JSON (no markdown):
{
"tldr": str ≤200. What the discussion is about and the overall sentiment,
"themes": [{"t": str ≤40, "s": str ≤110}]. The 2-3 main conversation threads, each with topic and the crowd's take,
"lean": num -100..100. Political lean of the DISCUSSION content, -100 far left, +100 far right, 0 if apolitical,
"lean_note": str ≤70 | null,
"bot_score": num 0-100. Likelihood of bot/copypasta/astroturf activity: repeated phrasing across authors, template comments, unnatural uniformity,
"bot_note": str ≤70 | null,
"top": str ≤140. Consensus of the highest-scored comments,
"bottom": str ≤140. What the lowest/negative-scored comments say,
"controversial": str ≤140. The most disputed take(s), judged by negative scores with pushback replies
}
Judge lean only from what commenters say, not the topic itself. Be specific, quote short fragments where useful.`;

async function analyzeRedditThread(title, payload) {
  const config = await getApiConfig();
  if (!config.key) return { error: missingKeyError(config) };

  const cacheKey = hashText('rt24|' + cacheNamespace(config) + title + '|' + payload.length + '|' + payload.slice(0, 1500));
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return { data: cached, cached: true };

  try {
    const raw = await callModel(config, {
      max_tokens: 1000, system: REDDIT_PROMPT,
      messages: [{ role: 'user', content: `Post: ${title}\n\nComments:\n${payload}` }]
    });
    const data = parseJsonBlock(raw);
    if (!data) return { error: 'Could not parse thread analysis.' };
    if (typeof data.tldr !== 'string') return { error: 'Unexpected response format.' };
    await setCachedAnalysis(cacheKey, data);
    return { data };
  } catch (err) { return { error: err.message }; }
}

// ── Whole-page TL;DR ──────────────────────────────────────────────────────────
const LONGFORM_PROMPT = `Synthesize the supplied page or timestamped video transcript into a faithful, useful brief.

Use only the supplied content. Preserve names, numbers, outcomes, and important uncertainty. Distinguish reported facts from the source's claims or opinions. Do not describe your process.

LENGTH IS THE POINT. A summary the reader could have got by skimming the original has failed. The user message gives a word budget: everything you return, all fields combined, must come in under it. Target half of it. Under budget with the important things in it beats complete and long. If you cannot fit a point, drop the least important one rather than shortening all of them into mush. Never pad to fill the budget.

For a page: give the core takeaway, 3-6 non-redundant points, why it matters when material, concrete details, and only meaningful caveats. Scale the point count to the source: a short piece gets 3, a long feature gets 6. Return an empty timeline.

For a video: summarize the spoken content, not the title or description alone. Build a 3-6 item timeline from the supplied timestamps. Auto-generated captions may contain transcription errors. AI-writing and copycat scores are not reliable from captions, so set those scores and notes to null.

Judge political bias from framing and word choice, not the topic. Use 0 for apolitical content.

Return only JSON with these exact keys: kind, content_type, tldr, points, why_it_matters, notable_details, caveats, timeline, ai_score, ai_note, copycat_score, copycat_note, bias_score, bias_note. Timeline items contain time, title, and summary.`;

const LONGFORM_SCHEMA = {
  name: 'clear_read_longform',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['page', 'video'] },
      content_type: { type: 'string', enum: ['news', 'opinion', 'explainer', 'interview', 'review', 'tutorial', 'entertainment', 'reference', 'other'] },
      tldr: { type: 'string' },
      points: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      why_it_matters: { type: ['string', 'null'] },
      notable_details: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      caveats: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      timeline: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            time: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' }
          },
          required: ['time', 'title', 'summary']
        }
      },
      ai_score: { type: ['number', 'null'] },
      ai_note: { type: ['string', 'null'] },
      copycat_score: { type: ['number', 'null'] },
      copycat_note: { type: ['string', 'null'] },
      bias_score: { type: ['number', 'null'] },
      bias_note: { type: ['string', 'null'] }
    },
    required: [
      'kind', 'content_type', 'tldr', 'points', 'why_it_matters',
      'notable_details', 'caveats', 'timeline', 'ai_score', 'ai_note',
      'copycat_score', 'copycat_note', 'bias_score', 'bias_note'
    ]
  }
};

async function analyzePage(request) {
  const config = await getApiConfig();
  if (!config.key) return { error: missingKeyError(config) };

  const kind = request.kind === 'video' ? 'video' : 'page';
  const sourceText = String(request.text || '');
  const maxChars = kind === 'video' ? 120000 : 80000;
  const truncated = truncateHeadTail(sourceText, maxChars);
  const meta = {
    title: String(request.title || '').slice(0, 500),
    domain: String(request.domain || '').slice(0, 200),
    author: String(request.meta?.author || '').slice(0, 300),
    published: String(request.meta?.published || '').slice(0, 100),
    description: String(request.meta?.description || '').slice(0, 1200),
    channel: String(request.meta?.channel || '').slice(0, 300),
    duration: String(request.meta?.duration || '').slice(0, 50),
    language: String(request.meta?.language || '').slice(0, 50),
    caption_kind: String(request.meta?.captionKind || '').slice(0, 50),
    word_count: Number(request.meta?.wordCount) || 0
  };
  // 10% of the source is the ceiling, 5% the target. Floored so a short page still
  // gets a usable brief, and capped so a book-length transcript doesn't earn an essay.
  const sourceWords = meta.word_count || truncated.split(/\s+/).length;
  const wordBudget = Math.max(90, Math.min(450, Math.round(sourceWords * 0.10)));

  const summaryConfig = { ...config, model: config.summaryModel };
  const prefix = kind === 'video' ? 'yt26|' : 'pg26|';
  const cacheKey = hashText(prefix + cacheNamespace(summaryConfig) + wordBudget + '|' + JSON.stringify(meta) + '|' + truncated);
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return { data: cached, cached: true };

  try {
    const raw = await callModel(config, {
      model: config.summaryModel,
      reasoning_effort: 'low',
      json_schema: LONGFORM_SCHEMA,
      // Sized to the budget rather than a fixed ceiling. The model no longer has
      // room to write long even if it wants to.
      max_tokens: Math.round(wordBudget * 2.2) + 400,
      system: LONGFORM_PROMPT,
      messages: [{
        role: 'user',
        content: `Content kind: ${kind}\nSource length: ${sourceWords} words\nWORD BUDGET: ${wordBudget} words total across every field. Target ${Math.round(wordBudget / 2)}.\nMetadata: ${JSON.stringify(meta)}\n\n${kind === 'video' ? 'Timestamped transcript' : 'Extracted page content'}:\n${truncated}`
      }]
    });
    const data = parseJsonBlock(raw);
    if (!data) return { error: `Could not parse ${kind} summary.` };
    if (typeof data.tldr !== 'string' || !Array.isArray(data.points)) {
      return { error: 'Unexpected summary response format.' };
    }
    data.kind = kind;
    data.content_meta = meta;

    if (kind === 'page') {
      const localSource = lookupDomain(request.domain);
      if (localSource) {
        data.source_type = localSource[0];
        data.source_note = localSource[1];
        data.source_domain = (request.domain || '').replace(/^www\./, '');
      }
    }

    await setCachedAnalysis(cacheKey, data);
    return { data };
  } catch (err) { return { error: err.message }; }
}

// ── Document check ────────────────────────────────────────────────────────────
// Cost gate: a document needs enough substance to weigh. A clause or a slide on
// its own can't be judged, so this floor sits well above the 160-char text gate.
const DOC_MIN_CHARS = 400;
const DOC_MAX_CHARS = 120000;

async function analyzeDocument(request) {
  const config = await getApiConfig();
  if (!config.key) return { error: missingKeyError(config) };

  const source = request.source === 'file' ? 'file' : (request.source === 'page' ? 'page' : 'selection');
  const text = String(request.text || '').trim();
  if (text.length < DOC_MIN_CHARS) {
    return { error: source === 'file'
      ? 'That file has too little text to weigh. Check it opened correctly.'
      : source === 'page'
        ? 'Not enough readable document on this page to review.'
        : 'Select the whole thing. A clause or a claim on its own can\'t be weighed.' };
  }

  // A near-even split, unlike the other modes: the back half of an agreement
  // carries the clauses that cost you money.
  const truncated = text.length > DOC_MAX_CHARS;
  const body = truncateHeadTail(text, DOC_MAX_CHARS, 0.55);

  const title  = String(request.title || '').slice(0, 300);
  const domain = String(request.domain || '').slice(0, 200);
  const summaryConfig = { ...config, model: config.summaryModel };
  const cacheKey = hashText('doc27|' + cacheNamespace(summaryConfig) + source + '|' + domain + '|' + body);
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return { data: cached, cached: true };

  const origin = source === 'file'
    ? `Uploaded file: ${title || 'untitled'}`
    : `Source: ${domain || 'unknown'}\nTitle: ${title || 'untitled'}`;

  try {
    const raw = await callModel(config, {
      model: config.summaryModel,
      // The only mode above 'low'. Clause interaction is where the value is, and
      // it is the one thing a fast pass reliably misses.
      reasoning_effort: 'medium',
      json_schema: DOC_SCHEMA,
      max_tokens: 4000,
      system: DOC_PROMPT,
      messages: [{
        role: 'user',
        content: `Scope: ${source === 'file' ? 'uploaded document' : source === 'page' ? 'whole page' : 'selected text'}\n${origin}\n\nDocument text:\n${body}`
      }]
    });
    const data = parseJsonBlock(raw);
    if (!data) return { error: 'Could not parse the document review response.' };
    if (typeof data.doc_tldr !== 'string' || !Array.isArray(data.clauses) || !Array.isArray(data.flags)) {
      return { error: 'Unexpected document review response format.' };
    }
    data.source = source;
    data.truncated = truncated;
    data.char_count = text.length;

    if (source === 'page') {
      const localSource = lookupDomain(domain);
      if (localSource) {
        data.source_type   = localSource[0];
        data.source_note   = localSource[1];
        data.source_domain = domain.replace(/^www\./, '');
      }
    }

    await setCachedAnalysis(cacheKey, data);
    return { data };
  } catch (err) { return { error: err.message }; }
}
