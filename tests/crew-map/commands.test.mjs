// Live shell commands: the running line (always in its spot, one row) names the commands running now (who, what in words, how long, ◌ in the background). A quick command never flashes up; a foreground one shows after two seconds and goes
// when it returns; a background one stays until its output is read, it is stopped, or the app says
// it finished. Test runs show in it too, marked ⚗. Codex's running command shows too. The map's terminal
// counts them, and one nobody hears of again is let go after six hours.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const ticks = []
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
let codexRuns = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: (ms, fn) => (ticks.push(fn), { cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: codexRuns }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'Get the dev server up', turnId: 'T' }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 140 }, viewport: { columns: 140 } })
// The running box, when something runs in it (it is always drawn, saying "nothing running" when idle).
const runningBox = async () => find(await render(), x => x.type === 'Box' && x.props.key === 'running')[0]
const box = async () => { const b = await runningBox(); return b && !text(b).includes('nothing running') ? b : undefined }
const mapSvg = async () => find(await render(), x => x.type === 'Svg')[0].props.source
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const bash = (command, during, result, more = {}) =>
  hooks['tool.call']($, { tool: 'Bash', tool_use_id: `b${n++}`, command, ...more }, async () => {
    if (during) await during()
    return result
  })

// A quick command: never shown.
let seenQuick
await bash('ls src', async () => { now += 300; seenQuick = await box() }, { text: 'a.ts' })
check('a quick command never flashes up', !seenQuick)

// A long one in the foreground: shown after two seconds, with what it is and a timer; gone when it returns.
let during
await bash('cargo build --release 2>&1 | tail -5', async () => { now += 3000; during = await box() }, { text: 'Finished' })
check('a long command shows while it runs', !!during && text(during).includes('1 running'), during && text(during))
check('...in words, with who and how long, ● as Claude waits on it', !!during && text(during).includes('3s $ Claude ran cargo build'), during && text(during))
check('...never the raw command', !!during && !text(during).includes('--release') && !text(during).includes('tail'))
check('it goes when the command returns', !(await box()))

// Claude's description, when given, names it.
await bash('npm run dev', async () => { now += 2500; during = await box() }, { text: 'Command running in background with ID: bash_7' }, { description: 'Start the dev server', run_in_background: true })
let b = await box()
check('a background command stays after its call returns, marked ◌', !!b && text(b).includes('Claude ◌ Start the dev server'), b && text(b))
check('...one row, whatever runs', !!b && b.props.height === 1)
check("the map's terminal counts it", (await mapSvg()).includes('>1 running</text>'))
// Reading its output while it runs keeps it; a finished read ends it, and the log says so.
await hooks['tool.call']($, { tool: 'BashOutput', tool_use_id: `o${n++}`, bash_id: 'bash_7' }, async () => ({ text: '<status>running</status>\nready on :3000' }))
check('a read while it still runs keeps it listed', !!(await box()))
now += 60_000
await hooks['tool.call']($, { tool: 'BashOutput', tool_use_id: `o${n++}`, bash_id: 'bash_7' }, async () => ({ text: '<status>completed</status>\n<exit_code>0</exit_code>' }))
check('a read that shows it finished ends it', !(await box()))
check('...and the log says it finished, how long it took, and what it was', crew().log.some(l => /^✓ background command finished after 1m0[23]s · Start the dev server$/.test(l.text)), crew().log.at(-1)?.text)

// The app's notice that a background task finished ends it too.
await bash('node watch.mjs', null, { text: 'Command running in background with ID: bash_9' }, { run_in_background: true })
check('another background command is listed', !!(await box()))
await hooks['turn.start']($, { text: '<task-notification>\n<task-id>bash_9</task-id>\n<status>failed</status>\n<summary>Background command "node watch.mjs" failed with exit code 1</summary>\n</task-notification>', turnId: 'N' }, async () => ({}))
check('the app\'s task notice ends it', !(await box()))
check('...and a failure is logged as one', crew().log.some(l => l.text.startsWith('✗ background command failed after')))

// Stopping one ends it.
await bash('python -m http.server', null, { text: 'Command running in background with ID: shell_3' }, { run_in_background: true })
await hooks['tool.call']($, { tool: 'KillShell', tool_use_id: `k${n++}`, shell_id: 'shell_3' }, async () => ({ text: 'killed' }))
check('stopping one ends it', !(await box()) && crew().log.some(l => l.text.startsWith('■ background command stopped')))

// A test run shows in the same box, marked as a test, not as a command.
let testBox
await bash('npm test', async () => { now += 3000; testBox = await box() }, { text: '41 passed' })
check('a test run shows marked ⚗ as a test, not as a command', !!testBox && text(testBox).includes('⚗ Claude ') && !text(testBox).includes('$ Claude'), testBox && text(testBox))

// Codex's running command shows, named the same way.
codexRuns = [{ id: 'r1', task: 't', mode: 'write', root: P, cwd: P, model: 'm', effort: 'e', status: 'running', startedAt: now - 10_000, endedAt: 0, thread: '', resumed: false, caller: 'main', activity: 'Running tests', focus: '', touched: [], events: [{ at: now - 4000, kind: 'cmd', text: 'bash -lc "cargo test chunk"', ok: undefined }], files: [], commands: 1, failedCommands: 0, answer: '', notesUpdated: false }]
b = await box()
check("Codex's running command shows, in words", !!b && text(b).includes('4s $ Codex ran cargo test'), b && text(b))
codexRuns = []

// Several at once, with long names: one line each, the oldest first, and a count of the rest past the box's rows.
for (let i = 0; i < 8; i++) await bash(`node job${i}.mjs`, null, { text: `Command running in background with ID: bash_${100 + i}` }, { run_in_background: true, description: `A rather long description of background job number ${i} that goes on and on` })
b = await box()
check('eight at once: the two oldest and "+6 more", still one row', !!b && text(b).includes('8 running') && text(b).includes('+6 more') && b.props.height === 1, b && text(b).slice(0, 80))
check('each line truncates its label rather than wrapping', find(b, x => x.type === 'Text' && String(text(x)).startsWith('A rather long')).every(t => t.props.wrap === 'truncate'))

// The clock ticks while they run; after six hours unheard, they are let go.
now += 7 * 60 * 60_000
for (const fn of ticks) fn()
await new Promise(r => setTimeout(r, 20))
check('background commands nobody hears of for six hours are let go', !(await box()))
// The box keeps its spot and its height whether anything runs or not.
{
  const idle = await runningBox()
  check('idle, the line stays in its spot, saying nothing runs', !!idle && text(idle).startsWith('○ nothing running'))
  check('...one row, as when busy', idle.props.height === 1 && b.props.height === 1)
}

// A reload keeps background commands it can still match (by id); foreground calls are gone.
await bash('node serve.mjs', null, { text: 'Command running in background with ID: bash_200' }, { run_in_background: true })
globalThis.__store.set('crew', { ...crew(), shells: [...crew().shells, { id: 'sh-x', agentId: 'main', who: 'Claude', hue: 0, label: 'ran make', startedAt: now, endedAt: 0, status: 'running', background: false }] })
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
check('a reload keeps background commands with an id, drops foreground ones', crew().shells.length === 1 && crew().shells[0].shellId === 'bash_200', JSON.stringify(crew().shells.map(x => x.label)))
console.log(`\n${fails} failing check(s)`)
