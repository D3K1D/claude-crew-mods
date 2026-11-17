// The chats started from this one (the desktop app's start_session), and theirs, as rows in the crew
// band, nested under this chat: read from the app's own session list, only where that read runs without
// asking anyone. The pane's own read never shows in the log; Claude's own call still does.
import { text, words, makePress, rowNames } from './kit.mjs'
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
const P = 'C:/work/game'
const LIST = 'mcp__ccd_session_mgmt__list_sessions'
// The family as the app lists it for this chat (local_me, left out): its parent, a sibling, and the
// chats it started (one of which started its own).
const family = [
  { sessionId: 'local_root', title: 'Project coordinator', cwd: 'C:\\work', isArchived: false, isRunning: false, lastActivityAt: '2031-01-01T20:59:00Z' },
  { sessionId: 'local_sib', title: 'A sibling chat', cwd: 'C:\\work', isArchived: false, isRunning: true, lastActivityAt: '2031-01-01T20:59:00Z', name: 'sib', startedBy: 'local_root' },
  { sessionId: 'local_kid', title: 'Optimus M9: AI permissions', cwd: 'C:\\work\\game\\.claude\\worktrees\\m9', branch: 'claude/m9', isArchived: false, isRunning: true, lastActivityAt: '2031-01-01T20:59:50Z', name: 'm9', startedBy: 'local_me' },
  { sessionId: 'local_grand', title: 'Optimus lead programmer', cwd: 'C:\\work\\game\\.claude\\worktrees\\m9', isArchived: false, isRunning: false, lastActivityAt: '2031-01-01T20:50:00Z', name: 'lead', startedBy: 'local_kid' },
]
let decision = 'allow'
let listed = 0
let every = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: (ms, fn) => (every.push({ ms, fn }), { cancel() { every = every.filter(x => x.fn !== fn) } }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async () => undefined, set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  // As the engine does: a plugin's own call runs every tool.call hook (the pane's own included).
  tool: {
    check: async () => ({ decision }),
    call: async e => fire('tool.call', { ...e, tool_use_id: `p${listed}` }, async () => (listed++, { result: {}, text: JSON.stringify(family) })),
  },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => (v instanceof RegExp ? typeof e[k] === 'string' && v.test(e[k]) : e[k] === v)))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const render = (cols = 100, surface = 'desktop') => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface, props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 60))
const press = makePress(elements, render, tick)
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const alts = rowNames
const said = t => words(t, 'top')

await fire('session.start', {}, async () => ({}))
await tick()
let t = await render()
check('read once at the start, and every 15 seconds after', listed === 1 && every.some(x => x.ms === 15_000), `${listed}`)
const rows = alts(t)
check('a row for each chat this one started, and theirs', rows.some(a => a.startsWith('Optimus M9: AI permissions')) && rows.some(a => a.startsWith('Optimus lead programmer')), rows.join(' | ').slice(0, 300))
check('...but not its parent or a sibling', !rows.some(a => /Project coordinator|A sibling chat/.test(a)))
check('the running one says Working, the other Idle and when it was last active', said(t).includes('Working') && said(t).some(w => /last active 10m ago/.test(w)), said(t).join(' | ').slice(0, 300))
const crew = globalThis.__store.get('crew')
check('nested: its own chat one in, the chat it started two in', crew.chats.map(c => `${c.title}:${c.depth}`).join(',') === 'Optimus M9: AI permissions:1,Optimus lead programmer:2', crew.chats.map(c => `${c.title}:${c.depth}`).join(','))
check("the pane's own read is not in the log", !text(t).includes('list_sessions') && !(crew.log ?? []).some(l => /list_sessions|sessions/i.test(l.text)), (crew.log ?? []).map(l => l.text).join(' | ').slice(0, 200))
check('a running chat counts as working in the header', said(t).some(w => /1 working/.test(w)), said(t).slice(0, 6).join(' | '))

// Details: its whole title, who started it, where it works.
await press('Optimus lead programmer: Details')
t = await render()
const v = words(t, 'view').join(' ')
check("Details shows the chat: who started it, its folder", /Started by Optimus M9: AI permissions/.test(v) && /worktrees\/m9/.test(v) && /Open it from the sidebar/.test(v), v.slice(0, 300))

// A chat finishes and the list says so: the next read updates the row.
family[2].isRunning = false
await every.find(x => x.ms === 15_000).fn()
await tick()
t = await render()
check('the next read updates it', !said(t).includes('Working'), said(t).join(' | ').slice(0, 200))

// Where reading the list would ask someone (or there is no such tool), the pane stops reading it.
decision = 'ask'
const before = listed
await every.find(x => x.ms === 15_000).fn()
await tick()
check('asked to approve: never called, but it keeps checking', listed === before && every.some(x => x.ms === 15_000))
check('and the chats are marked as not live', globalThis.__store.get('crew').chatsLive === false)
const asOf = new Date(now).toTimeString().slice(0, 5)
t = await render()
check('a card not read live says "as of" its last read, its state dim', said(t).some(w => w === `as of ${asOf}`) && !said(t).some(w => /in its own chat/.test(w)), said(t).join(' | ').slice(0, 300))
check('the header counts only what is known live: the stale chats are left out', said(t).some(w => /^◌ 1 idle$/.test(w)), said(t).slice(0, 4).join(' | '))
const termStale = text(await render(100, 'terminal'))
check('in a terminal: "Idle (as of …)", with its last activity at the right', termStale.includes(`Idle (as of ${asOf})   10s`), termStale.slice(0, 300))

// Claude's own linked list call still lands in the log, and refreshes the rows.
family.push({ sessionId: 'local_new', title: 'A new helper chat', cwd: 'C:\\work\\game', isArchived: false, isRunning: true, lastActivityAt: '2031-01-01T21:00:00Z', name: 'new', startedBy: 'local_me' })
await fire('tool.call', { tool: LIST, tool_use_id: 'm1', linked: true }, async () => ({ result: {}, text: JSON.stringify(family) }))
await tick()
t = await render()
check("Claude's own list call refreshes the rows", alts(t).some(a => a.startsWith('A new helper chat')))

// Claude reads one chat itself: that card takes what it saw.
now += 120_000
await fire('tool.call', { tool: 'mcp__ccd_session_mgmt__get_session', tool_use_id: 'g1', session_id: 'local_grand' }, async () => ({ result: {}, text: JSON.stringify({ ...family[3], isRunning: true, lastActivityAt: '2031-01-01T21:02:00Z' }) }))
await tick()
const grand = globalThis.__store.get('crew').chats.find(c => c.id === 'local_grand')
check("Claude's own read of one chat updates its card", grand?.running === true && grand.seen === now, JSON.stringify(grand))
// The list may be readable again (the mode changed): the next check reads it.
decision = 'allow'
const was = listed
await every.find(x => x.ms === 15_000).fn()
await tick()
check('allowed again: read again, and live', listed === was + 1 && globalThis.__store.get('crew').chatsLive === true)

// The terminal draws them as well.
const term = text(await render(100, 'terminal'))
check('the terminal shows the chats too', term.includes('Optimus M9') && term.includes('A new helper chat'), term.slice(0, 200))
console.log(`\n${fails} failing check(s)`)
