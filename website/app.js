// Download links come from the published release manifest, so shipping a
// release never requires editing this file; the fallbacks only cover a
// manifest outage.
const downloadFallback = {
  macos: 'downloads/Mareo-0.1.0-macos-arm64.dmg',
  windows: 'downloads/MareoSetup.exe',
};
const MANIFEST_URL = 'updates/latest.json';

const pageText = {
  'zh-CN': {
    title: 'Mareo — 免费的 AI 工作助手',
    description: 'Mareo，免费的 AI 工作助手。能写代码、写文章、做表格和 PPT，处理本地文件并完成复杂任务。下载 Windows 或 macOS 版，登录即可开始。',
  },
  en: {
    title: 'Mareo — Your free AI work assistant',
    description: 'Write code, create content, make spreadsheets and slides with Mareo, an independent desktop AI agent. Download for Windows or macOS and sign in to get started.',
  },
};
const languageButtons = document.querySelectorAll('[data-language]');

function setLanguage(language) {
  document.documentElement.lang = language;
  document.title = pageText[language].title;
  document.querySelector('meta[name="description"]').content = pageText[language].description;
  for (const button of languageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

let language = 'zh-CN';
try {
  const saved = localStorage.getItem('mareo-site-language');
  if (saved === 'en' || saved === 'zh-CN') language = saved;
} catch { /* Language switching also works when browser storage is unavailable. */ }
setLanguage(language);
document.querySelector('.languages').hidden = false;
for (const button of languageButtons) {
  button.addEventListener('click', () => {
    setLanguage(button.dataset.language);
    try { localStorage.setItem('mareo-site-language', button.dataset.language); } catch { /* Optional preference. */ }
  });
}

async function applyDownloads() {
  let downloads = { ...downloadFallback };
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.json();
      if (manifest.downloads && typeof manifest.downloads === 'object') {
        downloads = { macos: manifest.downloads.macos ?? '', windows: manifest.downloads.windows ?? '' };
      }
    }
  } catch { /* Manifest unavailable: keep the fallback links. */ }

  for (const [platform, url] of Object.entries(downloads)) {
    for (const link of document.querySelectorAll(`[data-download="${platform}"]`)) {
      if (url) link.href = url;
      link.hidden = !url;
    }
    for (const pending of document.querySelectorAll(`[data-pending="${platform}"]`)) pending.hidden = Boolean(url);
  }
}

// Page-view beacon: one counting ping per page load and no identifier of any
// kind — no cookie, no storage, no user agent; the server keeps a daily counter
// per page only. Crawlers that do not run JavaScript never reach it, which is
// what makes these numbers meaningful.
const VIEW_COUNTER_URL = 'https://api.svc.mareo.cn/site-view';

function countPageView() {
  // Everything is inside the guard: counting must never be able to break the rest
  // of the page, whatever the environment provides.
  try {
    const path = typeof location === 'object' && location !== null ? location.pathname : '/';
    const body = JSON.stringify({ path });
    if (typeof navigator === 'object' && navigator?.sendBeacon?.(VIEW_COUNTER_URL, body) === true) return;
    void fetch(VIEW_COUNTER_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* Counting is best-effort by design. */ }
}

countPageView();
applyDownloads();
