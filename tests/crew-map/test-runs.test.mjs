// Test runs: running indicator, waiting bubble, results parsed, background runs, demo.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../.build/out', import.meta.url))
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
const toasts = []
let now = Date.parse('2026-10-09T10:00:00')
Date.now = () => now
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => toasts.push(t) },
  clock: {
    every: (ms, fn) => { const t = { ms, fn, at: now + ms, every: true, dead: false, cancel() { t.dead = true } }; timers.push(t); return t },
    after: (ms, fn) => { const t = { ms, fn, at: now + ms, dead: false, cancel() { t.dead = true } }; timers.push(t); return t },
  },
  fs: { read: async () => '', exists: async () => false },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : n === 'TEMP' ? 'C:/Users/me/Temp' : undefined) },
  state: { get: async () => ({ value: [], version: 0 }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
const advance = async ms => { const end = now + ms; for (;;) { const due = timers.filter(t => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; now = due.at; if (due.every) due.at += due.ms; else due.dead = true; due.fn(); await new Promise(r => setTimeout(r, 0)) } now = end }
const crew = () => globalThis.__store.get('crew')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 120 }, viewport: { columns: 120 } })
const svgOf = t => find(t, x => x.type === 'Svg')[0].props.source
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

await hooks['turn.start']($, { text: 'Fix the login test', turnId: 'T1' }, async () => ({}))

// 1. A foreground jest run: shown while it runs, then passed with counts.
let mid
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b1', command: 'cd "C:/p" && npx jest auth' }, async () => {
  now += 12_000
  const tree = await render()
  mid = { svg: svgOf(tree), all: text(tree), tick: globalThis.__store.get('tick') }
  return { text: 'PASS tests/auth.test.ts\nTests:       41 passed, 41 total\nTime: 3s' }
})
check('a running test shows in the map as "tests running"', mid.svg.includes('>tests running</text>'))
check('the flask bubbles while it runs', mid.svg.includes('animation:rise'))
check('the Claude\'s bubble says it is waiting on tests', mid.svg.includes('Waiting on tests'))
check('the running box says a test is running, for what, waited on, with a timer', mid.all.includes('12s ⚗ Claude JS tests (jest): auth'), mid.all.slice(mid.all.indexOf('⚗'), mid.all.indexOf('⚗') + 80))
check('the window shows the running test', /test +⚗ 12s JS tests/.test(mid.all))
let t = crew().tests[0]
check('the run settles as passed with counts', t.status === 'passed' && t.passed === 41 && t.failed === 0, JSON.stringify(t))
check('toast on finish', toasts.some(x => x === '✓ Tests passed (41 passed) · JS tests (jest): auth') && !toasts.some(x => x.includes('npx') || x.includes('$')), toasts.join(' | '))
check('log says started and passed', crew().log.some(l => l.text === '⚗ tests started · JS tests (jest): auth') && crew().log.some(l => l.text === '✓ tests passed (41 passed) in 12s · JS tests (jest): auth'))
let tree = await render()
check('after: map shows a green result pill', svgOf(tree).includes('✓ 41 passed'))
check('after: no running strip', !text(tree).includes('⏱'))
check('after: window shows the result', text(tree).includes('✓ 41 passed · 12s'))

// 2. cargo, failing, summed across binaries.
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b2', command: 'cargo test chunk' }, async () => ({ text: 'test result: ok. 10 passed; 0 failed; 0 ignored\ntest result: FAILED. 3 passed; 2 failed; 0 ignored', isError: true }))
t = crew().tests.at(-1)
check('cargo counts summed, failed', t.status === 'failed' && t.passed === 13 && t.failed === 2, JSON.stringify(t))
check('map shows a red pill', svgOf(await render()).includes('✗ 2 failed'))

// 3. pytest without an error flag still reads as failed.
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b3', command: 'python -m pytest -q' }, async () => ({ text: '=== 1 failed, 40 passed in 2.10s ===' }))
t = crew().tests.at(-1)
check('pytest counts and failure', t.status === 'failed' && t.failed === 1 && t.passed === 40, JSON.stringify(t))

// 4. Not a test: git log of a tests folder.
const before = crew().tests.length
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b4', command: 'git log -- tests/' }, async () => ({ text: 'x' }))
check('git log on tests/ is not a test run', crew().tests.length === before)

// 5. Background run: stays running until its output is read and says it finished.
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b5', command: 'cargo test --release', run_in_background: true }, async () => ({ text: 'Command running in background with ID: bash_7' }))
t = crew().tests.at(-1)
check('background run stays running with its shell id', t.status === 'running' && t.background && t.shellId === 'bash_7', JSON.stringify(t))
await advance(5000)
check('the 1s tick counts up while it runs', globalThis.__store.get('tick') >= 5, String(globalThis.__store.get('tick')))
tree = await render()
check('the running box says it runs in the background', text(tree).includes('⚗ Claude ◌ '))
await hooks['tool.call']($, { tool: 'BashOutput', tool_use_id: 'o1', bash_id: 'bash_7' }, async () => ({ text: '<status>running</status>\n<stdout>Compiling…</stdout>' }))
check('still running while the output says so', crew().tests.at(-1).status === 'running')
await hooks['tool.call']($, { tool: 'BashOutput', tool_use_id: 'o2', bash_id: 'bash_7' }, async () => ({ text: '<status>completed</status>\n<exit_code>0</exit_code>\n<stdout>test result: ok. 120 passed; 0 failed</stdout>' }))
t = crew().tests.at(-1)
check('background run settles from its output', t.status === 'passed' && t.passed === 120, JSON.stringify(t))
const tickAt = globalThis.__store.get('tick')
await advance(3000)
check('the tick stops once nothing runs', globalThis.__store.get('tick') === tickAt)

// 6. The demo runs tests: fail, then pass.
find(tree, x => x.type === 'Button' && x.props.key === 'demo')[0].props.onPress()
await advance(2600 + 300)
const demoTests = () => crew().tests.filter(x => x.agentId.startsWith('demo-'))
check('demo starts a test run', demoTests().some(x => x.command === 'npm test -- auth'), JSON.stringify(demoTests().map(x => [x.command, x.status])))
tree = await render()
const demoSvg = svgOf(tree)
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/tests.svg`, demoSvg)
check('demo map shows tests running', demoSvg.includes('>tests running</text>'))
await advance(2600)
check('demo first run fails 1 of 42', demoTests().find(x => x.command === 'npm test -- auth')?.status === 'failed')
await advance(2600 * 3)
check('demo rerun passes 42', demoTests().find(x => x.command === 'npm test')?.passed === 42, JSON.stringify(demoTests()))
await advance(2600 * 3 + 25_000)
check('demo cleanup removes its tests', demoTests().length === 0)

// 7. Reload: a running test becomes unknown.
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b6', command: 'npm test', run_in_background: true }, async () => ({ text: 'Command running in background with ID: bash_9' }))
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
check('reload marks running tests as unknown', crew().tests.at(-1).status === 'unknown')
console.log(`\n${fails} failing check(s)`)
