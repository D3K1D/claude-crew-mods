// The work bar counts Claude's real plan: Claude Code's task list (TaskCreate, TaskUpdate, TaskList)
// by task id, each call counted once it went through, only the work of the latest message, and
// the tasks a Claude made on its own bar; or its TodoWrite list.
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
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 60 } }, viewport: { columns: 150 } }, async () => ({}))
const windowOf = (t, name) => find(t, x => x.type === 'Box' && x.props.borderStyle && find(x, y => y.type === 'Text' && text(y) === `✻ ${name}`).length)[0]
const row = (t, name, label) => find(windowOf(t, name), x => x.type === 'Box' && x.props.flexDirection === 'row' && text(kids(x)[0]).trim() === label)[0]
const work = (t, name = 'Claude') => text(row(t, name, 'work')).replace(/^work\s*/, '').replace(/[█▒░]/g, '').trim()
const bar = (t, name = 'Claude') => text(row(t, name, 'work')).replace(/[^█▒░]/g, '')
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const call = (tool, input, result = { text: 'ok' }, more = {}) => fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input, ...more }, async () => result)
let ids = 0
const create = (subject, more = {}) => { const id = String(++ids); return call('TaskCreate', { subject, description: subject, activeForm: `${subject}ing` }, { result: { task: { id, subject } }, text: `Task #${id} created successfully: ${subject}` }, more) }
const update = (taskId, input, more = {}, success = true) => call('TaskUpdate', { taskId, ...input }, { result: { success, taskId, updatedFields: Object.keys(input) }, text: success ? 'Updated' : 'Task not found', ...(success ? {} : {}) }, more)
// What the window shows while the Claude is at work (inside a call).
const seen = async (name = 'Claude', more = {}) => { let t; await fire('tool.call', { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/a.ts`, ...more }, async () => { t = await render(); return { text: 'ok' } }); return t }

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Port the loader', turnId: 'T' }, async () => ({}))
for (const s of ['Read the loader', 'Port the parser', 'Write tests', 'Update docs']) await create(s)
let t = await seen()
check('four new tasks: 0% and "0 of 4 tasks done"', /^0%\s*0 of 4 tasks done$/.test(work(t)), work(t))

await update('1', { status: 'in_progress', activeForm: 'Reading the loader' })
t = await seen()
check('on the first: still 0%, its share of the bar shaded, and "now" says what it is on', /^0%/.test(work(t)) && (bar(t).match(/▒/g) ?? []).length > 0 && /Reading the loader/.test(text(row(t, 'Claude', 'now'))), `${bar(t)} | ${text(row(t, 'Claude', 'now'))}`)

await update('1', { status: 'completed' })
await update('1', { status: 'completed' })
t = await seen()
check('one finished (marked twice): 25%, not 50%', /^25%\s*1 of 4 tasks done$/.test(work(t)), work(t))

await update('9', { status: 'completed' }, {}, false)
await call('TaskUpdate', { taskId: '2', status: 'completed' }, { result: { success: false, taskId: '2', updatedFields: [], error: 'blocked' }, isError: true, text: 'blocked' })
t = await seen()
check('updates that did not go through change nothing', /^25%/.test(work(t)), work(t))

await update('4', { status: 'deleted' })
t = await seen()
check('a task deleted: 1 of 3, 33%', /^33%\s*1 of 3 tasks done$/.test(work(t)), work(t))

// A new message: what was finished before is not part of the work now; what is open still is.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('turn.start', { text: 'Keep going', turnId: 'U' }, async () => ({}))
t = await seen()
check('next message: the finished task drops out, the two open stay (0 of 2)', /^0%\s*0 of 2 tasks done$/.test(work(t)), work(t))
await update('2', { status: 'completed' })
t = await seen()
check('...and finishing one of them reads 50%, not 100%', /^50%\s*1 of 2 tasks done$/.test(work(t)), work(t))

// TaskList is the truth: it resyncs a list the pane got out of step with.
await call('TaskList', {}, { result: { tasks: [{ id: '2', subject: 'Port the parser', status: 'completed', blockedBy: [] }, { id: '3', subject: 'Write tests', status: 'completed', blockedBy: [] }, { id: '5', subject: 'Fix lint', status: 'pending', blockedBy: [] }] }, text: '' })
t = await seen()
check('a TaskList resyncs it: 2 of 3, 67%', /^67%\s*2 of 3 tasks done$/.test(work(t)), work(t))
ids = 5

// A helper's own tasks are on its own bar, not the main Claude's.
await fire('tool.call', { tool: 'Agent', tool_use_id: 'spawn1', description: 'Write the tests', prompt: 'Write tests', subagent_type: 'general-purpose' }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Write tests', description: 'Write the tests', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  for (const s of ['Unit tests', 'Edge cases']) await create(s, { agentId: 'sub1' })
  await update(String(ids - 1), { status: 'completed' }, { agentId: 'sub1' })
  const name = globalThis.__store.get('crew').agents.find(a => a.id === 'sub1').name
  t = await seen(name, { agentId: 'sub1' })
  check("a helper's tasks fill its own bar (1 of 2, 50%)", /^50%\s*1 of 2 tasks done$/.test(work(t, name)), work(t, name))
  check("...and leave the main Claude's alone (still 2 of 3)", /2 of 3 tasks done/.test(work(t)), work(t))
  return { text: 'done' }
})

// A TodoWrite list counts the same way.
await fire('turn.start', { text: 'Something new', turnId: 'V' }, async () => ({}))
await call('TaskList', {}, { result: { tasks: [] }, text: '' })
await call('TodoWrite', { todos: [{ content: 'A', status: 'completed', activeForm: 'Doing A' }, { content: 'B', status: 'in_progress', activeForm: 'Doing B' }, { content: 'C', status: 'pending', activeForm: 'Doing C' }] })
t = await seen()
check('a to-do list: 1 of 3 to-dos, 33%, on "Doing B"', /^33%\s*1 of 3 to-dos done$/.test(work(t)) && /Doing B/.test(text(row(t, 'Claude', 'now'))), work(t))
console.log(`\n${fails} failing check(s)`)
