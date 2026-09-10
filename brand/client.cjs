const React = require('react')

function BrandMark({ size }) {
  return React.createElement("img", {
    src: logoUrl,
    alt: "Mareo",
    width: size,
    height: size,
    style: { display: "block", objectFit: "contain" },
  });
}

function BrandName() {
  return React.createElement(
    "span",
    {
      style: {
        display: "block",
        height: 24,
        fontSize: 16,
        fontWeight: 600,
        lineHeight: "24px",
        letterSpacing: "normal",
        textAlign: "left",
        whiteSpace: "nowrap",
      },
    },
    "Mareo",
  );
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

// "Account" settings page. The official settings shell owns navigation and
// layout; this page talks to the Mareo host through the __mareoAccount bridge
// (exposed by Electron's preload), never to the gateway directly.
const fieldStyle = {
  display: 'grid', gap: 6, maxWidth: 360,
  font: 'inherit', color: 'inherit', marginBottom: 14,
}
const inputStyle = {
  font: 'inherit', color: 'inherit', background: 'var(--dsw-alias-bg-base, #fff)',
  border: '1px solid var(--dsw-alias-border, #d0d5dd)', borderRadius: 8, padding: '8px 10px',
}
const buttonStyle = {
  font: 'inherit', cursor: 'pointer', borderRadius: 8, padding: '8px 16px',
  border: '1px solid transparent',
}

function AccountSection() {
  const [profile, setProfile] = React.useState(null)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState('')

  React.useEffect(() => {
    if (!window.__mareoAccount) return
    window.__mareoAccount.getProfile().then((result) => {
      if (result.ok) {
        setProfile({ displayName: result.displayName, email: result.email })
        setName(result.displayName)
      }
    }).catch(() => {})
  }, [])

  if (!window.__mareoAccount) {
    return React.createElement('div', null, '请在 Mareo 桌面应用中管理你的账户。')
  }
  if (profile === null) {
    return React.createElement('div', null, '加载中…')
  }

  const rename = async () => {
    setBusy(true)
    setNotice('')
    const result = await window.__mareoAccount.updateName(name)
    if (result.ok) {
      setProfile({ ...profile, displayName: result.displayName })
      setNotice('已保存')
    } else {
      setNotice('保存失败，请重试')
    }
    setBusy(false)
  }

  const signOut = async () => {
    setBusy(true)
    await window.__mareoAccount.signOut()
    // The host tears the session down and returns to the sign-in window.
  }

  return React.createElement(
    'div',
    null,
    React.createElement('div', { style: fieldStyle },
      React.createElement('span', null, '邮箱'),
      React.createElement('div', { style: { opacity: 0.7 } }, profile.email || '—'),
    ),
    React.createElement('div', { style: fieldStyle },
      React.createElement('label', { htmlFor: 'mareo-account-name' }, '昵称'),
      React.createElement('input', {
        id: 'mareo-account-name',
        value: name,
        maxLength: 32,
        disabled: busy,
        style: inputStyle,
        onChange: (event) => setName(event.target.value),
      }),
    ),
    notice ? React.createElement('div', { style: { opacity: 0.8, marginBottom: 10 } }, notice) : null,
    React.createElement('div', { style: { display: 'flex', gap: 10 } },
      React.createElement('button', {
        type: 'button',
        disabled: busy,
        style: { ...buttonStyle, background: 'var(--dsw-alias-accent, #3d6bfe)', color: '#fff' },
        onClick: rename,
      }, '保存昵称'),
      React.createElement('button', {
        type: 'button',
        disabled: busy,
        style: { ...buttonStyle, borderColor: 'var(--dsw-alias-border, #d0d5dd)', background: 'transparent' },
        onClick: signOut,
      }, '退出登录'),
    ),
  )
}

exports.inject = ['slots']
exports.apply = (ctx) => {
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, BrandMark))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'mareo-attribution' }, Attribution))
  if (typeof window !== 'undefined' && window.__mareoAccount) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'mareo-account',
      order: 90,
      label: () => '账户',
    }, AccountSection))
  }
}
