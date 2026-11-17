// The crew in different kinds of work: MCP apps, the browser, the PC (here and remote), documents,
// research, compaction, each said plainly on its row; honest progress; short actions; no false test
// runs; files opened by a click, never through cmd for a path it would misread.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const { lines, words, glyphs, makePress } = await import('./kit.mjs')
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
  model: { complete: async () => { throw new Error('the pane must not call a model') } },
  store: { get: async k => (k === 'theme' ? 'dark' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => { throw new Error('no codex-bridge here') } },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
await hooks['turn.start']($, { text: 'Build the level in Blender, check the docs site, and write the guide', turnId: 'T' }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const main = () => crew().agents.find(a => a.id === 'main')
const render = () => hooks['ui.render']($, { surface: 'terminal', props: { bodyColumns: 150 }, viewport: { columns: 150 } })
const press = makePress(elements, render, () => new Promise(r => setTimeout(r, 10)))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
/** The main Claude's row: what its first line says it is doing (the bold words after its name). */
const statusOf = tree => {
  const l = lines(tree, 'top').find(l => l.some(g => g.t === 'Claude'))
  return l?.find(g => g.bold && g.t !== 'Claude')?.t
}
/** Runs a tool call and reports what the Claude looked like while it ran. */
const during = async (e, result = { text: 'ok' }) => {
  let seen
  await hooks['tool.call']($, { tool_use_id: `c${n++}`, ...e }, async () => {
    now += 1000
    const tree = await render()
    seen = { node: main().node, status: statusOf(tree), all: words(tree).join(' | ') }
    return result
  })
  return seen
}

// ── Kinds of work, each said on the row ──
let s = await during({ tool: 'mcp__blender__execute_blender_code', code: 'bpy.ops.mesh.primitive_cube_add()' })
check('an MCP app is a place of its own, named', s.node === '@app:blender', s.node)
check('its row says which app', s.status === 'Using Blender', s.status)
check('the code it sent is not printed', !crew().log.some(l => l.text.includes('primitive_cube_add')) && !s.all.includes('primitive_cube_add'))
s = await during({ tool: 'mcp__Roblox_Studio__script_read', path: 'game.Workspace.Script' })
check('two-word app names read naturally', s.status === 'Using Roblox Studio', s.status)
s = await during({ tool: 'mcp__Claude_Browser__navigate', url: 'https://docs.example.com/guide/' })
check('the browser: Browsing', s.node === '@browser' && s.status === 'Browsing', `${s.node} ${s.status}`)
check('the log says where it browsed', crew().log.some(l => l.text === '◍ browser: navigate docs.example.com/guide'), crew().log.map(l => l.text).slice(-2).join(' | '))
s = await during({ tool: 'mcp__claude-in-chrome__computer', action: 'left_click', coordinate: [1, 2] })
check('Claude in Chrome counts as the browser', s.node === '@browser' && s.status === 'Browsing', s.status)
s = await during({ tool: 'mcp__computer-use__open_application', app: 'Notepad' })
check('computer use is "Using the PC", with the app it opened in the log', s.node === '@computer' && s.status === 'Using the PC' && crew().log.some(l => l.text.includes('this PC: open application Notepad')), s.status)
s = await during({ tool: 'mcp__computer-use__type', text: 'my secret password' })
check('what it types is never shown', !JSON.stringify(crew()).includes('my secret password') && !s.all.includes('my secret password'))
s = await during({ tool: 'mcp__remote-devices__computer_screenshot' })
check('a remote PC is its own', s.node === '@remote' && s.status === 'Using the remote PC', s.status)
s = await during({ tool: 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch', container: {} })
check('a docs connector: Writing a document', s.node === '@docs' && s.status === 'Writing a document', s.status)
s = await during({ tool: 'Write', file_path: `${P}/docs/GUIDE.md`, content: '# Guide' })
check('writing a .md file reads as writing docs', s.status === 'Writing docs', s.status)
s = await during({ tool: 'Edit', file_path: `${P}/src/level.ts`, old_string: 'a', new_string: 'b' })
check('...and code as writing code', s.status === 'Writing code', s.status)
s = await during({ tool: 'Read', file_path: `${P}/art/level.png` })
check('reading an image reads as viewing it', s.status === 'Viewing an image', s.status)
s = await during({ tool: 'WebSearch', query: 'voxel meshing greedy' })
check('web search is researching', s.node === '@web' && s.status === 'Researching', s.status)
s = await during({ tool: 'Bash', command: 'npm run build', description: 'Build the level' })
check('a build reads as building', s.status === 'Building', s.status)
s = await during({ tool: 'mcp__ccd_session__mark_chapter', title: 'x' })
check("the app's own controls: Using the app", s.node === '@claude' && s.status === 'Using the app', s.status)

// ── Compaction ──
let mid
await hooks['session.compact']($, { trigger: 'auto', messages: Array.from({ length: 120 }, () => ({})) }, async () => {
  const tree = await render()
  mid = { state: main().state, tool: main().tool, status: statusOf(tree) }
  return { messages: [{}, {}] }
})
check('compacting shows on the Claude', mid.state === 'busy' && mid.tool === '__compact' && mid.status === 'Compacting', JSON.stringify(mid))
check('the log says how much it compacted', crew().log.some(l => l.text === '🗜 compacted: 120 → 2 messages'))
check('after compacting it is back to thinking', main().state === 'thinking' && main().tool !== '__compact', main().state)

// ── Honest progress, short lines ──
let tree = await render()
check('no made-up percentage anywhere, and without a list it counts actions', !words(tree).some(w => /\d+%/.test(w)) && words(tree, 'top').some(w => /^\d+ actions so far$/.test(w)), words(tree, 'top').join(' | ').slice(0, 200))
await hooks['tool.call']($, { tool: 'TodoWrite', tool_use_id: `c${n++}`, todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress', activeForm: 'Doing b' }] }, async () => ({ text: 'ok' }))
tree = await render()
check('a to-do list gives the real step', words(tree, 'top').includes('Step 2 of 2 · Doing b'), words(tree, 'top').join(' | ').slice(0, 200))
const wall = `mkdir -p harness; { echo "const atom=(...a:any)=>a;"; echo "type Crew=any; tests and more tests"; } > harness/h.ts && node --version && ${'x'.repeat(1500)}`
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `c${n++}`, command: wall, description: 'Build a small test harness for the map' }, async () => ({ text: 'ok' }))
check('a long command reads as what Claude said it does', main().actions[0] === '▸ Build a small test harness for the map', main().actions[0])
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

// ── Clicks open what they name ──
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/src/world/chunk.rs` }, async () => ({ text: 'ok' }))
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/src/world/gen.rs` }, async () => ({ text: 'ok' }))
await press('All files')
ran.length = 0
toasts.length = 0
await press('chunk.rs')
check('a file in Files opens in the editor', ran.some(a => a.join(' ').endsWith(`code -g ${P}/src/world/chunk.rs`)), JSON.stringify(ran))
await press('Open folder')
check('Open folder opens the project', ran.some(a => a[0] === 'explorer' && a[1] === 'C:\\work\\game'), JSON.stringify(ran))
check('every click says what it opens', toasts.includes('Opening chunk.rs…') && toasts.includes('Opening the project folder in the file manager…'), toasts.join(' | '))
// A path cmd would misread opens through Explorer, never cmd.
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/R&D/x&calc.ts` }, async () => ({ text: 'ok' }))
ran.length = 0
await press('x&calc.ts')
check('a path with & never reaches cmd', ran.length === 1 && ran[0][0] === 'explorer' && !ran.some(a => a.includes('cmd')), JSON.stringify(ran))
check('the pane draws without codex-bridge', !!(await render()))
// A launch that fails says why.
const realRun = $.process.run
$.process.run = async () => { throw new Error('spawn code ENOENT') }
toasts.length = 0
await press('gen.rs')
$.process.run = realRun
check('a failed open says why', toasts.some(t => t.startsWith("Couldn't open gen.rs: spawn code ENOENT")), toasts.join(' | '))
console.log(`\n${fails} failing check(s)`)
