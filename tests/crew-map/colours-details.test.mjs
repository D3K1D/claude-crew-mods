// Each Claude's own colour, kept for the whole chat: the main Claude always the first (clay), everyone
// else the next free one as they appear; past 12, the colour of whoever has been done or idle longest.
// Kept beside the journal, so a restart gives nobody's colour away. And a Claude's Details list the
// helpers under it (theirs one step in) and, for the main Claude, the nested chats.
import { words, makePress } from './kit.mjs'
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
  store: { get: async () => undefined, set: async () => {} },
  session: { cwd: async () => P, id: async () => 'cli-c' },
  env: { get: async n => (n === 'USERPROFILE' ? 'C:/home' : n === 'OS' ? 'Windows_NT' : undefined) },
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
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'terminal', props: { bodyColumns: 150, scroll: { bodyRows: 80 } }, viewport: { columns: 150 } }, async () => ({}))
const press = makePress(elements, render, tick)
const crew = () => globalThis.__store.get('crew')
const agent = id => crew().agents.find(a => a.id === id)
const timer = async ms => { for (const t of timers.filter(x => x.ms === ms)) await t.fn(); await tick() }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const spawn = (id, from, type = 'general-purpose', description = 'Help') =>
  fire('agent.spawn', { tool_use_id: `sp-${id}`, prompt: description, description, subagentType: type, provider: {}, parentModel: 'm', ...(from ? { agentId: from } : {}) }, async () => ({ agentId: id }))

try {
  await fire('session.start', {}, async () => ({}))
  await tick()
  await fire('turn.start', { text: 'Add a fixture adapter', turnId: 'T' }, async () => ({}))

  // ── Colours in order of first appearance ──
  await spawn('s1', '', 'Explore', 'Look around')
  await spawn('s2', '', 'Plan', 'Plan it')
  await spawn('s3', '', 'general-purpose', 'Write it')
  await spawn('s4', 's2', 'Explore', 'Check the plan')
  check('the main Claude is always the first colour', agent('main').hue === 0)
  check('helpers take the next colours as they appear (a helper of a helper too)', ['s1', 's2', 's3', 's4'].map(id => agent(id).hue).join(',') === '1,2,3,4', ['s1', 's2', 's3', 's4'].map(id => agent(id).hue).join(','))
  check('...and the chat keeps who has which', ['s1', 's2', 's3', 's4'].every((id, i) => crew().colors?.[id]?.i === i + 1), JSON.stringify(crew().colors))

  // ── Details: the helpers under a Claude, theirs one step in; a press opens one's Details ──
  await press('Claude: Details')
  let v = words(await render(), 'view').join(' | ')
  check("the main Claude's Details list its helpers, with their states", /Helpers \| · 4 working/.test(v) && ['Scout', 'Architect', 'Helper'].every(n => v.includes(n)), v.slice(0, 400))
  check('...no Nested chats group without any', !v.includes('Nested chats'))
  await press('Architect')
  v = words(await render(), 'view').join(' | ')
  check("a helper's row opens its Details: its own helper listed", /^Architect/.test(v) && /Helpers \| · 1 working/.test(v) && /Scout 2/.test(v), v.slice(0, 300))
  await press('Scout 2')
  v = words(await render(), 'view').join(' | ')
  check('a Claude with no helpers: no Helpers group', /^Scout 2/.test(v) && !v.includes('Helpers'), v.slice(0, 200))

  // ── Past 12: the colour of whoever has been done or idle the longest ──
  for (let i = 5; i <= 11; i++) await spawn(`s${i}`, '')
  check('eleven helpers: all twelve colours given out', agent('s11').hue === 11 && new Set(crew().agents.map(a => a.hue)).size === 12)
  globalThis.__store.set('crew', { ...crew(), agents: crew().agents.map(a => (a.id === 's3' ? { ...a, state: 'done', doneAt: now - 60_000 } : a.id === 's1' ? { ...a, state: 'done', doneAt: now - 5_000 } : a)) })
  now += 1000
  await spawn('s12', '')
  check('the twelfth helper takes the colour of the one done longest', agent('s12').hue === 3, String(agent('s12').hue))
  check("...and nobody else's colour changed (one done may drop off the list; its colour stays its own)", crew().colors.s3.i === 3 && crew().colors.s1.i === 1)

  // ── Kept beside the journal: a restart gives nobody's colour away ──
  await timer(3000)
  const saved = JSON.parse(disk.get('C:/home/.claude/crew-map/journals/cli-c/colors.json') ?? '{}')
  check('colors.json beside the journal holds who has which', saved.s2?.i === 2 && saved.s12?.i === 3, JSON.stringify(saved).slice(0, 200))
  globalThis.__store.set('crew', { ...crew(), agents: crew().agents.filter(a => a.id === 'main'), colors: undefined })
  timers = []
  await fire('session.start', {}, async () => ({}))
  await tick()
  await tick()
  check('restarted: the colours are back, all of them', crew().colors?.s4?.i === 4 && Object.keys(crew().colors ?? {}).length === 12, JSON.stringify(crew().colors ?? {}).slice(0, 200))

  // ── Nested chats: a colour each, given the first time they are seen ──
  globalThis.__store.set('crew', { ...crew(), colors: { s1: { i: 1, at: 1 } }, chats: [{ id: 'local_kid', title: 'Docs build', name: 'docs-build', parent: 'local_me', cwd: P, branch: '', running: true, at: now, depth: 1 }] })
  await timer(4000)
  check('a nested chat gets the next colour', crew().colors?.['chat:local_kid']?.i === 2, JSON.stringify(crew().colors ?? {}))
  await press('Claude: Details')
  v = words(await render(), 'view').join(' | ')
  check("the main Claude's Details list the nested chats", /Nested chats \| · started from this chat/.test(v) && v.includes('Docs build'), v.slice(0, 500))
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 400)}`, false)
}
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
