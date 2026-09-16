// The meter is the only part of the quota a user sees, so what it renders — and
// what it deliberately does not render — is worth pinning down. No amounts
// appear anywhere in this component.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

interface Snapshot {
  quota: { limitMicro: number; spentMicro: number; remainingMicro: number; usedPercent: number; exhausted: boolean; resetAt: string; visible: boolean }
  reward?: unknown
}

function meterHarness(snapshot: Snapshot | null) {
  // The plugin builds plain element descriptions; a component is `tag` and its
  // props are `props`, which is all this harness needs to walk.
  type Element = {
    tag?: ((props: { wide: boolean }) => unknown) & { name?: string }
    props?: { wide: boolean }
    children?: Element[]
  }
  const hooks: Record<number, unknown> = {}
  const effects: (() => void)[] = []
  const intervals: (() => void)[] = []
  let cursor = 0
  let renderFooter: (props: { wide: boolean }) => Element

  const react = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value: unknown) => { hooks[index] = value }]
    },
    useEffect(effect: () => (() => void) | undefined) {
      cursor++
      effects.push(() => effect())
    },
    createElement(tag: unknown, props: unknown, ...children: unknown[]) {
      return { tag, props, children }
    },
  }

  const plugin: { apply?: (ctx: unknown) => void } = {}
  vm.runInNewContext(readFileSync('brand/client.cjs', 'utf8'), {
    exports: plugin,
    logoUrl: 'test',
    require: () => react,
    document: { visibilityState: 'visible', hasFocus: () => true, addEventListener: () => {}, removeEventListener: () => {} },
    window: {
      __mareoQuota: { get: async () => snapshot },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length },
    clearInterval: () => {},
  })
  plugin.apply!({
    slots: {
      inject: (_name: string, callback: () => void) => callback(),
      register: (options: { name: string }, render: typeof renderFooter) => {
        if (options.name === 'sidebar.footer.action') renderFooter = render
      },
    },
  })

  return {
    async render(wide = true) {
      cursor = 0
      const footer = renderFooter({ wide })
      const meter = (footer.children ?? []).find(
        (child) => typeof child?.tag === 'function' && child.tag.name === 'QuotaMeter',
      )
      if (meter === undefined) return null
      // Reset the hook cursor per draw: the stub resolves hooks by call order.
      const draw = () => {
        cursor = 0
        return (meter.tag as (props: { wide: boolean }) => Element)({ wide })
      }
      // First draw registers the hooks, then the effect starts the fetch, then
      // the resolved snapshot is drawn.
      draw()
      effects.splice(0).forEach((effect) => effect())
      await new Promise((resolve) => setImmediate(resolve))
      return draw()
    },
  }
}

function full(overrides: Partial<Snapshot['quota']> = {}): Snapshot {
  return {
    quota: {
      limitMicro: 10_000_000,
      spentMicro: 6_200_000,
      remainingMicro: 3_800_000,
      usedPercent: 62,
      exhausted: false,
      resetAt: '2026-09-17T16:00:00.000Z',
      visible: true,
      ...overrides,
    },
  }
}

test('the meter shows a percentage and never an amount', async () => {
  const harness = meterHarness(full())
  const node = await harness.render()
  assert.ok(node !== null)
  const text = JSON.stringify(node)
  assert.match(text, /已用 62%/)
  assert.match(text, /progressbar/)
  assert.doesNotMatch(text, /¥/)
  assert.doesNotMatch(text, /6200000/, 'no raw amounts reach the renderer output')
})

test('an exhausted account is told when it comes back, and is offered nothing', async () => {
  const harness = meterHarness(full({ usedPercent: 100, exhausted: true, remainingMicro: 0 }))
  const node = await harness.render()
  const text = JSON.stringify(node)
  assert.match(text, /已用完/)
  assert.match(text, /北京时间 0 点后自动恢复/)
  // No task, no ad, no button: earning quota has no user-facing entry yet.
  assert.doesNotMatch(text, /模拟/)
  assert.doesNotMatch(text, /button/)
})

test('nothing renders when the gateway is not running a quota for this account', async () => {
  const hidden = await meterHarness(full({ visible: false })).render()
  assert.equal(hidden, null)
  const missing = await meterHarness(null).render()
  assert.equal(missing, null)
})

test('a collapsed sidebar renders nothing', async () => {
  assert.equal(await meterHarness(full()).render(false), null)
})
