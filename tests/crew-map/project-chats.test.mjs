// Chats working in this project that this chat did not start: listed from the app's whole chat list
// (one read gives the nested chats too), only those in the same repository (its worktrees included) or
// folder, not archived, the newest few; their files read as nested chats' are.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T10:00:00Z')
Date.now = () => now
const LIST = 'mcp__ccd_session_mgmt__list_sessions'
const at = m => new Date(now - m * 60_000).toISOString()
const row = (id, cwd, o = {}) => ({ sessionId: id, title: id, cwd, isArchived: false, isRunning: false, lastActivityAt: at(5), ...o })
// The whole list, as the app gives it (this chat left out).
const all = [
  row('local_kid', 'C:\\work\\game', { name: 'kid', startedBy: 'local_me', isRunning: true, lastActivityAt: at(1) }),
  row('local_same', 'C:\\work\\game', { isRunning: true, lastActivityAt: at(2) }),
  row('local_tree', 'C:\\work\\game\\.claude\\worktrees\\fix', { lastActivityAt: at(3) }),
  row('local_sub', 'C:\\work\\game\\tools', { lastActivityAt: at(4) }),
  row('local_other', 'C:\\work\\gamer', { lastActivityAt: at(1) }),
  row('local_away', 'D:\\elsewhere', { lastActivityAt: at(1) }),
  row('local_old', 'C:\\work\\game', { isArchived: true, lastActivityAt: at(1) }),
  ...Array.from({ length: 6 }, (_, i) => row(`local_more${i}`, 'C:\\work\\game', { lastActivityAt: at(10 + i) })),
]
const calls = []
const disk = new Map()
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: {
    read: async p => (disk.has(p) ? disk.get(p) : Promise.reject(new Error('none'))),
    exists: async p => disk.has(p),
    write: async (p, t) => void disk.set(p, t),
    list: async p => [...disk.keys()].filter(k => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/')).map(k => ({ name: k.slice(p.length + 1), kind: 'file', mtimeMs: 1 })),
  },
  store: { get: async () => undefined, set: async () => {} },
  // (A worktree of the repository: git names the main checkout's .git.)
  session: { cwd: async () => 'C:/work/game/.claude/worktrees/me', id: async () => 'cli-me' },
  env: { get: async n => ({ USERPROFILE: 'C:/home', CLAUDE_CODE_HOST_SESSION_ID: 'local_me', OS: 'Windows_NT' })[n] },
  state: { get: async () => ({ value: [] }) },
  process: { run: async ({ 0: cmd } = []) => (cmd === 'git' ? { exitCode: 0, stdout: 'C:/work/game/.git\n', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }) },
  tool: {
    check: async () => ({ decision: 'allow' }),
    call: async e => fire('tool.call', { ...e, tool_use_id: `p${calls.length}` }, async () => (calls.push(e), { result: {}, text: JSON.stringify(e.linked ? all.filter(r => r.startedBy === 'local_me') : all) })),
  },
}
// (process.run takes the argv itself.)
$.process.run = async argv => (argv[0] === 'git' ? { exitCode: 0, stdout: 'C:/work/game/.git\n', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' })
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

try {
  await fire('session.start', {}, async () => ({}))
  for (let i = 0; i < 10 && !crew().siblings; i++) await tick()
  check('one read of the whole list (this chat known by its app id)', calls.length >= 1 && calls.every(e => !e.linked && e.limit === 100), JSON.stringify(calls))
  check('the nested chats come from it as before', (crew().chats ?? []).map(x => x.id).join(',') === 'local_kid', JSON.stringify(crew().chats))
  const ids = (crew().siblings ?? []).map(x => x.id)
  check('same-project chats: the same folder, a worktree of the repository, a folder inside it', ['local_same', 'local_tree', 'local_sub'].every(x => ids.includes(x)), ids.join(','))
  check('...not a nested one (shown as nested), another project, a folder that only starts alike, or an archived chat', !['local_kid', 'local_other', 'local_away', 'local_old'].some(x => ids.includes(x)), ids.join(','))
  check('...the newest 6 at most, newest first', ids.length === 6 && ids.join(',') === 'local_same,local_tree,local_sub,local_more0,local_more1,local_more2', ids.join(','))
  check('...each with its folder, running or not, and when last active', crew().siblings[0].running === true && crew().siblings[1].cwd === 'C:/work/game/.claude/worktrees/fix' && crew().siblings[0].at === now - 2 * 60_000)
  // Claude's own read of the whole list keeps them current too.
  all.push(row('local_new', 'C:\\work\\game', { lastActivityAt: at(0) }))
  await fire('tool.call', { tool: LIST_TOOL_NAME(), tool_use_id: 'mine', limit: 20 }, async () => ({ result: {}, text: JSON.stringify(all) }))
  check("Claude's own look at the list updates them", crew().siblings?.[0]?.id === 'local_new', (crew().siblings ?? []).map(x => x.id).join(','))
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 400)}`, false)
}
function LIST_TOOL_NAME() { return LIST }
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
