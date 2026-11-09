// A helper's desk says what it is truly doing: how long it has been at it, the job it was started for,
// the task it is on (from its own plan) and the step it is taking, what it last said and did while it
// thinks, and how far through its plan it is.
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
const P = 'C:/Users/me/Optimization Tool'
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
const render = (cols = 150) => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const deskOf = (t, id) => find(t, x => x.props?.key === `desk-${id}`)[0]
// A desk's lines, each as read across its rows: name, job, on now, detail, plan.
const joined = xs => xs.map(x => text(x).trim()).filter(Boolean).join(' ')
const rows = d => {
  const [top, n0, n1, d0, d1, plan] = kids(d)
  const [name, ...job] = kids(kids(top).find(k => k.type === 'Box'))
  return [text(name).trim(), joined(job), joined([n0, n1]), joined([d0, d1]), text(plan).trim()]
}
// Every row the desk draws, as drawn.
const rawRows = d => { const [top, ...rest] = kids(d); return [...kids(kids(top).find(k => k.type === 'Box')).map(text), ...rest.map(text)] }
let n = 0
const call = (tool, input, during, result = { text: 'ok' }) => fire('tool.call', { tool, tool_use_id: `c${n++}`, agentId: 'sub1', ...input }, async e => { if (during) await during(e); return result })
let ids = 0
const task = (subject, activeForm) => { const id = String(++ids); return call('TaskCreate', { subject, description: subject, activeForm }, null, { result: { task: { id, subject } }, text: `Task #${id} created successfully: ${subject}` }) }
const update = (taskId, input) => call('TaskUpdate', { taskId, ...input }, null, { result: { success: true, taskId, updatedFields: Object.keys(input) }, text: 'Updated' })

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Build the production UI', turnId: 'T' }, async () => ({}))
await fire('tool.call', { tool: 'Agent', tool_use_id: 'spawn1', description: 'Production UI with adapters', prompt: 'Wire the production UI to the adapters, then run the adapter tests until they pass.', subagent_type: 'general-purpose', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: 'Wire the production UI to the adapters, then run the adapter tests until they pass.', description: 'Production UI with adapters', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  return { text: 'Started in the background' }
})
await task('Build the adapter shell', 'Building the adapter shell')
await task('Wire the fixture agent', 'Wiring the fixture agent')
await task('Apply agent request_action and run tests', 'Applying agent request_action and running tests')
await update('1', { status: 'completed' })
await update('2', { status: 'completed' })
await update('3', { status: 'in_progress' })
now += 212_000

// Running a command for the task it is on.
await call('Bash', { command: 'node --test ui/tests/ 2>&1 | grep -E "^# (pass|fail)"', description: 'Run the adapter tests' }, async () => {
  const d = deskOf(await render(), 'sub1')
  const [name, job, onNow, detail, plan] = rows(d)
  check('its name row says how long it has been at it', /^Helper.* · 3m32s(  › more)?$/.test(name), name)
  check('its job is what it was started for', job === 'Production UI with adapters', job)
  check('on now: the task it is on, in its own words', /^Applying agent request_action and run/.test(onNow), onNow)
  check('...and under it, the command it waits on for that task', detail === '⏳ waiting on a command: Run the adapter tests', detail)
  check('its plan: 2 of 3 tasks done, as a bar', plan === '▰▰▰▰▱▱ 2 of 3 tasks done', plan)
  check('no $ on the desk', !/\$/.test(text(d)))
})

// Between steps, on the same task: the task, and what it just did.
let d = deskOf(await render(), 'sub1')
let [, , onNow, detail] = rows(d)
check('thinking on its task: the task stays, and it says what it just did', /^Applying agent request_action and run/.test(onNow) && detail === 'just did: ▸ Run the adapter tests', `${onNow} | ${detail}`)

// Task done, thinking with no task in hand: what it last said.
await update('3', { status: 'completed' })
await fire('session.append', { agentId: 'sub1', door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: 'All 26 adapter tests pass, so I will write up the summary for the main session.' }] }, origin: {}, uuid: 'u1' }, async () => ({}))
d = deskOf(await render(), 'sub1')
;[, , onNow, detail] = rows(d)
check('thinking with no task in hand: what it last said, marked ›', /^› All 26 adapter tests pass/.test(onNow), onNow)
check('...and what it just did', /^just did: /.test(detail), detail)
check('a finished plan reads 3 of 3', rows(d)[4] === '▰▰▰▰▰▰ 3 of 3 tasks done', rows(d)[4])

// Editing a file: the step names the file and its folder.
await call('Edit', { file_path: `${P}/ui/js/adapters/fixture.js`, old_string: 'a', new_string: 'b' }, async () => {
  const [, , on2, det2] = rows(deskOf(await render(), 'sub1'))
  check('editing a file: the file, and its folder', on2 === 'fixture.js' && /in ui\/js\/adapters$/.test(det2), `${on2} | ${det2}`)
})

// The main Claude's desk: your message as its job, and (its turn over) the helper it waits on.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
const [, mainJob, mainOn, mainDetail] = rows(deskOf(await render(), 'main'))
check("the main Claude's job is your message", mainJob === 'Build the production UI', mainJob)
check('...and it says it waits on its helper, and which', /waiting on a helper/.test(mainOn) && /Helper/.test(mainDetail), `${mainOn} | ${mainDetail}`)

// Narrow (a side pane, one desk across): every line still fits.
const narrow = deskOf(await render(50), 'sub1')
check('a narrow desk cuts its lines, never spills', rawRows(narrow).every(r => r.length <= 50 - 1 - 4), rawRows(narrow).join(' | '))

// A long job and task, in your 87-column pane: each reads whole over two rows, no words lost.
await fire('turn.start', { text: 'Go on', turnId: 'W' }, async () => ({}))
const longJob = 'Wire the production UI to every adapter, then run the adapter tests on Windows and macOS'
await fire('tool.call', { tool: 'Agent', tool_use_id: 'spawn2', description: longJob, prompt: longJob, subagent_type: 'general-purpose', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: longJob, description: longJob, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub2' }))
  return { text: 'Started in the background' }
})
const longTask = 'Applying the agent request_action schema to the fixture agent and re-running the adapter suite until it passes'
await fire('tool.call', { tool: 'TaskCreate', tool_use_id: 'lt1', agentId: 'sub2', subject: longTask, description: longTask, activeForm: longTask }, async () => ({ result: { task: { id: '50', subject: longTask } }, text: 'ok' }))
await fire('tool.call', { tool: 'TaskUpdate', tool_use_id: 'lt2', agentId: 'sub2', taskId: '50', status: 'in_progress' }, async () => ({ result: { success: true, taskId: '50', updatedFields: ['status'] }, text: 'ok' }))
await fire('tool.call', { tool: 'Read', tool_use_id: 'lt3', agentId: 'sub2', file_path: `${P}/ui/a.js` }, async () => {
  const d2 = deskOf(await render(87), 'sub2')
  const [, job2, now2] = rows(d2)
  check('87 cols: a long job reads whole over two rows', job2 === longJob, job2)
  check('87 cols: a long task reads whole over two rows', now2 === longTask, now2)
  const inner = Math.floor(87 * 0.97) - 1 - 4
  check('87 cols: no row of the desk runs past it', rawRows(d2).every(r => r.length <= inner), rawRows(d2).map(r => r.length).join(','))
  return { text: 'ok' }
})
console.log(`\n${fails} failing check(s)`)
