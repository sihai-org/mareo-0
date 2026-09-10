// Set a relative path or HTTPS URL per platform once the installer exists;
// an empty value keeps that platform's "coming soon" note visible.
const downloads = {
  macos: 'downloads/Mareo-0.1.0-arm64.dmg',
  windows: '',
};

const pageText = {
  'zh-CN': {
    title: 'Mareo — 让 AI 走进你的工作区',
    description: 'Mareo，让 AI 走进你的工作区。基于 DeepSeek Harness 构建的桌面 AI Agent，适用于 macOS 与 Windows。',
  },
  en: {
    title: 'Mareo — AI for your workspace',
    description: 'Bring AI into your workspace with Mareo, an independent desktop AI agent built on DeepSeek Harness for macOS and Windows.',
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

for (const [platform, url] of Object.entries(downloads)) {
  if (!url) continue;
  const link = document.getElementById(`download-link${platform === 'macos' ? '' : '-' + platform}`);
  const pending = document.getElementById(`download-pending${platform === 'macos' ? '' : '-' + platform}`);
  if (!link) continue;
  link.href = url;
  link.hidden = false;
  if (pending) pending.hidden = true;
}
