import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Exercise the actual plugin component with deterministic hooks, visibility
// events and time; no real ads, user session or browser navigation involved.
function slotHarness(ad: unknown) {
  const hooks: any[] = []
  const effects: (() => void)[] = []
  const timers = new Map<number, () => void>()
  const listeners = new Map<string, () => void>()
  const impressions: string[] = []
  const clicks: string[] = []
  let nextTimer = 0
  let cursor = 0
  let observe: (entries: unknown[]) => void = () => {}
  let renderSlot: (props: { wide: boolean }) => any
  const document = {
    visibilityState: 'visible', focused: true,
    hasFocus: () => document.focused,
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  }
  const plugin: { apply?: (ctx: unknown) => void } = {}
  const react = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value: unknown) => { hooks[index] = value }]
    },
    useRef(initial: unknown) {
      const index = cursor++
      return hooks[index] ??= { current: initial }
    },
    useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
      const index = cursor++
      const previous = hooks[index]
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects.push(() => {
          previous?.cleanup?.()
          hooks[index] = { dependencies, cleanup: effect() }
        })
      }
    },
    createElement(tag: string, props: any, ...children: unknown[]) {
      const element = { tag, props, children }
      if (props?.ref) props.ref.current = element
      return element
    },
  }
  vm.runInNewContext(readFileSync('brand/client.cjs', 'utf8'), {
    exports: plugin, logoUrl: 'test', require: () => react, document,
    window: { __mareoSponsoredAd: {
      get: async () => ad,
      impression: async (id: string) => { impressions.push(id) },
      click: async (id: string) => { clicks.push(id) },
    }, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener },
    IntersectionObserver: class {
      constructor(callback: typeof observe) { observe = callback }
      observe() {}
      disconnect() {}
    },
    setTimeout: (callback: () => void, ms: number) => {
      assert.equal(ms, 1000)
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout: (id: number) => timers.delete(id),
  })
  plugin.apply!({ slots: {
    inject: (_name: string, callback: () => void) => callback(),
    register: (options: { name: string }, render: typeof renderSlot) => {
      if (options.name === 'sidebar.footer.action') renderSlot = render
    },
  } })
  return {
    render(wide = true) {
      cursor = 0
      const footer = renderSlot({ wide })
      // The slot now holds one stacked footer (quota meter + sponsored card),
      // so drive the card component inside it.
      const slot = (footer?.children ?? []).find(
        (child: { tag?: { name?: string } }) => typeof child?.tag === 'function' && child.tag.name === 'SponsoredAdSlot',
      )
      if (slot === undefined) return null
      const node = slot.tag(slot.props)
      effects.splice(0).forEach(effect => effect())
      return node
    },
    visible(ratio: number) { observe([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]) },
    focus(focused: boolean) { document.focused = focused; listeners.get(focused ? 'focus' : 'blur')?.() },
    hidden(hidden: boolean) { document.visibilityState = hidden ? 'hidden' : 'visible'; listeners.get('visibilitychange')?.() },
    elapsed() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()) },
    timers, impressions, clicks,
  }
}

const creative = { id: 'ad-one', title: '<script>plain text</script>', description: 'Description',
  image: 'https://example.test/image.png', targetUrl: 'https://example.test', advertiser: 'Test' }

test('no ad renders nothing; image failure removes the entire card', async () => {
  const empty = slotHarness(null)
  assert.equal(empty.render(), null)
  await Promise.resolve()
  assert.equal(empty.render(), null)
  assert.equal(empty.timers.size, 0)

  const slot = slotHarness(creative)
  slot.render()
  await Promise.resolve()
  const pending = slot.render()
  assert.equal(pending.props.style.display, 'none')
  pending.children[1].props.onError()
  assert.equal(slot.render(), null)
  assert.equal(slot.impressions.length, 0)
})

test('exposure waits for loaded image, half visibility and foreground; blur and collapse cancel', async () => {
  const slot = slotHarness(creative)
  slot.render()
  await Promise.resolve()
  const pending = slot.render()
  assert.equal(pending.props.style.display, 'none')
  assert.equal(pending.children[1].props.referrerPolicy, 'no-referrer')
  assert.equal(pending.children[1].props.crossOrigin, 'anonymous')
  pending.children[1].props.onLoad()
  const card = slot.render()
  assert.equal(card.props.style.display, 'flex')
  assert.equal(card.children[2].children[0], creative.title)
  slot.visible(0.49)
  assert.equal(slot.timers.size, 0)
  slot.visible(0.5)
  assert.equal(slot.timers.size, 1)
  slot.focus(false)
  slot.elapsed()
  assert.equal(slot.impressions.length, 0)
  slot.focus(true)
  slot.hidden(true)
  slot.elapsed()
  assert.equal(slot.impressions.length, 0)
  slot.hidden(false)
  slot.elapsed()
  assert.deepEqual(slot.impressions, ['ad-one'])
  card.props.onClick()
  assert.deepEqual(slot.clicks, ['ad-one'])
  slot.visible(1)
  assert.equal(slot.render(false), null)
  slot.elapsed()
  assert.equal(slot.impressions.length, 1)
})
