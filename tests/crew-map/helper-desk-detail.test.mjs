// A helper's lane says what it is truly doing: where it is in its plan and how long it has been at it,
// the task it is on and the step it is taking for it, what it last said and did while it thinks, and
// (under › more) the job it was started for.
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
// A lane: its picture, then its name, headline and times on the first line, and the line under it.
const lane = d => {
  const row = kids(d)[0]
  const col = kids(row)[1]
  const [l1, l2] = kids(col)
  const parts = kids(l1)
  return {
    pic: kids(row)[0]?.props?.source ?? '',
    name: text(parts[0]).trim(),
    head: text(parts[1]).trim(),
    right: text(parts.at(-1)).trim(),
    line2: l2 ? text(l2).replace(/\s*(› more|⌄ less)\s*$/, '').trim() : '',
    more: find(d, x => x.type === 'Button' && String(x.props.key).startsWith('deskopen:'))[0],
    opened: kids(d).slice(1).map(x => text(x).trim()).join(' '),
  }
}
// Every line of text the lane draws (its picture aside), as drawn.
const rawRows = d => {
  const col = kids(kids(d)[0])[1]
  return [...kids(col).map(text), ...kids(d).slice(1).map(text)]
}
let n = 0
const call = (tool, input, during, result = { text: 'ok' }) => fire('tool.call', { tool, tool_use_id: `c${n++}`, agentId: 'sub1', ...input }, async e => { if (during) await during(e); return result })
let ids = 0
const task = (subject, activeForm) => { const id = String(++ids); return call('TaskCreate', { subject, description: subject, activeForm }, null, { result: { task: { id, subject } }, text: `Task #${id} created successfully: ${subject}` }) }
const update = (taskId, input) => call('TaskUpdate', { taskId, ...input }, null, { result: { success: true, taskId, updatedFields: Object.keys(input) }, text: 'Updated' })
const press = async b => { b.props.onPress(); await new Promise(r => setTimeout(r, 5)) }

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
  const l = lane(d)
  check('its lane: its name, and on the right where it is in its plan and how long it has been at it', l.name === 'Helper' && l.right === '3 of 3 · 3m32s', `${l.name} | ${l.right}`)
  check('its headline: the task it is on, in its own words', /^Applying agent request_action and run/.test(l.head), l.head)
  check('...and under it, the command it waits on for that task', l.line2 === '⏳ waiting on a command: Run the adapter tests', l.line2)
  const filled = (l.pic.match(/<circle[^>]*r="3.2"[^>]*fill="#/g) ?? []).length
  const dots = (l.pic.match(/<circle[^>]*r="3\.2"/g) ?? []).length
  check('its plan as a track: three tasks, two done', dots === 3 && filled === 2, `${dots} dots, ${filled} done`)
  check('...its tile says it waits on a command (an hourglass, orange)', /stroke="#FFA657"[^>]*><path d="M4\.5 2h7/.test(l.pic))
  check('no $ in the lane', !/\$/.test(rawRows(d).join('')))
  // What it was started for: under › more.
  await press(l.more)
  const opened = lane(deskOf(await render(), 'sub1'))
  check('› more opens what it was started for', /for: Production UI with adapters: Wire the production UI/.test(opened.opened), opened.opened.slice(0, 120))
  await press(opened.more)
})

// Between steps, on the same task: the task, and what it just did.
let l = lane(deskOf(await render(), 'sub1'))
check('thinking on its task: the task stays, and it says what it just did', /^Applying agent request_action and run/.test(l.head) && l.line2 === 'thinking · just did: ▸ Run the adapter tests', `${l.head} | ${l.line2}`)

// Task done, thinking with no task in hand: what it last said; the headline is what it is for.
await update('3', { status: 'completed' })
await fire('session.append', { agentId: 'sub1', door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: 'All 26 adapter tests pass, so I will write up the summary for the main session.' }] }, origin: {}, uuid: 'u1' }, async () => ({}))
l = lane(deskOf(await render(), 'sub1'))
check('thinking with no task in hand: what it last said, marked ›', /^› All 26 adapter tests pass/.test(l.line2), l.line2)
check('...under what it is for', l.head === 'Production UI with adapters', l.head)
check('a finished plan reads 3 of 3', /^3 of 3/.test(l.right), l.right)

// Editing a file: the file (a button that opens it) and its folder.
await call('Edit', { file_path: `${P}/ui/js/adapters/fixture.js`, old_string: 'a', new_string: 'b' }, async () => {
  const d = deskOf(await render(), 'sub1')
  const e = lane(d)
  const file = find(d, x => x.type === 'Button' && x.props.key === 'open-lane:sub1')[0]
  check('editing a file: the file, and its folder', /^✎ editing fixture\.js in ui\/js\/adapters/.test(e.line2) && text(file) === 'fixture.js', e.line2)
  check('...its tile a pencil', /<path d="M10\.5 2\.5l3 3/.test(e.pic))
})

// The main Claude's lane: your message as its headline, and (its turn over) the helper it waits on.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('tool.call', { tool: 'Read', tool_use_id: 'r-after', agentId: 'sub1', file_path: `${P}/ui/a.js` }, async () => {
  const t = await render()
  const m = lane(deskOf(t, 'main'))
  check("the main Claude's headline is your message", m.head === 'Build the production UI', m.head)
  check('...and under it, the helper it waits on', /waiting on a helper: Helper/.test(m.line2), m.line2)
  check("...and the helper's line on the tree flows (purple dashes)", /stroke="#D2A8FF"[^>]*stroke-dasharray/.test(lane(deskOf(t, 'sub1')).pic))
  return { text: 'ok' }
})

// Narrow (a side pane): every line still fits.
const narrow = deskOf(await render(50), 'sub1')
check('a narrow lane cuts its lines, never spills', rawRows(narrow).every(r => r.length <= 50 - 1 - 4), rawRows(narrow).join(' | '))

// A long job and task, in your 87-column pane: cut on the lane, whole under › more.
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
  const l2 = lane(d2)
  check('87 cols: a long task is cut on its lane, with › more', !!l2.more && l2.head.length < longTask.length, l2.head)
  await press(l2.more)
  const o = lane(deskOf(await render(87), 'sub2'))
  const words = o.opened.replace(/\s+/g, ' ')
  check('87 cols: › more shows the whole job and the whole task, every word', words.includes(longJob.split(' ').slice(-6).join(' ')) && longTask.split(' ').every(w => words.includes(w)), words.slice(0, 200))
  const inner = Math.floor(87 * 0.97) - 1 - 4
  check('87 cols: no line of the lane runs past the pane', rawRows(deskOf(await render(87), 'sub2')).every(r => r.length <= inner), rawRows(deskOf(await render(87), 'sub2')).map(r => r.length).join(','))
  return { text: 'ok' }
})
console.log(`\n${fails} failing check(s)`)
