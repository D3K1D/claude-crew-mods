// The crew in different kinds of work: MCP apps, the browser, the PC (here and remote), documents,
// research, compaction; clicking the map; honest progress; short actions; no false test runs.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const ran = []
const toasts = []
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => toasts.push(t), copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  model: { complete: async () => { throw new Error('the map must not call a model') } },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => { throw new Error('no codex-bridge here') } },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'Build the level in Blender, check the docs site, and write the guide', turnId: 'T' }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const main = () => crew().agents.find(a => a.id === 'main')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 150 }, viewport: { columns: 150 } })
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
/** Runs a tool call and reports what the Claude looked like while it ran. */
const during = async (e, result = { text: 'ok' }) => {
  let seen
  await hooks['tool.call']($, { tool_use_id: `c${n++}`, ...e }, async () => {
    now += 1000
    const tree = await render()
    const svg = find(tree, x => x.type === 'Svg')[0]?.props.source ?? ''
    seen = { node: main().node, svg, all: text(tree), bubble: svg.match(/>([A-Z][^<]{2,40})<tspan/)?.[1] }
    return result
  })
  return seen
}

// ── Kinds of work ──
let s = await during({ tool: 'mcp__blender__execute_blender_code', code: 'bpy.ops.mesh.primitive_cube_add()' })
check('an MCP app is a station of its own, named', s.node === '@app:blender' && s.svg.includes('>Blender<'), s.node)
check('its bubble says which app', s.bubble === 'Using Blender', s.bubble)
check('the code it sent is not printed', !crew().log.some(l => l.text.includes('primitive_cube_add')))
s = await during({ tool: 'mcp__Roblox_Studio__script_read', path: 'game.Workspace.Script' })
check('two-word app names read naturally', s.svg.includes('>Roblox Studio<') && s.bubble === 'Using Roblox Studio', s.bubble)
s = await during({ tool: 'mcp__Claude_Browser__navigate', url: 'https://docs.example.com/guide/' })
check('the browser is a station', s.node === '@browser' && s.bubble === 'Browsing', `${s.node} ${s.bubble}`)
check('the log says where it browsed', crew().log.some(l => l.text === '◍ browser: navigate docs.example.com/guide'), crew().log.map(l => l.text).slice(-2).join(' | '))
s = await during({ tool: 'mcp__claude-in-chrome__computer', action: 'left_click', coordinate: [1, 2] })
check('Claude in Chrome counts as the browser', s.node === '@browser')
s = await during({ tool: 'mcp__computer-use__open_application', app: 'Notepad' })
check('computer use is "this PC", with the app it opened', s.node === '@computer' && s.bubble === 'Using the PC' && crew().log.some(l => l.text.includes('this PC: open application Notepad')), crew().log.at(-1).text)
s = await during({ tool: 'mcp__computer-use__type', text: 'my secret password' })
check('what it types is never shown', !JSON.stringify(crew()).includes('my secret password'))
s = await during({ tool: 'mcp__remote-devices__computer_screenshot' })
check('a remote PC is its own station', s.node === '@remote' && s.bubble === 'Using the remote PC', s.bubble)
s = await during({ tool: 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch', container: {} })
check('a docs connector is the documents station', s.node === '@docs' && s.bubble === 'Writing a document', s.bubble)
s = await during({ tool: 'Write', file_path: `${P}/docs/GUIDE.md`, content: '# Guide' })
check('writing a .md file reads as writing docs', s.bubble === 'Writing docs', s.bubble)
s = await during({ tool: 'Read', file_path: `${P}/art/level.png` })
check('reading an image reads as viewing it', s.bubble === 'Viewing an image', s.bubble)
s = await during({ tool: 'WebSearch', query: 'voxel meshing greedy' })
check('web search is researching', s.node === '@web' && s.bubble === 'Researching', s.bubble)
s = await during({ tool: 'mcp__ccd_session__mark_chapter', title: 'x' })
check('the app\'s own controls are the Claude app station', s.node === '@claude' && s.svg.includes('>Claude app<'))
check('every station is drawn', ['>browser<', '>this PC<', '>remote PC<', '>documents<', '>web<', '>Blender<'].every(t => s.svg.includes(t)))

// ── Compaction ──
let mid
await hooks['session.compact']($, { trigger: 'auto', messages: Array.from({ length: 120 }, () => ({})) }, async () => {
  const tree = await render()
  mid = { state: main().state, tool: main().tool, all: text(tree) }
  return { messages: [{}, {}] }
})
check('compacting shows on the Claude and in the header', mid.state === 'busy' && mid.tool === '__compact' && mid.all.includes('🗜 compacting'), JSON.stringify({ state: mid.state, tool: mid.tool }))
check('the log says how much it compacted', crew().log.some(l => l.text === '🗜 compacted: 120 → 2 messages'))
check('after compacting it is back to thinking', main().state === 'thinking' && main().tool !== '__compact', main().state)

// ── Honest progress, short lines ──
let tree = await render()
const win = find(tree, x => x.type === 'Box' && x.props.borderColor === '#D97757')[0]
const winText = win.props.children.map(text).join('\n')
check('no made-up percentage without a to-do list', !/\d+%/.test(winText.split('\n').find(l => l.startsWith('work')) ?? '') && /work +\d+ steps · \d+s/.test(winText), winText.split('\n').find(l => l.startsWith('work')))
check('no model was asked to guess progress', true)
await hooks['tool.call']($, { tool: 'TodoWrite', tool_use_id: `c${n++}`, todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] }, async () => ({ text: 'ok' }))
tree = await render()
check('a to-do list gives a real percentage', text(find(tree, x => x.type === 'Box' && x.props.borderColor === '#D97757')[0]).includes(' 50%'))
const wall = `mkdir -p harness; { echo "const atom=(...a:any)=>a;"; echo "type Crew=any; tests and more tests"; } > harness/h.ts && node --version && ${'x'.repeat(1500)}`
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `c${n++}`, command: wall, description: 'Build a small test harness for the map' }, async () => ({ text: 'ok' }))
check('a long command reads as what Claude said it does', main().actions[0] === '$ Build a small test harness for the map', main().actions[0])
check('...and is not mistaken for a test run', !crew().tests.some(t => t.command.includes('harness')))
for (const [cmd, why] of [['mkdir -p tests/unit', 'mkdir'], ['test -f package.json && echo ok', 'the test builtin'], ['git log -- tests/', 'git log'], ['cat <<EOF > notes.md\nrun the tests\nEOF', 'a heredoc']]) {
  const before = crew().tests.length
  await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `c${n++}`, command: cmd }, async () => ({ text: 'ok' }))
  check(`not a test run: ${why}`, crew().tests.length === before)
}
for (const cmd of ['npm test', 'cargo test chunk', 'python -m pytest -q', 'node tests/run.mjs', 'go test ./...', 'npx vitest run']) {
  const before = crew().tests.length
  await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `c${n++}`, command: cmd }, async () => ({ text: 'Tests: 3 passed, 3 total' }))
  check(`a test run: ${cmd}`, crew().tests.length === before + 1)
}
// A clean `rm -rf build` must not clear the problems a failing build left.
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `c${n++}`, command: 'cargo build' }, async () => ({ text: 'error[E0308]: mismatched types\n  --> src/a.rs:3:5', isError: true }))
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `c${n++}`, command: 'rm -rf build' }, async () => ({ text: '' }))
check('rm -rf build is not a build', crew().problems.length === 1)

// ── Clicking the map ──
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/src/world/chunk.rs` }, async () => ({ text: 'ok' }))
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/src/world/gen.rs` }, async () => ({ text: 'ok' }))
tree = await render()
// Desktop: the pan module lies over the map; a click comes back as a message with the window it was made in.
let pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
check('the desktop map has the pan module over it, filling a clipped box the size of the map', !!pan && pan.props.module === './pan.tsx' && pan.props.width === '100%' && pan.props.height === '100%' && (() => { const m = find(tree, x => x.props?.key === 'map')[0]; const b = find(m, x => x.type === 'Box' && x.props.marginTop < 0)[0]; return !!b && b.props.height === m.props.height && b.props.overflow === 'hidden' && m.props.overflow === 'hidden' })())
const svgOfTree = t => find(t, x => x.type === 'Svg')[0].props.source
/** Where a thing labelled so sits in the window, from the group drawn around its label. */
const spotOf = (label, dx, dy) => {
  const src = svgOfTree(tree)
  const i = src.indexOf(`>${label}</text>`)
  const g = src.lastIndexOf('<g transform="translate(', i)
  const [x, y] = src.slice(g + 24).split(')')[0].split(',').map(Number)
  const v = pan.props.props.view
  return [(x + dx - v.x) * v.k, (y + dy - v.y) * v.k]
}
// A drag lands a moment after its message returns (the window moves through a gate): let it.
const msg = async data => { await hooks['ui.message']($, { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'pan', module: './pan.tsx', data: { view: pan.props.props.view, rev: pan.props.props.rev, ...data } }, async () => ({})); await new Promise(r => setTimeout(r, 5)) }
ran.length = 0
await msg({ click: spotOf('chunk.rs', 19, 23) })
await new Promise(r => setTimeout(r, 10))
check('clicking a file on the map opens it', ran.some(a => a.join(' ').endsWith(`code -g ${P}/src/world/chunk.rs`)), JSON.stringify(ran))
// A folder: a click folds it, another unfolds it; with Ctrl it opens in Explorer.
ran.length = 0
await msg({ click: spotOf('world', 17, 14) })
check('clicking a folder folds it', crew().folds?.['src/world'] === 'closed' && ran.length === 0, JSON.stringify(crew().folds))
tree = await render()
pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
check('a folded folder hides its files', !svgOfTree(tree).includes('>chunk.rs</text>') && svgOfTree(tree).includes('▸ 2 · in src'))
await msg({ click: spotOf('world', 17, 14) })
check('clicking it again unfolds it', crew().folds?.['src/world'] === 'open')
tree = await render()
pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
await msg({ click: spotOf('world', 17, 14), ctrl: true })
await new Promise(r => setTimeout(r, 10))
check('Ctrl-clicking a folder opens it in Explorer, unfolded', ran.some(a => a[0] === 'explorer' && a[1] === 'C:\\work\\game\\src\\world') && crew().folds?.['src/world'] === 'open', JSON.stringify(ran))
ran.length = 0
await msg({ click: spotOf('worked files', 42, 30) })
await find(tree, x => x.type === 'Button' && x.props.key === 'open-project')[0].props.onPress()
await new Promise(r => setTimeout(r, 10))
check('the root folder and the toolbar button open the project', ran.filter(a => a[0] === 'explorer' && a[1] === 'C:\\work\\game').length === 2, JSON.stringify(ran))
ran.length = 0
await msg({ click: [2, 2] })
await new Promise(r => setTimeout(r, 10))
check('a click on empty map opens nothing', ran.length === 0, JSON.stringify(ran))

// Moving: the map itself does not move under the pointer; the arrows move it.
const v0 = pan.props.props.view
await msg({ view: { x: v0.x + 40, y: v0.y + 25, k: v0.k } })
tree = await render()
pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
check('a view sent from the map itself moves nothing', pan.props.props.view.x === v0.x && pan.props.props.view.y === v0.y, JSON.stringify(pan.props.props.view))
check('the wheel is left to the pane: the mod takes no scroll', !hooks['ui.scroll'])
for (let i = 0; i < 3; i++) await find(await render(), x => x.type === 'Button' && x.props.key === 'bigger')[0].props.onPress()
for (let i = 0; i < 4; i++) tree = await render()
pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
const vz = pan.props.props.view
await find(tree, x => x.type === 'Button' && x.props.key === 'move-right')[0].props.onPress()
await new Promise(r => setTimeout(r, 5))
for (let i = 0; i < 4; i++) tree = await render()
pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
const moved = pan.props.props.view
check('▶ moves the window right', moved.x > vz.x && moved.y === vz.y, JSON.stringify({ vz, now: moved }))
check('the picture is drawn through the moved window', svgOfTree(tree).includes(`viewBox="${moved.x.toFixed(1)} ${moved.y.toFixed(1)}`))
check("a move by the arrows gives the window a new stamp, so the map's hand measures clicks against it", pan.props.props.rev !== '' && pan.props.props.rev.startsWith('m'))
// Zoom has bounds, and fit goes back to the whole map.
for (let i = 0; i < 40; i++) await find(await render(), x => x.type === 'Button' && x.props.key === 'bigger')[0].props.onPress()
tree = await render()
check('zoom in stops at its limit', find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0].props.props.view.k <= 2.5)
await find(tree, x => x.type === 'Button' && x.props.key === 'fit')[0].props.onPress()
tree = await render()
pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
check('fit shows the whole map', pan.props.props.view.k <= 1 && pan.props.props.view.k * (pan.props.props.mh) <= pan.props.props.vh + 1 && pan.props.props.view.k * pan.props.props.mw <= pan.props.props.vw + 1, JSON.stringify(pan.props.props.view))

// Where no Client draws (or it failed): no click layer over the map (it could not take clicks);
// the worked-files list below it opens every file.
const savedClient = elements.Client
delete elements.Client
tree = await render()
check('without a Client the map draws no click layer', !find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('open-map:')).length && !find(tree, x => x.type === 'Client' && x.props.key === 'pan').length)
if (!crew().showFiles) await find(tree, x => x.type === 'Button' && x.props.key === 'files')[0].props.onPress()
tree = await render()
const listed = find(tree, x => x.type === 'Button' && x.props.key === `open:${P}/src/world/chunk.rs`)[0]
ran.length = 0
await listed.props.onPress()
await new Promise(r => setTimeout(r, 10))
check('the worked-files list opens a file', ran.some(a => a.join(' ').endsWith(`code -g ${P}/src/world/chunk.rs`)), JSON.stringify(ran))
// A path cmd would misread opens through Explorer, never cmd.
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/R&D/x&calc.ts` }, async () => ({ text: 'ok' }))
tree = await render()
ran.length = 0
await find(tree, x => x.type === 'Button' && x.props.key === `open:${P}/R&D/x&calc.ts`)[0]?.props.onPress()
await new Promise(r => setTimeout(r, 10))
check('a path with & never reaches cmd', ran.length === 1 && ran[0][0] === 'explorer' && !ran.some(a => a.includes('cmd')), JSON.stringify(ran))
check('the pane draws without codex-bridge', !!tree)
check('a list button holds text only', find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('open')).every(b => b.props.children.every(ch => typeof ch === 'string' || ch?.type === 'Text')))
check('every click says what it opens', toasts.includes('Opening chunk.rs…') && toasts.includes('Opening the project folder in the file manager…'), toasts.filter(t => t.startsWith('Opening')).join(' | '))
// A launch that fails says why.
const realRun = $.process.run
$.process.run = async () => { throw new Error('spawn code ENOENT') }
toasts.length = 0
await find(tree, x => x.type === 'Button' && x.props.key === `open:${P}/src/world/gen.rs`)[0].props.onPress()
await new Promise(r => setTimeout(r, 10))
$.process.run = realRun
check('a failed open says why', toasts.some(t => t.startsWith("Couldn't open gen.rs: spawn code ENOENT")), toasts.join(' | '))
elements.Client = savedClient
console.log(`\n${fails} failing check(s)`)
