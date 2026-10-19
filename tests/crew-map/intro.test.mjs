// The intro: plays on start and on /crew, ends by itself, can be skipped, turned off and replayed.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../.build/out', import.meta.url))
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const timers = []
const stored = {}
const toasts = []
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => toasts.push(t) },
  clock: {
    every: () => ({ cancel() {} }),
    after: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return { cancel() { t.dead = true } } },
  },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => stored[k], set: async (k, v) => { stored[k] = v } },
  session: { cwd: async () => 'C:/work/game' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({}) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
const render = (surface = 'desktop') => hooks['ui.render']($, { surface, props: { bodyColumns: 150 }, viewport: { columns: 150 } })
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const btn = (tree, key) => find(tree, x => x.type === 'Button' && x.props.key === key)[0]
const advance = async ms => { now += ms; for (const t of timers.filter(t => !t.dead && t.at <= now)) { t.dead = true; t.fn() } await new Promise(r => setTimeout(r, 5)) }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

await hooks['session.start']($, {}, async () => ({}))
let tree = await render()
const svg = find(tree, x => x.type === 'Svg')[0]?.props.source ?? ''
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/intro.svg`, svg)
check('the intro plays when the mod starts', svg.includes('ALL SYSTEMS ONLINE') && !text(tree).includes('CLAUDE CREW v'), `${svg.length} chars`)
check('it has a skip button and a turn-off button', !!btn(tree, 'intro-skip') && !!btn(tree, 'intro-off'))
check('its markup has no clock in it, so redraws keep it running', (await render(), find(await render(), x => x.type === 'Svg')[0].props.source === svg))
check('it stays well under the Svg limit', svg.length < 40_000, String(svg.length))
check('the terminal skips it', text(await render('terminal')).includes('CLAUDE CREW v'))
await advance(6300)
tree = await render()
check('after about six seconds the pane is itself', text(tree).includes('CLAUDE CREW v') && !btn(tree, 'intro-skip'))
// /crew plays it again; skip ends it at once.
await hooks['command.run']($, { command: 'crew' }, async () => ({}))
tree = await render()
check('/crew plays it again', !!btn(tree, 'intro-skip'))
await btn(tree, 'intro-skip').props.onPress()
await new Promise(r => setTimeout(r, 5))
check('skip goes straight to the pane', text(await render()).includes('CLAUDE CREW v'))
// Turned off, it no longer plays on /crew; the header button plays it and turns it back on.
await hooks['command.run']($, { command: 'crew' }, async () => ({}))
await btn(await render(), 'intro-off').props.onPress()
await new Promise(r => setTimeout(r, 5))
check("don't show again stores the choice", stored.intro === 'off' && toasts.some(t => t.startsWith('Intro off')))
await hooks['command.run']($, { command: 'crew' }, async () => ({}))
check('once off, /crew opens the pane straight away', text(await render()).includes('CLAUDE CREW v'))
await btn(await render(), 'intro').props.onPress()
await new Promise(r => setTimeout(r, 5))
check('the ⏻ intro button plays it and turns it back on', !!btn(await render(), 'intro-skip') && stored.intro === 'on')
console.log(`\n${fails} failing check(s)`)
