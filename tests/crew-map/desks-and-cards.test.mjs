// The default picture of the work: desks on top (one per Claude at work, what it is on now and
// before), folder cards below (each folder the work touched, its files as chips that open them).
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
const ran = []
let codexRuns = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: codexRuns }) },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Fix the login flow', turnId: 'T' }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = (cols = 150) => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 50 } }, viewport: { columns: cols } }, async () => ({}))
const byKey = (tree, key) => find(tree, x => x.props?.key === key)[0]
const press = async (tree, key) => { const b = byKey(tree, key); if (!b) throw new Error(`no ${key}`); await b.props.onPress(); await new Promise(r => setTimeout(r, 5)) }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const call = (tool, input, during, result = { text: 'ok' }, more = {}) => fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input, ...more }, async () => { if (during) await during(); return result })

// Work across folders: reads, an edit, a helper, a file with errors, a file outside the project.
for (const f of ['src/api/token.ts', 'src/api/client.ts', 'src/hooks/useAuth.ts', 'docs/guide.md']) await call('Read', { file_path: `${P}/${f}` })
await call('Edit', { file_path: `${P}/src/api/token.ts`, old_string: 'a', new_string: 'b\nc\nd' })
await call('Read', { file_path: 'C:/other/notes.md' })
await fire('agent.spawn', { tool_use_id: 'sp', prompt: 'Run the tests', description: 'Tester', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
let tree
await call('Read', { file_path: `${P}/tests/auth.test.ts` }, async () => { tree = await render() }, { text: 'ok' }, { agentId: 'sub1' })

// ── The default view ──
check('desks and folder cards are the default (no map picture, no map hands)', !!byKey(tree, 'desks') && !!byKey(tree, 'cards') && !byKey(tree, 'pan') && !find(tree, x => x.type === 'Svg' && String(x.props.alt).startsWith('Map')).length)
{
  const desks = kids(byKey(tree, 'desks'))
  const helper = desks.find(d => text(d).includes(crew().agents.find(a => a.id === 'sub1').name))
  check('a desk per Claude at work: the main one and the helper', desks.length === 2 && !!helper, desks.map(d => text(d).slice(0, 30)).join(' | '))
  check("the helper's desk shows the file it is on, and its folder", /auth\.test\.ts/.test(text(helper)) && /tests/.test(text(helper)), text(helper))
  check('each desk has a little animated sprite', find(helper, x => x.type === 'Svg').length === 1 && /@keyframes bob/.test(find(helper, x => x.type === 'Svg')[0].props.source))
  check('desks are all the same height (four rows under the border)', desks.every(d => kids(d).length === 4))
  // Rows a desk takes: its first line is the sprite beside two lines of text, then one row each, and a border.
  const rowsOfDesk = d => kids(d).reduce((n, line) => n + (line.type === 'Box' ? Math.max(...kids(line).map(k => (k.type === 'Box' ? kids(k).length : k.type === 'Svg' ? Math.ceil(k.props.height / 19) : 1))) : 1), 0) + 2
  const area = byKey(tree, 'desks')
  check('the desks area never clips a desk: no fixed height, nothing hidden', area.props.height === undefined && area.props.overflow !== 'hidden', JSON.stringify({ height: area.props.height, overflow: area.props.overflow }))
  check('...and it keeps room for a whole desk (seven rows)', rowsOfDesk(desks[0]) === 7 && area.props.minHeight >= 7, `desk ${rowsOfDesk(desks[0])} rows, room ${area.props.minHeight}`)
  const main = desks.find(d => text(d).includes('Claude'))
  check("the main desk says what came before", /before: .*(token|client|useAuth|guide)/.test(text(main)), text(main))
}
{
  const cards = kids(byKey(tree, 'cards'))
  const names = cards.map(c => text(kids(c)[0]))
  check('a card per folder the work touched, in the order it first reached them', names.length === 5 && /src\/api/.test(names[0]) && /src\/hooks/.test(names[1]) && /docs/.test(names[2]) && /outside/.test(names[3]) && /tests/.test(names[4]), names.join(' | '))
  const api = cards[0]
  check('a card counts its files and edits', /2 files · 1 edited/.test(text(api)), text(api))
  const chip = byKey(api, `file:${P}/src/api/token.ts`)
  check('an edited file is a green chip with its line counts', !!chip && /token\.ts \+3−1/.test(text(chip)) && find(chip, x => x.type === 'Text' && x.props.color === '#3FB950').length >= 1, chip && text(chip))
  const testChip = byKey(cards[4], `file:${P}/tests/auth.test.ts`)
  check('the file a Claude is on carries its coloured dot', !!testChip && /^● /.test(text(testChip)))
}
ran.length = 0
await press(tree, `file:${P}/src/api/client.ts`)
check('clicking a chip opens the file', ran.some(a => a.join(' ').endsWith(`code -g ${P}/src/api/client.ts`)), JSON.stringify(ran))
ran.length = 0
await press(tree, 'dir:src/api')
check("clicking a card's folder opens it in the file manager", ran.some(a => a[0] === 'explorer' && /src\\api$/.test(a[1])), JSON.stringify(ran))

// ── Waiting on you, on the desk ──
await call('Bash', { command: 'rm -rf build' }, async () => {
  await fire('classic.PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build folder' } }, async () => ({}))
  tree = await render()
})
{
  const main = kids(byKey(tree, 'desks')).find(d => text(d).includes('waiting on you'))
  check('a Claude waiting on you: its desk turns amber and says what for', !!main && main.props.borderColor === '#E3B341' && /Clear the old build folder/.test(text(main)), main && text(main))
  check('...and its sprite shows a "!"', !!main && /fill="#E3B341"\/><text[^>]*>!<\/text>/.test(find(main, x => x.type === 'Svg')[0].props.source))
}

// ── Many files: a card shows ten, then "+N more" opens it ──
for (let i = 0; i < 14; i++) await call('Read', { file_path: `${P}/src/api/extra_${String(i).padStart(2, '0')}.ts` })
tree = await render()
{
  const api = kids(byKey(tree, 'cards'))[0]
  check('a full card shows ten chips and "+N more"', find(api, x => x.type === 'Button' && String(x.props.key).startsWith('file:')).length === 10 && /\+6 more/.test(text(api)), text(api).slice(0, 80))
  await press(tree, 'more:src/api')
  tree = await render()
  const open = kids(byKey(tree, 'cards'))[0]
  check('"+N more" shows them all, and "▴ fewer" folds it back', find(open, x => x.type === 'Button' && String(x.props.key).startsWith('file:')).length === 16 && /▴ fewer/.test(text(open)))
}

// ── Outside the project: hide and bring back ──
await press(tree, 'hide-outside')
tree = await render()
check('"✕ hide" takes the outside card away, and the toolbar counts it', !kids(byKey(tree, 'cards')).some(c => /outside/.test(text(kids(c)[0]))) && /1 hidden/.test(text(byKey(tree, 'show-outside'))))
await press(tree, 'show-outside')
tree = await render()
check('...and brings it back', kids(byKey(tree, 'cards')).some(c => /outside/.test(text(kids(c)[0]))))

// ── Search: only matching files and the folders holding them ──
await fire('ui.message', { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'search', module: './search.tsx', data: { q: 'auth' } }, async () => ({}))
tree = await render()
{
  const cards = kids(byKey(tree, 'cards'))
  check('a search keeps only the folders with a match, and only matching chips', cards.length === 2 && cards.every(c => find(c, x => x.type === 'Button' && String(x.props.key).startsWith('file:')).every(b => /auth/i.test(b.props.key))), cards.map(c => text(c).slice(0, 40)).join(' | '))
  check('...and the toolbar counts the matches', /2 matches/.test(text(tree)))
}
await fire('ui.message', { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'search', module: './search.tsx', data: { q: '' } }, async () => ({}))

// ── Codex at a desk of its own while it runs ──
codexRuns = [{ id: 'r1', task: 't', mode: 'write', root: P, cwd: P, model: 'm', effort: 'e', status: 'running', startedAt: now - 10_000, endedAt: 0, thread: 'auth', resumed: false, caller: 'main', activity: 'Running tests', focus: '', touched: [], events: [{ at: now - 4000, kind: 'cmd', text: 'bash -lc "cargo test chunk"', ok: undefined }], files: [], commands: 1, failedCommands: 0, answer: '', notesUpdated: false }]
tree = await render()
check('a running Codex has a desk, saying what it runs', /Codex · auth[\s\S]*cargo test/.test(text(byKey(tree, 'desks'))), text(byKey(tree, 'desks')).slice(-120))
codexRuns = []

// ── The tree map is one click away, and back ──
await press(tree, 'view-map')
tree = await render()
check('"⊞ tree map" shows the map with its hands', crew().view === 'map' && !!byKey(tree, 'pan') && !byKey(tree, 'desks'))
await press(tree, 'view-desks')
tree = await render()
check('"▤ desks" brings the desks back', (crew().view ?? 'desks') === 'desks' && !!byKey(tree, 'desks') && !byKey(tree, 'pan'))

// ── Narrow and wide panes: cards one, two or three across, nothing wider than the pane ──
for (const cols of [60, 120, 200]) {
  const t = await render(cols)
  const cards = kids(byKey(t, 'cards'))
  const per = cols >= 170 ? 3 : cols >= 100 ? 2 : 1
  check(`${cols} cols: ${per} card${per > 1 ? 's' : ''} across, each within the pane`, cards.every(c => c.props.width * per + (per - 1) <= cols), cards.map(c => c.props.width).join(','))
}
// An empty session says where folders will appear.
globalThis.__store.set('crew', { ...crew(), nodes: {}, changes: {} })
check('with no files yet, the cards say where folders will appear', /No files yet/.test(text(byKey(await render(), 'cards'))))
console.log(`\n${fails} failing check(s)`)
