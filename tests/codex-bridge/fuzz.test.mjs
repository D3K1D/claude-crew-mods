// Randomized Codex output: valid and broken JSON lines, huge lines, hostile paths, events in odd
// orders, split across random chunk boundaries. Nothing may throw, state must stay bounded, the
// result and the pane must stay sane, and parsing must stay fast.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Input: el('Input') }
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const SEED = Number(process.env.FUZZ_SEED ?? 7)
let seed = SEED
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
const pick = a => a[Math.floor(rnd() * a.length)]
let fails = 0
let checked = 0
const seen = new Set()
const check = (label, cond, extra = '') => { checked++; if (!cond) { fails++; if (!seen.has(label)) console.log(`FAIL ${label}${extra ? `  [${extra}]` : ''}`); seen.add(label) } }

globalThis.__store = new Map()
const { register } = await import(`../.build/codex-bridge.mjs?${SEED}`)
const fsFiles = { '/usr/local/bin/codex': '#!' }
let stream = []
const $ = {
  tool: { register: async () => {} },
  command: { register: async () => {} },
  session: { cwd: async () => '/work/game' },
  env: { get: async n => ({ HOME: '/home/me' })[n] },
  ui: { open: async () => {}, status: () => {}, toast: async () => {}, resolve: () => elements },
  store: { get: async () => undefined, set: async () => {} },
  state: { get: async () => ({}) },
  clock: { after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
  fs: {
    exists: async p => p in fsFiles,
    read: async p => { if (p in fsFiles) return fsFiles[p]; throw new Error('ENOENT') },
    write: async (p, t) => { fsFiles[p] = t },
    list: async () => [],
    stat: async () => ({ kind: 'file', size: 1, mtimeMs: 1 }),
  },
  process: {
    run: async argv => {
      if (argv[0] === 'uname') return { exitCode: 0, stdout: 'Linux\n', stderr: '' }
      if (argv.includes('rev-parse')) return { exitCode: 0, stdout: '/work/game\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
    spawn: () => {
      const pieces = stream
      const it = (async function* () { for (const p of pieces) yield p })()
      return Object.assign(it, { result: Promise.resolve({ code: rnd() < 0.8 ? 0 : 1 }) })
    },
  },
}
const hooks = {}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))

const paths = ['src/a.rs', '../../etc/passwd', 'C:\\Windows\\x&calc.ts', 'with space/b.ts', '<b>x</b>.md', '"q".py', '😀.md', `${'d/'.repeat(500)}f.ts`, '']
const texts = ['done', 'x'.repeat(50000), '### NOTES.md\n# notes\n- a', 'answer\n## NOTES.md\nmid\n### NOTES.md\n```md\n# real\n```', '<script>alert(1)</script>', '\u0000\u0007bell']
const event = () => {
  const id = `i${Math.floor(rnd() * 20)}`
  return pick([
    { type: 'thread.started', thread_id: pick(['s1', '', 'x'.repeat(300)]) },
    { type: 'item.started', item: { id, type: 'command_execution', command: pick(['bash -lc "cargo test"', `powershell.exe -Command "${'x'.repeat(4000)}"`, 'cat src/a.rs', '']) } },
    { type: 'item.completed', item: { id, type: 'command_execution', command: 'cargo test', exit_code: pick([0, 1, null, 'x']) } },
    { type: 'item.completed', item: { id, type: 'agent_message', text: pick(texts) } },
    { type: 'item.completed', item: { id, type: 'reasoning', text: pick(texts) } },
    { type: 'item.completed', item: { id, type: 'file_change', changes: Array.from({ length: Math.floor(rnd() * 5) }, () => ({ path: pick(paths), kind: pick(['add', 'update', 'delete', '']) })) } },
    { type: 'item.completed', item: { id, type: 'todo_list', items: [{ text: pick(texts), completed: rnd() < 0.5 }] } },
    { type: 'item.completed', item: { id, type: 'web_search', query: pick(texts) } },
    { type: 'item.completed', item: { id, type: 'error', message: pick(texts) } },
    { type: 'turn.completed', usage: { input_tokens: Math.floor(rnd() * 1e6), output_tokens: pick([5, -3, 'x', null]) } },
    { type: 'turn.failed', error: { message: pick(texts) } },
    { type: 'item.completed' },
    { type: 'item.completed', item: null },
    { nonsense: true },
  ])
}
/** The stream as Codex might deliver it: lines, some garbage, split at random points, some stderr. */
const makeStream = () => {
  let text = ''
  const n = Math.floor(rnd() * 60)
  for (let i = 0; i < n; i++) text += rnd() < 0.9 ? `${JSON.stringify(event())}\n` : pick(['{not json\n', '\n', `${'{'.repeat(1000)}\n`, '"just a string"\n', 'null\n'])
  const out = []
  let at = 0
  while (at < text.length) {
    const len = 1 + Math.floor(rnd() * 400)
    out.push({ stream: rnd() < 0.95 ? 'stdout' : 'stderr', text: text.slice(at, at + len) })
    at += len
  }
  return out
}

let slowest = 0
for (let round = 0; round < Number(process.env.FUZZ_ROUNDS ?? 120); round++) {
  stream = makeStream()
  const args = { task: pick(['do it', 'x'.repeat(20000), '<b>']), thread: pick(['', 'auth', 'Auth', '認証', '../evil', 'a/b', 'x'.repeat(200)]), mode: pick(['write', 'read-only', 'bogus']), model: pick(['', 'gpt-x', 'bad name']), effort: pick(['', 'high', 'max']) }
  const t0 = performance.now()
  let r
  try {
    r = await hooks['tool.call']($, { tool: 'mcp__codex-bridge__codex', tool_use_id: `t${round}`, ...args }, Object.assign(async () => ({}), { signal: new AbortController().signal }))
  } catch (err) {
    check('a run never throws', false, err?.stack?.split('\n').slice(0, 2).join(' | '))
    continue
  }
  slowest = Math.max(slowest, performance.now() - t0)
  check('every run returns text', typeof r?.result === 'string' && r.result.length > 0)
  check('the result stays a sensible size', r.result.length < 20_000, String(r.result.length))
  const runs = globalThis.__store.get('runs') ?? []
  check('runs stay capped', runs.length <= 16, String(runs.length))
  for (const run of runs) {
    check('events stay capped', run.events.length <= 60, String(run.events.length))
    check('touched files stay capped', run.touched.length <= 40, String(run.touched.length))
    check('token counts stay numbers', Number.isFinite(run.tokens), String(run.tokens))
    check('no run is left running', run.status !== 'running')
  }
  // Thread keys never leave the threads folder.
  const written = Object.keys(fsFiles).filter(p => p.includes('.codex-bridge'))
  check('memory files stay in the project\'s .codex-bridge folder', written.every(p => /^\/work\/game\/\.codex-bridge\/(NOTES\.md|threads\.json|threads\/[a-z0-9_-]+\.md)$/.test(p)), written.find(p => !/^\/work\/game\/\.codex-bridge\/(NOTES\.md|threads\.json|threads\/[a-z0-9_-]+\.md)$/.test(p)))
  if (round % 10 === 0) {
    const tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 100 }, viewport: { columns: 100 } })
    check('the pane renders', !!tree)
    check('the pane stays a sensible size', JSON.stringify(tree).length < 600_000, String(JSON.stringify(tree).length))
    const badBtn = find(tree, x => x.type === 'Button').find(b => !(b.props.children ?? []).every(ch => typeof ch === 'string' || typeof ch === 'number' || ch?.type === 'Text'))
    check('every Button holds only text', !badBtn, badBtn?.props.key)
    const labelled = find(tree, x => x.type === 'Button' && x.props.label != null)[0]
    check('no Button carries a label', !labelled, labelled?.props.key)
    const keys = find(tree, x => x.type === 'Button').map(b => b.props.key)
    check('buttons have unique keys', new Set(keys).size === keys.length)
  }
}
check('runs stay fast on hostile output', slowest < 1500, `${slowest.toFixed(0)} ms`)
console.log(`PASS fuzz: ${checked} checks over random Codex runs (seed ${SEED}); slowest run ${slowest.toFixed(0)} ms`)
console.log(`\n${fails} failing check(s)`)
