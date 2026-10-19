// The bridge refuses write mode in a chat's scratch folder before spawning anything.
globalThis.h = (t, p, ...c) => ({ type: t, props: { ...(p || {}), children: c.flat(Infinity) } })
globalThis.__store = new Map()
const { register } = await import('../.build/codex-bridge.mjs')
const hooks = {}
const $ = {
  tool: { register: async () => {} },
  command: { register: async () => {} },
  session: { cwd: async () => 'C:/Users/me/AppData/Roaming/Claude/scratch-workspaces/abc/def/scratch-1' },
  ui: { open: async () => {}, status: () => {}, toast: async () => {} },
  env: { get: async n => ({ OS: 'Windows_NT', LOCALAPPDATA: 'C:/x', USERPROFILE: 'C:/Users/me' })[n] },
  state: { get: async () => ({}) },
  fs: { exists: async () => false, read: async () => { throw new Error('none') }, list: async () => [], stat: async () => ({}) },
  process: {
    run: async argv => (argv[0] === 'git' ? { exitCode: 128, stdout: '', stderr: '' } : { exitCode: 0, stdout: 'C:/x|C:/Users/me|', stderr: '' }),
    spawn: () => { throw new Error('must not spawn') },
  },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
const next = Object.assign(async () => ({}), { signal: new AbortController().signal })
const r = await hooks['tool.call']($, { tool: 'mcp__codex-bridge__codex', tool_use_id: 't', task: 'do a thing', mode: 'write' }, next)
const ok = /write mode does not work in this chat's own scratch folder/.test(r.result) && !(globalThis.__store.get('runs') ?? []).length
console.log(ok ? 'PASS write mode in a scratch folder is refused with a clear message, nothing spawned' : 'FAIL ' + r.result)
