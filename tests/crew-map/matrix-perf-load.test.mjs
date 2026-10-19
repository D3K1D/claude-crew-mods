// Performance and robustness under load and over long sessions (release check, v1.3.x): render and
// hook cost at session size, bounded state, writes that change nothing, timers that leak, junk events,
// huge strings, and (through the real engine, when one is found) state writes under parallel calls.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import v8 from 'node:v8'
import vm from 'node:vm'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc')
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
class CountingMap extends Map {
  constructor() { super(); this.total = 0; this.same = 0 }
  set(k, v) { if (this.has(k) && this.get(k) === v) this.same++; this.total++; return super.set(k, v) }
}
const BUILD = new URL('../.build/crew-map.mjs', import.meta.url).href
const P = 'C:/work/game'
let inst = 0
/** A fresh instance of the mod, its store counting writes, its clock recorded and driven by hand. */
const setup = async ({ start = true } = {}) => {
  globalThis.__store = new CountingMap()
  const store = globalThis.__store
  const el = name => props => ({ type: name, props })
  const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
  const { register } = await import(`${BUILD}?load=${++inst}`)
  const hooks = {}
  const T = { now: Date.parse('2026-10-14T10:00:00') }
  Date.now = () => T.now
  const every = []
  const after = []
  const $ = {
    command: { register: async () => {} },
    ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, copy: async () => ({ isCopied: true }) },
    clock: {
      every: (ms, fn) => { const t = { ms, fn, cancelled: false, cancel() { this.cancelled = true } }; every.push(t); return t },
      after: (ms, fn) => { const t = { at: T.now + ms, fn, cancelled: false, cancel() { this.cancelled = true } }; if (ms === 0) setImmediate(() => !t.cancelled && fn()); else after.push(t); return t },
    },
    fs: { read: async () => '', exists: async () => false, write: async () => {} },
    model: { complete: async () => ({ isAnswered: false }) },
    store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
    session: { cwd: async () => P },
    env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
    state: { get: async () => ({}) },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  }
  register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
  if (start) await hooks['session.start']($, {}, async () => ({}))
  const fireDue = async () => { for (const t of after.splice(0).filter(t => !t.cancelled)) { if (t.at <= T.now) await t.fn(); else after.push(t) } }
  const render = (cols = 150) => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 40 } }, viewport: { columns: cols } })
  return { hooks, $, T, store, every, after, fireDue, render, crew: () => store.get('crew'), setView: v => store.set('crew', { ...store.get('crew'), view: v }) }
}
const call = (s, e, result = { text: 'ok' }) => s.hooks['tool.call'](s.$, { tool_use_id: `c${Math.random()}`, ...e }, async () => result)
const step = async (s, usage, e = {}) => {
  const it = s.hooks['turn.step'](s.$, { turnId: 'T', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...e }, () => (async function* () { yield { kind: 'text', text: 'x' }; return { usage } })())
  for (let x = await it.next(); !x.done; x = await it.next());
}
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const stats = tree => { let nodes = 0, depth = 0; const walk = (x, d) => { if (!x || typeof x !== 'object') return; nodes++; depth = Math.max(depth, d); for (const c of x.props?.children ?? []) walk(c, d + 1) }; walk(tree, 1); return { nodes, depth, json: JSON.stringify(tree).length } }
const ms = async fn => { const t = performance.now(); await fn(); return performance.now() - t }

let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

// ── A long, busy session: 2,000 calls by 12 Claudes over 60 files ──
{
  const s = await setup()
  await s.hooks['turn.start'](s.$, { text: 'Big job', turnId: 'T' }, async () => ({}))
  for (let i = 1; i < 12; i++) await s.hooks['agent.spawn'](s.$, { tool_use_id: `sp${i}`, prompt: 'x', description: `Job ${i}`, subagentType: 'general-purpose' }, async () => ({ agentId: `a${i}` }))
  const file = i => `${P}/${['src', 'src/world', 'tests', 'docs', 'src/net/proto', 'src/render'][i % 6]}/module-${i % 60}.md`
  let total = 0
  for (let i = 0; i < 2000; i++) {
    s.T.now += 700
    const k = i % 10
    total += await ms(() => call(s, { agentId: i % 12 ? `a${i % 12}` : undefined, ...(k < 4 ? { tool: 'Read', file_path: file(i * 13) } : k < 7 ? { tool: 'Edit', file_path: file(i * 7 + 3), old_string: 'a\nb', new_string: 'c\nd\ne' } : k < 9 ? { tool: 'Bash', command: k === 8 ? 'npm test' : 'cargo build', description: 'Build' } : { tool: 'Grep', pattern: 'foo', path: P }) }, { text: k === 8 ? 'Tests: 3 passed, 3 total' : 'ok' }))
  }
  check('a tool call costs under 5 ms on average over 2,000 calls', total / 2000 < 5, `${(total / 2000).toFixed(2)} ms`)
  for (let i = 0; i < 12; i++) void s.hooks['tool.call'](s.$, { tool: 'Edit', tool_use_id: `w${i}`, agentId: i ? `a${i}` : undefined, file_path: file(i * 5), old_string: 'a', new_string: 'b' }, () => new Promise(() => {}))
  await new Promise(r => setTimeout(r, 20))
  const c = s.crew()
  check('the state of a 2,000-call session stays under 200 KB', JSON.stringify(c).length < 200_000, `${JSON.stringify(c).length} chars`)
  for (const view of ['desks', 'map']) {
    s.setView(view)
    await s.render(150)
    let t = 0
    let tree
    for (let i = 0; i < 10; i++) t += await ms(async () => { tree = await s.render(150) })
    const st = stats(tree)
    check(`${view}: a redraw at 150 columns takes under 15 ms`, t / 10 < 15, `${(t / 10).toFixed(1)} ms`)
    check(`${view}: the pane stays inside the engine's bounds (nodes, depth, size)`, st.nodes < 20_000 && st.depth < 32 && st.json < 400_000, JSON.stringify(st))
    const svg = Math.max(0, ...find(tree, x => x.type === 'Svg').map(x => x.props.source.length))
    check(`${view}: every picture fits the Svg limit`, svg < 131_072, `${svg} chars`)
  }
}

// ── Bounded state ──
{
  const s = await setup()
  await s.hooks['turn.start'](s.$, { text: 'Codemod', turnId: 'T' }, async () => ({}))
  for (let i = 0; i < 3000; i++) { s.T.now += 300; await call(s, { tool: 'Edit', file_path: `${P}/gen/pkg${i % 40}/file-${i}.md`, old_string: 'a', new_string: 'b' }) }
  await s.hooks['turn.start'](s.$, { text: 'Next', turnId: 'T2' }, async () => ({}))
  const c = s.crew()
  check('editing 3,000 different files keeps the state under 512 KB (the worked-files record is bounded)', JSON.stringify(c).length < 512_000, `${JSON.stringify(c).length} chars, ${Object.keys(c.changes).length} changes, ${Object.keys(c.turnBase.changes).length} in turnBase`)
}
{
  const s = await setup()
  const K = 100_000
  await call(s, { tool: 'Grep', pattern: 'p'.repeat(K), path: P })
  await call(s, { tool: 'WebSearch', query: 'q'.repeat(K) })
  await call(s, { tool: 'Agent', description: 'd'.repeat(K), prompt: 'p' })
  await call(s, { tool: 'Skill', skill: 's'.repeat(K) })
  await call(s, { tool: 'Bash', command: `echo ${'y'.repeat(K)} && npm test` })
  await call(s, { tool: 'Read', file_path: `${P}/${'deep/'.repeat(2000)}a.md` })
  await s.hooks['classic.PermissionRequest'](s.$, { tool_name: `mcp__${'x'.repeat(K)}__y`, tool_input: {} }, async () => ({}))
  const c = s.crew()
  const long = []
  const walk = (x, p) => { if (typeof x === 'string') { if (x.length > 4000) long.push(`${p.slice(0, 40)}:${x.length}`) } else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${p}.${k.slice(0, 20)}`) }
  walk(c, 'crew')
  check('huge tool inputs are cut before they are stored (no string over 4,000 characters)', long.length === 0, `${long.length} long strings, e.g. ${long.slice(0, 4).join(' ')}`)
  check('...and the state stays small (under 200 KB)', JSON.stringify(c).length < 200_000, `${JSON.stringify(c).length} chars`)
}

// ── Writes that change nothing, timers that pile up ──
{
  const s = await setup()
  await step(s, { input_tokens: 1000, output_tokens: 10 })
  const w = s.store.total
  await step(s, { input_tokens: 1000, output_tokens: 10 })
  await new Promise(r => setImmediate(r))
  check('a model request with the same context size as the last writes nothing', s.store.total === w, `${s.store.total - w} write(s)`)
  for (let i = 0; i < 50; i++) { s.T.now += 100; await call(s, { tool: 'Read', file_path: `${P}/a${i}.md` }) }
  s.T.now += 91_000
  const same = s.store.same
  await s.fireDue()
  check('the 90 s idle timers write nothing when nothing changes', s.store.same === same, `${s.store.same - same} of 50 timers wrote the state back unchanged`)
  // Two more starts (a /clear, a resume): still one 1 s clock.
  await s.hooks['session.start'](s.$, {}, async () => ({}))
  await s.hooks['session.start'](s.$, {}, async () => ({}))
  const live = s.every.filter(t => !t.cancelled && t.ms === 1000).length
  check('a session started again keeps one 1 s clock, not one per start', live === 1, `${live} clocks running`)
}
{
  // While its idle timer waits (90 s), a call must not keep its whole result alive.
  const s = await setup()
  gc(); gc()
  const h0 = process.memoryUsage().heapUsed
  for (let i = 0; i < 50; i++) { s.T.now += 200; await call(s, { tool: 'Read', file_path: `${P}/big${i % 5}.md` }, { text: 'x'.repeat(1_000_000) + i }) }
  gc(); gc()
  const grown = (process.memoryUsage().heapUsed - h0) / 1e6
  check('pending idle timers do not hold on to 50 one-megabyte results', grown < 20, `${grown.toFixed(1)} MB held`)
}

// ── Junk and hostile events ──
{
  const s = await setup()
  const throws = []
  const tryIt = async (label, fn) => { try { await fn() } catch (err) { throws.push(`${label}: ${err.message}`) } }
  await tryIt('TodoWrite with a null item', () => call(s, { tool: 'TodoWrite', todos: [null, 5, 'x'] }))
  await tryIt('MultiEdit with a null edit', () => call(s, { tool: 'MultiEdit', file_path: `${P}/a.ts`, edits: [null, 5] }))
  await tryIt('tool.call with no tool name', () => call(s, {}))
  await tryIt('agent.spawn without description or type', () => s.hooks['agent.spawn'](s.$, { tool_use_id: 'sp' }, async () => ({ agentId: 'z' })))
  await tryIt('session.append without a message', () => s.hooks['session.append'](s.$, { door: 'response' }, async () => ({})))
  check('junk events never throw out of a hook (a throw before next() would fail the tool call itself)', throws.length === 0, throws.join(' | '))
  await s.hooks['turn.complete'](s.$, { reason: 'answer', usage: { input_tokens: NaN, output_tokens: -5, model: 5 } }, async () => ({}))
  const sp = s.crew().spent
  check('junk usage at turn.complete keeps the totals finite', Number.isFinite(sp.tokens) && Number.isFinite(sp.cost) && sp.tokens >= 0, JSON.stringify(sp))
  const t = await ms(() => s.hooks['turn.start'](s.$, { text: `<task-notification>${'<summary>a'.repeat(30_000)}`, turnId: 'T' }, async () => ({})))
  check('a 300 KB notification with unclosed tags is read in under 100 ms', t < 100, `${t.toFixed(0)} ms`)
}

// ── The real engine: parallel calls from 12 Claudes (the stand-in store here writes atomically, the engine retries) ──
{
  const appData = process.env.APPDATA ?? ''
  const base = appData && join(appData, 'Claude', 'claude-code')
  const exe = process.env.CLAUDE_EXE ?? (base && existsSync(base) ? readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).flatMap(v => readdirSync(join(base, v)).map(d => join(base, v, d, 'claude.exe'))).find(p => existsSync(p)) : undefined)
  if (!exe) console.log('- engine check skipped: no Claude Code found (set CLAUDE_EXE)')
  else {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const at = join(tmpdir(), `crew-perf-${process.pid}`)
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at, { recursive: true })
    cpSync(join(root, 'crew-map'), join(at, 'crew-map'), { recursive: true, filter: p => !/\.test\.tsx?$/.test(p) })
    writeFileSync(join(at, 'crew-map', 'parallel.test.ts'), PARALLEL_TEST())
    const r = spawnSync(exe, ['plugin', 'test', 'crew-map'], { encoding: 'utf8', cwd: at, timeout: 120_000 })
    const text = `${r.stdout}${r.stderr}`
    const m = text.match(/PERF (\{.*\})/)
    rmSync(at, { recursive: true, force: true })
    if (!m) check('the engine check ran', false, text.split(/\r?\n/).filter(Boolean).slice(-4).join(' | '))
    else {
      const got = JSON.parse(m[1])
      check('one call writes the state twice', got.one <= 3, `${got.one} writes`)
      check('12 parallel calls from 12 Claudes write the state at most 4 times each (no retry storm)', got.twelve <= 4, `${got.twelve} writes per call, ${got.wallMs} ms for the 12`)
    }
  }
}
function PARALLEL_TEST() {
  return `import { test, expect, mock } from 'claude-code/testing'
test('parallel', { timeoutMs: 60000 }, async ($, on) => {
  const clk = mock.clock(on, { now: Date.parse('2031-01-01T10:00:00Z') })
  mock.store(on, { intro: 'off' })
  mock.env(on, { OS: 'Windows_NT' })
  let sets = 0
  on('state.set' as never, (async (_$: any, e: any, next: any) => { if (e.key === 'crew') sets++; return next(e) }) as never)
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  on('turn.start', async () => ({ turnId: 'T' }) as never)
  on('session.start', async () => ({ cwd: 'C:/work/game' }) as never)
  on('command.register', async () => ({ value: true }) as never)
  on('session.cwd', async () => ({ value: 'C:/work/game' }) as never)
  on('ui.open', async () => ({ value: true }) as never)
  on('ui.toast', async () => ({ value: true }) as never)
  await $.session.start({ source: 'startup', cwd: 'C:/work/game' } as never)
  await $.turn.start({ text: 'Big job', turnId: 'T' } as never)
  for (let i = 0; i < 12; i++) await $.tool.call({ tool: 'Read', tool_use_id: 'w' + i, agentId: 'a' + i, file_path: 'C:/work/game/src/w' + i + '.md' } as never)
  let s0 = sets
  await $.tool.call({ tool: 'Read', tool_use_id: 'one', file_path: 'C:/work/game/src/one.md' } as never)
  const one = sets - s0
  s0 = sets
  const t = Date.now()
  await Promise.all(Array.from({ length: 12 }, (_, i) => $.tool.call({ tool: 'Read', tool_use_id: 'p' + i, agentId: 'a' + i, file_path: 'C:/work/game/src/p' + i + '.md' } as never)))
  await clk.settle()
  ;(globalThis as any).console.log('PERF ' + JSON.stringify({ one, twelve: +((sets - s0) / 12).toFixed(1), wallMs: Date.now() - t }))
  expect(true).toBe(true)
})
`
}

console.log(`\n${fails} failing check(s)`)
