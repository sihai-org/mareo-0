import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');

function configuredDownloadUrl(source) {
  const match = source.match(/const downloadUrl = ['"]([^'"]*)['"];/);
  return match ? match[1] : '';
}

function openPage({ saved, storageBlocked = false, download } = {}) {
  // download === undefined keeps the repository's configured default;
  // any other value overrides it for this page instance.
  const body =
    download === undefined
      ? script
      : script.replace(/const downloadUrl = [^;]+;/, `const downloadUrl = ${JSON.stringify(download)};`);
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
  vm.runInNewContext(body, {
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

test('Download reflects the configured release URL and can be toggled off', () => {
  const defaultUrl = configuredDownloadUrl(script);

  if (defaultUrl) {
    const page = openPage();
    assert.equal(page.downloadLink.href, defaultUrl);
    assert.equal(page.downloadLink.hidden, false);
    assert.equal(page.pending.hidden, true);
  } else {
    const page = openPage();
    assert.equal(page.downloadLink.hidden, true);
    assert.equal(page.pending.hidden, false);
  }

  const overridden = openPage({ download: 'downloads/Mareo-arm64.dmg' });
  assert.equal(overridden.downloadLink.href, 'downloads/Mareo-arm64.dmg');
  assert.equal(overridden.downloadLink.hidden, false);
  assert.equal(overridden.pending.hidden, true);

  const disabled = openPage({ download: '' });
  assert.equal(disabled.downloadLink.hidden, true);
  assert.equal(disabled.pending.hidden, false);
});

test('Static assets and fragment links resolve within the standalone directory', () => {
  for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (reference === '#') continue;
    if (reference.startsWith('#')) assert(html.includes(`id="${reference.slice(1)}"`), reference);
    else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)) continue; // absolute schemes: https, mailto, …
    else assert(existsSync(new URL(reference, import.meta.url)), reference);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /id="download-link"[^>]*hidden/);
});
