// Codex Bridge under stress: a silent Codex stopped by the button or the clock, thread changes
// refused mid-run, the NOTES.md split, name collisions, odd model names, safe deletion, usage
// from an older log, git paths with spaces.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Input: el('Input') }
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const tick = () => new Promise(r => setTimeout(r, 15))

/** A Codex process that prints the given lines and then waits, silent, until it is closed. */
const silentCodex = lines => {
  const queue = [...lines]
  let wake
  let closed = false
  let resolveResult
  const it = {
    [Symbol.asyncIterator]() { return this },
    async next() {
      if (queue.length) return { value: { stream: 'stdout', text: `${JSON.stringify(queue.shift())}\n` }, done: false }
      if (closed) return { value: undefined, done: true }
      await new Promise(r => { wake = r })
      return { value: undefined, done: true }
    },
    async return() {
      closed = true
      it.killed = true
      wake?.()
      resolveResult({ code: null, signal: 'SIGTERM' })
      return { value: undefined, done: true }
    },
    result: new Promise(r => { resolveResult = r }),
    killed: false,
  }
  return it
}

const setup = async ({ os = 'linux', files = {}, dirs = {}, spawn, gitStatus = '', gitNumstat = '', slowGit = 0 }) => {
  globalThis.__store = new Map()
  const { register } = await import(`../.build/codex-bridge.mjs?${Math.random()}`)
  const fsFiles = { ...files }
  const ran = []
  const timers = []
  const env = os === 'win' ? { OS: 'Windows_NT', USERPROFILE: 'C:/Users/me' } : { HOME: '/home/me' }
  const $ = {
    tool: { register: async () => {} },
    command: { register: async () => {} },
    session: { cwd: async () => (os === 'win' ? 'c:/users/me/game' : '/work/game') },
    env: { get: async n => env[n] },
    ui: { open: async () => {}, status: () => {}, toast: async () => {}, resolve: () => elements },
    store: { get: async () => undefined, set: async () => {} },
    state: { get: async () => ({}) },
    clock: { after: (ms, fn) => { const t = { ms, fn, cancel() { t.dead = true } }; timers.push(t); return t }, every: () => ({ cancel() {} }) },
    fs: {
      exists: async p => p in fsFiles || p in dirs,
      read: async p => { if (p in fsFiles) return fsFiles[p]; throw new Error('ENOENT') },
      write: async (p, t) => { fsFiles[p] = t },
      list: async p => (dirs[p] ?? []).map(name => ({ name })),
      stat: async p => ({ kind: 'file', size: (fsFiles[p] ?? 'x').length, mtimeMs: fsFiles[`${p}#mtime`] ?? 1000 }),
    },
    process: {
      run: async argv => {
        ran.push(argv)
        if (argv[0] === 'uname') return { exitCode: 0, stdout: 'Linux\n', stderr: '' }
        if (argv.includes('rev-parse')) return { exitCode: 0, stdout: os === 'win' ? 'C:/Users/me/game\n' : '/work/game\n', stderr: '' }
        if (argv.includes('status')) {
          if (slowGit) await new Promise(r => setTimeout(r, slowGit))
          return { exitCode: 0, stdout: gitStatus, stderr: '' }
        }
        if (argv.includes('--numstat')) return { exitCode: 0, stdout: gitNumstat, stderr: '' }
        if (argv[0] === 'git') return { exitCode: 0, stdout: '', stderr: '' }
        if (argv.includes('command -v codex') || argv[0] === 'where') return { exitCode: 0, stdout: os === 'win' ? 'C:/codex/codex.exe\n' : '/usr/local/bin/codex\n', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      spawn: req => (ran.push(req.argv), spawn()),
    },
  }
  if (os !== 'win') fsFiles['/usr/local/bin/codex'] = '#!'
  const hooks = {}
  register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
  await hooks['session.start']($, {}, async () => ({}))
  await tick()
  const tool = a => hooks['tool.call']($, { tool: 'mcp__codex-bridge__codex', tool_use_id: `t${Math.random()}`, ...a }, Object.assign(async () => ({}), { signal: new AbortController().signal }))
  const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 120 }, viewport: { columns: 120 } })
  return { fsFiles, ran, timers, tool, render }
}

// ── The stop button ends a Codex that has gone quiet ──
{
  let child
  const t = await setup({ spawn: () => (child = silentCodex([{ type: 'thread.started', thread_id: 's1' }])), files: { '/work/game/.codex-bridge/threads.json': JSON.stringify({ build: { name: 'build', session: '', created: 1, updated: 1, runs: 1, model: 'm', effort: 'e', last: 'x' } }) } })
  const pending = t.tool({ task: 'Think for a long time', thread: 'build' })
  await tick()
  const tree = await t.render()
  check('a quiet run shows a stop button', !!find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('stop-'))[0])
  // While it runs, the thread can't be renamed or deleted.
  const renameTry = await t.tool({ action: 'rename_thread', thread: 'build', new_name: 'compile' })
  check('renaming a running thread is refused', /running right now/.test(renameTry.result), renameTry.result)
  find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('stop-'))[0].props.onPress()
  const r = await Promise.race([pending, new Promise(res => setTimeout(() => res('hung'), 1500))])
  check('stop ends it without waiting for output', r !== 'hung' && /was stopped/.test(r.result), typeof r === 'string' ? r : r.result.split('\n')[0])
  check('the Codex process was closed (killed)', child.killed)
  check('the deadline timer was cleared', t.timers.every(x => x.dead))
}

// ── The timeout ends it too ──
{
  let child
  const t = await setup({ spawn: () => (child = silentCodex([])) })
  const pending = t.tool({ task: 'Hang', timeout_minutes: 1 })
  await tick()
  t.timers.find(x => !x.dead)?.fn()
  const r = await Promise.race([pending, new Promise(res => setTimeout(() => res('hung'), 1500))])
  check('the timeout ends a quiet Codex', r !== 'hung' && /stopped after 1 min/.test(r.result), typeof r === 'string' ? r : r.result.split('\n')[0])
  check('...by closing it', child.killed)
}

// ── NOTES.md: only the last heading starts the notes ──
{
  const answer = 'I read the notes.\n\n## NOTES.md\n\nThe old section on NOTES.md was out of date, so I fixed the build steps.\n\n### NOTES.md\n# Project notes\n- build with cargo\n- tests in tests/'
  const t = await setup({ spawn: () => silentCodex([{ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: answer } }, { type: 'turn.completed', usage: {} }]) })
  // This Codex prints and then ends by itself.
  const spawnDone = t.tool({ task: 'Review the notes' })
  await tick()
  t.timers.find(x => !x.dead)?.fn()
  const r = await spawnDone
  check('the answer keeps an earlier "## NOTES.md" heading', r.result.includes('The old section on NOTES.md was out of date'), r.result.slice(0, 200))
  check('NOTES.md gets only the part after the last heading', t.fsFiles['/work/game/.codex-bridge/NOTES.md'] === '# Project notes\n- build with cargo\n- tests in tests/\n', JSON.stringify(t.fsFiles['/work/game/.codex-bridge/NOTES.md']))
}

// ── Names that share a slug get their own threads; odd model names never reach the command line ──
{
  const t = await setup({ spawn: () => silentCodex([{ type: 'thread.started', thread_id: 'new' }]), files: { '/work/game/.codex-bridge/threads.json': JSON.stringify({ 'foo-bar': { name: 'foo-bar', session: 'old', created: 1, updated: 1, runs: 2, model: 'm', effort: 'e', last: 'x' } }) } })
  const p = t.tool({ task: 'x', thread: 'Foo Bar' })
  await tick()
  const argv = t.ran.find(a => Array.isArray(a) && a.includes('exec'))
  check('"Foo Bar" does not continue "foo-bar"', argv && !argv.includes('resume'), JSON.stringify(argv))
  t.timers.find(x => !x.dead)?.fn()
  await p
  const reg = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  check('both threads are kept', reg['foo-bar']?.runs === 2 && Object.values(reg).some(x => x.name === 'Foo Bar'), Object.keys(reg).join(','))
  const bad = await t.tool({ task: 'x', model: 'gpt&calc' })
  check('a model name with shell characters is refused', /plain names/.test(bad.result))
}

// ── Windows: deleting a thread's log goes through PowerShell's Remove-Item, quoted ──
{
  const root = 'C:/Users/me/game'
  const t = await setup({
    os: 'win',
    spawn: () => silentCodex([]),
    files: { [`${root}/.codex-bridge/threads.json`]: JSON.stringify({ old: { name: 'old', session: '', created: 1, updated: 1, runs: 1, model: 'm', effort: 'e', last: 'x' } }), [`${root}/.codex-bridge/threads/old.md`]: '# log' },
    dirs: { 'C:/codex': ['codex.exe'] },
  })
  const tree = await t.render()
  find(tree, x => x.type === 'Button' && x.props.key === `delete:${root}::old`)[0].props.onPress()
  const tree2 = await t.render()
  find(tree2, x => x.type === 'Button' && x.props.key === `delete-yes:${root}::old`)[0].props.onPress()
  await tick()
  const del = t.ran.find(a => a[0] === 'powershell' && a.join(' ').includes('Remove-Item'))
  check('Windows deletes with Remove-Item -LiteralPath, single-quoted', del && del[4] === "Remove-Item -LiteralPath 'C:\\Users\\me\\game\\.codex-bridge\\threads\\old.md' -Force -ErrorAction SilentlyContinue", JSON.stringify(del))
  check('cmd is never used to delete', !t.ran.some(a => a[0] === 'cmd' && a.includes('del')))
}

// ── Usage: the newest log without limits is skipped for one that has them ──
{
  const H = '/home/me/.codex/sessions'
  const t = await setup({
    spawn: () => silentCodex([]),
    files: {
      [`${H}/2026/10/14/rollout-new.jsonl`]: '{"type":"session_meta"}',
      [`${H}/2026/10/14/rollout-new.jsonl#mtime`]: 3000,
      [`${H}/2026/10/12/rollout-old.jsonl`]: JSON.stringify({ timestamp: '2026-10-12T10:00:00Z', payload: { rate_limits: { primary: { used_percent: 61, window_minutes: 10080, resets_at: 1 } } } }),
      [`${H}/2026/10/12/rollout-old.jsonl#mtime`]: 2000,
    },
    dirs: { [H]: ['2026'], [`${H}/2026`]: ['10'], [`${H}/2026/10`]: ['12', '14'], [`${H}/2026/10/14`]: ['rollout-new.jsonl'], [`${H}/2026/10/12`]: ['rollout-old.jsonl'] },
  })
  const u = globalThis.__store.get('usage')
  check('usage comes from the newest log that has limits', u.limits[0]?.usedPercent === 61, JSON.stringify(u))
}

// ── git is asked for NUL-separated output, so paths with spaces or odd characters come back whole ──
{
  const t = await setup({ spawn: () => silentCodex([]) })
  const run = t.tool({ task: 'edit', mode: 'write' })
  await tick()
  check('git status is read NUL-separated, with no renames', t.ran.some(a => a.includes('status') && a.includes('-z') && a.includes('--no-renames')))
  check('so is git diff --numstat', t.ran.some(a => a.includes('--numstat') && a.includes('-z') && a.includes('--no-renames')))
  t.timers.find(x => !x.dead)?.fn()
  await run
}

// ── A session id goes on the command line: plain ids only ──
{
  const t = await setup({ spawn: () => silentCodex([]) })
  const r = await t.tool({ task: 'x', session_id: 'abc&calc' })
  check('a session id with shell characters is refused', /plain id/.test(r.result), r.result)
  check('...and nothing was spawned', !t.ran.some(a => Array.isArray(a) && a.includes('exec')))
}

// ── Nothing that reaches Codex's command line can look like an option ──
{
  const t = await setup({ spawn: () => silentCodex([]) })
  for (const [arg, value] of [['session_id', '--dangerously-bypass-approvals-and-sandbox'], ['session_id', '-c'], ['model', '--yolo'], ['model', '-c'], ['effort', '--x']]) {
    const r = await t.tool({ task: 'x', [arg]: value })
    check(`${arg} "${value}" is refused`, /starts? with a letter or digit/.test(r.result), r.result)
  }
  check('...and Codex was never started', !t.ran.some(a => Array.isArray(a) && a.includes('exec')))
}

// ── A repository's own threads.json cannot steer paths or sessions ──
{
  const hostile = {
    '../../../escape': { name: 'escape', session: 'ok1', created: 1, updated: 1, runs: 1, model: 'm', effort: 'e', last: 'x' },
    good: { name: 'good', session: '--dangerously-bypass-approvals-and-sandbox', created: 1, updated: 1, runs: 1, model: 'm', effort: 'e', last: 'x' },
    weird: 'not an object',
  }
  const t = await setup({ spawn: () => silentCodex([{ type: 'thread.started', thread_id: 'fresh1' }]), files: { '/work/game/.codex-bridge/threads.json': JSON.stringify(hostile) } })
  const p = t.tool({ task: 'x', thread: 'escape' })
  await tick()
  const argv = t.ran.find(a => Array.isArray(a) && a.includes('exec'))
  check('a key with ../ in it is ignored', argv && !argv.includes('ok1'), JSON.stringify(argv))
  t.timers.find(x => !x.dead)?.fn()
  await p
  check('no file is written outside .codex-bridge', Object.keys(t.fsFiles).every(f => !f.includes('escape') || f.startsWith('/work/game/.codex-bridge/threads/')), Object.keys(t.fsFiles).join(', '))
  t.ran.length = 0
  const q = t.tool({ task: 'x', thread: 'good' })
  await tick()
  const argv2 = t.ran.find(a => Array.isArray(a) && a.includes('exec'))
  check('a session id from the file that looks like an option is never passed', argv2 && !argv2.some(x => String(x).startsWith('--danger')) && !argv2.includes('resume'), JSON.stringify(argv2))
  t.timers.find(x => !x.dead)?.fn()
  await q
}

// ── Non-Latin names: each gets its own thread, and the tool's actions find the right one ──
{
  const reg = { thread: { name: '認証', session: 'a', created: 1, updated: 1, runs: 1, model: 'm', effort: 'e', last: 'x' } }
  const t = await setup({ spawn: () => silentCodex([{ type: 'thread.started', thread_id: 'b' }]), files: { '/work/game/.codex-bridge/threads.json': JSON.stringify(reg) } })
  const p = t.tool({ task: 'x', thread: '描画' })
  await tick()
  t.timers.find(x => !x.dead)?.fn()
  await p
  const after = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  const drawKey = Object.keys(after).find(k => after[k].name === '描画')
  check('a second non-Latin name gets its own key', drawKey && drawKey !== 'thread' && after.thread.name === '認証', Object.keys(after).join(','))
  const arch = await t.tool({ action: 'archive_thread', thread: '描画' })
  const now2 = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  check('archive_thread finds it by name, not by slug', /Archived thread "描画"/.test(arch.result) && now2[drawKey].archived === true && !now2.thread.archived, arch.result)
  const back = await t.tool({ action: 'restore_thread', thread: '描画' })
  check('restore_thread brings it back', /Restored thread "描画"/.test(back.result), back.result)
  const empty = await t.tool({ action: 'reset_thread', thread: '' })
  check('a thread action without a name says so', /Name the thread/.test(empty.result), empty.result)
}

// ── A rate limit on resume keeps the thread's conversation ──
{
  const reg = { work: { name: 'work', session: 'keepme', created: 1, updated: 1, runs: 3, model: 'm', effort: 'e', last: 'x' } }
  let spawns = 0
  const t = await setup({
    spawn: () => {
      spawns++
      const it = (async function* () {
        yield { stream: 'stdout', text: `${JSON.stringify({ type: 'thread.started', thread_id: 'keepme' })}\n${JSON.stringify({ type: 'turn.failed', error: { message: 'usage limit reached' } })}\n` }
      })()
      return Object.assign(it, { result: Promise.resolve({ code: 1 }) })
    },
    files: { '/work/game/.codex-bridge/threads.json': JSON.stringify(reg) },
  })
  await t.tool({ task: 'continue', thread: 'work' })
  const after = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  check('a failure after the session opened does not start over', spawns === 1, String(spawns))
  check('...and the thread keeps its conversation', after.work.session === 'keepme', after.work.session)
}

// ── Stop before Codex starts: it never starts ──
{
  // Git takes a moment, as it does in a big repository: the run is listed, Codex not yet started.
  const t = await setup({ spawn: () => silentCodex([]), slowGit: 200 })
  const p = t.tool({ task: 'x' })
  await tick()
  const tree = await t.render()
  find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('stop-'))[0]?.props.onPress()
  const r = await Promise.race([p, new Promise(res => setTimeout(() => res('hung'), 1500))])
  check('stop before the spawn ends the run', r !== 'hung' && /stopped/.test(r.result), typeof r === 'string' ? r : r.result.split('\n')[0])
  check('...without starting Codex', !t.ran.some(a => Array.isArray(a) && a.includes('exec')), JSON.stringify(t.ran.filter(a => Array.isArray(a) && a.includes('exec'))))
}

// ── A long run is never pushed out of the list by newer ones ──
{
  const t = await setup({ spawn: () => silentCodex([]) })
  const long = t.tool({ task: 'long one' })
  await tick()
  for (let i = 0; i < 18; i++) {
    const q = t.tool({ task: `short ${i}` })
    await tick()
    t.timers.filter(x => !x.dead).slice(-1)[0]?.fn()
    await q
  }
  const runs = globalThis.__store.get('runs')
  check('the long run is still listed after 18 newer ones', runs.some(r => r.task === 'long one' && r.status === 'running'), String(runs.length))
  t.timers.find(x => !x.dead)?.fn()
  await long
}
console.log(`\n${fails} failing check(s)`)
