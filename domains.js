// Clear Read: Built-in domain knowledge base
// Instant, free, accurate source classification for common sites.
// Avoids an API round-trip for the most-visited domains.

const DOMAIN_DB = {
  // ── Community boards ──────────────────────────────────────────────
  'reddit.com':        ['community_board', 'User-generated content, community moderated'],
  'quora.com':         ['community_board', 'User-submitted questions and answers'],
  'stackexchange.com': ['community_board', 'User-generated Q&A, community moderated'],
  'stackoverflow.com': ['community_board', 'User-generated programming Q&A'],
  'ycombinator.com':   ['community_board', 'User-submitted tech news and discussion'],
  'news.ycombinator.com': ['community_board', 'User-submitted tech news and discussion'],
  '4chan.org':         ['community_board', 'Anonymous imageboard, minimal moderation'],

  // ── Social media ──────────────────────────────────────────────────
  'twitter.com':   ['social_media', 'User-generated posts, algorithmically ranked'],
  'x.com':         ['social_media', 'User-generated posts, algorithmically ranked'],
  'facebook.com':  ['social_media', 'User-generated posts, algorithmically ranked'],
  'instagram.com': ['social_media', 'User-generated image posts'],
  'tiktok.com':    ['social_media', 'User-generated short video'],
  'linkedin.com':  ['social_media', 'Professional networking, user-generated posts'],
  'youtube.com':   ['social_media', 'User-generated video platform'],
  'threads.net':   ['social_media', 'User-generated posts'],
  'mastodon.social': ['social_media', 'Decentralized user-generated posts'],
  'bsky.app':      ['social_media', 'Decentralized user-generated posts'],

  // ── Corporate news ────────────────────────────────────────────────
  'nytimes.com':       ['corporate_news', 'Owned by The New York Times Company (public)'],
  'wsj.com':           ['corporate_news', 'Owned by News Corp'],
  'cnn.com':           ['corporate_news', 'Owned by Warner Bros. Discovery'],
  'foxnews.com':       ['corporate_news', 'Owned by Fox Corporation'],
  'washingtonpost.com':['corporate_news', 'Owned by Nash Holdings (Jeff Bezos)'],
  'nbcnews.com':       ['corporate_news', 'Owned by Comcast (NBCUniversal)'],
  'cnbc.com':          ['corporate_news', 'Owned by Comcast (NBCUniversal)'],
  'abcnews.go.com':    ['corporate_news', 'Owned by The Walt Disney Company'],
  'cbsnews.com':       ['corporate_news', 'Owned by Paramount Global'],
  'bloomberg.com':     ['corporate_news', 'Owned by Bloomberg L.P.'],
  'forbes.com':        ['corporate_news', 'Majority owned by Integrated Whale Media'],
  'businessinsider.com':['corporate_news', 'Owned by Axel Springer SE'],
  'usatoday.com':      ['corporate_news', 'Owned by Gannett'],
  'latimes.com':       ['corporate_news', 'Owned by Patrick Soon-Shiong'],
  'nypost.com':        ['corporate_news', 'Owned by News Corp'],
  'thehill.com':       ['corporate_news', 'Owned by Nexstar Media Group'],
  'politico.com':      ['corporate_news', 'Owned by Axel Springer SE'],
  'time.com':          ['corporate_news', 'Owned by Marc Benioff'],
  'theatlantic.com':   ['corporate_news', 'Majority owned by Emerson Collective'],
  'newsweek.com':      ['corporate_news', 'Owned by Newsweek Publishing LLC'],
  'reuters.com':       ['corporate_news', 'Owned by Thomson Reuters'],
  'apnews.com':        ['independent_news', 'Nonprofit news cooperative'],

  // ── Independent / nonprofit news ──────────────────────────────────
  'propublica.org':    ['independent_news', 'Nonprofit, donor-funded investigative news'],
  'theintercept.com':  ['independent_news', 'Independently owned investigative news'],
  'theguardian.com':   ['independent_news', 'Owned by Scott Trust (nonprofit structure)'],
  'npr.org':           ['public_broadcaster', 'US federal and member-station funding'],
  'pbs.org':           ['public_broadcaster', 'US public broadcaster'],
  'bbc.com':           ['public_broadcaster', 'Publicly funded by UK licence fee'],
  'bbc.co.uk':         ['public_broadcaster', 'Publicly funded by UK licence fee'],
  'cbc.ca':            ['public_broadcaster', 'Canadian public broadcaster'],
  'abc.net.au':        ['public_broadcaster', 'Australian public broadcaster'],
  'aljazeera.com':     ['independent_news', 'Funded by the government of Qatar'],

  // ── Government ────────────────────────────────────────────────────
  'cdc.gov':       ['government', 'Official US government. CDC'],
  'nih.gov':       ['government', 'Official US government. NIH'],
  'fda.gov':       ['government', 'Official US government. FDA'],
  'whitehouse.gov':['government', 'Official US government. White House'],
  'congress.gov':  ['government', 'Official US government. Congress'],
  'usa.gov':       ['government', 'Official US government portal'],
  'irs.gov':       ['government', 'Official US government. IRS'],
  'sec.gov':       ['government', 'Official US government. SEC'],
  'census.gov':    ['government', 'Official US government. Census Bureau'],
  'bls.gov':       ['government', 'Official US government. Bureau of Labor Statistics'],
  'nasa.gov':      ['government', 'Official US government. NASA'],
  'who.int':       ['government', 'World Health Organization (UN agency)'],
  'europa.eu':     ['government', 'Official European Union portal'],

  // ── Academic ──────────────────────────────────────────────────────
  'arxiv.org':         ['academic', 'Open-access preprint server'],
  'pubmed.ncbi.nlm.nih.gov': ['academic', 'US National Library of Medicine database'],
  'ncbi.nlm.nih.gov':  ['academic', 'US National Library of Medicine'],
  'jstor.org':         ['academic', 'Academic journal archive'],
  'nature.com':        ['academic', 'Peer-reviewed scientific journal'],
  'science.org':       ['academic', 'Peer-reviewed scientific journal'],
  'sciencedirect.com': ['academic', 'Peer-reviewed research database'],
  'springer.com':      ['academic', 'Academic publisher'],
  'researchgate.net':  ['academic', 'Researcher network and paper repository'],
  'scholar.google.com':['academic', 'Academic literature search index'],

  // ── Encyclopedia ──────────────────────────────────────────────────
  'wikipedia.org':  ['encyclopedia', 'Community-edited reference encyclopedia'],
  'britannica.com': ['encyclopedia', 'Professionally edited reference encyclopedia'],

  // ── Satire ────────────────────────────────────────────────────────
  'theonion.com':     ['satire', 'Satirical news publication'],
  'babylonbee.com':   ['satire', 'Satirical news publication'],
  'clickhole.com':    ['satire', 'Satirical content publication'],
  'reductress.com':   ['satire', 'Satirical news publication'],

  // ── Blog / newsletter platforms ───────────────────────────────────
  'substack.com':  ['blog', 'Individual creator newsletter platform'],
  'medium.com':    ['blog', 'User-published article platform'],
  'wordpress.com': ['blog', 'User-published blog platform'],
  'blogspot.com':  ['blog', 'User-published blog platform'],
  'tumblr.com':    ['blog', 'User-published microblog platform'],

  // ── Aggregators ───────────────────────────────────────────────────
  'news.google.com': ['aggregator', 'Algorithmic news aggregator'],
  'flipboard.com':   ['aggregator', 'Content aggregator'],
  'huffpost.com':    ['aggregator', 'Aggregated and original content mix'],
  'buzzfeed.com':    ['aggregator', 'Aggregated and original content mix'],
};

// Look up a domain (and parent domains) in the DB.
// Returns [source_type, source_note] or null if not found.
function lookupDomain(domain) {
  if (!domain) return null;
  const clean = domain.replace(/^www\./, '').toLowerCase();

  // Exact match
  if (DOMAIN_DB[clean]) return DOMAIN_DB[clean];

  // Parent-domain match (e.g. "blah.substack.com" → "substack.com")
  const parts = clean.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (DOMAIN_DB[parent]) return DOMAIN_DB[parent];
  }

  // Generic TLD heuristics. Still free, no API
  if (clean.endsWith('.gov'))  return ['government', 'Official government website'];
  if (clean.endsWith('.edu'))  return ['academic', 'Academic or educational institution'];
  if (clean.endsWith('.mil'))  return ['government', 'Official military website'];

  return null;
}
