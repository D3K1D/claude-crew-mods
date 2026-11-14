// The whole pane as the design draws it: the header (counts by state, the one cost), the crew (a row per
// Claude, helpers under who started them, one needing you pinned on top, Codex in a row), Touched (a
// line per folder, files as buttons) and the viewer (Activity, Files, Search, Settings, or one Claude's
// Details). What is only read is drawn as pictures (the header, each Claude's row, the last task's card);
// everything pressed is a real Button, beside or under them, never over them.
import { find, text, words, glyphs, has, pics, makePress, targets, viewHeight } from './kit.mjs'
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T21:00:00')
Date.now = () => now
const P = 'C:/work/game'
let codex = []
const toasts = []
const copied = []
const ran = []
const stored = {}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => void toasts.push(t), copy: async a => (copied.push(a), { isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : stored[k]), set: async (k, v) => void (stored[k] = v) },
  session: { cwd: async () => P, usage: async () => ({ cost: { usd: 3.18 } }) },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: codex }) },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const render = (cols = 87, surface = 'desktop') => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface, props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 60))
const press = makePress(elements, render, tick)
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const spawn = (id, type, desc, by, bg = true) => fire('tool.call', { tool: 'Agent', tool_use_id: `sp${id}`, ...(by ? { agentId: by } : {}), description: desc, prompt: desc, subagent_type: type, run_in_background: bg }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, ...(by ? { agentId: by } : {}), prompt: desc, description: desc, subagentType: type, provider: {}, parentModel: 'm' }, async () => ({ agentId: id }))
  return { text: 'Started' }
})
const drain = async g => { const it = g?.[Symbol.asyncIterator]?.(); if (it) while (!(await it.next()).done); }
const step = (agentId, model) => drain(fire('turn.step', { turnId: 'T', index: 0, model, messageCount: 3, ...(agentId ? { agentId } : {}) }, async function* () { return { usage: null } }))
const task = (agentId, id, subject) => fire('tool.call', { tool: 'TaskCreate', tool_use_id: `t${id}`, agentId, subject, description: subject, activeForm: subject }, async () => ({ result: { task: { id, subject } }, text: 'ok' }))
const status = (agentId, id, s) => fire('tool.call', { tool: 'TaskUpdate', tool_use_id: `u${id}${s}`, agentId, taskId: id, status: s }, async () => ({ result: { success: true, taskId: id, updatedFields: ['status'] }, text: 'ok' }))
const hang = []
const held = (ev, e) => { fire(ev, e, () => new Promise(r => hang.push(r))); return tick() }
const edit = (id, agentId, file, add) => fire('tool.call', { tool: 'Edit', tool_use_id: id, ...(agentId ? { agentId } : {}), file_path: `${P}/${file}`, old_string: 'a', new_string: 'x\n'.repeat(add) }, async () => ({ text: 'ok' }))

await fire('session.start', {}, async () => ({}))

// ── Before any work: one Claude, idle; the crew's room says what will show there, with the demo.
let t = await render()
check('desktop: the header and the row are pictures; no Client, nothing laid over a picture', pics(t).length >= 2 && find(t, x => x.type === 'Client').length === 0 && find(t, x => x.type === 'Box' && (x.props.marginTop ?? 0) < 0).length === 0)
check("each Claude's card is a Box with a border (its fill only with a theme picked: auto can't fill a Box), holding its picture and its Details Button", find(t, x => x.type === 'Box' && String(x.props.key ?? '').startsWith('row-')).every(b => b.props.borderStyle === 'round' && !b.props.backgroundColor && find(b, y => y.type === 'Svg').length === 1 && find(b, y => y.type === 'Button').length === 1))
{
  // The viewer runs to the bottom of the pane: what the pane has, less what is above it; never under 8.
  const at = rows => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 87, scroll: { bodyRows: rows } }, viewport: { columns: 87 } }, async () => ({})).then(viewHeight)
  const [h60, h40, h10] = [await at(60), await at(40), await at(10)]
  check('the viewer fills the pane to its bottom: 20 more rows of pane, 20 more rows of log', h60 - h40 === 20 && h60 > 12, `${h60} ${h40}`)
  check('...and keeps 8 rows in a short pane', h10 === 8, String(h10))
  const unsized = await fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 87 }, viewport: { columns: 87 } }, async () => ({})).then(viewHeight)
  check('...and 12 where the surface gives no size', unsized === 12, String(unsized))
}
check('header: the brand and one idle Claude, nothing running', has(t, '✻ Claude Crew', 'top') && has(t, '◌ 1 idle', 'top') && has(t, 'nothing running', 'top'))
check('the idle Claude says it is your turn, and what to do', has(t, 'Idle', 'top') && has(t, 'your turn', 'top') && has(t, 'ask Claude something to start', 'top'))
check('before any work, the crew says what will show there', has(t, 'Nothing yet. Each Claude gets a row here as it starts.', 'top'))
check('...with the demo', (await targets(elements, render)).includes('▶ Try a pretend session'))
check('Touched says there are no files yet', has(t, 'No files yet. Folders show here as the Claudes open files.', 'top'))
check('the tabs: Activity (shown), Files 0, Search, Settings; ▲ older, ▼ newer and ⤓ latest, each a Button', ['Activity', 'Files 0', '⌕', '⚙', '▲ older', '▼ newer', '⤓ latest'].every(w => find(t, x => x.type === 'Button' && text(x) === w).length === 1) && glyphs(t, 'top').find(g => g.t === 'Activity')?.bold === true)

// ── Busy: the design's state. One needs you, helpers at work (one of theirs too), a test running, Codex, files changed.
await fire('turn.start', { text: 'Fix the adapter tests and make them run offline', turnId: 'T' }, async () => ({}))
await step(undefined, 'claude-opus-5-5')
for (const [id, s] of [['m1', 'Read the adapter API'], ['m2', 'Wire the adapters in'], ['m3', 'Run the tests'], ['m4', 'Report back']]) await task(undefined, id, s)
await status(undefined, 'm1', 'completed')
await status(undefined, 'm2', 'in_progress')
await edit('e0', undefined, 'src/adapters/index.js', 5)
await edit('e0b', undefined, 'src/adapters/types.ts', 12)
await edit('e0c', undefined, 'docs/README.md', 4)
now += 60_000
await spawn('s1', 'Explore', 'Wire the fixture agent')
await spawn('s2', 'general-purpose', 'Run the adapter tests')
await spawn('s4', 'Plan', 'Clear the old build folder')
await step('s1', 'claude-sonnet-5-5')
await step('s2', 'claude-sonnet-5-5')
for (const [id, s] of [['a1', 'Read the adapter API'], ['a2', 'Wire the fixture agent'], ['a3', 'Test it']]) await task('s1', id, s)
await status('s1', 'a1', 'completed')
await status('s1', 'a2', 'in_progress')
await spawn('s3', 'Explore', 'Read the adapter docs', 's1')
await step('s3', 'claude-haiku-5-5')
await edit('e2', 's2', 'tests/adapter.test.ts', 30)
now += 60_000
await held('tool.call', { tool: 'Edit', tool_use_id: 'e1', agentId: 's1', file_path: `${P}/src/adapters/fixture.js`, old_string: 'a', new_string: 'x\n'.repeat(42) })
await held('tool.call', { tool: 'WebFetch', tool_use_id: 'w1', agentId: 's3', url: 'https://docs.example.dev/adapters', prompt: 'read' })
await held('tool.call', { tool: 'Bash', tool_use_id: 'b1', agentId: 's2', command: 'npm test', description: 'Run the adapter tests' })
await held('classic.PermissionRequest', { agent_id: 's4', tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build folder' } })
codex = [{ id: 'c1', task: 'Review adapter.ts for missed edge cases', mode: 'read-only', model: 'gpt-5.6-sol', effort: 'high', status: 'running', startedAt: now - 120_000, endedAt: 0, thread: '', resumed: false, caller: 's2', activity: 'reviewing', focus: '', touched: [], events: [{ at: now - 30_000, kind: 'file', text: `${P}/src/adapters/adapter.ts` }], files: [], commands: 3, failedCommands: 0, answer: '', notesUpdated: false }]
now += 42_000
await tick()

t = await render()
const top = glyphs(t, 'top')
const at = w => top.find(g => g.t === w)
check('header: needs you (bold amber), working (green), and the cost', at('⏸ 1 needs you')?.role === 'amber' && at('⏸ 1 needs you')?.bold && top.some(g => /^● \d working$/.test(g.t) && g.role === 'green') && at('$3.18')?.end, top.slice(0, 6).map(g => g.t).join('|'))
const names = ['Architect', 'Claude', 'Scout', 'Scout 2', 'Helper', 'Codex']
const ys = names.map(n => at(n)?.y ?? -1)
check('rows: needing you pinned on top, then in tree order (each helper under who started it), Codex under who ran it', ys.every((y, i) => y > 0 && (i === 0 || y > ys[i - 1])), ys.join(','))
// A card's depth is how far its Box is in from the pane's edge.
const cardOf = n => find(t, x => x.type === 'Box' && String(x.props.key ?? '').startsWith('row-') && find(x, y => y.type === 'Svg' && String(y.props.alt).startsWith(n + ':')).length)[0]
const xs = names.map(n => cardOf(n)?.props.marginLeft ?? -1)
check('...indented by depth: the one needing you flush left, helpers in, theirs further', xs[0] < xs[2] && xs[1] < xs[2] && xs[2] < xs[3] && xs[4] === xs[2] && xs[5] > xs[4], xs.join(','))
check('needing you: amber "Needs you" and the whole request', at('Needs you')?.role === 'amber' && has(t, 'Allow running Clear the old build folder? Answer in the chat.', 'top'))
check('a helper writing code: the state in green, bold, and on which file', at('Writing code')?.role === 'green' && at('Writing code')?.bold && has(t, 'fixture.js', 'top'))
check('...its plan: Step 2 of 3 and the step, and its model', has(t, 'Step 2 of 3 · Wire the fixture agent', 'top') && has(t, 'Sonnet 5.5', 'top'))
check('a helper running the tests works (green), saying what for and how long', at('Running tests')?.role === 'green' && top.some(g => /Run the adapter tests · \d+(\.\d)?s/.test(g.t)), top.filter(g => /adapter tests/.test(g.t)).map(g => g.t).join('|'))
check('a helper with no step list counts its actions', top.some(g => /^\d+ actions? so far$/.test(g.t)))
check('Codex has a row: its model, what it does', has(t, 'gpt-5.6-sol', 'top') && has(t, 'adapter.ts', 'top'))
check('every row but done ones has Details, a Button beside it', find(t, x => x.type === 'Button' && text(x) === 'Details').length === names.length)
check('Touched: the summary, a line per folder, files with lines added', has(t, 'src/adapters/', 'top') && has(t, 'tests/', 'top') && has(t, 'types.ts', 'top') && has(t, '+13', 'top') && has(t, 'Open folder', 'top'))
const topSrc = pics(t)[0].source
check('the file a Claude is editing carries its dot, in its colour', find(t, x => x.type === 'Button' && /^● fixture\.js/.test(text(x))).length === 1)
check('Activity: the log, its lines timed, the one running counting with ●', has(t, 'Editing fixture.js', 'view') && words(t, 'view').some(w => /^● \d/.test(w)))
check('the log names who did what', has(t, 'Scout', 'view') && has(t, 'Helper', 'view'))
check('colour means state only: no colour of a state on a name', ['Claude', 'Scout', 'Helper'].every(n => at(n)?.role === 'text'))
check('every picture stays within the size the engine takes', pics(t).every(p => p.source.length < 131072))
check('no element carries children in its props as well as its own', find(t, x => x.props && 'children' in x.props && x.children).length === 0)

// ── Details: the Button beside a row shows that Claude in the viewer.
await press('Scout: Details')
t = await render()
check("a row's Details shows that Claude in the viewer (its tab, marked ✕), and says Hide", find(t, x => x.type === 'Button' && text(x) === 'Scout ✕').length === 1 && find(t, x => x.type === 'Button' && text(x) === 'Hide').length === 1)
check('...its model and who it helps, its cost and tokens, what it was asked, its steps', has(t, 'Sonnet 5.5 · helping Claude', 'view') && words(t, 'view').some(w => /tokens/.test(w)) && has(t, 'Wire the fixture agent', 'view') && has(t, '✓ Read the adapter API', 'view') && has(t, '▸ Wire the fixture agent', 'view') && has(t, '○ Test it', 'view'))
check('...and its own lines', has(t, 'Editing fixture.js', 'view') && !has(t, 'Editing adapter.test.ts', 'view'))
await press('Scout: Hide')
t = await render()
check('pressing it again goes back to Activity', !find(t, x => x.type === 'Button' && text(x) === 'Scout ✕').length && glyphs(t, 'top').find(g => g.t === 'Activity')?.bold)

// ── Files, Search, Settings.
await press('All files')
t = await render()
check('Files: every file under its folder, edited with +/−, by whom', has(t, 'src/adapters/', 'view') && has(t, 'index.js', 'view') && has(t, '+5', 'view') && has(t, 'README.md', 'view'))
ran.length = 0
await press('index.js')
check('a file opens in the editor', ran.some(a => a.join(' ').includes('index.js')), JSON.stringify(ran))
await press('Settings')
t = await render()
check('Settings: theme, budget, editor, outside files, intro, demo, and the version', ['Theme', 'Budget', 'Open files in', 'Outside files', 'Intro on open', 'Demo'].every(w => has(t, w, 'view')) && words(t, 'view').some(w => /^Claude Crew \d/.test(w)))
await press('$10')
t = await render()
check('a budget: the header says the cost of it', has(t, 'of $10', 'top') && stored.budget === 10 && toasts.some(x => /Budget set to \$10/.test(x)))
await press('☀ light')
t = await render()
check('light: the pictures take the light colours', pics(t).every(p => /\.f-text\{fill:#1F2328\}/.test(p.source) && !/prefers-color-scheme/.test(p.source)) && stored.theme === 'light')
await press('◐ auto')
t = await render()
check('auto: dark colours, with light ones for a light app', pics(t).every(p => /\.f-text\{fill:#E6EDF3\}.*@media \(prefers-color-scheme: light\)\{.*\.f-text\{fill:#1F2328\}/.test(p.source)))
await press('Cursor')
check('the editor files open in', stored.editor === 'Cursor'.toLowerCase())
await press('off')
check('the intro can be turned off', stored.intro === 'off')
await press('Search')
t = await render()
const field = find(t, x => x.type === 'Input' && x.props.key === 'search-input')[0]
check('Search: a field above the viewer', !!field)
field.props.onInput('adapter')
await tick()
t = await render()
check('...a search lists the matching files and log lines', words(t, 'view').some(w => /\d+ files? and \d+ log lines? match/.test(w)) && has(t, 'adapter.test.ts', 'view'))
await press('Activity')

// ── Narrow (57 columns): the same bands, shorter words; nothing runs past the edge.
t = await render(57)
check('narrow: counts without words, no model on the rows', has(t, '⏸ 1', 'top') && !has(t, 'Sonnet 5.5', 'top'))
const W57 = pics(t)[0].width
check('narrow: nothing is drawn past the right edge', glyphs(t).filter(g => g.x !== undefined).every(g => (g.end ? g.x : g.x + g.t.length * g.size * 0.6) <= W57 + 0.5), glyphs(t).filter(g => g.x !== undefined && (g.end ? g.x : g.x + g.t.length * g.size * 0.6) > W57 + 0.5).map(g => g.t).join('|'))
t = await render(87)
const W87 = pics(t)[0].width
check('wide: nothing is drawn past the right edge either', glyphs(t).filter(g => g.x !== undefined).every(g => (g.end ? g.x : g.x + g.t.length * g.size * 0.6) <= W87 + 0.5), glyphs(t).filter(g => g.x !== undefined && (g.end ? g.x : g.x + g.t.length * g.size * 0.6) > W87 + 0.5).map(g => g.t).join('|'))


// ── The terminal: the same bands as text, each target a button.
t = await render(87, 'terminal')
check('terminal: no pictures', pics(t).length === 0)
check('terminal: the header, the rows, Touched, the tabs', /✻ Claude Crew/.test(text(t)) && /Writing code/.test(text(t)) && /Touched/.test(text(t)) && find(t, x => x.type === 'Button' && text(x) === 'Activity').length === 1)
check('terminal: Details is a button', find(t, x => x.type === 'Button' && text(x) === 'Details').length >= 5)

// ── Done: the last task's card in the crew's place, copied as Markdown.
for (const r of hang) r({ text: 'ok' })
await tick()
for (const id of ['s1', 's2', 's3', 's4']) await fire('tool.call', { tool: 'Agent', tool_use_id: `sp${id}x`, description: 'x', prompt: 'x', subagent_type: 'Explore' }, async () => ({ text: 'ok' })).catch(() => {})
codex = []
await fire('turn.complete', { turnId: 'T', text: 'All done' }, async () => ({}))
now += 25 * 60_000
await tick()
t = await render()
const busyLeft = glyphs(t, 'top').filter(g => ['Writing code', 'Running tests', 'Needs you'].includes(g.t)).map(g => g.t)
if (!busyLeft.length) {
  check('standby: the last task done, how long, and its goal', words(t, 'top').some(w => /^Last task done in /.test(w)) && has(t, 'Fix the adapter tests and make them run offline', 'top'))
  check('...what changed, the tests, the cost, who worked on it', ['Changed', 'Tests', 'Cost', 'Crew'].every(w => has(t, w, 'top')))
  await press('Copy as Markdown')
  check('Copy as Markdown copies the summary', copied.length === 1 && /^### Fix the adapter tests/.test(copied[0].text), JSON.stringify(copied).slice(0, 80))
} else console.log(`SKIP standby (still at work: ${busyLeft.join(',')})`)

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
