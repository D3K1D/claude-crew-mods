// Cost math, command tidying, the demo's Codex run, and open-in-editor (recorded, not launched).
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const timers = []
const ran = []
const written = []
let now = Date.parse('2026-10-07T10:00:00')
Date.now = () => now
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: {
    every: (ms, fn) => { const t = { ms, fn, at: now + ms, every: true, dead: false, cancel() { t.dead = true } }; timers.push(t); return t },
    after: (ms, fn) => { const t = { ms, fn, at: now + ms, dead: false, cancel() { t.dead = true } }; timers.push(t); return t },
  },
  fs: { read: async () => '', exists: async () => false, write: async (p, t) => written.push([p, t.length]) },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : n === 'TEMP' ? 'C:/Users/me/Temp' : undefined) },
  state: { get: async () => ({ value: [], version: 0 }) },
  process: {
    run: async argv => {
      ran.push(argv)
      if (argv[0] === 'git' && argv[3] === 'rev-parse') return { exitCode: 0, stdout: 'C:/proj\n', stderr: '' }
      if (argv[0] === 'git' && argv[3] === 'show') return { exitCode: 0, stdout: 'old contents\n', stderr: '' }
      if (argv.join(' ').includes('%TEMP%')) return { exitCode: 0, stdout: 'C:/Users/me/Temp\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, { editor: 'code' })
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
const advance = async ms => { const end = now + ms; for (;;) { const due = timers.filter(t => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; now = due.at; if (due.every) due.at += due.ms; else due.dead = true; due.fn(); await new Promise(r => setTimeout(r, 0)) } now = end }
const crew = () => globalThis.__store.get('crew')
const main = () => crew().agents.find(a => a.id === 'main')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 120 }, viewport: { columns: 120 } })
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

// Commands shown without the shell noise.
await hooks['turn.start']($, { text: 'Polish the mod', turnId: 'T1' }, async () => ({}))
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b1', command: 'SP="C:/Users/me/AppData/Local/Temp/x"; D="C:/dev"\ncd "$SP" && node run2.mjs | tail -1' }, async () => ({ text: 'ok' }))
check('a command without a description is shown as what it runs, in words (no paths, no pipes into tail)', main().actions[0] === '$ ran node run2.mjs', main().actions[0])

// Cost: Opus 5.5 rates on a turn's usage.
await hooks['turn.complete']($, { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T1', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
check('tokens summed across input, output and cache', main().tokens === 21500, String(main().tokens))
check('cost at Opus 5.5 list prices', Math.abs(main().cost - 0.018) < 1e-9, String(main().cost))
let tree = await render()
const mainWin = find(tree, x => x.type === 'Box' && x.props.borderColor === '#D97757')[0]
const winText = mainWin.props.children.map(text).join('\n')
check('window shows tokens and a dollar estimate', /22k tokens · \$0\.02/.test(winText), winText.split('\n').find(l => l.startsWith('cost')))
check('header shows the session total', /22k tokens · \$0\.02/.test(text(tree)))

// Open a changed file: git diff against HEAD through VS Code, recorded not launched.
await hooks['tool.call']($, { tool: 'Edit', tool_use_id: 'e1', file_path: 'C:/proj/src/a.rs', old_string: 'x', new_string: 'y\nz' }, async () => ({ text: 'ok' }))
await globalThis.__store.set('crew', { ...crew(), showFiles: true })
tree = await render()
const openBtn = find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('open:C:/proj/src/a.rs'))[0]
check('worked-files row is a button', !!openBtn)
ran.length = 0
await openBtn.props.onPress()
await new Promise(r => setTimeout(r, 50))
const diffCall = ran.find(a => a.includes('--diff'))
check('edited file opens as a diff in VS Code', !!diffCall && diffCall[3] === 'code' && diffCall[6] === 'C:/proj/src/a.rs', JSON.stringify(diffCall))
check('HEAD copy written to temp with a telling name', written.some(([p]) => /crew-map-HEAD\/\w+\/a \(HEAD\)\.rs$/.test(p)), JSON.stringify(written))

// The demo shows a Codex run.
find(tree, x => x.type === 'Button' && x.props.key === 'demo')[0].props.onPress()
await advance(2600 * 3 + 400)
check('demo has a running Codex run on a thread', crew().demoCodex[0]?.status === 'running' && crew().demoCodex[0].thread === 'auth-refresh')
tree = await render()
const svg = find(tree, x => x.type === 'Svg')[0].props.source
check('demo map draws Codex and its thread', svg.includes('>Codex</text>') && svg.includes('>auth-refresh</text>'))
check('demo Architect is waiting on Codex', svg.includes('Waiting on Codex'))
const cxWin = find(tree, x => x.type === 'Box' && x.props.borderColor === '#10A37F')[0]
check('demo shows a Codex window asked by Architect', cxWin && /from +Architect/.test(text(cxWin)))
await advance(2600 * 3)
check('demo Codex run finishes with files and notes', crew().demoCodex[0]?.status === 'done' && crew().demoCodex[0].files.length === 2 && crew().demoCodex[0].notesUpdated)
await advance(2600 * 2 + 25_000)
check('demo cleanup removes the Codex run', (crew().demoCodex ?? []).length === 0)
console.log(`\n${fails} failing check(s)`)
