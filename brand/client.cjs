const React = require('react')

function BrandMark({ size }) {
  return React.createElement('img', {
    src: logoUrl,
    alt: 'Mareo 0',
    width: size,
    height: size,
    style: { display: 'block', objectFit: 'contain' },
  })
}

function BrandName() {
  // The official sidebar reserves 24px for this slot; both lines fit inside it.
  return React.createElement('div', { style: { display: 'grid', height: 24 } },
    React.createElement('span', {
      style: { fontSize: 14, fontWeight: 600, lineHeight: '14px', whiteSpace: 'nowrap' },
    }, 'Mareo 0'),
    React.createElement('span', {
      style: { fontSize: 9, lineHeight: '10px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
    }, 'Built on DeepSeek Harness'),
  )
}

function Attribution() {
  return React.createElement('div', {
    style: {
      position: 'fixed', right: 16, bottom: 10, pointerEvents: 'none',
      fontSize: 10, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)',
      background: 'var(--dsw-alias-bg-base)', borderRadius: 4, padding: '0 4px',
    },
  }, 'Built on DeepSeek Harness')
}

exports.inject = ['slots']
exports.apply = (ctx) => {
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, BrandMark))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'mareo-attribution' }, Attribution))
}
