import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, PaneUi, Registry, Run, RunEvent, Touch, Usage } from '../types'

// ─── State ──────────────────────────────────────────────────────────────────

const PANE = 'codex-bridge'
/** Shown in the pane's header, so it is plain which version a chat is running. Keep in step with plugin.json. */
const VERSION = '1.2.2'
const TOOL = 'codex'
const MAX_RUNS = 16
const MAX_EVENTS = 60
const MAX_TOUCHED = 40
const MEMORY_DIR = '.codex-bridge'

const runs = atom({ plugin: 'codex-bridge', key: 'runs' } as const, [] as Run[])
const usage = atom({ plugin: 'codex-bridge', key: 'usage' } as const, { plan: '', limits: [], seenAt: 0, readAt: 0, missing: '' } as Usage)
const threads = atom({ plugin: 'codex-bridge', key: 'threads' } as const, {} as Record<string, Registry>)
const paneUi = atom({ plugin: 'codex-bridge', key: 'ui' } as const, { renaming: '', confirmDelete: '', showArchived: false } as PaneUi)

/** Stop switches for runs in flight, by run id. A reload drops them with the runs. */
const stops = new Map<string, () => void>()
/** The editor files open in: the crew-map mod's choice when it is installed ('code', 'cursor' or 'system'). */
let editor = 'code'
/** Whether the Codex CLI was found when the session started (the pane says how to install it when not). */
let cliFound: boolean | undefined
/** An editor's name as a person knows it. */
const editorName = (id: string) => ({ code: 'VS Code', cursor: 'Cursor' })[id] ?? id
let tempDir = ''

let platform: 'win' | 'mac' | 'linux' | undefined
/** Which OS this runs on: Windows says so in OS; elsewhere uname tells macOS from Linux. */
const platformOf = async ($: EngineInterface) => {
  if (platform) return platform
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return (platform = 'win')
  const u = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined)
  return (platform = /darwin/i.test(u?.stdout ?? '') ? 'mac' : 'linux')
}

/** A PowerShell single-quoted literal: nothing inside is read as code (quote marks, curly ones too, are doubled). */
const psq = (s: string) => `'${s.replace(/['‘’‚‛]/g, m => m + m)}'`
/** Characters cmd.exe acts on even inside an argument: a path holding one never goes through cmd. */
const CMD_META = /[&|<>^%!"]/

/** Deletes one file (there is no $.fs call for it): PowerShell's Remove-Item on Windows, `rm` elsewhere. */
const removeFile = async ($: EngineInterface, path: string) => {
  const argv =
    (await platformOf($)) === 'win'
      ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath ${psq(path.replace(/\//g, '\\'))} -Force -ErrorAction SilentlyContinue`]
      : ['rm', '-f', path]
  await $.process.run(argv, { timeoutMs: 15_000 }).catch(() => undefined)
}

/**
 * Opens a file in the person's editor. A file Codex changed, inside a git
 * repository, opens as a diff against HEAD in VS Code or Cursor; anything
 * else opens plainly. 'system' hands the file to the OS default app.
 */
const openInEditor = async ($: EngineInterface, path: string, root: string, diff = true) => {
  const os = await platformOf($)
  const isWin = os === 'win'
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 20_000 }).catch(() => undefined)
  // Editors' command-line launchers are .cmd scripts on Windows, which only cmd runs; cmd would act on
  // `&`, `|` or `%` in a path, so such a path opens through Explorer instead (the default app, no diff).
  const shell = (argv: string[]) => (isWin ? ['cmd', '/d', '/c', ...argv] : argv)
  const viaExplorer = isWin && CMD_META.test(path)
  if (editor === 'system' || viaExplorer) {
    await run(isWin ? ['explorer', path.replace(/\//g, '\\')] : os === 'mac' ? ['open', path] : ['xdg-open', path])
    return
  }
  const canDiff = /^(code|cursor|codium|windsurf)$/.test(editor)
  if (diff && canDiff && root && path.startsWith(`${root}/`)) {
    const head = await run(['git', '-C', root, 'show', `HEAD:${path.slice(root.length + 1)}`])
    if (head?.exitCode === 0) {
      if (!tempDir) tempDir = norm((await $.env.get('TEMP').catch(() => undefined)) || (await $.env.get('TMPDIR').catch(() => undefined)) || (isWin ? 'C:/Windows/Temp' : '/tmp'))
      const name = baseName(path)
      const dot = name.lastIndexOf('.')
      // One folder per file, so two files with one name keep their own copies.
      const before = `${tempDir}/codex-HEAD/${hashOf(path)}/${dot > 0 ? `${name.slice(0, dot)} (HEAD)${name.slice(dot)}` : `${name} (HEAD)`}`
      if (await $.fs.write(before, head.stdout).then(() => true, () => false)) {
        await run(shell([editor, '--diff', before, path]))
        return
      }
    }
  }
  await run(shell(canDiff ? [editor, '-g', path] : [editor, path]))
}
const hashOf = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
/** The git top level of this session's folder (else the folder): whose threads the pane shows first. */
let sessionRoot = ''
let codexPath: string | undefined
let dirs: { local: string; home: string; codexHome: string } | undefined

type Model = { slug: string; name: string; description: string; efforts: string[]; defaultEffort: string }
let models: Model[] = []
let defaults = { model: '', effort: '' }

// ─── Helpers ────────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
/** A count in at most five characters: 7, 950, 1.2k, 12k, 1.0M, 33M. */
const fmtK = (v: number) => {
  let n = Math.max(0, Number(v) || 0)
  if (n < 999.5) return String(Math.round(n))
  let u = 0
  while (n >= 999.5 && u < 4) {
    n /= 1000
    u++
  }
  return `${n < 9.95 ? n.toFixed(1) : Math.round(n)}${['', 'k', 'M', 'B', 'T'][u]}`
}
const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
const stamp = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 60) || 'thread'

/** A path as the crew map keys files: forward slashes, `..` resolved, drive letter upper case. */
const norm = (p: string) => {
  const raw = p.replace(/\\/g, '/')
  const parts: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  const out = (raw.startsWith('/') ? '/' : '') + parts.join('/')
  return out.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`)
}
const isAbs = (p: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(p)
const join = (dir: string, p: string) => norm(isAbs(p) ? p : `${dir}/${p}`)

/** The command Codex ran, without the shell wrapper it adds on Windows. */
const bareCommand = (cmd: string) => {
  const inner =
    cmd.match(/(?:powershell(?:\.exe)?"?|pwsh(?:\.exe)?"?)\s+(?:-\w+\s+)*?-Command\s+([\s\S]*)$/i)?.[1] ??
    cmd.match(/^(?:\S*\/)?(?:bash|sh|zsh)\s+-l?c\s+([\s\S]*)$/)?.[1]
  if (inner === undefined) return oneLine(cmd)
  let s = inner.trim()
  if (/^['"]/.test(s)) s = s.slice(1)
  if (/['"]$/.test(s)) s = s.slice(0, -1)
  return oneLine(s.replace(/''/g, "'"))
}

/** Paths a command names: tokens that look like files with an extension. */
const pathsIn = (cmd: string) => {
  const out = new Set<string>()
  for (const m of cmd.matchAll(/(?:^|[\s'"(=,])((?:[A-Za-z]:)?[\w./\\-]*[\w-]\.(?:rs|toml|ts|tsx|js|jsx|mjs|py|md|json|ya?ml|c|cc|cpp|h|hpp|cs|go|java|kt|lua|txt|css|scss|html|sh|ps1|glsl|wgsl|hlsl))(?=$|[\s'"):,;])/g))
    out.add(m[1])
  return [...out].slice(0, 8)
}

/** Where things live: Windows' local app data (Windows only), the home folder and Codex's home (CODEX_HOME, else ~/.codex). */
const findDirs = async ($: EngineInterface) => {
  if (dirs) return dirs
  const clean = (v: string | undefined) => (v?.trim() ? norm(v.trim()) : '')
  const local = clean(await $.env.get('LOCALAPPDATA').catch(() => undefined))
  const home = clean(await $.env.get('USERPROFILE').catch(() => undefined)) || clean(await $.env.get('HOME').catch(() => undefined))
  const codexHome = clean(await $.env.get('CODEX_HOME').catch(() => undefined))
  dirs = { local, home, codexHome: codexHome || (home ? `${home}/.codex` : '') }
  return dirs
}

/**
 * Finds codex: on Windows the newest CLI the Codex desktop app ships (under a
 * versioned folder that changes as it updates); on macOS the one inside
 * Codex.app; then the usual install places and whatever is on PATH.
 */
const findCodex = async ($: EngineInterface): Promise<string | undefined> => {
  if (codexPath && (await $.fs.exists(codexPath).catch(() => false))) return codexPath
  codexPath = undefined
  const os = await platformOf($)
  const { local, home } = await findDirs($)
  const has = (p: string) => $.fs.exists(p).catch(() => false)
  if (os === 'win' && local) {
    const bin = `${local}/OpenAI/Codex/bin`
    let best: { path: string; at: number } | undefined
    for (const d of await $.fs.list(bin).catch(() => [])) {
      const exe = `${bin}/${d.name}/codex.exe`
      if (!(await has(exe))) continue
      const at = (await $.fs.stat(exe).catch(() => undefined))?.mtimeMs ?? 0
      if (!best || at > best.at) best = { path: exe, at }
    }
    if (best) return (codexPath = best.path)
  }
  const places =
    os === 'win'
      ? []
      : [
          ...(os === 'mac' ? ['/Applications/Codex.app/Contents/Resources/codex', `${home}/Applications/Codex.app/Contents/Resources/codex`] : []),
          '/opt/homebrew/bin/codex',
          '/usr/local/bin/codex',
          `${home}/.local/bin/codex`,
          `${home}/.npm-global/bin/codex`,
          `${home}/.bun/bin/codex`,
        ]
  for (const p of places) if (await has(p)) return (codexPath = p)
  const hit = await $.process.run(os === 'win' ? ['where', 'codex'] : ['sh', '-lc', 'command -v codex'], { timeoutMs: 8000 }).catch(() => undefined)
  const lines = hit?.exitCode === 0 ? hit.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []
  // npm's Windows shim is codex.cmd, which runs through cmd (see codexArgv).
  const exe = lines.find(l => /\.exe$/i.test(l)) ?? lines.find(l => /\.cmd$/i.test(l)) ?? lines.find(l => !/\.(bat|ps1)$/i.test(l))
  return exe ? (codexPath = exe) : undefined
}

/** How to start codex: directly, or through cmd for npm's .cmd shim on Windows. */
const codexArgv = (exe: string) => (/\.cmd$/i.test(exe) ? ['cmd', '/d', '/c', exe] : [exe])

/** The models this Codex account lists, and the user's own defaults, from Codex's home. */
const loadModels = async ($: EngineInterface) => {
  const { codexHome } = await findDirs($)
  if (!codexHome) return
  try {
    const cache = JSON.parse(await $.fs.read(`${codexHome}/models_cache.json`)) as { models?: Record<string, unknown>[] }
    models = (cache.models ?? [])
      .filter(m => m.visibility !== 'hide')
      .map(m => ({
        slug: str(m.slug),
        name: str(m.display_name) || str(m.slug),
        description: str(m.description),
        efforts: (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : []).map(l =>
          typeof l === 'string' ? l : str((l as Record<string, unknown>).effort),
        ),
        defaultEffort: str(m.default_reasoning_level),
      }))
      .filter(m => m.slug)
  } catch {
    models = []
  }
  try {
    const config = await $.fs.read(`${codexHome}/config.toml`)
    const top = config.split(/^\[/m)[0]
    defaults = {
      model: top.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? '',
      effort: top.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] ?? '',
    }
  } catch {
    defaults = { model: '', effort: '' }
  }
}

type Snapshot = Map<string, { sig: string; added: number; removed: number; isNew: boolean }>

/**
 * What git sees as changed under `root`: per path its status, its diff's line
 * counts and, for a new file, its size and time. Two snapshots differ on a
 * path exactly when something touched it in between, however it was written.
 * Paths are relative to the repository root. Undefined outside a repository.
 */
const snapshot = async ($: EngineInterface, root: string): Promise<Snapshot | undefined> => {
  // -z: NUL-separated, paths raw (no quoting or octal escapes); no renames, so every path stands alone.
  const status = await $.process.run(['git', '-C', root, 'status', '--porcelain=v1', '-z', '-uall', '--no-renames'], { timeoutMs: 15_000 }).catch(() => undefined)
  if (!status || status.exitCode !== 0) return undefined
  const numstat = await $.process.run(['git', '-C', root, 'diff', 'HEAD', '--numstat', '-z', '--no-renames'], { timeoutMs: 15_000 }).catch(() => undefined)
  const counts = new Map<string, [number, number]>()
  for (const rec of numstat?.exitCode === 0 ? numstat.stdout.split('\0') : []) {
    const [a, r, ...p] = rec.split('\t')
    if (p.length) counts.set(p.join('\t'), [Number(a) || 0, Number(r) || 0])
  }
  const entries = status.stdout
    .split('\0')
    .filter(rec => rec.length > 3)
    .map(rec => ({ code: rec.slice(0, 2), path: rec.slice(3) }))
    .filter(x => !x.path.startsWith(`${MEMORY_DIR}/`))
  // Size and time tell a change apart where git's own counts would not (a second edit on an already-changed line).
  const stats = new Map<string, string>()
  const toStat = entries.slice(0, 600)
  for (let i = 0; i < toStat.length; i += 32)
    await Promise.all(
      toStat.slice(i, i + 32).map(async x => {
        const st = await $.fs.stat(`${root}/${x.path}`).catch(() => undefined)
        if (st) stats.set(x.path, `${st.size}:${st.mtimeMs}`)
      }),
    )
  const out: Snapshot = new Map()
  for (const { code, path } of entries) {
    const [added, removed] = counts.get(path) ?? [0, 0]
    out.set(path, { sig: `${code}|${added}|${removed}|${stats.get(path) ?? ''}`, added, removed, isNew: code === '??' })
  }
  return out
}

/** Paths whose snapshot entry changed between two snapshots. */
const changedBetween = (before: Snapshot, after: Snapshot) => [
  ...[...after].filter(([p, v]) => before.get(p)?.sig !== v.sig).map(([p, v]) => ({ path: p, ...v })),
  // Changed before and clean after: put back to HEAD, or an untracked file deleted.
  ...[...before].filter(([p]) => !after.has(p)).map(([p, v]) => ({ path: p, ...v, added: 0, removed: 0, isNew: false })),
]

// ─── Memory: .codex-bridge/ at the project root ─────────────────────────────


const projectRoot = async ($: EngineInterface, cwd: string) => {
  const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 }).catch(() => undefined)
  return norm(r?.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : cwd)
}

/**
 * Values that go on Codex's command line. Each starts with a letter or digit, so none can be
 * read as an option (a session id of "--something" would otherwise reach Codex as a flag).
 */
const PLAIN_ID = /^[A-Za-z0-9][\w-]{0,127}$/
const PLAIN_MODEL = /^[A-Za-z0-9][\w.:-]{0,127}$/
/** A registry key: a plain slug, so a thread's log path stays inside its threads folder. */
const PLAIN_KEY = /^[a-z0-9][a-z0-9_-]{0,80}$/

/**
 * The project's thread registry. It is a file in the repository, so it may have come with a
 * clone: only entries with a plain key and the expected fields are kept, and a session that is
 * not a plain id is dropped (the thread then starts a fresh conversation).
 */
const readRegistry = async ($: EngineInterface, root: string): Promise<Registry> => {
  let raw: unknown
  try {
    raw = JSON.parse(await $.fs.read(`${root}/${MEMORY_DIR}/threads.json`))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Registry = {}
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!PLAIN_KEY.test(key) || !v || typeof v !== 'object') continue
    const t = v as Record<string, unknown>
    const txt = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '')
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
    out[key] = {
      name: txt(t.name, 200) || key,
      session: PLAIN_ID.test(txt(t.session, 128)) ? txt(t.session, 128) : '',
      created: num(t.created),
      updated: num(t.updated),
      runs: num(t.runs),
      model: txt(t.model, 128),
      effort: txt(t.effort, 32),
      last: txt(t.last, 2000),
      archived: t.archived === true,
    }
  }
  return out
}

const writeRegistry = async ($: EngineInterface, root: string, reg: Registry) => {
  await $.fs.write(`${root}/${MEMORY_DIR}/threads.json`, `${JSON.stringify(reg, null, 2)}\n`).catch(() => undefined)
  await update($, threads, all => ({ ...all, [root]: reg }))
}

/** Reads a project's registry into the pane's view of it. */
const loadThreads = async ($: EngineInterface, root: string) => {
  if (!root) return
  const reg = await readRegistry($, root)
  await update($, threads, all => ({ ...all, [root]: reg }))
}

/**
 * The thread changes the pane and the tool both make. Renaming moves the
 * thread's log; a fresh start forgets the Codex conversation but keeps the
 * log and notes; archiving hides it until used again; deleting drops it and
 * its log (the project's NOTES.md stays).
 */
const threadAction = async ($: EngineInterface, root: string, key: string, how: 'rename' | 'reset' | 'archive' | 'unarchive' | 'delete', newName = ''): Promise<string> =>
  withLock(root, async () => {
  // A running thread writes its registry entry and log when it ends: change it after that.
  if (starting.has(`${root}::${key}`) || (await read($, runs)).some(r => r.status === 'running' && r.root === root && (r.threadKey ?? slug(r.thread)) === key))
    return `Thread "${key}" is running right now; try again when its run finishes.`
  const reg = await readRegistry($, root)
  const t = reg[key]
  if (!t) return `No thread "${key}" in ${root}.`
  const logOf = (k: string) => `${root}/${MEMORY_DIR}/threads/${k}.md`
  switch (how) {
    case 'rename': {
      const name = newName.trim()
      const k2 = slug(name)
      if (!name) return 'Give the thread a new name.'
      if (k2 !== key && reg[k2]) return `There is already a thread "${reg[k2].name}".`
      const text = await $.fs.read(logOf(key)).catch(() => '')
      if (k2 !== key) {
        // The old log goes only once the new one is written.
        const moved = text ? await $.fs.write(logOf(k2), text.replace(/^# Codex thread: .*$/m, `# Codex thread: ${name}`)).then(() => true, () => false) : true
        if (!moved) return `Could not write the renamed log, so "${t.name}" was left as it was.`
        if (text) await removeFile($, logOf(key))
        delete reg[key]
      }
      reg[k2] = { ...t, name }
      await writeRegistry($, root, reg)
      return `Renamed thread "${t.name}" to "${name}".`
    }
    case 'reset':
      reg[key] = { ...t, session: '' }
      await writeRegistry($, root, reg)
      return `Thread "${t.name}" will start a fresh Codex conversation next time (its log and the project notes are kept).`
    case 'archive':
    case 'unarchive':
      reg[key] = { ...t, archived: how === 'archive' }
      await writeRegistry($, root, reg)
      return how === 'archive' ? `Archived thread "${t.name}".` : `Restored thread "${t.name}".`
    case 'delete':
      delete reg[key]
      await removeFile($, logOf(key))
      await writeRegistry($, root, reg)
      return `Deleted thread "${t.name}" and its log.`
  }
  })

/**
 * The registry key a thread name means: the entry with that key or that name (any case), else
 * its slug, made unique when another name already holds it ("Foo Bar" and "foo-bar", or any
 * two non-Latin names, which both slug to "thread").
 */
const keyFor = (reg: Registry, name: string) => {
  const n = name.trim()
  if (!n) return ''
  if (reg[n] && PLAIN_KEY.test(n)) return n
  const hit = Object.entries(reg).find(([, t]) => t.name.toLowerCase() === n.toLowerCase())
  if (hit) return hit[0]
  const base = slug(n)
  return reg[base] ? `${base}-${hashOf(n).slice(0, 5)}` : base
}

/** Threads whose run is being set up (`root::key`): not yet in the runs list, already not to be changed. */
const starting = new Set<string>()

/** Runs `fn` after every earlier `withLock` on the same project has finished: no two read-modify-writes overlap. */
const locks = new Map<string, Promise<unknown>>()
const withLock = <T,>(root: string, fn: () => Promise<T>): Promise<T> => {
  const run = (locks.get(root) ?? Promise.resolve()).then(fn, fn)
  locks.set(root, run.catch(() => undefined))
  return run
}

// ─── Usage: the plan's limits, as Codex last recorded them ─────────────────

/** The text of a file's last lines: through tail/PowerShell for big logs, else read whole. */
const tailOf = async ($: EngineInterface, path: string, size: number) => {
  if (size < 2_000_000) return $.fs.read(path).catch(() => '')
  const win = (await platformOf($)) === 'win'
  const argv = win
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Get-Content -LiteralPath ${psq(path)} -Tail 400`]
    : ['tail', '-n', '400', path]
  const r = await $.process.run(argv, { timeoutMs: 20_000 }).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout : ''
}

/**
 * Codex's session logs (sessions/YYYY/MM/DD/rollout-*.jsonl under its home)
 * from the newest few day folders, most recently written first. A resumed
 * session writes to its first day's file, so the newest file is not always in
 * the newest folder.
 */
const recentRollouts = async ($: EngineInterface, home: string) => {
  const dirsIn = async (p: string) =>
    (await $.fs.list(p).catch(() => []))
      .filter(d => /^\d+$/.test(d.name))
      .map(d => d.name)
      .sort((a, b) => Number(b) - Number(a))
  const base = `${home}/sessions`
  const days: string[] = []
  for (const y of (await dirsIn(base)).slice(0, 2))
    for (const m of await dirsIn(`${base}/${y}`))
      for (const d of await dirsIn(`${base}/${y}/${m}`)) if (days.length < 4) days.push(`${base}/${y}/${m}/${d}`)
  const found: { path: string; at: number; size: number }[] = []
  for (const day of days)
    for (const f of (await $.fs.list(day).catch(() => [])).filter(x => /^rollout-.*\.jsonl$/.test(x.name))) {
      const st = await $.fs.stat(`${day}/${f.name}`).catch(() => undefined)
      if (st) found.push({ path: `${day}/${f.name}`, at: st.mtimeMs, size: st.size })
    }
  return found.sort((a, b) => b.at - a.at).slice(0, 6)
}

/** The last rate_limits object in a log's text, and the time of its line. */
const lastLimits = (text: string) => {
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    try {
      const row = JSON.parse(lines[i]) as { timestamp?: string; payload?: { rate_limits?: Record<string, unknown> } }
      const rl = row.payload?.rate_limits
      if (rl) return { rl, at: row.timestamp ? Date.parse(row.timestamp) : 0 }
    } catch {
      // A line cut by the tail: keep looking.
    }
  }
  return undefined
}

/** Reads the plan's usage from Codex's newest session log into the usage atom. */
const refreshUsage = async ($: EngineInterface) => {
  const { codexHome } = await findDirs($)
  const now = Date.now()
  // The newest log that has recorded limits: a just-started session may not have yet.
  let found: ReturnType<typeof lastLimits>
  let log: { path: string; at: number; size: number } | undefined
  for (const f of codexHome ? await recentRollouts($, codexHome) : []) {
    found = lastLimits(await tailOf($, f.path, f.size))
    if (found) {
      log = f
      break
    }
  }
  if (!found) {
    await update($, usage, u => ({ ...u, readAt: now, missing: codexHome ? 'Codex has not recorded any usage yet: it appears after its first run.' : "Codex's home folder was not found." }))
    return
  }
  const { rl, at } = found
  const win = (w: unknown): Limit | undefined => {
    const o = w as { used_percent?: number; window_minutes?: number; resets_at?: number; resets_in_seconds?: number } | null
    if (!o || typeof o.used_percent !== 'number') return undefined
    const resetsAt = o.resets_at ? o.resets_at * 1000 : o.resets_in_seconds ? (at || log!.at) + o.resets_in_seconds * 1000 : 0
    return { windowMinutes: o.window_minutes ?? 0, usedPercent: o.used_percent, resetsAt }
  }
  const limits = [win(rl.primary), win(rl.secondary)].filter((l): l is Limit => !!l).sort((a, b) => a.windowMinutes - b.windowMinutes)
  await update($, usage, () => ({ plan: str(rl.plan_type), limits, seenAt: at || log!.at, readAt: now, missing: limits.length ? '' : 'Codex recorded no limits for this plan.' }))
}

const windowName = (min: number) => (min === 10080 ? 'weekly limit' : min === 300 ? '5-hour limit' : min >= 1440 ? `${Math.round(min / 1440)}-day limit` : `${Math.round(min / 60)}-hour limit`)
const whenReset = (ms: number, now: number) => {
  if (!ms) return ''
  const left = ms - now
  if (left <= 0) return 'has reset since'
  if (left < 36 * 3_600_000) return `resets in ${left < 3_600_000 ? `${Math.ceil(left / 60_000)}m` : `${Math.floor(left / 3_600_000)}h ${Math.round((left % 3_600_000) / 60_000)}m`}`
  return `resets ${new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
}
/** One line per limit, for the result Claude reads. */
const usageLine = (u: Usage, now: number) =>
  u.limits.length ? `Codex plan usage: ${u.limits.map(l => `${windowName(l.windowMinutes)} ${Math.round(l.usedPercent)}% used${l.resetsAt ? ` (${whenReset(l.resetsAt, now)})` : ''}`).join('; ')}.` : ''

/** Keeps the memory folder out of commits, locally: .git/info/exclude, never the repo's .gitignore. */
const keepOutOfGit = async ($: EngineInterface, root: string) => {
  // A worktree's .git is a file: git itself says where its exclude file is.
  const r = await $.process.run(['git', '-C', root, 'rev-parse', '--git-path', 'info/exclude'], { timeoutMs: 10_000 }).catch(() => undefined)
  const rel = r?.exitCode === 0 ? r.stdout.trim() : ''
  if (!rel) return
  const exclude = isAbs(rel) ? norm(rel) : norm(`${root}/${rel}`)
  const text = await $.fs.read(exclude).catch(() => '')
  if (!text.split(/\r?\n/).some(l => l.trim() === `${MEMORY_DIR}/`))
    await $.fs.write(exclude, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${MEMORY_DIR}/\n`).catch(() => undefined)
}

const memoryBrief = (o: { root: string; thread: string; key: string; resumed: boolean; mode: string; task: string }) =>
  [
    `You are Codex, working as a subagent for Claude Code (Anthropic's coding agent) in the project at ${o.root}. Claude reads your final message and acts on it.`,
    o.thread ? `This is workstream "${o.thread}"${o.resumed ? ', continued from your earlier runs' : ''}.` : '',
    `Your memory for this project is the folder ${MEMORY_DIR}/ at the project root. It persists across your runs:`,
    `- ${MEMORY_DIR}/NOTES.md: durable project knowledge you curate (architecture, conventions, useful commands, gotchas, open questions).`,
    `- ${MEMORY_DIR}/threads/${o.key || 'one-off'}.md: the log of ${o.thread ? "this workstream's" : 'one-off'} earlier tasks and results.`,
    'Read whichever of these exist before you start, and trust the code over them where they disagree.',
    o.mode === 'write' ? 'You may edit files in the workspace.' : 'This run is read-only: do not modify any files.',
    'When you finish, write your answer for Claude: what you found or did, anything Claude should check, and open questions.',
    'If you learned durable facts about the project, end your message with a line "### NOTES.md" followed by the complete updated NOTES.md (under 150 lines, keeping what is still true from the old one). Leave that section out if nothing durable changed.',
    '',
    '--- Task from Claude ---',
    o.task,
  ]
    .filter(Boolean)
    .join('\n')

/** Splits Codex's final message into its answer for Claude and an updated NOTES.md, if it gave one. */
const splitNotes = (text: string) => {
  // The brief asks for the notes last, so the last such heading starts them; an earlier
  // "## NOTES.md" (say, in a review of the notes) stays part of the answer.
  const heads = [...text.matchAll(/^###\s*NOTES\.md\s*$/gm)]
  const at = heads.length ? (heads[heads.length - 1].index ?? -1) : -1
  if (at < 0) return { answer: text.trim(), notes: '' }
  let notes = text.slice(at).replace(/^#{1,3}\s*NOTES\.md\s*\n?/, '').trim()
  const fenced = notes.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  if (fenced) notes = fenced[1].trim()
  return { answer: text.slice(0, at).trim(), notes }
}

// ─── The tool, as the model reads it ────────────────────────────────────────

// The model reads a tool description up to 2048 characters: the model list lives on the `model` parameter instead.
const describe = () =>
  [
    "Hand a task to OpenAI Codex, a separate coding agent on the user's own Codex subscription, and get its result back: use it like a subagent. It reads the whole project and runs commands; in write mode it edits files.",
    'Codex cannot see this conversation: write `task` as a complete, self-contained brief (goal, relevant files, constraints, what to report back).',
    `Memory: Codex keeps notes per project in ${MEMORY_DIR}/ and reads them at the start of every run. For multi-step work give a short \`thread\` name: every call with that name continues the same Codex conversation. action "threads" lists a project's threads.`,
    `Pick \`model\` and \`effort\` per task (the model parameter lists the choices): luna at low effort for lookups and mechanical edits, sol at medium/high for ordinary coding, astra at high+ for hard design, deep debugging or a critical review; max/ultra only for the hardest problems. Defaults: ${defaults.model || "the user's default"}, ${defaults.effort || 'default'} effort.`,
    "mode 'read-only' (default) reads and runs read-only commands; 'write' may edit files inside the working directory only: review its changes (git diff) before building on them.",
    "A run can take minutes. The result gives Codex's answer, the files it changed, the commands it ran, and how to continue.",
  ].join('\n\n')

const modelHelp = () =>
  models.length
    ? `Codex model. Choices: ${models.map(m => `${m.slug} (${(m.description || m.name).replace(/\.$/, '')}; efforts ${m.efforts.join('/')})`).join('; ')}.`
    : "Codex model id; omit for the user's default."

const schema = () => ({
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['run', 'threads', 'usage', 'rename_thread', 'reset_thread', 'archive_thread', 'restore_thread'],
      description:
        "'run' (default) gives Codex a task; 'threads' lists this project's threads; 'usage' shows how much of the Codex plan's limits are used; 'rename_thread' (thread, new_name), 'reset_thread' (thread: next call starts a fresh Codex conversation, log kept) and 'archive_thread' / 'restore_thread' (thread) manage threads.",
    },
    new_name: { type: 'string', description: "The thread's new name, for action 'rename_thread'." },
    task: { type: 'string', description: 'The complete brief for Codex. It sees nothing else of this conversation.' },
    thread: { type: 'string', description: 'A short name for a workstream. Calls with the same name continue the same Codex conversation and share its log.' },
    new_thread: { type: 'boolean', description: "Start the named thread over: a fresh Codex conversation (its log and the project's notes are kept)." },
    mode: { type: 'string', enum: ['read-only', 'write'], description: "'read-only' (default) or 'write' (may edit files in the working directory)." },
    model: { type: 'string', ...(models.length ? { enum: models.map(m => m.slug) } : {}), description: modelHelp() },
    effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], description: 'Reasoning effort; must be one the chosen model supports.' },
    cwd: { type: 'string', description: "Absolute working directory for Codex; defaults to this session's." },
    session_id: { type: 'string', description: 'A raw Codex session id to continue (threads do this for you).' },
    timeout_minutes: { type: 'number', minimum: 1, maximum: 120, description: 'Stop Codex after this long (default 30).' },
  },
})

// ─── Hooks ──────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadModels($)
    cliFound = !!(await findCodex($).catch(() => undefined))
    await $.tool.register({ name: TOOL, description: describe(), inputSchema: schema() })
    await $.command.register({ name: 'codex', description: 'Open the Codex pane: what Codex is doing for Claude' })
    // A reload ends whatever was in flight: say so rather than leave it spinning.
    await update($, runs, list =>
      list.map(r =>
        r.status === 'running'
          ? { ...r, status: 'stopped' as const, endedAt: Math.max(r.startedAt, ...(r.events ?? []).map(ev => ev.at || 0)), activity: 'Stopped' }
          : { caller: 'main', root: r.cwd, activity: '', focus: '', touched: [], session: '', thread: '', resumed: false, notesUpdated: false, ...r },
      ),
    )
    await update($, paneUi, () => ({ renaming: '', confirmDelete: '', showArchived: false }))
    // The session's project and every project a recent run worked in show their threads.
    const here = await projectRoot($, norm(await $.session.cwd().catch(() => ''))).catch(() => '')
    sessionRoot = here
    for (const root of new Set([here, ...(await read($, runs)).map(r => r.root)].filter(Boolean))) await loadThreads($, root)
    void refreshUsage($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'codex' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Codex' })
    return { text: 'Codex pane opened.' }
  })

  on('tool.call', { tool: `mcp__codex-bridge__${TOOL}` }, async ($, e, next) => {
    const a = e as unknown as Record<string, unknown>
    const asked = norm(str(a.cwd) || (await $.session.cwd()))
    const root = await projectRoot($, asked)
    // Windows paths ignore case: take the repository's own spelling, so Codex's paths and git's agree.
    const cwd = asked.toLowerCase().startsWith(root.toLowerCase()) ? root + asked.slice(root.length) : asked
    const registry = await readRegistry($, root)

    if (a.action === 'threads') {
      await loadThreads($, root)
      const list = Object.entries(registry).sort((x, y) => y[1].updated - x[1].updated)
      if (!list.length) return { result: `No Codex threads yet for ${root}. Pass \`thread\` with a task to start one.` }
      return {
        result: [
          `Codex threads for ${root} (memory in ${MEMORY_DIR}/):`,
          ...list.map(
            ([, t]) =>
              `- "${t.name}"${t.archived ? ' (archived)' : ''}: ${t.runs} run${t.runs === 1 ? '' : 's'}, last ${stamp(t.updated)}, ${t.model} / ${t.effort}${t.session ? '' : ', starts fresh next time'}. Last task: ${trunc(oneLine(t.last), 160)}`,
          ),
        ].join('\n'),
      }
    }
    if (a.action === 'usage') {
      await refreshUsage($)
      const u = await read($, usage)
      return { result: usageLine(u, Date.now()) ? `${usageLine(u, Date.now())} (as Codex recorded it at ${stamp(u.seenAt)}; plan: ${u.plan || 'unknown'})` : `No Codex usage numbers: ${u.missing}` }
    }
    if (a.action === 'rename_thread' || a.action === 'reset_thread' || a.action === 'archive_thread' || a.action === 'restore_thread') {
      if (!str(a.thread).trim()) return { result: 'Name the thread (`thread`).' }
      const key = keyFor(registry, str(a.thread))
      const how = a.action === 'rename_thread' ? 'rename' : a.action === 'reset_thread' ? 'reset' : a.action === 'restore_thread' ? 'unarchive' : 'archive'
      return { result: await threadAction($, root, key, how, str(a.new_name)) }
    }

    const task = str(a.task).trim()
    if (!task) return { result: 'Codex was not run: `task` is empty.' }
    const mode = a.mode === 'write' ? ('write' as const) : ('read-only' as const)
    if (!models.length) await loadModels($)
    const model = str(a.model)
    const effort = str(a.effort)
    // They go on Codex's command line: plain names only.
    if ((model && !PLAIN_MODEL.test(model)) || (effort && !PLAIN_ID.test(effort)))
      return { result: 'Codex was not run: model and effort must be plain names that start with a letter or digit.' }
    const chosen = models.find(m => m.slug === (model || defaults.model))
    if (model && models.length && !models.some(m => m.slug === model))
      return { result: `Codex was not run: unknown model "${model}". Available: ${models.map(m => m.slug).join(', ')}.` }
    if (effort && chosen && chosen.efforts.length && !chosen.efforts.includes(effort))
      return { result: `Codex was not run: ${chosen.slug} does not support effort "${effort}". It supports: ${chosen.efforts.join(', ')}.` }
    const thread = str(a.thread).trim()
    // Two names can share a slug ("Foo Bar", "foo-bar", or any non-Latin name): the second gets its own key.
    const key = keyFor(registry, thread)
    const known = key ? registry[key] : undefined
    // A session id goes on Codex's command line: plain ids only, from the caller or the registry.
    const askedSession = str(a.session_id)
    if (askedSession && !PLAIN_ID.test(askedSession)) return { result: 'Codex was not run: session_id must be a plain id that starts with a letter or digit.' }
    const knownSession = known && a.new_thread !== true && PLAIN_ID.test(known.session) ? known.session : ''
    const resumeId = askedSession || knownSession
    // Until the run is in the list, a rename or delete of its thread waits for it too.
    const startKey = `${root}::${key}`
    if (key) starting.add(startKey)
    const minutes = Math.min(120, Math.max(1, Number(a.timeout_minutes) || 30))
    const caller = e.agentId ?? 'main'

    const exe = await findCodex($)
    if (!exe) {
      starting.delete(startKey)
      return {
        result: 'Codex was not run: the Codex CLI was not found. Install the Codex desktop app or the CLI (npm i -g @openai/codex) and sign in with `codex login`.',
      }
    }
    // The desktop app's scratch folders live under a redirected AppData path that Codex's
    // Windows sandbox refuses to write into: say so plainly instead of running and failing.
    if (mode === 'write' && /\/AppData\/(Roaming|Local)\/Claude\/scratch-workspaces\//i.test(cwd)) {
      starting.delete(startKey)
      return {
        result:
          "Codex was not run: write mode does not work in this chat's own scratch folder (Codex's sandbox cannot write under AppData). Use a real project folder: pass `cwd` with its absolute path, or open the chat in that folder. Read-only mode works anywhere.",
      }
    }

    const id = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
    const startedAt = Date.now()
    const fresh: Run = {
      id,
      task,
      mode,
      cwd,
      root,
      model: model || defaults.model || 'default',
      effort: effort || defaults.effort || 'default',
      status: 'running',
      startedAt,
      endedAt: 0,
      session: resumeId,
      thread,
      threadKey: key,
      resumed: !!resumeId,
      caller,
      activity: 'Reading its notes',
      focus: '',
      touched: [],
      events: [],
      files: [],
      commands: 0,
      failedCommands: 0,
      answer: '',
      tokens: 0,
      notesUpdated: false,
    }
    await update($, runs, list => [fresh, ...list].filter((r, i) => i < MAX_RUNS || r.status === 'running'))
    starting.delete(startKey)
    const running = (await read($, runs)).filter(r => r.status === 'running').length
    $.ui.status(`Codex: ${running} running`)
    try {

    const patch = (fn: (r: Run) => Run) => update($, runs, list => list.map(r => (r.id === id ? fn(r) : r)))
    const push = (ev: Omit<RunEvent, 'at'>) => patch(r => ({ ...r, events: [...r.events, { at: Date.now(), ...ev }].slice(-MAX_EVENTS) }))
    const touch = (all: string[], kind: Touch['kind'], activity?: string) =>
      patch(r => {
        // Its own memory files are not project files.
        const paths = all.filter(p => !p.includes(`/${MEMORY_DIR}/`))
        if (!paths.length) return activity ? { ...r, activity } : r
        const now = Date.now()
        const keep = r.touched.filter(t => !paths.includes(t.path) || (t.kind === 'edit' && kind === 'look'))
        const added = paths
          .filter(p => !(kind === 'look' && r.touched.some(t => t.path === p && t.kind === 'edit')))
          .map(p => ({ path: p, kind, at: now }))
        return { ...r, touched: [...keep, ...added].slice(-MAX_TOUCHED), focus: paths[paths.length - 1], ...(activity ? { activity } : {}) }
      })
    const fileKinds = new Map<string, string>()

    const handle = async (line: string) => {
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      const item = (ev.item ?? {}) as Record<string, unknown>
      const itemId = str(item.id)
      switch (ev.type) {
        case 'thread.started':
          sawThread = true
          await patch(r => ({ ...r, session: str(ev.thread_id) || r.session }))
          return
        case 'item.started':
          if (item.type === 'command_execution') {
            const cmd = bareCommand(str(item.command))
            await push({ kind: 'cmd', text: cmd, ok: undefined, ref: itemId })
            await touch(pathsIn(cmd).map(p => join(cwd, p)), 'look', `Running ${trunc(cmd, 48)}`)
          }
          if (item.type === 'reasoning') await patch(r => ({ ...r, activity: 'Thinking' }))
          return
        case 'item.completed':
          switch (item.type) {
            case 'agent_message': {
              const text = str(item.text)
              await patch(r => ({ ...r, answer: text, activity: 'Writing its answer' }))
              await push({ kind: 'say', text: trunc(oneLine(splitNotes(text).answer || text), 220) })
              return
            }
            case 'reasoning':
              if (str(item.text)) await push({ kind: 'think', text: trunc(oneLine(str(item.text)), 200) })
              await patch(r => ({ ...r, activity: 'Thinking' }))
              return
            case 'command_execution': {
              const ok = item.exit_code === 0
              await patch(r => {
                const at = r.events.findIndex(x => x.ref === itemId)
                const events =
                  at >= 0
                    ? r.events.map((x, i) => (i === at ? { ...x, ok } : x))
                    : [...r.events, { at: Date.now(), kind: 'cmd' as const, text: bareCommand(str(item.command)), ok }].slice(-MAX_EVENTS)
                return { ...r, events, commands: r.commands + 1, failedCommands: r.failedCommands + (ok ? 0 : 1), activity: ok ? 'Thinking' : 'Looking at a failure' }
              })
              return
            }
            case 'file_change': {
              const changes = Array.isArray(item.changes) ? (item.changes as Record<string, unknown>[]) : []
              const inside = (p: string) => p === root || p.startsWith(`${root}/`)
              const outside = changes.map(ch => join(cwd, str(ch.path))).filter(p => !inside(p))
              if (outside.length) await push({ kind: 'info', text: `Codex reported a change outside the project, not listed: ${trunc(outside.join(', '), 160)}` })
              for (const ch of changes) if (inside(join(cwd, str(ch.path)))) fileKinds.set(join(cwd, str(ch.path)), str(ch.kind) || 'update')
              const paths = changes.map(ch => join(cwd, str(ch.path))).filter(inside)
              await patch(r => ({ ...r, files: [...fileKinds.keys()] }))
              await touch(paths, 'edit', paths.length ? `Editing ${baseName(paths[paths.length - 1])}` : undefined)
              for (const ch of changes) await push({ kind: 'file', text: `${str(ch.kind) || 'update'} ${baseName(str(ch.path))}` })
              return
            }
            case 'todo_list': {
              const items = Array.isArray(item.items) ? (item.items as Record<string, unknown>[]) : []
              const done = items.filter(t => t.completed === true).length
              const doing = items.find(t => t.completed !== true)
              await push({ kind: 'plan', text: `${done}/${items.length} steps${doing ? ` · next: ${trunc(str(doing.text), 80)}` : ''}` })
              if (doing) await patch(r => ({ ...r, activity: trunc(str(doing.text), 60) }))
              return
            }
            case 'mcp_tool_call':
              await push({ kind: 'info', text: `tool ${str(item.server)}.${str(item.tool)}` })
              return
            case 'web_search':
              await push({ kind: 'info', text: `web search: ${trunc(str(item.query), 100)}` })
              await patch(r => ({ ...r, activity: 'Searching the web' }))
              return
            case 'error':
              await push({ kind: 'error', text: trunc(oneLine(str(item.message)), 220) })
              return
            default:
              return
          }
        case 'turn.completed': {
          const u = (ev.usage ?? {}) as Record<string, unknown>
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
          await patch(r => ({ ...r, tokens: r.tokens + num(u.input_tokens) + num(u.output_tokens) }))
          return
        }
        case 'turn.failed':
        case 'error': {
          const err = (ev.error ?? ev) as Record<string, unknown>
          await push({ kind: 'error', text: trunc(oneLine(str(err.message) || 'Codex reported an error'), 220) })
          return
        }
        default:
          return
      }
    }

    // One Codex process: the brief on stdin, its event stream read as it comes.
    let stopped = false
    let sawThread = false
    // Ends the Codex process now, even while it prints nothing: closing the stream kills the child.
    let endChild: (() => void) | undefined
    stops.set(id, () => {
      stopped = true
      endChild?.()
    })
    const deadline = startedAt + minutes * 60_000
    const execute = async (resume: string) => {
      if (stopped || next.signal.aborted) return { code: null as number | null, stderr: '', crashed: '', timedOut: false }
      const flags = [
        '--json',
        '--skip-git-repo-check',
        '-c',
        `sandbox_mode="${mode === 'write' ? 'workspace-write' : 'read-only'}"`,
        ...(model ? ['-m', model] : []),
        ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
      ]
      const argv = resume ? [...codexArgv(exe), 'exec', 'resume', ...flags, resume, '-'] : [...codexArgv(exe), 'exec', ...flags, '-']
      const input = memoryBrief({ root, thread, key, resumed: !!resume, mode, task })
      let buffer = ''
      let stderr = ''
      let code: number | null = null
      let crashed = ''
      let timedOut = false
      const child = $.process.spawn({ argv, cwd, input })
      endChild = () => void (child as unknown as { return?: () => Promise<unknown> }).return?.().catch(() => undefined)
      const timer = $.clock.after(Math.max(1000, deadline - Date.now()), () => {
        timedOut = true
        endChild?.()
      }) as unknown as { cancel?: () => void } | undefined
      ;(next.signal as unknown as { addEventListener?: (t: string, f: () => void, o?: unknown) => void }).addEventListener?.('abort', () => endChild?.(), { once: true })
      try {
        for await (const piece of child) {
          if (piece.stream === 'stdout') {
            buffer += piece.text
            // One event is never this long: a line with no end is dropped rather than held forever.
            if (buffer.length > 4_000_000 && buffer.indexOf('\n') < 0) buffer = ''
            let nl: number
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).trim()
              buffer = buffer.slice(nl + 1)
              if (line) await handle(line)
            }
          } else stderr = (stderr + piece.text).slice(-8000)
          if (Date.now() > deadline) timedOut = true
          if (stopped || timedOut || next.signal.aborted) break
        }
        if (buffer.trim()) await handle(buffer.trim())
        if (!stopped && !timedOut && !next.signal.aborted) code = (await child.result).code
      } catch (err) {
        crashed = err instanceof Error ? err.message : String(err)
      } finally {
        timer?.cancel?.()
        endChild = undefined
      }
      return { code, stderr, crashed, timedOut }
    }

    await keepOutOfGit($, root)
    const before = await snapshot($, root)
    let outcome = await execute(resumeId)
    // A thread whose Codex session is gone (cleared, other machine) starts over rather than failing.
    // It "ran nothing" if all it said was errors or notes: no command, file, reasoning or answer.
    const ranNothing = ((await read($, runs)).find(r => r.id === id)?.events ?? []).every(ev => ev.kind === 'error' || ev.kind === 'info')
    let freshStart = a.new_thread === true
    if (resumeId && !sawThread && outcome.code !== 0 && !outcome.crashed && !stopped && !outcome.timedOut && ranNothing) {
      await push({ kind: 'info', text: 'the earlier Codex session could not be resumed: starting a fresh one' })
      await patch(r => ({ ...r, resumed: false, session: '' }))
      freshStart = true
      outcome = await execute('')
    }
    stops.delete(id)

    const after = before ? await snapshot($, root) : undefined
    // A read-only run changes nothing: whatever git saw change meanwhile was someone else.
    const viaGit = before && after && mode === 'write' ? changedBetween(before, after) : []
    for (const t of viaGit) {
      const abs = join(root, t.path)
      if (!fileKinds.has(abs)) fileKinds.set(abs, t.isNew ? 'add' : 'update')
    }
    if (viaGit.length) {
      await patch(r => ({ ...r, files: [...fileKinds.keys()] }))
      await touch(viaGit.map(t => join(root, t.path)), 'edit')
      for (const t of viaGit.slice(0, 30)) await push({ kind: 'file', text: `${t.isNew ? 'add' : 'update'} ${baseName(t.path)}${t.isNew ? '' : ` +${t.added} −${t.removed}`}` })
    }
    const counts = new Map(viaGit.map(t => [join(root, t.path), t]))

    // Codex's notes and the thread's log.
    const finalRun = (await read($, runs)).find(r => r.id === id) ?? fresh
    const { answer, notes } = splitNotes(finalRun.answer)
    if (notes.length > 20 && notes.length < 60_000) {
      await $.fs.write(`${root}/${MEMORY_DIR}/NOTES.md`, `${notes}\n`).catch(() => undefined)
      await patch(r => ({ ...r, notesUpdated: true }))
    }
    const endedAt = Date.now()
    const status = stopped || outcome.timedOut || next.signal.aborted ? 'stopped' : outcome.code === 0 ? 'done' : 'failed'
    const logPath = `${root}/${MEMORY_DIR}/threads/${key || 'one-off'}.md`
    const asker = caller === 'main' ? 'Claude (main session)' : `a Claude subagent (${caller})`
    const entry = [
      '',
      `## ${stamp(startedAt)} · ${fresh.model} / ${fresh.effort} · ${mode} · ${elapsed(endedAt - startedAt)} · ${status}`,
      `**Asked by:** ${asker}`,
      `**Task:** ${trunc(task, 1500)}`,
      `**Result:** ${trunc(answer || '(no answer)', 3000)}`,
      ...(fileKinds.size ? [`**Files:** ${[...fileKinds].map(([p, k]) => `${p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p} (${k})`).join(', ')}`] : []),
      '',
    ].join('\n')
    const session = (await read($, runs)).find(r => r.id === id)?.session ?? ''
    // The log and the registry are read and written whole: one change at a time per project.
    await withLock(root, async () => {
      const oldLog = await $.fs.read(logPath).catch(() => (thread ? `# Codex thread: ${thread}\n` : '# Codex one-off runs\n'))
      await $.fs.write(logPath, oldLog + entry).catch(() => undefined)
    })
    if (thread) await withLock(root, async () => {
      const reg = await readRegistry($, root)
      const prev = reg[key]
      reg[key] = {
        name: thread,
        // A fresh start keeps its own session, even none, rather than going back to the old one.
        session: freshStart ? session : session || prev?.session || '',
        created: prev?.created ?? startedAt,
        updated: endedAt,
        runs: (prev?.runs ?? 0) + 1,
        model: fresh.model,
        effort: fresh.effort,
        last: task,
        // Using an archived thread brings it back.
        archived: false,
      }
      await writeRegistry($, root, reg)
    })
    // The run moved the plan's usage: read it again for the pane and the result.
    await refreshUsage($).catch(() => undefined)

    await patch(r => ({ ...r, status, endedAt, activity: status === 'done' ? 'Done' : status === 'failed' ? 'Failed' : 'Stopped' }))
    const left = (await read($, runs)).filter(r => r.status === 'running').length
    $.ui.status(left ? `Codex: ${left} running` : undefined)
    void $.ui.toast(`Codex ${status === 'done' ? 'finished' : status}${thread ? ` · ${thread}` : ''} · ${elapsed(endedAt - startedAt)}`)

    // What Claude reads back.
    const run = (await read($, runs)).find(r => r.id === id) ?? fresh
    const how = [mode, run.model, run.effort !== 'default' ? `${run.effort} effort` : ''].filter(Boolean).join(', ')
    const word = status === 'done' ? 'finished' : status === 'failed' ? 'failed' : outcome.timedOut ? `was stopped after ${minutes} min` : 'was stopped'
    const out: string[] = [`Codex ${word} in ${elapsed(endedAt - startedAt)} (${how})${thread ? ` on thread "${thread}"${run.resumed ? ', continuing it' : ''}` : ''}.`, '']
    // Claude reads this whole: a very long answer is cut (the full text is in the run's card and the thread log).
    out.push(answer ? (answer.length > 12_000 ? `${answer.slice(0, 12_000)}\n… (answer cut at 12,000 characters)` : answer) : '(Codex gave no final message.)')
    if (fileKinds.size) {
      out.push('', 'Files Codex changed:')
      for (const [f, k] of [...fileKinds].slice(0, 60)) {
        const g = counts.get(f)
        out.push(`- ${f} (${k}${g && !g.isNew ? `, +${g.added} −${g.removed} vs HEAD` : ''})`)
      }
      if (fileKinds.size > 60) out.push(`- …and ${fileKinds.size - 60} more`)
      // Files found through git are whatever changed meanwhile, whoever changed them.
      const overlapped = (await read($, runs)).some(r => r.id !== id && r.root === root && r.startedAt < endedAt && (r.status === 'running' || r.endedAt > startedAt))
      if (overlapped && viaGit.length)
        out.push('(Another Codex run worked in this project at the same time: some of these may be its changes, or yours. Check with git diff.)')
    }
    if (run.commands) out.push('', `Commands Codex ran: ${run.commands}${run.failedCommands ? ` (${run.failedCommands} failed)` : ''}.`)
    if (/writable root|sandbox (cannot|could not|refused)|not permitted by the sandbox/i.test(answer))
      out.push(
        '',
        "Codex's sandbox refused to work in this folder. That happens in folders Windows redirects (anything under AppData) and on some network drives: run the task in a normal project folder, or use read-only mode.",
      )
    if (status === 'failed' || outcome.crashed) {
      const noise = /rmcp::transport|worker quit with fatal/
      const tail = outcome.stderr
        .split(/\r?\n/)
        .filter(l => l.trim() && !noise.test(l))
        .slice(-12)
        .join('\n')
      if (outcome.crashed) out.push('', `The Codex process could not run: ${outcome.crashed}`)
      if (tail) out.push('', 'Codex stderr (last lines):', tail)
    }
    out.push('')
    if (run.notesUpdated) out.push(`Codex updated its project notes: ${root}/${MEMORY_DIR}/NOTES.md`)
    out.push(
      thread
        ? `Continue this work by calling codex again with thread "${thread}". Its log: ${logPath}`
        : run.session
          ? `session_id: ${run.session} (pass it as session_id, or start a named thread, to continue this conversation)`
          : '',
    )
    if (mode === 'write' && fileKinds.size) out.push('Codex edited files directly: review the changes (e.g. git diff) before relying on them.')
    const plan = usageLine(await read($, usage), Date.now())
    if (plan) out.push(plan)
    if (mode === 'write' && !before) out.push('This folder is not a git repository, so files Codex changed through shell commands are not listed: check the folder yourself.')
    return { result: out.filter((l, i, all) => l || all[i - 1]).join('\n').trim() }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      await update($, runs, list => list.map(r => (r.id === id && r.status === 'running' ? { ...r, status: 'failed' as const, endedAt: Date.now(), activity: 'Failed' } : r))).catch(() => undefined)
      return { result: `Codex failed inside the bridge: ${trunc(why, 300)}` }
    } finally {
      stops.delete(id)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e) as unknown as Record<string, (props: unknown) => unknown>
    const list = await read($, runs)
    const now = Date.now()
    const cols = Math.max(40, e.props?.bodyColumns ?? e.viewport?.columns ?? 80)
    const u = await read($, usage)
    const ui = await read($, paneUi)
    const allThreads = await read($, threads)

    // Usage: each limit window as a bar, coloured by how close it is to full.
    const barW = Math.max(10, Math.min(30, cols - 52))
    const PLAN: Record<string, string> = { prolite: 'Pro Lite', pro: 'Pro', plus: 'Plus', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', free: 'Free' }
    const usageBox = (
      <Box key="usage" flexDirection="column" borderStyle="round" borderColor="#30363D" paddingX={1}>
        <Box flexDirection="row">
          <Text bold color="#10A37F">{`Codex plan${u.plan ? `: ${PLAN[u.plan] ?? u.plan}` : ''}`}</Text>
          <Box flexGrow={1} />
          {u.seenAt ? <Text dimColor>{`as of ${stamp(u.seenAt)}  `}</Text> : null}
          <Button key="usage-refresh" plain onPress={() => void refreshUsage($).catch(() => undefined)}>
            {'↻ refresh'}
          </Button>
        </Box>
        {u.limits.length === 0 ? <Text dimColor wrap="wrap">{u.missing || 'Reading usage…'}</Text> : null}
        {u.limits.map(l => {
          const pct = Math.max(0, Math.min(100, l.usedPercent))
          const fill = Math.round((pct / 100) * barW)
          const tone = pct >= 90 ? '#F85149' : pct >= 70 ? '#E3B341' : '#3FB950'
          return (
            <Box flexDirection="row">
              <Text>{windowName(l.windowMinutes).padEnd(13)}</Text>
              <Text color={tone}>{'█'.repeat(fill)}</Text>
              <Text dimColor>{'░'.repeat(barW - fill)}</Text>
              <Text bold color={tone}>{` ${String(Math.round(pct)).padStart(3)}% used`}</Text>
              <Text dimColor wrap="truncate">{l.resetsAt ? ` · ${whenReset(l.resetsAt, now)}` : ''}</Text>
            </Box>
          )
        })}
        {list.length ? (
          <Text dimColor wrap="truncate">{`this session: ${list.length} run${list.length === 1 ? '' : 's'} · ${fmtK(list.reduce((n, r) => n + r.tokens, 0))} tokens`}</Text>
        ) : null}
      </Box>
    )

    // Threads: per project, newest first, each with its controls.
    const roots = [...new Set([sessionRoot, ...Object.keys(allThreads)].filter(Boolean))].filter(r => r === sessionRoot || Object.keys(allThreads[r] ?? {}).length)
    const threadRow = (root: string, key: string) => {
      const t = allThreads[root]?.[key]
      if (!t) return null
      const id = `${root}::${key}`
      const busy = list.some(r => r.status === 'running' && r.root === root && (r.threadKey ?? slug(r.thread)) === key)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color={t.archived ? '#8B949E' : '#10A37F'}>{`${t.archived ? '▫' : '▪'} ${t.name}`}</Text>
            <Text dimColor wrap="truncate">{`  ${t.runs} run${t.runs === 1 ? '' : 's'} · ${stamp(t.updated)} · ${t.model} / ${t.effort}${t.session ? '' : ' · starts fresh'}${busy ? ' · running now' : ''}`}</Text>
          </Box>
          <Text dimColor wrap="wrap">{`  last: ${trunc(oneLine(t.last), Math.max(40, cols * 2))}`}</Text>
          {ui.renaming === id && Input ? (
            <Input
              key={`rename-input:${id}`}
              label="  new name "
              value={t.name}
              autoFocus
              submitLabel="rename"
              onSubmit={(v: string) => {
                void threadAction($, root, key, 'rename', v).then(msg => $.ui.toast(msg)).catch(() => undefined)
                void update($, paneUi, s => ({ ...s, renaming: '' }))
              }}
            />
          ) : null}
          <Box flexDirection="row" flexWrap="wrap">
            <Text>{'  '}</Text>
            <Button key={`log:${id}`} plain onPress={() => void openInEditor($, `${root}/${MEMORY_DIR}/threads/${key}.md`, root, false)}>
              {'open log'}
            </Button>
            <Text dimColor>{' · '}</Text>
            <Button key={`rename:${id}`} plain onPress={() => void update($, paneUi, s => ({ ...s, renaming: s.renaming === id ? '' : id, confirmDelete: '' }))}>
              {ui.renaming === id ? 'cancel rename' : 'rename'}
            </Button>
            <Text dimColor>{' · '}</Text>
            <Button key={`reset:${id}`} plain onPress={() => void threadAction($, root, key, 'reset').then(msg => $.ui.toast(msg)).catch(() => undefined)}>
              {'fresh start'}
            </Button>
            <Text dimColor>{' · '}</Text>
            <Button key={`archive:${id}`} plain onPress={() => void threadAction($, root, key, t.archived ? 'unarchive' : 'archive').then(msg => $.ui.toast(msg)).catch(() => undefined)}>
              {t.archived ? 'restore' : 'archive'}
            </Button>
            <Text dimColor>{' · '}</Text>
            {ui.confirmDelete === id ? (
              <Button
                key={`delete-yes:${id}`}
                plain
                onPress={() => {
                  void threadAction($, root, key, 'delete').then(msg => $.ui.toast(msg)).catch(() => undefined)
                  void update($, paneUi, s => ({ ...s, confirmDelete: '' }))
                }}
              >
                {'⚠ press again to delete it and its log'}
              </Button>
            ) : (
              <Button key={`delete:${id}`} plain onPress={() => void update($, paneUi, s => ({ ...s, confirmDelete: id, renaming: '' }))}>
                {'delete'}
              </Button>
            )}
          </Box>
        </Box>
      )
    }
    const threadsBox = (
      <Box key="threads" flexDirection="column" borderStyle="round" borderColor="#30363D" paddingX={1}>
        <Box flexDirection="row">
          <Text bold color="#10A37F">{'Threads'}</Text>
          <Text dimColor wrap="truncate">{'  resumable conversations'}</Text>
          <Box flexGrow={1} />
          <Button key="show-archived" plain onPress={() => void update($, paneUi, s => ({ ...s, showArchived: !s.showArchived }))}>
            {ui.showArchived ? 'hide archived' : 'show archived'}
          </Button>
        </Box>
        {roots.length === 0 ? <Text dimColor>{'no project yet'}</Text> : null}
        {roots.map(root => {
          const reg = allThreads[root] ?? {}
          const keys = Object.keys(reg)
            .filter(k => ui.showArchived || !reg[k].archived)
            .sort((x, y) => reg[y].updated - reg[x].updated)
          const hidden = Object.keys(reg).length - keys.length
          return (
            <Box flexDirection="column">
              <Text color="#79C0FF" wrap="truncate">{`${baseName(root)}  `}</Text>
              {keys.length === 0 ? (
                <Text dimColor wrap="wrap">{`  no threads${hidden ? ` (${hidden} archived)` : ''}: ask Claude to give Codex a task "on a thread called …" to start one`}</Text>
              ) : null}
              {keys.map(k => threadRow(root, k))}
              {hidden && keys.length ? <Text dimColor>{`  ${hidden} archived`}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
    // The editor choice is the crew-map mod's setting, when it is installed (another plugin's value: read only).
    const crewState = ((await $.state.get({ plugin: 'crew-map', key: 'crew' } as never).catch(() => ({}))) as { value?: { editor?: string } }).value
    editor = crewState?.editor || 'code'
    const glyph: Record<RunEvent['kind'], string> = { say: '›', think: '·', cmd: '$', file: '✎', plan: '☐', info: '•', error: '!' }
    const tint: Record<RunEvent['kind'], string | undefined> = {
      say: '#E6EDF3',
      think: undefined,
      cmd: '#FFA657',
      file: '#7EE787',
      plan: '#D2A8FF',
      info: '#79C0FF',
      error: '#FF7B72',
    }
    const statusTint = { running: '#56D4DD', done: '#7EE787', failed: '#FF7B72', stopped: '#E3B341' } as const
    const statusMark = { running: '●', done: '✓', failed: '✗', stopped: '■' } as const

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold color="#10A37F">
            {`◎ CODEX v${VERSION}`}
          </Text>
          <Text dimColor>{`  │ ${list.filter(r => r.status === 'running').length} running · ${list.length} recent run${list.length === 1 ? '' : 's'}`}</Text>
        </Box>
        {usageBox}
        {list.length === 0 ? (
          <Box flexDirection="column" borderStyle="round" borderColor="#30363D" paddingX={1}>
            <Text bold color="#10A37F">
              {'No Codex runs yet'}
            </Text>
            {cliFound === false ? (
              <Text wrap="wrap" color="#E3B341">
                {'The Codex CLI was not found. Install the Codex app, or the CLI with `npm i -g @openai/codex`, then sign in with `codex login` and restart Claude.'}
              </Text>
            ) : null}
            <Text wrap="wrap" dimColor>
              {'Ask Claude to hand work to Codex, for example "have Codex review the renderer" or "give Codex a thread called chunk-loader and make chunk loading async". Claude picks the model and effort, Codex works in your project, and the result comes back here and to Claude.'}
            </Text>
            <Text wrap="wrap" dimColor>
              {`Codex keeps notes per project in ${MEMORY_DIR}/ (NOTES.md plus a log per thread), so a named thread can be picked up again later. Runs use your Codex subscription, not Claude's.`}
            </Text>
          </Box>
        ) : null}
        {list.length > 6 ? <Text dimColor>{`  showing the 6 latest of ${list.length} runs`}</Text> : null}
        {list.slice(0, 6).map(r => (
          <Box flexDirection="column" borderStyle="round" borderColor={statusTint[r.status]} paddingX={1}>
            <Box flexDirection="row">
              <Text bold color={statusTint[r.status]}>{`${statusMark[r.status]} ${r.thread ? `"${r.thread}"` : r.status}`}</Text>
              <Text dimColor wrap="truncate">{`  ${r.mode} · ${r.model} · ${r.effort} · ${elapsed((r.endedAt || now) - r.startedAt)}${r.resumed ? ' · continued' : ''} · asked by ${r.caller === 'main' ? 'Claude' : 'a helper Claude'} · in ${baseName(r.root || r.cwd)}`}</Text>
              <Box flexGrow={1} />
              {r.status === 'running' && stops.has(r.id) ? (
                <Button key={`stop-${r.id}`} plain onPress={() => stops.get(r.id)?.()}>
                  {'■ stop'}
                </Button>
              ) : null}
            </Box>
            <Box flexDirection="row">
              <Text dimColor>{'task '}</Text>
              <Text wrap="wrap">{trunc(oneLine(r.task), 300)}</Text>
            </Box>
            {r.status === 'running' ? <Text color="#56D4DD" wrap="truncate">{`… ${r.activity}`}</Text> : null}
            {r.events.slice(-8).map(ev => (
              <Box flexDirection="row">
                <Text color={tint[ev.kind]}>{`${glyph[ev.kind]} `}</Text>
                <Text wrap="wrap" dimColor={ev.kind === 'think'} color={tint[ev.kind]}>
                  {`${trunc(ev.text, 220)}${ev.kind === 'cmd' ? (ev.ok === undefined ? '  …' : ev.ok ? '  ✓' : '  ✗') : ''}`}
                </Text>
              </Box>
            ))}
            {r.files.length ? (
              <Text dimColor wrap="truncate">{`files changed (click to open in ${editor === 'system' ? 'your default app' : `${editorName(editor)}, as a diff against your last commit`}):`}</Text>
            ) : null}
            {r.files.slice(0, 8).map(f => (
              <Box flexDirection="row">
                <Text color="#7EE787">{'  ✎ '}</Text>
                <Button key={`open:${r.id}:${f}`} plain onPress={() => void openInEditor($, f, r.root || r.cwd)}>
                  {trunc(f.startsWith(`${r.root}/`) ? f.slice(r.root.length + 1) : f, 90)}
                </Button>
              </Box>
            ))}
            {r.status !== 'running' ? (
              <Text dimColor wrap="truncate">
                {`${r.files.length} file${r.files.length === 1 ? '' : 's'} changed · ${r.commands} command${r.commands === 1 ? '' : 's'}${r.failedCommands ? ` (${r.failedCommands} failed)` : ''} · ${r.tokens.toLocaleString()} tokens${r.notesUpdated ? ' · notes updated' : ''}`}
              </Text>
            ) : null}
          </Box>
        ))}
        {threadsBox}
      </Box>
    )
  })
}
