// When a chat's turn ends:
//  1. Its main Claude says "Waiting for crew-coder" (grey) while a chat it started still works, and
//     "your turn" only once nothing it started works.
//  2. Wrapping up (the desktop app's wrap_up, which checks off the task list itself) fills every pip:
//     "Step 3 of 3", all done; in this chat and in the file the chat above reads.
import { words, glyphs, rowGlyphs, makePress } from './kit.mjs'
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const disk = new Map()
// (Dark: the colours are drawn as tuned, so a check can name them.)
const stored = { theme: 'dark' }
let timers = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  clock: { every: (ms, fn) => (timers.push({ ms, fn }), { cancel() { timers = timers.filter(x => x.fn !== fn) } }), after: () => ({ cancel() {} }) },
  fs: {
    read: async p => (disk.has(p) ? disk.get(p) : Promise.reject(new Error('none'))),
    exists: async p => disk.has(p),
    write: async (p, t) => void disk.set(p, t),
    list: async () => [],
  },
  store: { get: async k => stored[k], set: async (k, v) => void (stored[k] = v) },
  session: { cwd: async () => P, id: async () => 'cli-t' },
  env: { get: async n => (n === 'USERPROFILE' ? 'C:/home' : n === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_me' : n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  tool: { check: async () => ({ decision: 'ask' }), call: async () => ({}) },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => (v instanceof RegExp ? typeof e[k] === 'string' && v.test(e[k]) : e[k] === v)))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const tick = () => new Promise(r => setTimeout(r, 30))
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'terminal', props: { bodyColumns: 150, scroll: { bodyRows: 40 } }, viewport: { columns: 150 } }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const timer = async ms => { for (const t of timers.filter(x => x.ms === ms)) await t.fn(); await tick() }
const row = async name => rowGlyphs(await render(), name).map(g => g.t).join(' ')
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const call = (tool, input) => fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input }, async () => ({ result: {}, text: 'ok' }))

try {
  await fire('session.start', {}, async () => ({}))
  await tick()
  await fire('turn.start', { text: 'Ship the docs', turnId: 'T' }, async () => ({}))
  await call('mcp__ccd_turn__update_plan', { items: [{ content: 'Write', status: 'completed' }, { content: 'Check', status: 'in_progress' }, { content: 'Ship', status: 'pending' }] })
  check('the plan: Step 2 of 3', /Step 2 of 3/.test(await row('Claude')), await row('Claude'))
  // Details list the steps the card counts (the app's plan here).
  await makePress(elements, render, tick)('Claude: Details')
  let det = words(await render(), 'view').join(' | ')
  check("Details list the plan's steps, under their title", /Steps \| ✓ Write \| ▸ Check \| ○ Ship/.test(det), det.slice(0, 300))
  check('...and its own lines under theirs, newest first', /Its lines \| · newest first \| .*update plan/.test(det), det.slice(0, 400))
  check('a section with nothing in it is left out (no helpers here)', !/Helpers|Nested chats/.test(det))

  // ── 2. Wrapping up checks off every step ──
  await call('mcp__ccd_turn__wrap_up', { recap: 'Shipped.' })
  const main = crew().agents.find(a => a.id === 'main')
  check('wrap_up completes every step', main.todosDone === 3 && main.todosTotal === 3 && main.plan.every(s => s.status === 'completed'), JSON.stringify(main.plan))
  check('...the card: Step 3 of 3, nothing on now', /Step 3 of 3/.test(await row('Claude')) && main.doing === '', await row('Claude'))
  det = words(await render(), 'view').join(' | ')
  check('...Details: every step checked', /✓ Write \| ✓ Check \| ✓ Ship/.test(det), det.slice(0, 300))
  await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T' }, async () => ({ text: 'ok' }))
  await tick()
  await timer(3000)
  const self = JSON.parse(disk.get('C:/home/.claude/crew-map/chats/local_me.json') ?? '{}')
  check('...and in the file the chat above reads (its Details steps too)', self.done === 3 && self.total === 3 && self.card?.rows?.[0]?.done === 3 && self.card.rows[0].info?.steps?.map(s => s.mark + s.text).join(',') === '✓Write,✓Check,✓Ship', JSON.stringify({ done: self.done, total: self.total, card: self.card?.rows?.[0]?.done, steps: self.card?.rows?.[0]?.info?.steps }))
  check("a wrap-up with no plan leaves a Claude's to-dos alone", await (async () => {
    await fire('turn.start', { text: 'Next', turnId: 'T2' }, async () => ({}))
    await call('TodoWrite', { todos: [{ content: 'A', status: 'completed', activeForm: 'A' }, { content: 'B', status: 'in_progress', activeForm: 'B' }] })
    const was = crew().agents.find(a => a.id === 'main')
    globalThis.__store.set('crew', { ...crew(), agents: crew().agents.map(a => (a.id === 'main' ? { ...a, plan: undefined } : a)) })
    await call('mcp__ccd_turn__wrap_up', { recap: 'x' })
    const after = crew().agents.find(a => a.id === 'main')
    return was.todosTotal === 2 && after.todosTotal === 2 && after.todosDone === 1
  })())
  det = words(await render(), 'view').join(' | ')
  check("Details list a Claude's to-dos (TodoWrite), the one on now in its own words; the last task's plan is gone", /✓ A \| ▸ B/.test(det) && !/Ship/.test(det), det.slice(0, 300))
  await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T2' }, async () => ({ text: 'ok' }))
  await tick()

  // ── 1. Turn over, a chat it started still at work: waiting for it, not "your turn" ──
  const chat = (id, name, running, depth = 1) => ({ id, title: name, name, parent: 'local_me', cwd: P, branch: '', running, at: now, depth })
  globalThis.__store.set('crew', { ...crew(), chats: [chat('local_a', 'crew-coder', true), chat('local_b', 'crew-designer', true), chat('local_c', 'crew-docs', true), chat('local_d', 'deeper', true, 2)] })
  now += 4 * 60_000
  let r = await row('Claude')
  check('turn over, its chats at work: "Waiting for crew-coder, crew-designer +1"', /Claude .*Waiting for crew-coder, crew-designer \+1/.test(r) && !/your turn/.test(r), r)
  check('...with how long it has been waiting (since its turn ended)', /crew-designer \+1 4m/.test(r), r)
  check('...in the wait colour (indigo), counted as waiting, the header count indigo too', rowGlyphs(await render(), 'Claude').find(g => g.t === 'Waiting')?.role === 'wait' && glyphs(await render(), 'top').some(g => /1 waiting/.test(g.t) && g.role === 'wait'), JSON.stringify(glyphs(await render(), 'top').slice(0, 6)))
  globalThis.__store.set('crew', { ...crew(), chats: [chat('local_a', 'crew-coder', true), chat('local_b', 'crew-designer', false), chat('local_d', 'deeper', true, 2)] })
  check('one chat left at work: waiting for it alone (a chat it did not start does not count)', /Waiting for crew-coder(?!,)/.test(await row('Claude')), await row('Claude'))
  globalThis.__store.set('crew', { ...crew(), chats: [chat('local_a', 'crew-coder', false), chat('local_d', 'deeper', true, 2)] })
  check('nothing it started still works: your turn', /Idle .*your turn/.test(await row('Claude')), await row('Claude'))

  // ── 3. Test toasts: a setting, off by default; the card and the log say how a run went either way ──
  const toasts = []
  $.ui.toast = async t => void toasts.push(t)
  const jest = () => fire('tool.call', { tool: 'Bash', tool_use_id: `j${n++}`, command: 'npx jest auth' }, async () => ({ text: 'Tests:       3 passed, 3 total' }))
  await jest()
  check('test toasts are off by default: none when a run passes', !toasts.some(t => /Tests passed/.test(t)) && crew().log.some(l => /tests passed \(3 passed\)/.test(l.text)), toasts.join(' | '))
  const press = makePress(elements, render, tick)
  await press('⚙')
  check('Settings has a Test toasts row: off, on', /Test toasts \| off \| on/.test(words(await render(), 'view').join(' | ')), words(await render(), 'view').join(' | ').slice(0, 400))
  await press('on')
  check('turned on: kept in the store', crew().testToasts === true && stored.testToasts === true)
  await jest()
  check('...a run that ends says so in a toast', toasts.some(t => t.startsWith('✓ Tests passed (3 passed)')), toasts.join(' | '))
  await press('off')
  const had = toasts.length
  await jest()
  check('turned off again: no toast', crew().testToasts === false && stored.testToasts === false && toasts.length === had, toasts.join(' | '))
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 400)}`, false)
}
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
