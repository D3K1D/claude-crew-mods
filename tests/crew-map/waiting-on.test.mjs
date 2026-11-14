// What the main Claude waits on, said on its desk and in its window: its helpers (while it runs them,
// or after its turn while they still work), a command (while it runs, or a background one after its
// turn), or you (a permission or question: urgent; or simply your turn when nothing else runs).
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
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'theme' ? 'dark' : undefined), set: async () => {} },
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
await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Port the loader', turnId: 'T' }, async () => ({}))
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
// A row in words: its picture's alt (the row as drawn), then any text beside it.
const say = d => (d ? [...find(d, x => x.type === 'Svg').map(x => x.props.alt ?? ''), text(d)].join(' ') : '')
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 50 } }, viewport: { columns: 150 } }, async () => ({}))
const kit = await import('./kit.mjs')
// The main Claude's row: its words, line by line; and one of them.
const rowGlyphs = t => kit.rowGlyphs(t, 'Claude')
const row = t => rowGlyphs(t).map(g => g.t).join(' ')
const word = (t, w) => rowGlyphs(t).find(g => g.t === w)
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const call = (tool, input, during, result = { text: 'ok' }, more = {}) => fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input, ...more }, async e => { if (during) await during(e); return result })
let t

// ── Helpers: while the main Claude sits in the call that runs them ──
await call('Agent', { description: 'Map the loader', prompt: 'Find how chunks load', subagent_type: 'Explore' }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Find how chunks load', description: 'Map the loader', subagentType: 'Explore', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  await call('Read', { file_path: `${P}/src/loader.ts` }, async () => { t = await render() }, { text: 'ok' }, { agentId: 'sub1' })
})
check('running a helper, the main row says it waits on a helper, and which', /Claude Waiting for .*Scout/.test(row(t)), row(t))
check('...in grey (waiting: not working itself)', word(t, 'Waiting')?.role === 'dim')

// ── A command it runs and waits for ──
await call('Bash', { command: 'npm run build', description: 'Build the app' }, async () => { now += 3000; t = await render() })
check("running a build is its work: the row says Building, what for in Claude's words, and how long", /Claude Building Build the app · 3s/.test(row(t)), row(t))
check('...in green (working)', word(t, 'Building')?.role === 'green')

// ── You: a permission it needs ──
await call('Bash', { command: 'rm -rf build', description: 'Clear the old build' }, async () => {
  await fire('classic.PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build' } }, async () => ({}))
  t = await render()
})
check('a permission: it needs you, in amber, with what it asks', /Claude Needs you .*Allow running Clear the old build\? Answer in the chat\./.test(row(t)) && word(t, 'Needs you')?.role === 'amber', row(t))

// ── Thinking is not waiting ──
t = await render()
check('between calls (thinking), it waits on nothing', !/Waiting|Idle/.test(row(t)), row(t))

// ── Turn over, a helper still working in the background ──
await call('Agent', { description: 'Write the tests', prompt: 'Write tests', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Write tests', description: 'Write the tests', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub2' }))
}, { text: 'Started in the background' })
await call('Read', { file_path: `${P}/tests/a.test.ts` }, async () => {
  await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
  t = await render()
}, { text: 'ok' }, { agentId: 'sub2' })
check('its turn over, a helper still at work: the main row waits on that helper', /Claude Waiting for .*Helper/.test(row(t)), row(t))
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'S', agentId: 'sub2', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))

// ── Turn over, a background command still running ──
await fire('turn.start', { text: 'Start the server', turnId: 'U' }, async () => ({}))
await call('Bash', { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }, null, { text: 'Command running in background with ID: bash_1' })
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'U', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
t = await render()
check('its turn over, a background command running: the row waits on that command', /Claude Waiting for .*Start the dev server/.test(row(t)), row(t))

// ── Turn over, nothing left running: your turn ──
await call('KillShell', { shell_id: 'bash_1' }, null, { text: 'killed' })
for (const a of globalThis.__store.get('crew').agents) if (a.id === 'main') a.state = 'idle'
t = await render()
check('nothing left running: it is your turn, said plainly (not in amber)', /Claude Idle your turn/.test(row(t)) && word(t, 'Idle')?.role === 'dim', row(t))
console.log(`\n${fails} failing check(s)`)
