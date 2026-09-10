import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');

function configuredDownloads(source) {
  const match = source.match(/const downloads = (\{[\s\S]*?\});/);
  if (!match) return {};
  return Function(`return (${match[1]});`)();
}

function openPage({ saved, storageBlocked = false, downloads } = {}) {
  // downloads === undefined keeps the repository's configured values; any
  // object overrides them for this page instance.
  const body =
    downloads === undefined
      ? script
      : script.replace(/const downloads = \{[\s\S]*?\};/, `const downloads = ${JSON.stringify(downloads)};`);
  const buttons = ['zh-CN', 'en'].map(language => ({
    dataset: { language }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_event, callback) { this.click = callback; },
  }));
  const meta = {}, languageGroup = { hidden: true };
  const links = { 'download-link': { hidden: true }, 'download-link-windows': { hidden: true } };
  const pendings = { 'download-pending': { hidden: false }, 'download-pending-windows': { hidden: false } };
  const document = {
    documentElement: { lang: 'zh-CN' },
    querySelectorAll: () => buttons,
    querySelector: selector => (selector === '.languages' ? languageGroup : meta),
    getElementById: id => links[id] ?? pendings[id] ?? null,
  };
  const storage = new Map(saved ? [['mareo-site-language', saved]] : []);
  vm.runInNewContext(body, {
    document,
    localStorage: {
      getItem(key) { if (storageBlocked) throw Error('blocked'); return storage.get(key); },
      setItem(key, value) { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
    },
  });
  return { document, buttons, meta, storage, languageGroup, links, pendings };
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

test('Each platform exposes its download only when a URL is configured', () => {
  const configured = configuredDownloads(script);
  const page = openPage();

  for (const platform of ['macos', 'windows']) {
    const suffix = platform === 'macos' ? '' : `-${platform}`;
    const link = page.links[`download-link${suffix}`];
    const pending = page.pendings[`download-pending${suffix}`];
    if (configured[platform]) {
      assert.equal(link.href, configured[platform]);
      assert.equal(link.hidden, false);
      assert.equal(pending.hidden, true);
    } else {
      assert.equal(link.hidden, true);
      assert.equal(pending.hidden, false);
    }
  }

  const bothOff = openPage({ downloads: { macos: '', windows: '' } });
  assert.equal(bothOff.links['download-link'].hidden, true);
  assert.equal(bothOff.pendings['download-pending'].hidden, false);
  assert.equal(bothOff.links['download-link-windows'].hidden, true);
  assert.equal(bothOff.pendings['download-pending-windows'].hidden, false);

  const bothOn = openPage({ downloads: { macos: 'downloads/Mareo.dmg', windows: 'downloads/MareoSetup.exe' } });
  assert.equal(bothOn.links['download-link'].href, 'downloads/Mareo.dmg');
  assert.equal(bothOn.links['download-link-windows'].href, 'downloads/MareoSetup.exe');
  assert.equal(bothOn.pendings['download-pending'].hidden, true);
  assert.equal(bothOn.pendings['download-pending-windows'].hidden, true);
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
});
