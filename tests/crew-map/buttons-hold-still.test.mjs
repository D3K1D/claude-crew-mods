// While Claude works, the pane is drawn again and again. A button must stay the same element in the same
// place through those redraws: never swapped for plain text and back (the desktop draws a button and
// text at different sizes, so the row's spacing jumps, and the pointer's highlight flashes as the
// element under it is replaced), and never shifted to another slot by things coming and going before it.
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
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
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
const render = cols => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

/**
 * Where everything stands: each element's place as the path of child positions down to it (a keyed Box
 * by its key, so a card or window that moves as a whole is followed); for every place, what stands
 * there (a Button by its key, or Text); and for every Button, its place.
 */
const places = tree => {
  const at = new Map()
  const buttons = new Map()
  const walk = (x, path) => {
    kids(x).forEach((k, i) => {
      if (!k || typeof k !== 'object') return
      const here = `${path}/${k.type === 'Box' && k.props?.key ? `#${k.props.key}` : i}`
      if (k.type === 'Button') {
        at.set(here, `Button ${k.props?.key ?? ''}`)
        if (k.props?.key) buttons.set(String(k.props.key), here)
      } else if (k.type === 'Text') at.set(here, 'Text')
      walk(k, here)
    })
  }
  walk(tree, '')
  return { at, buttons }
}

const moved = new Map() // key → what happened
const seen = []
const note = (k, what) => { if (!moved.has(k)) moved.set(k, what) }
let last = { at: new Map(), buttons: new Map() }
const look = async (cols, label) => {
  const t = await render(cols)
  const s = places(t)
  // On the tree map, all four arrows are buttons on every drawing, whether or not the map can move that way.
  if (label.startsWith('map')) for (const d of ['left', 'up', 'down', 'right']) if (!s.buttons.has(`move-${d}`)) note(`move-${d}`, `${label}: not a button`)
  // A button that went to another place.
  for (const [k, p] of last.buttons) if (s.buttons.has(k) && s.buttons.get(k) !== p) note(k, `${label}: moved`)
  // A place where a button stood and now text does, or the other way round.
  for (const [p, was] of last.at) {
    const is = s.at.get(p)
    if (!is || is === was) continue
    if (was.startsWith('Button') && is === 'Text') note(was.slice(7), `${label}: turned into text`)
    if (was === 'Text' && is.startsWith('Button')) note(is.slice(7), `${label}: was text, turned into a button`)
  }
  last = s
  return t
}
const slots = tree => places(tree).buttons

// A busy session, drawn after every event, in both views and at two widths.
for (const [view, cols] of [['desks', 87], ['map', 87], ['map', 140], ['desks', 140]]) {
  globalThis.__store.clear()
  // The module keeps its store reference: start each run from a fresh session instead.
  await fire('session.start', {}, async () => ({}))
  globalThis.__store.get('crew').view = view
  last = { at: new Map(), buttons: new Map() }
  const L = `${view}@${cols}`
  await fire('turn.start', { text: 'Build the production UI with adapters', turnId: `T-${L}` }, async () => ({}))
  const first = await look(cols, L)
  seen.push(...slots(first).keys())
  let n = 0
  // On the tree map, zoomed in, as you would to watch: the map then grows past the window as work comes in.
  if (view === 'map') {
    await fire('tool.call', { tool: 'Read', tool_use_id: `${L}-z`, file_path: `${P}/ui/a.js` }, async () => ({ text: 'ok' }))
    for (let i = 0; i < 3; i++) {
      const b = (function find(x) { if (!x || typeof x !== 'object') return; if (x.type === 'Button' && x.props?.key === 'bigger') return x; for (const k of kids(x)) { const f = find(k); if (f) return f } })(await render(cols))
      b?.props.onPress()
      await tick()
    }
    // ...and moved to its left edge, where ◀ has nowhere to go.
    for (let i = 0; i < 8; i++) {
      const b = (function find(x) { if (!x || typeof x !== 'object') return; if (x.type === 'Button' && x.props?.key === 'move-left') return x; for (const k of kids(x)) { const f = find(k); if (f) return f } })(await render(cols))
      b?.props.onPress()
      await tick()
    }
    last = { at: new Map(), buttons: new Map() }
    await look(cols, L)
  }
  const files = ['ui/a.js', 'ui/b.js', 'ui/js/adapters/fixture.js', 'ui/js/adapters/real.js', 'docs/notes.md', 'tests/adapter.test.js', 'src/core/state.ts', 'src/core/bus.ts']
  for (const f of files) {
    now += 2000
    await fire('tool.call', { tool: n % 3 ? 'Read' : 'Edit', tool_use_id: `${L}-c${n++}`, file_path: `${P}/${f}`, old_string: 'a', new_string: 'b\nc' }, async () => {
      await look(cols, L)
      return { text: 'ok' }
    })
    await look(cols, L)
  }
  for (const id of ['sub1', 'sub2', 'sub3']) {
    await fire('tool.call', { tool: 'Agent', tool_use_id: `${L}-sp${id}`, description: `Part ${id}`, prompt: `Do ${id}`, subagent_type: 'general-purpose', run_in_background: true }, async e => {
      await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: `Do ${id}`, description: `Part ${id}`, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: `${L}-${id}` }))
      return { text: 'Started' }
    })
    await look(cols, L)
    for (const f of files.slice(0, 4)) {
      now += 1500
      await fire('tool.call', { tool: 'Read', tool_use_id: `${L}-${id}-${n++}`, agentId: `${L}-${id}`, file_path: `${P}/${f}` }, async () => {
        await look(cols, L)
        return { text: 'ok' }
      })
    }
  }
  await fire('tool.call', { tool: 'Bash', tool_use_id: `${L}-b1`, command: 'npm test', description: 'Run the adapter tests' }, async () => {
    for (let i = 0; i < 3; i++) { now += 1000; await look(cols, L) }
    return { text: '26 passing' }
  })
  for (const id of ['sub1', 'sub2', 'sub3']) {
    await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: `S${id}`, agentId: `${L}-${id}`, usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
    await look(cols, L)
  }
  await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: `T-${L}`, usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
  await look(cols, L)
}
await tick()
check("the check sees the toolbars (the theme switch and the tree map's zoom are among the buttons followed)", seen.includes('theme') && seen.includes('bigger'), [...new Set(seen)].join(','))
const list = [...moved].map(([k, w]) => `${k} (${w})`)
check('while Claude works, no button turns into text or moves to another slot', !list.length, list.join('; '))
console.log(`\n${fails} failing check(s)`)
