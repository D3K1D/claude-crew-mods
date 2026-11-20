// /crew-review: Claude is asked to start a nested "Crew Review" chat with a whole brief: this chat's and its
// nested chats' Claude Crew logs, git since a starting point (this chat's start, a span back, a date or a git
// ref), the summary's headings, read only, and then ask what to do with it. Bad arguments say what to type.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T12:00:00Z')
Date.now = () => now
const P = 'C:/work/game'
const disk = new Map()
const mtime = new Map()
const commands = []
const prompts = []
const timers = []
const $ = {
  command: { register: async c => void commands.push(c) },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  // (Its request goes in a moment after the command: run at once here.)
  clock: { every: (ms, fn) => (timers.push({ ms, fn }), { cancel() {} }), after: (ms, fn) => (fn(), { cancel() {} }) },
  fs: {
    read: async p => (disk.has(p) ? disk.get(p) : Promise.reject(new Error('none'))),
    exists: async p => disk.has(p),
    write: async (p, t) => void disk.set(p, t),
    list: async p => [...disk.keys()].filter(k => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map(k => ({ name: k.slice(p.length + 1), kind: 'file', mtimeMs: mtime.get(k) ?? now })),
  },
  store: { get: async () => undefined, set: async () => {} },
  session: { cwd: async () => P, id: async () => 'cli-me' },
  env: { get: async n => ({ USERPROFILE: 'C:/home', CLAUDE_CODE_HOST_SESSION_ID: 'local_me', OS: 'Windows_NT' })[n] },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
  prompt: { submit: async p => void prompts.push(p) },
  tool: { check: async () => ({ decision: 'ask' }), call: async () => ({}) },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => (v instanceof RegExp ? typeof e[k] === 'string' && v.test(e[k]) : e[k] === v)))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const tick = () => new Promise(r => setTimeout(r, 40))
const crew = () => globalThis.__store.get('crew')
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const review = async args => {
  prompts.length = 0
  const r = await fire('command.run', { command: 'crew-review', args }, async () => ({}))
  await tick()
  return { said: r?.text ?? '', ask: prompts[0]?.text ?? '', asUser: prompts[0]?.asUser }
}

try {
  // A nested chat with its own journal, so the brief names it (an older file: no project recorded, but the
  // app's list knows it here).
  const C = 'C:/home/.claude/crew-map/chats'
  disk.set(`${C}/local_kid.json`, JSON.stringify({ id: 'local_kid', journal: 'kid-sid', total: 0, done: 0, doing: '', at: now }))
  // Others' files: an archived chat of this project (no longer listed), another project's chat, an older file
  // nobody lists, and a chat of this project quiet since before the review's start.
  disk.set(`${C}/local_gone.json`, JSON.stringify({ id: 'local_gone', journal: 'gone-sid', cwd: `${P}/.claude/worktrees/x`, root: P, goal: 'Tidy the loader', total: 0, done: 0, doing: '', at: now }))
  disk.set(`${C}/local_else.json`, JSON.stringify({ id: 'local_else', journal: 'else-sid', cwd: 'C:/work/gamer', root: 'C:/work/gamer', total: 0, done: 0, doing: '', at: now }))
  disk.set(`${C}/local_legacy.json`, JSON.stringify({ id: 'local_legacy', journal: 'legacy-sid', total: 0, done: 0, doing: '', at: now }))
  disk.set(`${C}/local_quiet.json`, JSON.stringify({ id: 'local_quiet', journal: 'quiet-sid', cwd: P, root: P, total: 0, done: 0, doing: '', at: now }))
  mtime.set(`${C}/local_quiet.json`, now - 5 * 3_600_000)
  disk.set('C:/home/.claude/crew-map/journals/kid-sid/000001.json', '[]')
  await fire('session.start', {}, async () => ({}))
  await tick()
  globalThis.__store.set('crew', { ...crew(), startedAt: now - 3 * 3_600_000, chats: [{ id: 'local_kid', title: 'Fix the docs build', name: 'docs-build', parent: 'local_me', cwd: P, branch: '', running: false, at: now, depth: 1 }] })
  // (The nested chat's file is read on the 4-second timer: once here.)
  for (const t of timers.filter(t => t.ms === 4000)) await t.fn()
  await tick()
  // This chat's own file records its project (its folder and git root), for other chats' readers.
  for (const t of timers.filter(t => t.ms === 3000)) await t.fn()
  await tick()
  const self = JSON.parse(disk.get(`${C}/local_me.json`) ?? '{}')
  check("this chat's file records its folder and project root", self.cwd === P && self.root === P, JSON.stringify({ cwd: self.cwd, root: self.root }))
  check('the command is offered, with what it does', commands.some(c => c.name === 'crew-review' && /Crew Review/.test(c.description)), JSON.stringify(commands.map(c => c.name)))

  // ── No argument: since this chat began ──
  let r = await review('')
  check('it says it is starting, since when', /Starting a Crew Review of the changes since this chat began/.test(r.said), r.said)
  check('...and asks Claude, as the person, to start the nested chat', r.asUser === true && r.ask.startsWith('Start a Crew Review of this project: start a nested chat with mcp__ccd_session__start_session, initiation "user_asked", title "Crew Review", context "fresh"'), r.ask.slice(0, 200))
  check("...its brief names this chat's journal folder", r.ask.includes('C:/home/.claude/crew-map/journals/cli-me/ (this chat)'), r.ask)
  check("...and its nested chats' journal folders", r.ask.includes('C:/home/.claude/crew-map/journals/kid-sid/ (nested chat "docs-build")'))
  check("...a chat of this project no longer listed (archived), by the project its file records", r.ask.includes('journals/gone-sid/ (a chat in this project: no longer listed, it was asked: Tidy the loader)'), r.ask.slice(r.ask.indexOf('Sources'), r.ask.indexOf('Sources') + 900))
  check("...never another project's chat, an unlisted older file, or one quiet since before the start", !/else-sid|legacy-sid|quiet-sid/.test(r.ask))
  check('...git since this chat began', r.ask.includes(`git log --since="${new Date(now - 3 * 3_600_000).toISOString()}" --stat`))
  check('...only the log lines since then', r.ask.includes(`at least ${now - 3 * 3_600_000}`))
  check('...the summary headings, read only, then ask what to do with it', /What changed .*How .*Why .*Problems and fixes .*What is open/s.test(r.ask) && /Read only: don't edit code/.test(r.ask) && r.ask.includes('.claude/crew-logs/reviews/<date>-review.md') && /release notes/.test(r.ask) && /pull request/.test(r.ask))
  check('...and the project folder', r.ask.includes(`Crew Review for the project in ${P}`))

  // ── A span back, a date, a git ref ──
  r = await review('2h')
  check('"2h": the last two hours', /in the last 2h/.test(r.said) && r.ask.includes(`--since="${new Date(now - 7_200_000).toISOString()}"`), r.said)
  r = await review('90 min')
  check('"90 min": the last 90 minutes', /in the last 90m/.test(r.said) && r.ask.includes(`--since="${new Date(now - 5_400_000).toISOString()}"`), r.said)
  r = await review('since 2030-12-30')
  check('"since 2030-12-30": from that date', /since 2030-12-30/.test(r.said) && r.ask.includes(`--since="${new Date(Date.parse('2030-12-30')).toISOString()}"`), r.said)
  r = await review('since v1.8.8')
  check('"since v1.8.8": git from that tag, every log line', /since v1\.8\.8/.test(r.said) && r.ask.includes('git log v1.8.8..HEAD --stat') && r.ask.includes('All lines'), r.ask.slice(0, 600))

  // ── Not a time or a ref: what to type, and nothing asked ──
  for (const bad of ['rm -rf / ; echo', 'a..b', 'since "x y"']) {
    r = await review(bad)
    check(`"${bad}": not read, and what to type instead`, /Couldn't read/.test(r.said) && /Usage: \/crew-review/.test(r.said) && !r.ask, r.said)
  }

  // Its turn in this chat is not the chat's goal.
  const goal = crew().agents.find(a => a.id === 'main').goal
  await fire('turn.start', { text: (await review('')).ask, turnId: 'T9' }, async () => ({}))
  check("the request's own turn doesn't become the chat's goal", crew().agents.find(a => a.id === 'main').goal === goal && crew().log.some(l => /starting a Crew Review/.test(l.text)), crew().log.map(l => l.text).slice(-3).join(' | '))
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 400)}`, false)
}
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
