// Language toggle: 中文 ⇄ English, remembers the choice.
(function () {
  const root = document.documentElement;
  const zhButton = document.getElementById('lang-zh');
  const enButton = document.getElementById('lang-en');

  function setLang(lang) {
    root.lang = lang;
    try { localStorage.setItem('mareo-lang', lang); } catch { /* private mode */ }
    if (zhButton) zhButton.setAttribute('aria-pressed', String(lang === 'zh-CN'));
    if (enButton) enButton.setAttribute('aria-pressed', String(lang === 'en'));
  }

  let preferred = 'zh-CN';
  try { preferred = localStorage.getItem('mareo-lang') || preferred; } catch { /* ignore */ }
  if (preferred !== 'zh-CN' && preferred !== 'en') {
    preferred = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  }
  setLang(preferred);

  if (zhButton) zhButton.addEventListener('click', () => setLang('zh-CN'));
  if (enButton) enButton.addEventListener('click', () => setLang('en'));

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
