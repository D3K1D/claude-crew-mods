// Problems on the map, stuck detection, budget, task summary, replay.
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
const toasts = []
const ran = []
const copied = []
const stored = { intro: 'off' }
let now = Date.parse('2026-10-12T10:00:00')
Date.now = () => now
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => toasts.push(t), copy: async a => (copied.push(a), { isCopied: true }) },
  clock: {
    every: (ms, fn) => { const t = { ms, fn, at: now + ms, every: true, dead: false, cancel() { t.dead = true } }; timers.push(t); return t },
    after: (ms, fn) => { const t = { ms, fn, at: now + ms, dead: false, cancel() { t.dead = true } }; timers.push(t); return t },
  },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => stored[k], set: async (k, v) => { stored[k] = v } },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [], version: 0 }) },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
const advance = async ms => { const end = now + ms; for (;;) { const due = timers.filter(t => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; now = due.at; if (due.every) due.at += due.ms; else due.dead = true; due.fn(); await new Promise(r => setTimeout(r, 0)) } now = end }
const crew = () => globalThis.__store.get('crew')
const main = () => crew().agents.find(a => a.id === 'main')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 140 }, viewport: { columns: 140 } })
const btn = (tree, key) => find(tree, x => x.type === 'Button' && x.props.key === key)[0]
const svgOf = t => find(t, x => x.type === 'Svg')[0].props.source
let n = 0
const call = (e, result) => hooks['tool.call']($, { tool_use_id: `c${n++}`, ...e }, async () => { now += 1000; return result })
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

await hooks['turn.start']($, { text: 'Make chunk loading async', turnId: 'T1' }, async () => ({}))

// ── Problems ──
const rust = `   Compiling cw v0.1.0
error[E0308]: mismatched types
  --> src/world/chunk.rs:42:17
   |
error[E0425]: cannot find value \`seed\` in this scope
  --> src/world/gen.rs:7:9
error: could not compile \`cw\` (bin "cw") due to 2 previous errors`
await call({ tool: 'Bash', command: 'cd C:/proj && cargo build' }, { text: rust, isError: true })
let pr = crew().problems
check('rustc errors become problems with absolute paths', pr.length === 2 && pr[0].path === 'C:/proj/src/world/chunk.rs' && pr[0].line === 42 && pr[0].message === 'mismatched types', JSON.stringify(pr.map(p => [p.path, p.line, p.message])))
check('broken files join the map', !!crew().nodes['C:/proj/src/world/chunk.rs'] && !!crew().nodes['C:/proj/src/world/gen.rs'])
let tree = await render()
check('map marks broken files red with a count', svgOf(tree).includes('fill="#DA3633"'))
check('problems box lists file:line and message', text(tree).includes('✗ 2 problems · cargo build') && text(tree).includes('src/world/chunk.rs:42'))
ran.length = 0
await btn(tree, 'problem:0:C:/proj/src/world/chunk.rs:42').props.onPress()
await new Promise(r => setTimeout(r, 20))
check('clicking a problem opens the editor at its line', ran.some(a => a.join(' ') === 'cmd /d /c code -g C:/proj/src/world/chunk.rs:42'), JSON.stringify(ran))
await call({ tool: 'Bash', command: 'cargo build' }, { text: 'Finished dev profile' })
check('a clean build clears the problems', crew().problems.length === 0)

const samples = [
  ['tsc', 'npx tsc --noEmit', "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.", 'C:/proj/src/a.ts', 12],
  ['tsc pretty', 'npx tsc', "src/b.ts:3:1 - error TS2304: Cannot find name 'x'.", 'C:/proj/src/b.ts', 3],
  ['python', 'python app.py', 'Traceback (most recent call last):\n  File "C:\\proj\\app.py", line 9, in <module>\n    main()\n  File "C:\\proj\\lib\\core.py", line 31, in main\n    x = d["k"]\nKeyError: \'k\'', 'C:/proj/lib/core.py', 31],
  ['pytest', 'pytest -q', 'tests/test_a.py:14: AssertionError\nFAILED tests/test_a.py::test_load - AssertionError: assert 1 == 2\n=== 1 failed, 3 passed in 0.2s ===', 'C:/proj/tests/test_a.py', 14],
  ['gcc', 'make', 'src/main.c:5:10: fatal error: foo.h: No such file or directory', 'C:/proj/src/main.c', 5],
  ['go', 'go build ./...', './main.go:12:2: undefined: Foo', 'C:/proj/main.go', 12],
  ['jest', 'npx jest', ' FAIL  src/sum.test.js\n  ● sum › adds\n\n    expect(received).toBe(expected)\n\n      at Object.<anonymous> (src/sum.test.js:4:17)\n\nTests: 1 failed, 1 total', 'C:/proj/src/sum.test.js', 4],
  ['cargo panic', 'cargo test', "thread 'chunk::loads' panicked at src/world/chunk.rs:88:9:\nassertion failed: loaded\ntest result: FAILED. 4 passed; 1 failed", 'C:/proj/src/world/chunk.rs', 88],
]
for (const [name, cmd, out, path, line] of samples) {
  await call({ tool: 'Bash', command: cmd }, { text: out, isError: true })
  const p = crew().problems[0]
  check(`parses ${name}`, p?.path === path && p?.line === line, JSON.stringify(crew().problems.map(x => [x.path, x.line, x.message])))
}
await call({ tool: 'Bash', command: 'git status' }, { text: 'src/a.ts:1:1: error: nope', isError: false })
check('a passing non-build command leaves problems alone', crew().problems.length === 1)

// ── Stuck ──
toasts.length = 0
for (let i = 0; i < 3; i++) await call({ tool: 'Bash', command: 'npm run build' }, { text: 'boom', isError: true })
check('same command failing 3 times marks the Claude stuck', /ran the same command 3 times \(npm run build\) and it failed every time/.test(main().stuck), main().stuck)
check('stuck gives a toast', toasts.some(t => t.startsWith('⚠ Claude looks stuck')), toasts.join(' | '))
tree = await render()
check('stuck shows in its window and bubble', text(tree).includes('Stuck? It ') && svgOf(tree).includes('Stuck?'))
await call({ tool: 'Bash', command: 'npm run build' }, { text: 'ok' })
check('a success clears stuck', main().stuck === '')

// ── Edits, then the summary ──
await call({ tool: 'Edit', file_path: 'C:/proj/src/world/chunk.rs', old_string: 'a', new_string: 'b\nc\nd' }, { text: 'ok' })
await call({ tool: 'Bash', command: 'cargo test' }, { text: 'test result: ok. 12 passed; 0 failed' })
await hooks['turn.complete']($, { reason: 'answer', answer: 'Done', durationMs: 1, isAborted: false, turnId: 'T1', usage: { input_tokens: 1000, output_tokens: 2000, model: 'claude-opus-5-5' } }, async () => ({ text: 'Done' }))
const s = crew().summary
check('summary built at the end of the task', s && s.files.length === 1 && s.files[0].added === 3 && s.tests.runs >= 1 && s.tests.last.startsWith('passed'), JSON.stringify(s))
check('done toast', toasts.some(t => t.startsWith('✓ Done in')), toasts.at(-1))
tree = await render()
check('summary card shows', text(tree).includes('✓ Done in') && /files +1 changed/.test(text(tree)))
await btn(tree, 'copy-summary').props.onPress({ surface: 'desktop' })
await new Promise(r => setTimeout(r, 20))
check('copy as Markdown', copied[0]?.text.startsWith('### Make chunk loading async') && copied[0].text.includes('| `src/world/chunk.rs` | 3 | 1 |'), copied[0]?.text)
console.log('\n--- summary markdown ---\n' + copied[0]?.text + '\n')
await btn(tree, 'close-summary').props.onPress()
check('summary dismissed', crew().summary === null)

// ── Budget ──
tree = await render()
const input = find(tree, x => x.type === 'Input' && x.props.key === 'budget')[0]
input.props.onSubmit('$0.05')
await new Promise(r => setTimeout(r, 10))
check('budget set and stored', crew().budget === 0.05 && stored.budget === 0.05)
toasts.length = 0
await hooks['turn.start']($, { text: 'more', turnId: 'T2' }, async () => ({}))
await hooks['turn.complete']($, { reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 'T2', usage: { input_tokens: 2000, output_tokens: 1000, model: 'claude-opus-5-5' } }, async () => ({ text: 'x' }))
check('crossing a budget mark toasts once', toasts.filter(t => t.startsWith('💸')).length === 1, toasts.join(' | '))
await hooks['turn.complete']($, { reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 'T3', usage: { input_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'x' }))
check('no repeat toast for the same mark', toasts.filter(t => t.startsWith('💸')).length === 1)
await hooks['turn.complete']($, { reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 'T4', usage: { output_tokens: 3000, model: 'claude-opus-5-5' } }, async () => ({ text: 'x' }))
check('over budget toasts', toasts.some(t => t.startsWith('💸 Over budget')), toasts.join(' | '))
tree = await render()
check('header shows spend of budget', text(tree).includes('of $0.05') && text(tree).includes('% of budget'))

// ── Replay ──
const steps = crew().timeline.length
check('timeline recorded steps', steps >= 15, String(steps))
await btn(tree, 'replay').props.onPress()
tree = await render()
check('replay bar shows step 1', text(tree).includes(`⏪ replay 1/${steps}`))
const svg1 = svgOf(tree)
await advance(900 * 3)
tree = await render()
check('replay plays forward', text(tree).includes(`replay 4/${steps}`), text(tree).match(/replay \d+\/\d+/)?.[0])
// The first steps may sit on one file (the same picture); by the end the map has grown.
const svgAt4 = svgOf(tree)
await btn(tree, 'rp-play').props.onPress()
await advance(900 * 3)
tree = await render()
check('pause holds the step', text(tree).includes(`replay 4/${steps}`))
await btn(tree, 'rp-end').props.onPress()
tree = await render()
check('jump to the end', text(tree).includes(`replay ${steps}/${steps}`))
check('the map changes as it plays', svgOf(tree) !== svg1 && svgOf(tree) !== svgAt4)
await btn(tree, 'rp-live').props.onPress()
tree = await render()
check('back to live hides the bar', !text(tree).includes('REPLAY'))

// ── Demo shows problems and summary ──
await btn(tree, 'demo').props.onPress()
await advance(2600 * 2 + 300)
check('demo raises problems', crew().problems.some(p => p.path.startsWith('demo/')))
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/problems.svg`, svgOf(await render()))
await advance(2600 * 6)
check('demo ends with a summary card', crew().summary?.goal.startsWith('Demo:'))
console.log(`\n${fails} failing check(s)`)
