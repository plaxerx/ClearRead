// Clear Read: Settings popup

document.addEventListener('DOMContentLoaded', async () => {
  const keyInput      = document.getElementById('api-key');
  const keyLabel      = document.getElementById('api-key-label');
  const keyHint       = document.getElementById('api-key-hint');
  const providerSelect = document.getElementById('provider-select');
  const modelRow      = document.getElementById('model-row');
  const modelInput    = document.getElementById('model-input');
  const summaryModelInput = document.getElementById('summary-model-input');
  const providerBrand = document.getElementById('provider-brand');
  const form          = document.getElementById('api-form');
  const status        = document.getElementById('status');
  const toggle        = document.getElementById('enabled-toggle');
  const toggleLabel   = document.getElementById('toggle-label');
  const banner        = document.getElementById('disabled-banner');
  const headerIcon    = document.getElementById('header-icon');
  const themeSelect   = document.getElementById('theme-select');

  const tldrBtn = document.getElementById('page-tldr-btn');
  const tldrBtnLabel = document.getElementById('page-tldr-label');
  const tldrStatus = document.getElementById('tldr-status');

  const docBtn = document.getElementById('doc-check-btn');

  const YOUTUBE_WATCH = /^https?:\/\/(?:[^/]+\.)?youtube\.com\/(?:watch|shorts)/i;
  const LEGAL_PAGE = /\b(terms|tos|eula|legal|agreement|privacy|conditions|msa)\b/i;

  // The popup paints before storage answers, so apply the theme the moment we know
  // it and again whenever the dropdown changes. Without this the popup kept the
  // system appearance while every panel switched.
  function applyPopupTheme(theme) {
    const root = document.documentElement;
    root.classList.remove('cr-light', 'cr-dark');
    if (theme === 'light') root.classList.add('cr-light');
    if (theme === 'dark')  root.classList.add('cr-dark');
  }

  let activeTabId = null;

  // One look at the active tab: close any open panel, then tailor the buttons to
  // what the tab actually is.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    activeTabId = tab.id;
    chrome.tabs.sendMessage(tab.id, { type: 'CLOSE_PANEL' }).catch(() => {});

    const url = tab.url || '';
    if (tldrBtnLabel && YOUTUBE_WATCH.test(url)) tldrBtnLabel.textContent = 'TL;DR this video';
    // A legal page is almost certainly why the popup is open. Say so on the button.
    if (LEGAL_PAGE.test(url)) docBtn?.classList.add('suggested');
  });

  // Both actions render in the side panel, which has to be opened from the click
  // itself. Chrome only accepts sidePanel.open() inside a user gesture.
  const openSidePanel = async (payload) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      await chrome.sidePanel.open({ tabId: tab.id });
      await chrome.runtime.sendMessage({ type: 'SIDE_PANEL_TASK', tabId: tab.id, ...payload });
      window.close();
    } catch (err) {
      tldrStatus.textContent = 'Could not open the side panel. Reload the extension.';
    }
  };

  tldrBtn?.addEventListener('click', () => openSidePanel({ task: 'page' }));
  docBtn?.addEventListener('click', () => openSidePanel({ task: 'document' }));

  const [apiSettings, enabledResp, themeResp] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_API_SETTINGS' }),
    chrome.runtime.sendMessage({ type: 'GET_ENABLED' }),
    chrome.runtime.sendMessage({ type: 'GET_THEME' })
  ]);

  providerSelect.value = apiSettings.provider || 'anthropic';
  keyInput.value = apiSettings.key || '';
  modelInput.value = apiSettings.model || 'gpt-5.6-luna';
  summaryModelInput.value = apiSettings.summaryModel || 'gpt-5.6-sol';
  applyProviderState(providerSelect.value);

  const isEnabled = enabledResp.enabled !== false;
  applyToggleState(isEnabled);
  const savedTheme = themeResp?.theme || 'system';
  if (themeSelect) themeSelect.value = savedTheme;
  applyPopupTheme(savedTheme);

  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    await chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled });
    applyToggleState(enabled);
  });

  function applyToggleState(enabled) {
    toggle.checked = enabled;
    toggleLabel.textContent = enabled ? 'ON' : 'OFF';
    toggleLabel.className = `toggle-label ${enabled ? 'on' : 'off'}`;
    banner.classList.toggle('show', !enabled);
    headerIcon.src = enabled ? 'icons/icon48.png' : 'icons/icon48_off.png';
  }

  if (themeSelect) {
    themeSelect.addEventListener('change', async () => {
      // Repaint the popup first so the change is visible immediately, then tell
      // everyone else. Waiting on the round trip made the dropdown feel dead.
      applyPopupTheme(themeSelect.value);
      await chrome.runtime.sendMessage({ type: 'SET_THEME', theme: themeSelect.value });
    });
  }

  providerSelect.addEventListener('change', async () => {
    const settings = await chrome.runtime.sendMessage({
      type: 'GET_API_SETTINGS', provider: providerSelect.value
    });
    keyInput.value = settings.key || '';
    modelInput.value = settings.model || 'gpt-5.6-luna';
    summaryModelInput.value = settings.summaryModel || 'gpt-5.6-sol';
    status.textContent = '';
    applyProviderState(providerSelect.value);
  });

  function applyProviderState(provider) {
    const isOpenAI = provider === 'openai';
    keyLabel.textContent = `${isOpenAI ? 'OpenAI' : 'Anthropic'} API Key`;
    keyInput.placeholder = isOpenAI ? 'sk-proj-...' : 'sk-ant-api03-...';
    keyHint.innerHTML = isOpenAI
      ? 'Get your key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>.<br>Stored locally. Only sent to OpenAI\'s API.'
      : 'Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>.<br>Stored locally. Only sent to Anthropic\'s API.';
    modelRow.hidden = !isOpenAI;
    providerBrand.textContent = `Powered by ${isOpenAI ? 'OpenAI' : 'Claude'}`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = providerSelect.value;
    const key = keyInput.value.trim();
    const model = modelInput.value.trim();
    const summaryModel = summaryModelInput.value.trim();

    if (!key) {
      status.textContent = 'Please enter an API key.';
      status.className = 'status error';
      return;
    }
    if (provider === 'anthropic' && !key.startsWith('sk-ant-')) {
      status.textContent = 'Anthropic keys should start with sk-ant-';
      status.className = 'status error';
      return;
    }
    if (provider === 'openai' && !key.startsWith('sk-')) {
      status.textContent = 'OpenAI keys should start with sk-';
      status.className = 'status error';
      return;
    }
    if (provider === 'openai' && (!model || !summaryModel)) {
      status.textContent = 'Please enter both OpenAI models.';
      status.className = 'status error';
      return;
    }

    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_API_SETTINGS', provider, key, model, summaryModel
    });

    if (result.success) {
      status.textContent = '✓ API settings saved!';
      status.className = 'status success';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } else {
      status.textContent = result.error || 'Error saving settings.';
      status.className = 'status error';
    }
  });
});
