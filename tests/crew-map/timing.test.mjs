// Times as they really were. Each action in the log ends in how long it took, exactly (340ms, 2.4s,
// 1m12s), and one still running counts up (●). Thinking is timed too: from when its model step began.
// And the clocks keep counting while a Claude works or thinks, not only while a test runs.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
let tickFn
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: (ms, fn) => { if (ms === 1000) tickFn = fn; return { cancel() {} } }, after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async () => undefined, set: async () => {} },
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
// A row in words: its picture's alt (the row as drawn), then any text beside it.
const say = d => (d ? [...find(d, x => x.type === 'Svg').map(x => x.props.alt ?? ''), text(d)].join(' ') : '')
const render = (cols = 120) => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const { lines, words } = await import('./kit.mjs')
// The log's rows, as the viewer draws them: each row's words left to right; its duration is the last.
const logRows = t => lines(t, 'view')
const rowOf = (t, re) => logRows(t).find(r => re.test(r.map(g => g.t).join(' ')))
const durOf = r => (r ? r.at(-1).t : '')

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Fix the save bug', turnId: 'T' }, async () => ({}))
const call = (tool, input, ms) => fire('tool.call', { tool, tool_use_id: `c${now}`, ...input }, async () => { now += ms; return { text: 'ok' } })
await call('Read', { file_path: `${P}/src/save.ts` }, 340)
await call('Bash', { command: 'npm run build', description: 'Build the game' }, 2460)
await call('Bash', { command: 'npm test', description: 'Run the save tests' }, 72_000)
let t = await render()
check('a quick read: 340ms', durOf(rowOf(t, /save\.ts/)) === '340ms', durOf(rowOf(t, /save\.ts/)))
check('a build: 2.4s', durOf(rowOf(t, /Build the game/)) === '2.4s', durOf(rowOf(t, /Build the game/)))
check('the tests: 1m12s', durOf(rowOf(t, /Claude Run the save tests/)) === '1m12s', logRows(t).map(r => r.map(g => g.t).join(' ')).join(' | '))
check('every duration is the last word on its row, set against the right edge', ['340ms', '2.4s', '1m12s'].every(d => logRows(t).some(r => r.at(-1)?.t === d)))

// While one runs: it counts up, ● before it.
let release
const long = fire('tool.call', { tool: 'Bash', tool_use_id: 'long', command: 'cargo build', description: 'Build the engine' }, () => new Promise(r => (release = r)))
await tick()
now += 1500
t = await render()
check('running: ● 1.5s', durOf(rowOf(t, /Build the engine/)) === '● 1.5s', durOf(rowOf(t, /Build the engine/)))
now += 3000
t = await render()
check('...and counting: ● 4.5s', durOf(rowOf(t, /Build the engine/)) === '● 4.5s', durOf(rowOf(t, /Build the engine/)))
release({ text: 'ok' })
await long
check('done: its time is kept as it ended (4.5s)', durOf(rowOf(await render(), /Build the engine/)) === '4.5s', durOf(rowOf(await render(), /Build the engine/)))

// Thinking: timed from when its model step began.
const steps = fire('turn.step', { turnId: 'T', index: 3, model: 'claude-opus-5-5', messageCount: 9 }, async function* () { return { usage: null } })
const step = steps[Symbol.asyncIterator] ? steps : null
const it = step?.[Symbol.asyncIterator]?.()
await it?.next()
now += 12_000
t = await render()
const top = words(t, 'top')
check('its row says how long it has been thinking: 12s', top[top.indexOf('Thinking') + 1]?.startsWith('12s'), top.slice(0, 12).join('|'))

// The clock ticks each second while a Claude thinks, with nothing else running.
const before = globalThis.__store.get('tick') ?? 0
await tickFn?.()
await tick()
check('the 1s tick redraws while a Claude thinks (its clocks count)', (globalThis.__store.get('tick') ?? 0) > before, `${before} → ${globalThis.__store.get('tick')}`)
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
const after = globalThis.__store.get('tick') ?? 0
await tickFn?.()
await tick()
check('...and stops once the turn is over', (globalThis.__store.get('tick') ?? 0) === after)
console.log(`\n${fails} failing check(s)`)
