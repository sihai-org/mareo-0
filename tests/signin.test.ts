import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const html = readFileSync('assets/signin.html', 'utf8')

function loginPage() {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', textContent: '', className: '', disabled: false, hidden: id === 'token-mode',
    focused: false, events: {} as Record<string, () => Promise<void> | void>,
    focus() { this.focused = true },
    addEventListener(event: string, callback: () => Promise<void> | void) { this.events[event] = callback },
  }]))
  let tick = () => {}
  const calls: string[] = []
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    document: { getElementById: (id: string) => elements.get(id) },
    window: { mareo: {
      sendCode: async () => { calls.push('send'); return { ok: true } },
      emailSignIn: async () => { calls.push('email'); return { ok: false, error: '验证码不正确。' } },
      signIn: async () => { calls.push('token'); return { ok: true } },
    } },
    setInterval: (callback: () => void) => { tick = callback; return 1 },
    clearInterval: () => {},
  })
  return { element: (id: string) => elements.get(id)!, calls, tick: () => tick() }
}

test('email validation, send status and countdown stay intact', async () => {
  const page = loginPage()
  await page.element('send-code').events.click()
  assert.deepEqual(page.calls, [])
  assert.equal(page.element('email-status').className, 'status error')
  page.element('email').value = 'preview@example.test'
  await page.element('send-code').events.click()
  assert.equal(page.element('send-code').disabled, true)
  assert.equal(page.element('email-status').className, 'status ok')
  page.tick()
  assert.equal(page.element('send-code').textContent, '重新发送（59s）')
  for (let i = 0; i < 59; i++) page.tick()
  assert.equal(page.element('send-code').disabled, false)
  assert.equal(page.element('send-code').textContent, '发送验证码')
})

test('email failures restore the primary action; token login keeps its flow', async () => {
  const page = loginPage()
  page.element('email').value = 'preview@example.test'
  page.element('code').value = '000000'
  await page.element('email-sign-in').events.click()
  assert.equal(page.element('email-status').textContent, '验证码不正确。')
  assert.equal(page.element('email-sign-in').disabled, false)
  await page.element('show-token').events.click()
  assert.equal(page.element('email-mode').hidden, true)
  assert.equal(page.element('token-mode').hidden, false)
  page.element('token').value = 'test-only-token'
  await page.element('token-sign-in').events.click()
  assert.equal(page.element('token-status').textContent, '登录成功，正在启动…')
  await page.element('show-email').events.click()
  assert.equal(page.element('email-mode').hidden, false)
  assert.equal(page.element('token-mode').hidden, true)
  assert.deepEqual(page.calls, ['email', 'token'])
})

test('both alternative sign-in actions are keyboard-accessible buttons', () => {
  for (const id of ['show-token', 'show-email']) {
    assert.match(html, new RegExp(`<button[^>]+id="${id}"[^>]+type="button"`))
  }
})
