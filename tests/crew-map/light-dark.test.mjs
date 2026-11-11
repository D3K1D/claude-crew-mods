// Light and dark. Auto (the default): Text and borders take the theme's own colours (which Claude
// Code tunes for a light or a dark theme) or a middle shade that reads on both; pictures carry light
// colours for a light app. Light: every colour swapped for a light twin that reads on white. Dark: as
// drawn. The toolbar's switch cycles auto → light → dark and is kept.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const saved = {}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : saved[k]), set: async (k, v) => { saved[k] = v } },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = (cols = 120, surface = 'desktop') => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface, props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const KEYS = new Set(['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide'])
const rgb = h => { const x = h.replace('#', ''); const f = x.length === 3 ? [...x].map(c => c + c) : [x.slice(0, 2), x.slice(2, 4), x.slice(4, 6)]; return f.map(v => parseInt(v, 16) / 255) }
const lum = h => { const [r, g, b] = rgb(h).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const colours = t => find(t, x => x.type === 'Text' && typeof x.props.color === 'string').map(x => x.props.color)
const borders = t => find(t, x => x.type === 'Box' && typeof x.props.borderColor === 'string').map(x => x.props.borderColor)
const press = async (t, key) => { find(t, x => x.type === 'Button' && x.props.key === key)[0].props.onPress(); await tick() }

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Fix the login flow', turnId: 'T' }, async () => ({}))
await fire('tool.call', { tool: 'Read', tool_use_id: 'r1', file_path: `${P}/src/auth/token.ts` }, async () => ({ text: 'ok' }))
await fire('tool.call', { tool: 'Edit', tool_use_id: 'e1', file_path: `${P}/src/auth/token.ts`, old_string: 'a', new_string: 'b\nc' }, async () => ({ text: 'ok' }))
await fire('tool.call', { tool: 'Agent', tool_use_id: 'sp1', description: 'Check the docs', prompt: 'Check the docs', subagent_type: 'Explore', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Check the docs', description: 'Check the docs', subagentType: 'Explore', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  return { text: 'Started in the background' }
})
await fire('tool.call', { tool: 'Read', tool_use_id: 'r2', agentId: 'sub1', file_path: `${P}/docs/guide.md` }, async () => ({ text: 'ok' }))
// The main Claude waits on you for a permission.
let release
const perm = fire('classic.PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build folder' } }, () => new Promise(r => (release = r)))
await tick()

// ── Auto, the default ──
let t = await render()
const auto = colours(t)
const offTheme = auto.filter(c => !KEYS.has(c) && !(c.startsWith('#') && lum(c) >= 0.14 && lum(c) <= 0.31))
check('auto: every Text colour is a theme colour, or a middle shade that reads on light and dark', auto.length > 10 && !offTheme.length, offTheme.join(','))
check('auto: every border is a theme colour or a middle shade', borders(t).every(c => KEYS.has(c) || (lum(c) >= 0.14 && lum(c) <= 0.31)), borders(t).filter(c => !KEYS.has(c)).join(','))
check('auto: waiting on you reads in the theme\'s warning colour', find(t, x => x.props?.key === 'desk-main')[0]?.props.borderColor === 'warning', find(t, x => x.props?.key === 'desk-main')[0]?.props.borderColor)
check("auto: the main Claude's name is in the theme's Claude colour", find(t, x => x.type === 'Text' && x.props.color === 'claude' && /Claude/.test(text(x))).length > 0)
check('auto: an edited file\'s line count is in the theme\'s success colour', find(t, x => x.type === 'Text' && x.props.color === 'success' && /\+\d/.test(text(x))).length > 0)
const sprite = find(t, x => x.type === 'Svg' && /data-keep-darks/.test(x.props.source))[0]?.props.source ?? ''
check('auto: a sprite carries light colours for a light app', /@media \(prefers-color-scheme: light\)\{\[fill="#D97757"\]\{fill:#BC5A34\}/.test(sprite), (sprite.match(/<style>@media[^<]*<\/style>/) ?? [''])[0].slice(0, 120))
check("...but keeps its eyes and shine (its darkest and whitest marks)", !/\[fill="#(0D1117|07080B|FFFFFF|fff|FFF)"\]/i.test(sprite))
check('auto: the theme switch shows ◐ auto', text(find(t, x => x.type === 'Button' && x.props.key === 'theme')[0]) === '◐ auto')

// The tree map in auto: its ground and every colour it draws carry a light twin.
await press(t, 'view-map')
t = await render()
const map = find(t, x => x.type === 'Svg' && /viewBox/.test(x.props.source) && !/data-keep-darks/.test(x.props.source)).map(x => x.props.source).sort((a, b) => b.length - a.length)[0] ?? ''
check('auto: the tree map turns light with the app (its ground #07080B → white)', /@media \(prefers-color-scheme: light\)\{[^}]*\[fill="#07080B"\]\{fill:#FFFFFF\}/.test(map))
check('...the style sits inside the picture, before its end', /<style>@media[^]*<\/style><\/svg>\s*$/.test(map))
const drawnWith = new Set([...map.matchAll(/\s(fill|stroke)="(#[0-9A-Fa-f]{3,6})"/g)].map(m => `${m[1]}="${m[2]}"`))
const ruled = new Set([...map.matchAll(/\[(fill|stroke)="(#[0-9A-Fa-f]{3,6})"\]/g)].map(m => `${m[1]}="${m[2]}"`))
const bright = [...drawnWith].filter(d => !ruled.has(d) && lum(d.match(/#\w+/)[0]) > 0.35)
check('...and no bright dark-theme colour is left without a light twin', !bright.length, bright.slice(0, 6).join(' '))
await press(t, 'view-desks')

// ── Light ──
t = await render()
await press(t, 'theme')
check('the switch goes auto → light, and is kept', saved.theme === 'light' && globalThis.__store.get('crew').theme === 'light', String(saved.theme))
t = await render()
const light = colours(t)
check('light: no theme colours (a light app or not, it draws light)', light.length > 10 && light.every(c => c.startsWith('#')), light.filter(c => !c.startsWith('#')).join(','))
const faint = light.filter(c => contrast(c, '#FFFFFF') < 3)
check('light: every Text colour reads on white (3:1 or more)', !faint.length, faint.map(c => `${c} ${contrast(c, '#FFFFFF').toFixed(1)}`).join(', '))
check('light: waiting on you is a deep amber', find(t, x => x.props?.key === 'desk-main')[0]?.props.borderColor === '#9A6700')
const lightSprite = find(t, x => x.type === 'Svg' && /data-keep-darks/.test(x.props.source))[0]?.props.source ?? ''
check('light: the sprite takes its light colours always (no media query)', /<style>\[fill="#D97757"\]\{fill:#BC5A34\}/.test(lightSprite))
await press(t, 'view-map')
t = await render()
const lightMap = find(t, x => x.type === 'Svg' && /viewBox/.test(x.props.source) && !/data-keep-darks/.test(x.props.source)).map(x => x.props.source).sort((a, b) => b.length - a.length)[0] ?? ''
check('light: the tree map is white', /<style>[^@]*\[fill="#07080B"\]\{fill:#FFFFFF\}/.test(lightMap))
await press(t, 'view-desks')

// ── Dark ──
t = await render()
await press(t, 'theme')
t = await render()
check('the switch goes light → dark, and is kept', saved.theme === 'dark' && text(find(t, x => x.type === 'Button' && x.props.key === 'theme')[0]) === '☾ dark')
check('dark: drawn as tuned (no theme colours, no light rules)', colours(t).every(c => c.startsWith('#')) && !find(t, x => x.type === 'Svg' && /prefers-color-scheme|\]\{fill:/.test(x.props.source)).length)
check('dark: waiting on you is the bright amber', find(t, x => x.props?.key === 'desk-main')[0]?.props.borderColor === '#E3B341')
await press(t, 'theme')
check('dark → auto again', saved.theme === 'auto')

// A new session starts in the theme chosen last.
saved.theme = 'light'
await fire('session.start', {}, async () => ({}))
check('a new session starts in the theme chosen last', globalThis.__store.get('crew').theme === 'light')

// The terminal follows its own theme through the theme colours too.
saved.theme = 'auto'
await fire('session.start', {}, async () => ({}))
t = await render(120, 'terminal')
check('terminal, auto: theme colours too', colours(t).some(c => KEYS.has(c)) && colours(t).every(c => KEYS.has(c) || (lum(c) >= 0.14 && lum(c) <= 0.31)), colours(t).filter(c => !KEYS.has(c)).join(','))
release({})
console.log(`\n${fails} failing check(s)`)
