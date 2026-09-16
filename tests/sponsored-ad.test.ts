import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSponsoredAd, SponsoredAdClient } from '../src/sponsored-ad.js'

const ad = { id: 'test-ad', image: 'https://images.example.test/a.png', title: 'Test',
  description: 'Description', targetUrl: 'https://example.test/?affiliate=123', advertiser: 'Example' }

test('untrusted ad data is validated before rendering or opening', () => {
  assert.deepEqual(parseSponsoredAd(ad), ad)
  for (const invalid of [null, {}, { ...ad, title: '' }, { ...ad, image: 'http://example.test' },
    { ...ad, targetUrl: 'file:///etc/passwd' }, { ...ad, targetUrl: 'javascript:alert(1)' },
    { ...ad, targetUrl: 'https://user:password@example.test' }, { ...ad, targetUrl: 12 }]) {
    assert.equal(parseSponsoredAd(invalid), null)
  }
})

test('one fetch and one impression per document; only cached target opens; no user ID on wire', async () => {
  const requests: { url: string; body?: Record<string, unknown> }[] = []
  const opened: string[] = []
  const client = new SponsoredAdClient('https://gateway.example.test', 'private-token', async url => { opened.push(url) },
    (async (url, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer private-token')
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ ad }))
    }) as typeof fetch)
  assert.equal(await client.click(ad.id), false)
  await Promise.all([client.load(), client.load()])
  client.impression('fake')
  client.impression(ad.id)
  client.impression(ad.id)
  assert.equal(await client.click('https://attacker.example.test'), false)
  assert.equal(await client.click(ad.id), true)
  assert.deepEqual(opened, [ad.targetUrl])
  assert.equal(requests.length, 3)
  assert.equal(requests[1].body?.type, 'impression')
  assert.equal(requests[2].body?.type, 'click')
  assert.notEqual(requests[1].body?.eventId, requests[2].body?.eventId)
  assert.equal('userId' in requests[1].body!, false)
})

test('absent, malformed and unavailable ads hide; tracking failure never blocks click', async () => {
  for (const response of [new Response('{}'), new Response('null'), new Response('{'), new Response('', { status: 503 })]) {
    const client = new SponsoredAdClient('https://gateway.example.test', 'token', async () => {},
      (async () => response) as typeof fetch)
    assert.equal(await client.load(), null)
    assert.equal(await client.click(ad.id), false)
  }
  let opened = false
  const client = new SponsoredAdClient('https://gateway.example.test', 'token', async () => { opened = true },
    (async (_url, init) => {
      if (init?.method === 'POST') throw Error('offline')
      return new Response(JSON.stringify({ ad }))
    }) as typeof fetch)
  await client.load()
  assert.equal(await client.click(ad.id), true)
  assert(opened)
})
