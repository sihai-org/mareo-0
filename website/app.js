// Set a relative DMG path or an HTTPS download URL when the release is ready.
const downloadUrl = '';

const pageText = {
  'zh-CN': {
    title: 'Mareo — 让 AI 走进你的工作区',
    description: 'Mareo，让 AI 走进你的工作区。基于 DeepSeek Harness 构建的桌面 AI Agent，适用于 macOS Apple Silicon。',
  },
  en: {
    title: 'Mareo — AI for your workspace',
    description: 'Bring AI into your workspace with Mareo, an independent desktop AI agent built on DeepSeek Harness for macOS Apple Silicon.',
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

if (downloadUrl) {
  const link = document.getElementById('download-link');
  link.href = downloadUrl;
  link.hidden = false;
  document.getElementById('download-pending').hidden = true;
}
