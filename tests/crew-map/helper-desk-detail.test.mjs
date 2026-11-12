// A helper's row says what it is truly doing: in plain words, on what, for how long; a pip per step and
// the step it is on; what it last said while it thinks; and (under Details) its steps.
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
const pic = d => find(d, x => x.type === 'Svg')[0]?.props ?? {}
// A row's words, in order, as its picture draws them.
const words = d => [...String(pic(d).source ?? '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
const opened = d => kids(d).slice(1).map(x => text(x).trim()).join(' | ')
let n = 0
const call = (tool, input, during, result = { text: 'ok' }) => fire('tool.call', { tool, tool_use_id: `c${n++}`, agentId: 'sub1', ...input }, async e => { if (during) await during(e); return result })
let ids = 0
const task = (subject, activeForm) => { const id = String(++ids); return call('TaskCreate', { subject, description: subject, activeForm }, null, { result: { task: { id, subject } }, text: `Task #${id} created successfully: ${subject}` }) }
const update = (taskId, input) => call('TaskUpdate', { taskId, ...input }, null, { result: { success: true, taskId, updatedFields: Object.keys(input) }, text: 'Updated' })
const press = async (t, key) => { find(t, x => x.type === 'Button' && x.props.key === key)[0].props.onPress(); await new Promise(r => setTimeout(r, 5)) }

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

// Running a command for the task it is on: it waits on that command; its step and how far along.
await call('Bash', { command: 'node --test ui/tests/ 2>&1 | grep -E "^# (pass|fail)"', description: 'Run the adapter tests' }, async () => {
  const d = deskOf(await render(), 'sub1')
  const w = words(d)
  check('line one: its name, "Waiting" for the command in its own words, and how long it has been at it', w[0] === 'Helper' && w[1] === 'Waiting' && w[2] === '· for Run the adapter tests' && w[3] === '3m', w.join(' | '))
  check('line two: three pips, two done, and the step it is on', (pic(d).source.match(/<circle[^>]*r="3\.6"/g) ?? []).length === 3 && (pic(d).source.match(/<circle[^>]*r="3\.6" fill="#8B949E"/g) ?? []).length === 2 && w.includes('Step 3 of 3 · Applying agent request_action and running tests'), w.join(' | '))
  check('no $ in the row', !/\$/.test(w.join('')))
  // What it was started for, and its steps: under Details.
  await press(await render(), 'details:sub1')
  const o = opened(deskOf(await render(), 'sub1'))
  check('Details: its steps, each marked', /✓ Build the adapter shell/.test(o) && /✓ Wire the fixture agent/.test(o) && /▸ Applying agent request_action/.test(o), o)
  await press(await render(), 'details:sub1')
})

// Between steps, on the same task: thinking.
let w = words(deskOf(await render(), 'sub1'))
check('between steps: "Thinking", the step still under it', w[1] === 'Thinking' && w.includes('Step 3 of 3 · Applying agent request_action and running tests'), w.join(' | '))

// Task done, thinking with no task in hand: what it last said.
await update('3', { status: 'completed' })
await fire('session.append', { agentId: 'sub1', door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: 'All 26 adapter tests pass, so I will write up the summary for the main session.' }] }, origin: {}, uuid: 'u1' }, async () => ({}))
w = words(deskOf(await render(), 'sub1'))
check('thinking: what it last said, beside "Thinking"', w[1] === 'Thinking' && /^· All 26 adapter tests pass/.test(w[2]), w.join(' | '))
check('a finished plan reads step 3 of 3', w.some(x => /^Step 3 of 3/.test(x)), w.join(' | '))

// Editing a file: "Writing code", and the file.
await call('Edit', { file_path: `${P}/ui/js/adapters/fixture.js`, old_string: 'a', new_string: 'b' }, async () => {
  const e = words(deskOf(await render(), 'sub1'))
  check('editing a file: "Writing code · fixture.js"', e[1] === 'Writing code' && e[2] === '· fixture.js', e.join(' | '))
})

// The main Claude, its turn over: it waits on its helper, and says which.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('tool.call', { tool: 'Read', tool_use_id: 'r-after', agentId: 'sub1', file_path: `${P}/ui/a.js` }, async () => {
  const m = words(deskOf(await render(), 'main'))
  check('its turn over, the main Claude is "Waiting" for its helper, by name', m[1] === 'Waiting' && /for a helper: Helper|for Helper/.test(m[2]), m.join(' | '))
  return { text: 'ok' }
})

// Narrow (a side pane): every text still inside its picture.
const narrow = await render(50)
const D = deskOf(narrow, 'sub1')
const over = [...String(pic(D).source).matchAll(/<text x="([\d.]+)" y="[\d.]+"( text-anchor="end")? font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter(m => !m[2] && Number(m[1]) + m[4].length * Number(m[3]) * 0.62 > pic(D).width - 6)
check('a narrow pane cuts its words, never spills', !over.length, over.map(m => m[4]).join(' | '))

// A long task in your 87-column pane: cut on the row, whole under Details.
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
  const t87 = await render(87)
  const step = words(deskOf(t87, 'sub2')).find(x => /^Step /.test(x)) ?? ''
  check('87 cols: a long step is cut on its row, with …', step.endsWith('…') && step.length < longTask.length, step)
  await press(t87, 'details:sub2')
  const o = opened(deskOf(await render(87), 'sub2'))
  check('...and Details shows it whole', longTask.split(' ').every(x => o.includes(x)), o.slice(0, 200))
  return { text: 'ok' }
})
console.log(`\n${fails} failing check(s)`)
