import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

interface Element {
  tag: string
  props: { alt?: string; width?: number; src?: string; style?: { height?: number; pointerEvents?: string } }
  children: (Element | string)[]
}

test('brand plugin occupies only official brand and overlay slots', () => {
  const registrations = new Map<string, { options: Record<string, string>; render: (props?: { size: number }) => Element }>()
  const plugin: { apply?: (ctx: unknown) => void } = {}
  vm.runInNewContext(readFileSync(path.resolve('brand/client.cjs'), 'utf8'), {
    logoUrl: 'data:image/png;base64,test', exports: plugin,
    require: (name: string) => {
      assert.equal(name, 'react')
      return { createElement: (tag: string, props: Element['props'], ...children: Element['children']) => ({ tag, props, children }) }
    },
  })
  plugin.apply!({ slots: {
    inject: (_name: string, register: () => void) => register(),
    register: (options: Record<string, string>, render: (props?: { size: number }) => Element) => {
      assert(!registrations.has(options.name))
      registrations.set(options.name, { options, render })
    },
  } })
  assert.deepEqual([...registrations.keys()], [
    'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark', 'shell.overlay',
  ])
  for (const name of ['sidebar.brand.mark', 'conversation.hero.brand.mark']) {
    const mark = registrations.get(name)!.render({ size: 24 })
    assert.equal(mark.props.alt, 'Mareo 0')
    assert.equal(mark.props.width, 24)
    assert.equal(mark.props.src, 'data:image/png;base64,test')
  }
  const name = registrations.get('sidebar.brand.name')!.render()
  assert.equal(name.props.style?.height, 24)
  assert.equal((name.children[0] as Element).children[0], 'Mareo 0')
  assert.equal((name.children[1] as Element).children[0], 'Built on DeepSeek Harness')
  const attribution = registrations.get('shell.overlay')!
  assert.equal(attribution.options.id, 'mareo-attribution')
  assert.equal(attribution.render().props.style?.pointerEvents, 'none')
})
