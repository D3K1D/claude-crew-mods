// What the main Claude waits on, said on its desk and in its window: its helpers (while it runs them,
// or after its turn while they still work), a command (while it runs, or a background one after its
// turn), or you (a permission or question: urgent; or simply your turn when nothing else runs).
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
await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Port the loader', turnId: 'T' }, async () => ({}))
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 50 } }, viewport: { columns: 150 } }, async () => ({}))
const mainDesk = t => find(t, x => x.props?.key === 'desk-main')[0]
const mainWindow = t => find(t, x => x.type === 'Box' && x.props.borderStyle && find(x, y => y.type === 'Text' && text(y) === '✻ Claude').length)[0]
const title = t => text(kids(mainWindow(t))[0])
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
check('running a helper, the main desk says it waits on a helper, and which', /waiting on a helper[\s\S]*Scout/.test(text(mainDesk(t))), text(mainDesk(t)))
check('...in purple', find(mainDesk(t), x => x.type === 'Text' && /waiting on a helper/.test(text(x)))[0]?.props.color === '#D2A8FF')
check('...and its window title says "waiting on Scout"', /⏳ waiting on Scout/.test(title(t)), title(t))

// ── A command it runs and waits for ──
await call('Bash', { command: 'npm run build', description: 'Build the app' }, async () => { now += 3000; t = await render() })
check('running a command, the desk says it waits on a command, in Claude\'s words', /waiting on a command[\s\S]*Build the app/.test(text(mainDesk(t))), text(mainDesk(t)))
check('...and the window title names it, in orange', /⏳ waiting on Build the app/.test(title(t)) && find(kids(mainWindow(t))[0], x => x.type === 'Text' && /waiting on Build/.test(text(x)))[0]?.props.color === '#FFA657', title(t))

// ── You: a permission it needs ──
await call('Bash', { command: 'rm -rf build', description: 'Clear the old build' }, async () => {
  await fire('classic.PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build' } }, async () => ({}))
  t = await render()
})
check('a permission: waiting on you, in amber, before anything else', /waiting on you[\s\S]*Clear the old build/.test(text(mainDesk(t))) && /⏸ waiting on you/.test(title(t)), text(mainDesk(t)))

// ── Thinking is not waiting ──
t = await render()
check('between calls (thinking), it waits on nothing', !/waiting on|your turn/.test(text(mainDesk(t))) && !/waiting on|your turn/.test(title(t)), title(t))

// ── Turn over, a helper still working in the background ──
await call('Agent', { description: 'Write the tests', prompt: 'Write tests', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Write tests', description: 'Write the tests', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub2' }))
}, { text: 'Started in the background' })
await call('Read', { file_path: `${P}/tests/a.test.ts` }, async () => {
  await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
  t = await render()
}, { text: 'ok' }, { agentId: 'sub2' })
check('its turn over, a helper still at work: the main desk waits on that helper', /waiting on a helper[\s\S]*Helper/.test(text(mainDesk(t))), text(mainDesk(t)))
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'S', agentId: 'sub2', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))

// ── Turn over, a background command still running ──
await fire('turn.start', { text: 'Start the server', turnId: 'U' }, async () => ({}))
await call('Bash', { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }, null, { text: 'Command running in background with ID: bash_1' })
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'U', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
t = await render()
check('its turn over, a background command running: the desk waits on that command', /waiting on a command[\s\S]*Start the dev server/.test(text(mainDesk(t))), text(mainDesk(t)))

// ── Turn over, nothing left running: your turn ──
await call('KillShell', { shell_id: 'bash_1' }, null, { text: 'killed' })
for (const a of globalThis.__store.get('crew').agents) if (a.id === 'main') a.state = 'idle'
t = await render()
check('nothing left running: it is your turn, said plainly (not in amber)', /your turn/.test(text(mainDesk(t))) && /○ your turn/.test(title(t)) && !/⏸/.test(title(t)), `${text(mainDesk(t))} | ${title(t)}`)
console.log(`\n${fails} failing check(s)`)
