// Fixes from the third review and the security audit, each pinned down.
import { XMLValidator } from 'fast-xml-parser'
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const files = {}
const stored = {}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: (ms, fn) => (setTimeout(fn, 0), { cancel() {} }) },
  fs: { read: async p => files[p] ?? '', exists: async p => p in files, write: async () => {} },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => stored[k], set: async (k, v) => { stored[k] = v } },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({}) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
const crew = () => globalThis.__store.get('crew')
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 140 }, viewport: { columns: 140 } })
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const run = (e, result = { text: 'ok' }) => hooks['tool.call']($, { tool_use_id: `c${n++}`, ...e }, async () => result)

// ── The intro plays once per session, not on every reload ──
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
check('the intro plays on the first start', crew() && globalThis.__store.get('intro')?.until > now)
await new Promise(r => setTimeout(r, 5))
globalThis.__store.set('intro', { ...globalThis.__store.get('intro'), until: 0 })
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
check('a reload does not play it again', globalThis.__store.get('intro').until === 0, JSON.stringify(globalThis.__store.get('intro')))
stored.intro = 'off'
await hooks['turn.start']($, { text: 'Work', turnId: 'T' }, async () => ({}))

// ── Test and build detection: by the program that runs ──
const notTests = ['node scripts/build-latest.mjs', 'python fetch_latest.py', 'cat jest.config.js', 'code vitest.config.ts', 'npm install -D jest vitest', 'pip install pytest', 'grep -rn pytest requirements.txt', 'until [ -f build/latest.txt ]; do sleep 2; done', 'mkdir tests', 'test -f package.json']
const tests = ['bash -c "npm test"', 'powershell -Command "npm test"', 'npm t', 'swift test', 'flutter test', 'cat <<EOF > notes.md\nhello\nEOF\npytest t.py', 'echo $((1<<4)) && npm test', 'python -m pytest -q', 'uv run pytest', 'npx vitest run', 'node tests/run.mjs', 'python run_tests.py', 'npm run test:unit', 'until grep -q done tests/runs/out.txt; do sleep 5; done']
for (const cmd of notTests) {
  const before = crew().tests.length
  await run({ tool: 'Bash', command: cmd })
  check(`not a test run: ${cmd.split('\n')[0]}`, crew().tests.length === before)
}
for (const cmd of tests) {
  const id = `test-c${n}`
  await run({ tool: 'Bash', command: cmd }, { text: 'Tests: 2 passed, 2 total' })
  check(`a test run: ${cmd.replace(/\n/g, ' ⏎ ')}`, crew().tests.some(t => t.id === id))
}
// A failing build's problems survive commands that only look like builds.
await run({ tool: 'Bash', command: 'cargo build' }, { text: 'error[E0308]: mismatched types\n  --> src/a.rs:3:5', isError: true })
for (const cmd of ['cat webpack.config.js', 'npm i -D eslint', 'ls node_modules/.bin/tsc']) await run({ tool: 'Bash', command: cmd })
check('cat/install/ls of build tools are not builds (problems kept)', crew().problems.length === 1, String(crew().problems.length))

// ── Precompute is not a compaction ──
const logBefore = crew().log.length
await hooks['session.compact']($, { trigger: 'precompute', messages: [{}, {}] }, async () => ({ messages: [] }))
check('a precompute shows nothing', crew().log.length === logBefore && crew().agents.find(a => a.id === 'main').tool !== '__compact')

// ── Stations: a remote browser is a browser; plugin servers by their own name; markup in a name is escaped ──
let seen
await hooks['tool.call']($, { tool: 'mcp__remote-devices__Claude_Browser__computer', tool_use_id: `c${n++}`, action: 'left_click' }, async () => {
  seen = crew().agents.find(a => a.id === 'main').node
  return { text: 'ok' }
})
check('a remote browser goes to the browser station', seen === '@browser', seen)
check('its action reads cleanly', crew().log.at(-1).text === '◍ browser: computer left click', crew().log.at(-1).text)
await run({ tool: 'mcp__plugin_github_github__create_issue', title: 'x' })
check('a plugin\'s server is named by its own name', crew().nodes['@app:plugin_github_github']?.label === 'GitHub', crew().nodes['@app:plugin_github_github']?.label)
let svg = ''
await hooks['tool.call']($, { tool: 'mcp__evil<b>&"x__run', tool_use_id: `c${n++}` }, async () => {
  svg = find(await render(), x => x.type === 'Svg')[0].props.source
  return { text: 'ok' }
})
check('a server name with markup is escaped in the bubble', XMLValidator.validate(svg) === true && !svg.includes('<b>'))

// ── Import scanning stays fast on hostile files ──
const hostile = `${'   \n'.repeat(80_000)}use crate::a;`
for (const name of ['big.rs', 'big.py']) {
  files[`${P}/src/${name}`] = hostile
  const t0 = performance.now()
  await run({ tool: 'Read', file_path: `${P}/src/${name}` })
  for (let i = 0; i < 200 && !crew().nodes[`${P}/src/${name}`]?.scanned; i++) await new Promise(r => setTimeout(r, 5))
  const ms = performance.now() - t0
  check(`a 320 KB file of blank lines scans fast (${name})`, ms < 500, `${ms.toFixed(0)} ms`)
}

// ── Demo: its tests do not count for the real task; its files and folders are not opened ──
const tree = await render()
find(tree, x => x.type === 'Button' && x.props.key === 'demo')[0]?.props.onPress()
check('the summary base does not count demo failures', (crew().turnBase.failed ?? 0) === 0)
// ── A background task reporting in is not a new goal ──
await hooks['turn.start']($, { text: 'Port the chunk loader', turnId: 'G1' }, async () => ({}))
const goalBefore = crew().agents.find(a => a.id === 'main').goal
await hooks['turn.start']($, { text: '<task-notification> <task-id>bfx</task-id> <summary>Monitor event: "run 12: snapshot"</summary> <event>T100087 | Ada 1555</event></task-notification>', turnId: 'G2' }, async () => ({}))
const mainNow = crew().agents.find(a => a.id === 'main')
check('a task notification keeps the goal', mainNow.goal === goalBefore && goalBefore === 'Port the chunk loader', mainNow.goal)
check('it is logged as a short background-task line', crew().log.some(l => l.text === '↻ background task: Monitor event: "run 12: snapshot"'), crew().log.at(-1)?.text)
check('the task summary base is kept', crew().turnBase.goal === 'Port the chunk loader')
await hooks['turn.start']($, { text: '<system-reminder>x</system-reminder>', turnId: 'G3' }, async () => ({}))
await hooks['tool.call']($, { tool: 'Read', tool_use_id: 'gr1', file_path: `${P}/src/a.rs` }, async () => ({ text: 'ok' }))
globalThis.__store.set('crew', { ...crew(), summary: null })
await hooks['turn.complete']($, { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'G2' }, async () => ({ text: 'ok' }))
check('a notification turn ending makes no task summary', crew().summary === null)
check('a system reminder keeps the goal too', crew().agents.find(a => a.id === 'main').goal === 'Port the chunk loader')
// A goal saved by an older version that is really a notice is not shown.
globalThis.__store.set('crew', { ...crew(), agents: crew().agents.map(a => (a.id === 'main' ? { ...a, goal: '<task-notification><summary>x</summary></task-notification>' } : a)) })
const shownText = JSON.stringify(await render())
check('an old notice goal is not shown', !shownText.includes('task-notification') && shownText.includes('waiting for a prompt'))
/** Buttons, Inputs and Clients inside an absolutely placed Box: the engine gives such a Box's pointer to its parent, so they would never be clicked. */
const underAbsolute = (x, inAbs = false, out = []) => {
  if (!x || typeof x !== 'object') return out
  const abs = inAbs || (x.type === 'Box' && x.props?.position === 'absolute')
  if (abs && (x.type === 'Button' || x.type === 'Client' || x.type === 'Input')) out.push(x.props.key)
  for (const c of x.props?.children ?? []) underAbsolute(c, abs, out)
  return out
}
const drawn = await render()
check('no Button, Input or Client sits in an absolute Box (it would get no clicks)', underAbsolute(drawn).length === 0, underAbsolute(drawn).join(', '))
const panBox = (() => {
  const walk = (x, parent) => {
    if (!x || typeof x !== 'object') return null
    if (x.type === 'Client' && x.props.key === 'pan') return parent
    for (const c of x.props?.children ?? []) {
      const f = walk(c, x)
      if (f) return f
    }
    return null
  }
  return walk(drawn, null)
})()
check('the map\'s pan module is in the layout, pulled up over the picture by its height', !!panBox && panBox.props.position !== 'absolute' && panBox.props.marginTop === -panBox.props.height, JSON.stringify(panBox?.props && { marginTop: panBox.props.marginTop, height: panBox.props.height, position: panBox.props.position }))
// ── Commands in words: the toast and the window never show raw command text ──
{
  const toasts = []
  const realToast = $.ui.toast
  $.ui.toast = async t => { toasts.push(t) }
  let g = 0
  const bash = (command, out, description) => hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'g' + g++, command, description }, async () => ({ text: out }))
  // The command from the screenshot: a Python heredoc that edits files, then the tests.
  await bash("py -3.12 - <<'EOF'\ndef edit(p, old, new):\n    s=open(p).read()\nEOF\npy -3.12 -m unittest discover -s tests", '24 passed')
  const toast = toasts.find(t => t.includes('unittest')) ?? toasts.join(' | ')
  check('a test toast says how it went and what for, in words', toast === '✓ Tests passed (24 passed) · Python tests (unittest): tests', toast)
  check('...never the command or a heredoc', !/py -3|<<|def edit|open\(/.test(toasts.join(' ')), toasts.join(' | '))
  const main = () => crew().agents.find(a => a.id === 'main')
  check('the window names that command by what it runs', main().actions[0] === '$ ran a Python script, unittest', main().actions[0])
  await bash('"$CL" plugin validate crew-map 2>&1 | grep -i "surface"; rm -rf a/b && cp -R c d', 'ok')
  check('a variable program, pipes into grep and paths are left out', main().actions[0] === '$ ran rm, cp', main().actions[0])
  await bash("sed -i 's/a/b/' x.ts && node -e \"console.log(1)\"", 'ok')
  check('inline scripts are named by language', main().actions[0] === '$ ran sed, a Node script', main().actions[0])
  await bash('git status --short && npm run build', 'ok')
  check('tools with subcommands keep them', main().actions[0] === '$ ran git status, npm run build', main().actions[0])
  await bash('cd src && ls', 'ok')
  check('housekeeping is left out when there is work beside it', main().actions[0] === '$ ran ls', main().actions[0])
  await bash('npm test', '41 passed', 'Run the auth unit tests')
  check("Claude's own description wins", main().actions[0] === '$ Run the auth unit tests', main().actions[0])
  check('no action line shows a path, quote or redirect', main().actions.every(x => !/["'>]|\/[a-z]/i.test(x)), main().actions.join(' | '))
  $.ui.toast = realToast
}
// ── Smooth motion: loops keep their phase across draws; a hop is redrawn where it is; paths stay low ──
{
  const realNow = Date.now
  // A clock past the module's own start, however the suite's fixed clock sits against it.
  let t = Math.max(realNow(), Date.parse('2031-01-01T00:00:00'))
  Date.now = () => t
  const svgNow = async () => find(await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 140 }, viewport: { columns: 140 } }), x => x.type === 'Svg')[0].props.source
  const go = (p, during) => hooks['tool.call']($, { tool: 'Read', tool_use_id: 'm' + Math.random(), file_path: p }, async () => { if (during) await during(); return { text: 'ok' } })
  await go(P + '/src/m1.ts')
  t += 5000
  let d1 = '', d2 = ''
  await go(P + '/src/m2.ts', async () => { t += 200; d1 = await svgNow(); t += 300; d2 = await svgNow() })
  check('looping animations take their phase from the clock the picture is shown at', /animation-delay:calc\(-1s \* var\(--clk, 0\)/.test(d1) && !/infinite;?[^"]*?-?\d+\.\d+s infinite/.test(d1))
  check('...which each draw sets on the picture', /^<svg[^>]*style="--clk:\d+\.\d{2}"/.test(d1) && d1.match(/--clk:([\d.]+)/)[1] !== d2.match(/--clk:([\d.]+)/)[1])
  const begins = src => [...src.matchAll(/<animateMotion [^>]*begin="(-?[\d.]+)s"/g)].map(m => Number(m[1]))
  check('a hop drawn again mid-flight continues from where it is (not replayed)', begins(d1).length > 0 && Math.abs(begins(d2)[0] - begins(d1)[0] + 0.3) < 0.011, JSON.stringify([begins(d1), begins(d2)]))
  const path = d1.match(/<animateMotion path="M(-?[\d.]+) (-?[\d.]+)C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/)?.slice(1).map(Number)
  check('a hop across rises only a little over its higher end', !!path && Math.min(path[1], path[7]) - Math.min(path[3], path[5]) <= 60, JSON.stringify(path))
  Date.now = realNow
}
console.log(`\n${fails} failing check(s)`)
