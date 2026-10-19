// Clicking small files: zoomed out, a file can be smaller than one of the pointer's cells (the desktop
// reports a cell, not a pixel, and may draw cells 29 px tall). Every file and folder on the map must
// still be reachable from some cell, a click opens the nearest thing within about a cell, and hover
// and click agree on what that is.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2031-01-01T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const ran = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'Look around', turnId: 'T' }, async () => ({}))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let tree, pan
const draw = async () => {
  tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 120, scroll: { bodyRows: 48 } }, viewport: { columns: 120 } })
  pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0].props.props
}
let n = 0
const read = f => hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${n++}`, file_path: `${P}/${f}` }, async () => ({ text: 'ok' }))

// A big, tall map, shown whole: small on screen.
const names = []
for (const d of ['src', 'src/world', 'tests', 'docs', 'tools']) for (let i = 0; i < 8; i++) names.push(`${d}/${d.replace('/', '_')}_${i}.ts`)
for (const f of names) await read(f)
for (const a of globalThis.__store.get('crew').agents) a.state = 'idle'
await draw()
await find(tree, x => x.type === 'Button' && x.props.key === 'fit')[0].props.onPress()
for (let i = 0; i < 3; i++) await draw()
check('the map is shown small (a file shorter than a cell)', pan.view.k * 70 < 29, String(pan.view.k))

// The desktop's cells as the hand reports them: 7.9 px wide, 29 px tall (in window pixels).
const CW = 7.9
const CH = 29
const msg = data => hooks['ui.message']($, { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'pan', module: './pan.tsx', data: { view: pan.view, rev: pan.rev, cell: [CW, CH], ...data } }, async () => ({}))
const hovered = () => globalThis.__store.get('hover')
// Every cell middle of the window: what resting there lights up.
const reached = new Map()
for (let r = 0; r < Math.floor(pan.vh / CH); r++)
  for (let c = 0; c < Math.floor(pan.vw / CW); c++) {
    const at = [(c + 0.5) * CW, (r + 0.5) * CH]
    await msg({ hover: at })
    const id = hovered()
    if (id && !reached.has(id)) reached.set(id, at)
  }
const files = names.map(f => `${P}/${f}`)
const missing = files.filter(f => !reached.has(f))
check('every file on the map can be pointed at from some cell', missing.length === 0, missing.slice(0, 5).join(', '))
// A click where a file lit up opens that file.
let agree = 0
for (const f of files.slice(0, 12)) {
  const at = reached.get(f)
  if (!at) continue
  ran.length = 0
  await msg({ hover: at })
  await msg({ click: at })
  await new Promise(r => setTimeout(r, 5))
  if (ran.some(a => a.join(' ').endsWith(`code -g ${f}`))) agree++
}
check('a click where a file lights up opens that file', agree === Math.min(12, files.filter(f => reached.has(f)).length), `${agree} of 12`)
// Far from anything: nothing lights up, nothing opens.
ran.length = 0
await msg({ hover: [2, pan.vh - 2] })
await msg({ click: [2, pan.vh - 2] })
await new Promise(r => setTimeout(r, 5))
check('far from everything, nothing lights up or opens', !hovered() && ran.length === 0, `${hovered()} ${JSON.stringify(ran)}`)
// The hand says how coarse its cells are.
const { default: Pan } = await import('../.build/crew-map-pan.mjs')
const posts = []
let onPointer
Pan({ ...pan }, { elements: { Box: p => ({ type: 'Box', props: p }) }, columns: Math.round(pan.vw / CW), rows: Math.round(pan.vh / CH), setState() {}, every: () => () => {}, onPointer: fn => { onPointer = fn }, onKey: () => {}, post: d => posts.push(d) })
onPointer({ type: 'move', x: 3, y: 2 })
check('the hand reports its cell size in window pixels', Array.isArray(posts.at(-1)?.cell) && Math.abs(posts.at(-1).cell[1] - pan.vh / Math.round(pan.vh / CH)) < 0.01, JSON.stringify(posts.at(-1)))
console.log(`\n${fails} failing check(s)`)
