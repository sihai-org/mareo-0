import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');

function openPage({ saved, storageBlocked = false, download = '' } = {}) {
  const buttons = ['zh-CN', 'en'].map(language => ({
    dataset: { language }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_event, callback) { this.click = callback; },
  }));
  const meta = {}, languageGroup = { hidden: true };
  const downloadLink = { hidden: true }, pending = { hidden: false };
  const document = {
    documentElement: { lang: 'zh-CN' },
    querySelectorAll: () => buttons,
    querySelector: selector => selector === '.languages' ? languageGroup : meta,
    getElementById: id => id === 'download-link' ? downloadLink : pending,
  };
  const storage = new Map(saved ? [['mareo-site-language', saved]] : []);
  vm.runInNewContext(script.replace("const downloadUrl = '';", `const downloadUrl = ${JSON.stringify(download)};`), {
    document,
    localStorage: {
      getItem(key) { if (storageBlocked) throw Error('blocked'); return storage.get(key); },
      setItem(key, value) { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
    },
  });
  return { document, buttons, meta, storage, languageGroup, downloadLink, pending };
}

test('Chinese default, accessible language toggle and remembered English', () => {
  const page = openPage();
  assert.equal(page.document.documentElement.lang, 'zh-CN');
  assert.equal(page.languageGroup.hidden, false);
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, 'en');
  assert.match(page.document.title, /AI for your workspace/);
  assert.match(page.meta.content, /independent desktop/);
  assert.equal(page.buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(page.buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(page.storage.get('mareo-site-language'), 'en');
  assert.equal(openPage({ saved: 'en' }).document.documentElement.lang, 'en');
  page.buttons[0].click();
  assert.equal(page.document.documentElement.lang, 'zh-CN');
});

test('Invalid preferences and unavailable storage do not break the page', () => {
  assert.equal(openPage({ saved: 'invalid' }).document.documentElement.lang, 'zh-CN');
  const page = openPage({ storageBlocked: true });
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, 'en');
});

test('Download stays unavailable until an actual release URL is configured', () => {
  const pending = openPage();
  assert.equal(pending.downloadLink.hidden, true);
  assert.equal(pending.pending.hidden, false);
  for (const download of ['downloads/Mareo-arm64.dmg', 'https://downloads.example.test/Mareo.dmg']) {
    const page = openPage({ download });
    assert.equal(page.downloadLink.href, download);
    assert.equal(page.downloadLink.hidden, false);
    assert.equal(page.pending.hidden, true);
  }
});

test('Static assets and fragment links resolve within the standalone directory', () => {
  for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (reference.startsWith('https://') || reference === '#') continue;
    if (reference.startsWith('#')) assert(html.includes(`id="${reference.slice(1)}"`), reference);
    else assert(existsSync(new URL(reference, import.meta.url)), reference);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /id="download-link"[^>]*hidden/);
});
