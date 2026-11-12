// At a glance: one row per Claude, in tree order (each Claude, then the helpers it started, indented),
// the ones needing you pinned on top. Line one: its little Claude, name, what it is doing in plain words
// (colour says its state), its time. Line two: a pip per step and "Step n of N", its model. Done: one dim
// line. Hooks count as actions. Every text is cut to fit its picture; Details opens the rest.
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
  store: { get: async k => (k === 'intro' ? 'off' : k === 'theme' ? 'dark' : undefined), set: async () => {} },
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
const render = (cols = 87, surface = 'desktop') => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface, props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const rows = t => kids(find(t, x => x.props?.key === 'desks')[0]).filter(x => String(x.props?.key ?? '').startsWith('desk-'))
const row = (t, id) => find(t, x => x.props?.key === `desk-${id}`)[0]
const pic = d => find(d, x => x.type === 'Svg')[0]?.props
// The words of a row's picture, in order.
const words = d => [...(pic(d)?.source ?? '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
const spawn = (id, by) => fire('tool.call', { tool: 'Agent', tool_use_id: `sp${id}`, ...(by ? { agentId: by } : {}), description: `Part ${id}`, prompt: `Do ${id}`, subagent_type: 'general-purpose', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, ...(by ? { agentId: by } : {}), prompt: `Do ${id}`, description: `Part ${id}`, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: id }))
  return { text: 'Started' }
})
const step = (agentId, model) => fire('turn.step', { turnId: 'T', index: 0, model, messageCount: 3, ...(agentId ? { agentId } : {}) }, async function* () { return { usage: null } })
const drain = async g => { const it = g?.[Symbol.asyncIterator]?.(); if (it) while (!(await it.next()).done); }
const press = async (t, key) => { find(t, x => x.type === 'Button' && x.props.key === key)[0].props.onPress(); await tick() }

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Build the inventory', turnId: 'T' }, async () => ({}))
await drain(step(undefined, 'claude-opus-5-5'))
await fire('tool.call', { tool: 'Read', tool_use_id: 'r0', file_path: `${P}/src/a.ts` }, async () => ({ text: 'ok' }))
await spawn('s1')
await spawn('s2')
await spawn('s3', 's1')
await drain(step('s1', 'claude-sonnet-5-5'))
await drain(step('s3', 'claude-fable-5-1'))

// s1 editing, in its plan's second of four steps.
const task = (agentId, id, subject) => fire('tool.call', { tool: 'TaskCreate', tool_use_id: `t${id}`, agentId, subject, description: subject, activeForm: subject }, async () => ({ result: { task: { id, subject } }, text: 'ok' }))
const status = (agentId, id, s) => fire('tool.call', { tool: 'TaskUpdate', tool_use_id: `u${id}${s}`, agentId, taskId: id, status: s }, async () => ({ result: { success: true, taskId: id, updatedFields: ['status'] }, text: 'ok' }))
for (const [id, sub] of [['1', 'Read the docs'], ['2', 'Wire the fixture agent'], ['3', 'Test it'], ['4', 'Ship it']]) await task('s1', id, sub)
await status('s1', '1', 'completed')
await status('s1', '2', 'in_progress')
let release
const editing = fire('tool.call', { tool: 'Edit', tool_use_id: 'e1', agentId: 's1', file_path: `${P}/ui/js/adapters/fixture.js`, old_string: 'a', new_string: 'b' }, () => new Promise(r => (release = r)))
await tick()
await fire('tool.call', { tool: 'WebFetch', tool_use_id: 'w1', agentId: 's3', url: 'https://docs.example.dev/adapters', prompt: 'read' }, async () => ({ text: 'ok' }))
now += 3000

let t = await render()
let R = rows(t)
check('a row per Claude, in tree order: the main one, its helper, the helper that one started, its other helper', R.map(d => d.props.key).join(',') === 'desk-main,desk-s1,desk-s3,desk-s2', R.map(d => d.props.key).join(','))
const s1 = row(t, 's1')
check('line one: its name, then what it is doing in plain words, and on what', words(s1).slice(0, 3).join(' | ') === 'Helper | Writing code | · fixture.js', words(s1).join(' | '))
check('...in the colour of its state (working: green)', /font-weight="700" fill="#3FB950"[^>]*>Writing code</.test(pic(s1).source))
check('...with a little Claude beside its name', /class="eye"/.test(pic(s1).source))
check('line two: a pip per step, one done, and "Step 2 of 4" with the step', (pic(s1).source.match(/<circle[^>]*r="3\.6"/g) ?? []).length === 4 && (pic(s1).source.match(/<circle[^>]*r="3\.6" fill="#3FB950"/g) ?? []).length === 1 && words(s1).includes('Step 2 of 4 · Wire the fixture agent'), words(s1).join(' | '))
check('...and its model, as people say it', words(s1).includes('Sonnet 5.5') && words(row(t, 's3')).includes('Fable 5.1') && words(row(t, 'main')).includes('Opus 5.5'))
check('a helper of a helper is indented a step further', /<rect x="28\.5"/.test(pic(row(t, 's3')).source) && /<rect x="14\.5"/.test(pic(s1).source))
check('no step list: says so, with how many actions, and no pips', words(row(t, 's3')).some(w => /^No step list · \d+ actions? so far$/.test(w)) && !/r="3\.6"/.test(pic(row(t, 's3')).source), words(row(t, 's3')).join(' | '))
check('the main Claude between steps: "Thinking", and for how long', /fill="#3FB950"[^>]*>Thinking</.test(pic(row(t, 'main')).source) && words(row(t, 'main')).includes('· 3s'), words(row(t, 'main')).join(' | '))
check('every row is two lines, its picture as tall', R.every(d => pic(d).height === 38))
// Nothing runs past its picture: each text's end, counted in characters of the fixed font.
const over = R.flatMap(d => [...pic(d).source.matchAll(/<text x="([\d.]+)" y="[\d.]+"( text-anchor="end")? font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter(m => !m[2] && Number(m[1]) + m[4].length * Number(m[3]) * 0.62 > pic(d).width - 6).map(m => m[4]))
check('87 cols: no text runs past its row', !over.length, over.join(' | '))
release({ text: 'ok' })
await editing

// A hook blocking a tool, then a permission: the row says it needs you, pinned on top, the request whole.
await fire('classic.PreToolUse', { tool: 'Bash', tool_use_id: 'b1', agentId: 's2', input: { command: 'rm -rf build' } }, async () => ({ deny: 'not allowed' }))
let rel2
const perm = fire('classic.PermissionRequest', { agent_id: 's2', tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build folder' } }, () => new Promise(r => (rel2 = r)))
await tick()
t = await render()
R = rows(t)
const s2 = row(t, 's2')
check('needing you: pinned to the top', R[0].props.key === 'desk-s2', R.map(d => d.props.key).join(','))
check('...an amber card saying "Needs you", the whole request under it, and who it helps', /<rect[^>]*fill="#E3B341"/.test(pic(s2).source) && words(s2).includes('Needs you') && words(s2).some(w => /Clear the old build folder\? Answer in the chat\./.test(w)) && words(s2).includes('helping Claude'), words(s2).join(' | '))
check('...its picture as tall as its lines', pic(s2).height === 3 * 19, String(pic(s2).height))
await press(t, 'details:s2')
t = await render()
const det = kids(row(t, 's2')).slice(1).map(text).join(' | ')
check('Details: its model, its recent kinds of action (your hook that blocked it too)', /your hook blocked it/.test(det), det)
rel2({ decision: 'allow' })
await perm

// Done: one dim line.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'S3', agentId: 's3', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-fable-5-1' } }, async () => ({ text: 'ok' }))
t = await render()
const s3 = row(t, 's3')
check('done: one dim line, a dot for its face', !!s3 && pic(s3).height === 19 && /Done/.test(words(s3).join(' ')) && !/class="eye"/.test(pic(s3).source), s3 && words(s3).join(' | '))

// Details: its model, cost and steps.
await press(t, 'details:s1')
t = await render()
const d1 = kids(row(t, 's1')).slice(1).map(text).join(' | ')
check('Details opens its model and its steps (✓ done, ▸ on it, ○ to come)', /Sonnet 5\.5/.test(d1) && /✓ Read the docs/.test(d1) && /▸ Wire the fixture agent/.test(d1) && /○ Test it/.test(d1), d1)
check('...and the button says Hide', text(find(t, x => x.type === 'Button' && x.props.key === 'details:s1')[0]) === 'Hide')

// The terminal: the same rows in words.
const tt = await render(100, 'terminal')
check('terminal: each row in words', /Helper Writing code|Helper Reading|Helper Thinking/.test(text(row(tt, 's1'))) && /Step 2 of 4/.test(text(row(tt, 's1'))), text(row(tt, 's1')))
console.log(`\n${fails} failing check(s)`)
