import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Change, Chat, CodexRun, Crew, Frame, LogLine, MapNode, MapView, PlanTask, Problem, Replay, ShellRun, Summary, TestRun } from '../types'

// ─── State ──────────────────────────────────────────────────────────────────

const PANE = 'crew-map'
/** Shown in the pane's header, so it is plain which version a chat is running. Keep in step with plugin.json. */
const VERSION = '1.8.3'
/** How /crew's request to Claude starts: the log and the last task leave that turn out. */
const OPEN_ASK = 'Open my Claude Crew website in the browser pane'
const MAX_AGENTS = 12
const MAX_NODES = 60
const MAX_GHOSTS = 14
const LINGER_MS = 90_000

const crew = atom({ plugin: 'crew-map', key: 'crew' } as const, {
  agents: [],
  nodes: {},
  trails: [],
  log: [],
  calls: 0,
  startedAt: 0,
  changes: {},
  zoom: 1,
  showFiles: false,
  demoCodex: [],
  editor: 'code',
  tests: [],
  problems: [],
  timeline: [],
  budget: 0,
  budgetWarned: 0,
  turnBase: { at: 0, goal: '', changes: {}, tokens: 0, cost: 0, tests: 0, failed: 0, codex: 0 },
  summary: null,
  spent: { tokens: 0, cost: 0 },
} as Crew)
const replay = atom({ plugin: 'crew-map', key: 'replay' } as const, { on: false, at: 0, playing: false } as Replay)
const tick = atom({ plugin: 'crew-map', key: 'tick' } as const, 0)
/** The map's window: where it sits over the map, how far zoomed, whether it follows the fit. */
const mapView = atom({ plugin: 'crew-map', key: 'view' } as const, { x: 0, y: 0, k: 1, auto: true, rev: 'fit', sel: false, follow: 0 } as MapView)
/** The search box: what is typed, which hit is shown, and a stamp per change. */
const search = atom({ plugin: 'crew-map', key: 'search' } as const, { q: '', i: 0, rev: 0 })
// ─── Tests ──────────────────────────────────────────────────────────────────

/**
 * A command tidied, with heredoc bodies taken out (the text it carries, not what it runs).
 * Only a real heredoc counts: `cat <<EOF`, not the shift in `$((1<<4))`.
 */
const cmdHead = (cmd: string) =>
  tidyCmd(
    cmd
      .replace(/\\\r?\n/g, ' ')
      .replace(/(^|\s)<<-?\s*(['"]?)([A-Za-z_]\w*)\2([^\n]*)\n[\s\S]*?\n\s*\3[ \t]*(?=\n|$)/g, '$1‹‹$3 …$4') // marked ‹‹ so the next step, for an unclosed one, leaves it be
      .replace(/(^|\s)(<<-?\s*['"]?[A-Za-z_]\w*['"]?[^\n]*)\n[\s\S]*$/, '$1$2 …')
      // Each line is its own command.
      .replace(/\s*\r?\n\s*/g, ' ; '),
  )

/**
 * A command's parts (`a && b; c | d`), each as [program, ...arguments]: a shell's quoted script
 * (`bash -c "…"`, `powershell -Command "…"`) is unwrapped, other quoted text blanked, and
 * wrappers skipped (npx, `python -m`, `uv run`, timeout, env…), so what is left is what runs.
 */
const cmdParts = (cmd: string): string[][] => {
  const unwrapped = cmdHead(cmd)
    // Combined flags count too: Codex runs everything as `bash -lc "…"`.
    .replace(/\b(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*?(?:-[A-Za-z]*c|-Command)\s+(["'])(.*?)\1/gi, (_m, _q, inner: string) => ` ; ${inner} ; `)
    // A quoted program ("C:/Program Files/nodejs/npx.cmd") is still the program: keep its name.
    .replace(/(^|[;&|]\s*)(["'])([^"']+)\2/g, (_m, pre: string, _q, p: string) => `${pre}${p.replace(/^.*[\\/]/, '').replace(/\s+/g, '_')}`)
    .replace(/"[^"]*"|'[^']*'/g, '""')
    // Redirects (2>&1, >/dev/null, >> out.txt) are not commands: their & would split one in two.
    .replace(/\s*\d*[<>]&\d+/g, ' ')
    .replace(/\s*\d*>>?\s*\S+/g, ' ')
  const prog = (w: string) => w.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/, '')
  return unwrapped
    .split(/&&|\|\||[;|&\n]/)
    .map(part => {
      const w = part.trim().split(/\s+/).filter(Boolean)
      while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w.shift()
      for (;;) {
        const p = prog(w[0] ?? '')
        if (['npx', 'bunx', 'pnpx', 'sudo', 'env', 'time', 'nice', 'exec'].includes(p)) w.shift()
        else if (p === 'timeout') {
          w.shift()
          while (w[0]?.startsWith('-')) w.shift()
          if (/^\d/.test(w[0] ?? '')) w.shift()
        } else if (['uv', 'poetry', 'pipenv', 'hatch', 'pdm'].includes(p) && w[1] === 'run') w.splice(0, 2)
        else if (['pnpm', 'yarn'].includes(p) && ['exec', 'dlx'].includes(w[1])) w.splice(0, 2)
        // The Windows launcher's version flag (py -3.12 -m pytest) picks a Python, not what runs.
        else if (p === 'py' && /^-\d/.test(w[1] ?? '')) w.splice(1, 1)
        else if (/^(python3?|py)$/.test(p) && w[1] === '-m' && w[2]) w.splice(0, 2)
        else break
      }
      if (w[0]) w[0] = prog(w[0])
      return w
    })
    .filter(w => w.length)
}

/** Tools whose first word after the program says what ran (git status, npm install, claude plugin validate). */
const SUBCOMMANDS = /^(git|npm|pnpm|yarn|bun|cargo|go|docker|kubectl|gh|claude|dotnet|uv|pip|pip3|brew|terraform|make|deno|winget|choco|rustup|poetry)$/
/** Housekeeping that says nothing about the work: left out when a command does more. */
const CHORES = /^(cd|pushd|popd|echo|printf|true|false|set|export|sleep|test|\[|exit|wait|head|tail|grep|rg|wc|sort|uniq|cut|tr|tee|xargs|less|more|cat|jq)$/
/**
 * What a command runs, in a few words and without its arguments, for when Claude gave no
 * description: "ran sed, cp, diff", "ran a Python script", "ran claude plugin validate".
 */
const cmdGist = (cmd: string) => {
  const names: string[] = []
  for (const w of cmdParts(cmd)) {
    const p = w[0]
    if (!p || p.startsWith('$') || p === '""') continue
    const args = w.slice(1).filter(x => x && x !== '""' && x !== '…')
    const firstArg = args.find(x => !x.startsWith('-')) ?? ''
    let name = p
    if (/^(python3?|py|node|deno|bun|ruby|php|perl|pwsh|powershell|bash|sh)$/.test(p) && (args.includes('-') || args.includes('-e') || args.includes('-c') || /^‹‹/.test(firstArg))) {
      const lang = /^(python3?|py)$/.test(p) ? 'Python' : /^(node|deno|bun)$/.test(p) ? 'Node' : p === 'ruby' ? 'Ruby' : p === 'php' ? 'PHP' : p === 'perl' ? 'Perl' : /^(pwsh|powershell)$/.test(p) ? 'PowerShell' : 'shell'
      name = `a ${lang} script`
    } else if (SUBCOMMANDS.test(p)) {
      const subs = args.filter(x => !x.startsWith('-') && /^[a-z][\w:-]*$/.test(x)).slice(0, p === 'claude' || p === 'gh' || ((p === 'npm' || p === 'pnpm' || p === 'yarn' || p === 'bun') && args.find(x => !x.startsWith('-')) === 'run') ? 2 : 1)
      name = [p, ...subs].join(' ')
    } else if (/^(python3?|py|node|deno|bun|ruby|php|bash|sh|pwsh|powershell)$/.test(p) && /\.(py|m?js|ts|rb|php|sh|ps1)$/i.test(firstArg)) name = `${p} ${firstArg.split(/[\\/]/).pop()}`
    if (!names.includes(name)) names.push(name)
  }
  const work = names.filter(n => !CHORES.test(n))
  const shown = (work.length ? work : names).slice(0, 3)
  return shown.length ? `ran ${shown.join(', ')}${(work.length ? work : names).length > 3 ? ', …' : ''}` : 'ran a shell command'
}

/** A path that names tests: tests/…, test_x.py, x.test.ts, run_tests.sh, spec/… (not "latest"). */
const TESTY = /(^|[\\/_.-])(tests?|specs?)([\\/_.-]|$)/i
const TEST_PROGS = /^(pytest|py\.test|jest|vitest|mocha|ava|tap|nextest|ctest|rspec|phpunit|unittest|nose2|tox|karma)$/
/** Whether one part of a command runs tests. */
const isTestPart = (w: string[]) => {
  const [p, a = '', b = ''] = w
  if (TEST_PROGS.test(p)) return !/^(--version|-v|-V|--help|init|install)$/.test(a)
  if (p === 'cargo') return /^(test|t|nextest)$/.test(a)
  if (['go', 'dotnet', 'swift', 'flutter', 'deno', 'dart', 'mix', 'bun'].includes(p) && a === 'test') return true
  if (/^(npm|pnpm|yarn|bun)$/.test(p)) return /^(test|t)$/.test(a) || (a === 'run' && /^test/.test(b))
  if (p === 'playwright') return a === 'test'
  if (/^(mvn|mvnw|gradle|gradlew)$/.test(p)) return w.slice(1).some(x => /^(test|check|verify)$/.test(x))
  if (p === 'make') return /^(test|tests|check)$/.test(a)
  // A script that runs tests: node tests/run.mjs, python run_tests.py, bash scripts/test.sh.
  if (/^(node|deno|bun|python3?|py|sh|bash|pwsh|powershell|ruby|php)$/.test(p)) return TESTY.test(w.slice(1).find(x => !x.startsWith('-')) ?? '')
  return false
}
/**
 * A command that runs tests, or waits on a run by watching its log; not one that only mentions
 * them (`mkdir tests`, `pip install pytest`, `cat jest.config.js`, `python fetch_latest.py`).
 */
const isTestCmd = (cmd: string) => cmdParts(cmd).some(isTestPart) || TESTY.test(watchedFile(cmd) === 'a log file' ? '' : watchedFile(cmd))
const TEST_SHOW_MS = 10 * 60_000
/** A command in the foreground shows as running once it has run this long (a quick `ls` never flashes up). */
const SHELL_SHOW_MS = 2000
/** A background command nobody hears about again is let go after this long. */
const SHELL_GIVE_UP_MS = 6 * 60 * 60_000
/** The shell commands running now that are worth showing: background ones, and foreground ones past a moment. */
const runningShells = (c: Crew, now: number) => (c.shells ?? []).filter(x => x.status === 'running' && (x.background || now - x.startedAt >= SHELL_SHOW_MS))
/** A background shell's end, as its id names it: in what Claude read of it, a stop, or the app's task notice. */
const endShell = (c: Crew, shellId: string, status: ShellRun['status'], now: number): Crew => {
  const x = (c.shells ?? []).find(r => r.status === 'running' && r.shellId && r.shellId === shellId)
  if (!x) return c
  const d = { ...c, shells: (c.shells ?? []).map(r => (r === x ? { ...r, status, endedAt: now } : r)) }
  return log(d, x.agentId, 'info', `${status === 'failed' ? '✗' : status === 'stopped' ? '■' : '✓'} background command ${status === 'done' ? 'finished' : status} after ${elapsed(now - x.startedAt)} · ${x.label}`)
}

/**
 * A test command as a person would say it: no timeout wrapper, output
 * redirects or pipes, and programs by name rather than by path
 * (`timeout 2400 .venv/Scripts/python.exe -m unittest … > "C:/…/out.txt"` → `python -m unittest …`).
 */
const testLabel = (cmd: string) => {
  const watched = watchedFile(cmd)
  if (watched) return `watching ${watched}`
  let s = tidyCmd(cmd)
  s = s.replace(/\s*\|.*$/, '')
  s = s.replace(/\s*\d?>>?\s*(?:&\d|"[^"]*"|'[^']*'|\S+)/g, '')
  s = s.replace(/^\s*timeout\s+(?:-\S+\s+)*\d+[smh]?\s+/i, '')
  s = s.replace(/(^|\s)(?:"([^"]*[\\/])?([^"\\/]+)"|(\S*[\\/])([^\s\\/]+))/g, (m, sp, _d1, q, _d2, b) => {
    const name = (q ?? b ?? '').replace(/\.(exe|cmd|bat)$/i, '')
    // Only programs (the first word) and things that look like executables lose their folders.
    return sp === '' || /\.(exe|cmd|bat)$/i.test(q ?? b ?? '') ? `${sp}${name}` : m
  })
  return s.trim() || tidyCmd(cmd)
}

/**
 * The file a polling loop keeps reading (`until grep … log; do sleep 5; done`, `tail -f log`):
 * such a command waits on a test run rather than running one. '' when it is not one.
 */
const watchedFile = (cmd: string) => {
  const isLoop = (/\b(until|while)\b/.test(cmd) && /\bsleep\b/.test(cmd)) || /\btail\s+(-\w+\s+)*-[fF]\b/.test(cmd)
  if (!isLoop) return ''
  const paths = [...cmd.matchAll(/(?:^|[\s"'(=])((?:[A-Za-z]:)?[\w./\\-]*[\w-]\.(?:txt|log|out|json|xml|jsonl|md|csv))(?=$|[\s"');|])/g)].map(m => m[1])
  return paths[paths.length - 1] ?? 'a log file'
}

/**
 * What a test run checks, in a few words: the targets named after the runner
 * (`cargo test chunk` → "chunk", `pytest tests/test_auth.py -k login` → "test_auth.py, login"),
 * or "all tests" when it names none.
 */
const testTargets = (cmd: string) => {
  // From the command as shown: no redirects, pipes or timeout wrapper to mistake for targets.
  const s = testLabel(cmd).replace(/\s*[|;&].*$/, '')
  const at = s.search(/\b(test|tests|pytest|jest|vitest|mocha|nextest|ctest|rspec|phpunit|unittest)\b/i)
  if (at < 0) return ''
  const words = s.slice(at).split(/\s+/).slice(1)
  const out: string[] = []
  for (let i = 0; i < words.length && out.length < 3; i++) {
    const w = words[i].replace(/^["']|["']$/g, '')
    if (!w || w === '--' || /^(run|discover|watch|test|tests)$/i.test(w)) continue
    // A flag's value counts only for the ones that pick tests (-k, -t, --filter, -p, --test, -s).
    if (w.startsWith('-')) {
      if (/^(-k|-t|--filter|--testNamePattern|-p|--package|--test|-s)$/.test(w) && words[i + 1]) {
        out.push(words[i + 1].replace(/^["']|["']$/g, ''))
        i++
      }
      continue
    }
    out.push(w.split(/[\\/]/).filter(Boolean).pop() ?? w)
  }
  return out.join(', ')
}

/** The title of a test run: what Claude said the command does, else its kind and targets. */
const testPurpose = (cmd: string, description: string) => {
  const said = oneLine(description).replace(/\.$/, '')
  if (said) return said
  const watched = watchedFile(cmd)
  if (watched) return `Waiting on a test run (${baseName(watched)})`
  const targets = testTargets(cmd)
  const kind = testKind(cmd)
  return targets ? `${kind[0].toUpperCase()}${kind.slice(1)}: ${targets}` : `All ${kind}`
}

/** The kind of test run, in words, from the runner the command uses. */
const testKind = (cmd: string) =>
  /\bcargo\b/.test(cmd) ? 'Rust tests (cargo)'
  : /\bpytest\b/.test(cmd) ? 'Python tests (pytest)'
  : /\bunittest\b/.test(cmd) ? 'Python tests (unittest)'
  : /\bvitest\b/.test(cmd) ? 'JS tests (vitest)'
  : /\bjest\b/.test(cmd) ? 'JS tests (jest)'
  : /\bmocha\b/.test(cmd) ? 'JS tests (mocha)'
  : /\b(npm|pnpm|yarn|bun)\b/.test(cmd) ? 'JS tests'
  : /\bgo\s+test\b/.test(cmd) ? 'Go tests'
  : /\bdotnet\b/.test(cmd) ? '.NET tests'
  : /\bctest\b/.test(cmd) ? 'C/C++ tests (ctest)'
  : 'tests'

/** Pass and fail counts from a test run's output, across the common runners. */
const testCounts = (out: string): { passed: number; failed: number } | undefined => {
  // cargo: one "test result:" line per test binary; sum them.
  const cargo = [...out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)]
  if (cargo.length) return cargo.reduce((s, m) => ({ passed: s.passed + Number(m[1]), failed: s.failed + Number(m[2]) }), { passed: 0, failed: 0 })
  // jest / vitest summary line ("Tests: 1 failed, 41 passed, 42 total", "Tests  41 passed | 1 failed (42)").
  const summary = out.split(/\r?\n/).reverse().find(l => /^\s*Tests?:?\s/.test(l) && /\d+ (passed|failed)/.test(l))
  // pytest ("=== 1 failed, 40 passed in 2.1s ==="), go, mocha ("41 passing", "1 failing") and the rest: the last line that counts.
  const line = summary ?? out.split(/\r?\n/).reverse().find(l => /\d+ (passed|failed|passing|failing)/.test(l))
  if (!line) return undefined
  const n = (re: RegExp) => Number(line.match(re)?.[1] ?? 0)
  return { passed: n(/(\d+) pass(?:ed|ing)/), failed: n(/(\d+) fail(?:ed|ing)/) }
}

const testWords = (t: { status: string; passed: number; failed: number }) =>
  t.passed || t.failed
    ? [t.failed ? `${fmtK(t.failed)} failed` : '', t.passed ? `${fmtK(t.passed)} passed` : ''].filter(Boolean).join(', ')
    : t.status === 'passed'
      ? 'passed'
      : t.status === 'failed'
        ? 'failed'
        : 'no result seen'

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}

/** How long something took, as the log shows it: 340ms, 2.4s, 1m12s, 1h03m. */
const took = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : ms < 60_000 ? `${(Math.floor(ms / 100) / 10).toFixed(1)}s` : elapsed(ms))

/** A tool result's text, whatever shape it came back in. */
const resultText = (r: unknown): string => {
  if (!r || typeof r !== 'object') return typeof r === 'string' ? r : ''
  const o = r as { text?: unknown; content?: unknown; output?: unknown; stdout?: unknown; stderr?: unknown }
  const parts = [o.text, o.output, o.stdout, o.stderr].filter((x): x is string => typeof x === 'string')
  if (typeof o.content === 'string') parts.push(o.content)
  else if (Array.isArray(o.content))
    for (const b of o.content) if (b && typeof (b as { text?: unknown }).text === 'string') parts.push((b as { text: string }).text)
  return parts.join('\n').slice(-20_000)
}

/** Settles a running test from its output and outcome; the log and a toast say how it went. */
const settleTest = (c: Crew, testId: string, out: string, isError: boolean, now: number): Crew => {
  const t = c.tests.find(x => x.id === testId)
  if (!t || t.status !== 'running') return c
  const counts = testCounts(out)
  const failed = isError || (counts ? counts.failed > 0 : /\b(FAIL|FAILED|failures?:\s*[1-9])\b/.test(out))
  const done: typeof t = { ...t, endedAt: now, status: failed ? 'failed' : 'passed', passed: counts?.passed ?? 0, failed: counts?.failed ?? 0 }
  const secs = Math.max(1, Math.round((now - t.startedAt) / 1000))
  const d = { ...c, tests: c.tests.map(x => (x.id === testId ? done : x)), turnBase: failed && t.startedAt >= c.turnBase.at && !t.agentId.startsWith('demo-') ? { ...c.turnBase, failed: (c.turnBase.failed ?? 0) + 1 } : c.turnBase }
  return log(d, t.agentId, 'info', `${failed ? '✗ tests failed' : '✓ tests passed'} (${testWords(done)}) in ${secs}s · ${trunc(t.purpose || testPurpose(t.command, ''), 60)}`)
}

// ─── Problems: errors a build or test names, by file and line ──────────────

/** Builds, type checks and linters, named as a command runs them (so `rm -rf build` is not one). */
/** Whether one part of a command builds, type-checks or lints (so `rm -rf build`, `npm i -D eslint` do not). */
const isBuildPart = (w: string[]) => {
  const [p, a = '', b = ''] = w
  if (/^(tsc|webpack|esbuild|rollup|gcc|g\+\+|clang|clang\+\+|javac|mypy|ruff|eslint|msbuild|ninja|rustc|pyright|biome)$/.test(p)) return !/^(--version|-v|--help|--init|init)$/.test(a)
  if (p === 'make') return !/^(test|tests|check|install|clean)$/.test(a)
  if (p === 'cmake') return a === '--build'
  if (p === 'cargo') return /^(build|b|check|c|clippy)$/.test(a)
  if (p === 'go') return /^(build|vet)$/.test(a)
  if (p === 'dotnet') return a === 'build'
  if (/^(npm|pnpm|yarn|bun)$/.test(p)) return a === 'run' ? /^(build|lint|typecheck|check|tsc)/.test(b) : /^(build|lint|typecheck)$/.test(a)
  if (/^(vite|next|nuxt|astro)$/.test(p)) return a === 'build'
  if (/^(gradle|gradlew)$/.test(p)) return w.slice(1).some(x => /^(build|assemble|compile\w*)$/.test(x))
  if (/^(mvn|mvnw)$/.test(p)) return w.slice(1).some(x => /^(compile|package|install)$/.test(x))
  return false
}
const isBuildCmd = (cmd: string) => cmdParts(cmd).some(isBuildPart)
const MAX_PROBLEMS = 30
const SRC = String.raw`((?:[A-Za-z]:)?[^\s:()"'<>|*?]*[\w-]\.[A-Za-z][\w]{0,5})`

/**
 * Errors in a build's or test's output that name a file: rustc and cargo
 * panics, tsc, C#/MSBuild, gcc/clang/go, Python tracebacks and pytest,
 * jest/vitest stack frames. Paths come back as written; the caller resolves them.
 */
const parseProblems = (out: string): { path: string; line: number; message: string }[] => {
  const found: { path: string; line: number; message: string }[] = []
  const add = (path: string, line: string | number, message: string) => {
    const p = path.trim()
    if (!p || /node_modules|site-packages|[\\/]rustc[\\/]|[\\/]\.cargo[\\/]registry|<anonymous>|^internal[\\/]/i.test(p)) return
    if (found.some(f => f.path === p && f.line === Number(line))) return
    found.push({ path: p, line: Number(line) || 0, message: trunc(oneLine(message), 160) })
  }
  const text = out.replace(/\x1b\[[0-9;]*m/g, '')
  // rustc: "error[E0308]: mismatched types" then "  --> src/a.rs:12:5".
  for (const m of text.matchAll(new RegExp(String.raw`^error(?:\[\w+\])?: (.+)\r?\n\s*--> ${SRC}:(\d+)`, 'gm'))) add(m[2], m[3], m[1])
  // cargo test panics: "thread 'x' panicked at src/a.rs:12:5:\nmessage".
  for (const m of text.matchAll(new RegExp(String.raw`panicked at ${SRC}:(\d+):\d+:?\r?\n(.*)`, 'g'))) add(m[1], m[2], m[3] || 'panicked')
  // tsc and MSBuild: "src/a.ts(12,5): error TS2322: ..."; tsc pretty: "src/a.ts:12:5 - error TS2322: ...".
  for (const m of text.matchAll(new RegExp(String.raw`^\s*${SRC}\((\d+),\d+\): (?:fatal )?error \w+: (.+?)(?: \[[^\]]*\])?$`, 'gm'))) add(m[1], m[2], m[3])
  for (const m of text.matchAll(new RegExp(String.raw`^${SRC}:(\d+):\d+ - error \w+: (.+)$`, 'gm'))) add(m[1], m[2], m[3])
  // gcc, clang, go, mypy, eslint-unix: "src/a.c:12:5: error: ..." (go has no "error:").
  for (const m of text.matchAll(new RegExp(String.raw`^\s*${SRC}:(\d+)(?::\d+)?: (?:fatal )?error:? (.+)$`, 'gm'))) add(m[1], m[2], m[3])
  for (const m of text.matchAll(new RegExp(String.raw`^(?:\.\/)?${SRC}:(\d+):\d+: (?!warning|note)(.+)$`, 'gm'))) if (/\.go$/.test(m[1])) add(m[1], m[2], m[3])
  // Python: the deepest project frame of each traceback, with the exception line under it.
  for (const tb of text.split(/^Traceback \(most recent call last\):/m).slice(1)) {
    const frames = [...tb.matchAll(/^\s*File "([^"]+)", line (\d+)/gm)].filter(f => !/site-packages|[\\/]lib[\\/]python|<frozen/i.test(f[1]))
    const exc = tb.split(/\r?\n/).find(l => /^\w[\w.]*(Error|Exception|Exit|Interrupt)\b/.test(l)) ?? 'exception'
    const last = frames[frames.length - 1]
    if (last) add(last[1], last[2], exc)
  }
  // pytest: "tests/test_a.py:12: AssertionError" and "FAILED tests/test_a.py::test_x - AssertionError: ...".
  for (const m of text.matchAll(new RegExp(String.raw`^${SRC}:(\d+): (\w*(?:Error|Exception)\b.*)$`, 'gm'))) add(m[1], m[2], m[3])
  for (const m of text.matchAll(new RegExp(String.raw`^FAILED ${SRC}::(\S+)(?: - (.+))?$`, 'gm'))) add(m[1], 0, `${m[2]}${m[3] ? `: ${m[3]}` : ''}`)
  // jest / vitest: the first project frame after a failure heading.
  for (const block of text.split(/^\s*(?:●|FAIL\b|×|✗|❯ .*\.(?:test|spec)\.)/m).slice(1)) {
    const head = oneLine(block.split(/\r?\n/).find(l => /\S/.test(l)) ?? '')
    const why = block.split(/\r?\n/).find(l => /(Error|expected|Expected|toBe|toEqual|AssertionError)/.test(l)) ?? head
    const frame = block.match(new RegExp(String.raw`(?:\(|❯ |at )${SRC}:(\d+):\d+`))
    if (frame) add(frame[1], frame[2], why)
  }
  return found.slice(0, MAX_PROBLEMS)
}

/** The folder a command ran in: a leading `cd X &&` moves it from the session's. */
const cmdDir = (raw: string, base: string) => {
  const m = raw.match(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)/)
  if (!m) return base
  const d = m[1].replace(/^["']|["']$/g, '')
  return /^([A-Za-z]:[\\/]|[\\/])/.test(d) ? norm(d) : norm(`${base}/${d}`)
}

/** A path from tool output made absolute against the folder the command ran in. */
const resolvePath = (p: string, dir: string) => {
  const s = p.replace(/^\.[\\/]/, '')
  return /^([A-Za-z]:[\\/]|[\\/])/.test(s) || !dir ? norm(s) : norm(`${dir}/${s}`)
}

// ─── Stuck: the same thing failing over and over ────────────────────────────

const STUCK_WINDOW_MS = 10 * 60_000
/** Why an agent looks stuck from its recent calls, or ''. */
const stuckReason = (recent: Agent['recent'], now: number): string => {
  const live = recent.filter(r => now - r.at < STUCK_WINDOW_MS)
  const last = live[live.length - 1]
  if (!last) return ''
  if (!last.ok && last.sig.startsWith('$ ')) {
    // The same command failing, with no success of it in between.
    let n = 0
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].sig !== last.sig) continue
      if (live[i].ok) break
      n++
    }
    if (n >= 3) return `ran the same command ${n} times (${cmdGist(last.sig.slice(2)).replace(/^ran /, '')}) and it failed every time`
  }
  const tail = live.slice(-5)
  if (tail.length === 5 && tail.every(r => !r.ok)) return 'its last 5 tool calls all failed'
  if (last.sig.startsWith('✎ ')) {
    const edits = live.filter(r => r.sig === last.sig && now - r.at < 5 * 60_000).length
    if (edits >= 8) return `edited ${last.sig.slice(2)} ${edits} times in 5 minutes`
  }
  return ''
}

// ─── Summary of a finished task ─────────────────────────────────────────────

/** A path relative to the session's folder when it is inside it; demo paths lose their prefix. */
const relPath = (p: string) =>
  p.startsWith('demo/') ? p.slice(5) : sessionDir && p.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`) ? p.slice(sessionDir.length + 1) : shortPath(p)

const summaryMarkdown = (s: Summary) => {
  const lines = [
    `### ${s.goal ? trunc(s.goal, 120) : 'Claude Code task'}`,
    '',
    `- **Time:** ${elapsed(s.ms)}`,
    `- **Files changed:** ${s.files.length}${s.files.length ? ` (+${s.files.reduce((n, f) => n + f.added, 0)} −${s.files.reduce((n, f) => n + f.removed, 0)} lines)` : ''}${s.read ? `, ${s.read} more read` : ''}`,
    `- **Tests:** ${s.tests.runs ? `${s.tests.runs} run${s.tests.runs === 1 ? '' : 's'}${s.tests.failed ? `, ${s.tests.failed} failed` : ''}; last: ${s.tests.last}` : 'none run'}`,
    `- **Claudes:** ${s.claudes.join(', ')}${s.codex ? ` · Codex runs: ${s.codex}` : ''}`,
    `- **Cost:** ${s.tokens.toLocaleString()} tokens ≈ ${fmtUsd(s.cost)} at API rates`,
    ...(s.problems ? [`- **Open problems:** ${s.problems} error${s.problems === 1 ? '' : 's'} from the last build/test`] : []),
  ]
  if (s.files.length) lines.push('', '| File | + | − |', '| --- | ---: | ---: |', ...s.files.slice(0, 30).map(f => `| \`${relPath(f.path)}\` | ${f.added} | ${f.removed} |`))
  return lines.join('\n')
}

/** Builds the summary of the task that just ended, from what changed since it began. */
const summarise1 = (c: Crew, now: number, codexRuns: number): Summary => {
  const base = c.turnBase
  const files = Object.entries(c.changes)
    .filter(([p, ch]) => !p.startsWith('demo/') && ch.at >= base.at && ch.edits > 0)
    .map(([path, ch]) => ({ path, added: ch.added - (base.changes[path]?.added ?? 0), removed: ch.removed - (base.changes[path]?.removed ?? 0) }))
    .filter(f => f.added || f.removed)
    .sort((x, y) => y.added + y.removed - (x.added + x.removed))
  const read = Object.entries(c.changes).filter(([p, ch]) => !p.startsWith('demo/') && ch.at >= base.at && ch.edits === 0).length
  const lastTest = [...c.tests].reverse().find(t => t.startedAt >= base.at && t.status !== 'running' && !t.agentId.startsWith('demo-'))
  const worked = new Set(c.timeline.filter(f => f.at >= base.at).map(f => f.agentId))
  return {
    at: now,
    goal: base.goal,
    ms: now - (base.at || now),
    files,
    read,
    tests: { runs: base.tests ?? 0, failed: base.failed ?? 0, last: lastTest ? `${lastTest.status} (${testWords(lastTest)})` : 'a run still going' },
    tokens: Math.max(0, (c.spent?.tokens ?? 0) - base.tokens),
    cost: Math.max(0, (c.spent?.cost ?? 0) - base.cost),
    claudes: c.agents.filter(a => a.id === 'main' || worked.has(a.id)).map(a => a.name),
    codex: Math.max(0, codexRuns - base.codex),
    problems: c.problems.length,
  }
}

// ─── Replay: the map as it stood at a step of the timeline ──────────────────

const MAX_FRAMES = 300
/** The crew as it was at frame `i`: each Claude where its last step put it, edits summed so far. */
const crewAt = (c: Crew, i: number, now: number): Crew => {
  const frames = c.timeline.slice(0, i + 1)
  const cur = frames[frames.length - 1]
  const lastOf = new Map<string, { f: Frame; k: number }>()
  frames.forEach((f, k) => lastOf.set(f.agentId, { f, k }))
  const agents: Agent[] = []
  for (const [id, { f, k }] of lastOf) {
    // A Claude drops off the map a dozen steps after its last one.
    if (i - k > 12) continue
    const known = c.agents.find(a => a.id === id)
    const prev = frames.slice(0, k).reverse().find(x => x.agentId === id)
    agents.push({
      ...(known ?? blank(id, f.name, 'agent', f.hue)),
      name: f.name,
      hue: f.hue,
      node: f.node,
      from: prev?.node ?? '',
      movedAt: f === cur && prev && prev.node !== f.node ? now : 0,
      tool: f.tool,
      detail: f.detail,
      state: f === cur ? 'busy' : 'thinking',
      thoughts: [],
      stuck: '',
      doing: '',
    })
  }
  const changes: Crew['changes'] = {}
  for (const f of frames) {
    if (!f.node || isSpecial(f.node)) continue
    const ch = changes[f.node] ?? { added: 0, removed: 0, edits: 0, reads: 0, by: f.name, hue: f.hue, at: f.at }
    changes[f.node] = f.added || f.removed ? { ...ch, added: ch.added + f.added, removed: ch.removed + f.removed, edits: ch.edits + 1, by: f.name, hue: f.hue, at: f.at } : { ...ch, reads: ch.reads + 1 }
  }
  const seen = new Set(frames.map(f => f.node))
  const nodes = Object.fromEntries(Object.entries(c.nodes).filter(([id, n]) => seen.has(id) || n.kind === 'ghost'))
  return { ...c, agents, changes, nodes, tests: [], problems: [] }
}

/** Where code and text files open: 'code' (VS Code), 'cursor' or 'system', chosen in the pane. Other files open in their own app. */
let editor = 'code'
/** The session's folder, for paths in tool output; set at session start. */
let sessionDir = ''
let platform: 'win' | 'mac' | 'linux' | undefined
/** Which OS this runs on: Windows says so in OS; elsewhere uname tells macOS from Linux. */
const platformOf = async ($: EngineInterface) => {
  if (platform) return platform
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return (platform = 'win')
  const u = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined)
  return (platform = /darwin/i.test(u?.stdout ?? '') ? 'mac' : 'linux')
}
let tempDir = ''

/**
 * Anthropic API list prices, dollars per million tokens (cached 2026-09):
 * input, output, cache read, cache write. Matched on the model id.
 */
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/i, [10, 50, 0.25, 12.5]],
  [/opus-5-5/i, [4, 20, 0.2, 5]],
  [/opus/i, [5, 25, 0.5, 6.25]],
  [/sonnet-5/i, [2, 10, 0.2, 2.5]],
  [/sonnet/i, [3, 15, 0.3, 3.75]],
  [/haiku/i, [1, 5, 0.1, 1.25]],
]
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; model?: string }
/** A count that can be added up: a finite number of zero or more, else 0 (a junk usage never poisons a total). */
const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const tokensOf = (u: Usage) => fin(u.input_tokens) + fin(u.output_tokens) + fin(u.cache_read_input_tokens) + fin(u.cache_creation_input_tokens)
const costOf = (u: Usage) => {
  const [i, o, r, w] = (PRICES.find(([re]) => re.test(typeof u.model === 'string' ? u.model : '')) ?? PRICES[1])[1]
  return (fin(u.input_tokens) * i + fin(u.output_tokens) * o + fin(u.cache_read_input_tokens) * r + fin(u.cache_creation_input_tokens) * w) / 1e6
}
/** A count in at most five characters: 7, 950, 1.2k, 12k, 345k, 1.0M, 33M, 2.1B. */
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
/** Dollars, short at any size: $0, <$0.01, $0.42, $12.30, $123, $1.2k. */
const fmtUsd = (n: number) => (!(n > 0) ? '$0' : n < 0.01 ? '<$0.01' : n < 100 ? `$${n.toFixed(2)}` : n < 999.5 ? `$${Math.round(n)}` : `$${fmtK(n)}`)

// Set from session.start, so timers and handlers outlive the dispatch that made them.
let write: ((fn: (c: Crew) => Crew) => Promise<unknown>) | undefined
/** Every write of the crew waits for the one before it: parallel tool calls never race (a race made each retry, N² writes). */
let writeQueue: Promise<unknown> = Promise.resolve()
/** The 1 s clock: one, kept so a second session start replaces it rather than adding another. */
let ticker: { cancel(): void } | undefined
// ── Nested chats: the chats started from this one, read from the desktop app's own session list ──
const LIST_TOOL = 'mcp__ccd_session_mgmt__list_sessions'
let refreshChats: (() => Promise<void>) | undefined
let chatPoller: { cancel(): void } | undefined
/** True while the pane itself reads the list, so its own call is not logged as Claude's. */
let pollingChats = false
/** When the pane last read the list by itself. */
let chatsReadAt = 0
/**
 * The chats under this one, from list_sessions' `{ linked: true }` answer (this chat's family, less
 * itself): this chat is the one that started those whose starter the list doesn't hold.
 */
const chatsOf = (text: string): Chat[] | undefined => {
  let rows: unknown
  try {
    rows = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(rows)) return undefined
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const all = (rows.filter(r => r && typeof r === 'object') as Record<string, unknown>[])
    .filter(r => str(r, 'sessionId') && r.isArchived !== true)
    .map(r => ({ id: str(r, 'sessionId'), title: str(r, 'title') || str(r, 'name') || 'A chat', name: str(r, 'name'), parent: str(r, 'startedBy'), cwd: str(r, 'cwd').replace(/\\/g, '/'), branch: str(r, 'branch'), running: r.isRunning === true, at: Date.parse(str(r, 'lastActivityAt')) || 0, depth: 1, seen: Date.now() }))
  const ids = new Set(all.map(x => x.id))
  const self = [...new Set(all.filter(x => x.parent && !ids.has(x.parent)).map(x => x.parent))]
  if (self.length !== 1) return []
  const mine: Chat[] = []
  const add = (p: string, depth: number) => {
    if (depth > 4) return
    for (const x of all.filter(y => y.parent === p).sort((a, b) => a.title.localeCompare(b.title))) {
      mine.push({ ...x, depth })
      add(x.id, depth + 1)
    }
  }
  add(self[0], 1)
  return mine
}
let readCrew: (() => Promise<Crew>) | undefined
let after: ((ms: number, fn: () => void) => void) | undefined
let every: ((ms: number, fn: () => void) => { cancel: () => void }) | undefined
let readFile: ((path: string) => Promise<string>) | undefined
let exists: ((path: string) => Promise<boolean>) | undefined
let demo: { cancel: () => void } | undefined

// ─── Vocabulary ─────────────────────────────────────────────────────────────

// One hue per theme colour of its own, so each stays apart in light and dark (no red or amber: those mean
// an error and waiting on you).
const PALETTE = ['#D97757', '#6CB6FF', '#7EE787', '#D2A8FF', '#56D4DD', '#F778BA']
const NAMES: Record<string, string> = { Explore: 'Scout', Plan: 'Architect', 'general-purpose': 'Helper', fork: 'Twin' }
const VERB: Record<string, string> = {
  Read: 'reading',
  Edit: 'editing',
  MultiEdit: 'editing',
  Write: 'writing',
  NotebookEdit: 'editing',
  Grep: 'searching',
  Glob: 'finding',
  Bash: 'running',
  PowerShell: 'running',
  WebFetch: 'fetching',
  WebSearch: 'searching',
  Agent: 'delegating',
  Task: 'delegating',
  TodoWrite: 'planning',
  TaskCreate: 'planning',
  TaskUpdate: 'planning',
  Skill: 'learning',
}
const ICON: Record<string, string> = { Read: '◇', Edit: '✎', MultiEdit: '✎', Write: '✎', Bash: '▸', PowerShell: '▸', Grep: '⌕', Glob: '⌕', WebFetch: '◎', WebSearch: '◎', Agent: '⇢', Task: '⇢', 'mcp__codex-bridge__codex': '◎' }
VERB['mcp__codex-bridge__codex'] = 'asking Codex'
const SPECIAL_LABEL: Record<string, string> = {
  $terminal: 'terminal',
  '@web': 'web',
  '?search': 'search',
  '@browser': 'browser',
  '@computer': 'this PC',
  '@remote': 'remote PC',
  '@docs': 'documents',
  '@claude': 'Claude app',
}
/** Map nodes that are tools rather than files: the stations down the right of the map. */
const isSpecial = (id: string) => id in SPECIAL_LABEL || id.startsWith('@app:')

// ─── Tools beyond the built-in ones: MCP servers, browsers, the computer ───

const KNOWN_APPS: Record<string, string> = {
  blender: 'Blender',
  Roblox_Studio: 'Roblox Studio',
  'DaVinci_Resolve': 'DaVinci Resolve',
  visualize: 'visuals',
  'scheduled-tasks': 'schedules',
  'mcp-registry': 'connectors',
  terminal: 'terminal tabs',
  github: 'GitHub',
  slack: 'Slack',
  linear: 'Linear',
  notion: 'Notion',
  figma: 'Figma',
}
/** A server name as a person would say it: `Roblox_Studio` → "Roblox Studio"; an id-like name → "a connector". */
const appName = (raw: string) => {
  // A plugin's server is named plugin_<plugin>_<server>: the server's own name is the last part.
  const server = raw.replace(/^plugin_[^_]+_/, '')
  return (
  KNOWN_APPS[server] ??
  (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(server)
    ? 'a connector'
    : server
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, ch => ch.toUpperCase())
        .trim())
  )
}
/** `mcp__server__tool` → its server and tool, else undefined. */
const mcpParts = (tool: string) => {
  const m = tool.match(/^mcp__(.+?)__(.+)$/)
  return m ? { server: m[1], name: m[2] } : undefined
}
/**
 * The station a tool works at, when it is not a file: a browser (the app's own
 * pane, Claude in Chrome, Playwright…), this computer or a remote one, the
 * documents tools, the Claude app's own controls, or another MCP server (an app
 * such as Blender). '' for the built-in tools and Codex.
 */
const stationOf = (tool: string): string => {
  if (tool === 'Artifact' || tool === 'ArtifactData' || tool === 'ArtifactComments') return '@docs'
  const mcp = mcpParts(tool)
  if (!mcp || /__codex$/.test(tool)) return ''
  const { server, name } = mcp
  if (server === 'remote-devices') return /browser/i.test(name) ? '@browser' : /computer/i.test(name) ? '@remote' : '@app:remote-devices'
  if (/browser|chrome|playwright|puppeteer/i.test(server)) return '@browser'
  if (/computer-use|^computer$/i.test(server)) return '@computer'
  if (/^ccd_/.test(server)) return '@claude'
  // A docs connector (named by an id) whose tools create and edit documents.
  if (/^[0-9a-f]{8}-/i.test(server) && /^(batch|create|update|read|export|delete|query|guide)$/.test(name)) return '@docs'
  return `@app:${server}`
}
const stationLabel = (id: string) => SPECIAL_LABEL[id] ?? (id.startsWith('@app:') ? appName(id.slice(5)) : '')
const STATION_ICON: Record<string, string> = { '@browser': '◍', '@computer': '▣', '@remote': '▣', '@docs': '▤', '@claude': '⧉' }
/** The pseudo-tool a Claude is "using" while the engine compacts its conversation. */
const COMPACT = '__compact'
/** A doc rather than code: what Claude writes for people to read. */
const DOC_EXT = /\.(md|mdx|markdown|txt|rst|adoc|docx?|odt|rtf|html?)$/i
const CODE_EXT = /\.(m?[jt]sx?|cjs|py|rs|c|h|cc|cpp|hpp|css|scss|vue|svelte)$/i

/** What a Claude's bubble says it is doing, and the bubble's colour. */
const activityOf = (a: Agent): [string, string] => {
  if (a.needs) return ['Needs you', '#E3B341']
  if (a.state !== 'busy')
    return /\b(maybe|could|alternativ|options?|ideas?|what if|perhaps|approach|consider|instead)\b/i.test(a.thoughts[0] ?? '')
      ? ['Brainstorming', '#D2A8FF']
      : ['Thinking', '#E5E7EB']
  const cmd = a.detail
  switch (a.tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return DOC_EXT.test(a.node) ? ['Writing docs', '#E3B341'] : ['Coding', '#7EE787']
    case 'Read':
      return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.node) ? ['Viewing an image', '#79C0FF'] : /\.pdf$/i.test(a.node) ? ['Reading a PDF', '#79C0FF'] : ['Reading', '#79C0FF']
    case 'Grep':
    case 'Glob':
      return ['Searching', '#E3B341']
    case 'Bash':
    case 'PowerShell':
      if (isTestCmd(cmd)) return ['Waiting on tests', '#56D4DD']
      if (isBuildCmd(cmd)) return ['Building', '#FFA657']
      if (/\bgit\s+(commit|push|merge|rebase)\b/i.test(cmd)) return ['Committing', '#F778BA']
      if (/\b(gdb|lldb|debug|RUST_BACKTRACE)\b/i.test(cmd)) return ['Debugging', '#FF7B72']
      return ['Running', '#FFA657']
    case 'WebFetch':
    case 'WebSearch':
      return ['Researching', '#56D4DD']
    case 'Agent':
    case 'Task':
      return ['Delegating', '#D2A8FF']
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return ['Planning', '#D2A8FF']
    case 'Skill':
      return ['Using a skill', '#D2A8FF']
    case COMPACT:
      return ['Compacting memory', '#8B949E']
    default: {
      if (/__codex$/.test(a.tool)) return ['Asking Codex', '#56D4DD']
      const st = stationOf(a.tool)
      if (st === '@browser') return ['Browsing', '#56D4DD']
      if (st === '@computer') return ['Using the PC', '#FFA657']
      if (st === '@remote') return ['Using the remote PC', '#FFA657']
      if (st === '@docs') return ['Writing a document', '#E3B341']
      if (st === '@claude') return ['Using the app', '#8B949E']
      if (st) return [`Using ${stationLabel(st)}`, '#D2A8FF']
      return ['Working', '#E5E7EB']
    }
  }
}

const colorOf = (a: { hue: number }) => PALETTE[a.hue % PALETTE.length]
const verbOf = (a: Agent) =>
  a.state === 'busy' ? (VERB[a.tool] ?? activityOf(a)[0].toLowerCase()) : a.state === 'thinking' ? 'thinking' : a.state === 'done' ? 'done' : 'idle'
const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
/** The last three segments of a path: enough to tell files apart. */
const shortPath = (p: string) => {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/')
}
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const trunc = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
/**
 * Text cut short to fit, done by the pane itself. The desktop draws a `wrap: "truncate"` Text in
 * a row at its full length and the box's edge clips it (no "…"), so before a desktop pane is
 * returned, every such Text is cut to the columns its row leaves it. Widths are in text cells: the
 * pane's columns, less borders, padding and what else stands in the row; a wide glyph counts two,
 * and a little is kept spare because the desktop's font is proportional (some letters are wider).
 */
type FitNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | number | null | undefined | false
const kidsOf = (x: FitNode): FitNode[] => (x && typeof x === 'object' ? ((x.children ?? (x.props?.children as unknown[] | undefined) ?? []) as FitNode[]) : [])
// The element as given when nothing in it changed; else a copy with its children where it keeps
// them. The engine keeps them on the element and refuses a "children" prop (a whole pane drew
// nothing for it once), so they are never moved into props.
const withKids = (x: Exclude<FitNode, string | number | null | undefined | false>, kids: FitNode[]) => {
  const was = kidsOf(x)
  if (kids.length === was.length && kids.every((k, i) => k === was[i])) return x
  if (Array.isArray(x.children)) return { ...x, children: kids }
  if (x.props && Array.isArray(x.props.children)) return { ...x, props: { ...x.props, children: kids } }
  return { ...x, children: kids }
}
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
const glyphW = (ch: string) => (WIDE.test(ch) ? 2 : 1)
const textW = (t: string) => {
  let n = 0
  for (const ch of t) n += glyphW(ch)
  return n
}
/** A string cut to `w` cells, ending in "…" when cut. */
const cutTo = (t: string, w: number) => {
  if (textW(t) <= w) return t
  if (w <= 1) return w === 1 ? '…' : ''
  let out = ''
  let n = 0
  for (const ch of t) {
    const g = glyphW(ch)
    if (n + g > w - 1) break
    out += ch
    n += g
  }
  return `${out.trimEnd()}…`
}
/** Words laid over rows of `w` cells, at most `max` rows, the last cut with "…" when there is more. */
const wrapRows = (t: string, w: number, max: number): string[] => {
  const rows: string[] = []
  let row = ''
  for (let word of oneLine(t).split(' ').filter(Boolean)) {
    if (row && textW(`${row} ${word}`) <= w) {
      row = `${row} ${word}`
      continue
    }
    if (row) rows.push(row)
    // A word wider than a row is broken across rows.
    while (textW(word) > w) {
      let head = ''
      for (const ch of word) {
        if (textW(head + ch) > w) break
        head += ch
      }
      rows.push(head)
      word = word.slice(head.length)
    }
    row = word
  }
  if (row) rows.push(row)
  return rows.length > max ? [...rows.slice(0, max - 1), cutTo(rows.slice(max - 1).join(' '), w)] : rows
}
/** The most desks shown at once this session: the desks keep that much room, so the cards below never jump. */
let deskMax = 0
/** Since when fewer desks than that have been shown (0: not fewer). */
let deskLowSince = 0
/** The model each Claude runs on, by agent, as its model steps say. */
const agentModel = new Map<string, string>()
/** When each Claude's current model step began, by agent: how long it has been thinking (kept here, not written). */
const stepStart = new Map<string, number>()
/** How long the desk area keeps room for desks that have gone, before it gives it back. */
const DESK_ROOM_MS = 60_000

// ─── Light and dark ─────────────────────────────────────────────────────────
// The pane is drawn with dark-tuned colours, then painted for the theme in one pass at the end:
//  - auto (the default): each colour of a Text or a border becomes the engine's theme colour of the
//    same meaning or hue ('claude', 'warning', 'autoAccept'…), which Claude Code itself tunes for a
//    light or a dark theme; a colour with no such key is moved to a middle shade that reads on both.
//  - light / dark: chosen in the toolbar when auto guesses wrong; light swaps every colour for its
//    light-theme twin, dark draws as tuned.
type ThemeMode = 'auto' | 'light' | 'dark'
const THEMES: ThemeMode[] = ['auto', 'light', 'dark']
const THEME_LABEL: Record<ThemeMode, string> = { auto: '◐ auto', light: '☀ light', dark: '☾ dark' }
const hex6 = (h: string) => {
  const x = h.replace('#', '').toUpperCase()
  return x.length === 3 ? `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}` : `#${x.slice(0, 6)}`
}
/** A theme colour of the same meaning, for a Text's or a border's colour (auto). */
const THEME_KEY: Record<string, string> = {
  '#E6EDF3': 'text', '#E5E7EB': 'text', '#FFFFFF': 'text', '#E6E0D4': 'text', '#E6FFF6': 'text', '#BFF3E2': 'text',
  '#8B949E': 'inactive', '#9CA3AF': 'inactive', '#6B7280': 'inactive', '#B8C1CC': 'inactive',
  '#30363D': 'subtle', '#4B5563': 'subtle', '#161B22': 'subtle',
  '#D97757': 'claude',
  '#6CB6FF': 'suggestion', '#79C0FF': 'suggestion',
  '#7EE787': 'success', '#3FB950': 'success', '#2EA043': 'success',
  '#D2A8FF': 'autoAccept',
  '#56D4DD': 'planMode', '#10A37F': 'planMode',
  '#F778BA': 'bashBorder',
  '#E3B341': 'warning', '#E3B95C': 'warning', '#F0BC55': 'warning', '#F0D58C': 'warning', '#E0AF68': 'warning',
  '#F85149': 'error', '#FF7B72': 'error',
}
/** Each dark-tuned colour's twin on a light background. */
const LIGHT_OF: Record<string, string> = {
  '#E6EDF3': '#1F2328', '#E5E7EB': '#1F2328', '#FFFFFF': '#1F2328', '#E6E0D4': '#2D2A24', '#E6FFF6': '#0B3D2E', '#BFF3E2': '#0B5A43',
  '#8B949E': '#59636E', '#9CA3AF': '#59636E', '#B8C1CC': '#4B535C', '#6B7280': '#6E7781',
  '#30363D': '#D0D7DE', '#4B5563': '#AFB8C1', '#161B22': '#F6F8FA', '#0D1117': '#FFFFFF', '#07080B': '#FFFFFF',
  '#D97757': '#BC5A34', '#6CB6FF': '#0969DA', '#79C0FF': '#0969DA', '#7EE787': '#1A7F37', '#3FB950': '#1A7F37', '#2EA043': '#1A7F37',
  '#D2A8FF': '#8250DF', '#56D4DD': '#0A7B83', '#10A37F': '#0B7A5F', '#F778BA': '#BF3989',
  '#E3B341': '#9A6700', '#E3B95C': '#9A6700', '#F0BC55': '#9A6700', '#F0D58C': '#7D5A00', '#E0AF68': '#9A6700',
  '#F85149': '#CF222E', '#FF7B72': '#CF222E', '#FFA657': '#BC4C00',
}
const rgbOf = (h: string) => { const x = hex6(h); return [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16) / 255) as [number, number, number] }
const hexOf = (c: number[]) => `#${c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const lum = (c: number[]) => { const [r, g, b] = c.map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const toHsl = ([r, g, b]: number[]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
const fromHsl = ([h, s, l]: number[]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}
/** The shade of a colour whose light-relative luminance falls in [lo, hi], its hue kept. */
const shadeTo = (h: string, lo: number, hi: number) => {
  const [hu, s, l0] = toHsl(rgbOf(h))
  const at = (l: number) => lum(fromHsl([hu, s, l]))
  if (at(l0) >= lo && at(l0) <= hi) return hex6(h)
  let a = 0, b = 1
  const want = at(l0) > hi ? hi : lo
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (at(m) < want) a = m; else b = m }
  return hexOf(fromHsl([hu, s, (a + b) / 2]))
}
/** A colour's twin on a light background: dark grounds turn light, bright marks turn deep. */
const lightOf = (h: string) => {
  const k = hex6(h)
  if (LIGHT_OF[k]) return LIGHT_OF[k]
  const c = rgbOf(k), L = lum(c), [hu, s] = toHsl(c)
  if (L < 0.03) return hexOf(fromHsl([hu, s * 0.5, 0.97]))
  if (L < 0.08) return hexOf(fromHsl([hu, s * 0.6, 0.9]))
  return shadeTo(k, 0.05, 0.16)
}
/** For a Text or a border in auto: the theme's colour of that meaning, else a shade that reads on both. */
const autoOf = (h: string) => {
  const k = hex6(h)
  if (THEME_KEY[k]) return THEME_KEY[k]
  const c = rgbOf(k), [, s] = toHsl(c), L = lum(c)
  if (s < 0.15) return L > 0.5 ? 'text' : L > 0.12 ? 'inactive' : 'subtle'
  return shadeTo(k, 0.15, 0.3)
}
/** The pane painted for the theme: Text and border colours. */
const paintPane = <T,>(tree: T, mode: ThemeMode): T => (mode === 'dark' ? tree : (paintNode(tree as unknown as FitNode, mode) as unknown as T))
const paintNode = (x: FitNode, mode: ThemeMode): FitNode => {
  if (!x || typeof x !== 'object') return x
  const p = x.props ?? {}
  let np: Record<string, unknown> = p
  for (const k of ['color', 'borderColor', 'backgroundColor']) {
    const v = p[k]
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v)) continue
    const to = mode === 'auto' ? autoOf(v) : lightOf(v)
    if (to === v) continue
    if (np === p) np = { ...p }
    np[k] = to
  }
  const y = np === p ? x : { ...x, props: np }
  return withKids(y, kidsOf(y).map(k => paintNode(k, mode)))
}

/** A text in two lines of `w` characters, broken between words; the second line cut short if need be. */
const twoLines = (s: string, w: number): [string, string] => {
  if (s.length <= w) return [s, '']
  let at = s.lastIndexOf(' ', w)
  if (at < w * 0.5) at = w
  return [s.slice(0, at).trimEnd(), trunc(s.slice(at).trimStart(), w)]
}
/** How long a helper's window stays (marked done) after it finishes, so windows do not blink in and out. */
const WINDOW_LINGER_MS = 20_000
/** Lines the log keeps to scroll back through. */
const LOG_KEEP = 120
/** How many lines a press of ▲ or ▼ moves the log. */
const LOG_STEP = 3
/**
 * A turn the app started by itself, not a prompt: a background task or monitor
 * reporting in, a CI event, a slash command's output. Returns a short line for
 * the log, or '' for a real prompt.
 */
const SYSTEM_TAG = /^\s*<(task-notification|agent-message|system-reminder|ci-monitor-event|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-notification|bash-input|bash-stdout|user-memory-input|[a-z][\w-]*-(?:notification|event|reminder))[\s>]/i
const systemNote = (full: string) => {
  if (full.startsWith(OPEN_ASK)) return 'opening Claude Crew'
  const text = full.length > 8000 ? full.slice(0, 8000) : full
  const tag = text.match(SYSTEM_TAG)?.[1]?.toLowerCase()
  if (!tag) return ''
  const inner = (name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1]?.replace(/<[^>]*>/g, ' ') ?? ''
  const said = tag === 'agent-message' ? '' : oneLine(inner('summary') || inner('command-name') || inner('status') || '')
  const kind = tag === 'task-notification' ? 'background task' : tag === 'agent-message' ? 'a helper reported back' : tag.startsWith('ci-') ? 'CI' : tag.includes('command') ? 'command' : 'update'
  return trunc(said ? `${kind}: ${said}` : kind, 120)
}
/**
 * A message that reached Claude from someone other than you, in a wrapper of the app's: another Claude
 * session (`<cross-session-message from-name="…">`), or a channel. Who sent it, and its words.
 */
const relayedOf = (full: string): { from: string; body: string } | undefined => {
  const m = full.slice(0, 8000).match(/^\s*<(cross-session-message|channel|[a-z]+-message)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/i)
  if (!m) return undefined
  const attr = (k: string) => m[2].match(new RegExp(`\\b${k}="([^"]*)"`, 'i'))?.[1]?.trim() ?? ''
  const from = attr('from-name') || attr('sender') || attr('user') || attr('name') || (m[1].toLowerCase() === 'cross-session-message' ? 'another session' : m[1].replace(/-/g, ' '))
  return { from: trunc(oneLine(from), 40), body: oneLine(m[3].replace(/<[^>]*>/g, ' ')) }
}
/** What a prompt asks, without the app's wrapper round it. */
const promptOf = (t: string) => relayedOf(t)?.body || t
/** A message in the log: yours, or another session's (also one logged as yours before this was told apart). */
const messageOf = (l: LogLine): { from: string; body: string } | undefined =>
  l.kind === 'msg' ? { from: l.who, body: l.text } : l.kind === 'you' ? (relayedOf(l.text) ?? { from: '', body: l.text }) : undefined
/** A log line as it reads closed, and opened whole: a thought's every word, an action and what came of it. */
const shortOf = (l: LogLine) => {
  const m = messageOf(l)
  return m ? (m.from ? `${m.from}: ${m.body}` : m.body) : l.kind === 'think' ? l.text : l.text.replace(/^$ /, SHELL_MARK)
}
const fullOf = (l: LogLine) => (l.kind === 'think' && l.full ? l.full : l.more ? `${shortOf(l)}\n${l.more}` : shortOf(l))
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
/** A log line's address, for opening it: its time and what it says. */
const logKey = (l: LogLine) => `${l.at}:${(hash(`${l.chat ? `${l.chat}|` : ''}${l.who}|${l.kind}|${l.text}`) >>> 0).toString(36)}`
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const norm = (p: string) => {
  const raw = p.replace(/\\/g, '/')
  const parts: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  const joined = (raw.startsWith('//') ? '//' : raw.startsWith('/') ? '/' : '') + parts.join('/')
  return /^[a-z]:/.test(joined) ? joined[0].toUpperCase() + joined.slice(1) : joined
}

const nodeOf = (tool: string, a: Record<string, unknown>): string => {
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  const file = str('file_path') || str('notebook_path')
  if (file) return norm(file.slice(0, 2048))
  if (tool === 'Grep' || tool === 'Glob') {
    const p = str('path')
    return p && /\.[A-Za-z0-9]+$/.test(p) ? norm(p) : '?search'
  }
  if (tool === 'Bash' || tool === 'PowerShell') return '$terminal'
  if (tool === 'WebFetch' || tool === 'WebSearch') return '@web'
  return stationOf(tool)
}

const detailOf = (tool: string, a: Record<string, unknown>): string => {
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  // The command (tidied) is kept for telling tests and builds apart; what is shown of it is its gist.
  if (tool === 'Bash' || tool === 'PowerShell') return cmdHead(str('command')).slice(0, 400)
  if (tool === 'Grep' || tool === 'Glob') return str('pattern')
  if (tool === 'WebFetch') return str('url').replace(/^https?:\/\//, '').split('/')[0]
  if (tool === 'WebSearch') return str('query')
  if (tool === 'Agent' || tool === 'Task') return str('description')
  if (/__codex$/.test(tool)) return `${str('thread') ? `[${str('thread')}] ` : ''}${oneLine(str('task')).slice(0, 70)}`
  if (tool === 'Skill') return str('skill')
  const st = stationOf(tool)
  if (st) {
    // What it is doing there, never what it types: a page, an app, an action.
    const url = str('url').replace(/^https?:\/\//, '').replace(/\/$/, '')
    const apps = Array.isArray(a.apps) ? (a.apps as unknown[]).filter((x): x is string => typeof x === 'string').join(', ') : ''
    const verb = (mcpParts(tool)?.name ?? tool).split('__').pop()!.replace(/^(browser|computer)_/, '').replace(/_/g, ' ')
    const what = url || str('app') || apps || str('title') || (st === '@computer' || st === '@remote' || st === '@browser' ? str('action').replace(/_/g, ' ') : '')
    return trunc(`${verb}${what && what !== verb ? ` ${what}` : ''}`, 80)
  }
  return ''
}

/** What marks a command in the action lines: Claude's words for it follow. */
const SHELL_MARK = '▸ '

const actionLine = (tool: string, node: string, detail: string, said = '') => {
  // A command by what Claude said it does, else what it runs in a few words: never the raw command.
  if (tool === 'Bash' || tool === 'PowerShell') return `${SHELL_MARK}${trunc(oneLine(said), 120) || cmdGist(detail)}`
  if (tool === COMPACT) return '🗜 compacting the conversation'
  const st = stationOf(tool)
  // An MCP tool (a connector or app): ⧉, its own icon in the log.
  if (st) return `${STATION_ICON[st] ?? '⧉'} ${stationLabel(st)}: ${detail}`.trim()
  const icon = ICON[tool] ?? '•'
  const what = node && !isSpecial(node) ? baseName(node) : detail
  return `${icon} ${VERB[tool] ?? tool.split('__').pop()} ${what}`.trim()
}

/** The first meaningful sentence or two of a block of model text. */
/** What a Claude said, on one line: code blocks and Markdown marks out (underscores stay, as in read_chunk). */
const cleanSaid = (text: string) => oneLine(text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>]/g, ''))
const summarise = (text: string): string => {
  const clean = cleanSaid(text)
  if (!clean) return ''
  // A sentence ends at . ! or ? before a space or the end, so chunk.rs stays whole.
  const sentences = clean.split(/(?<=[.!?])\s+/)
  let out = ''
  for (const s of sentences) {
    if (out.length > 40) break
    out += (out ? ' ' : '') + s
  }
  return trunc(oneLine(out), 160)
}

// ─── Crew bookkeeping ───────────────────────────────────────────────────────

const blank = (id: string, name: string, kind: string, hue: number): Agent => ({
  id,
  name,
  kind,
  hue,
  node: '',
  visited: [],
  tool: '',
  detail: '',
  pending: [],
  state: 'idle',
  doneAt: 0,
  calls: 0,
  goal: '',
  thoughts: [],
  actions: [],
  progress: -1,
  progressSrc: 'est',
  todosDone: 0,
  todosTotal: 0,
  doing: '',
  since: 0,
  from: '',
  movedAt: 0,
  tokens: 0,
  cost: 0,
  stuck: '',
  recent: [],
})

/** Files with an app of their own (pictures, sound, video, documents, archives, fonts, 3D): the system's app for the type opens them. */
const OWN_APP =
  /\.(png|jpe?g|jfif|gif|bmp|webp|tiff?|ico|heic|heif|avif|psd|cr2|nef|arw|dng|exr|hdr|dds|tga|xcf|kra|aseprite|mp3|wav|flac|ogg|oga|m4a|aac|wma|opus|aiff?|midi?|mp4|m4v|mov|mkv|avi|wmv|webm|flv|mpe?g|3gp|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub|xps|zip|7z|rar|tar|gz|tgz|bz2|xz|iso|dmg|ttf|otf|woff2?|blend|fbx|glb|stl|3mf|rbxl|rbxm|unitypackage)$/i
/** Programs, which the system would run rather than open: shown in their folder instead. */
const PROGRAM = /\.(exe|com|msi|msp|msix|appx|scr|pif|lnk|url|cpl|hta|jar|app|appimage|run|dll|sys|appref-ms)$/i
/** Scripts the system would run if handed one: opened in an editor, else shown in their folder. */
const SCRIPT = /\.(bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|reg|sh|command|desktop)$/i
/**
 * Where a click on a file sends it: the system's app for its type, the editor chosen in the pane (code and
 * text), or its folder with it picked out (a program, or a script with no editor to open it in).
 */
const routeOf = (path: string, os: string, choice = editor): 'app' | 'editor' | 'reveal' => {
  if (PROGRAM.test(path)) return 'reveal'
  if (OWN_APP.test(path)) return 'app'
  // cmd would act on these characters in a path, so such a file goes to the system, not the editor's launcher.
  if (choice === 'system' || (os === 'win' && /[&|<>^%!"]/.test(path))) return SCRIPT.test(path) ? 'reveal' : 'app'
  return 'editor'
}
/** How the system opens a path with its default app, and how it shows a file picked out in its folder. */
const defaultApp = (os: string, path: string) => (os === 'win' ? ['explorer', path.replace(/\//g, '\\')] : os === 'mac' ? ['open', path] : ['xdg-open', path])
// Explorer's /select wants the path in quotes of its own, which an argument list cannot pass when the path
// has a space; PowerShell passes it as written (the path in a literal string, its quotes doubled).
const revealIn = (os: string, path: string) =>
  os === 'win'
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Start-Process explorer.exe -ArgumentList ('/select,"' + '${path.replace(/\//g, '\\').replace(/'/g, "''")}' + '"')`]
    : os === 'mac'
      ? ['open', '-R', path]
      : ['xdg-open', dirOf(path) || '/']

/**
 * Opens a file: pictures, media and documents in the system's app for their type; code and text in the
 * person's editor, where a file this session edited, inside a git repository, opens as a diff against
 * HEAD in VS Code or Cursor; programs (and scripts with nowhere else to go) picked out in their folder,
 * never run.
 */
const openInEditor = async ($: EngineInterface, path: string, hasEdits: boolean, line = 0): Promise<Opened> => {
  const os = await platformOf($)
  const isWin = os === 'win'
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 20_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
  // Explorer and `open` hand the file on and may exit non-zero; an editor's launcher fails with a message.
  const handedOn = (r: { exitCode: number; stderr: string }) => (r.exitCode === -1 ? { ok: false, why: r.stderr } : { ok: true, why: '' })
  const launched = (r: { exitCode: number; stderr: string }) =>
    r.exitCode === 0 ? { ok: true, why: '' } : { ok: false, why: oneLine(r.stderr).slice(0, 160) || `${editor} exited with code ${r.exitCode}` }
  // Editors' command-line launchers are .cmd scripts on Windows, which only cmd runs; cmd would act on
  // `&`, `|` or `%` in a path, so such a path opens through Explorer instead (the default app, no diff).
  const shell = (argv: string[]) => (isWin ? ['cmd', '/d', '/c', ...argv] : argv)
  const route = routeOf(path, os)
  if (route === 'reveal') return handedOn(await run(revealIn(os, path)))
  if (route === 'app') return handedOn(await run(defaultApp(os, path)))
  const canDiff = /^(code|cursor|codium|windsurf)$/.test(editor)
  if (line > 0 && canDiff) {
    return launched(await run(shell([editor, '-g', `${path}:${line}`])))
  }
  if (hasEdits && canDiff) {
    const top = await run(['git', '-C', dirOf(path), 'rev-parse', '--show-toplevel'])
    const root = top?.exitCode === 0 ? norm(top.stdout.trim()) : ''
    if (root && path.startsWith(`${root}/`)) {
      const head = await run(['git', '-C', root, 'show', `HEAD:${path.slice(root.length + 1)}`])
      if (head?.exitCode === 0) {
        if (!tempDir) tempDir = norm((await $.env.get('TEMP')) || (await $.env.get('TMPDIR')) || (isWin ? 'C:/Windows/Temp' : '/tmp'))
        const name = baseName(path)
        const dot = name.lastIndexOf('.')
        const before = `${tempDir}/crew-map-HEAD/${hash(path).toString(36)}/${dot > 0 ? `${name.slice(0, dot)} (HEAD)${name.slice(dot)}` : `${name} (HEAD)`}`
        await $.fs.write(before, head.stdout).catch(() => undefined)
        return launched(await run(shell([editor, '--diff', before, path])))
      }
    }
  }
  return launched(await run(shell(canDiff ? [editor, '-g', path] : [editor, path])))
}

/** How an open went: whether the program started, and if not, why. */
type Opened = { ok: boolean; why: string }

/** A shell command as a person would read it: leading variable assignments and `cd … &&` dropped. */
const tidyCmd = (cmd: string) => {
  let s = oneLine(cmd.replace(/\\\r?\n/g, ' '))
  for (;;) {
    const next = s
      // A value may be `$(…)` with spaces inside (one level of nesting), as in `start=$(grep -c x f)`.
      .replace(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\$\((?:[^()]|\([^()]*\))*\)|\S+)\s*;?\s*/, '')
      .replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '')
    if (next === s) break
    s = next
  }
  return s || oneLine(cmd)
}

/** Lines added and removed between two texts, as multisets of lines. */
const lineDiff = (before: string, after: string) => {
  const left = new Map<string, number>()
  for (const l of before ? before.split('\n') : []) left.set(l, (left.get(l) ?? 0) + 1)
  let added = 0
  for (const l of after ? after.split('\n') : []) {
    const n = left.get(l) ?? 0
    if (n > 0) left.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of left.values()) removed += n
  return { added, removed }
}

/** What an action came to, kept on its log line for when it is opened: capped, so the log and the journal stay small. */
const MORE_MAX = 1400
const clipLines = (lines: string[]) => lines.map(l => trunc(l.replace(/\s+$/, ''), 200))
/** The last lines of an output (at most n, and about 900 characters), saying how many came before. */
const tailOf = (s: string, n = 15) => {
  const all = s.replace(/\s+$/, '').split('\n')
  let k = Math.max(0, all.length - n)
  while (k < all.length - 1 && all.slice(k).join('\n').length > 900) k++
  return [...(k ? [`… ${k} earlier lines`] : []), ...clipLines(all.slice(k))].join('\n')
}
/** A small diff of one edit: the lines it changes (what both sides share at the ends is left out). */
const editDiff = (before: string, after: string, max = 16) => {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  const lines = clipLines([...a.slice(i, a.length - j).map(l => `- ${l}`), ...b.slice(i, b.length - j).map(l => `+ ${l}`)])
  return (lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more changed lines`] : lines).join('\n')
}

const record = (c: Crew, path: string, id: string, delta: { added: number; removed: number } | 'read'): Crew => {
  const a = c.agents.find(x => x.id === id)
  const cur: Change = c.changes[path] ?? { added: 0, removed: 0, edits: 0, reads: 0, by: '', hue: 0, at: 0 }
  const next1: Change =
    delta === 'read'
      ? { ...cur, reads: cur.reads + 1, at: Date.now(), by: cur.by || (a?.name ?? ''), hue: cur.by ? cur.hue : (a?.hue ?? 0) }
      : { ...cur, added: cur.added + delta.added, removed: cur.removed + delta.removed, edits: cur.edits + 1, at: Date.now(), by: a?.name ?? cur.by, hue: a?.hue ?? cur.hue }
  const changes = { ...c.changes, [path]: next1 }
  const keys = Object.keys(changes)
  if (keys.length > MAX_CHANGES)
    for (const [p] of Object.entries(changes)
      .filter(([p, ch]) => !ch.edits && p !== path)
      .sort((x, y) => x[1].at - y[1].at)
      .slice(0, keys.length - MAX_CHANGES))
      delete changes[p]
  // Edited files too past twice that, oldest first, but never this task's own.
  const left = Object.keys(changes).length
  if (left > MAX_CHANGES * 2)
    for (const [p] of Object.entries(changes)
      .filter(([p, ch]) => p !== path && ch.at < (c.turnBase?.at ?? 0))
      .sort((x, y) => x[1].at - y[1].at)
      .slice(0, left - MAX_CHANGES * 2))
      delete changes[p]
  // And a hard cap whatever they are: the oldest go.
  const still = Object.keys(changes).length
  if (still > MAX_CHANGES * 2)
    for (const [p] of Object.entries(changes)
      .filter(([p]) => p !== path)
      .sort((x, y) => x[1].at - y[1].at)
      .slice(0, still - MAX_CHANGES * 2))
      delete changes[p]
  return { ...c, changes }
}
const MAX_CHANGES = 300
/**
 * A Claude still "thinking" a while after its last call has gone quiet: idle (main) or done (helper).
 * Top-level, so the timer keeps only the id and the stamp (not the call and its result), and it
 * writes only if the Claude is still as it was left.
 */
const settleLater = (id: string, stamp: number) =>
  after?.(LINGER_MS, () => {
    void (async () => {
      const c = await readCrew?.()
      if (!c?.agents.some(x => x.id === id && x.state === 'thinking' && x.doneAt === stamp)) return
      await write?.(d => ({ ...d, agents: d.agents.map(x => (x.id === id && x.state === 'thinking' && x.doneAt === stamp ? { ...x, state: x.id === 'main' ? 'idle' : 'done' } : x)) }))
    })()
  })
const MAIN = () => blank('main', 'Claude', 'main', 0)

const freshName = (list: Agent[], kind: string) => {
  const base = NAMES[kind] ?? (kind === 'agent' ? 'Helper' : (kind.split(':').pop() ?? kind))
  const n = list.filter(w => w.name === base || w.name.startsWith(`${base} `)).length
  return n ? `${base} ${n + 1}` : base
}
const newSub = (list: Agent[], id: string, kind: string) =>
  blank(id, freshName(list, kind), kind, list.reduce((m, w) => Math.max(m, w.hue), 0) + 1)

const upsert = (c: Crew, id: string, fn: (a: Agent) => Agent): Crew => {
  const found = c.agents.find(a => a.id === id)
  const made = fn(found ?? (id === 'main' ? MAIN() : newSub(c.agents, id, 'agent')))
  const agents = found ? c.agents.map(a => (a.id === id ? made : a)) : [...c.agents, made]
  while (agents.length > MAX_AGENTS) {
    const i = agents.findIndex(a => a.id !== 'main' && (a.state === 'done' || a.state === 'idle'))
    agents.splice(i >= 0 ? i : 1, 1)
  }
  return { ...c, agents }
}

const log = (c: Crew, id: string, kind: LogLine['kind'], text: string, full?: string): Crew => {
  const a = c.agents.find(x => x.id === id)
  if (!a || !text) return c
  const line: LogLine = { at: Date.now(), who: a.name, hue: a.hue, kind, text: trunc(text, 300), ...(full && full !== text ? { full: trunc(full, 2000) } : {}) }
  return { ...c, log: [...c.log, line].slice(-LOG_KEEP) }
}

const think = (c: Crew, id: string, line: string, full?: string): Crew => {
  if (!line || c.agents.find(a => a.id === id)?.thoughts[0] === line) return c
  return log(upsert(c, id, a => ({ ...a, thoughts: [line, ...a.thoughts].slice(0, 6) })), id, 'think', line, full)
}

// ─── The map's graph ────────────────────────────────────────────────────────

/** Spring layout in a unit square, wider than tall like the cells it lands on. */
const relayout = (nodes: Record<string, MapNode>, trails: Crew['trails']): Record<string, MapNode> => {
  const list = Object.values(nodes).map(n => ({ ...n }))
  const at = new Map(list.map((n, i) => [n.id, i]))
  const springs: [number, number, number, number][] = []
  for (const n of list)
    for (const t of n.imports) {
      const j = at.get(t)
      if (j !== undefined) springs.push([at.get(n.id)!, j, 0.2, 0.09])
    }
  for (const t of trails) {
    const i = at.get(t.a)
    const j = at.get(t.b)
    if (i !== undefined && j !== undefined) springs.push([i, j, 0.28, 0.035])
  }
  const AX = 2.4
  for (let iter = 0; iter < 140; iter++) {
    const fx = new Array(list.length).fill(0)
    const fy = new Array(list.length).fill(0)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const dx = (list[i].x - list[j].x) * AX
        const dy = list[i].y - list[j].y
        const d2 = dx * dx + dy * dy + 1e-4
        const k = 0.0035 / d2
        fx[i] += dx * k
        fy[i] += dy * k
        fx[j] -= dx * k
        fy[j] -= dy * k
      }
    for (const [i, j, len, str] of springs) {
      const dx = (list[j].x - list[i].x) * AX
      const dy = list[j].y - list[i].y
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-6
      const f = (d - len) * str
      fx[i] += (dx / d) * f
      fy[i] += (dy / d) * f
      fx[j] -= (dx / d) * f
      fy[j] -= (dy / d) * f
    }
    const dirs = new Map<string, { x: number; y: number; n: number }>()
    for (const n of list) {
      const d = dirs.get(n.dir) ?? { x: 0, y: 0, n: 0 }
      dirs.set(n.dir, { x: d.x + n.x, y: d.y + n.y, n: d.n + 1 })
    }
    list.forEach((n, i) => {
      const d = dirs.get(n.dir)!
      if (d.n > 1) {
        fx[i] += (d.x / d.n - n.x) * AX * 0.02
        fy[i] += (d.y / d.n - n.y) * 0.02
      }
      fx[i] += (0.5 - n.x) * AX * 0.012
      fy[i] += (0.5 - n.y) * 0.012
      const step = 0.6 * (1 - iter / 160)
      n.x = Math.min(0.97, Math.max(0.03, n.x + Math.max(-0.04, Math.min(0.04, (fx[i] / AX) * step))))
      n.y = Math.min(0.95, Math.max(0.05, n.y + Math.max(-0.05, Math.min(0.05, fy[i] * step))))
    })
  }
  return Object.fromEntries(list.map(n => [n.id, n]))
}

const placeNear = (c: Crew, id: string, near?: string): { x: number; y: number } => {
  const r = hash(id)
  const jx = ((r % 1000) / 1000 - 0.5) * 0.16
  const jy = (((r >> 10) % 1000) / 1000 - 0.5) * 0.2
  const anchor =
    (near && c.nodes[near]) || Object.values(c.nodes).find(n => n.dir === dirOf(id)) || undefined
  if (anchor) return { x: Math.min(0.95, Math.max(0.05, anchor.x + jx)), y: Math.min(0.92, Math.max(0.08, anchor.y + jy)) }
  return { x: 0.2 + ((r % 997) / 997) * 0.6, y: 0.2 + (((r >> 8) % 991) / 991) * 0.6 }
}

const prune = (nodes: Record<string, MapNode>, agents: Agent[], keep = '', changes: Record<string, Change> = {}): Record<string, MapNode> => {
  const list = Object.values(nodes)
  const busy = new Set([...agents.map(a => a.node), keep])
  const ghosts = list.filter(n => n.kind === 'ghost').sort((a, b) => a.touchedAt - b.touchedAt)
  const drop = new Set(ghosts.slice(0, Math.max(0, ghosts.length - MAX_GHOSTS)).map(n => n.id))
  const rest = list.filter(n => !drop.has(n.id))
  if (rest.length > MAX_NODES) {
    const victims = rest
      .filter(n => !busy.has(n.id))
      // Unopened files first, edited files last (the cards keep every file either way).
      .sort((a, b) => (a.kind === 'ghost' ? -1 : 0) - (b.kind === 'ghost' ? -1 : 0) || Number(!!changes[a.id]?.edits) - Number(!!changes[b.id]?.edits) || a.touchedAt - b.touchedAt)
    for (const v of victims.slice(0, rest.length - MAX_NODES)) drop.add(v.id)
  }
  return drop.size ? Object.fromEntries(list.filter(n => !drop.has(n.id)).map(n => [n.id, n])) : nodes
}

/** Puts the node on the map (or warms it up) and records the hop from `from`. */
const touch = (c: Crew, id: string, from: string): Crew => {
  if (!id) return c
  const now = Date.now()
  const had = c.nodes[id]
  let nodes = { ...c.nodes }
  let reflow = false
  if (!had) {
    nodes[id] = {
      id,
      label: stationLabel(id) || baseName(id),
      dir: isSpecial(id) ? '' : dirOf(id),
      kind: isSpecial(id) ? 'special' : 'file',
      ...placeNear(c, id, from),
      heat: 1,
      imports: [],
      scanned: false,
      touchedAt: now,
    }
    reflow = true
  } else {
    nodes[id] = { ...had, kind: had.kind === 'ghost' ? 'file' : had.kind, heat: had.heat + 1, touchedAt: now }
  }
  let trails = c.trails
  if (from && from !== id) {
    const [a, b] = [from, id].sort()
    const t = trails.find(x => x.a === a && x.b === b)
    trails = t ? trails.map(x => (x === t ? { ...x, w: x.w + 1 } : x)) : [...trails, { a, b, w: 1 }].slice(-40)
    if (!t) reflow = true
  }
  nodes = prune(nodes, c.agents, id, c.changes)
  return { ...c, nodes: reflow ? relayout(nodes, trails) : nodes, trails }
}

/** Reads a code file's imports, resolved to paths that exist. */
const importsOf = async (path: string): Promise<string[]> => {
  if (!readFile || !exists || !CODE_EXT.test(path)) return []
  let text: string
  try {
    // Imports sit at the top of a file: the first 256 KB is plenty, and a huge file costs nothing more.
    text = (await readFile(path)).slice(0, 256_000)
  } catch {
    return []
  }
  const dir = dirOf(path)
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  const candidates: string[][] = []
  const add = (...c: string[]) => candidates.push(c.map(norm))
  if (/^(m?[jt]sx?|cjs|vue|svelte)$/.test(ext)) {
    const re = /(?:from\s*|import\s*\(?\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
    for (const m of text.matchAll(re)) {
      const base = `${dir}/${m[1]}`
      const stem = base.replace(/\.(m?js|jsx)$/, '')
      // `../types` names a folder (its index file), so the bare path only counts when it has an extension.
      add(
        ...(/\.[A-Za-z]\w*$/.test(baseName(base)) ? [base] : []),
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.d.ts`,
        `${stem}.js`,
        `${stem}.jsx`,
        `${stem}.mjs`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
        `${base}/index.d.ts`,
        `${base}/index.js`,
      )
    }
  } else if (ext === 'py') {
    for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.+)([\w.]*)[ \t]+import[ \t]+([\w, ]+)/gm)) {
      let base = dir
      for (let i = 1; i < m[1].length; i++) base = dirOf(base)
      const mod = m[2].replace(/\./g, '/')
      if (mod) add(`${base}/${mod}.py`, `${base}/${mod}/__init__.py`)
      else for (const name of m[3].split(',')) add(`${base}/${name.trim()}.py`)
    }
    for (const m of text.matchAll(/^[ \t]*(?:from|import)[ \t]+([\w.]+)/gm)) {
      const mod = m[1].replace(/\./g, '/')
      add(`${dir}/${mod}.py`, `${dirOf(dir)}/${mod}.py`, `${dir}/${mod}/__init__.py`)
    }
  } else if (ext === 'rs') {
    // A file's own module folder: `src/world.rs` keeps its children in `src/world/`.
    const file = baseName(path)
    const isRootish = /^(mod|lib|main)\.rs$/.test(file)
    const selfDir = isRootish ? dir : `${dir}/${file.replace(/\.rs$/, '')}`
    const superDir = isRootish ? dirOf(dir) : dir
    let crateSrc = dir
    while (crateSrc && baseName(crateSrc) !== 'src') crateSrc = dirOf(crateSrc)
    if (!crateSrc) crateSrc = dir
    for (const m of text.matchAll(/^[ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm)) add(`${selfDir}/${m[1]}.rs`, `${selfDir}/${m[1]}/mod.rs`)
    // `use crate::a::b::Item`, `use super::x`, `use self::y`, groups included.
    const paths: string[] = []
    for (const m of text.matchAll(/^[ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?use[ \t]+(crate|super|self)::([^;]{1,2000});/gm)) {
      const head = m[1]
      const body = m[2].replace(/\s+/g, '')
      const brace = body.indexOf('{')
      if (brace < 0) paths.push(`${head}::${body}`)
      else {
        const prefix = body.slice(0, brace)
        let depth = 0
        let cur = ''
        for (const ch of body.slice(brace + 1, body.lastIndexOf('}'))) {
          if (ch === '{') depth++
          if (ch === '}') depth--
          if (ch === ',' && depth === 0) {
            paths.push(`${head}::${prefix}${cur.split('{')[0]}`)
            cur = ''
          } else cur += ch
        }
        if (cur) paths.push(`${head}::${prefix}${cur.split('{')[0]}`)
      }
    }
    for (const p of paths.slice(0, 24)) {
      const [head, ...rest] = p.split('::')
      const segs = rest.filter(x => x && x !== '*' && x !== 'self')
      const base = head === 'crate' ? crateSrc : head === 'super' ? superDir : selfDir
      // The longest prefix that is a module file wins; the rest is an item inside it.
      const tries: string[] = []
      for (let n = Math.min(segs.length, 4); n >= 1; n--) {
        const mod = segs.slice(0, n).join('/')
        tries.push(`${base}/${mod}.rs`, `${base}/${mod}/mod.rs`)
      }
      if (tries.length) add(...tries)
    }
  } else if (/^(c|h|cc|cpp|hpp)$/.test(ext)) {
    for (const m of text.matchAll(/#include\s+"([^"]+)"/g)) add(`${dir}/${m[1]}`)
  } else if (ext === 'css' || ext === 'scss') {
    for (const m of text.matchAll(/@(?:import|use)\s+['"]([^'"]+)['"]/g)) add(`${dir}/${m[1]}`, `${dir}/_${m[1]}.scss`, `${dir}/${m[1]}.scss`)
  }
  const found: string[] = []
  for (const list of candidates.slice(0, 30)) {
    for (const p of list) {
      if (p === path || found.includes(p)) break
      if (await exists(p).catch(() => false)) {
        found.push(p)
        break
      }
    }
  }
  return found
}

const scan = (id: string) => {
  after?.(0, () => {
    void importsOf(id).then(found =>
      write?.(c => {
        const n = c.nodes[id]
        if (!n) return c
        const nodes = { ...c.nodes, [id]: { ...n, imports: found, scanned: true } }
        const now = Date.now()
        for (const f of found)
          if (!nodes[f])
            nodes[f] = {
              id: f,
              label: baseName(f),
              dir: dirOf(f),
              kind: 'ghost',
              ...placeNear(c, f, id),
              heat: 0,
              imports: [],
              scanned: false,
              touchedAt: now,
            }
        return { ...c, nodes: relayout(prune(nodes, c.agents, id, c.changes), c.trails) }
      }),
    )
  })
}

// ─── Progress ───────────────────────────────────────────────────────────────

/** The tasks a Claude made that are part of its work now (not those finished before the latest message). */
const tasksOf = (a: Agent, c: Pick<Crew, 'tasks'>) => Object.values(c.tasks ?? {}).filter(t => t.by === a.id && !t.old)

/**
 * Claude Code's task list after a task call that went through: a new task (its id from the result), a
 * change of status or wording, a deletion, or the whole list as TaskList / TaskGet report it.
 */
const applyTaskCall = (c: Crew, tool: string, a: Record<string, unknown>, ran: unknown, out: string, who: string): Crew => {
  const res = ((ran as { result?: unknown } | undefined)?.result ?? {}) as Record<string, unknown>
  const tasks: Record<string, PlanTask> = { ...(c.tasks ?? {}) }
  const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  const status = (v: unknown): PlanTask['status'] | undefined => (v === 'pending' || v === 'in_progress' || v === 'completed' ? v : undefined)
  if (tool === 'TaskCreate') {
    const made = (res.task ?? {}) as Record<string, unknown>
    // Ids count up from 1; the result names it (else its text does, else it is the next one).
    const id = str(made.id) || out.match(/#\s*(\d+)/)?.[1] || String(Object.keys(tasks).reduce((m, k) => Math.max(m, Number(k) || 0), 0) + 1)
    tasks[id] = { subject: trunc(str(made.subject) || str(a.subject), 120), status: 'pending', by: who, ...(str(a.activeForm) ? { active: trunc(str(a.activeForm), 120) } : {}) }
  } else if (tool === 'TaskUpdate') {
    if (res.success === false) return c
    const id = str(a.taskId) || str(res.taskId)
    if (!id) return c
    if (a.status === 'deleted') delete tasks[id]
    else {
      const was = tasks[id] ?? { subject: '', status: 'pending' as const, by: who }
      const to = status(a.status) ?? was.status
      tasks[id] = {
        ...was,
        status: to,
        ...(str(a.subject) ? { subject: trunc(str(a.subject), 120) } : {}),
        ...(str(a.activeForm) ? { active: trunc(str(a.activeForm), 120) } : {}),
        // Taken up again, an old task is part of the work now.
        ...(to !== 'completed' ? { old: false } : {}),
      }
    }
  } else if (tool === 'TaskList' && Array.isArray(res.tasks)) {
    const seen: Record<string, PlanTask> = {}
    for (const t of res.tasks as Record<string, unknown>[]) {
      const id = str(t?.id)
      const st = status(t?.status)
      if (!id || !st) continue
      const was = tasks[id]
      // One it never saw finish was finished before: not part of the work now.
      seen[id] = was
        ? { ...was, subject: trunc(str(t.subject), 120) || was.subject, status: st, ...(st !== 'completed' ? { old: false } : {}) }
        : { subject: trunc(str(t.subject), 120), status: st, by: who, ...(st === 'completed' ? { old: true } : {}) }
    }
    return { ...c, tasks: seen }
  } else if (tool === 'TaskGet' && res.task && typeof res.task === 'object') {
    const t = res.task as Record<string, unknown>
    const id = str(t.id)
    const st = status(t.status)
    if (id && st && tasks[id]) tasks[id] = { ...tasks[id], status: st, ...(st !== 'completed' ? { old: false } : {}) }
  } else return c
  // A long-lived list keeps its newest 200.
  const ids = Object.keys(tasks)
  if (ids.length > 200) for (const k of ids.sort((x, y) => (Number(x) || 0) - (Number(y) || 0)).slice(0, ids.length - 200)) delete tasks[k]
  return { ...c, tasks }
}

/**
 * The desktop app's task list after an update_plan call: `items` is the whole list; `advance` completes
 * the step in progress and starts the next; `done` ([n]) and `start` (n) name steps from 1.
 */
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const planAfter = (was: { content: string; status: string }[], a: Record<string, unknown>) => {
  const p = Array.isArray(a.items)
    ? (a.items.filter(i => i && typeof i === 'object') as Record<string, unknown>[]).slice(0, 40).map(i => ({ content: trunc(oneLine(String(i.content ?? '')), 120), status: String(i.status ?? 'pending') }))
    : was.map(x => ({ ...x }))
  const set = (step: { status: string } | undefined, status: string) => step && (step.status = status)
  if (a.advance === true) {
    set(p.find(x => x.status === 'in_progress'), 'completed')
    set(p.find(x => x.status === 'pending'), 'in_progress')
  }
  if (Array.isArray(a.done)) for (const n of a.done) if (typeof n === 'number') set(p[n - 1], 'completed')
  if (typeof a.start === 'number') set(p[a.start - 1], 'in_progress')
  return p
}

/** What a Claude is on now, from its plan: the task in progress (its spinner words), else the to-do. */
const doingOf = (a: Agent, c: Pick<Crew, 'tasks'>) => {
  const t = tasksOf(a, c).find(x => x.status === 'in_progress')
  return t ? t.active || t.subject : a.doing
}

// ─── Demo ───────────────────────────────────────────────────────────────────

const D = (p: string) => `demo/${p}`
const DEMO_GRAPH: Record<string, string[]> = {
  'src/main.tsx': ['src/App.tsx', 'src/styles.css'],
  'src/App.tsx': ['src/api/client.ts', 'src/components/Header.tsx', 'src/hooks/useAuth.ts'],
  'src/hooks/useAuth.ts': ['src/api/client.ts', 'src/api/token.ts'],
  'src/api/client.ts': ['src/api/types.ts', 'src/api/token.ts'],
  'src/components/Header.tsx': ['src/hooks/useAuth.ts'],
  'tests/auth.test.ts': ['src/hooks/useAuth.ts', 'src/api/token.ts'],
  'src/api/token.ts': ['src/api/types.ts'],
  'src/api/types.ts': [],
  'src/styles.css': [],
}
const DEMO_CAST = [
  {
    id: 'demo-1',
    kind: 'Explore',
    name: 'Scout',
    hue: 1,
    goal: 'Map how the auth token flows from login to every API call',
    path: ['src/main.tsx', 'src/App.tsx', 'src/hooks/useAuth.ts', 'src/api/token.ts', 'src/api/client.ts', 'src/api/types.ts'],
    tools: ['Read', 'Read', 'Grep', 'Read', 'Read', 'Read'],
    thoughts: [
      'Starting at the entry point to see how providers are wired.',
      'App mounts an AuthProvider; the hook owns the session.',
      'useAuth stores the token in memory and refreshes on focus.',
      'token.ts decodes expiry but never schedules a refresh.',
      'client.ts attaches the bearer header on every request.',
      'Types confirm the refresh token is optional, which explains the 401s.',
    ],
  },
  {
    id: 'demo-2',
    kind: 'Plan',
    name: 'Architect',
    hue: 3,
    goal: 'Design proactive token refresh without breaking the API client',
    path: ['src/api/token.ts', 'src/api/client.ts', 'src/hooks/useAuth.ts', 'src/api/client.ts', 'src/api/token.ts'],
    tools: ['Read', 'Read', 'Read', 'Edit', 'Edit'],
    thoughts: [
      'The cleanest seam is in token.ts: it already knows the expiry.',
      'client.ts should await a refresh promise instead of failing fast.',
      'useAuth only needs to expose the refresh callback.',
      'Adding a single-flight refresh so parallel calls share one request.',
      'Scheduling refresh 60s before expiry; plan is ready for review.',
    ],
  },
  {
    id: 'demo-3',
    kind: 'general-purpose',
    name: 'Helper',
    hue: 2,
    goal: 'Fix the failing login test and keep the suite green',
    path: ['tests/auth.test.ts', '$terminal', 'src/hooks/useAuth.ts', 'tests/auth.test.ts', '$terminal'],
    tools: ['Read', 'Bash', 'Edit', 'Edit', 'Bash'],
    detail: ['', 'npm test -- auth', '', '', 'npm test'],
    thoughts: [
      'The test mocks fetch but not the refresh endpoint.',
      'Running the auth suite to see the real failure first.',
      'useAuth swallows the refresh error; surfacing it instead.',
      'Updating the mock to return a refresh token.',
      'All 42 tests pass now.',
    ],
  },
]

/**
 * The demo's pretend Codex run: the Architect hands it a thread at step 1, it
 * reads, edits and tests over the next steps, and reports back at step 5.
 */
const demoCodexAt = (step: number, now: number, prev: CodexRun[]): CodexRun[] => {
  if (step < 1) return prev
  const cur = prev[0]
  const F = (p: string) => D(p)
  const base: CodexRun = cur ?? {
    id: 'demo-codex',
    task: 'Add a single-flight token refresh in src/api/token.ts and make client.ts await it; keep the auth tests green.',
    mode: 'write',
    root: 'demo',
    model: 'gpt-6.1-sol',
    effort: 'high',
    status: 'running',
    startedAt: now,
    endedAt: 0,
    thread: 'auth-refresh',
    resumed: false,
    caller: 'demo-2',
    activity: 'Reading its notes',
    focus: '',
    touched: [],
    events: [{ at: now, kind: 'info', text: 'reading .codex-bridge/NOTES.md' }],
    files: [],
    commands: 0,
    failedCommands: 0,
    answer: '',
    notesUpdated: false,
  }
  const ev = (kind: string, text: string, ok?: boolean) => ({ at: now, kind, text, ...(ok === undefined ? {} : { ok }) })
  switch (step) {
    case 2:
      return [{ ...base, activity: 'Reading token.ts', focus: F('src/api/token.ts'), touched: [{ path: F('src/api/token.ts'), kind: 'look', at: now }], events: [...base.events, ev('cmd', 'rg -n "refreshToken" src', true)], commands: 1 }]
    case 3:
      return [{ ...base, activity: 'Editing token.ts', focus: F('src/api/token.ts'), touched: [...base.touched.filter(t => t.path !== F('src/api/token.ts')), { path: F('src/api/token.ts'), kind: 'edit', at: now }], files: [F('src/api/token.ts')], events: [...base.events, ev('file', 'update token.ts')] }]
    case 4:
      return [{ ...base, activity: 'Running npm test -- auth', focus: F('tests/auth.test.ts'), touched: [...base.touched, { path: F('tests/auth.test.ts'), kind: 'look', at: now }, { path: F('src/api/client.ts'), kind: 'edit', at: now }], files: [F('src/api/token.ts'), F('src/api/client.ts')], events: [...base.events, ev('file', 'update client.ts'), ev('cmd', 'npm test -- auth')], commands: 2 }]
    case 5:
      return [{ ...base, status: 'done', endedAt: now, activity: 'Done', answer: 'Added a single-flight refresh in token.ts; client.ts now awaits it. 42 auth tests pass.', events: [...base.events.map(e => (e.kind === 'cmd' && e.ok === undefined ? { ...e, ok: true } : e)), ev('say', 'Added a single-flight refresh in token.ts; client.ts now awaits it. 42 auth tests pass.')], notesUpdated: true }]
    case 1:
      return [base]
    default:
      return prev
  }
}

let demoRun = 0
const startDemo = () => {
  if (!every || !write || demo) return
  const w = write
  const run = ++demoRun
  let k = 0
  const step = () => {
    const now = Date.now()
    if (k === 0) {
      void w(c => {
        const nodes = { ...c.nodes }
        Object.entries(DEMO_GRAPH).forEach(([p, imps], i) => {
          const id = D(p)
          nodes[id] = {
            id,
            label: baseName(p),
            dir: D(dirOf(p)),
            kind: 'ghost',
            x: 0.15 + ((i * 37) % 70) / 100,
            y: 0.15 + ((i * 53) % 70) / 100,
            heat: 0,
            imports: imps.map(D),
            scanned: true,
            touchedAt: now,
            demo: true,
          }
        })
        let d: Crew = { ...c, nodes: relayout(nodes, c.trails) }
        for (const cast of DEMO_CAST)
          d = upsert(d, cast.id, a => ({ ...a, name: cast.name, kind: cast.kind, hue: cast.hue, goal: cast.goal, state: 'thinking', progress: -1 }))
        return d
      })
    }
    const step = k
    k++
    if (step >= 7) {
      demo?.cancel()
      demo = undefined
      void w(c => {
        let d = c
        for (const cast of DEMO_CAST)
          d = log(upsert(d, cast.id, a => ({ ...a, state: 'done', doneAt: now, pending: [], progressSrc: 'done', progress: 100 })), cast.id, 'info', 'finished')
        // A pretend summary card for the pretend task.
        const files = Object.entries(d.changes)
          .filter(([p, ch]) => p.startsWith('demo/') && ch.edits)
          .map(([path, ch]) => ({ path, added: ch.added, removed: ch.removed }))
        const summary: Summary = {
          at: now,
          goal: 'Demo: fix the token refresh race and keep the auth tests green',
          ms: now - (d.timeline.find(f => f.agentId.startsWith('demo-'))?.at ?? now),
          files,
          read: Object.entries(d.changes).filter(([p, ch]) => p.startsWith('demo/') && !ch.edits).length,
          tests: { runs: 2, failed: 1, last: 'passed (42 passed)' },
          tokens: 184_000,
          cost: 1.37,
          claudes: DEMO_CAST.map(x => x.name),
          codex: 1,
          problems: 0,
        }
        return { ...d, summary }
      })
      after?.(20_000, () =>
        // A demo started since then owns the demo nodes now.
        void w(c => (run !== demoRun || demo ? c : {
          ...c,
          agents: c.agents.filter(a => !a.id.startsWith('demo-')),
          nodes: Object.fromEntries(Object.entries(c.nodes).filter(([, n]) => !n.demo)),
          trails: c.trails.filter(t => !t.a.startsWith('demo/') && !t.b.startsWith('demo/')),
          changes: Object.fromEntries(Object.entries(c.changes).filter(([p]) => !p.startsWith('demo/'))),
          demoCodex: [],
          tests: (c.tests ?? []).filter(t => !t.agentId.startsWith('demo-')),
          problems: (c.problems ?? []).filter(p => !p.path.startsWith('demo/')),
          timeline: (c.timeline ?? []).filter(f => !f.agentId.startsWith('demo-')),
        })),
      )
      return
    }
    void w(c => {
      let d: Crew = { ...c, demoCodex: demoCodexAt(step, now, c.demoCodex ?? []) }
      // The Helper's test runs come back a step later: the first one fails, the rerun passes.
      for (const t of (d.tests ?? []).filter(x => x.status === 'running' && x.agentId.startsWith('demo-'))) {
        const first = t.command === 'npm test -- auth'
        d = settleTest(d, t.id, first ? 'Tests:       1 failed, 41 passed, 42 total' : 'Tests:       42 passed, 42 total', first, now)
        // The failing run names the line it failed on; the rerun clears it.
        d = first
          ? {
              ...d,
              problems: [
                { path: D('tests/auth.test.ts'), line: 42, message: 'expect(received).toBe(expected): Expected "refreshed", Received undefined', source: t.command, by: t.who, hue: t.hue, at: now },
                { path: D('src/hooks/useAuth.ts'), line: 18, message: 'TypeError: Cannot read properties of undefined (reading "token")', source: t.command, by: t.who, hue: t.hue, at: now },
              ],
            }
          : { ...d, problems: (d.problems ?? []).filter(p => !p.path.startsWith('demo/')) }
      }
      DEMO_CAST.forEach(cast => {
        // The Architect hands its work to Codex for a few steps and waits on it.
        if (cast.id === 'demo-2' && step >= 1 && step <= 4) {
          const line = '◎ asking Codex [auth-refresh] Add a single-flight token refresh…'
          d = upsert(d, cast.id, a => ({ ...a, tool: 'mcp__codex-bridge__codex', detail: '[auth-refresh] Add a single-flight token refresh', state: 'busy', pending: ['demo'], ...(step === 1 ? { calls: a.calls + 1, actions: [line, ...a.actions].slice(0, 5) } : {}) }))
          if (step === 1) d = think(log(d, cast.id, 'act', line), cast.id, 'The refresh logic is self-contained: a good job to hand to Codex while I plan the client changes.')
          return
        }
        if (cast.id === 'demo-2' && step === 5) d = think(d, cast.id, 'Codex finished the refresh; reviewing its diff before wiring the client.')
        const i = Math.min(step, cast.path.length - 1)
        if (step >= cast.path.length) {
          d = upsert(d, cast.id, a => ({ ...a, state: 'thinking', pending: [] }))
          return
        }
        const raw = cast.path[i]
        const node = raw.startsWith('$') ? raw : D(raw)
        const tool = cast.tools[i]
        const detail = ('detail' in cast ? cast.detail?.[i] : '') || (tool === 'Grep' ? 'refreshToken' : '')
        const from = d.agents.find(a => a.id === cast.id)?.node ?? ''
        d = touch(d, node, from)
        const edit = tool !== 'Read' && tool !== 'Grep' && !node.startsWith('$')
        d = {
          ...d,
          timeline: [
            ...(d.timeline ?? []),
            { at: now, agentId: cast.id, name: cast.name, hue: cast.hue, node, tool, detail, added: edit ? 4 + ((step * 7 + cast.hue * 5) % 23) : 0, removed: edit ? (step * 3 + cast.hue) % 9 : 0 },
          ].slice(-MAX_FRAMES),
        }
        if (tool === 'Bash' && isTestCmd(detail)) {
          const run: TestRun = { id: `test-demo-${cast.id}-${step}`, agentId: cast.id, who: cast.name, hue: cast.hue, command: detail, purpose: step < 3 ? "Run the auth tests to see the real failure" : "Rerun the whole suite after the fix", startedAt: now, endedAt: 0, status: 'running', passed: 0, failed: 0, background: false }
          d = log({ ...d, tests: [...(d.tests ?? []), run] }, cast.id, 'info', `⚗ tests started · ${run.purpose}`)
        }
        if (!node.startsWith('$'))
          d = record(
            d,
            node,
            cast.id,
            tool === 'Read' || tool === 'Grep' ? 'read' : { added: 4 + ((step * 7 + cast.hue * 5) % 23), removed: (step * 3 + cast.hue) % 9 },
          )
        d = upsert(d, cast.id, a => ({
          ...a,
          ...(node !== a.node ? { from: a.node, movedAt: Date.now() } : {}),
          node,
          visited: [node, ...a.visited].slice(0, 8),
          tool,
          detail,
          state: 'busy',
          pending: ['demo'],
          calls: a.calls + 1,
          actions: [actionLine(tool, node, detail), ...a.actions].slice(0, 5),
          todosDone: i + 1,
          todosTotal: cast.path.length + 1,
          progressSrc: 'todos',
          // The demo's context fills as it works, one helper close to compacting.
          ctx: { tokens: Math.round((0.18 + 0.12 * cast.hue) * 200_000 * Math.min(1, (i + 2) / cast.path.length)), window: 200_000, at: Date.now() },
        }))
        d = log(d, cast.id, 'act', actionLine(tool, node, detail))
        d = think(d, cast.id, cast.thoughts[i])
      })
      return d
    })
  }
  step()
  demo = every(2600, step)
}

// ─── Diagnosis ──────────────────────────────────────────────────────────────

const CX = '#10A37F'
/** The last 40 things worth knowing when something goes wrong (the website's errors), kept in the store as 'diag'. */
const diag: string[] = []
let diagDirty = false
const note = (text: string) => {
  diag.push(`${new Date().toISOString().slice(11, 19)} ${text}`)
  if (diag.length > 40) diag.shift()
  diagDirty = true
}
// ─── At a glance: one row per Claude ────────────────────────────────────────
// What each Claude is doing, in plain words, for anyone glancing over: its kind of action (one icon each,
// from one classifier of the tool it calls), how far along it is, its model.

/** The kinds of thing a Claude does: every tool call, hook and pause is one of these. 16-unit stroke icons. */
const KIND_ICON: Record<string, string> = {
  read: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  edit: 'M10.5 2.5l3 3L6 13H3v-3l7.5-7.5zM9 4l3 3',
  shell: 'M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5H11',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2',
  web: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
  agent: 'M5 2.5v11M5 9c0-3 6-2 6-6.5M11 2.5v.01',
  skill: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z',
  plan: 'M3 4h10M3 8h10M3 12h6',
  tool: 'M10 2.5a3.5 3.5 0 0 0-3.2 4.9L2.5 11.7l1.8 1.8 4.3-4.3A3.5 3.5 0 0 0 13.5 6l-2 2-2-2 2-2a3.5 3.5 0 0 0-1.5-1.5z',
  hook: 'M11 2v6.5a3.5 3.5 0 1 1-7 0V7M4 7l-1.6 1.6M4 7l1.6 1.6',
  hookBlock: 'M11 2v6.5a3.5 3.5 0 1 1-7 0V7M4 7l-1.6 1.6M4 7l1.6 1.6',
  think: 'M4 8h.01M8 8h.01M12 8h.01',
  wait: 'M4.5 2h7M4.5 14h7M5.5 2c0 3.5 5 3.5 5 6s-5 2.5-5 6M10.5 2c0 3.5-5 3.5-5 6s5 2.5 5 6',
  you: 'M8 2.2l6.3 11.3H1.7zM8 6.5v3M8 11.6v.2',
  done: 'M3 8.5l3 3 7-7',
  idle: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.2l2 1.3',
  folder: 'M1.5 4h5l1.5 1.5h6.5v7.5h-13z',
  msg: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  mcp: 'M6 1.5v3M10 1.5v3M4.5 4.5h7v3a3.5 3.5 0 0 1-7 0zM8 11v3.5',
  thought: 'M3 7.2C3 4.6 5.2 2.8 8 2.8s5 1.8 5 4.4-2.2 4.4-5 4.4c-.6 0-1.2-.1-1.7-.2L3.5 13l.6-2.6C3.4 9.6 3 8.5 3 7.2z',
}
/** Each kind as plain words: what a Claude doing it is doing. */
const KIND_WORDS: Record<string, string> = {
  read: 'Reading', edit: 'Writing code', shell: 'Running a command', search: 'Searching the code', web: 'Reading online',
  agent: 'Starting a helper', skill: 'Using a skill', plan: 'Planning', tool: 'Working', think: 'Thinking',
  hook: 'Your hook ran', hookBlock: 'Your hook blocked it', mcp: 'Using a connector',
}
/** The text glyph for a kind, in the text pane. */
const KIND_GLYPH: Record<string, string> = { read: '◇', edit: '✎', shell: '▸', search: '⌕', web: '◎', agent: '⇢', skill: '✦', plan: '☐', mcp: '⧉', tool: '•', hook: '⚓', hookBlock: '⚓', think: '›', wait: '⏳', you: '!', done: '✓', idle: '○' }
/** What kind of thing a tool call is. */
const KINDS: [RegExp, string][] = [
  [/^(Read|NotebookRead|LS)$/, 'read'],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'edit'],
  [/^(Bash|PowerShell|BashOutput|KillShell|KillBash|Monitor)$/, 'shell'],
  [/^(Grep|Glob|ToolSearch)$/, 'search'],
  [/^(WebFetch|WebSearch)$|browser|chrome/i, 'web'],
  [/^(Agent|Task)$|^mcp__codex-bridge__codex$/, 'agent'],
  [/^(Skill|SlashCommand)$/, 'skill'],
  [/^(TodoWrite|Task(Create|Update|List|Get)|EnterPlanMode|ExitPlanMode)$/, 'plan'],
]
const kindOf = (tool: string) => KINDS.find(([re]) => re.test(tool))?.[1] ?? 'tool'
/**
 * What a Claude at work is doing, in plain words: its kind's words, made specific where the work says
 * more (Writing docs, Viewing an image, Building, Researching, Browsing, Using Blender, Using the PC).
 */
const workWords = (a: Agent, kind: string) => {
  const [w] = activityOf(a)
  if (kind === 'edit') return w === 'Writing docs' ? w : KIND_WORDS.edit
  if (kind === 'read') return w === 'Reading' ? KIND_WORDS.read : w
  if (kind === 'shell') return ['Building', 'Committing', 'Debugging'].includes(w) ? w : KIND_WORDS.shell
  if (kind === 'web') return a.tool === 'WebSearch' ? 'Researching' : w === 'Browsing' ? w : KIND_WORDS.web
  if (kind === 'tool') return w === 'Working' ? KIND_WORDS.tool : w
  return KIND_WORDS[kind] ?? KIND_WORDS.tool
}
/** A model's id as people say it: claude-opus-5-5 → Opus 5.5. */
const shortModel = (m: string) => {
  const x = m.replace(/^.*?claude-/, '').match(/^([a-z]+)-(\d+)(?:-(\d{1,2}))?/i)
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ''}` : trunc(m, 14)
}
/** A short clock for a row: 48s, 14m, 1h05. */
const shortTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}`
}
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One Claude's row as the pane draws it. */
type GlanceRow = {
  id: string
  name: string
  hue: string
  state: 'work' | 'wait' | 'you' | 'done' | 'idle'
  kind: string
  status: string
  object: string
  time: string
  total: number
  done: number
  progress: string
  /** It looks stuck: its second line says why, in amber. */
  stuck?: boolean
  /** A nested chat not read live: the time (13:09) it was last seen; its state is drawn dim. */
  asOf?: string
  model: string
  depth: number
  request: string[]
  /** Needing you: the whole request, in one line (the pane wraps it). */
  ask?: string
  where: string
  /** Opened: its model and cost, what it was asked (wrapped), its steps, its recent kinds of action. */
  detail?: { model: string; info: string; asked: string[]; steps: { mark: 'done' | 'now' | 'todo'; lines: string[] }[]; lately: { k: string; n: number }[] }
}
/** Rows of text a row takes: done one; at work two; needing you, its request and who it helps; and its Details, opened. */
const glanceBase = (r: GlanceRow) => (r.state === 'done' ? 1 : r.state === 'you' ? 1 + r.request.length + (r.where ? 1 : 0) : 2)
/**
 * What a Claude is waiting on, when it is waiting at all:
 * - you: a permission, an answer or a plan it needs (urgent), or, for the main Claude whose turn is over
 *   with nothing else running, your next message;
 * - helpers: the helpers it started, while it sits in the call that runs them, or (main, turn over)
 *   while helpers it started in the background still work;
 * - command: a command it runs and waits for, or (main, turn over) a background command still running.
 */
type Wait = { kind: 'you' | 'helpers' | 'command'; urgent: boolean; label: string; what: string; short: string }
const waitOf = (a: Agent, c: Crew, now: number): Wait | undefined => {
  if (a.needs) return { kind: 'you', urgent: true, label: 'waiting on you', what: a.needs.what.replace(/^allow (running )?/, ''), short: 'you' }
  const kids = c.agents.filter(h => h.id !== a.id && (h.parent ?? 'main') === a.id && (h.state === 'busy' || h.state === 'thinking'))
  const names = (list: Agent[]) => (list.length > 2 ? `${list.slice(0, 2).map(h => h.name).join(', ')} +${list.length - 2}` : list.map(h => h.name).join(', '))
  const helpers = (list: Agent[]): Wait => ({ kind: 'helpers', urgent: false, label: `waiting on ${list.length === 1 ? 'a helper' : `${list.length} helpers`}`, what: names(list), short: names(list) })
  const shells = runningShells(c, now).filter(x => x.agentId === a.id)
  const command = (label: string): Wait => ({ kind: 'command', urgent: false, label: 'waiting on a command', what: label, short: trunc(label, 28) })
  if (a.state === 'busy') {
    // In the call that runs helpers: the ones that call started, else every helper of its own at work.
    if (a.tool === 'Agent' || a.tool === 'Task') {
      const mine = kids.filter(h => !!h.spawnId && a.pending.includes(h.spawnId))
      return mine.length || kids.length ? helpers(mine.length ? mine : kids) : { kind: 'helpers', urgent: false, label: 'waiting on a helper', what: a.detail ? trunc(oneLine(a.detail), 60) : 'starting it', short: 'a helper' }
    }
    if (a.tool === 'Bash' || a.tool === 'PowerShell') return command((a.actions[0]?.startsWith(SHELL_MARK) ? a.actions[0].slice(SHELL_MARK.length) : cmdGist(a.detail)).replace(/^ran /, ''))
    // Reading a background task's output (it may block until the task ends): the command or the helpers it waits on.
    if (/^(BashOutput|TaskOutput|AgentOutput|Monitor)$/.test(a.tool)) return shells.length ? command(shells[0].label) : kids.length ? helpers(kids) : command('a background task')
    return undefined
  }
  // The main Claude's turn is over: still waiting on what it left running, else on you.
  if (a.id === 'main' && (a.state === 'idle' || a.state === 'done')) {
    if (kids.length) return helpers(kids)
    if (shells.length) return command(shells.length > 1 ? `${shells[0].label} +${shells.length - 1}` : shells[0].label)
    return { kind: 'you', urgent: false, label: 'your turn', what: 'waiting for your next message', short: 'your turn' }
  }
  return undefined
}

let searchRev = 0
/** Searches the map: a new text shows its first hit, the same text again (Enter) the next one. */
const searchFor = async ($: EngineInterface, typed: string, next = false) => {
  const q = typed.slice(0, 80)
  const rev = ++searchRev
  await update($, search, cur => (next && cur.q === q ? { q, i: cur.i + 1, rev } : { q, i: 0, rev }))
  await update($, mapView, v => ({ ...v, follow: q.trim() ? rev : 0 }))
}

/** The unit the pane's line model measures widths and indents in: one text column (the page and the text pane count columns). */
const CELL_W = 7.9

/** Opens a folder in the system's file manager. */
const openFolder = async ($: EngineInterface, path: string): Promise<Opened> => {
  const argv = defaultApp(await platformOf($), path)
  const r = await $.process.run(argv, { timeoutMs: 20_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
  // Explorer exits 1 even when it opened the folder: only a failure to start counts.
  return r.exitCode === -1 ? { ok: false, why: r.stderr } : { ok: true, why: '' }
}

/** Opens a file or folder from a click, and says so: "Opening …", or why it could not. */
const openAndSay = async ($: EngineInterface, what: 'file' | 'dir', path: string, name: string, hasEdits = false, line = 0) => {
  if (path.startsWith('demo/')) return void $.ui.toast(`${name} is a pretend file from the demo.`)
  const route = what === 'file' ? routeOf(path, await platformOf($)) : 'dir'
  const where = { dir: ' in the file manager', app: ' in its app', editor: '', reveal: ' in its folder (a program or script: shown, not run)' }[route]
  void $.ui.toast(`${route === 'reveal' ? 'Showing' : 'Opening'} ${name}${where}…`)
  const r = what === 'dir' ? await openFolder($, path) : await openInEditor($, path, hasEdits, line)
  if (!r.ok) void $.ui.toast(`Couldn't open ${name}: ${r.why || 'the program did not start'}${route === 'editor' ? ` (is \`${editor}\` on your PATH? "open files in" can pick another app)` : ''}`)
}

/** The folder group of files outside the session's project. */
const OUTSIDE = '~outside'
/** A file's folder relative to the session's ('.' for its top), or OUTSIDE. */
const groupOf = (id: string) => {
  if (id.startsWith('demo/')) return dirOf(id.slice(5)) || '.'
  if (sessionDir && id.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`)) {
    const d = dirOf(id)
    return d.length > sessionDir.length ? d.slice(sessionDir.length + 1) : '.'
  }
  return OUTSIDE
}
/** The colour role of a Claude's hue (its palette colour), or Codex's. */
const hueRole = (hex: string) => {
  const i = PALETTE.indexOf(hex)
  return i >= 0 ? `h${i}` : 'cx'
}
/** What a click on the pane does, as data: open a file or folder, move the viewer, set a setting, and the rest. */
type Act =
  | { k: 'none' }
  | { k: 'file'; path: string; name: string; edits: boolean; line?: number }
  | { k: 'dir'; path: string; name: string }
  | { k: 'pane'; tab?: NonNullable<Crew['pane']>['tab']; focus?: string; top?: number }
  | { k: 'log'; anchor?: number | null; toggle?: string; hold?: number | null }
  | { k: 'set'; theme?: ThemeMode; budget?: number; editor?: string; hideOutside?: boolean; autoSave?: boolean }
  | { k: 'logout'; how: 'copy' | 'download' | 'save' }
  | { k: 'demo' }
  | { k: 'copy' }
const NONE: Act = { k: 'none' }

/** A run of text on a line of the viewer: words, a fixed column, the rest cut to fit, a button. */
type Seg = {
  t?: string
  size?: number
  role?: string
  b?: boolean
  i?: boolean
  u?: boolean
  /** A fixed column this wide (the text cut to it). */
  w?: number
  /** Takes the room the others leave, cut with … to it. */
  flex?: boolean
  /** A coloured dot, an icon, a little Claude, or a bar this full (0-1), before or instead of the text. */
  dot?: string
  icon?: [string, string]
  sprite?: string
  bar?: number
  /** Space after it (8 by default). */
  gap?: number
  run?: Act
  /** A Button's words in their colours: [text, role]. */
  parts?: [string, string][]
  label?: string
}
type VLine = { segs: Seg[]; right?: Seg[]; indent?: number }
/** One Claude's row as the pane draws it: the glance row, its whole request unwrapped, and whether its Details show. */
type PaneRow = GlanceRow & { ask: string; focused: boolean }

/** The last task's card in the crew's place while nobody works: how long, what changed, tests, cost, who. */
type Recap = { title: string; goal: string; ago: string; facts: [string, string, string][]; copy?: Act; demo?: Act }

/** A file on a Touched line: its name, errors, lines added and removed, and the little Claude on it now. */
type TouchFile = { name: string; errs: number; add: number; del: number; on: string; read?: boolean; run: Act }
type TouchFolder = { name: string; files: TouchFile[] }
/** The viewer's tab row: the tabs (the one shown bold and underlined), then ▲ ▼ and back to the latest. */
type Tab = { id: string; t: string; label: string; on: boolean; run: Act }
/** Does what a click on the pane asked for. */
const doAction = async ($: EngineInterface, a: Act, surface: unknown) => {
  if (a.k === 'file') return openAndSay($, 'file', a.path, a.name, a.edits, a.line ?? 0)
  if (a.k === 'dir') return openAndSay($, 'dir', a.path, a.name)
  if (a.k === 'pane') {
    const { k: _, ...patch } = a
    return write?.(d => {
      const p = { ...(d.pane ?? {}), ...patch }
      return { ...d, pane: { ...p, focus: p.focus || undefined } }
    })
  }
  if (a.k === 'log')
    return write?.(d => {
      const v = d.logView ?? {}
      if (a.toggle === undefined) return { ...d, logView: { ...v, anchor: a.anchor ?? undefined } }
      // Opening a line holds the log where it is, so new lines don't push it away while it's read.
      const open = (v.open ?? []).filter(x => x !== a.toggle)
      const opening = open.length === (v.open ?? []).length
      return { ...d, logView: { anchor: v.anchor ?? (opening ? a.hold ?? undefined : undefined), open: opening ? [...open, a.toggle].slice(-30) : open } }
    })
  if (a.k === 'set') {
    if (a.theme) void $.store.set('theme', a.theme).catch(() => undefined)
    if (a.editor) void $.store.set('editor', a.editor).catch(() => undefined)
    if (a.autoSave !== undefined) void $.store.set('autoSave', a.autoSave).catch(() => undefined)
    if (a.budget !== undefined) {
      void $.store.set('budget', a.budget).catch(() => undefined)
      void $.ui.toast(a.budget ? `Budget set to ${fmtUsd(a.budget)}: you'll get a heads-up at 50%, 80% and 100%` : 'Budget cleared')
    }
    return write?.(d => ({
      ...d,
      ...(a.theme ? { theme: a.theme } : {}),
      ...(a.editor ? { editor: a.editor } : {}),
      ...(a.budget !== undefined ? { budget: a.budget, budgetWarned: 0 } : {}),
      ...(a.hideOutside !== undefined ? { hideOutside: a.hideOutside } : {}),
      ...(a.autoSave !== undefined ? { autoSave: a.autoSave } : {}),
    }))
  }
  if (a.k === 'logout') return a.how === 'save' ? saveLog($, 'button') : exportLog($, a.how)
  if (a.k === 'demo') return startDemo()
  if (a.k === 'copy') {
    const sm = (await readCrew?.())?.summary
    if (!sm) return
    const r = await $.ui.copy({ text: summaryMarkdown(sm), surface: surface as never }).catch(() => ({ isCopied: false }))
    return $.ui.toast(r.isCopied ? 'Summary copied as Markdown' : "Couldn't reach the clipboard here")
  }
}

/** A log line's kind of action, by the mark its words start with. */
const LOG_GLYPH: Record<string, string> = { '✎': 'edit', '◇': 'read', '▸': 'shell', '⌕': 'search', '◎': 'web', '⇢': 'agent', '🗜': 'think', '◍': 'web', '▣': 'tool', '▤': 'read', '✻': 'agent', '•': 'tool', '⚗': 'shell', '⏸': 'you', '✓': 'done', '✗': 'hookBlock', '←': 'agent', '→': 'agent', '⚓': 'hook', '⧉': 'mcp' }

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** How many Codex runs the codex-bridge mod has published (0 without it). */
let codexCount = 0
/** Claudes whose current turn the app started (a background task reporting in), not the user. */
const noticeTurn = new Set<string>()
const codexRunCount = async ($: EngineInterface) =>
  (((await $.state.get({ plugin: 'codex-bridge', key: 'runs' } as never).catch(() => ({}))) as { value?: unknown[] }).value ?? []).length

let replayShown = { at: -1, stamp: 0 }

const agentOf = (e: unknown) => (e as { agentId?: string }).agentId ?? 'main'

/** What the whole chat has cost so far, as /cost totals it (none where Claude Code keeps no ledger). */
const readChatCost = async ($: EngineInterface) => {
  let usd: unknown
  try {
    usd = (await $.session.usage()).cost?.usd
  } catch {
    return
  }
  if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) await write?.(c => (c.chatCost === usd ? c : { ...c, chatCost: usd }))
}

/** Tools that wait on the person by their nature, and what they wait for. */
const ASKS: Record<string, string> = { AskUserQuestion: 'answer a question', ExitPlanMode: 'approve the plan' }
/** What a permission prompt asks, in a few words: "allow running npm test", "allow editing token.ts". */
const needsText = (rawTool: string, input: unknown) => {
  const tool = typeof rawTool === 'string' ? rawTool.slice(0, 80) : 'a tool'
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  if (tool === 'Bash' || tool === 'PowerShell') return `allow running ${trunc(oneLine(s('description') || tidyCmd(s('command')) || 'a command'), 60)}`
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return `allow editing ${baseName(s('file_path') || s('notebook_path')) || 'a file'}`
  if (tool === 'Read') return `allow reading ${baseName(s('file_path')) || 'a file'}`
  if (tool === 'WebFetch') return `allow fetching ${(s('url').match(/^\w+:\/\/([^/]+)/) ?? [])[1] ?? 'a page'}`
  if (tool === 'WebSearch') return 'allow a web search'
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  return mcp ? `allow ${mcp[1]}: ${mcp[2].replace(/_/g, ' ')}` : `allow ${tool}`
}
/** The main model's context window, as the engine last measured it (0 until then). */
let mainWindow = 0
/** Each Claude's context as last written, so an unchanged one is not written again. */
const lastCtx = new Map<string, string>()
let mainModel = ''
/** A model's context window: the measured one for the main model, a million for a [1m] model, else 200k. */
const windowOf = (model: string) => (/\[1m\]|-1m\b/i.test(model) ? 1_000_000 : model && model === mainModel && mainWindow ? mainWindow : 200_000)
/**
 * What the pane shows, worked out once for any surface: the counts and cost, each Claude's row, the last
 * task, Touched, the tabs and the lines of the one shown. The pane draws it; the website gets it as data.
 */
const paneModel = async ($: EngineInterface, cols: number, bodyRows: number, web = false) => {
    // Time since a moment: for the website, a mark its page counts up itself (so the view stays the same each second).
    const since = (from: number, f: 'e' | 's' | 't') => (web ? `\uE000${f}${Math.round(from)}\uE001` : (f === 'e' ? elapsed : f === 's' ? shortTime : took)(Date.now() - from))
    // Every value the pane draws from, read side by side (one round trip, not nine in a row).
    const [c, , codexPublished, sq] = await Promise.all([
      read($, crew),
      // Read so the pane redraws each second while a timer runs.
      read($, tick),
      // Codex runs as the codex-bridge mod publishes them (another plugin's value: read only, typed loosely here).
      $.state.get({ plugin: 'codex-bridge', key: 'runs' } as never).catch(() => ({})),
      read($, search),
    ])
    const published = (codexPublished as unknown as { value?: CodexRun[] }).value ?? []
    const codexRuns = [...published, ...(c.demoCodex ?? [])]
    editor = c.editor || 'code'
    const nameFor = (id: string) => c.agents.find(a => a.id === id)?.name ?? (id === 'main' ? 'Claude' : 'a subagent')
    const live = c.agents.filter(a => a.state === 'busy' || a.state === 'thinking')
    // A finished helper keeps its window a moment, then folds into the log's title row (a click opens it again).
    const unfolded = c.unfolded ?? {}
    const isOpen = (a: Agent) =>
      a.id === 'main' || a.state === 'busy' || a.state === 'thinking' || !!a.needs || (unfolded[a.id] ?? (a.state === 'done' && Date.now() - (a.doneAt || 0) < WINDOW_LINGER_MS))
    // In the order they started: a window or desk never moves (waiting on you shows in amber instead).
    const shown = c.agents.filter(isOpen)
    const finished = c.agents.filter(a => a.id !== 'main' && (a.state === 'done' || a.state === 'idle'))
    const folded = finished.filter(a => !isOpen(a))
    const waitingOnYou = c.agents.filter(a => a.needs)
    const files = Object.values(c.nodes).filter(n => n.kind === 'file').length
    const secs = c.startedAt ? Math.floor((Date.now() - c.startedAt) / 1000) : 0
    const uptime = `up ${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}`

    const worked = Object.entries(c.changes ?? {}).sort((x, y) => y[1].at - x[1].at)
    const totalAdded = worked.reduce((n, [, ch]) => n + ch.added, 0)
    const totalRemoved = worked.reduce((n, [, ch]) => n + ch.removed, 0)
    const vwCols = Math.max(40, Math.min(300, cols - 1))
    const replaying = false
    const rpAt = 0
    // Codex speaks in the log too: what it was asked, what it ran and changed, and what it sent back.
    const codexLog: LogLine[] = codexRuns.flatMap(r => [
      { at: r.startedAt, who: 'Codex', hue: -1, kind: 'info' as const, text: `← ${nameFor(r.caller)}${r.thread ? ` [${r.thread}]` : ''}: ${trunc(oneLine(r.task), 90)}` },
      ...r.events
        .filter(ev => ev.kind === 'cmd' || ev.kind === 'file' || ev.kind === 'say')
        .slice(-12)
        .map(ev => ({
          at: ev.at,
          who: 'Codex',
          hue: -1,
          kind: (ev.kind === 'say' ? 'think' : 'act') as LogLine['kind'],
          text: ev.kind === 'cmd' ? `${SHELL_MARK}${cmdGist(ev.text)}${ev.ok === false ? ' ✗ failed' : ''}` : ev.kind === 'file' ? `✎ ${relPath(ev.text)}` : ev.text,
        })),
      ...(r.endedAt
        ? [
            {
              at: r.endedAt,
              who: 'Codex',
              hue: -1,
              kind: 'info' as const,
              text: `→ ${nameFor(r.caller)}: ${r.status}${r.files.length ? ` · ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed` : ''}${r.notesUpdated ? ' · notes updated' : ''}`,
            },
          ]
        : []),
    ])
    // The log: its lines, scrolled (held at a line while new ones come in below), and the ones opened whole.
    const lv = c.logView ?? {}
    const openLog = new Set(lv.open ?? [])
    // This chat's lines, Codex's, and the nested chats' newest (all of theirs come with Load older).
    const allLog = [...c.log, ...codexLog, ...nestedLines().slice(-NESTED_VIEW)].sort((x, y) => x.at - y.at)
    const held = typeof lv.anchor === 'number'
    let upto = held ? allLog.filter(l => l.at <= (lv.anchor as number)) : allLog
    if (!upto.length) upto = allLog.slice(0, 1)
    const newerCount = allLog.length - upto.length
    const demoOn = c.agents.some(a => a.id.startsWith('demo-') && a.state !== 'done')
    // The chat's cost as Claude Code totals it, else what the crew counted of it.
    const totalCost = c.chatCost ?? c.spent?.cost ?? c.agents.reduce((n, a) => n + (a.cost ?? 0), 0)
    const sm = c.summary
    const workedGroups: { g: string; rows: (typeof worked)[number][] }[] = []
    for (const w of worked) {
      const g = groupOf(w[0])
      const at = workedGroups.find(x => x.g === g)
      if (at) at.rows.push(w)
      else workedGroups.push({ g, rows: [w] })
    }
    // ── Desks, at a glance: one row per Claude at work (and each Codex run) ──
    // Line one: its little Claude, name, and what it is doing in plain words (the biggest text), its time.
    // Line two: how far along (a pip per step, "Step 2 of 3 · …") and its model. Colour says its state
    // only. One needing you is pinned on top, amber, with its whole request; one done is a dim line.
    const src = replaying ? crewAt(c, rpAt, replayShown.stamp) : c
    const deskAgents = replaying ? src.agents.filter(a => a.id === 'main' || a.state === 'busy' || a.state === 'thinking') : shown
    const nowOf = (a: Agent): [string, string] => {
      const w = waitOf(a, src, Date.now())
      if (w) return [w.what, w.label]
      if (a.tool === COMPACT && a.state === 'busy') return ['compacting', 'freeing up room']
      if (a.state === 'busy' && a.node && src.nodes[a.node] && !isSpecial(a.node)) return [baseName(a.node), verbOf(a)]
      // A command: Claude's own words for it, as it runs (not "ran …").
      if (a.state === 'busy' && (a.tool === 'Bash' || a.tool === 'PowerShell'))
        return [(a.actions[0]?.startsWith(SHELL_MARK) ? a.actions[0].slice(SHELL_MARK.length) : cmdGist(a.detail)).replace(/^ran /, ''), 'running']
      if (a.state === 'busy') return [a.detail ? trunc(oneLine(a.detail), 40) : verbOf(a), verbOf(a)]
      if (a.state === 'thinking') return ['thinking', 'planning its next step']
      if (a.state === 'done') return ['done', a.cost ? fmtUsd(a.cost) : 'finished']
      return ['—', a.id === 'main' ? 'waiting for a prompt' : 'idle']
    }
    // Codex in a row while it runs, and a little after (as a helper's lingers); the rest counted.
    const codexAtDesks = replaying ? [] : codexRuns.filter(r => r.status === 'running' || Date.now() - (r.endedAt || 0) < WINDOW_LINGER_MS)
    const CODEX_DESKS = 3
    const deskCount = deskAgents.length + Math.min(CODEX_DESKS, codexAtDesks.length) + (codexAtDesks.length > CODEX_DESKS ? 1 : 0)
    // It keeps room for the most there have been, so the cards below hold still as helpers come and go,
    // and gives the room back once there have been fewer for a minute.
    const anyAtWork = src.agents.some(a => a.state === 'busy' || a.state === 'thinking') || codexAtDesks.some(r => r.status === 'running')
    if (deskCount >= deskMax || !anyAtWork) {
      deskMax = deskCount
      deskLowSince = 0
    } else if (!deskLowSince) deskLowSince = Date.now()
    else if (Date.now() - deskLowSince > DESK_ROOM_MS) {
      deskMax = deskCount
      deskLowSince = 0
    }
    const showModel = cols >= 70
    // How deep a Claude sits: the main one 0, its helpers 1, theirs 2…
    const depthOf = (a: Agent) => {
      if (a.id === 'main') return 0
      let d = 1
      for (let p = a.parent; p && p !== 'main' && d < 4; p = src.agents.find(x => x.id === p)?.parent) d++
      return d
    }
    const rowOfAgent = (a: Agent): GlanceRow => {
      const now = Date.now()
      const wait0 = waitOf(a, src, now)
      const wait = wait0?.kind === 'command' && a.state === 'busy' ? undefined : wait0
      const runFrom = wait0 && !wait ? Math.min(...[...(src.shells ?? []), ...(src.tests ?? [])].filter(x => x.agentId === a.id && x.status === 'running').map(x => x.startedAt), now) : 0
      const at = a.state === 'busy' || a.state === 'thinking'
      const state: GlanceRow['state'] = a.needs ? 'you' : a.state === 'done' ? 'done' : wait ? (wait.kind === 'you' ? 'idle' : 'wait') : at ? 'work' : 'idle'
      const [what] = nowOf(a)
      const kind =
        state === 'you' || state === 'done' || state === 'wait' || state === 'idle'
          ? state
          : a.state === 'thinking' || a.tool === COMPACT
            ? 'think'
            : kindOf(a.tool)
      const tests = kind === 'shell' && /\b(test|tests|jest|vitest|pytest|mocha|spec)\b/i.test(`${what} ${a.detail}`)
      const status =
        state === 'you' ? 'Needs you' : state === 'done' ? 'Done' : state === 'wait' ? 'Waiting' : state === 'idle' ? 'Idle' : a.tool === COMPACT ? 'Compacting' : tests ? 'Running tests' : workWords(a, kind)
      const goal = a.goal && !systemNote(a.goal) ? oneLine(promptOf(a.goal)) : ''
      const object =
        state === 'you'
          ? ''
          : state === 'done'
            ? a.job || goal
            : state === 'wait'
              ? `for ${wait?.what ?? ''}`
              : state === 'idle'
                ? a.id === 'main'
                  ? 'your turn'
                  : ''
                : a.state === 'thinking'
                  ? // How long its model step has run, and what it last said.
                    [stepStart.has(a.id) ? since(stepStart.get(a.id) ?? 0, 'e') : '', a.thoughts[0] ? oneLine(a.thoughts[0]) : ''].filter(Boolean).join(' · ')
                  : runFrom && now - runFrom >= 1000
                    ? // A test run by what it is for (JS tests (jest): auth), else the command in Claude's words; and how long.
                      `${(t => (t ? t.purpose || testPurpose(t.command, '') : ''))((src.tests ?? []).find(x => x.agentId === a.id && x.status === 'running')) || wait0?.what || what} · ${since(runFrom, 'e')}`
                    : what
      const tasks = tasksOf(a, src)
      const total = tasks.length || a.todosTotal
      const done = tasks.length ? tasks.filter(t => t.status === 'completed').length : a.todosDone
      const step = doingOf(a, src) || tasks.find(t => t.status !== 'completed')?.subject || ''
      const progress = total
        ? `Step ${fmtK(Math.min(total, done + 1))} of ${fmtK(total)}${step ? ` · ${step}` : ''}`
        : state === 'idle' && a.id === 'main'
          ? 'Nothing running · ask Claude something to start'
          : state === 'idle'
            ? 'idle'
            : `${fmtK(a.calls)} action${a.calls === 1 ? '' : 's'} so far`
      const parent = src.agents.find(x => x.id === (a.parent ?? 'main'))
      const ask = a.needs ? `${a.needs.what.charAt(0).toUpperCase()}${a.needs.what.slice(1)}? Answer in the chat.` : ''
      return {
        id: a.id,
        name: a.name,
        hue: colorOf(a),
        state,
        kind,
        status,
        object,
        time: at && a.since ? since(a.since, 's') : state === 'done' && a.since ? shortTime((a.doneAt || now) - a.since) : '',
        total,
        done,
        progress: a.stuck && state !== 'done' ? `Stuck? It ${a.stuck}.` : progress,
        stuck: !!a.stuck && state !== 'done',
        model: shortModel(agentModel.get(a.id) ?? (a.id === 'main' ? mainModel : '')),
        depth: depthOf(a),
        request: ask ? wrapRows(ask, Math.max(20, cols - 18), 2) : [],
        ask,
        where: a.needs && a.id !== 'main' && parent ? `helping ${parent.name}` : '',
      }
    }
    const rowOfCodex = (r: CodexRun): GlanceRow => {
      const last = [...r.events].reverse().find(ev => ev.kind === 'cmd' || ev.kind === 'file')
      const running = r.status === 'running'
      const kind = !running ? 'done' : last?.kind === 'cmd' ? 'shell' : last?.kind === 'file' ? 'edit' : 'think'
      const caller = src.agents.find(a => a.id === r.caller)
      return {
        id: `cx-${r.id}`,
        name: 'Codex',
        hue: CX,
        state: running ? 'work' : 'done',
        kind,
        status: running ? KIND_WORDS[kind] : 'Done',
        object: last ? (last.kind === 'cmd' ? cmdGist(last.text).replace(/^ran /, '') : baseName(last.text)) : r.activity || oneLine(r.task),
        time: running && r.startedAt ? since(r.startedAt, 's') : '',
        total: 0,
        done: 0,
        progress: `${fmtK(r.commands)} command${r.commands === 1 ? '' : 's'} · ${fmtK(r.files.length)} file${r.files.length === 1 ? '' : 's'}${r.thread ? ` · ${r.thread}` : ''}`,
        model: r.model ? trunc(r.model, 14) : '',
        depth: caller ? depthOf(caller) + 1 : 1,
        request: [],
        where: '',
      }
    }
    // In tree order (each Claude, then the ones it started), the ones needing you pinned on top.
    const byParent = (id: string) => deskAgents.filter(a => a.id !== 'main' && (a.parent ?? 'main') === id)
    const ordered: Agent[] = []
    const walk = (a: Agent) => {
      if (ordered.includes(a)) return
      ordered.push(a)
      byParent(a.id).forEach(walk)
    }
    deskAgents.filter(a => a.id === 'main' || !deskAgents.some(p => p.id === (a.parent ?? 'main'))).forEach(walk)
    // A chat started from this one: its title, working or idle, and where it works; nested under this chat.
    const chatList = src.chats ?? []
    // Not read live (the list needs an approval to read): as of Claude's last look, its time at the right.
    const asOfChat = (ch: Chat) => (src.chatsLive === false && ch.seen ? clock(ch.seen).slice(0, 5) : '')
    // Its steps, from the file it writes about itself: as a Claude's card shows them (its branch and folder
    // are then in Details only); without steps, where it works.
    const rowOfChat = (ch: Chat): GlanceRow => {
      const f = nested.get(ch.id)?.file
      const total = Math.max(0, Math.round(Number(f?.total) || 0))
      const done = Math.min(total, Math.max(0, Math.round(Number(f?.done) || 0)))
      return {
        id: `chat-${ch.id}`,
        name: ch.title,
        hue: PALETTE[chatHue(ch.id)],
        state: ch.running ? 'work' : 'idle',
        kind: ch.running ? 'msg' : 'idle',
        status: ch.running ? 'Working' : 'Idle',
        object: asOfChat(ch) ? `as of ${asOfChat(ch)}` : ch.running ? 'in its own chat' : ch.at ? `last active ${since(ch.at, 's')} ago` : '',
        time: asOfChat(ch) && ch.at ? since(ch.at, 's') : '',
        asOf: asOfChat(ch) || undefined,
        total,
        done,
        progress: total
          ? `Step ${fmtK(Math.min(total, done + 1))} of ${fmtK(total)}${f?.doing ? ` · ${trunc(oneLine(String(f.doing)), 120)}` : ''}`
          : `Chat · ${[ch.branch, baseName(ch.cwd)].filter(Boolean).join(' · ')}`,
        model: '',
        depth: ch.depth,
        request: [],
        where: '',
      }
    }
    const glance = [...ordered.map(rowOfAgent), ...chatList.map(rowOfChat), ...codexAtDesks.slice(0, CODEX_DESKS).map(rowOfCodex)]
    const glanceList = [...glance.filter(r => r.state === 'you'), ...glance.filter(r => r.state !== 'you')]
    // Room: the rows shown, at least; while anyone works, two lines for each of the most Claudes lately.
    const desksH = Math.max(glanceList.reduce((n, r) => n + glanceBase(r), 0), anyAtWork ? Math.max(1, deskMax) * 2 : 0)
    // ── Folder cards: each folder the work touched, its files as chips (green edited, red with errors) ──
    // Built from the session's record of touched files (it keeps edits, and the order files were first
    // reached), not from the tree's capped nodes: an edited file never drops off, a folder never moves.
    const q = sq.q.trim().toLowerCase()
    type CardFile = { id: string; label: string; touchedAt: number }
    const cardRel = (id: string) => (id.startsWith('demo/') ? id.slice(5) : sessionDir && id.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`) ? id.slice(sessionDir.length + 1) : id)
    const matchesQ = (f: CardFile) => !!q && (cardRel(f.id).toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
    const cardFiles: CardFile[] = []
    const seenFile = new Set<string>()
    for (const [id, ch] of Object.entries(src.changes ?? {}))
      if (!isSpecial(id) && !seenFile.has(id)) {
        seenFile.add(id)
        cardFiles.push({ id, label: src.nodes[id]?.label || baseName(id), touchedAt: src.nodes[id]?.touchedAt || ch.at || 0 })
      }
    for (const n of Object.values(src.nodes))
      if (n.kind === 'file' && !isSpecial(n.id) && !seenFile.has(n.id)) {
        seenFile.add(n.id)
        cardFiles.push({ id: n.id, label: n.label || baseName(n.id), touchedAt: n.touchedAt || 0 })
      }
    const onFile = new Map<string, Agent[]>()
    for (const a of src.agents) if ((a.state === 'busy' || a.needs) && a.node) onFile.set(a.node, [...(onFile.get(a.node) ?? []), a])
    const groups = new Map<string, { files: CardFile[]; first: number }>()
    // A folder's place is its first file's: new folders join at the end, none ever moves.
    cardFiles.forEach((f, i) => {
      const g = groupOf(f.id)
      if (g === OUTSIDE && src.hideOutside) return
      const cur = groups.get(g) ?? { files: [], first: i }
      cur.files.push(f)
      groups.set(g, cur)
    })
    const outsideCount = src.hideOutside ? cardFiles.filter(f => groupOf(f.id) === OUTSIDE).length : 0
    const folders = [...groups.entries()].sort((x, y) => x[1].first - y[1].first)
    const perRow = cols >= 170 ? 3 : cols >= 100 ? 2 : 1
    const cardW = perRow === 1 ? cols - 1 : Math.floor((cols - (perRow - 1)) / perRow)
    const CHIPS = perRow === 1 ? 8 : 10
    const visibleFiles = [...groups.values()].flatMap(g => g.files)
    const matches = q ? visibleFiles.filter(matchesQ).length : 0
    const errsOf = (id: string) => (src.problems ?? []).filter(pr => pr.path === id).length
    const natural = (x: CardFile, y: CardFile) => x.label.localeCompare(y.label, undefined, { numeric: true, sensitivity: 'base' }) || x.id.localeCompare(y.id)
    // ── The pane, as the design draws it: header, crew, Touched, and the viewer with its tabs ──
    const now = Date.now()
    const wide = cols >= 70
    const ps = c.pane ?? {}
    const paneAct = (p: Omit<Extract<Act, { k: 'pane' }>, 'k'>): Act => ({ k: 'pane', ...p })
    const focusRow = ps.tab === 'claude' ? glanceList.find(r => r.id === ps.focus) : undefined
    const tab = ps.tab === 'claude' && !focusRow ? 'activity' : ps.tab ?? 'activity'
    const rowsP: PaneRow[] = glanceList.map(r => ({ ...r, ask: r.ask ?? r.request.join(' '), focused: tab === 'claude' && r.id === ps.focus }))
    // The header counts only what is known live: a nested chat not read live ("as of") is left out.
    const liveRows = rowsP.filter(r => !r.asOf)
    const count = (s: GlanceRow['state']) => liveRows.filter(r => r.state === s).length
    const standby = !liveRows.some(r => r.state === 'work' || r.state === 'wait' || r.state === 'you')
    const openDetails = (id: string) => (tab === 'claude' && ps.focus === id ? paneAct({ tab: 'activity', focus: '', top: 0 }) : paneAct({ tab: 'claude', focus: id, top: 0 }))
    const openFile = (id: string, name: string): Act => {
      const at = (src.problems ?? []).find(p => p.path === id)?.line
      return { k: 'file', path: id, name, edits: (c.changes[id]?.edits ?? 0) > 0, ...(at ? { line: at } : {}) }
    }
    const openDir = (path: string, name: string): Act => ({ k: 'dir', path, name })
    const label = (g: string) => (g === OUTSIDE ? 'outside the project' : g === '.' ? 'project top' : `${g}/`)
    const dirPathOf = (g: string) => (g === OUTSIDE || g.startsWith('demo') ? '' : g === '.' ? sessionDir : `${sessionDir}/${g}`)

    // Header: counts by state (only those there are), then the one cost and the budget.
    const n = { you: count('you'), work: count('work'), wait: count('wait'), done: count('done'), idle: count('idle') }
    const counts: [string, string, boolean][] = standby
      ? [[`◌ ${fmtK(Math.max(1, n.idle))} idle`, 'dim', false], ...(wide ? ([['· nothing running', 'dim', false]] as [string, string, boolean][]) : [])]
      : ([
          [n.you ? (wide ? `⏸ ${fmtK(n.you)} needs you` : `⏸ ${fmtK(n.you)}`) : '', 'amber', true],
          [n.work ? (wide ? `● ${fmtK(n.work)} working` : `● ${fmtK(n.work)}`) : '', 'green', false],
          [n.wait ? (wide ? `◌ ${fmtK(n.wait)} waiting` : `◌ ${fmtK(n.wait)}`) : '', 'dim', false],
          [n.done ? (wide ? `✓ ${fmtK(n.done)} done` : `✓ ${fmtK(n.done)}`) : '', 'dim', false],
        ] as [string, string, boolean][]).filter(x => x[0])
    const costRole = c.budget > 0 && totalCost >= c.budget ? 'red' : c.budget > 0 && totalCost >= c.budget * 0.8 ? 'amber' : 'text'
    const budgetText = c.budget > 0 ? (wide ? `of ${fmtUsd(c.budget)}` : `/ ${fmtUsd(c.budget)}`) : ''

    // The last task while nobody works; before any work, what shows here and the demo.
    const spendersNow = c.agents.filter(a => (a.cost ?? 0) > 0).sort((x, y) => y.cost - x.cost)
    const recap: Recap | undefined =
      standby && sm
        ? {
            title: `Last task done in ${elapsed(sm.ms)}`,
            goal: sm.goal ? oneLine(promptOf(sm.goal)) : '',
            ago: `${since(sm.at, 's')} ago`,
            facts: [
              ['Changed', sm.files.length ? `${fmtK(sm.files.length)} file${sm.files.length === 1 ? '' : 's'} · +${fmtK(sm.files.reduce((k, f) => k + f.added, 0))} −${fmtK(sm.files.reduce((k, f) => k + f.removed, 0))}` : 'no files', 'text'],
              ['Tests', sm.tests.runs ? (sm.tests.failed ? `✕ ${fmtK(sm.tests.failed)} failed · last ${sm.tests.last}` : `✓ ${sm.tests.last}`) : 'none run', sm.tests.runs ? (sm.tests.failed ? 'red' : 'green') : 'dim'],
              ['Cost', [fmtUsd(sm.cost), spendersNow.slice(0, wide ? 3 : 1).map(a => `${a.name} ${fmtUsd(a.cost)}`).join(', ') + (spendersNow.length > (wide ? 3 : 1) ? `, ${fmtK(spendersNow.length - (wide ? 3 : 1))} more` : '')].filter(Boolean).join(' · '), 'text'],
              ['Crew', `${sm.claudes.slice(0, wide ? 4 : 2).join(', ')}${sm.claudes.length > (wide ? 4 : 2) ? ` and ${fmtK(sm.claudes.length - (wide ? 4 : 2))} more` : ''}${sm.codex ? ` · ${fmtK(sm.codex)} Codex run${sm.codex === 1 ? '' : 's'}` : ''}`, 'text'],
            ],
            copy: { k: 'copy' },
          }
        : standby && !c.log.length
          ? { title: 'Nothing yet. Each Claude gets a row here as it starts.', goal: '', ago: '', facts: [], demo: { k: 'demo' } }
          : undefined

    // Touched: the three folders worked in most lately (in the order first reached), their files as buttons.
    const lastIn = (files: CardFile[]) => Math.max(0, ...files.map(f => Math.max(f.touchedAt, src.changes[f.id]?.at ?? 0)))
    const touchFolders: TouchFolder[] = [...folders]
      .sort((x, y) => lastIn(y[1].files) - lastIn(x[1].files))
      .slice(0, 3)
      .sort((x, y) => x[1].first - y[1].first)
      .map(([g, info]) => ({
        name: label(g),
        files: [...info.files]
          .map(f => ({ f, ch: src.changes[f.id], who: onFile.get(f.id) ?? [], errs: errsOf(f.id) }))
          .sort((x, y) => +!!y.who.length - +!!x.who.length || y.errs - x.errs || +!!y.ch?.edits - +!!x.ch?.edits || (y.ch?.at ?? 0) - (x.ch?.at ?? 0))
          .map(({ f, ch, who, errs }) => ({ name: f.label, errs, add: ch?.edits ? ch.added : 0, del: ch?.edits ? ch.removed : 0, on: who.length ? hueRole(colorOf(who[0])) : '', read: !ch?.edits, run: openFile(f.id, f.label) })),
      }))
    const problemsN = (src.problems ?? []).length
    // One count of the files the work touched (edited, read, or named by an error), the same in Touched and Files.
    const filesN = cardFiles.length
    const touchedSum = filesN
      ? `${fmtK(filesN)} file${filesN === 1 ? '' : 's'}${wide && (totalAdded || totalRemoved) ? ` · +${fmtK(totalAdded)} −${fmtK(totalRemoved)}` : ''}${problemsN ? ` · ${fmtK(problemsN)} problem${problemsN === 1 ? '' : 's'}` : ''}`
      : ''

    // The viewer: what each tab lists, as lines; the body shows BODY_ROWS of them from where it is scrolled.
    // Every Claude shows; the viewer takes the rest of the pane, down to its bottom (8 rows at least).
    const aboveRows =
      1 +
      1 +
      rowsP.reduce((n, r) => n + (r.state === 'done' ? 1 : r.state === 'you' ? 2 + wrapRows(r.ask, Math.max(16, cols - 6), 6).length : 2), 0) +
      (recap ? (recap.copy ? 2 + recap.facts.length : 2) : 0)
    const paneRows = Math.max(0, Math.floor(bodyRows))
    const BODY_ROWS = Math.max(8, (paneRows || aboveRows + 1 + 4 + 2 + 1 + 12) - aboveRows - 1 - 4 - 2 - (tab === 'search' ? 1 : 0) - 1)
    const timeW = (wide ? 8 : 5) * CELL_W
    const logCols = Math.max(12, vwCols - (wide ? 8 : 5) - 3 - 7 - 3 - 3 - 9)
    // A line opened reads over as many rows as it takes, up to the viewer's (the rest of a longer one is in the chat).
    const vRowsOf = (l: LogLine) => (openLog.has(logKey(l)) ? wrapRows(fullOf(l), logCols, BODY_ROWS) : [cutTo(oneLine(shortOf(l)), logCols)])
    const vCut = (l: LogLine) => fullOf(l) !== shortOf(l) || textW(oneLine(shortOf(l))) > logCols
    const logLinesOf = (l: LogLine): VLine[] => {
      const m = messageOf(l)
      const kind = l.kind === 'think' ? 'thought' : m ? 'msg' : LOG_GLYPH[[...l.text][0]] ?? (l.kind === 'info' ? 'plan' : 'tool')
      const bare = (t: string) => (l.kind === 'think' || m ? t : t.replace(/^[^\p{L}\p{N}"'(\[$~./]+/u, ''))
      const k = logKey(l)
      const open = openLog.has(k)
      const rowsOf = vRowsOf(l).map((t, i) => (i ? t : bare(t)))
      // Words start with a capital; a path or a file name keeps its own case.
      const first = rowsOf[0] && !/^\S*[/.\\]/.test(rowsOf[0]) ? `${rowsOf[0].charAt(0).toUpperCase()}${rowsOf[0].slice(1)}` : rowsOf[0] ?? ''
      const running = l.took === undefined && !!l.call && now - l.at >= 1000 && now - l.at < SHELL_GIVE_UP_MS
      const dur = l.took !== undefined ? took(l.took) : running ? `● ${since(l.at, 't')}` : ''
      // A nested chat's line: its chat's name and colour, and the helper there (or who wrote) first.
      const who = l.chat ? trunc(l.who, 6) : m ? (m.from ? trunc(m.from, 6) : 'You') : trunc(l.who, 6)
      const by = l.chat ? (m ? m.from || 'You' : l.by) : ''
      const tone = l.kind === 'think' || l.kind === 'info' ? 'dim' : 'text'
      return [
        {
          segs: [
            { t: wide ? clock(l.at) : clock(l.at).slice(0, 5), w: timeW, role: 'faint' },
            { dot: l.chat ? `h${chatHue(l.chat)}` : m ? 'text' : l.hue < 0 ? 'cx' : `h${l.hue % PALETTE.length}` },
            { t: who, w: 6 * CELL_W, role: 'dim' },
            { icon: [kind, running ? 'green' : l.kind === 'you' ? 'text' : 'dim'] },
            ...(by ? [{ t: `${by} ·`, role: 'dim' } as Seg] : []),
            { t: first, flex: true, role: tone, i: l.kind === 'think' },
            ...(vCut(l) ? [{ t: open ? '▾' : '›', role: 'dim', run: { k: 'log', toggle: k, hold: upto[upto.length - 1]?.at ?? null }, label: open ? 'Fold the line' : 'Show the whole line', w: 12 } as Seg] : []),
          ] as Seg[],
          right: [{ t: dur, role: running ? 'green' : 'faint' }],
        },
        ...rowsOf.slice(1).map(t => ({ segs: [{ t, flex: true, role: tone, i: l.kind === 'think' }], indent: timeW + 15 * CELL_W })),
      ]
    }
    // Activity: the log's lines up to where it is scrolled, as many as fill the body.
    let actLines: VLine[] = []
    let actFirst = upto.length
    for (let i = upto.length - 1; i >= 0; i--) {
      const ls = logLinesOf(upto[i])
      if (actLines.length && actLines.length + ls.length > BODY_ROWS) break
      actLines.unshift(...ls)
      actFirst = i
    }
    // A line opened but pushed out by the newer ones under it: the body starts at it instead, so it reads from its first row.
    const openAt = upto.map(l => openLog.has(logKey(l))).lastIndexOf(true)
    if (openAt >= 0 && openAt < actFirst && actFirst - openAt <= 3) {
      actLines = upto.slice(openAt).flatMap(logLinesOf).slice(0, BODY_ROWS)
      actFirst = openAt
    }
    const actLast = upto.length - 1
    // One Claude's details: model, who it helps, time; cost, tokens and context; what it was asked; its steps; its own lines.
    const detailLines = (): VLine[] => {
      if (!focusRow) return []
      const a = src.agents.find(x => x.id === focusRow.id)
      const run = focusRow.id.startsWith('cx-') ? codexRuns.find(x => `cx-${x.id}` === focusRow.id) : undefined
      const textCols = Math.max(16, vwCols - 2)
      const out: VLine[] = []
      const chat = focusRow.id.startsWith('chat-') ? chatList.find(x => `chat-${x.id}` === focusRow.id) : undefined
      if (chat) {
        // A nested chat: its whole title, who started it, where it works, and when it last did anything.
        const by = chatList.find(x => x.id === chat.parent)
        out.push({ segs: [{ t: 'Chat', b: true }, { t: [chat.running ? 'working' : 'idle', chat.at ? `last active ${since(chat.at, 's')} ago` : ''].filter(Boolean).join(' · '), role: 'dim', flex: true }] })
        for (const t of wrapRows(chat.title, textCols, 3)) out.push({ segs: [{ t }] })
        out.push({ segs: [{ t: `Started by ${by ? by.title : 'this chat'}`, role: 'dim', flex: true }] })
        for (const t of wrapRows([chat.cwd, chat.branch ? `branch ${chat.branch}` : ''].filter(Boolean).join(' · '), textCols, 2)) out.push({ segs: [{ t, role: 'dim' }] })
        out.push({ segs: [{ t: 'Open it from the sidebar, under this chat.', role: 'dim' }] })
        return out
      }
      const parent = a ? src.agents.find(x => x.id === (a.parent ?? 'main')) : undefined
      const caller = run ? src.agents.find(x => x.id === run.caller) : undefined
      const head = [focusRow.model || (run ? trunc(run.model, 14) : ''), a && a.id !== 'main' && parent ? `helping ${parent.name}` : caller ? `run by ${caller.name}` : '', focusRow.time].filter(Boolean).join(' · ')
      out.push({ segs: [{ t: focusRow.name, b: true }, { t: head, role: 'dim', flex: true }] })
      if (a) {
        // How full its context is: a bar and the share of its window (red once it compacts soon), and how often it was compacted.
        const ctx = a.ctx && a.ctx.window ? Math.round((a.ctx.tokens / a.ctx.window) * 100) : -1
        const packed = a.compactions ? ` · compacted ${fmtK(a.compactions)}×` : ''
        out.push({
          segs: [
            { t: `${fmtUsd(a.cost ?? 0)} · ${fmtK(a.tokens ?? 0)} tokens · context`, role: 'dim' },
            ...(ctx >= 0
              ? [{ bar: ctx / 100, role: ctx >= 85 ? 'red' : ctx >= 60 ? 'amber' : 'dim' }, { t: `${ctx}% of ${fmtK(a.ctx!.window)}${ctx >= 85 ? ' · compacts soon' : ''}${packed}`, role: ctx >= 85 ? 'red' : 'dim', flex: true }]
              : [{ t: `—${packed}`, role: 'dim', flex: true }]),
          ],
        })
      } else if (run) out.push({ segs: [{ t: `${fmtK(run.commands)} command${run.commands === 1 ? '' : 's'} · ${fmtK(run.files.length)} file${run.files.length === 1 ? '' : 's'}${run.thread ? ` · ${run.thread}` : ''}`, role: 'dim' }] })
      const asked = run ? oneLine(run.task) : a ? [a.goal && !systemNote(a.goal) ? oneLine(promptOf(a.goal)) : '', a.job ?? ''].sort((x, y) => y.length - x.length)[0] : ''
      for (const t of asked ? wrapRows(asked, textCols, 8) : []) out.push({ segs: [{ t }] })
      for (const t of a ? tasksOf(a, src).slice(0, 12) : []) {
        const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'
        const words = wrapRows(t.active && t.status === 'in_progress' ? t.active : t.subject, textCols - 2, 3)
        words.forEach((w, i) => out.push({ segs: [{ t: `${i ? ' ' : mark} ${w}`, role: t.status === 'in_progress' ? 'text' : 'dim' }] }))
      }
      const mine = allLog.filter(l => (run ? l.who === 'Codex' : l.who === focusRow.name && l.hue === (a?.hue ?? -2))).slice(-30).reverse()
      for (const l of mine) out.push(...logLinesOf(l).slice(0, 1))
      return out
    }
    // Every file the work touched, under its folder (in the order the work first reached them); a folder's
    // name opens it; files outside the project can be hidden, and are counted when they are.
    const fileLines = (filter: (path: string, name: string) => boolean = () => true): VLine[] => {
      const out: VLine[] = []
      for (const [g, info] of folders) {
        const list = info.files.filter(f => filter(f.id, f.label)).sort(natural)
        if (!list.length) continue
        const dp = dirPathOf(g)
        out.push({
          segs: [{ icon: ['folder', 'dim'], t: label(g), role: 'dim', b: true, flex: true, ...(dp ? { run: openDir(dp, label(g).replace(/\/$/, '')) } : {}) }],
          right: g === OUTSIDE && sessionDir ? [{ t: 'hide them', role: 'dim', u: true, run: { k: 'set', hideOutside: true } }] : [],
        })
        for (const f of list) {
          const ch = src.changes[f.id]
          out.push({
            segs: [{ t: f.label, flex: true, role: errsOf(f.id) ? 'red' : ch?.edits ? 'text' : 'dim', run: openFile(f.id, f.label) }],
            right: [...(ch?.edits ? [{ t: `+${fmtK(ch.added)}`, role: 'green', gap: 5 }, { t: `−${fmtK(ch.removed)}`, role: 'dim' }] : [{ t: errsOf(f.id) ? `✕${errsOf(f.id)}` : 'read', role: errsOf(f.id) ? 'red' : 'faint' }]), { t: ch ? trunc(ch.by, 8) : '', w: 60, role: ch ? `h${ch.hue % PALETTE.length}` : 'dim' }],
            indent: 18,
          })
        }
      }
      if (outsideCount) out.push({ segs: [{ t: `${fmtK(outsideCount)} file${outsideCount === 1 ? '' : 's'} outside the project, hidden`, role: 'faint', flex: true }], right: [{ t: 'show them', role: 'dim', u: true, run: { k: 'set', hideOutside: false } }] })
      return out.length ? out : [{ segs: [{ t: 'No files yet: they show here as the Claudes open them.', role: 'dim' }] }]
    }
    const searchLines = (): VLine[] => {
      const qq = sq.q.trim().toLowerCase()
      if (!qq) return [{ segs: [{ t: 'Type to find files, and lines in the log.', role: 'dim' }] }]
      const files = fileLines((p, nm) => relPath(p).toLowerCase().includes(qq) || nm.toLowerCase().includes(qq))
      const hits = allLog.filter(l => oneLine(fullOf(l)).toLowerCase().includes(qq)).slice(-40).reverse()
      const fileCount = cardFiles.filter(f => relPath(f.id).toLowerCase().includes(qq) || f.label.toLowerCase().includes(qq)).length
      return [
        { segs: [{ t: `${fmtK(fileCount)} file${fileCount === 1 ? '' : 's'} and ${fmtK(hits.length)} log line${hits.length === 1 ? '' : 's'} match`, role: 'dim' }] },
        ...(fileCount ? files : []),
        ...hits.flatMap(l => logLinesOf(l).slice(0, 1)),
      ]
    }
    const setW = wide ? 120 : 104
    const choice = (t: string, picked: boolean, run: Act): Seg => ({ t, role: picked ? 'text' : 'dim', b: picked, u: picked, run, gap: 12 })
    const settingLines = (): VLine[] => [
      { segs: [{ t: 'Theme', w: setW, role: 'dim', gap: 12 }, ...THEMES.map(m => choice(THEME_LABEL[m], (c.theme ?? 'auto') === m, { k: 'set', theme: m }))] },
      {
        segs: [
          { t: 'Budget', w: setW, role: 'dim', gap: 12 },
          ...[0, 5, 10, 25, 50, 100].map(v =>
            choice(v ? `$${v}` : 'none', (c.budget || 0) === v, { k: 'set', budget: v }),
          ),
          ...(wide ? [{ t: 'warns at 50, 80, 100%', role: 'faint', flex: true }] : []),
        ],
      },
      { segs: [{ t: 'Open files in', w: setW, role: 'dim', gap: 12 }, ...([['code', 'VS Code'], ['cursor', 'Cursor'], ['system', 'default app']] as const).map(([v, t]) => choice(t, (c.editor || 'code') === v, { k: 'set', editor: v }))] },
      { segs: [{ t: 'Outside files', w: setW, role: 'dim', gap: 12 }, choice('shown', !src.hideOutside, { k: 'set', hideOutside: false }), choice('hidden', !!src.hideOutside, { k: 'set', hideOutside: true })] },
      { segs: [{ t: 'Save log', w: setW, role: 'dim', gap: 12 }, choice('when I press Save', !c.autoSave, { k: 'set', autoSave: false }), choice('after each task', !!c.autoSave, { k: 'set', autoSave: true })] },
      { segs: [{ t: 'Demo', w: setW, role: 'dim', gap: 12 }, { t: demoOn ? 'a pretend session is playing' : '▶ try a pretend session', role: 'dim', u: !demoOn, run: { k: 'demo' } }] },
      { segs: [] },
      { segs: [{ t: `Claude Crew ${VERSION}`, role: 'faint' }] },
    ]
    const listed = tab === 'activity' ? actLines : tab === 'claude' ? detailLines() : tab === 'files' ? fileLines() : tab === 'search' ? searchLines() : settingLines()
    const fit = BODY_ROWS
    const top0 = tab === 'activity' ? 0 : Math.max(0, Math.min(ps.top ?? 0, listed.length - fit))
    const bodyLines = listed.slice(top0, top0 + fit)
    const scroll =
      tab === 'activity'
        ? {
            up: actFirst > 0 ? ({ k: 'log', anchor: upto[Math.max(0, actLast - LOG_STEP)]?.at ?? null } as Act) : NONE,
            down: held ? ({ k: 'log', anchor: upto.length - 1 + LOG_STEP >= allLog.length - 1 ? null : allLog[upto.length - 1 + LOG_STEP].at } as Act) : NONE,
            latest: { k: 'log', anchor: null } as Act,
            canUp: actFirst > 0,
            canDown: held && newerCount > 0,
            held,
          }
        : {
            up: paneAct({ top: Math.max(0, top0 - 3) }),
            down: paneAct({ top: Math.min(Math.max(0, listed.length - fit), top0 + 3) }),
            latest: paneAct({ top: 0 }),
            canUp: top0 > 0,
            canDown: top0 + fit < listed.length,
            held: top0 > 0,
          }
    const tabs: Tab[] = [
      { id: 'activity', t: 'Activity', label: 'Activity' },
      { id: 'files', t: `Files ${fmtK(filesN)}`, label: 'All files' },
      { id: 'search', t: '⌕', label: 'Search' },
      { id: 'settings', t: '⚙', label: 'Settings' },
      ...(focusRow ? [{ id: 'claude', t: `${trunc(focusRow.name, 12)} ✕`, label: `Close ${focusRow.name}'s details` }] : []),
    ].map(x => ({
      ...x,
      on: x.id === tab,
      run: x.id === 'claude' ? paneAct({ tab: 'activity', focus: '', top: 0 }) : paneAct({ tab: x.id as NonNullable<Crew['pane']>['tab'], top: 0 }),
    }))
    // The website's log: its newest lines (the page keeps what it was sent, and loads older ones from the
    // journals), each whole (the page cuts it to fit and opens it), oldest first.
    const webLog = allLog.slice(-WEB_WINDOW).map(webLine)
    return { c, sq, vwCols, totalCost, wide, paneAct, tab, rowsP, openDetails, openDir, counts, costRole, budgetText, recap, touchFolders, touchedSum, BODY_ROWS, listed, top0, scroll, tabs, webLog }
}

/** A log line for the website: what it shows closed; `more` when opening it shows more than its words (the page asks for that). */
const webLine = (l: LogLine) => {
  const m = messageOf(l)
  const said = oneLine(shortOf(l))
  const t = l.kind === 'think' || m ? said : said.replace(/^[^\p{L}\p{N}"'(\[$~./]+/u, '')
  // A nested chat's line: a bubble in the chat's colour, its name, and the helper there (or who wrote) first.
  const by = l.chat ? (m ? m.from || 'You' : l.by) : ''
  return {
    key: logKey(l),
    at: l.at,
    time: clock(l.at),
    dot: l.chat ? `h${chatHue(l.chat)}` : m ? 'text' : l.hue < 0 ? 'cx' : `h${l.hue % PALETTE.length}`,
    who: l.chat ? l.who : m ? m.from || 'You' : l.who,
    chat: l.chat ? l.who : undefined,
    chatTitle: l.chat ? nested.get(l.chat)?.title : undefined,
    by: by || undefined,
    kind: l.kind === 'think' ? 'thought' : m ? 'msg' : LOG_GLYPH[[...l.text][0]] ?? (l.kind === 'info' ? 'plan' : 'tool'),
    // Still running: the page counts its time up.
    run: l.took === undefined && !!l.call && Date.now() - l.at < SHELL_GIVE_UP_MS ? true : undefined,
    text: t && !/^\S*[/.\\]/.test(t) ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : t,
    more: oneLine(fullOf(l)) !== said ? true : undefined,
    bad: l.bad,
    dim: l.kind === 'think' || l.kind === 'info' ? true : undefined,
    thought: l.kind === 'think' ? true : undefined,
    dur: l.took !== undefined ? took(l.took) : '',
  }
}

/** The chat's Claude Crew website: the server this mod runs for it, its address, and who has it open. */
let webUrl = ''
/** Posts to the website: the view ('push'), or 'ping' so it knows the mod is still here (it stops after a quiet minute). */
let webPost: ((path: 'push' | 'ping' | 'export' | 'reply', body?: string) => Promise<unknown>) | undefined
let webPinged = 0
let webWatchers = 0
let webSent = ''
let webBusy = false
let webTimer: { cancel(): void } | undefined
let journalTimer: { cancel(): void } | undefined
let nestedTimer: { cancel(): void } | undefined
/** What each press on the page does, by the id the page sends back (only ids the mod handed out). */
const webActs = new Map<string, Act>()
const actId = (a: Act) => {
  const id = (hash(JSON.stringify(a)) >>> 0).toString(36)
  if (webActs.size > 4000) webActs.clear()
  webActs.set(id, a)
  return id
}
/** The website's view: the pane's model as data, each press an id. */
const webView = async ($: EngineInterface) => {
  const m = await paneModel($, 160, 700, true)
  const seg = (g: Seg) => ({
    t: g.t ?? '',
    role: g.role,
    b: g.b || undefined,
    i: g.i || undefined,
    u: g.u || undefined,
    w: g.w ? Math.round(g.w / CELL_W) : undefined,
    flex: g.flex || undefined,
    dot: g.dot,
    icon: g.icon,
    bar: g.bar,
    parts: g.parts,
    act: g.run && g.run.k !== 'none' ? actId(g.run) : undefined,
    label: g.label,
  })
  const line = (l: VLine) => ({ segs: l.segs.map(seg), right: (l.right ?? []).map(seg), indent: l.indent ? Math.round(l.indent / CELL_W) : 0 })
  return {
    v: VERSION,
    theme: m.c.theme ?? 'auto',
    icons: KIND_ICON,
    head: { counts: m.counts, cost: m.totalCost > 0 || m.c.budget > 0 ? fmtUsd(m.totalCost) : '', costRole: m.costRole, budget: m.budgetText },
    rows: m.rowsP.map(r => ({
      id: r.id,
      name: r.name,
      hue: hueRole(r.hue),
      state: r.state,
      kind: r.kind,
      status: r.status,
      object: r.object,
      time: r.time,
      total: r.total,
      done: r.done,
      progress: r.progress,
      stuck: !!r.stuck,
      asOf: r.asOf,
      model: r.model,
      depth: r.depth,
      ask: r.ask,
      where: r.where,
      focused: r.focused,
      details: actId(m.openDetails(r.id)),
    })),
    recap: m.recap
      ? { title: m.recap.title, goal: m.recap.goal, ago: m.recap.ago, facts: m.recap.facts, full: !!m.recap.copy, demo: m.recap.demo ? actId(m.recap.demo) : '' }
      : null,
    touched: {
      sum: m.touchedSum,
      open: sessionDir ? actId(m.openDir(sessionDir, 'the project folder')) : '',
      more: actId(m.paneAct({ tab: 'files', top: 0 })),
      folders: m.touchFolders.map(d => ({
        name: d.name,
        files: d.files.slice(0, 12).map(f => ({ name: f.name, errs: f.errs, add: f.add ? `+${fmtK(f.add)}` : '', del: f.del ? `−${fmtK(f.del)}` : '', on: f.on, read: !!f.read, act: actId(f.run) })),
        more: Math.max(0, d.files.length - 12),
      })),
    },
    tabs: m.tabs.map(t => ({ t: t.t, label: t.label, on: t.on, act: actId(t.run) })),
    tab: m.tab,
    q: m.sq.q,
    settings:
      m.tab === 'settings'
        ? {
            themes: THEMES.map(t => ({ t: THEME_LABEL[t], on: (m.c.theme ?? 'auto') === t, act: actId({ k: 'set', theme: t }) })),
            budget: m.c.budget || 0,
            editor: m.c.editor || 'code',
            hideOutside: !!m.c.hideOutside,
            outside: [actId({ k: 'set', hideOutside: false }), actId({ k: 'set', hideOutside: true })],
            demoOn: m.c.agents.some(a => a.id.startsWith('demo-') && a.state !== 'done'),
            demo: actId({ k: 'demo' }),
            autoSave: !!m.c.autoSave,
            autoActs: [actId({ k: 'set', autoSave: false }), actId({ k: 'set', autoSave: true })],
            version: VERSION,
          }
        : null,
    log: m.tab === 'activity' ? m.webLog : [],
    // Saved on disk before the oldest line sent: how many, and back to when (Load older says so).
    older: m.tab === 'activity' ? savedBefore(m.webLog[0]?.at ?? Infinity) : null,
    logActs: { copy: actId({ k: 'logout', how: 'copy' }), download: actId({ k: 'logout', how: 'download' }), save: actId({ k: 'logout', how: 'save' }) },
    logSave: { busy: saving, at: lastSave ? clock(lastSave.at) : '', file: lastSave?.file ?? '', summary: !!lastSave?.summary },
    lines: m.tab === 'activity' ? [] : m.listed.slice(0, 600).map(line),
  }
}
/** Sends the website the view when it changed, while anyone has the page open. */
const publishWeb = async ($: EngineInterface) => {
  if (webPost && Date.now() - webPinged > 15_000) {
    webPinged = Date.now()
    void webPost('ping')
  }
  if (!webPost || !webWatchers || webBusy) return
  webBusy = true
  try {
    const s = JSON.stringify(await webView($))
    if (s !== webSent) {
      webSent = s
      await webPost('push', s)
    }
  } catch (err) {
    note(`web view: ${String(err).slice(0, 160)}`)
  } finally {
    webBusy = false
  }
}
/**
 * The whole log of this chat, kept on disk as it grows (the pane keeps only its newest lines and
 * starts over when Claude restarts), so Save, Copy and Download have all of it. A folder per chat,
 * ~/.claude/crew-map/journals/<session id>/, of numbered chunks of 250 lines (000001.json …, each a
 * JSON array). A tick writes only the chunks that changed: the newest, and an older one whose line
 * finished late. (A chat's single <session id>.json from before is carried over once.)
 */
const journal = new Map<string, LogLine>()
const CHUNK = 250
const JOURNAL_KEEP = 5000
let journalDir = ''
let journalSid = ''
/** Which chunk each line is in, each chunk's lines in order, and the chunks to write. */
const chunkOf = new Map<string, number>()
const chunks = new Map<number, string[]>()
const dirtyChunks = new Set<number>()
let lastChunk = 1
const chunkName = (n: number) => `${String(n).padStart(6, '0')}.json`
const isLine = (l: unknown): l is LogLine => !!l && typeof (l as LogLine).at === 'number' && typeof (l as LogLine).text === 'string'
/** A line into the journal: a new one at the end of the newest chunk, a changed one where it is. */
const addToJournal = (l: LogLine, chunk?: number) => {
  const k = logKey(l)
  const at = chunkOf.get(k)
  if (at !== undefined) {
    const was = journal.get(k)
    if (was && was.took === l.took && was.more === l.more && was.bad === l.bad) return
    journal.set(k, l)
    dirtyChunks.add(at)
    return
  }
  const n = chunk ?? ((chunks.get(lastChunk)?.length ?? 0) >= CHUNK ? lastChunk + 1 : lastChunk)
  lastChunk = Math.max(lastChunk, n)
  chunks.set(n, [...(chunks.get(n) ?? []), k])
  chunkOf.set(k, n)
  journal.set(k, l)
  if (chunk === undefined) dirtyChunks.add(n)
  // Bounded: the oldest chunk leaves memory (its file stays, until it is pruned).
  while (journal.size > JOURNAL_KEEP && chunks.size > 1) {
    const first = Math.min(...chunks.keys())
    for (const x of chunks.get(first) ?? []) {
      journal.delete(x)
      chunkOf.delete(x)
    }
    chunks.delete(first)
    dirtyChunks.delete(first)
  }
}
const later$ = <T,>(fn: () => Promise<T> | T) => Promise.resolve().then(fn)
const journalLines = () => [...journal.values()].sort((x, y) => x.at - y.at)
const listDir = (path: string) => later$(() => fsList?.(path) ?? []).catch(() => []) as Promise<{ name: string; mtimeMs?: number }[]>
const readJson = (path: string) => later$(async () => JSON.parse(String(await fsRead?.(path))) as unknown).catch(() => undefined)
/** A journal folder's chunk numbers, oldest first. */
const chunkList = async (dir: string) =>
  (await listDir(dir))
    .filter(f => /^\d{6}\.json$/.test(f.name))
    .map(f => ({ n: Number(f.name.slice(0, 6)), at: f.mtimeMs ?? 0 }))
    .sort((x, y) => x.n - y.n)
/** The engine's file reads, for the helpers above (set when the journal opens). */
let fsList: ((path: string) => Promise<unknown[]>) | undefined
let fsRead: ((path: string) => Promise<unknown>) | undefined
const openJournal = async ($: EngineInterface) => {
  // Written only once what was there is read in (the timer may tick before then).
  journalDir = ''
  fsList = p => $.fs.list(p)
  fsRead = p => $.fs.read(p)
  journalSid = String((await later$(() => $.session.id()).catch(() => '')) ?? '')
  const home = String((await later$(() => $.env.get('USERPROFILE')).catch(() => undefined)) ?? (await later$(() => $.env.get('HOME')).catch(() => undefined)) ?? '').replace(/\\/g, '/')
  homeDir = home
  hostId = String((await later$(() => $.env.get('CLAUDE_CODE_HOST_SESSION_ID')).catch(() => undefined)) ?? '')
  if (!/^local_[\w-]+$/.test(hostId)) hostId = ''
  const dir = journalSid && home ? `${home}/.claude/crew-map/journals/${journalSid}` : ''
  if (!dir) return
  const have = await chunkList(dir)
  for (const { n } of have.slice(-Math.ceil(JOURNAL_KEEP / CHUNK))) {
    const lines = await readJson(`${dir}/${chunkName(n)}`)
    if (Array.isArray(lines)) for (const l of lines) if (isLine(l) && !journal.has(logKey(l))) addToJournal(l, n)
  }
  lastChunk = Math.max(1, have[have.length - 1]?.n ?? 1)
  if (!have.length) {
    const old = await readJson(`${dir}.json`)
    if (Array.isArray(old)) for (const l of old.slice(-JOURNAL_KEEP)) if (isLine(l)) addToJournal(l)
  }
  journalDir = dir
}
/**
 * Old journals and steps files go (none written for 30 days, or past the newest 300 journals): $.fs
 * can't delete, so web/prune.mjs does, with Node (which the website needs anyway). Once a day at most.
 */
const pruneOld = async ($: EngineInterface) => {
  const today = localDay(Date.now())
  if (!homeDir || (await $.store.get('pruned').catch(() => today)) === today) return
  await $.store.set('pruned', today).catch(() => undefined)
  await later$(() => $.process.run(['node', `${$.plugin.root}/web/prune.mjs`, `${homeDir}/.claude/crew-map`, '30', journalSid], { timeoutMs: 20_000 })).catch(() => undefined)
}
/** Takes the log's new lines into the journal (a pretend session's stay out), and writes the chunks that changed. */
const syncJournal = async ($: EngineInterface) => {
  const c = await readCrew?.()
  if (!c) return
  const demoNames = new Set(c.agents.filter(a => a.id.startsWith('demo-')).map(a => a.name))
  const demoOn = demoNames.size > 0
  for (const l of c.log) if (!demoNames.has(l.who) && !(demoOn && l.who === 'Claude')) addToJournal(l)
  if (journalDir)
    for (const n of [...dirtyChunks]) {
      dirtyChunks.delete(n)
      const lines = (chunks.get(n) ?? []).map(k => journal.get(k)).filter(isLine)
      await later$(() => $.fs.write(`${journalDir}/${chunkName(n)}`, JSON.stringify(lines))).catch(() => dirtyChunks.add(n))
    }
  await writeSelf($, c)
}

// ── Nested chats' steps and lines ──
// Each chat's mod writes a small file about itself, ~/.claude/crew-map/chats/<its app id>.json: its
// journal's name and its steps. The chat that started it (any chat above it) reads that file and the
// journal chunks that changed, every few seconds, so their steps fill its card and their lines join its
// log. (Files, not $.store: one file per chat, so two chats never write the same one.)
type ChatFile = { id: string; journal: string; total: number; done: number; doing: string; at: number }
/** This chat's id in the desktop app (local_…), and the home folder the files live under. */
let hostId = ''
let homeDir = ''
let selfSent = ''
let selfAt = 0
const writeSelf = async ($: EngineInterface, c: Crew) => {
  const a = c.agents.find(x => x.id === 'main')
  if (!hostId || !homeDir || !journalSid || !a) return
  const tasks = tasksOf(a, c)
  const total = tasks.length || a.todosTotal
  const done = tasks.length ? tasks.filter(t => t.status === 'completed').length : a.todosDone
  const doing = doingOf(a, c) || tasks.find(t => t.status !== 'completed')?.subject || ''
  const s = JSON.stringify({ id: hostId, journal: journalSid, total, done, doing: trunc(oneLine(doing), 120) })
  // Written when it changed, and once a minute so a reader can tell it is still there.
  if (s === selfSent && Date.now() - selfAt < 60_000) return
  selfSent = s
  selfAt = Date.now()
  await later$(() => $.fs.write(`${homeDir}/.claude/crew-map/chats/${hostId}.json`, `${s.slice(0, -1)},"at":${selfAt}}`)).catch(() => undefined)
}
/** What this chat knows of each nested chat: its file, and its journal's chunks (lines as this log shows them). */
type Nested = { file?: ChatFile; fileM: number; title?: string; chunkM: Map<number, number>; chunkLines: Map<number, LogLine[]>; lines: LogLine[] }
const nested = new Map<string, Nested>()
/** A nested chat's colour (its card's): an index into PALETTE. */
const chatHue = (id: string) => [...id].reduce((n, x) => n + x.charCodeAt(0), 0) % PALETTE.length
/** All nested chats' lines in time order, made again only when one changed. */
let nestedVer = 0
let sortedVer = -1
let sortedNested: LogLine[] = []
const nestedLines = () => {
  if (sortedVer !== nestedVer) {
    sortedNested = [...nested.values()].flatMap(x => x.lines).sort((x, y) => x.at - y.at)
    sortedVer = nestedVer
  }
  return sortedNested
}
/** How many of those come before a time. */
const nestedBefore = (at: number) => {
  const all = nestedLines()
  let lo = 0
  let hi = all.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((all[mid]?.at ?? 0) < at) lo = mid + 1
    else hi = mid
  }
  return lo
}
/** The nested chats' newest lines the view carries (older ones come with Load older). */
const NESTED_VIEW = 200
/** How many of the newest lines each view to the website carries. */
const WEB_WINDOW = 150
const savedBefore = (at: number) => {
  let left = nestedBefore(at)
  let first = nestedLines()[0]?.at ?? Infinity
  for (const l of journal.values()) {
    if (l.at < at) left++
    if (l.at < first) first = l.at
  }
  return { left, first: Number.isFinite(first) ? clock(first).slice(0, 5) : '' }
}
let readingNested = false
const readNested = async ($: EngineInterface) => {
  const c = await readCrew?.()
  if (!c || !homeDir || readingNested) return
  readingNested = true
  try {
    const chats = c.chats ?? []
    let changed = false
    for (const k of [...nested.keys()])
      if (!chats.some(x => x.id === k)) {
        nested.delete(k)
        changed = true
      }
    if (chats.length) {
      const dir = `${homeDir}/.claude/crew-map`
      const files = await listDir(`${dir}/chats`)
      for (const ch of chats) {
        const cur: Nested = nested.get(ch.id) ?? { fileM: 0, chunkM: new Map(), chunkLines: new Map(), lines: [] }
        cur.title = ch.title
        nested.set(ch.id, cur)
        const fm = files.find(f => f.name === `${ch.id}.json`)?.mtimeMs ?? 0
        if (fm && fm !== cur.fileM) {
          const f = (await readJson(`${dir}/chats/${ch.id}.json`)) as ChatFile | undefined
          if (f && typeof f.journal === 'string' && /^[\w-]+$/.test(f.journal)) {
            cur.file = f
            cur.fileM = fm
            changed = true
          }
        }
        if (!cur.file) continue
        // Only the chunks that changed since the last read, of its newest 5,000 lines.
        const name = trunc(ch.name || ch.title, 24)
        const asHere = (l: LogLine): LogLine => ({ ...l, chat: ch.id, who: name, ...(l.who !== 'Claude' ? { by: l.who } : {}) })
        const have = (await chunkList(`${dir}/journals/${cur.file.journal}`)).slice(-Math.ceil(JOURNAL_KEEP / CHUNK))
        let mine = false
        for (const n of [...cur.chunkLines.keys()])
          if (!have.some(x => x.n === n)) {
            cur.chunkLines.delete(n)
            cur.chunkM.delete(n)
            mine = true
          }
        for (const { n, at } of have) {
          if (!at || cur.chunkM.get(n) === at) continue
          const lines = await readJson(`${dir}/journals/${cur.file.journal}/${chunkName(n)}`)
          if (!Array.isArray(lines)) continue
          cur.chunkLines.set(n, lines.filter(l => isLine(l) && !l.chat).map(asHere))
          cur.chunkM.set(n, at)
          mine = true
        }
        if (mine) {
          cur.lines = [...cur.chunkLines.entries()].sort((x, y) => x[0] - y[0]).flatMap(x => x[1])
          changed = true
        }
      }
    }
    if (changed) {
      nestedVer++
      $.ui.invalidate('ui.render')
    }
  } finally {
    readingNested = false
  }
}
const pad2 = (n: number) => String(n).padStart(2, '0')
const localDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
/** The log as Markdown: who did what and when, and what each Claude was thinking. */
const logMarkdown = (lines: LogLine[], c: Crew) => {
  const goal = lines.find(l => l.kind === 'you')?.text ?? ''
  const what = (l: LogLine) => (l.kind === 'think' ? 'thought' : l.kind === 'you' ? 'asked' : l.kind === 'msg' ? 'said' : l.kind === 'info' ? 'note' : 'did')
  const first = lines[0]
  const last = lines[lines.length - 1]
  return [
    `# Claude Crew log${goal ? `: ${trunc(oneLine(promptOf(goal)), 80)}` : ''}`,
    '',
    `- Project: \`${sessionDir || 'unknown'}\``,
    `- Chat: ${journalSid || 'this chat'}`,
    first ? `- From ${localDay(first.at)} ${clock(first.at)} to ${localDay(last.at)} ${clock(last.at)}` : '- Nothing happened yet',
    `- Cost so far: ${fmtUsd(c.chatCost ?? c.spent?.cost ?? 0)}`,
    '',
    '## Activity',
    '',
    ...lines.map(l => `- ${clock(l.at)} **${l.who}** ${what(l)}: ${oneLine(l.text)}${l.took !== undefined ? ` _(${took(l.took)})_` : ''}${l.full && oneLine(l.full) !== oneLine(l.text) ? `\n  > ${oneLine(l.full)}` : ''}`),
    '',
  ].join('\n')
}
/** Where the logs and their summaries go, in the project. */
const LOG_DIR = '.claude/crew-logs'
const SUMMARY_SYSTEM = 'You write notes that a future Claude, working in the same project, reads to understand an earlier chat. Be concrete: file names, commands, decisions and their reasons. No preamble.'
const SUMMARY_ASK = 'Below is the activity log of one chat in this project: who did what and when, and what they were thinking. Summarise it in Markdown under these headings: Goal; What was done (files and commands); How and why (the key decisions and the reasoning behind them); Problems hit and how they were solved; Left open. Keep it under 400 words.'
const UPDATE_ASK =
  'Below is the summary of one chat in this project so far, then the lines of its activity log since that summary. Return the whole summary brought up to date with what the new lines add, in the same Markdown under the same headings: Goal; What was done (files and commands); How and why (the key decisions and the reasoning behind them); Problems hit and how they were solved; Left open. Keep it under 400 words.'
let saving = false
let lastSave:{ at: number; file: string; summary: boolean } | undefined
const slugOf = (s: string) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chat'
/** Saves this chat's log into the project, and a summary of it by a cheaper model (Haiku) beside it. */
const saveLog = async ($: EngineInterface, why: 'button' | 'task') => {
  if (saving) return
  if (!sessionDir) {
    if (why === 'button') void $.ui.toast("Couldn't save the log: this chat has no project folder.")
    return
  }
  saving = true
  void publishWeb($)
  try {
    await syncJournal($)
    const c = await readCrew?.()
    const lines = journalLines()
    if (!c || !lines.length) {
      if (why === 'button') void $.ui.toast('Nothing to save yet: the log is empty.')
      return
    }
    // One file per chat: the same name each time it is saved.
    const names = ((await $.store.get('logFiles').catch(() => undefined)) ?? {}) as Record<string, string>
    const key = journalSid || 'chat'
    const base = names[key] ?? `${localDay(lines[0].at)}-${slugOf(promptOf(lines.find(l => l.kind === 'you')?.text ?? 'chat'))}-${key.slice(0, 8)}`
    if (!names[key]) await $.store.set('logFiles', { ...names, [key]: base }).catch(() => undefined)
    const md = logMarkdown(lines, c)
    const dir = `${sessionDir}/${LOG_DIR}`
    await $.fs.write(`${dir}/${base}.md`, md)
    // The summary: written once from the whole log, then brought up to date with only the lines since
    // (and not asked for at all when nothing is new).
    const marks = ((await $.store.get('summarised').catch(() => undefined)) ?? {}) as Record<string, number>
    const upTo = marks[key] ?? 0
    const before = upTo ? String((await later$(() => $.fs.read(`${dir}/${base}.summary.md`)).catch(() => '')) ?? '').trim() : ''
    const fresh = before ? lines.filter(l => l.at > upTo) : lines
    const cap = (s: string) => (s.length > 150_000 ? `(earlier lines left out)\n${s.slice(-150_000)}` : s)
    const ask = before ? `${UPDATE_ASK}\n\n## The summary so far\n\n${before}\n\n## The log since\n\n${cap(logMarkdown(fresh, c))}` : `${SUMMARY_ASK}\n\n${cap(md)}`
    const r =
      before && !fresh.length
        ? { isAnswered: true, text: before }
        : ((await later$(() => $.model.complete({ model: 'haiku', system: SUMMARY_SYSTEM, prompt: ask, maxTokens: 1500, timeoutMs: 120_000 })).catch(() => undefined)) as { isAnswered?: boolean; text?: string } | undefined)
    const summary = r?.isAnswered && r.text ? r.text.trim() : ''
    if (summary && summary !== before) await $.fs.write(`${dir}/${base}.summary.md`, `${summary}\n`)
    if (summary) await $.store.set('summarised', Object.fromEntries(Object.entries({ ...marks, [key]: lines[lines.length - 1]?.at ?? 0 }).slice(-200))).catch(() => undefined)
    lastSave = { at: Date.now(), file: `${LOG_DIR}/${base}.md`, summary: !!summary }
    if (why === 'button') void $.ui.toast(`Log saved to ${LOG_DIR}/${base}.md${summary ? ', with a summary beside it' : " (the summary couldn't be written)"}`)
  } catch (err) {
    note(`save log: ${String(err).slice(0, 160)}`)
    if (why === 'button') void $.ui.toast(`Couldn't save the log: ${String(err).slice(0, 120)}`)
  } finally {
    saving = false
    void publishWeb($)
  }
}
/** The whole log as Markdown, to the page, which copies it or saves it as a file. */
const exportLog = async ($: EngineInterface, how: 'copy' | 'download') => {
  await syncJournal($)
  const c = await readCrew?.()
  if (!c) return
  const text = logMarkdown(journalLines(), c)
  // Copy: Claude's own clipboard first (the browser pane may not let a page write to it); the page shows the text if that fails.
  if (how === 'copy') {
    const r = (await later$(() => $.ui.copy({ text, surface: 'desktop' as never })).catch(() => undefined)) as { isCopied?: boolean } | undefined
    if (r?.isCopied) return $.ui.toast('Claude Crew: the whole log is copied as Markdown')
  }
  await webPost?.('export', JSON.stringify({ how, name: `claude-crew-log-${localDay(Date.now())}.md`, text }))
}
/** A log line opened on the page: all of it (a thought whole, an action and what came of it), from the log or the journal. */
const openLine = async (key: string) => {
  const c = await readCrew?.()
  const l = c?.log.find(x => logKey(x) === key) ?? journal.get(key) ?? nestedLines().find(x => logKey(x) === key)
  // An action's line already says what it was: below it, what came of it (an edit with its Open diff).
  const act = l?.path ? actId({ k: 'file', path: l.path, name: baseName(l.path), edits: true }) : ''
  await webPost?.('reply', JSON.stringify({ open: { key, text: l ? (l.kind !== 'think' && l.more) || fullOf(l) : '', act } }))
}
/** Load older on the page: the journal's lines before its oldest, a page at a time. */
const OLDER_PAGE = 200
const olderLines = async ($: EngineInterface, before: number) => {
  await syncJournal($)
  // This chat's journal and its nested chats', in time order.
  const all = [...journalLines(), ...nestedLines()].filter(l => l.at < before).sort((x, y) => x.at - y.at)
  await webPost?.('reply', JSON.stringify({ older: { before, lines: all.slice(-OLDER_PAGE).map(webLine), end: all.length <= OLDER_PAGE } }))
}
/** Tells new chats in the project that earlier chats left logs and summaries, so Claude reads them when useful. */
let logsNote = ''
const findLogs = async ($: EngineInterface) => {
  logsNote = ''
  if (!sessionDir) return
  const found = ((await later$(() => $.fs.list(`${sessionDir}/${LOG_DIR}`)).catch(() => [])) ?? []) as { name: string; mtimeMs?: number }[]
  const sums = found.filter(f => f.name.endsWith('.summary.md')).sort((x, y) => (y.mtimeMs ?? 0) - (x.mtimeMs ?? 0))
  if (sums.length)
    logsNote = `Earlier chats in this project saved Claude Crew logs in ${LOG_DIR}/ (${sums.length} summar${sums.length === 1 ? 'y' : 'ies'}; newest: ${sums
      .slice(0, 3)
      .map(f => f.name)
      .join(', ')}). When you need to know what was done before in this project, how, or why, read the relevant *.summary.md, and its .md log for the detail.`
}

/** Starts this chat's website (a small Node server beside the mod) and answers what is pressed on it. */
/**
 * The website runs only once it is wanted: on the first /crew, or at session start for a chat that had
 * one before Claude restarted (so its browser pane finds it again). A chat nobody opens keeps no server.
 */
let webState: 'off' | 'checking' | 'starting' | 'on' = 'off'
/** It could not start at all (no Node): the pane then draws the whole view itself. */
let webFailed = false
const startWeb = ($: EngineInterface, onlyIfKept = false) => {
  if (webState !== 'off') return
  // At session start it only looks for a saved address first; "Starting…" shows once it starts.
  webState = onlyIfKept ? 'checking' : 'starting'
  void later$(() => $.ui.invalidate('ui.render')).catch(() => undefined)
  void (async () => {
    try {
      // The address this chat's website had last time (kept per chat in the store), so after Claude
      // reopens, the chat's browser pane finds its website where it was.
      const sid = await Promise.resolve()
        .then(() => $.session.id())
        .catch(() => '')
      const kept = ((await $.store.get('webAddress').catch(() => undefined)) ?? {}) as Record<string, { port: number; token: string; at: number }>
      const was = sid ? kept[sid] : undefined
      if (onlyIfKept && !was) {
        webState = 'off'
        return
      }
      webState = 'starting'
      void later$(() => $.ui.invalidate('ui.render')).catch(() => undefined)
      const server = $.process.spawn({ argv: ['node', `${$.plugin.root}/web/server.mjs`, ...(was ? [String(was.port), was.token] : [])] })
      let buf = ''
      for await (const piece of server as AsyncIterable<{ text: string }>) {
        buf += piece.text
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line.startsWith('READY ')) {
            const [port, token] = line.slice(6).split(' ')
            const base = `http://127.0.0.1:${port}/${token}`
            webUrl = `${base}/`
            webState = 'on'
            webFailed = false
            if (sid) {
              const keep = Object.entries({ ...kept, [sid]: { port: Number(port), token, at: Date.now() } })
                .sort((x, y) => y[1].at - x[1].at)
                .slice(0, 40)
              void $.store.set('webAddress', Object.fromEntries(keep)).catch(() => undefined)
            }
            webPost = (path, body = '') => $.http.fetch(`${base}/${path}`, { method: 'POST', body }).catch(() => undefined)
            $.ui.invalidate('ui.render')
          } else if (line.startsWith('WATCH ')) {
            webWatchers = Number(line.slice(6)) || 0
            webSent = ''
            void publishWeb($)
          } else if (line.startsWith('ACT ')) {
            let msg: { id?: unknown; search?: unknown; next?: unknown; open?: unknown; older?: unknown; set?: { budget?: unknown; editor?: unknown } } = {}
            try {
              msg = JSON.parse(line.slice(4))
            } catch {}
            const act = typeof msg.id === 'string' ? webActs.get(msg.id) : undefined
            if (act) await doAction($, act, undefined)
            else if (typeof msg.search === 'string') await searchFor($, msg.search.slice(0, 200), msg.next === true)
            // The page's own asks (a line opened, older lines): answered with a reply, the view is unchanged.
            else if (typeof msg.open === 'string') {
              await openLine(msg.open)
              continue
            } else if (typeof msg.older === 'number') {
              await olderLines($, msg.older)
              continue
            }
            else if (msg.set && typeof msg.set === 'object') {
              // Settings' budget box and editor list: only values the pane's own choices could set.
              const { budget, editor } = msg.set
              if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 0 && budget <= 100_000) await doAction($, { k: 'set', budget: Math.round(budget * 100) / 100 }, undefined)
              if (editor === 'code' || editor === 'cursor' || editor === 'system') await doAction($, { k: 'set', editor }, undefined)
            }
            void publishWeb($)
          }
        }
      }
    } catch (err) {
      note(`web server: ${String(err).slice(0, 160)}`)
    }
    const was = webUrl
    webUrl = ''
    webState = 'off'
    if (!was) webFailed = true
    webPost = undefined
    webWatchers = 0
    $.ui.invalidate('ui.render')
    if (!was) void Promise.resolve().then(() => $.ui.open({ id: PANE, title: 'Claude Crew' })).catch(() => undefined)
  })()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    write = fn => {
      const p = writeQueue.then(() => update($, crew, fn))
      writeQueue = p.then(
        () => undefined,
        () => undefined,
      )
      return p
    }
    readCrew = () => read($, crew)
    after = (ms, fn) => {
      $.clock.after(ms, fn)
    }
    every = (ms, fn) => $.clock.every(ms, fn)
    readFile = p => $.fs.read(p) as Promise<string>
    exists = p => $.fs.exists(p)
    demo?.cancel()
    demo = undefined

    await $.command.register({ name: 'crew', description: "Open this chat's Claude Crew website in the browser pane" })
    await update($, crew, c => {
      // A reload drops in-flight calls and the demo; migrate older state shapes too.
      const old: Partial<Crew> = Array.isArray(c?.agents) ? c : {}
      const base: Crew = { agents: [], nodes: {}, trails: [], log: [], calls: 0, startedAt: 0, changes: {}, zoom: 1, showFiles: false, demoCodex: [], editor: 'code', tests: [], problems: [], timeline: [], budget: 0, budgetWarned: 0, turnBase: { at: 0, goal: '', changes: {}, tokens: 0, cost: 0, tests: 0, failed: 0, codex: 0 }, summary: null, ...old, spent: old.spent ?? { tokens: 0, cost: 0 } }
      const agents = base.agents
        .filter(a => !a.id.startsWith('demo-'))
        .map(a => ({ from: '', movedAt: 0, tokens: 0, cost: 0, stuck: '', recent: [], since: 0, ...a }))
        .map(a => (a.state === 'busy' ? { ...a, state: 'thinking' as const, pending: [] } : a))
      return {
        ...base,
        logView: undefined,
        changes: Object.fromEntries(Object.entries(base.changes).filter(([p]) => !p.startsWith('demo/'))),
        demoCodex: [],
        // A reload loses the calls that were waiting on tests; a background run may still be going but can't be followed.
        tests: (base.tests ?? [])
          .filter(t => !t.agentId.startsWith('demo-'))
          .map(t => (t.status === 'running' ? { ...t, status: 'unknown' as const, endedAt: Date.now() } : t)),
        shells: (base.shells ?? []).filter(x => !x.agentId.startsWith('demo-') && x.status === 'running' && x.background && x.shellId),
        timeline: (base.timeline ?? []).filter(f => !f.agentId.startsWith('demo-')),
        problems: (base.problems ?? []).filter(p => !p.path.startsWith('demo/')),
        spent: base.spent ?? { tokens: agents.reduce((n, a) => n + (a.tokens ?? 0), 0), cost: agents.reduce((n, a) => n + (a.cost ?? 0), 0) },
        startedAt: base.startedAt || Date.now(),
        agents: agents.some(a => a.id === 'main') ? agents : [MAIN(), ...agents],
        // Older versions took `import … from '../types'` for a file called `types`: drop those ghosts.
        nodes: Object.fromEntries(
          Object.entries(base.nodes)
            .filter(([id, n]) => !n.demo && !(n.kind === 'ghost' && !/\.[A-Za-z]\w*$/.test(baseName(id))))
            .map(([id, n]) => [id, { ...n, imports: n.imports.filter(t => /\.[A-Za-z]\w*$/.test(baseName(t))) }]),
        ),
        trails: base.trails.filter(t => !t.a.startsWith('demo/') && !t.b.startsWith('demo/')),
      }
    })
    // The editor choice lives in the store, so it survives across sessions.
    const saved = await $.store.get('editor').catch(() => undefined)
    if (typeof saved === 'string' && saved) await update($, crew, c => ({ ...c, editor: saved }))
    const budget = await $.store.get('budget').catch(() => undefined)
    if (typeof budget === 'number' && budget > 0) await update($, crew, c => ({ ...c, budget }))
    sessionDir = norm(await $.session.cwd().catch(() => ''))
    // While a test runs, tick once a second so its timer counts up; give up on background runs nobody reads after 30 minutes.
    ticker?.cancel()
    ticker = $.clock.every(1000, () => {
      void (async () => {
        if (diagDirty) {
          diagDirty = false
          await $.store.set('diag', { version: VERSION, at: new Date().toISOString(), cwd: sessionDir, events: diag }).catch(() => undefined)
        }
        const c = await read($, crew)
        const running = (c.tests ?? []).filter(t => t.status === 'running')
        const shellsOn = (c.shells ?? []).filter(x => x.status === 'running')
        // A Claude at work or thinking has clocks on its desk, its window and the log that count each second.
        const atWork = c.agents.some(a => a.state === 'busy' || a.state === 'thinking')
        if (!running.length && !shellsOn.length && !atWork) return
        await update($, tick, n => n + 1)
        const now = Date.now()
        if (shellsOn.some(x => now - x.startedAt > SHELL_GIVE_UP_MS))
          await write?.(d => ({ ...d, shells: (d.shells ?? []).map(x => (x.status === 'running' && now - x.startedAt > SHELL_GIVE_UP_MS ? { ...x, status: 'unknown' as const, endedAt: now } : x)) }))
        if (running.some(t => now - t.startedAt > 30 * 60_000))
          await write?.(d => ({
            ...d,
            tests: d.tests.map(t => (t.status === 'running' && now - t.startedAt > 30 * 60_000 ? { ...t, status: 'unknown' as const, endedAt: now } : t)),
          }))
      })()
    })
    // The chats started from this one: read from the app's own list every 15 seconds, only while the
    // session lets that read run without asking anyone. Where it doesn't (auto mode, the terminal), it
    // keeps checking, and the chats are only as new as Claude's own last look (the cards say so).
    refreshChats = async () => {
      if (pollingChats) return
      pollingChats = true
      try {
        const may = await Promise.resolve()
          .then(() => $.tool.check({ tool: LIST_TOOL, input: { linked: true } }))
          .catch(() => undefined)
        const live = may?.decision === 'allow'
        const r = live
          ? ((await Promise.resolve()
              .then(() => $.tool.call({ tool: LIST_TOOL, linked: true, limit: 50 } as never))
              .catch(() => undefined)) as { text?: string; isError?: boolean } | undefined)
          : undefined
        const chats = r && !r.isError && typeof r.text === 'string' ? chatsOf(r.text) : undefined
        if (chats) chatsReadAt = Date.now()
        await write?.(d => {
          // Live: written only when a chat changed (its `seen` matters only once the reads stop).
          const bare = (x: Chat[]) => JSON.stringify(x.map(({ seen, ...rest }) => rest))
          if (chats) return d.chatsLive && bare(d.chats ?? []) === bare(chats) ? d : { ...d, chats, chatsLive: true }
          return d.chatsLive === false ? d : { ...d, chatsLive: false, chats: (d.chats ?? []).map(x => ({ ...x, seen: Math.max(x.seen ?? 0, chatsReadAt) })) }
        })
      } finally {
        pollingChats = false
      }
    }
    chatPoller?.cancel()
    chatPoller = $.clock.every(15_000, () => void refreshChats?.())
    void refreshChats()
    deskMax = 0
    deskLowSince = 0
    void readChatCost($)
    const savedTheme = await $.store.get('theme').catch(() => undefined)
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto') await write?.(d => (d.theme === savedTheme ? d : { ...d, theme: savedTheme }))
    // This chat's website: back at once only if it had one before (else on its first /crew), and sent
    // the view while anyone has it open. The pane opens by itself only when the website can't start.
    if (!webUrl) startWeb($, true)
    void openJournal($).then(() => pruneOld($))
    journalTimer?.cancel()
    journalTimer = $.clock.every(3000, () => void syncJournal($))
    nestedTimer?.cancel()
    nestedTimer = $.clock.every(4000, () => void readNested($))
    if ((await $.store.get('autoSave').catch(() => undefined)) === true) await write?.(d => ({ ...d, autoSave: true }))
    void findLogs($)
    webTimer?.cancel()
    webTimer = $.clock.every(800, () => void publishWeb($))

    return next(e)
  })

  // /crew: Claude opens this chat's website in the browser pane (a mod can't open the pane itself), asked
  // once the command has finished, when the chat can take a prompt; the link stays in case it doesn't.
  // Without the website, the pane opens as before.
  // New chats in a project with saved logs: one line telling Claude where they are.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return logsNote ? { ...r, sections: [...r.sections, { id: 'crew-map:logs', text: logsNote, scope: 'session' as const }] } : r
  })

  on('command.run', { command: 'crew' }, async $ => {
    // The website starts now if it isn't running (half a second or so), once a session start's look for
    // a saved address is done.
    const settle = async () => {
      for (let i = 0; i < 50 && !webUrl && (webState === 'starting' || webState === 'checking'); i++) await new Promise<void>(r => void $.clock.after(100, () => r()))
    }
    await settle()
    if (!webUrl) startWeb($)
    await settle()
    if (webUrl) {
      const url = webUrl
      $.clock.after(400, () =>
        void $.prompt
          .submit({ text: `${OPEN_ASK} and show me that pane: call preview_start with the url ${url}, then mcp__ccd_view__show_pane for the browser pane.`, asUser: true })
          .then(
            r => $.store.set('crewOpen', { at: new Date().toISOString(), result: JSON.stringify(r ?? null).slice(0, 300) }),
            err => $.store.set('crewOpen', { at: new Date().toISOString(), error: String(err).slice(0, 300) }),
          )
          .catch(() => undefined),
      )
      return { text: `Claude Crew for this chat: ${url} (opening it beside the chat; click it if it doesn't open)` }
    }
    await $.ui.open({ id: PANE, title: 'Claude Crew' })
    return { text: 'Claude Crew pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    const id = agentOf(e)
    // The app reporting in (a background task, a monitor, CI): logged, but the goal stays the user's.
    const note = e.text ? systemNote(e.text) : ''
    if (note) noticeTurn.add(id)
    else noticeTurn.delete(id)
    if (note) {
      const taskId = e.text?.match(/<task-id>\s*([\w-]+)\s*<\/task-id>/)?.[1] ?? ''
      const status = e.text?.match(/<status>\s*(\w+)\s*<\/status>/)?.[1]?.toLowerCase() ?? ''
      if (taskId && /^(completed|failed|killed|stopped)$/.test(status))
        await write?.(c => endShell(c, taskId, status === 'completed' ? 'done' : status === 'failed' ? 'failed' : 'stopped', Date.now()))
      await write?.(c => log(upsert(c, id, a => ({ ...a, state: a.state === 'busy' ? 'busy' : 'thinking' })), id, 'info', `↻ ${note}`))
      return next(e)
    }
    if (id === 'main' && e.text) codexCount = await codexRunCount($)
    await write?.(c => {
      const d = upsert(c, id, a => ({
        ...a,
        state: a.state === 'busy' ? 'busy' : 'thinking',
        ...(id === 'main' && e.text
          ? { goal: trunc(oneLine(promptOf(e.text)), 500), progress: -1, progressSrc: 'est' as const, todosDone: 0, todosTotal: 0, todosDoing: 0, doing: '', calls: 0, since: Date.now(), thoughts: [], actions: [], stuck: '', recent: [] }
          : {}),
      }))
      if (id === 'main' && e.text) {
        if (d.tasks) d.tasks = Object.fromEntries(Object.entries(d.tasks).map(([k, t]) => [k, t.status === 'completed' ? { ...t, old: true } : t]))
        // What the task's summary is measured against.
        d.turnBase = {
          at: Date.now(),
          goal: trunc(oneLine(promptOf(e.text)), 500),
          changes: Object.fromEntries(Object.entries(d.changes).filter(([, ch]) => ch.edits).map(([p, ch]) => [p, { added: ch.added, removed: ch.removed }])),
          tokens: d.spent?.tokens ?? 0,
          cost: d.spent?.cost ?? 0,
          tests: 0,
          failed: 0,
          codex: codexCount,
        }
        d.summary = null
      }
      if (id !== 'main' || !e.text) return d
      const relayed = relayedOf(e.text)
      const line: LogLine = relayed
        ? { at: Date.now(), who: relayed.from, hue: 0, kind: 'msg', text: trunc(relayed.body, 2000) }
        : { at: Date.now(), who: 'You', hue: 0, kind: 'you', text: trunc(oneLine(e.text), 2000) }
      return { ...d, log: [...d.log, line].slice(-LOG_KEEP) }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = agentOf(e)
    void readChatCost($)
    if (id === 'main' && e.reason === 'answer')
      $.clock.after(2000, () => void (async () => ((await readCrew?.())?.autoSave ? saveLog($, 'task') : undefined))())
    if (id === 'main') codexCount = await codexRunCount($)
    let budgetNote = ''
    let summary: Summary | undefined
    await write?.(c => {
      budgetNote = ''
      summary = undefined
      const u = e.usage as Usage | undefined
      const d = upsert(c, id, a => ({
        ...a,
        state: id === 'main' ? 'idle' : 'done',
        pending: [],
        needs: undefined,
        doneAt: Date.now(),
        doing: '',
        tokens: (a.tokens ?? 0) + (u ? tokensOf(u) : 0),
        cost: (a.cost ?? 0) + (u ? costOf(u) : 0),
        ...(e.reason === 'answer' ? { progress: 100, progressSrc: 'done' as const } : {}),
      }))
      let f = log(d, id, 'info', e.reason === 'answer' ? 'finished' : `stopped (${e.reason})`)
      if (u && !id.startsWith('demo-')) f = { ...f, spent: { tokens: (f.spent?.tokens ?? 0) + tokensOf(u), cost: (f.spent?.cost ?? 0) + costOf(u) } }
      // Spending: said once each as it passes half, 80% and all of the budget.
      const spent = f.spent?.cost ?? 0
      if (f.budget > 0) {
        const share = [1, 0.8, 0.5].find(s => spent >= f.budget * s) ?? 0
        if (share > (f.budgetWarned ?? 0)) {
          budgetNote =
            share >= 1
              ? `💸 Over budget: about ${fmtUsd(spent)} spent of your ${fmtUsd(f.budget)}`
              : `💸 ${Math.round(share * 100)}% of your ${fmtUsd(f.budget)} budget used (about ${fmtUsd(spent)})`
          f = log({ ...f, budgetWarned: share }, 'main', 'info', budgetNote)
        }
      }
      // A turn a background task started does not end the user's task: no summary, no "done" toast.
      if (id === 'main' && e.reason === 'answer' && !noticeTurn.has(id) && f.turnBase?.at && f.agents.find(a => a.id === 'main')?.calls) {
        summary = summarise1(f, Date.now(), codexCount)
        f = { ...f, summary }
      }
      return f
    })
    if (budgetNote) void $.ui.toast(budgetNote)
    if (summary) {
      const s = summary
      void $.ui.toast(`✓ Done in ${elapsed(s.ms)}: ${s.files.length} file${s.files.length === 1 ? '' : 's'} changed${s.tests.runs ? `, tests ${s.tests.last.split(' ')[0]}` : ''}, ≈ ${fmtUsd(s.cost)}`)
    }
    return r
  })

  // Waiting on the person: a permission prompt is shown (the classic PermissionRequest is raised only
  // when one is), or a tool that asks (a question, a plan). It ends with that tool's call, a denial,
  // or the turn. A hook beneath that decides at once (allow or deny) means no prompt was shown.
  const setNeeds = (id: string, what: string, rawTool: string) => {
    const tool = typeof rawTool === 'string' ? rawTool.slice(0, 80) : ''
    return write?.(c => log(upsert(c, id, a => ({ ...a, needs: { what, tool, at: Date.now() } })), id, 'info', `⏸ needs you: ${what}`))
  }
  const clearNeeds = (id: string, rawTool?: string) => {
    const tool = typeof rawTool === 'string' ? rawTool.slice(0, 80) : undefined
    return write?.(c => (c.agents.some(a => a.id === id && a.needs && (!tool || a.needs.tool === tool)) ? upsert(c, id, a => ({ ...a, needs: undefined })) : c))
  }
  on('classic.PermissionRequest', async ($, e, next) => {
    const id = e.agent_id ?? 'main'
    await setNeeds(id, needsText(e.tool_name, e.tool_input), e.tool_name)
    const r = await next(e)
    if ((r as { decision?: unknown } | undefined)?.decision) await clearNeeds(id, e.tool_name)
    return r
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    await clearNeeds((e as { agent_id?: string }).agent_id ?? 'main')
    return next(e)
  })
  // A question or a plan to approve: the Claude waits on the person until the call returns.
  const asking = async (e: { agentId?: string; tool: string }, run: () => Promise<unknown>) => {
    const id = e.agentId ?? 'main'
    await setNeeds(id, ASKS[e.tool], e.tool)
    try {
      return await run()
    } finally {
      await clearNeeds(id, e.tool)
    }
  }
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => (await asking(e, () => next(e))) as Awaited<ReturnType<typeof next>>)
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => (await asking(e, () => next(e))) as Awaited<ReturnType<typeof next>>)
  // Each model request: how much of its context window the Claude is using now.
  on('classic.PreToolUse', async ($, e, next) => {
    const t0 = Date.now()
    const decided = await next(e)
    const r = decided as { deny?: unknown; ask?: unknown } | undefined
    const kind = r?.deny !== undefined ? 'hookBlock' : r?.ask !== undefined || Date.now() - t0 >= 400 ? 'hook' : ''
    if (kind) {
      const id = agentOf(e)
      void write?.(c => (c.agents.some(a => a.id === id) ? upsert(c, id, a => ({ ...a, kinds: [kind, ...(a.kinds ?? [])].slice(0, 8) })) : c))
    }
    return decided
  })
  on('turn.step', async function* ($, e, next) {
    // When this model step began, kept here (no write per step): how long "thinking" has run.
    stepStart.set(e.agentId ?? 'main', Date.now())
    if (e.model) agentModel.set(e.agentId ?? 'main', e.model)
    const r = yield* next(e)
    const u = (r as { usage?: Usage | null } | undefined)?.usage
    if (u && fin(u.input_tokens) + fin(u.cache_read_input_tokens) + fin(u.cache_creation_input_tokens) > 0) {
      const id = e.agentId ?? 'main'
      if (id === 'main') mainModel = e.model
      const tokens = fin(u.input_tokens) + fin(u.cache_read_input_tokens) + fin(u.cache_creation_input_tokens) + fin(u.output_tokens)
      const window = windowOf(e.model)
      if (lastCtx.get(id) !== `${tokens}/${window}`) {
        lastCtx.set(id, `${tokens}/${window}`)
        void write?.(c => upsert(c, id, a => ({ ...a, ctx: { tokens, window, at: Date.now() } })))
      }
    }
    return r
  })
  // The engine's own measure of the main window: its true size.
  on('session.measure', async ($, e, next) => {
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
    if (ok(e.context?.window)) mainWindow = e.context.window
    if (ok(e.context?.window) && typeof e.context.tokens === 'number' && Number.isFinite(e.context.tokens) && e.context.tokens >= 0) {
      const tokens = e.context.tokens
      const window = e.context.window
      void write?.(c => upsert(c, 'main', a => ({ ...a, ctx: { tokens, window, at: Date.now() } })))
    }
    return next(e)
  })

  // Compaction: the conversation is being summarised to free up room. The
  // Claude shows "Compacting memory" until it is done, and the log says how
  // many messages went in and came out.
  on('session.compact', async ($, e, next) => {
    // Precompute only prepares a summary ahead of time; nothing is compacted.
    if ((e.trigger as string) === 'precompute') return next(e)
    const id = e.agentId ?? 'main'
    const before = e.messages?.length ?? 0
    let was: Agent['state'] = 'idle'
    await write?.(c => {
      const d = upsert(c, id, a => {
        was = a.state
        return { ...a, tool: COMPACT, detail: '', state: 'busy', pending: [...a.pending, COMPACT] }
      })
      return log(d, id, 'info', `🗜 compacting the conversation (${e.trigger}): ${before} message${before === 1 ? '' : 's'}`)
    })
    let out: unknown
    try {
      out = await next(e)
      return out as Awaited<ReturnType<typeof next>>
    } finally {
      const r = out as { messages?: unknown[]; skip?: string; usage?: Usage } | undefined
      const line = r?.skip ? `🗜 compaction skipped: ${r.skip}` : r?.messages ? `🗜 compacted: ${before} → ${r.messages.length} messages` : '🗜 compaction did not finish'
      await write?.(c => {
        const d = upsert(c, id, a => {
          const pending = a.pending.filter(p => p !== COMPACT)
          return { ...a, pending, state: pending.length ? 'busy' : was === 'busy' ? 'thinking' : was, tool: a.tool === COMPACT ? '' : a.tool, ...(r?.messages && !r.skip ? { compactions: (a.compactions ?? 0) + 1, ctx: undefined } : {}) }
        })
        // The summarising call costs tokens too; turns do not count them.
        const u = r?.usage
        const spent = u && !id.startsWith('demo-') ? { tokens: (d.spent?.tokens ?? 0) + tokensOf(u), cost: (d.spent?.cost ?? 0) + costOf(u) } : d.spent
        return log({ ...d, spent }, id, 'info', line)
      })
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const id = r.agentId
      const parent = agentOf(e)
      const spawnKind = typeof e.subagentType === 'string' && e.subagentType ? e.subagentType.slice(0, 60) : 'general-purpose'
      const spawnDesc = typeof e.description === 'string' ? e.description.slice(0, 200) : ''
      await write?.(c => {
        const from = c.agents.find(a => a.id === parent)?.node ?? ''
        const d = upsert(c, id, a => ({
          ...a,
          ...(a.kind === 'agent' ? { kind: spawnKind, name: freshName(c.agents.filter(x => x.id !== id), spawnKind) } : {}),
          spawnId: e.tool_use_id,
          parent,
          job: trunc(oneLine(spawnDesc || (typeof e.prompt === 'string' ? e.prompt.slice(0, 600) : '')), 400),
          goal: trunc(oneLine([spawnDesc, typeof e.prompt === 'string' ? e.prompt.slice(0, 3000) : ''].filter(Boolean).join(': ')), 1500),
          since: Date.now(),
          state: 'thinking',
          node: from,
        }))
        return log(d, id, 'info', `joined${spawnDesc ? ` · ${spawnDesc}` : ''}`)
      })
    }
    return r
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.door === 'response' && e.message?.role === 'assistant') {
      const blocks = (Array.isArray(e.message.content) ? e.message.content : []) as unknown as {
        type: string
        text?: string
        thinking?: string
      }[]
      // Its gist for the desk and the log, and all of it for the log line opened.
      const lines = blocks
        .map(b => (b.type === 'thinking' ? b.thinking : b.type === 'text' ? b.text : '') ?? '')
        .map(t => ({ line: summarise(t), full: cleanSaid(t) }))
        .filter(x => x.line)
        .slice(0, 2)
      if (lines.length) {
        const id = agentOf(e)
        await write?.(c => lines.reduce((d, x) => think(d, id, x.line, x.full), c))
      }
    }
    return r
  })

  // Claude's own look at the chat list keeps the nested chats current too; a chat it starts shows soon after.
  on('tool.call', { tool: LIST_TOOL }, async ($, e, next) => {
    const r = await next(e)
    const a = e as unknown as Record<string, unknown>
    if (!pollingChats && a.linked === true && !a.group && 'text' in r && typeof r.text === 'string' && !r.isError) {
      const chats = chatsOf(r.text)
      if (chats) await write?.(d => ({ ...d, chats }))
    }
    return r
  })
  // Claude working with the other chats (starting one, messaging it, reading it, changing it): the list
  // is read again soon after, and a chat Claude read itself takes what it saw.
  on('tool.call', { tool: /^(SendMessage|mcp__ccd_session(_mgmt)?__\w+)$/ }, async ($, e, next) => {
    if (typeof e.tool !== 'string' || pollingChats || e.tool === LIST_TOOL) return next(e)
    const r = await next(e)
    after?.(1500, () => void refreshChats?.())
    const text = 'text' in r && typeof r.text === 'string' && !r.isError ? r.text : ''
    if (e.tool.endsWith('__get_session') && text) {
      let s: Record<string, unknown> = {}
      try {
        s = JSON.parse(text)
      } catch {}
      const id = typeof s.sessionId === 'string' ? s.sessionId : ''
      if (id)
        await write?.(d =>
          d.chats?.some(x => x.id === id)
            ? { ...d, chats: d.chats.map(x => (x.id === id ? { ...x, running: s.isRunning === true, at: Date.parse(String(s.lastActivityAt ?? '')) || x.at, seen: Date.now() } : x)) }
            : d,
        )
    }
    return r
  })
  on('tool.call', async ($, e, next) => {
    // A call without a tool name is none of the pane's business, nor the pane's own read of the chat list.
    if (typeof e.tool !== 'string' || !e.tool || (pollingChats && e.tool === LIST_TOOL)) return next(e)
    const a = e as unknown as Record<string, unknown>
    const id = e.agentId ?? 'main'
    const node = nodeOf(e.tool, a)
    const detail = detailOf(e.tool, a).slice(0, 300)
    const callId = e.tool_use_id ?? `call-${Date.now()}-${Math.random()}`
    const started = Date.now()
    const line = trunc(actionLine(e.tool, node, detail, typeof a.description === 'string' ? a.description : ''), 200)

    // Todo lists are the agent's own word on how far along it is: TodoWrite's, or the desktop app's task list.
    const todos = Array.isArray(a.todos) ? (a.todos.filter(t => t && typeof t === 'object') as { status?: string; content?: string; activeForm?: string }[]) : undefined
    const plans = e.tool === PLAN_TOOL

    // Lines this call adds and removes, known before it runs (a Write's from the file it replaces).
    const str = (k: string, o: Record<string, unknown> = a) => (typeof o[k] === 'string' ? (o[k] as string) : '')
    let delta: { added: number; removed: number } | 'read' | undefined
    if (e.tool === 'Edit') delta = lineDiff(str('old_string'), str('new_string'))
    else if (e.tool === 'MultiEdit' && Array.isArray(a.edits))
      delta = (a.edits.filter(ed => ed && typeof ed === 'object') as Record<string, unknown>[]).reduce<{ added: number; removed: number }>(
        (s, ed) => {
          const d = lineDiff(str('old_string', ed), str('new_string', ed))
          return { added: s.added + d.added, removed: s.removed + d.removed }
        },
        { added: 0, removed: 0 },
      )
    else if (e.tool === 'Write') delta = lineDiff(readFile ? await readFile(node).catch(() => '') : '', str('content'))
    else if (e.tool === 'NotebookEdit') delta = lineDiff('', str('new_source'))
    else if (e.tool === 'Read') delta = 'read'

    // Two Claudes editing one file within a minute can trample each other: say so.
    if (typeof delta === 'object' && node && readCrew) {
      const before = await readCrew()
      const last = before.changes?.[node]
      const me = before.agents.find(x => x.id === id)?.name ?? (id === 'main' ? 'Claude' : 'a helper')
      if (last && last.edits && last.by && last.by !== me && Date.now() - last.at < 60_000)
        void $.ui.toast(`⚠ ${me} and ${last.by} are both editing ${baseName(node)}`)
    }

    // A test run: shown as running until its output comes back (or, in the background, until it is read).
    const shell = e.tool === 'Bash' || e.tool === 'PowerShell'
    const testCmd = shell ? tidyCmd(str('command')).slice(0, 300) : ''
    const testId = testCmd && isTestCmd(str('command')) ? `test-${callId}` : ''
    const background = a.run_in_background === true
    // Reading a background shell's output can settle the test it was running.
    const outputOf = /^(BashOutput|TaskOutput|KillShell|KillBash|TaskStop)$/.test(e.tool) ? String(a.bash_id ?? a.shell_id ?? a.task_id ?? a.id ?? '') : ''

    let fresh = false
    await write?.(c => {
      const prev = c.agents.find(x => x.id === id)?.node ?? ''
      fresh = !!node && !c.nodes[node]?.scanned
      let d = touch(c, node, prev)
      if (testId) {
        const who = d.agents.find(x => x.id === id)
        const run: TestRun = {
          id: testId,
          agentId: id,
          who: who?.name ?? 'Claude',
          hue: who?.hue ?? 0,
          command: testLabel(testCmd),
          purpose: trunc(testPurpose(str('command'), str('description')), 90),
          startedAt: Date.now(),
          endedAt: 0,
          status: 'running',
          passed: 0,
          failed: 0,
          background,
        }
        const kept = (d.tests ?? []).filter(t => t.status === 'running' || Date.now() - t.endedAt < TEST_SHOW_MS)
        // Running ones are kept before finished ones, but never more than 11: a pile of background runs nobody reads drops its oldest.
        const running = kept.filter(t => t.status === 'running').slice(-11)
        // (Counting from the front: slice(-0) would keep them all.)
        const finished = kept.filter(t => t.status !== 'running')
        const recent = finished.slice(Math.max(0, finished.length - (11 - running.length)))
        d = { ...d, tests: [...recent, ...running, run], turnBase: { ...d.turnBase, tests: (d.turnBase?.tests ?? 0) + 1 } }
        d = log(d, id, 'info', `⚗ tests started${background ? ' in the background' : ''} · ${trunc(run.purpose || testPurpose(run.command, ''), 70)}`)
      } else if (shell) {
        const who = d.agents.find(x => x.id === id)
        const sh: ShellRun = { id: `sh-${callId}`, agentId: id, who: who?.name ?? 'Claude', hue: who?.hue ?? 0, label: trunc(oneLine(str('description')).replace(/\.$/, '') || cmdGist(str('command')), 90), startedAt: Date.now(), endedAt: 0, status: 'running', background }
        // Running ones stay (the newest 12); finished ones are kept a little for their log line, then go.
        const kept = (d.shells ?? []).filter(x => x.status === 'running' || Date.now() - x.endedAt < 60_000)
        d = { ...d, shells: [...kept.filter(x => x.status !== 'running').slice(-8), ...kept.filter(x => x.status === 'running').slice(-11), sh] }
      }
      d = upsert(d, id, x => {
        let upd: Agent = {
          ...x,
          ...(node && node !== x.node ? { from: x.node, movedAt: Date.now() } : {}),
          node: node || x.node,
          visited: node ? [node, ...x.visited.filter(v => v !== node)].slice(0, 8) : x.visited,
          tool: e.tool,
          detail,
          pending: [...x.pending, callId],
          state: 'busy',
          calls: x.calls + 1,
          actions: [line, ...x.actions].slice(0, 5),
          kinds: [kindOf(e.tool), ...(x.kinds ?? [])].slice(0, 8),
        }
        const list = plans ? planAfter(x.plan ?? [], a) : todos
        if (list) {
          const doing = list.find(t => t.status === 'in_progress') as { content?: string; activeForm?: string } | undefined
          upd = {
            ...upd,
            ...(plans ? { plan: list as Agent['plan'] } : {}),
            todosTotal: list.length,
            todosDone: list.filter(t => t.status === 'completed').length,
            todosDoing: list.filter(t => t.status === 'in_progress').length,
            doing: doing?.activeForm ?? doing?.content ?? '',
          }
        }
        return upd
      })
      // One step on the replay's timeline.
      if (node || e.tool === 'Agent' || e.tool === 'Task') {
        const who = d.agents.find(x => x.id === id)
        const frame: Frame = {
          at: Date.now(),
          agentId: id,
          name: who?.name ?? 'Claude',
          hue: who?.hue ?? 0,
          node: node || who?.node || '',
          tool: e.tool,
          detail: detail.slice(0, 80),
          added: typeof delta === 'object' ? delta.added : 0,
          removed: typeof delta === 'object' ? delta.removed : 0,
        }
        d = { ...d, timeline: [...(d.timeline ?? []), frame].slice(-MAX_FRAMES) }
      }
      const logged = log({ ...d, calls: d.calls + 1 }, id, 'act', line)
      const last = logged.log[logged.log.length - 1]
      // An edit keeps its file (for Open diff); a command shows what it runs while it runs.
      const extra = { call: callId, ...(typeof delta === 'object' && node ? { path: node } : {}), ...(shell ? { more: `$ ${trunc(oneLine(str('command')), 300)}` } : {}) }
      return last && last !== d.log[d.log.length - 1] ? { ...logged, log: [...logged.log.slice(0, -1), { ...last, ...extra }] } : logged
    })
    if (fresh && CODE_EXT.test(node)) scan(node)

    let ran: unknown
    try {
      const result = await next(e)
      ran = result
      return result
    } finally {
      const stamp = Date.now()
      const ok = !!ran && !(ran as { isError?: boolean }).isError && !(ran as { deny?: string }).deny
      const out = resultText(ran)
      // What came of it, for its line opened: a command's last lines and how it ended, an error, an
      // edit's file (+added −removed) and the lines it changed.
      const more = trunc(
        (() => {
          if (shell) {
            const code = out.match(/exit(?: code)?:?\s*(-?\d+)/i)?.[1]
            const n = testCounts(out)
            const end =
              background && ok
                ? 'started in the background'
                : [ok ? '✓ Exit 0' : code ? `✕ Exit ${code}` : '✕ Failed', n ? [n.failed ? `${n.failed} failed` : '', `${n.passed} passed`].filter(Boolean).join(', ') : '', took(stamp - started)].filter(Boolean).join(' · ')
            return [`$ ${trunc(oneLine(str('command')), 300)}`, background && ok ? '' : tailOf(out), end].filter(Boolean).join('\n')
          }
          if (!ok) return tailOf(out) || (ran as { deny?: string } | undefined)?.deny || "It didn't run."
          const head = typeof delta === 'object' && node ? `${relPath(node)} +${delta.added} −${delta.removed}\n` : ''
          if (e.tool === 'Edit') return head + editDiff(str('old_string'), str('new_string'))
          if (e.tool === 'Write') return head + editDiff('', str('content'), 12)
          if (e.tool === 'NotebookEdit') return head + editDiff('', str('new_source'), 12)
          return ''
        })(),
        MORE_MAX,
      )
      let settled: TestRun[] = []
      let stuckNote = ''
      let problemNote = ''
      await write?.(c => {
        settled = []
        stuckNote = ''
        problemNote = ''
        let d = ok && delta && node && !isSpecial(node) ? record(c, node, id, delta) : c
        // How long the call took, on its line in the log.
        const finished = (l: LogLine): LogLine => ({ ...l, took: Math.max(0, stamp - l.at), ...(more ? { more } : {}), ...(ok ? {} : { bad: true as const }) })
        if (d.log.some(l => l.call === callId && l.took === undefined)) d = { ...d, log: d.log.map(l => (l.call === callId && l.took === undefined ? finished(l) : l)) }
        else {
          // A long call whose line has left the pane's log: its line in the journal finishes instead.
          const kept = [...journal.values()].find(l => l.call === callId && l.took === undefined)
          if (kept) addToJournal(finished(kept))
        }
        if (ok && /^Task(Create|Update|List|Get)$/.test(e.tool)) d = applyTaskCall(d, e.tool, a, ran, out, id)
        // The call is over: a permission it waited on is settled.
        if (d.agents.some(x => x.id === id && x.needs?.tool === e.tool.slice(0, 80))) d = upsert(d, id, x => ({ ...x, needs: undefined }))
        if (testId) {
          // In the background the call returns at once with a shell id; the test runs on.
          const shellId = out.match(/\bID:\s*([\w-]+)/i)?.[1] ?? out.match(/\b(bash_\w+|shell_\w+)\b/)?.[1] ?? ''
          if (background && ok) d = { ...d, tests: d.tests.map(t => (t.id === testId ? { ...t, shellId } : t)) }
          else if (!ok && !out.trim()) d = { ...d, tests: d.tests.map(t => (t.id === testId ? { ...t, status: 'unknown' as const, endedAt: stamp } : t)) }
          else d = settleTest(d, testId, out, !ok, stamp)
        }
        if (shell && !testId) {
          const shId = `sh-${callId}`
          const shellId = out.match(/\bID:\s*([\w-]+)/i)?.[1] ?? out.match(/\b(bash_\w+|shell_\w+)\b/)?.[1] ?? ''
          d = {
            ...d,
            shells: (d.shells ?? []).map(x =>
              x.id !== shId ? x : background && ok && shellId ? { ...x, shellId } : { ...x, status: ok ? ('done' as const) : ('failed' as const), endedAt: stamp },
            ),
          }
        }
        if (outputOf) {
          if (/^(Kill|TaskStop)/.test(e.tool)) d = endShell(d, outputOf, 'stopped', stamp)
          else if (/status>\s*(completed|failed|killed)|<exit_code>|\bexit code\b|status:\s*(completed|failed|killed)/i.test(out))
            d = endShell(d, outputOf, /exit_code>\s*[1-9]|exit code:?\s*[1-9]|status>\s*failed|status:\s*failed/i.test(out) ? 'failed' : /killed/i.test(out) ? 'stopped' : 'done', stamp)
          const t = (d.tests ?? []).find(x => x.status === 'running' && x.background && x.shellId && x.shellId === outputOf)
          const killed = /^(Kill|TaskStop)/.test(e.tool)
          const finished = /status>\s*(completed|failed|killed)|<exit_code>|\bexit code\b|status:\s*(completed|failed|killed)/i.test(out)
          if (t && killed) d = log({ ...d, tests: d.tests.map(x => (x.id === t.id ? { ...x, status: 'unknown' as const, endedAt: stamp } : x)) }, t.agentId, 'info', `⚗ tests stopped · ${trunc(t.purpose || testPurpose(t.command, ''), 60)}`)
          else if (t && finished) d = settleTest(d, t.id, out, /exit_code>\s*[1-9]|exit code:?\s*[1-9]|status>\s*failed|status:\s*failed/i.test(out), stamp)
        }
        settled = (d.tests ?? []).filter(t => t.endedAt === stamp && t.status !== 'running' && t.status !== 'unknown')

        // Problems: a failing build or test replaces the list with the errors it names; a clean one clears it.
        if (shell && !(background && ok) && (testId || isBuildCmd(str('command')) || !ok)) {
          const dir = cmdDir(str('command'), sessionDir)
          const found = parseProblems(out).map(p => ({ ...p, path: resolvePath(p.path, dir) }))
          const testFailed = (d.tests ?? []).some(t => t.id === testId && t.status === 'failed')
          const who = d.agents.find(x => x.id === id)
          if (found.length && (!ok || testFailed || /\berror\b/i.test(out))) {
            const problems: Problem[] = found.map(p => ({ ...p, source: testLabel(testCmd), by: who?.name ?? 'Claude', hue: who?.hue ?? 0, at: stamp }))
            d = { ...d, problems }
            // A broken file not on the map yet joins it, so the red mark has somewhere to sit.
            for (const p of problems.slice(0, 8)) if (!d.nodes[p.path] && Object.keys(d.nodes).length < MAX_NODES) d = touch(d, p.path, '')
            problemNote = `✗ ${problems.length} error${problems.length === 1 ? '' : 's'} in ${[...new Set(problems.map(p => baseName(p.path)))].slice(0, 3).join(', ')}`
            d = log(d, id, 'info', `${problemNote} (from ${trunc(testId ? testPurpose(str('command'), str('description')) : cmdGist(str('command')), 50)})`)
          } else if (ok && !testFailed && (testId || isBuildCmd(str('command'))) && (d.problems ?? []).length) {
            d = log({ ...d, problems: [] }, id, 'info', `✓ problems cleared: ${trunc(testLabel(testCmd), 50)} ran clean`)
          }
        }

        // Stuck: the same command failing again and again, and the like.
        const sig = shell ? `$ ${testLabel(testCmd)}` : typeof delta === 'object' && node ? `✎ ${baseName(node)}` : `${e.tool}`
        const me = d.agents.find(x => x.id === id)
        if (me && !/^(TodoWrite|TaskCreate|TaskUpdate|Agent|Task)$/.test(e.tool)) {
          const recent = [...(me.recent ?? []), { sig, ok, at: stamp }].slice(-12)
          const why = stuckReason(recent, stamp)
          if (why && !me.stuck) stuckNote = `⚠ ${me.name} looks stuck: it ${why}`
          d = upsert(d, id, x => ({ ...x, recent, stuck: why }))
          if (stuckNote) d = log(d, id, 'info', stuckNote)
        }
        if (!ok) {
          // Mark the call failed (or refused) where it was logged and in the window.
          const who = d.agents.find(x => x.id === id)?.name
          const at = d.log.map(l => l.who === who && l.kind === 'act' && l.text === line).lastIndexOf(true)
          const mark = (ran as { deny?: string } | undefined)?.deny ? ' ✗ refused' : ' ✗ failed'
          if (at >= 0) d = { ...d, log: d.log.map((l, i) => (i === at ? { ...l, text: l.text + mark } : l)) }
          d = upsert(d, id, x => ({ ...x, actions: x.actions.map((t, i) => (i === x.actions.indexOf(line) ? t + mark : t)) }))
        }
        d = upsert(d, id, x => {
          const pending = x.pending.filter(p => p !== callId)
          return { ...x, pending, state: pending.length ? 'busy' : x.state === 'busy' ? 'thinking' : x.state, doneAt: stamp }
        })
        // (One started in the background works on after the call returns: its own turn's end says it is done.)
        if ((e.tool === 'Agent' || e.tool === 'Task') && a.run_in_background !== true)
          d = {
            ...d,
            agents: d.agents.map(x =>
              !!e.tool_use_id && x.spawnId === e.tool_use_id && x.state !== 'busy'
                ? { ...x, state: 'done', doneAt: stamp, pending: [], progress: 100, progressSrc: 'done' }
                : x,
            ),
          }
        return d
      })
      if (stuckNote) void $.ui.toast(stuckNote)
      if (problemNote && !settled.length) void $.ui.toast(problemNote)
      for (const t of settled)
        // Short and in words: who, how it went, what for. Never the command.
        void $.ui.toast(`${t.status === 'failed' ? '✗ Tests failed' : '✓ Tests passed'} (${testWords(t)}) · ${trunc(t.purpose || testPurpose(t.command, ''), 48)}${t.agentId === 'main' ? '' : ` · ${t.who}`}`)
      settleLater(id, stamp)
    }
  })

  // The map's pointer and clicks, and the search field.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.element === 'search') {
      // The search field drawn on the surface: each letter typed, and Enter for the next match.
      const sd = (e.data ?? {}) as { q?: unknown; next?: unknown }
      if (typeof sd.q === 'string') await searchFor($, sd.q, sd.next === true)
      return {}
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e) as unknown as Record<string, (props: unknown) => unknown>
    const cols = Math.max(40, e.props?.bodyColumns ?? e.viewport?.columns ?? 80)

    // The website runs: the pane on the desktop only says where, and how to open it beside the chat.
    // On the desktop the pane points at the website: running, starting, or to be opened with /crew. Only
    // when it could not start at all (no Node) does the pane draw the whole view itself.
    if (e.surface !== 'terminal' && !webFailed) {
      const c = await read($, crew)
      const atWork = c.agents.filter(a => a.state === 'busy' || a.state === 'thinking').length
      const needs = c.agents.filter(a => a.needs).length
      const total = c.chatCost ?? c.spent?.cost ?? 0
      const status = [`${fmtK(c.agents.length)} Claude${c.agents.length === 1 ? '' : 's'}`, needs ? `${fmtK(needs)} need${needs === 1 ? 's' : ''} you` : '', atWork ? `${fmtK(atWork)} working` : 'nothing running', total > 0 ? fmtUsd(total) : ''].filter(Boolean).join(' · ')
      return paintPane(
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color="#D97757">{'✻ Claude Crew'}</Text>
            <Text color="#8B949E">{" · this chat's crew is a website"}</Text>
          </Box>
          {webUrl ? (
            <Box flexDirection="row">
              <Text color="#3FB950">{'● '}</Text>
              <Text>{'running at '}</Text>
              <Link href={webUrl} />
            </Box>
          ) : (
            <Text color="#8B949E">{webState === 'starting' ? 'Starting…' : 'Type /crew to open it beside the chat'}</Text>
          )}
          {webUrl ? <Text color="#8B949E">{'Type /crew to open it beside the chat, or click the address.'}</Text> : null}
          <Text color={needs ? '#E3B341' : '#8B949E'}>{status}</Text>
        </Box>,
        c.theme ?? 'auto',
      )
    }

    // The terminal, or the desktop when the website could not start: the pane as lines of text, each
    // thing pressed a Button.
    const m = await paneModel($, cols, e.props?.scroll?.bodyRows ?? 0)
    const { c, sq, vwCols, totalCost, wide, paneAct, tab, rowsP, openDetails, openDir, counts, costRole, budgetText, recap, touchFolders, touchedSum, BODY_ROWS, listed, top0, scroll, tabs } = m
    const mode = c.theme ?? 'auto'
    const TONE: Record<string, string> = { text: '#E6EDF3', dim: '#8B949E', faint: '#8B949E', amber: '#E3B341', green: '#3FB950', red: '#F85149', brand: '#D97757', line: '#30363D', cx: '#8B949E' }
    const toneOf = (role: string) => TONE[role] ?? (/^h\d$/.test(role) ? PALETTE[Number(role.slice(1))] : '#E6EDF3')
    const press = (act: Act) => (p: { surface: unknown }) => void doAction($, act, p?.surface)
    const segEl = (g: Seg, k: string) => {
      const lead = `${g.dot ? '● ' : ''}${g.icon ? `${KIND_GLYPH[g.icon[0]] ?? '•'} ` : ''}${g.sprite ? '● ' : ''}${g.bar !== undefined ? `${'▮'.repeat(Math.round(g.bar * 8))}${'▯'.repeat(8 - Math.round(g.bar * 8))} ` : ''}`
      const t = `${lead}${g.t ?? ''}`
      if (!t && !g.parts) return null
      const cells = g.w ? Math.floor(g.w / CELL_W) : 0
      const body = cells ? cutTo(t, Math.max(1, cells)).padEnd(cells) : t
      const tone = toneOf(g.dot ?? g.sprite ?? g.role ?? 'text')
      if (g.run) {
        const act = g.run
        // A Button holds its words as Text, so a file keeps its colours: its name, its +/− and its errors.
        return (
          <Button key={k} plain onPress={press(act)}>
            {(g.parts ?? [[body, g.role ?? 'text']]).map(([pt, role], i) => (
              <Text key={`${k}p${i}`} mono size="footnote" color={toneOf(role)} bold={g.b} underline={g.u}>
                {pt}
              </Text>
            ))}
          </Button>
        )
      }
      // A mark before words (a Claude's dot, a kind's glyph) in its own colour, the words in theirs.
      if (lead && g.t && !cells)
        return [
          <Text key={`${k}m`} mono size="footnote" color={tone}>
            {lead}
          </Text>,
          <Text key={k} mono size="footnote" color={toneOf(g.role ?? 'text')} bold={g.b} italic={g.i} wrap="truncate">
            {g.t}
          </Text>,
        ]
      return (
        <Text key={k} mono size="footnote" color={tone} bold={g.b} italic={g.i} wrap="truncate">
          {body}
        </Text>
      )
    }
    const lineEl = (l: VLine, k: string) => (
      <Box key={k} flexDirection="row" height={1} overflow="hidden">
        {l.indent ? <Text mono size="footnote">{' '.repeat(Math.round(l.indent / CELL_W))}</Text> : null}
        {l.segs.map((g, i) => (
          <Box key={`${k}s${i}`} flexDirection="row" flexShrink={g.flex ? 1 : 0}>
            {segEl(g, `${k}g${i}`)}
            <Text mono size="footnote">{' '}</Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        {(l.right ?? []).map((g, i) => (
          <Box key={`${k}r${i}`} flexDirection="row" flexShrink={0}>
            <Text mono size="footnote">{' '}</Text>
            {segEl(g, `${k}h${i}`)}
          </Box>
        ))}
      </Box>
    )

    // The header: the brand, the counts by state, and the one cost.
    const headLine: VLine = { segs: [{ t: '✻ Claude Crew', b: true, role: 'brand' }, ...counts.map(([t, role, b]) => ({ t, role, b }))], right: totalCost > 0 || c.budget > 0 ? [{ t: `${fmtUsd(totalCost)}${budgetText ? ` ${budgetText}` : ''}`, role: costRole }] : [] }

    // The Claudes: a row's lines in a Box of its own, its Details a Button on its last line.
    const SR: Record<GlanceRow['state'], string> = { work: 'green', wait: 'dim', idle: 'dim', you: 'amber', done: 'dim' }
    const rowLines = (r: PaneRow): VLine[] => {
      const indent = r.state === 'you' ? 0 : Math.min(3, r.depth) * 2 * CELL_W
      const details: Seg = { t: r.focused ? 'Hide' : 'Details', role: 'dim', run: openDetails(r.id) }
      // A chat not read live: its state dim, "as of 13:09" faint (in a terminal, after its state).
      const sr = r.asOf ? 'dim' : SR[r.state]
      const term = r.asOf && e.surface === 'terminal'
      const one: VLine = { indent, segs: [{ dot: hueRole(r.hue), t: r.name, b: r.state !== 'done', role: r.state === 'done' ? 'dim' : 'text' }, { icon: [r.kind, sr], t: term ? `${r.status} (as of ${r.asOf})` : r.status, b: true, role: sr }, { t: term ? '' : r.object, flex: true, role: r.asOf ? 'faint' : r.state === 'done' ? 'dim' : 'text' }], right: [{ t: r.time, role: 'dim' }] }
      if (r.state === 'done') return [one]
      if (r.state === 'you') return [one, ...wrapRows(r.ask, Math.max(16, cols - 6), 6).map(t => ({ indent: indent + 2 * CELL_W, segs: [{ t }] })), { indent: indent + 2 * CELL_W, segs: [{ t: r.where, role: 'dim', flex: true }], right: [details] }]
      const pips = r.total ? `${'●'.repeat(Math.min(5, r.done))}${'○'.repeat(Math.max(0, Math.min(5, r.total) - r.done))}` : ''
      return [one, { indent: indent + 2 * CELL_W, segs: [{ t: pips, role: 'dim' }, { t: r.progress, role: r.stuck ? 'amber' : 'dim', flex: true }], right: [...(wide && r.model ? [{ t: r.model, role: 'faint' }] : []), details] }]
    }
    const recapLines: VLine[] = recap
      ? recap.copy
        ? [{ segs: [{ icon: ['done', 'green'], t: recap.title, b: true, role: 'green' }, { t: recap.goal, role: 'dim', flex: true }], right: [{ t: recap.ago, role: 'dim' }] }, ...recap.facts.map(([k, v, role]) => ({ indent: 2 * CELL_W, segs: [{ t: k, w: 9 * CELL_W, role: 'dim' }, { t: v, role, flex: true }] })), { indent: 2 * CELL_W, segs: [{ t: 'Copy as Markdown', role: 'dim', u: true, run: recap.copy }] }]
        : [{ segs: [{ t: recap.title, role: 'dim', flex: true }] }, { segs: [{ t: '▶ Try a pretend session', role: 'dim', u: true, run: recap.demo }] }]
      : []

    // Touched: a line per folder, each file a Button in its colours, as many as the line holds, then +N more.
    const folderCols = wide ? 15 : 12
    const touchLines: VLine[] = [
      { segs: [{ t: 'Touched', b: true }, { t: touchedSum, role: 'dim', flex: true }], right: sessionDir ? [{ t: 'Open folder', role: 'dim', u: true, run: openDir(sessionDir, 'the project folder') }] : [] },
      ...touchFolders.map(d => {
        let room = vwCols - folderCols - 2
        const files: Seg[] = []
        for (const [i, f] of d.files.entries()) {
          const parts: [string, string][] = [...(f.on ? ([['● ', f.on]] as [string, string][]) : []), [f.name, f.errs ? 'red' : f.read ? 'dim' : 'text'], ...(f.errs ? ([[` ✕${f.errs}`, 'red']] as [string, string][]) : []), ...(f.add ? ([[` +${fmtK(f.add)}`, 'green']] as [string, string][]) : []), ...(f.del ? ([[` −${fmtK(f.del)}`, 'dim']] as [string, string][]) : [])]
          const w = parts.reduce((n, [t]) => n + textW(t), 0) + 2
          // Room for this file, and for "+N more" after it when more are left.
          if (room < w + (i < d.files.length - 1 ? 10 : 0)) break
          files.push({ parts, t: parts.map(p => p[0]).join(''), run: f.run })
          room -= w
        }
        if (files.length < d.files.length) files.push({ t: `+${fmtK(d.files.length - files.length)} more`, role: 'dim', u: true, run: paneAct({ tab: 'files', top: 0 }) })
        return { segs: [{ t: d.name, w: folderCols * CELL_W, role: 'dim' }, ...files] }
      }),
      ...(touchFolders.length ? [] : [{ segs: [{ t: 'No files yet. Folders show here as the Claudes open files.', role: 'dim', flex: true }] }]),
    ]
    while (touchLines.length < 4) touchLines.push({ segs: [] })

    // The tabs (the one shown bold), then scrolling: each a Button, readable at rest.
    const tabLine: VLine = {
      segs: tabs.map(t => ({ t: t.t, role: t.on ? 'text' : 'dim', b: t.on, u: t.on, run: t.run, gap: 2 })),
      right: [
        { t: '▲ older', role: scroll.canUp ? 'text' : 'dim', run: scroll.up },
        { t: '▼ newer', role: scroll.canDown ? 'text' : 'dim', run: scroll.down },
        { t: '⤓ latest', role: scroll.held ? 'text' : 'dim', run: scroll.latest },
      ],
    }
    const searchEl = tab === 'search' ? (
      <Box key="search-row" flexDirection="row">
        <Text mono size="footnote" color="#8B949E">{'⌕ '}</Text>
        <Box flexGrow={1}>
          <Input key="search-input" placeholder="Search files and the log..." value={sq.q} submitLabel="" onInput={(v: string) => void searchFor($, v)} onSubmit={(v: string) => void searchFor($, v, true)} />
        </Box>
      </Box>
    ) : null
    const view = listed.slice(top0, top0 + BODY_ROWS)
    return paintPane(
      <Box flexDirection="column">
        {lineEl(headLine, 'head')}
        <Box key="crew" flexDirection="column" marginTop={1}>
          {rowsP.map(r => (
            <Box key={`row-${r.id}`} flexDirection="column">
              {rowLines(r).map((l, i) => lineEl(l, `${r.id}:${i}`))}
            </Box>
          ))}
          {recapLines.map((l, i) => lineEl(l, `recap${i}`))}
        </Box>
        <Box key="touched" flexDirection="column" marginTop={1}>
          {touchLines.map((l, i) => lineEl(l, `touch${i}`))}
        </Box>
        <Box key="tabs" flexDirection="column" marginTop={1}>
          {lineEl(tabLine, 'tabs')}
        </Box>
        {searchEl}
        <Box key="view" flexDirection="column" height={BODY_ROWS} overflow="hidden">
          {view.map((l, i) => lineEl(l, `body${i}`))}
        </Box>
      </Box>,
      mode,
    )
  })
}
