import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');

function downloadFallback() {
  const match = script.match(/const downloadFallback = (\{[\s\S]*?\});/);
  return match ? Function(`return (${match[1]});`)() : {};
}

async function openPage({ saved, storageBlocked = false, manifest, offline = false } = {}) {
  const buttons = ['zh-CN', 'en'].map(language => ({
    dataset: { language }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_event, callback) { this.click = callback; },
  }));
  const meta = {}, languageGroup = { hidden: true };
  const links = { 'download-link': { hidden: true }, 'download-link-windows': { hidden: true } };
  const pendings = { 'download-pending': { hidden: false }, 'download-pending-windows': { hidden: false } };
  const version = { textContent: '' };
  const document = {
    documentElement: { lang: 'zh-CN' },
    querySelectorAll: () => buttons,
    querySelector: selector => (selector === '.languages' ? languageGroup : meta),
    getElementById: id => links[id] ?? pendings[id] ?? (id === 'download-version' ? version : null),
  };
  const storage = new Map(saved ? [['mareo-site-language', saved]] : []);
  vm.runInNewContext(script, {
    document,
    localStorage: {
      getItem(key) { if (storageBlocked) throw Error('blocked'); return storage.get(key); },
      setItem(key, value) { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
    },
    fetch: async () => {
      if (offline) throw new Error('offline');
      return { ok: true, json: async () => manifest };
    },
  });
  // applyDownloads resolves asynchronously once the manifest has been read.
  await new Promise(resolve => setTimeout(resolve, 0));
  return { document, buttons, meta, storage, languageGroup, links, pendings, version };
}

test('Chinese default, accessible language toggle and remembered English', async () => {
  const page = await openPage({ manifest: { version: '0.1.0' } });
  assert.equal(page.document.documentElement.lang, 'zh-CN');
  assert.equal(page.languageGroup.hidden, false);
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, 'en');
  assert.match(page.document.title, /AI for your workspace/);
  assert.match(page.meta.content, /independent desktop/);
  assert.equal(page.buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(page.buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(page.storage.get('mareo-site-language'), 'en');

  const remembered = await openPage({ saved: 'en', manifest: { version: '0.1.0' } });
  assert.equal(remembered.document.documentElement.lang, 'en');

  page.buttons[0].click();
  assert.equal(page.document.documentElement.lang, 'zh-CN');
});

test('Invalid preferences and unavailable storage do not break the page', async () => {
  const invalid = await openPage({ saved: 'invalid', manifest: { version: '0.1.0' } });
  assert.equal(invalid.document.documentElement.lang, 'zh-CN');

  const page = await openPage({ storageBlocked: true, manifest: { version: '0.1.0' } });
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, 'en');
});

test('Downloads follow the published manifest per platform', async () => {
  const page = await openPage({
    manifest: {
      version: '0.1.1',
      downloads: {
        macos: 'https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/Mareo-0.1.1-macos-arm64.dmg',
        windows: 'https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/Mareo-0.1.1-windows-x64-setup.exe',
      },
    },
  });
  assert.equal(page.links['download-link'].href, 'https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/Mareo-0.1.1-macos-arm64.dmg');
  assert.equal(page.links['download-link-windows'].href, 'https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/Mareo-0.1.1-windows-x64-setup.exe');
  assert.equal(page.links['download-link'].hidden, false);
  assert.equal(page.links['download-link-windows'].hidden, false);
  assert.equal(page.pendings['download-pending'].hidden, true);
  assert.equal(page.pendings['download-pending-windows'].hidden, true);
  assert.equal(page.version.textContent, 'v0.1.1');
});

test('A platform without a manifest entry keeps its coming-soon note', async () => {
  const page = await openPage({
    manifest: { version: '0.1.1', downloads: { macos: 'https://mareo-downloads.oss-cn-hangzhou.aliyuncs.com/mac.dmg' } },
  });
  assert.equal(page.links['download-link'].hidden, false);
  assert.equal(page.links['download-link-windows'].hidden, true);
  assert.equal(page.pendings['download-pending-windows'].hidden, false);
});

test('An unreachable manifest falls back to the built-in links', async () => {
  const fallback = downloadFallback();
  const page = await openPage({ offline: true });
  assert.equal(page.links['download-link'].href, fallback.macos);
  assert.equal(page.links['download-link-windows'].href, fallback.windows);
  assert.equal(page.links['download-link'].hidden, false);
  assert.equal(page.links['download-link-windows'].hidden, false);
});

test('Static assets and fragment links resolve within the standalone directory', () => {
  for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (reference === '#') continue;
    if (reference.startsWith('#')) assert(html.includes(`id="${reference.slice(1)}"`), reference);
    else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)) continue; // absolute schemes: https, mailto, …
    else assert(existsSync(new URL(reference.split('?')[0].split('#')[0], import.meta.url)), reference);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<html lang="zh-CN">/);
});
