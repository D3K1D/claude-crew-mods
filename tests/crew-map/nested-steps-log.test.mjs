// Steps and lines across chats. A Claude's steps come from the desktop app's task list (update_plan) as
// well as TodoWrite. Each chat's mod writes a small file about itself (its journal's name, its steps)
// under ~/.claude/crew-map/chats/<its app id>.json; the chat that started it reads that file and the
// journal it names, so its nested chats' lines join its own log.
import { text, words } from './kit.mjs'
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T21:00:00Z')
Date.now = () => now
const HOME = 'C:/home'
const DIR = `${HOME}/.claude/crew-map`
// A small disk: each file's text and when it was written.
const disk = new Map()
const put = (path, text) => disk.set(path, { text, at: now })
const family = [
  { sessionId: 'local_kid', name: 'docs-build', title: 'Build the docs site', cwd: 'C:\\work', isArchived: false, isRunning: true, lastActivityAt: '2031-01-01T20:59:00Z', startedBy: 'local_me' },
  { sessionId: 'local_root', title: 'Coordinator', cwd: 'C:\\work', isArchived: false, isRunning: false, lastActivityAt: '2031-01-01T20:59:00Z' },
]
let every = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  clock: { every: (ms, fn) => (every.push({ ms, fn }), { cancel() {} }), after: () => ({ cancel() {} }) },
  fs: {
    read: async p => {
      if (!disk.has(p)) throw new Error('no such file')
      return disk.get(p).text
    },
    write: async (p, t) => put(p, t),
    exists: async p => disk.has(p),
    list: async d => [...disk.entries()].filter(([p]) => p.startsWith(`${d}/`) && !p.slice(d.length + 1).includes('/')).map(([p, f]) => ({ name: p.slice(d.length + 1), kind: 'file', mtimeMs: f.at })),
  },
  store: { get: async () => undefined, set: async () => {} },
  session: { cwd: async () => 'C:/work', id: async () => 'cli-me' },
  env: { get: async n => ({ OS: 'Windows_NT', USERPROFILE: HOME, CLAUDE_CODE_HOST_SESSION_ID: 'local_me' })[n] },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  tool: { check: async () => ({ decision: 'allow' }), call: async () => ({ result: {}, text: JSON.stringify(family) }) },
}
const regs = []
register((ev, m, fn) => {
  regs.push({ ev, m: fn ? m : {}, fn: fn ?? m })
  return { catch() {} }
}, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => (v instanceof RegExp ? typeof e[k] === 'string' && v.test(e[k]) : e[k] === v)))
  const run = i => (i < mine.length ? mine[i].fn($, e, () => run(i + 1)) : bottom(e))
  return run(0)
}
const render = (surface = 'terminal') => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface, props: { bodyColumns: 120, scroll: { bodyRows: 60 } }, viewport: { columns: 120 } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 60))
const timer = ms => every.find(x => x.ms === ms)?.fn()
let fails = 0
const check = (label, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`)
}
const crew = () => globalThis.__store.get('crew')
const main = () => crew().agents.find(a => a.id === 'main')
const PLAN = 'mcp__ccd_turn__update_plan'

await fire('session.start', {}, async () => ({}))
await tick()
await fire('turn.start', { text: 'Build the release', turnId: 'T1' }, async () => ({ turnId: 'T1' }))

// 1 · The desktop app's task list: the whole list, then advance, done and start.
const call = async (input, id) => fire('tool.call', { tool: PLAN, tool_use_id: id, ...input }, async () => ({ result: {}, text: 'ok' }))
await call({ items: [{ content: 'Read the code', status: 'in_progress' }, { content: 'Write the fix', status: 'pending' }, { content: 'Run the tests', status: 'pending' }] }, 'p1')
check('update_plan gives its steps: 0 of 3 done, on the first', main().todosTotal === 3 && main().todosDone === 0 && main().doing === 'Read the code', JSON.stringify([main().todosTotal, main().todosDone, main().doing]))
await call({ advance: true }, 'p2')
check('advance: the first done, the second on', main().todosDone === 1 && main().doing === 'Write the fix', JSON.stringify(main().plan))
await call({ done: [2], start: 3 }, 'p3')
check('done [2], start 3: two done, on the third', main().todosDone === 2 && main().doing === 'Run the tests', JSON.stringify(main().plan))
let t = text(await render())
check('the card shows it: Step 3 of 3 · Run the tests', /Step 3 of 3 · Run the tests/.test(t), t.slice(0, 300))

// 2 · This chat writes its own file: its app id, its journal, its steps.
await timer(3000)
await tick()
const mine = JSON.parse(disk.get(`${DIR}/chats/local_me.json`)?.text ?? '{}')
check('it writes chats/<its app id>.json: its journal and steps', mine.id === 'local_me' && mine.journal === 'cli-me' && mine.total === 3 && mine.done === 2 && mine.doing === 'Run the tests', JSON.stringify(mine))

// 3 · A nested chat's file and journal: its steps and lines are read, only when they change.
put(`${DIR}/chats/local_kid.json`, JSON.stringify({ id: 'local_kid', journal: 'cli-kid', total: 4, done: 1, doing: 'Write the pages', at: now }))
put(`${DIR}/journals/cli-kid/000001.json`, JSON.stringify([
  { at: now - 5000, who: 'Claude', hue: 0, kind: 'act', text: '✎ editing docs/index.md', took: 300 },
  { at: now - 4000, who: 'Quill', hue: 2, kind: 'act', text: '✎ editing docs/build.mjs', took: 200 },
]))
now += 1000
await timer(4000)
await tick()
t = text(await render())
check("a nested chat's lines join this log, under its name", /docs-… ✎ {2}Editing docs\/index\.md/.test(t), t.slice(-600))
check("a helper there is named first: Quill ·", /docs-… ✎ {2}Quill · Editing docs\/build\.mjs/.test(t))
check("its card shows its steps as a Claude's card does: Step 2 of 4 · Write the pages", /Build the docs site.*●○○○ Step 2 of 4 · Write the pages/.test(t) && !/Chat · work/.test(t), t.slice(0, 400))
check('its lines are not written into this chat\'s own journal', !(disk.get(`${DIR}/journals/cli-me/000001.json`)?.text ?? '').includes('docs/index.md'))
put(`${DIR}/journals/cli-kid/000001.json`, JSON.stringify([
  { at: now - 5000, who: 'Claude', hue: 0, kind: 'act', text: '✎ editing docs/index.md', took: 300 },
  { at: now - 4000, who: 'Quill', hue: 2, kind: 'act', text: '✎ editing docs/build.mjs', took: 200 },
  { at: now, who: 'Claude', hue: 0, kind: 'act', text: '▸ ran npm run docs', took: 900 },
]))
now += 1000
await timer(4000)
await tick()
t = text(await render())
check('its new lines come in on the next read', /Ran npm run docs/.test(t))
const reads = []
const read0 = $.fs.read
$.fs.read = async p => (reads.push(p), read0(p))
now += 4000
await timer(4000)
await tick()
check('nothing is read again while neither file changed', !reads.length, reads.join(' | '))
// A second chunk appears: only it is read.
put(`${DIR}/journals/cli-kid/000002.json`, JSON.stringify([{ at: now, who: 'Claude', hue: 0, kind: 'act', text: '▸ ran npm run deploy', took: 500 }]))
reads.length = 0
now += 1000
await timer(4000)
await tick()
check("a nested chat's new chunk is read, not the ones before it", reads.length === 1 && reads[0].endsWith('cli-kid/000002.json') && /Ran npm run deploy/.test(text(await render())), reads.join(' | '))
$.fs.read = read0

// 6 · The nested chat renamed by the app: its lines (none of its files changed) show under the new name.
// (That they keep their keys, so the page doesn't double them, is the page test's.)
family[0].name = 'site-docs'
await fire('tool.call', { tool: 'mcp__ccd_session_mgmt__list_sessions', tool_use_id: 'ls2', linked: true }, async () => ({ result: {}, text: JSON.stringify(family) }))
now += 5000
await timer(4000)
await tick()
t = text(await render())
check('a nested chat renamed: its lines show under its new name, without reading them again', /site-… ✎ {2}Editing docs\/index\.md/.test(t) && !/docs-…/.test(t), t.slice(-300))

// 4 · This chat's journal: chunks of 250 lines, and only the ones that changed are written.
const writes = []
const write0 = $.fs.write
$.fs.write = async (p, s) => (writes.push(p), write0(p, s))
let finish
const slow = fire('tool.call', { tool: 'Bash', tool_use_id: 'slow', command: 'npm run long', run_in_background: false }, () => new Promise(r => (finish = r)))
await tick()
for (let i = 0; i < 260; i++) {
  now += 10
  await fire('tool.call', { tool: 'Grep', tool_use_id: `g${i}`, pattern: `p${i}` }, async () => ({ text: 'ok' }))
  if (i % 50 === 49) await timer(3000)
await tick()
}
await timer(3000)
await tick()
await tick()
check('the journal is split in chunks of 250 lines', disk.has(`${DIR}/journals/cli-me/000002.json`) && JSON.parse(disk.get(`${DIR}/journals/cli-me/000001.json`).text).length === 250)
writes.length = 0
now += 10
await fire('tool.call', { tool: 'Grep', tool_use_id: 'last', pattern: 'last' }, async () => ({ text: 'ok' }))
await timer(3000)
await tick()
check('a new line writes only the newest chunk', writes.filter(p => p.includes('/journals/')).join(' | ') === `${DIR}/journals/cli-me/000002.json`, writes.join(' | '))
writes.length = 0
finish({ text: 'done' })
await slow
await timer(3000)
await tick()
const first = JSON.parse(disk.get(`${DIR}/journals/cli-me/000001.json`).text)
check('a line that finished late rewrites only its own (older) chunk', writes.filter(p => p.includes('/journals/')).join(' | ') === `${DIR}/journals/cli-me/000001.json` && first.some(l => l.call === 'slow' && l.took > 0), writes.join(' | '))
$.fs.write = write0

// 5 · A call that fails while the journal has its line as running: one line, marked bad (its words, its key, unchanged).
let fail
const failing = fire('tool.call', { tool: 'Bash', tool_use_id: 'f1', command: 'npm run build', description: 'Build the app' }, () => new Promise(r => (fail = r)))
await tick()
await timer(3000)
await tick()
fail({ isError: true, text: 'error TS2304\nExit code 2' })
await failing
await timer(3000)
await tick()
const mineNow = [...disk.entries()].filter(([p]) => p.includes('/journals/cli-me/')).flatMap(([, f]) => JSON.parse(f.text))
const builds = mineNow.filter(l => l.text.startsWith('▸ Build the app'))
check('a failed call is one line in the journal, marked bad', builds.length === 1 && builds[0].bad === true && typeof builds[0].took === 'number', JSON.stringify(builds.map(l => [l.text, l.bad, l.took])))
check('...and the log shows it failed', /Build the app ✗ failed/.test(text(await render())))

// 7 · A new session in the same process starts from nothing: the last chat's lines don't follow it.
$.session.id = async () => 'cli-next'
// (A new session's own state starts empty, as the engine keeps one per session.)
globalThis.__store.set('crew', { ...crew(), log: [] })
await fire('session.start', {}, async () => ({}))
await tick()
now += 10
await fire('tool.call', { tool: 'Grep', tool_use_id: 'n1', pattern: 'fresh start' }, async () => ({ text: 'ok' }))
await timer(3000)
await tick()
const nextFiles = [...disk.keys()].filter(p => p.includes('/journals/cli-next/'))
const next = nextFiles.map(p => disk.get(p).text).join(' ')
check("a new session's journal starts at its chunk 1, with none of the last one's lines", nextFiles.join() === `${DIR}/journals/cli-next/000001.json` && next.includes('fresh start') && !next.includes('Build the app') && !next.includes('searching p1'), nextFiles.join(' | '))
console.log(`\n${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
