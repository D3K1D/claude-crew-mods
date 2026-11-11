// Following a Claude on the tree map: ◎ follow in its window centres the camera on it, closer than the
// whole map but not right up to it, and the camera moves with it as it goes from file to file. Moving the
// map by hand stops it, as does pressing the button again or the Claude finishing.
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
const toasts = []
const afters = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async m => { toasts.push(m) } },
  clock: { every: () => ({ cancel() {} }), after: (ms, fn) => { afters.push(fn); return { cancel() {} } } },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
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
const render = (cols = 120) => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const button = (t, key) => find(t, x => x.type === 'Button' && x.props.key === key)[0]
const press = async (t, key) => { button(t, key).props.onPress(); await tick() }
// The camera as the map's hand is told it: where its window starts, how close, and its centre.
const camera = t => {
  const p = find(t, x => x.type === 'Client' && x.props.key === 'pan')[0]?.props?.props
  return p ? { ...p.view, cx: p.view.x + p.vw / p.view.k / 2, cy: p.view.y + p.vh / p.view.k / 2, rev: p.rev } : undefined
}
const crew = () => globalThis.__store.get('crew')
const read = (agentId, f) => fire('tool.call', { tool: 'Read', tool_use_id: `r${now++}`, ...(agentId ? { agentId } : {}), file_path: `${P}/${f}` }, async () => ({ text: 'ok' }))

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Build the inventory', turnId: 'T' }, async () => ({}))
for (const f of ['src/ui/panel.ts', 'src/ui/grid.ts', 'src/ui/slot.ts', 'src/core/items.ts', 'src/core/store.ts', 'docs/inventory.md', 'tests/panel.test.ts', 'tests/grid.test.ts']) await read(undefined, f)
await fire('tool.call', { tool: 'Agent', tool_use_id: 'sp1', description: 'Check the grid', prompt: 'Check the grid', subagent_type: 'Explore', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Check the grid', description: 'Check the grid', subagentType: 'Explore', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  return { text: 'Started' }
})
await read('sub1', 'tests/grid.test.ts')
await read(undefined, 'src/ui/panel.ts')

// The tree map, the whole of it in view.
let t = await render()
await press(t, 'view-map')
t = await render()
const whole = camera(t)
check('the tree map is open, its camera on the whole map', !!whole, JSON.stringify(whole))
const win = find(t, x => x.props?.key === 'win-sub1')[0]
check("each Claude's window has ◎ follow", text(button(t, 'follow:sub1')) === '◎ follow' && !!find(win, x => x.props?.key === 'follow:sub1').length)

// Follow Scout.
await press(t, 'follow:sub1')
t = await render()
const on1 = camera(t)
check('following: the camera closes in on it (1.35×, not the whole map, not right up to it)', Math.abs(on1.k - 1.35) < 0.01 && on1.k > whole.k, `k ${whole.k.toFixed(2)} → ${on1.k.toFixed(2)}`)
check('...centred somewhere else than the whole map was', Math.abs(on1.cx - whole.cx) + Math.abs(on1.cy - whole.cy) > 20, `${whole.cx.toFixed(0)},${whole.cy.toFixed(0)} → ${on1.cx.toFixed(0)},${on1.cy.toFixed(0)}`)
check('...and its window says ◉ following', text(button(t, 'follow:sub1')) === '◉ following')

// It moves on: the camera goes with it.
await read('sub1', 'src/core/items.ts')
t = await render()
const on2 = camera(t)
check('it moves to another file: the camera goes with it', Math.abs(on2.cx - on1.cx) + Math.abs(on2.cy - on1.cy) > 20 && on2.rev !== on1.rev, `${on1.cx.toFixed(0)},${on1.cy.toFixed(0)} → ${on2.cx.toFixed(0)},${on2.cy.toFixed(0)}`)
await read(undefined, 'docs/inventory.md')
check('another Claude moving does not move the camera', JSON.stringify(camera(await render())) === JSON.stringify(on2))

// Moving the map by hand stops following.
await press(await render(), 'bigger')
// (the zoom completes on the next drawing)
await tick()
t = await render()
await tick()
t = await render()
check('zooming by hand stops following', crew().track === undefined && text(button(await render(), 'follow:sub1')) === '◎ follow', JSON.stringify(crew().track))
await read('sub1', 'src/ui/slot.ts')
const after = camera(await render())
await read('sub1', 'src/core/store.ts')
check('...and the camera stays where it was put as the Claude moves on', JSON.stringify(camera(await render())) === JSON.stringify(after))

// Pressing it again stops it too.
await press(await render(), 'follow:sub1')
check('follow again', crew().track?.id === 'sub1')
await press(await render(), 'follow:sub1')
check('pressing ◉ following stops it', crew().track === undefined)

// The Claude finishing stops it.
await press(await render(), 'follow:sub1')
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'S', agentId: 'sub1', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await render()
await tick()
check('once it finishes, following stops', crew().track === undefined, JSON.stringify(crew().track))

// From the desks: it follows there on the tree map, and says so.
t = await render()
await press(t, 'view-desks')
t = await render()
await press(t, 'follow:main')
check('from the desks it says where to watch', crew().track?.id === 'main' && /Open ⊞ tree map to watch/.test(toasts.at(-1) ?? ''), toasts.at(-1))
await press(await render(), 'view-map')
const onMain = camera(await render())
check('...and opening the tree map, the camera is on it', Math.abs(onMain.k - 1.35) < 0.01, JSON.stringify(onMain))
console.log(`\n${fails} failing check(s)`)
