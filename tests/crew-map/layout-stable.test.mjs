// Fixed spots: as Claude works (reading, thinking, running commands and tests, finishing a turn),
// the map, the toolbar, the running box, Claude's window and the log keep their places and their
// heights. What comes and goes is drawn inside rows kept for it, or below the log.
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
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

/** Rows a drawn element takes (text one row each; a wrapping Text counted as one, so it is checked apart). */
const rowsOf = x => {
  if (!x || typeof x !== 'object') return 0
  const p = x.props ?? {}
  if (x.type === 'Text' || x.type === 'Button' || x.type === 'Select' || x.type === 'Input') return 1
  if (x.type === 'Svg') return Math.ceil((p.height ?? 0) / 19)
  if (x.type === 'Client') return p.height ?? 1
  if (p.position === 'absolute') return 0
  if (p.height != null && typeof p.height === 'number') return p.height + (p.marginTop ?? 0)
  const kids = (p.children ?? []).filter(k => k && typeof k === 'object')
  const inner = (p.flexDirection ?? 'row') === 'column' ? kids.reduce((n, k) => n + rowsOf(k), 0) + Math.max(0, kids.length - 1) * (p.rowGap ?? 0) : Math.max(0, ...kids.map(rowsOf))
  return inner + (p.borderStyle ? 2 : 0) + (p.marginTop ?? 0)
}
/** Where each fixed part starts (in rows from the top of the pane) and how tall it is. */
const layout = async cols => {
  const tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 50 } }, viewport: { columns: cols } })
  const parts = tree.props.children.filter(k => k && typeof k === 'object')
  const out = {}
  let at = 0
  for (const k of parts) {
    const h = rowsOf(k)
    const name = find(k, x => x.props?.key === 'map').length ? 'map+toolbar' : k.props?.key === 'running' ? 'running' : find(k, x => x.type === 'Text' && text(x).startsWith('✻ Claude')).length ? 'windows' : find(k, x => x.type === 'Text' && text(x) === 'log').length && k.props?.borderStyle ? 'log' : null
    if (name) out[name] = [at, h]
    at += h + (tree.props.rowGap ?? 0)
  }
  return { out, tree }
}

const states = []
const snap = async (what, cols = 140) => states.push({ what, cols, ...(await layout(cols)) })

for (const cols of [140, 100]) {
  states.length = 0
  await snap('before a prompt', cols)
  await hooks['turn.start']($, { text: 'Port the chunk loader to the new streaming API and make sure every test still passes, then clean up the old code paths and write it all up in the docs folder', turnId: `T${cols}` }, async () => ({}))
  await snap('a long goal', cols)
  await hooks['tool.call']($, { tool: 'Read', tool_use_id: `r1${cols}`, file_path: `${P}/src/chunk.ts` }, async () => {
    await snap('reading a file', cols)
    return { text: 'ok' }
  })
  await hooks['session.append']($, { door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: 'The loader reads chunks synchronously; I will switch it to the stream reader and keep the cache, which is a fairly long thought that would wrap across lines.' }] }, origin: {}, uuid: 'u' }, async () => ({}))
  await snap('a thought', cols)
  await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `b1${cols}`, command: 'cargo build --release' }, async () => {
    now += 3000
    await snap('a command running', cols)
    return { text: 'ok' }
  })
  await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `b2${cols}`, command: 'npm test' }, async () => {
    now += 3000
    await snap('a test running', cols)
    return { text: '41 passed' }
  })
  await snap('a test just passed', cols)
  for (let i = 0; i < 5; i++) await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `bg${i}${cols}`, command: `node job${i}.mjs`, run_in_background: true }, async () => ({ text: `Command running in background with ID: bash_${i}${cols}` }))
  await snap('five in the background', cols)
  await hooks['turn.complete']($, { reason: 'answer', answer: 'Done', durationMs: 1, isAborted: false, turnId: `T${cols}`, usage: { input_tokens: 1000, output_tokens: 2000, model: 'claude-opus-5-5' } }, async () => ({ text: 'Done' }))
  await snap('the turn done', cols)

  const first = states[0]
  for (const part of ['map+toolbar', 'running', 'windows', 'log'])
    check(`${cols} cols: the ${part} keeps its place and height through every state`, states.every(st => JSON.stringify(st.out[part]) === JSON.stringify(first.out[part])), states.map(st => `${st.what}: ${JSON.stringify(st.out[part])}`).join(' | '))
  check(`${cols} cols: the map is drawn first, under the header (nothing that comes and goes above it)`, states.every(st => st.out['map+toolbar']?.[0] === first.out['map+toolbar']?.[0] && st.out['map+toolbar'][0] <= 3), JSON.stringify(first.out))
  // A wrapping Text could still grow a row: inside Claude's window, every line truncates.
  for (const st of states) {
    const win = find(st.tree, x => x.type === 'Box' && x.props.borderStyle && find(x, y => y.type === 'Text' && text(y).startsWith('✻ Claude')).length)[0]
    const wraps = find(win, x => x.type === 'Text' && x.props.wrap === 'wrap')
    if (wraps.length) check(`${cols} cols, ${st.what}: no line in Claude's window wraps`, false, wraps.map(text).join(' | '))
  }
}
check("the turn's summary is drawn below the log", (() => {
  const st = states.at(-1)
  const parts = st.tree.props.children.filter(k => k && typeof k === 'object')
  const logAt = parts.findIndex(k => k.props?.borderStyle && find(k, x => x.type === 'Text' && text(x) === 'log').length)
  const doneAt = parts.findIndex(k => k.props?.key === 'summary')
  return logAt >= 0 && doneAt > logAt
})())
console.log(`\n${fails} failing check(s)`)
