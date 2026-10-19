// Release matrix for the tree map and the parts below it: many Claudes, many files, long names and
// text, running commands and tests, problems, a summary, a long replay, pane widths 40 to 300, the
// terminal surface. Each Claude's window keeps its rows, the log keeps its rows, nothing reads
// "undefined"/"NaN", the map stays under the Svg limit, the log keeps room for its text, the replay
// bar keeps its height, the toolbar keeps its height, Ctrl reaches a folder click, and files with a
// long shared start keep different names on the map.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const files = {}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async p => { if (p in files) return files[p]; throw new Error('ENOENT') }, exists: async p => p in files, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const crew = () => globalThis.__store.get('crew')
const setCrew = c => globalThis.__store.set('crew', c)
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const W = t => [...t].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u.test(ch) ? 2 : 1), 0)
const render = (cols, surface = 'desktop') => hooks['ui.render']($, { surface, props: { bodyColumns: cols, scroll: { bodyRows: 50 } }, viewport: { columns: cols } })
const tick = () => new Promise(r => setTimeout(r, 10))
let n = 0
const call = (agentId, tool, args, result = { text: 'ok' }, during) =>
  hooks['tool.call']($, { tool, tool_use_id: `m${n++}`, ...(agentId === 'main' ? {} : { agentId }), ...args }, async () => { if (during) await during(); return result })
const read = (who, f) => call(who, 'Read', { file_path: `${P}/${f}` })
const edit = (who, f) => call(who, 'Edit', { file_path: `${P}/${f}`, old_string: 'a', new_string: 'a\nb' })
const spawn = (agentId, type, description) => hooks['agent.spawn']($, { subagentType: type, description, prompt: 'go', tool_use_id: `s${n++}` }, async () => ({ agentId }))
/** Rows an element takes (a wrapping Text counts one; checked apart). */
const rowsOf = x => {
  if (!x || typeof x !== 'object') return 0
  const p = x.props ?? {}
  if (x.type === 'Text' || x.type === 'Button' || x.type === 'Select' || x.type === 'Input') return 1
  if (x.type === 'Svg') return Math.ceil((p.height ?? 0) / 19)
  if (x.type === 'Client') return typeof p.height === 'number' ? p.height : 1
  if (typeof p.height === 'number') return p.height + (p.marginTop ?? 0)
  const k = kids(x).filter(c => c && typeof c === 'object')
  const inner = (p.flexDirection ?? 'row') === 'column' ? k.reduce((s, c) => s + rowsOf(c), 0) + Math.max(0, k.length - 1) * (p.rowGap ?? 0) : Math.max(0, ...k.map(rowsOf))
  return inner + (p.borderStyle ? 2 : 0) + (p.marginTop ?? 0)
}
const claudeWindows = tree => find(tree, x => x.type === 'Box' && x.props.borderStyle && x.props.flexDirection === 'column' && text(kids(x)[0] ?? '').startsWith('✻ ') && !text(x).includes('CLAUDE CREW'))
const logBox = tree => find(tree, x => x.type === 'Box' && x.props.borderStyle && text(kids(x)[0] ?? '').startsWith('log'))[0]
const WIDTHS = [40, 60, 80, 100, 120, 150, 200, 300]

// ── A crowd: ten Claudes (one with a long custom type), 80 files, commands and tests running, problems ──
const long = 'Port the chunk loader to the new streaming API and make sure every single test still passes afterwards, then clean up all the old code paths'
await hooks['turn.start']($, { text: long, turnId: 'T1' }, async () => ({}))
const ids = ['main']
const types = ['Explore', 'Plan', 'general-purpose', 'fork', 'release-notes-and-changelog-writer']
for (let i = 1; i < 10; i++) { ids.push(`a${i}`); await spawn(`a${i}`, types[i % 5], `Job ${i}: ${long}`) }
for (let i = 0; i < 80; i++) {
  const f = `src/m${i % 5}/module_with_a_long_name_${i}.ts`
  if (i % 3) await read(ids[i % 10], f)
  else await edit(ids[i % 10], f)
}
for (const who of ids) await hooks['session.append']($, { door: 'response', ...(who === 'main' ? {} : { agentId: who }), message: { role: 'assistant', content: [{ type: 'text', text: `I think ${long.toLowerCase()}.` }] }, origin: {}, uuid: `u${n++}` }, async () => ({}))
const hang = () => new Promise(() => {})
for (let i = 0; i < 6; i++) {
  void call(ids[i], 'Bash', { command: `cargo build -p c${i}`, description: `Build crate ${i} with every optional feature on` }, { text: 'ok' }, hang)
  await call(ids[i], 'Bash', { command: `pytest tests/test_${i}.py`, run_in_background: true }, { text: `Command running in background with ID: bash_${i}` })
}
await tick()
await call('main', 'Bash', { command: 'npx tsc --noEmit' }, { text: Array.from({ length: 12 }, (_, i) => `src/m0/module_with_a_long_name_${i}.ts(${i + 1},5): error TS2322: Type 'string' is not assignable to type 'number'.`).join('\n'), isError: true })
now += 5000
setCrew({ ...crew(), view: 'map', budget: 0.01 })

for (const cols of WIDTHS) {
  const tree = await render(cols)
  const wins = claudeWindows(tree)
  check(`${cols} cols: every Claude's window is 8 rows inside its border`, wins.length > 0 && wins.every(w => rowsOf(w) === 10), wins.map(rowsOf).join(','))
  check(`${cols} cols: the log is 12 rows under its title`, rowsOf(logBox(tree)) === 15, String(rowsOf(logBox(tree))))
  check(`${cols} cols: the running line is one row`, rowsOf(find(tree, x => x.props?.key === 'running')[0]) === 1)
  const raw = find(tree, x => x.type === 'Text' || x.type === 'Button').map(text).filter(t => /undefined|NaN|\[object Object\]|Infinity/.test(t))
  const svg = find(tree, x => x.type === 'Svg')[0]?.props.source ?? ''
  check(`${cols} cols: no raw internal text`, !raw.length && !/undefined|NaN|Infinity/.test(svg), raw.slice(0, 2).join(' | '))
  check(`${cols} cols: the map is under the Svg limit`, svg.length > 0 && svg.length <= 131072, String(svg.length))
  // The log: a long Claude name must not leave its lines no room for what happened.
  if (cols <= 80) {
    const lines = kids(logBox(tree)).slice(1).filter(l => l?.props?.flexDirection === 'row')
    const room = Math.floor(cols * 0.97) - 1 - 4
    const squeezed = lines.filter(l => room - W(text(kids(l)[0])) - W(text(kids(l)[1])) < 12)
    check(`${cols} cols: every log line keeps room for its text beside the time and the name`, lines.length > 0 && squeezed.length === 0, squeezed.slice(0, 2).map(l => JSON.stringify(text(l))).join(' | '))
  }
}
// The terminal: the same fixed windows, and the tree map has a way back to the desks.
{
  const t = await render(100, 'terminal')
  check('terminal: every Claude window is 8 rows inside its border', claudeWindows(t).every(w => rowsOf(w) === 10))
  check('terminal: the log is 6 rows under its title', rowsOf(logBox(t)) === 9, String(rowsOf(logBox(t))))
  check('terminal, tree map chosen: a button leads back to the desks', find(t, x => x.type === 'Button' && x.props.key === 'view-desks').length === 1)
}

// ── The toolbar under the map keeps its height when files outside the project are hidden ──
{
  for (let i = 0; i < 3; i++) await call('main', 'Read', { file_path: `C:/other/lib/out_${i}.ts` })
  const toolbarRows = async cols => {
    const tree = await render(cols)
    const bar = find(tree, x => x.type === 'Box' && x.props.flexWrap === 'wrap' && find(x, y => y.props?.key === 'view-desks').length)[0]
    // Greedy wrap of its parts into the pane's width.
    const avail = Math.floor(cols * 0.97) - 1
    let rows = 1
    let used = 0
    for (const k of kids(bar)) {
      const w = k.type === 'Select' ? 14 : W(text(k))
      if (used && used + w > avail) { rows++; used = 0 }
      used += w
    }
    return rows
  }
  for (const cols of [120, 130]) {
    setCrew({ ...crew(), hideOutside: false })
    const before = await toolbarRows(cols)
    setCrew({ ...crew(), hideOutside: true })
    const after = await toolbarRows(cols)
    check(`${cols} cols: hiding the files outside the project does not add a toolbar row`, before === after, `${before} → ${after}`)
  }
  setCrew({ ...crew(), hideOutside: false })
}

// ── Files whose names share a long start keep different names on the map ──
{
  for (const i of [1, 2]) await read('main', `docs/an-extremely-long-file-name-${i}-that-goes-on.generated.ts`)
  const svg = find(await render(150), x => x.type === 'Svg')[0].props.source
  const names = [...svg.matchAll(/class="m" font-size="11" font-weight="600" fill="[^"]+">([^<]*)<\/text>/g)].map(m => m[1]).filter(t => t.startsWith('an-extre') || /name-[12]-/.test(t))
  check('two long names that differ only in the middle stay told apart on the map', names.length === 2 && names[0] !== names[1], JSON.stringify(names))
}

// ── Ctrl-click: the hand passes Ctrl with a click, so a folder can open in the file manager as its tip says ──
{
  const { default: Pan } = await import('../.build/crew-map-pan.mjs')
  const posts = []
  let onPointer
  const surface = { elements: { Box: props => ({ type: 'Box', props }) }, state: undefined, setState(s) { this.state = s }, columns: 100, rows: 30, every: () => () => {}, onPointer: fn => { onPointer = fn; return () => {} }, onKey: () => () => {}, post: d => posts.push(d) }
  Pan({ cw: 8, ch: 20, vw: 800, vh: 600, view: { x: 0, y: 0, k: 1 }, rev: 'fit' }, surface)
  onPointer({ type: 'down', x: 10, y: 5, button: 'left', ctrl: true, modifiers: { ctrl: true } })
  onPointer({ type: 'up', x: 10, y: 5, button: 'left', ctrl: true, modifiers: { ctrl: true } })
  const click = posts.find(p => p.click)
  check('a Ctrl-click on the map reaches the pane with Ctrl', !!click && click.ctrl === true, JSON.stringify(click))
}

// ── The replay bar keeps one height as it steps along a long timeline ──
{
  for (let i = 0; i < 40; i++) await call(ids[i % 2], 'Grep', { pattern: i % 4 ? 'x' : 'a rather long search pattern that someone might type when looking for the chunk loader code', path: P })
  const bar = find(await render(100), x => x.type === 'Button' && x.props.key === 'replay')[0]
  await bar.props.onPress()
  await tick()
  const last = crew().timeline.length - 1
  for (const cols of [40, 80, 120]) {
    const heights = new Set()
    for (let at = Math.max(0, last - 40); at <= last; at++) {
      globalThis.__store.set('replay', { on: true, at, playing: false })
      const tree = await render(cols)
      const box = find(tree, x => x.props?.key === 'replay')[0]
      const wraps = find(box, x => x.type === 'Text' && x.props.wrap === 'wrap')
      // A wrapping line takes as many rows as its text needs across the box's inside.
      heights.add(rowsOf(box) + wraps.reduce((s, w) => s + Math.max(0, Math.ceil(W(text(w)) / (cols - 4 - W(text(kids(find(box, y => y.type === 'Box' && kids(y).includes(w))[0] ?? {})[0] ?? '')))) - 1), 0))
    }
    check(`${cols} cols: the replay bar keeps one height from step to step`, heights.size === 1, [...heights].join(','))
  }
  globalThis.__store.set('replay', { on: false, at: 0, playing: false })
}

console.log(`\n${fails} failing check(s)`)
process.exit(0)
