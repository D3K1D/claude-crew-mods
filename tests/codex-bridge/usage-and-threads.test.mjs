// Codex Bridge: usage display, thread management, finding codex per OS, a faked run.
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
const NOW = Date.parse('2026-10-12T12:00:00Z')
Date.now = () => NOW

/** A fresh module and engine stub per OS. */
const setup = async ({ os, env, files = {}, dirs = {}, which = '' }) => {
  globalThis.__store = new Map()
  const { register } = await import(`../.build/codex-bridge.mjs?${os}${Math.random()}`)
  const fsFiles = { ...files }
  const ran = []
  const toasts = []
  const $ = {
    tool: { register: async () => {} },
    command: { register: async () => {} },
    session: { cwd: async () => '/work/game' },
    env: { get: async n => env[n] },
    ui: { open: async () => {}, status: () => {}, toast: async t => toasts.push(t), resolve: () => elements },
    store: { get: async () => undefined, set: async () => {} },
    clock: { after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
    state: { get: async () => ({ value: undefined }) },
    fs: {
      exists: async p => p in fsFiles || p in dirs,
      read: async p => { if (p in fsFiles) return fsFiles[p]; throw new Error('ENOENT ' + p) },
      write: async (p, t) => { fsFiles[p] = t },
      list: async p => (dirs[p] ?? []).map(name => ({ name })),
      stat: async p => ({ kind: 'file', size: (fsFiles[p] ?? '').length, mtimeMs: 1000 }),
    },
    process: {
      run: async argv => {
        ran.push(argv)
        if (argv[0] === 'uname') return { exitCode: 0, stdout: os === 'mac' ? 'Darwin\n' : 'Linux\n', stderr: '' }
        if (argv[0] === 'git' && argv.includes('rev-parse')) return { exitCode: 0, stdout: '/work/game\n', stderr: '' }
        if (argv[0] === 'git') return { exitCode: 0, stdout: '', stderr: '' }
        if (argv.includes('command -v codex') || argv[0] === 'where') return which ? { exitCode: 0, stdout: which + '\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: '' }
        if (argv[0] === 'rm' || argv.includes('del')) { delete fsFiles[argv[argv.length - 1].replace(/\\/g, '/')]; return { exitCode: 0, stdout: '', stderr: '' } }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      spawn: ({ argv }) => {
        ran.push(argv)
        const lines = [
          { type: 'thread.started', thread_id: 'sess-NEW' },
          { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'Done: chunk loading is async.' } },
          { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } },
        ]
        const it = (async function* () { for (const l of lines) yield { stream: 'stdout', text: JSON.stringify(l) + '\n' } })()
        return Object.assign(it, { result: Promise.resolve({ code: 0 }) })
      },
    },
  }
  const hooks = {}
  register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
  await hooks['session.start']($, {}, async () => ({}))
  await new Promise(r => setTimeout(r, 20))
  const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 120 }, viewport: { columns: 120 } })
  const tool = a => hooks['tool.call']($, { tool: 'mcp__codex-bridge__codex', tool_use_id: 't' + Math.random(), ...a }, Object.assign(async () => ({}), { signal: new AbortController().signal }))
  return { $, hooks, fsFiles, ran, toasts, render, tool }
}

const H = '/home/me/.codex'
const rollout = [
  JSON.stringify({ timestamp: '2026-10-12T10:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1 } } } }),
  JSON.stringify({ timestamp: '2026-10-12T11:30:00Z', type: 'event_msg', payload: { type: 'token_count', info: {}, rate_limits: { primary: { used_percent: 34, window_minutes: 10080, resets_at: NOW / 1000 + 3 * 86400 }, secondary: { used_percent: 92, window_minutes: 300, resets_at: NOW / 1000 + 5400 }, plan_type: 'prolite' } } }),
].join('\n')
const registry = {
  'chunk-loader': { name: 'chunk-loader', session: 'sess-1', created: 1, updated: NOW - 3600_000, runs: 3, model: 'gpt-6.1-sol', effort: 'high', last: 'Make chunk loading async' },
  'renderer-review': { name: 'renderer-review', session: 'sess-2', created: 1, updated: NOW - 7200_000, runs: 1, model: 'gpt-6-astra', effort: 'xhigh', last: 'Review the renderer' },
}

// ── Linux: usage, threads, finding codex ──
{
  const t = await setup({
    os: 'linux',
    env: { HOME: '/home/me' },
    files: {
      [`${H}/sessions/2026/10/12/rollout-a.jsonl`]: rollout,
      '/work/game/.codex-bridge/threads.json': JSON.stringify(registry),
      '/work/game/.codex-bridge/threads/chunk-loader.md': '# Codex thread: chunk-loader\n\n## run 1\n',
      '/home/me/.local/bin/codex': '#!',
    },
    dirs: { [`${H}/sessions`]: ['2026'], [`${H}/sessions/2026`]: ['09', '10'], [`${H}/sessions/2026/10`]: ['11', '12'], [`${H}/sessions/2026/10/12`]: ['rollout-a.jsonl'] },
  })
  const u = globalThis.__store.get('usage')
  check('usage read from the newest session log', u?.plan === 'prolite' && u.limits.length === 2 && u.limits[0].windowMinutes === 300 && u.limits[0].usedPercent === 92 && u.limits[1].usedPercent === 34, JSON.stringify(u))
  let tree = await t.render()
  const all = text(tree)
  check('pane shows plan and both limits', all.includes('Codex plan: Pro Lite') && all.includes('5-hour limit') && all.includes('92% used') && all.includes('weekly limit') && all.includes('34% used'), all.slice(0, 300))
  check('5-hour limit near full is red', find(tree, x => x.type === 'Text' && x.props.color === '#F85149' && /92% used/.test(text(x))).length === 1)
  check('reset times shown', all.includes('resets in 1h 30m'), all.match(/resets[^·]*/g)?.join(' | '))
  const r = await t.tool({ action: 'usage' })
  check('usage action for Claude', /weekly limit 34% used/.test(r.result) && /5-hour limit 92% used/.test(r.result), r.result)

  check('threads listed in the pane, newest first', all.indexOf('chunk-loader') < all.indexOf('renderer-review') && all.includes('3 runs'))
  // Rename through the pane: press rename, submit a name.
  await find(tree, x => x.props?.key === 'rename:/work/game::chunk-loader')[0].props.onPress()
  tree = await t.render()
  const input = find(tree, x => x.type === 'Input')[0]
  check('rename opens a field holding the name', input?.props.value === 'chunk-loader')
  input.props.onSubmit('Async chunks')
  await new Promise(r => setTimeout(r, 20))
  let reg = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  check('rename moves registry entry and log', reg['async-chunks']?.name === 'Async chunks' && !reg['chunk-loader'] && t.fsFiles['/work/game/.codex-bridge/threads/async-chunks.md']?.startsWith('# Codex thread: Async chunks') && !('/work/game/.codex-bridge/threads/chunk-loader.md' in t.fsFiles), JSON.stringify(Object.keys(reg)))
  tree = await t.render()
  check('pane shows the new name', text(tree).includes('Async chunks'))
  await find(tree, x => x.props?.key === 'reset:/work/game::async-chunks')[0].props.onPress()
  await new Promise(r => setTimeout(r, 20))
  reg = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  check('fresh start forgets the session, keeps the thread', reg['async-chunks'].session === '' && reg['async-chunks'].runs === 3)
  await find(tree, x => x.props?.key === 'archive:/work/game::renderer-review')[0].props.onPress()
  await new Promise(r => setTimeout(r, 20))
  tree = await t.render()
  check('archived thread hidden', !text(tree).includes('renderer-review') && text(tree).includes('1 archived'))
  await find(tree, x => x.props?.key === 'show-archived')[0].props.onPress()
  tree = await t.render()
  check('show archived brings it back with restore', text(tree).includes('renderer-review') && find(tree, x => x.props?.key === 'archive:/work/game::renderer-review')[0] && text(find(tree, x => x.props?.key === 'archive:/work/game::renderer-review')[0]) === 'restore')
  await find(tree, x => x.props?.key === 'delete:/work/game::renderer-review')[0].props.onPress()
  tree = await t.render()
  check('delete asks for a second press', text(tree).includes('press again to delete') && JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])['renderer-review'])
  await find(tree, x => x.props?.key === 'delete-yes:/work/game::renderer-review')[0].props.onPress()
  await new Promise(r => setTimeout(r, 20))
  check('second press deletes it', !JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])['renderer-review'] && t.ran.some(a => a[0] === 'rm'))
  const rr = await t.tool({ action: 'rename_thread', thread: 'async-chunks', new_name: 'chunks' })
  check('rename_thread action for Claude', /Renamed thread "Async chunks" to "chunks"/.test(rr.result), rr.result)

  // A run on an archived thread: found codex in ~/.local/bin, resumes nothing (reset), unarchives, usage line in result.
  await t.tool({ action: 'archive_thread', thread: 'chunks' })
  const run = await t.tool({ task: 'Continue the chunk work', thread: 'chunks' })
  const spawned = t.ran.find(a => a[0] === '/home/me/.local/bin/codex')
  check('found codex in ~/.local/bin and ran it', !!spawned && spawned[1] === 'exec' && spawned[2] !== 'resume', JSON.stringify(spawned))
  reg = JSON.parse(t.fsFiles['/work/game/.codex-bridge/threads.json'])
  check('using an archived thread restores it, with the new session', reg.chunks.archived === false && reg.chunks.session === 'sess-NEW' && reg.chunks.runs === 4)
  check('result tells Claude the plan usage', /Codex plan usage: 5-hour limit 92% used/.test(run.result), run.result)
}

// ── Windows: codex from the desktop app's versioned folder, paths with forward slashes ──
{
  const L = 'C:/Users/me/AppData/Local'
  const t = await setup({
    os: 'win',
    env: { OS: 'Windows_NT', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', USERPROFILE: 'C:\\Users\\me' },
    files: { [`${L}/OpenAI/Codex/bin/abc123/codex.exe`]: 'MZ' },
    dirs: { [`${L}/OpenAI/Codex/bin`]: ['abc123'] },
  })
  await t.tool({ task: 'hello' })
  check('Windows: codex.exe from the app folder', t.ran.some(a => a[0] === `${L}/OpenAI/Codex/bin/abc123/codex.exe`), JSON.stringify(t.ran.filter(a => /codex/.test(a[0]))))
  check('Windows: no usage yet says why', /has not recorded any usage yet/.test(globalThis.__store.get('usage').missing))
}
// ── Windows with only npm's codex.cmd ──
{
  const t = await setup({ os: 'win', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me' }, which: 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd' })
  await t.tool({ task: 'hello' })
  check('Windows npm shim runs through cmd', t.ran.some(a => a[0] === 'cmd' && a[3] === 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd' && a[4] === 'exec'), JSON.stringify(t.ran.filter(a => a[0] === 'cmd')))
}
// ── macOS: Codex.app ──
{
  const t = await setup({ os: 'mac', env: { HOME: '/Users/me' }, files: { '/Applications/Codex.app/Contents/Resources/codex': 'x' } })
  await t.tool({ task: 'hello' })
  check('macOS: codex inside Codex.app', t.ran.some(a => a[0] === '/Applications/Codex.app/Contents/Resources/codex'))
}
console.log(`\n${fails} failing check(s)`)
