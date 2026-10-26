import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Change, CodexRun, Crew, Frame, LogLine, MapNode, MapView, PlanTask, Problem, Replay, ShellRun, Summary, TestRun } from '../types'

// ─── State ──────────────────────────────────────────────────────────────────

const PANE = 'crew-map'
/** Shown in the pane's header, so it is plain which version a chat is running. Keep in step with plugin.json. */
const VERSION = '1.3.6'
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
const intro = atom({ plugin: 'crew-map', key: 'intro' } as const, { until: 0, played: false } as { until: number; played?: boolean })
const tick = atom({ plugin: 'crew-map', key: 'tick' } as const, 0)
/** The map's window: where it sits over the map, how far zoomed, whether it follows the fit. */
const mapView = atom({ plugin: 'crew-map', key: 'view' } as const, { x: 0, y: 0, k: 1, auto: true, rev: 'fit', sel: false, follow: 0 } as MapView)
/** The search box: what is typed, which hit is shown, and a stamp per change. */
const search = atom({ plugin: 'crew-map', key: 'search' } as const, { q: '', i: 0, rev: 0 })
/** What the pointer rests on, on the map: a click target's id, or ''. */
const hoverOn = atom({ plugin: 'crew-map', key: 'hover' } as const, '')
/** The map's pan module has had the mouse here: interaction works, and the search can be a field of our own. */
const mapLive = atom({ plugin: 'crew-map', key: 'mapLive' } as const, false)
/** Files untouched this long fade; folders untouched this long fold up by themselves. */
const FADE_MS = 5 * 60_000
const FOLD_MS = 10 * 60_000

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
let readCrew: (() => Promise<Crew>) | undefined
let after: ((ms: number, fn: () => void) => void) | undefined
let every: ((ms: number, fn: () => void) => { cancel: () => void }) | undefined
let readFile: ((path: string) => Promise<string>) | undefined
let exists: ((path: string) => Promise<boolean>) | undefined
let demo: { cancel: () => void } | undefined

// ─── Vocabulary ─────────────────────────────────────────────────────────────

const PALETTE = ['#D97757', '#6CB6FF', '#7EE787', '#D2A8FF', '#FFA657', '#56D4DD', '#FF7B72', '#E3B341']
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
const ACT_COLOR: Record<string, string> = {
  reading: '#79C0FF',
  editing: '#7EE787',
  writing: '#7EE787',
  searching: '#E3B341',
  finding: '#E3B341',
  running: '#FFA657',
  fetching: '#56D4DD',
  delegating: '#D2A8FF',
  planning: '#D2A8FF',
  thinking: '#8B949E',
}
const ICON: Record<string, string> = { Read: '◇', Edit: '✎', MultiEdit: '✎', Write: '✎', Bash: '$', PowerShell: '$', Grep: '⌕', Glob: '⌕', WebFetch: '◎', WebSearch: '◎', Agent: '⇢', Task: '⇢', 'mcp__codex-bridge__codex': '◎' }
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
const STATION_ICON: Record<string, string> = { '@browser': '◍', '@computer': '▣', '@remote': '▣', '@docs': '▤', '@claude': '✻' }
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
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/** Columns a Box's frame takes: border, padding, side margins. */
const frameW = (p: Record<string, unknown>) =>
  (p.borderStyle ? 2 : 0) + 2 * num(p.paddingX ?? p.padding) + num(p.paddingLeft) + num(p.paddingRight) + num(p.marginLeft) + num(p.marginRight) + 2 * num(p.marginX ?? p.margin)
/** The columns a node takes at its natural size. */
const natW = (x: FitNode): number => {
  if (x === null || x === undefined || x === false) return 0
  if (typeof x === 'string' || typeof x === 'number') return textW(String(x))
  const p = x.props ?? {}
  if (p.position === 'absolute' || p.display === 'none') return 0
  if (x.type === 'Svg') return Math.ceil(num(p.width) / CELL_W)
  if (x.type === 'Client') return num(p.width)
  if (x.type === 'Select') return 14
  if (x.type === 'Input') return 24
  const kids = kidsOf(x)
  if (x.type === 'Text' || x.type === 'Button') return kids.reduce<number>((n, k) => n + natW(k), 0) || (typeof p.label === 'string' ? textW(p.label) : 0)
  if (typeof p.width === 'number') return p.width
  const row = (p.flexDirection ?? 'row') === 'row'
  const gap = num(p.columnGap ?? p.gap)
  const inner = row ? kids.reduce<number>((n, k) => n + natW(k), 0) + gap * Math.max(0, kids.filter(k => natW(k) > 0).length - 1) : Math.max(0, ...kids.map(natW))
  return inner + frameW(p)
}
/** Whether a node holds a Text it may cut short (so its row may narrow it). */
const canShrink = (x: FitNode): boolean => {
  if (!x || typeof x !== 'object') return false
  const p = x.props ?? {}
  if (x.type === 'Text') return p.wrap === 'truncate'
  if (x.type !== 'Box' || p.flexShrink === 0 || typeof p.width === 'number') return false
  return kidsOf(x).some(canShrink)
}
/** A Text's strings cut so the whole is at most `w` cells (nested Texts in order). */
const cutText = (x: FitNode, w: number): [FitNode, number] => {
  if (x === null || x === undefined || x === false) return [x, 0]
  if (typeof x === 'string' || typeof x === 'number') {
    const t = cutTo(String(x), Math.max(0, w))
    return [t, textW(t)]
  }
  let left = w
  const kids = kidsOf(x).map(k => {
    const [c, used] = cutText(k, left)
    left -= used
    return c
  })
  return [withKids(x, kids), w - left]
}
/** The node fitted into `avail` columns. */
const fitNode = (x: FitNode, avail: number): FitNode => {
  if (!x || typeof x !== 'object') return x
  const p = x.props ?? {}
  if (x.type === 'Text') return p.wrap === 'truncate' && natW(x) > avail ? cutText(x, Math.max(1, Math.floor(avail)))[0] : x
  if (x.type !== 'Box' || p.position === 'absolute') return x
  const own = typeof p.width === 'number' ? Math.min(p.width, avail) : typeof p.width === 'string' && p.width.endsWith('%') ? Math.floor((avail * parseFloat(p.width)) / 100) : avail
  const inner = Math.max(0, own - frameW(p))
  const kids = kidsOf(x)
  if ((p.flexDirection ?? 'row') !== 'row' || p.flexWrap === 'wrap') return withKids(x, kids.map(k => fitNode(k, inner)))
  // A row: what cannot narrow keeps its width; what can shares the rest, in proportion to its length.
  const gap = num(p.columnGap ?? p.gap)
  const widths = kids.map(natW)
  const shrinks = kids.map(canShrink)
  const fixed = widths.reduce((n, w, i) => n + (shrinks[i] ? 0 : w), 0) + gap * Math.max(0, widths.filter(w => w > 0).length - 1)
  const want = widths.reduce((n, w, i) => n + (shrinks[i] ? w : 0), 0)
  const room = Math.max(0, inner - fixed)
  return withKids(
    x,
    kids.map((k, i) => (shrinks[i] ? fitNode(k, want <= room ? widths[i] : Math.floor((room * widths[i]) / Math.max(1, want))) : fitNode(k, widths[i]))),
  )
}
/** A file name cut to `w` cells, keeping its start and extension: `a-long-name.test.ts` → `a-long….test.ts`. */
const midCut = (name: string, w: number) => {
  if (textW(name) <= w) return name
  // Both ends, by cells: the start, and the end with its extension.
  const chars = [...name]
  const tailW = Math.max(Math.min(textW(name.match(/\.[^.\/]{1,6}$/)?.[0] ?? ''), w - 4), Math.floor((w - 1) / 2))
  let tail = ''
  for (let i = chars.length - 1; i >= 0 && textW(chars[i] + tail) <= tailW; i--) tail = chars[i] + tail
  return `${cutTo(name.slice(0, name.length - tail.length), w - textW(tail)).replace(/…$/, '')}…${tail}`
}
/** The most desks shown at once this session: the desks keep that much room, so the cards below never jump. */
let deskMax = 0

/** The pane fitted to its columns, a little spare for the desktop's proportional font. */
const fitPane = <T,>(tree: T, cols: number): T => fitNode(tree as unknown as FitNode, Math.floor(cols * 0.97) - 1) as unknown as T

/** A text in two lines of `w` characters, broken between words; the second line cut short if need be. */
const twoLines = (s: string, w: number): [string, string] => {
  if (s.length <= w) return [s, '']
  let at = s.lastIndexOf(' ', w)
  if (at < w * 0.5) at = w
  return [s.slice(0, at).trimEnd(), trunc(s.slice(at).trimStart(), w)]
}
/** How long a helper's window stays (marked done) after it finishes, so windows do not blink in and out. */
const WINDOW_LINGER_MS = 20_000
/** Waiting on the person: its window's border, its words, its bubble. */
const NEEDS = '#E3B341'
/** Rows of the log: fixed, so lines coming in never move what is below. */
const LOG_ROWS = 12

/**
 * A turn the app started by itself, not a prompt: a background task or monitor
 * reporting in, a CI event, a slash command's output. Returns a short line for
 * the log, or '' for a real prompt.
 */
const SYSTEM_TAG = /^\s*<(task-notification|agent-message|system-reminder|ci-monitor-event|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-notification|bash-input|bash-stdout|user-memory-input|[a-z][\w-]*-(?:notification|event|reminder))[\s>]/i
const systemNote = (full: string) => {
  const text = full.length > 8000 ? full.slice(0, 8000) : full
  const tag = text.match(SYSTEM_TAG)?.[1]?.toLowerCase()
  if (!tag) return ''
  const inner = (name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1]?.replace(/<[^>]*>/g, ' ') ?? ''
  const said = tag === 'agent-message' ? '' : oneLine(inner('summary') || inner('command-name') || inner('status') || '')
  const kind = tag === 'task-notification' ? 'background task' : tag === 'agent-message' ? 'a helper reported back' : tag.startsWith('ci-') ? 'CI' : tag.includes('command') ? 'command' : 'update'
  return trunc(said ? `${kind}: ${said}` : kind, 120)
}
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
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

const actionLine = (tool: string, node: string, detail: string, said = '') => {
  // A command by what Claude said it does, else what it runs in a few words: never the raw command.
  if (tool === 'Bash' || tool === 'PowerShell') return `$ ${trunc(oneLine(said), 120) || cmdGist(detail)}`
  if (tool === COMPACT) return '🗜 compacting the conversation'
  const st = stationOf(tool)
  if (st) return `${STATION_ICON[st] ?? '▤'} ${stationLabel(st)}: ${detail}`.trim()
  const icon = ICON[tool] ?? '•'
  const what = node && !isSpecial(node) ? baseName(node) : detail
  return `${icon} ${VERB[tool] ?? tool.split('__').pop()} ${what}`.trim()
}

/** The first meaningful sentence or two of a block of model text. */
const summarise = (text: string): string => {
  // Markdown marks go; underscores stay, since code names like read_chunk use them.
  const clean = oneLine(text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>]/g, ''))
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

const log = (c: Crew, id: string, kind: LogLine['kind'], text: string): Crew => {
  const a = c.agents.find(x => x.id === id)
  if (!a || !text) return c
  return { ...c, log: [...c.log, { at: Date.now(), who: a.name, hue: a.hue, kind, text: trunc(text, 300) }].slice(-40) }
}

const think = (c: Crew, id: string, line: string): Crew => {
  if (!line || c.agents.find(a => a.id === id)?.thoughts[0] === line) return c
  return log(upsert(c, id, a => ({ ...a, thoughts: [line, ...a.thoughts].slice(0, 6) })), id, 'think', line)
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
 * How far along a Claude is, from its own plan: the share of its tasks (or to-dos) finished, and how many
 * it is on now. With no plan there is no honest percentage, just what it has done and for how long.
 */
const progressOf = (a: Agent, c: Pick<Crew, 'tasks'> = {}): { pct: number; src: string; doing: number; total: number } => {
  if (a.state === 'done' || a.progressSrc === 'done') return { pct: 100, src: 'done', doing: 0, total: 0 }
  const plan = tasksOf(a, c)
  const [done, doing, total] = plan.length
    ? [plan.filter(t => t.status === 'completed').length, plan.filter(t => t.status === 'in_progress').length, plan.length]
    : [a.todosDone, a.todosDoing ?? 0, a.todosTotal]
  if (total > 0) return { pct: Math.round((100 * done) / total), src: `${done} of ${total} ${plan.length ? 'task' : 'to-do'}${total === 1 ? '' : 's'} done`, doing, total }
  if (a.calls === 0) return { pct: -1, src: a.state === 'idle' ? '' : 'starting', doing: 0, total: 0 }
  // No to-do list: no percentage to show honestly, just what it has done and for how long.
  const secs = a.since ? elapsed((a.state === 'busy' || a.state === 'thinking' ? Date.now() : a.doneAt || Date.now()) - a.since) : ''
  return { pct: -1, src: `${fmtK(a.calls)} step${a.calls === 1 ? '' : 's'}${secs ? ` · ${secs}` : ''}`, doing: 0, total: 0 }
}

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

// ─── The picture map (desktop) ──────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

const FILE_TYPES: [RegExp, string, string][] = [
  [/\.tsx?$/i, 'TS', '#3B82F6'],
  [/\.(m?jsx?|cjs)$/i, 'JS', '#E8D44D'],
  [/\.py$/i, 'PY', '#4B8BBE'],
  [/\.rs$/i, 'RS', '#DEA584'],
  [/\.go$/i, 'GO', '#00ADD8'],
  [/\.(s?css|less)$/i, 'CSS', '#A97BFF'],
  [/\.html?$/i, 'HTML', '#E34C26'],
  [/\.mdx?$/i, 'MD', '#C9D1D9'],
  [/\.json$/i, '{ }', '#CBCB41'],
  [/\.ya?ml$/i, 'YML', '#E06C75'],
  [/\.toml$/i, 'TOML', '#C38E5C'],
  [/\.(sh|bash|zsh|ps1|bat|cmd)$/i, 'SH', '#89E051'],
  [/\.(c|h)$/i, 'C', '#A8B9CC'],
  [/\.(cpp|cc|hpp|cxx)$/i, 'C++', '#F34B7D'],
  [/\.cs$/i, 'C#', '#3FB950'],
  [/\.(java|kt)$/i, 'JVM', '#B07219'],
  [/\.lua$/i, 'LUA', '#6C8EEF'],
  [/\.(vue|svelte)$/i, 'UI', '#41B883'],
  [/\.(png|jpe?g|gif|svg|webp|ico)$/i, 'IMG', '#D2A8FF'],
]
const fileType = (p: string): [string, string] => {
  const hit = FILE_TYPES.find(([re]) => re.test(p))
  if (hit) return [hit[1], hit[2]]
  const ext = p.includes('.') ? (p.split('.').pop() ?? '') : ''
  return [ext ? ext.toUpperCase().slice(0, 4) : 'TXT', '#8B949E']
}
const isTest = (p: string) => /(\.|_|\/)(test|spec)s?[./_]|\/tests?\//i.test(p)

const MAP_CSS = `
text{font-family:ui-sans-serif,system-ui,"Segoe UI",sans-serif}
.m{font-family:ui-monospace,"Cascadia Code",Consolas,Menlo,monospace}
@keyframes bob{50%{transform:translateY(-2px)}}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
@keyframes dot{0%,100%{opacity:.2}40%{opacity:1}}
@keyframes pulse{50%{opacity:.35}}
@keyframes write{from{transform:scaleX(.2)}to{transform:scaleX(1)}}
.d{stroke-width:2.8;stroke-dasharray:.1 5;stroke-linecap:round;stroke-linejoin:round;fill:none}
.q{fill:none;stroke-width:1.3;stroke-linecap:round;opacity:.85}
@keyframes rise{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(-16px);opacity:0}}
@keyframes ring{0%{transform:scale(.9);opacity:.8}100%{transform:scale(1.25);opacity:0}}
`

const TEST_TINT = '#56D4DD'
/**
 * Beside the terminal: a bubbling flask and a pulsing ring while tests run;
 * once they finish, the last result as a green or red pill until the next run.
 */
const testBadge = (tests: TestRun[], loop: (name: string, dur: number, off?: number, ease?: string) => string) => {
  const running = tests.filter(t => t.status === 'running')
  let s = ''
  if (running.length) {
    s += `<rect x="-3" y="-3" width="50" height="40" rx="7" fill="none" stroke="${TEST_TINT}" stroke-width="2" style="transform-origin:center;${loop('ring', 1.6, 0, 'ease-out')}"/>`
    // The flask, to the left of the terminal.
    s += `<g transform="translate(-27,2)">`
    s += `<path d="M7 0h8M9 0v10L2 26a3 3 0 0 0 3 4h12a3 3 0 0 0 3-4L13 10V0" fill="#0D1117" stroke="${TEST_TINT}" stroke-width="1.6" stroke-linejoin="round"/>`
    s += `<path d="M5.2 20h11.6L19.6 26.4a2 2 0 0 1-1.9 2.6H4.3a2 2 0 0 1-1.9-2.6z" fill="${TEST_TINT}" opacity=".75"/>`
    s += [0, 1, 2].map(i => `<circle cx="${8 + i * 3}" cy="${22 - i}" r="${1.6 - i * 0.3}" fill="#E6FFFB" style="${loop('rise', 1.5, i * 0.5, 'ease-out')}"/>`).join('')
    s += `</g>`
    if (running.length > 1) {
      // A count pill sized to its number, so "×8" or "×12" fits inside it.
      const label = `×${running.length > 99 ? '99+' : running.length}`
      const w = label.length * 6.4 + 10
      s += `<rect x="${(-16 - w / 2).toFixed(1)}" y="-20" width="${w.toFixed(1)}" height="15" rx="7.5" fill="#0D1117" stroke="${TEST_TINT}" stroke-width="1.2"/>`
      s += `<text x="-16" y="-9" text-anchor="middle" class="m" font-size="10" font-weight="700" fill="${TEST_TINT}">${label}</text>`
    }
    return s
  }
  const last = [...tests].reverse().find(t => t.status === 'passed' || t.status === 'failed')
  if (!last) return s
  const bad = last.status === 'failed'
  const words = `${bad ? '✗' : '✓'} ${last.passed || last.failed ? (bad ? (last.failed ? `${fmtK(last.failed)} failed` : 'failed') : `${fmtK(last.passed)} passed`) : last.status}`
  const w = words.length * 5.6 + 12
  const tint = bad ? '#F85149' : '#3FB950'
  s += `<g transform="translate(${(22 - w / 2).toFixed(1)},58)"><rect width="${w.toFixed(1)}" height="15" rx="7.5" fill="${bad ? '#2D1214' : '#0F2417'}" stroke="${tint}" stroke-width="1.2"/>`
  s += `<text x="${(w / 2).toFixed(1)}" y="10.8" text-anchor="middle" class="m" font-size="9" font-weight="700" fill="${tint}">${words}</text></g>`
  return s
}

type Spot = { x: number; y: number }

const CX = '#10A37F'
const CX_ROOT = 'cx:root'
/** How long a finished Codex run stays on the map, and how long its answer is shown travelling back. */
const CODEX_KEEP_MS = 30 * 60_000
const CODEX_REPLY_MS = 8000
const hexagon = (r: number) =>
  `M${Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`
  }).join('L')}Z`

/** What the last drawing of the map measured: clicks, hovers and the arrows between drawings use it. */
let lastFrame = { vw: 0, vh: 0, mw: 1, mh: 1, kMin: 0.1, kMax: 2.5, view: { x: 0, y: 0, k: 1 }, fit: { x: 0, y: 0, k: 1 }, rev: '', targets: [] as MapTarget[], folded: [] as string[] }
/** Where the pointer last rested over the map, in window pixels. */
let hoverAt: [number, number] | null = null
/** The last 40 map events (pointer messages and what they decided) and the draws by surface, for diagnosing the map's input. */
const diag: string[] = []
const draws: Record<string, number> = {}
let hovers = 0
let diagDirty = false
/** When this pane last had the mouse or a button (the record kept is the latest one's). */
let lastInputAt = 0
const note = (text: string) => {
  diag.push(`${new Date().toISOString().slice(11, 19)} ${text}`)
  if (diag.length > 40) diag.shift()
  diagDirty = true
}
let viewRev = 0
/** The pan module failed on this surface: the map falls back to a fixed picture with click buttons. */
let panFailed = false

/**
 * Where the window starts: the whole map when it is still readable that small,
 * else the map's full width (no larger than life) from the top, to drag down.
 */
const startView = (vw: number, vh: number, mw: number, mh: number, busyAt: { x: number; y: number }[] = []) => {
  const all = fitView(vw, vh, mw, mh)
  const k = Math.min(1, vw / mw)
  if (all.k >= k * 0.75) return all
  // Follow the crew: when the Claudes at work sit below the top of the map, centre the window on them.
  const h = vh / k
  const ys = busyAt.map(p => p.y)
  const lo = Math.min(...ys) - 120
  const hi = Math.max(...ys) + 90
  const y = !ys.length || hi <= h ? 0 : Math.max(0, Math.min(mh - h, (lo + hi) / 2 - h / 2))
  return { x: (mw - vw / k) / 2, y, k }
}
/** The window's fit: the whole map, centred. */
const fitView = (vw: number, vh: number, mw: number, mh: number) => {
  const k = Math.min(vw / mw, vh / mh)
  return { x: (mw - vw / k) / 2, y: (mh - vh / k) / 2, k }
}
/** Keeps at least a quarter of the window over the map; the pan module clamps the same way. */
const clampView = (v: { x: number; y: number; k: number }, f: { vw: number; vh: number; mw: number; mh: number; kMin: number; kMax: number }) => {
  const k = Math.min(f.kMax, Math.max(f.kMin, v.k))
  const w = f.vw / k
  const h = f.vh / k
  return { x: Math.min(f.mw - w * 0.25, Math.max(-w * 0.75, v.x)), y: Math.min(f.mh - h * 0.25, Math.max(-h * 0.75, v.y)), k }
}
/** The map drawn through a window: the same picture, a new viewBox; `onMap` in map units, `onWindow` in window pixels. */
/** Seconds on the clock the map's looping animations share (see `loop` in mindMap). */
/**
 * A Claude at its desk, as a small picture: its sprite bobbing as it works (quick when busy, slow
 * when thinking, still when idle), a "!" bubble when it waits on the person, a tick when done.
 * Animations take their phase from the clock the picture is drawn at, so a redraw does not restart them.
 */
const deskSprite = (color: string, mood: 'busy' | 'thinking' | 'idle' | 'needs' | 'done', seed: number) => {
  const U = 2.2
  const R = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${(x * U).toFixed(1)}" y="${(y * U).toFixed(1)}" width="${(w * U).toFixed(1)}" height="${(h * U).toFixed(1)}" fill="${fill}"/>`
  const off = (seed % 10) / 10
  const anim = (name: string, dur: number, extra = 0) => `animation:${name} ${dur}s ease-in-out infinite;animation-delay:calc(-1s * var(--clk, 0) - ${(off + extra).toFixed(2)}s)`
  const body = R(2, 0, 12, 7, color) + R(0, 3, 2, 2, color) + R(14, 3, 2, 2, color) + [3, 5, 10, 12].map(x => R(x, 7, 1, 2, color)).join('')
  const eyes = `<g style="transform-origin:center;transform-box:fill-box;${anim('blink', 4.2)}">${R(4, 2, 1, 2, '#0D1117')}${R(11, 2, 1, 2, '#0D1117')}</g>`
  const bob = mood === 'busy' ? anim('bob', 0.7) : mood === 'thinking' || mood === 'needs' ? anim('bob', 1.8) : ''
  const badge =
    mood === 'needs'
      ? '<circle cx="44" cy="8" r="7" fill="#E3B341"/><text x="44" y="11.5" text-anchor="middle" font-size="10" font-weight="800" fill="#0D1117">!</text>'
      : mood === 'done'
        ? '<circle cx="44" cy="8" r="7" fill="#2EA043"/><path d="M40.5 8l2.4 2.4 4.2-4.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>'
        : mood === 'thinking'
          ? [0, 1, 2].map(i => `<circle cx="${38 + i * 4}" cy="7" r="1.4" fill="#9CA3AF" style="${anim('dot', 1.2, i * 0.2)}"/>`).join('')
          : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="34" viewBox="0 0 52 34" style="--clk:${clockNow()}"><style>@keyframes bob{50%{transform:translateY(-2px)}}@keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}@keyframes dot{50%{opacity:.2}}</style><g transform="translate(2,10)"><g style="${bob}">${body}${eyes}</g></g>${badge}</svg>`
}

/**
 * What a Claude is waiting on, when it is waiting at all:
 * - you: a permission, an answer or a plan it needs (urgent), or, for the main Claude whose turn is over
 *   with nothing else running, your next message;
 * - helpers: the helpers it started, while it sits in the call that runs them, or (main, turn over)
 *   while helpers it started in the background still work;
 * - command: a command it runs and waits for, or (main, turn over) a background command still running.
 */
type Wait = { kind: 'you' | 'helpers' | 'command'; urgent: boolean; label: string; what: string; short: string }
const WAIT_TINT = { helpers: '#D2A8FF', command: '#FFA657' } as const
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
    if (a.tool === 'Bash' || a.tool === 'PowerShell') return command((a.actions[0]?.startsWith('$ ') ? a.actions[0].slice(2) : cmdGist(a.detail)).replace(/^ran /, ''))
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

/** A file that was changed: its outline on the map, its chip in a folder card. */
const EDITED = '#3FB950'
const CLOCK_BASE = Date.now()
const clockNow = () => (Math.max(0, Date.now() - CLOCK_BASE) / 1000).toFixed(2)
const windowSvg = (body: string, vw: number, vh: number, v: { x: number; y: number; k: number }, onWindow = '', onMap = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" style="--clk:${clockNow()}" width="${vw}" height="${vh}" viewBox="${v.x.toFixed(1)} ${v.y.toFixed(1)} ${(vw / v.k).toFixed(1)} ${(vh / v.k).toFixed(1)}" preserveAspectRatio="xMinYMin meet"><rect x="-100000" y="-100000" width="200000" height="200000" fill="#07080B"/>${body}${onMap}${onWindow ? `<g transform="translate(${v.x.toFixed(2)},${v.y.toFixed(2)}) scale(${(1 / v.k).toFixed(5)})">${onWindow}</g>` : ''}</svg>`

/** What resting the pointer on something shows: its outline, its links, and a two-line tip. */
/**
 * What resting the pointer on something shows. `ring`: its outline (the same shape the search
 * outline uses, around the icon), absent when the search outline already marks it. `top`/`bottom`:
 * the extent of everything drawn for it (icon, name, counts), so the tip never covers any of it.
 */
type HoverInfo = { ring?: { x: number; y: number; w: number; h: number; rx: number }; top: number; bottom: number; cx: number; title: string; sub: string; links: [number, number][]; from: [number, number] }
/**
 * The hovered thing on the map (map units): its outline in the hover colour, and a thin dashed
 * outline of the same shape on each file it imports or is imported by. No lines between them: a
 * straight line over a tree crosses whatever lies between.
 */
const hoverOnMap = (h: HoverInfo | undefined) => {
  if (!h) return ''
  let s = ''
  for (const [x, y] of h.links)
    s += `<rect x="${(x - IW / 2 - 8).toFixed(1)}" y="${(y - IH / 2 - 8).toFixed(1)}" width="${IW + 16}" height="${RING_H}" rx="9" fill="none" stroke="#79C0FF" stroke-width="1.6" stroke-dasharray="5 4"/>`
  const r = h.ring
  if (r) s += `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w}" height="${r.h}" rx="${r.rx}" fill="#79C0FF" fill-opacity=".08" stroke="#79C0FF" stroke-width="2"/>`
  return s
}
/** Its tip (window pixels): under everything drawn for the thing, else over it; always inside the window. */
const hoverTip = (h: HoverInfo | undefined, v: { x: number; y: number; k: number }, vw: number, vh: number) => {
  if (!h) return ''
  // The title is monospace at 11 px (about 6.1 px a character), the line under it sans at 10 px (about 5.4).
  const title = midTrunc(h.title, Math.max(12, Math.floor((vw - 26) / 6.1)))
  const sub = midTrunc(h.sub, Math.max(12, Math.floor((vw - 26) / 5.4)))
  const w = Math.min(vw - 8, Math.max(title.length * 6.1, sub.length * 5.4) + 18)
  const tall = 38
  const cx = (h.cx - v.x) * v.k
  const below = (h.bottom - v.y) * v.k + 6
  const above = (h.top - v.y) * v.k - tall - 6
  const y = below + tall <= vh - 4 ? below : above >= 4 ? above : Math.max(4, vh - tall - 4)
  const x = Math.min(vw - w - 4, Math.max(4, cx - w / 2))
  return (
    `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect width="${w.toFixed(1)}" height="${tall}" rx="6" fill="#161B22" stroke="#79C0FF" stroke-opacity=".6"/>` +
    `<text x="9" y="15" class="m" font-size="11" font-weight="600" fill="#E6EDF3">${esc(title)}</text><text x="9" y="29.5" font-size="10" fill="#9CA3AF">${esc(sub)}</text></g>`
  )
}

/**
 * The map's key: one short line in the window's bottom-left, the same size at any zoom; left out
 * when a file or folder shows in that corner, so it never covers one.
 */
const legendSvg = (vw: number, vh: number, codex: boolean, v: { x: number; y: number; k: number }, targets: { x: number; y: number; w: number; h: number }[]) => {
  const full = `dashed = not opened · green = edited · faded = idle 5 min · red = errors${codex ? ' · teal = Codex' : ''}`
  const text = vw >= full.length * 5.6 + 40 ? full : vw >= 330 ? 'dashed = not opened · green = edited · red = errors' : ''
  if (!text || vh < 120) return ''
  const w = text.length * 5.6 + 16
  const box = { x: 8, y: vh - 26, w, h: 18 }
  const covers = targets.some(t => {
    const x = (t.x - v.x) * v.k
    const y = (t.y - v.y) * v.k
    return x < box.x + box.w && x + t.w * v.k > box.x && y < box.y + box.h && y + t.h * v.k > box.y
  })
  if (covers) return ''
  return `<g transform="translate(8,${vh - 26})"><rect width="${w.toFixed(1)}" height="18" rx="9" fill="#0D1117" fill-opacity=".85"/><text x="8" y="12.5" font-size="10" fill="#9CA3AF">${esc(text)}</text></g>`
}
/** What a click at window pixels lands on. */
const targetAt = (px: number, py: number, v: { x: number; y: number; k: number }, targets: MapTarget[], reach = 0) => {
  const mx = v.x + px / v.k
  const my = v.y + py / v.k
  // Files before folders before the project folder: the smaller thing under the pointer wins.
  const sorted = [...targets].sort((a, b) => a.w * a.h - b.w * b.h)
  const hit = sorted.find(t => mx >= t.x && mx <= t.x + t.w && my >= t.y && my <= t.y + t.h)
  if (hit || reach <= 0) return hit
  // Nothing right under it: the nearest file or folder within reach on screen (a pointer that only
  // knows its cell can miss a small one drawn between cell middles), the project folder never.
  let best: MapTarget | undefined
  let bestD = Infinity
  for (const t of sorted) {
    if (t.id === 'root') continue
    const dx = Math.max(t.x - mx, 0, mx - (t.x + t.w)) * v.k
    const dy = Math.max(t.y - my, 0, my - (t.y + t.h)) * v.k
    const d = Math.hypot(dx, dy)
    if (d <= reach && d < bestD) {
      best = t
      bestD = d
    }
  }
  return best
}

/**
 * A click on something on the map: a file opens; a folder folds or unfolds (with Ctrl it opens in
 * the file manager); the outside folder's chip hides it; the drawn root opens the project.
 */
const pressTarget = async ($: EngineInterface, t: MapTarget, ctrl: boolean) => {
  if (t.kind === 'hide') {
    await write?.(c => ({ ...c, hideOutside: true }))
    return void $.ui.toast('Files outside the project are hidden. "show outside" below the map brings them back.')
  }
  if (t.kind === 'dir' && t.fold !== undefined && !(ctrl && t.path)) {
    const folded = lastFrame.folded.includes(t.fold)
    return void (await write?.(c => ({ ...c, folds: { ...(c.folds ?? {}), [t.fold!]: folded ? 'open' : 'closed' } })))
  }
  if (t.kind === 'dir' && !t.path) return
  const c = await read($, crew)
  await openAndSay($, t.kind === 'dir' ? 'dir' : 'file', t.path, t.name, (c.changes[t.path]?.edits ?? 0) > 0)
}

let searchRev = 0
/** Searches the map: a new text shows its first hit, the same text again (Enter) the next one. */
const searchFor = async ($: EngineInterface, typed: string, next = false) => {
  const q = typed.slice(0, 80)
  const rev = ++searchRev
  await update($, search, cur => (next && cur.q === q ? { q, i: cur.i + 1, rev } : { q, i: 0, rev }))
  await update($, mapView, v => ({ ...v, follow: q.trim() ? rev : 0 }))
}

/** What the pointer rests on, as last written: spared a read on every mouse move. */
let hoverMirror = ''
/** A move of the window waiting its turn: a zoom (presses in a row compound into one) and/or a nudge (the arrows; presses add up). */
type ViewWant = { zoom?: number; at?: [number, number]; nudge?: [number, number] }
let viewWant: ViewWant | null = null
let viewBusy = false
let lastViewWriteAt = 0
let renderDone: (() => void) | null = null
/** How long a frame takes here: from a window write to the draw it causes, and the draw itself. */
const perf = { frames: 0, chainMs: 0, renderMs: 0 }
/**
 * Moves the map's window. One write and the draw it causes are in flight at a time; a move that
 * arrives meanwhile replaces the one waiting (zooms compound), so frames never pile up behind a slow
 * one and the picture always goes to the newest position. Returns at once; the move lands shortly.
 */
const wantView = async ($: EngineInterface, want: ViewWant) => {
  // Both kinds wait together: zooms multiply, nudges add up.
  const was = viewWant
  viewWant = was
    ? {
        zoom: (was.zoom ?? 1) * (want.zoom ?? 1),
        at: want.at ?? was.at,
        nudge: was.nudge || want.nudge ? [(was.nudge?.[0] ?? 0) + (want.nudge?.[0] ?? 0), (was.nudge?.[1] ?? 0) + (want.nudge?.[1] ?? 0)] : undefined,
      }
    : want
  if (viewBusy) return
  viewBusy = true
  try {
    while (viewWant) {
      const w = viewWant
      viewWant = null
      const f = lastFrame
      if (!f.vw) continue
      let next: { x: number; y: number; k: number }
      let rev: string
      const from = f.view
      const k = Math.min(f.kMax, Math.max(f.kMin, from.k * (w.zoom ?? 1)))
      const [hx, hy] = w.at ?? [f.vw / 2, f.vh / 2]
      let x = from.x + hx / from.k - hx / k
      let y = from.y + hy / from.k - hy / k
      if (w.nudge) {
        // A nudge shows more of the map, never empty space past its edge.
        const nx = x + (w.nudge[0] * f.vw) / k / 2
        const ny = y + (w.nudge[1] * f.vh) / k / 2
        x = Math.min(Math.max(nx, Math.min(0, x)), Math.max(x, f.mw - f.vw / k))
        y = Math.min(Math.max(ny, Math.min(0, y)), Math.max(y, f.mh - f.vh / k))
      }
      next = clampView({ x, y, k }, f)
      rev = `${w.nudge ? 'm' : 'r'}${++viewRev}`
      lastViewWriteAt = Date.now()
      await update($, mapView, v => ({ ...v, ...next, auto: false, follow: 0, rev }))
      // Wait for the draw this write causes (or 250 ms, should none come), then take the next move.
      await new Promise<void>(resolve => {
        const fallback = $.clock.after(250, () => {
          renderDone = null
          resolve()
        })
        renderDone = () => {
          fallback.cancel()
          resolve()
        }
      })
    }
  } finally {
    viewBusy = false
  }
}
/** Moves the map's window by half of it, in each direction given (-1, 0 or 1). */
const nudgeView = ($: EngineInterface, dx: number, dy: number) => {
  lastInputAt = Date.now()
  void wantView($, { nudge: [dx, dy] })
}
/** Zooms the map's window by `factor` about a point of it (window pixels; default its middle). */
const zoomBy = ($: EngineInterface, factor: number, at?: [number, number]) => wantView($, { zoom: factor, at })

/** Something on the drawn map a click opens: a file, a folder group, in map units. */
type MapTarget = { id: string; kind: 'file' | 'dir' | 'hide'; path: string; name: string; fold?: string; x: number; y: number; w: number; h: number }
/** The outside folder's hide chip, beside its icon (relative to the icon's top-left). */
const HIDE_CHIP = { x: 48, y: -2, w: 44, h: 16 }

/**
 * The desktop pane's text cell in CSS pixels: what turns a spot on the map
 * picture into the rows and columns overlays are placed by. The engine does not
 * say; these match the app's code font (a 19 px line, 7.9 px advance).
 */
const CELL_W = 7.9
/** A space the pane keeps: plain spaces in a button would collapse and leave nothing to click. */
const BLANK = '\u00A0'
const CELL_H = 19

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
/**
 * A name cut to fit, keeping its start (what tells files apart) and its
 * extension: `problems-stuck-budget.test.mjs` → `problems-stu….mjs`.
 */
const midTrunc = (s: string, n: number) => {
  if (s.length <= n) return s
  // Both ends: the start, and the end with its extension (`an-extremely-long-alpha.ts` → `an-extre…alpha.ts`).
  const tail = Math.max(Math.min(s.match(/\.[^.\/]{1,6}$/)?.[0].length ?? 0, n - 4), Math.floor((n - 1) / 2))
  return `${s.slice(0, n - 1 - tail)}…${s.slice(s.length - tail)}`
}

/**
 * Names cut to `n` characters that stay told apart: where two would cut to the same text, each
 * shows the part where they start to differ instead (`…name-1-that-g…` and `…name-2-that-g…`).
 */
const distinctCuts = (names: string[], n: number): string[] => {
  const cut = names.map(x => midTrunc(x, n))
  const same = new Map<string, number[]>()
  cut.forEach((c, i) => same.set(c, [...(same.get(c) ?? []), i]))
  for (const idx of same.values()) {
    if (idx.length < 2) continue
    const list = idx.map(i => names[i])
    let p = 0
    while (p < list[0].length && list.every(x => x[p] === list[0][p])) p++
    for (const i of idx) {
      const x = names[i]
      if (x.length <= n) continue
      const start = Math.max(0, Math.min(p - 6, x.length - (n - 1)))
      const room = n - (start > 0 ? 1 : 0)
      const body = start + room >= x.length ? x.slice(start) : x.slice(start, start + room - 1)
      cut[i] = `${start > 0 ? '…' : ''}${body}${start + body.length < x.length ? '…' : ''}`
    }
  }
  return cut
}

const IW = 38
const IH = 46
/** The outline around a file icon (search hit, hover, linked files): 8 out at the top and sides, 4 below, clear of the name under it. */
const RING_H = IH + 12
const SWING_MS = 1800
/** Where the worked-files folder sits on the map, in map pixels. */
const FOLDER = { x: 18, y: 16, w: 84, h: 64 }

/**
 * A layered map: the worked-files folder as its root on the left, files that
 * nothing imports beside it, each import a row below its importer, dashed
 * links between, and a Claude with a bubble over each file someone is on.
 *
 * Looping animations take their phase from the clock, so a redraw continues
 * them rather than restarting them; a Claude that just moved swings along the
 * curve from its old file to its new one.
 */
/** The most an Svg source may hold; a map past it is drawn again in a lighter style. */
const SVG_LIMIT = 131_072

const mindMap = (c: Crew, W: number, now: number, codex: CodexRun[] = [], lite = false, q = '') => {
  const nodes = Object.values(c.nodes)
  const allFiles = nodes.filter(n => n.kind !== 'special')
  // Files outside the project, when the person hid them (only where there is a project to be outside of).
  const outsideOf = (n: MapNode) => !!sessionDir && !n.id.startsWith('demo/') && groupOf(n.id) === OUTSIDE
  const outsideHidden = c.hideOutside ? allFiles.filter(outsideOf).length : 0
  const files = outsideHidden ? allFiles.filter(n => !outsideOf(n)) : allFiles
  const tools = nodes.filter(n => n.kind === 'special')
  let live = c.agents.filter(a => (a.state === 'busy' || a.state === 'thinking') && a.node && c.nodes[a.node] && !(outsideHidden && outsideOf(c.nodes[a.node])))
  const ql = q.trim().toLowerCase()
  const isHit = (id: string) => !!ql && !!c.nodes[id] && c.nodes[id].kind !== 'special' && (c.nodes[id].label.toLowerCase().includes(ql) || (sessionDir && id.startsWith(`${sessionDir}/`) ? id.slice(sessionDir.length + 1) : id).toLowerCase().includes(ql))
  const waiting = new Set(codex.filter(r => r.status === 'running').map(r => r.caller))
  const act = (a: Agent): [string, string] =>
    waiting.has(a.id) && (a.state !== 'busy' || /__codex$/.test(a.tool))
      ? ['Waiting on Codex', CX]
      : a.stuck
        ? [`Stuck? ${activityOf(a)[0]}`, '#FF7B72']
        : activityOf(a)
  const ids = new Set(files.map(n => n.id))
  const links: [string, string][] = []
  for (const n of files) for (const t of n.imports) if (ids.has(t) && t !== n.id) links.push([n.id, t])

  // A loop's phase is the clock the picture is shown at (--clk, set on the window's <svg> each draw), so
  // a cached map drawn again carries on where it was rather than restarting: no jolt in a bob or a blink.
  const loop = (name: string, dur: number, off = 0, ease = 'ease-in-out') =>
    `transform-box:fill-box;animation:${name} ${dur}s ${ease} infinite;animation-delay:calc(-1s * var(--clk, 0) - ${off.toFixed(2)}s)`

  // A tidy tree. Every file hangs under one parent (the first importer a
  // breadth-first walk from the top-level files reaches); each subtree owns a
  // band of slots no other subtree touches, and a parent sits centred over its
  // children. Branches are drawn only parent-to-child inside a parent's own
  // band, so no two lines cross or lie on each other and no line meets a
  // file. Imports beyond the tree are counted under the file instead.
  const LEFT = 44
  const COL = 120
  const ROW = 210
  const TOP = 276
  const rowY = (r: number) => TOP + r * ROW
  const kidsOf = new Map<string, string[]>()
  const parentOf = new Map<string, string>()
  const treeRoots: string[] = []
  {
    const importersOf = new Map<string, string[]>()
    for (const [a, b] of links) importersOf.set(b, [...(importersOf.get(b) ?? []), a])
    const seen = new Set<string>()
    const byName = (x: string, y: string) => c.nodes[x].label.localeCompare(c.nodes[y].label) || x.localeCompare(y)
    const tops = files.filter(n => !importersOf.has(n.id)).map(n => n.id).sort(byName)
    const walk = (startIds: string[]) => {
      const queue = [...startIds]
      for (const id of startIds) seen.add(id)
      for (let i = 0; i < queue.length; i++) {
        const kids = links
          .filter(([a, b]) => a === queue[i] && !seen.has(b))
          .map(([, b]) => b)
          .filter((b, k, all) => all.indexOf(b) === k)
          .sort(byName)
        for (const k of kids) {
          seen.add(k)
          parentOf.set(k, queue[i])
          queue.push(k)
        }
        kidsOf.set(queue[i], kids)
      }
    }
    treeRoots.push(...tops)
    walk(tops)
    // Files only reachable through a cycle start trees of their own.
    for (const n of files)
      if (!seen.has(n.id)) {
        treeRoots.push(n.id)
        walk([n.id])
      }
  }
  // Trees pack left to right and wrap into bands below, so the map keeps its
  // full size instead of shrinking to fit one very wide row.
  const toolsW = tools.length ? 100 : 0
  const fit = Math.max(1, Math.floor((W - 2 * LEFT - toolsW) / COL))

  // Folders: top-level files gather under a node for their folder (relative
  // to the session's), files outside the project under one of their own, so
  // the root branches by folder and a file's name needs no folder in front.
  const dirMeta = new Map<string, { label: string; outside: boolean; files: number; group: string; folded: boolean }>()
  /** Each file's folder node, for a Claude on a file inside a folded folder. */
  const dirOfNode = new Map<string, string>()
  {
    const byGroup = new Map<string, string[]>()
    for (const r of treeRoots) byGroup.set(groupOf(r), [...(byGroup.get(groupOf(r)) ?? []), r])
    if (byGroup.size > 1) {
      const order = [...byGroup.keys()].sort(
        (a, b) => Number(a === OUTSIDE) - Number(b === OUTSIDE) || Number(b === '.') - Number(a === '.') || a.localeCompare(b),
      )
      const grouped: string[] = []
      for (const g of order) {
        const rs = byGroup.get(g) ?? []
        const id = `dir:${g}`
        const size = (n: string): number => 1 + (kidsOf.get(n) ?? []).reduce((m, k) => m + size(k), 0)
        dirMeta.set(id, { label: g === OUTSIDE ? 'outside project' : g === '.' ? 'project root' : g, outside: g === OUTSIDE, files: rs.reduce((m, r) => m + size(r), 0), group: g, folded: false })
        kidsOf.set(id, rs)
        for (const r of rs) parentOf.set(r, id)
        grouped.push(id)
      }
      treeRoots.splice(0, treeRoots.length, ...grouped)
    }
  }
  // A folder folds up when the person folds it, or by itself once nothing in it was touched for a
  // while (unless a Claude is in it, or it is small); a search hit inside always opens it.
  for (const [id, meta] of dirMeta) {
    const inside: string[] = []
    const walkIn = (k: string) => {
      inside.push(k)
      dirOfNode.set(k, id)
      for (const kk of kidsOf.get(k) ?? []) walkIn(kk)
    }
    for (const r of kidsOf.get(id) ?? []) walkIn(r)
    const newest = Math.max(0, ...inside.map(k => c.nodes[k]?.touchedAt ?? 0))
    const busyInside = live.some(a => inside.includes(a.node))
    const choice = c.folds?.[meta.group]
    const folded = !inside.some(isHit) && (choice === 'closed' || (choice !== 'open' && !busyInside && inside.length >= 3 && now - newest > FOLD_MS))
    if (folded) {
      meta.folded = true
      kidsOf.set(id, [])
    }
  }
  // Linked trees first, single loose files after them.
  treeRoots.sort((x, y) => Number(!(kidsOf.get(x)?.length ?? 0)) - Number(!(kidsOf.get(y)?.length ?? 0)))

  // A parent with more children than fit across wraps them into rows, each
  // fed by its own bar off a spine down its left side, so no row runs wider
  // than the map. Children with branches of their own wrap too.
  const GRID_ROW = 190
  const DIR_STEP = 170
  const gridCols = Math.max(2, Math.min(10, fit))
  const stepOf = (id: string) => (dirMeta.has(id) ? DIR_STEP : ROW)
  const span = new Map<string, number>()
  /** A parent's children in rows, where they wrap. */
  const rowsOf = new Map<string, string[][]>()
  const width = (id: string): number => {
    const kids = kidsOf.get(id) ?? []
    const ws = kids.map(width)
    const total = ws.reduce((n, w) => n + w, 0)
    let w = Math.max(1, total)
    rowsOf.delete(id)
    if (kids.length > 1 && total > gridCols) {
      const cap = Math.max(gridCols, ...ws)
      const rows: string[][] = [[]]
      let used = 0
      kids.forEach((k, i) => {
        if (used + ws[i] > cap && rows[rows.length - 1].length) {
          rows.push([])
          used = 0
        }
        rows[rows.length - 1].push(k)
        used += ws[i]
      })
      rowsOf.set(id, rows)
      w = cap
    }
    span.set(id, w)
    return w
  }
  const rowsFor = (id: string) => rowsOf.get(id) ?? [kidsOf.get(id) ?? []]
  /** How far below a node its lowest descendant sits, in map pixels. */
  const deep = new Map<string, number>()
  const depthPx = (id: string): number => {
    const known = deep.get(id)
    if (known !== undefined) return known
    const kids = kidsOf.get(id) ?? []
    const rows = rowsFor(id)
    const d = kids.length ? stepOf(id) + rows.reduce((n, r, i) => n + Math.max(0, ...r.map(depthPx)) + (i < rows.length - 1 ? GRID_ROW : 0), 0) : 0
    deep.set(id, d)
    return d
  }
  type Cell = Spot & { depth: number; slot0: number; slots: number; band: number; x0: number }
  const pos = new Map<string, Cell>()
  const place = (id: string, slot0: number, depth: number, y: number, band: number, x0: number) => {
    const w = span.get(id) ?? 1
    pos.set(id, { x: x0 + (slot0 + w / 2) * COL, y, depth, slot0, slots: w, band, x0 })
    const rows = rowsFor(id)
    let rowTop = y + stepOf(id)
    for (const r of rows) {
      const used = r.reduce((n, k) => n + (span.get(k) ?? 1), 0)
      // A wrapped row sits centred under the full ones.
      let at = slot0 + (rows.length > 1 ? (w - used) / 2 : 0)
      for (const k of r) {
        place(k, at, depth + 1, rowTop, band, x0)
        at += span.get(k) ?? 1
      }
      rowTop += Math.max(0, ...r.map(depthPx)) + GRID_ROW
    }
  }
  const bands: { roots: string[]; slots: number; depth: number; y: number; x0: number }[] = []
  for (const r of treeRoots) {
    const w = width(r)
    let band = bands[bands.length - 1]
    if (!band || band.slots + w > fit) {
      band = { roots: [], slots: 0, depth: 0, y: 0, x0: LEFT }
      bands.push(band)
    }
    band.roots.push(r)
    band.slots += w
    band.depth = Math.max(band.depth, depthPx(r))
  }
  let bandTop = TOP
  bands.forEach((b, i) => {
    b.y = bandTop
    // Each band is centred, so every level sits under the one above like a tree.
    b.x0 = LEFT + Math.max(0, ((fit - b.slots) * COL) / 2)
    let at = 0
    for (const r of b.roots) {
      place(r, at, 0, b.y, i, b.x0)
      at += span.get(r) ?? 1
    }
    // Room under the lowest row for its names and counts, then the next band's trunk.
    bandTop += b.depth + ROW + 24
  })
  // Codex: a tree of its own under the Claudes': Codex, its threads, and the
  // files each thread looked at (dashed) or changed (solid), newest first.
  const shownRuns = codex.filter(r => r.status === 'running' || now - (r.endedAt || now) < CODEX_KEEP_MS)
  const groups = new Map<string, CodexRun[]>()
  for (const r of shownRuns) groups.set(r.thread || 'one-off', [...(groups.get(r.thread || 'one-off') ?? []), r])
  const groupList = [...groups.entries()]
    .sort(
      (x, y) =>
        Number(y[1].some(r => r.status === 'running')) - Number(x[1].some(r => r.status === 'running')) || y[1][0].startedAt - x[1][0].startedAt,
    )
    .slice(0, 4)
  type CxMeta = { kind: 'root' | 'thread' | 'file'; label: string; path?: string; edit?: boolean; runs?: CodexRun[] }
  const cxMeta = new Map<string, CxMeta>()
  let cxSlots = 0
  if (groupList.length) {
    const kids: string[] = []
    cxMeta.set(CX_ROOT, { kind: 'root', label: 'Codex' })
    for (const [name, rs] of groupList) {
      const tid = `cx:t:${name}`
      kids.push(tid)
      cxMeta.set(tid, { kind: 'thread', label: name, runs: rs })
      const edits = new Map<string, boolean>()
      for (const t of rs.flatMap(r => r.touched).sort((x, y) => y.at - x.at)) edits.set(t.path, (edits.get(t.path) ?? false) || t.kind === 'edit')
      const fileIds = [...edits].slice(0, lite ? 3 : 6).map(([p, edit]) => {
        const fid = `cx:f:${name}:${p}`
        cxMeta.set(fid, { kind: 'file', label: baseName(p), path: p, edit })
        kidsOf.set(fid, [])
        return fid
      })
      kidsOf.set(tid, fileIds)
    }
    kidsOf.set(CX_ROOT, kids)
    cxSlots = width(CX_ROOT)
    const x0 = LEFT + Math.max(0, ((fit - cxSlots) * COL) / 2)
    place(CX_ROOT, 0, 0, bandTop - 40, bands.length, x0)
  }
  const slots = Math.max(1, cxSlots, ...bands.map(b => b.slots))
  const toolX = LEFT + Math.max(fit, slots) * COL + toolsW / 2
  tools.forEach((n, i) => pos.set(n.id, { x: toolX, y: TOP + i * 112, depth: i, slot0: slots, slots: 1, band: 0, x0: LEFT }))
  const needW = Math.max(W, LEFT + Math.max(fit, slots) * COL + toolsW + 16)
  // The folder is the root, centred over the top-level files.
  const firstRow = (bands[0]?.roots ?? []).map(id => pos.get(id)!.x)
  const foldCx = firstRow.length ? (Math.min(...firstRow) + Math.max(...firstRow)) / 2 : needW / 2
  const fold = { x: foldCx - FOLDER.w / 2, y: FOLDER.y, w: FOLDER.w, h: FOLDER.h }
  const H = Math.max(240, Math.max(TOP, ...[...pos.values()].map(p => p.y)) + 104)
  const stemTop = (p: Spot) => p.y + IH / 2 + 56
  const busY = (p: Spot) => p.y + IH / 2 + 70
  const trunkOf = (band: number) => (bands[band]?.y ?? TOP) - IH / 2 - 78
  const CORRIDOR = LEFT - 18
  const alsoFrom = (id: string) => links.filter(([a, b]) => b === id && parentOf.get(id) !== a).map(([a]) => a)

  const seatOf = (id: string) => (!id || pos.has(id) ? id : dirOfNode.get(id) && pos.has(dirOfNode.get(id)!) ? dirOfNode.get(id)! : id)
  live = live.map(a => {
    const node = seatOf(a.node)
    const from = seatOf(a.from)
    return node === a.node && from === a.from ? a : { ...a, node, from: from === node ? '' : from }
  })
  const dupes = new Set(nodes.map(n => n.label).filter((l, i, all) => all.indexOf(l) !== i))
  const nameOf = (n: MapNode) =>
    dirMeta.has(parentOf.get(n.id) ?? '') ? n.label : dupes.has(n.label) && n.dir ? `${baseName(n.dir)}/${n.label}` : n.label
  // Each file's name as drawn: cut to 17, and told apart from any other that would cut the same.
  const drawnNames = new Map<string, string>()
  {
    const cuts = distinctCuts(files.map(nameOf), 17)
    files.forEach((n, i) => drawnNames.set(n.id, cuts[i]))
  }

  /** A polyline with its corners rounded. */
  let s = ''
  const busy = new Set(live.map(a => a.node))
  const arrowDown = (x: number, y: number, color: string) =>
    `<path d="M${(x - 5).toFixed(1)} ${(y - 9).toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}L${(x + 5).toFixed(1)} ${(y - 9).toFixed(1)}Z" fill="${color}"/>`
  const DOTS = 'class="d"'
  const topY = (p: Spot) => p.y - IH / 2 - 3

  // The folder: the map's root, a gold trunk along the top dropping into each top-level file.
  const GOLD = 'stroke="#D4A245" ' + DOTS + ' opacity=".95"'
  if (bands.length) {
    const t0 = trunkOf(0)
    s += `<path d="M${foldCx.toFixed(1)} ${fold.y + fold.h + 58}V${t0}" ${GOLD}/>`
    bands.forEach((b, i) => {
      const cells = b.roots.map(id => pos.get(id)!).filter(Boolean)
      if (!cells.length) return
      const ty = trunkOf(i)
      const xs = cells.map(q => q.x)
      const lo = Math.min(...xs, i === 0 ? foldCx : CORRIDOR, i === 0 && bands.length > 1 ? CORRIDOR : Infinity)
      const hi = Math.max(...xs, i === 0 ? foldCx : -Infinity)
      s += `<path d="M${lo.toFixed(1)} ${ty}H${hi.toFixed(1)}" ${GOLD}/>`
      for (const q of cells) {
        s += `<path d="M${q.x.toFixed(1)} ${ty}V${topY(q).toFixed(1)}" ${GOLD}/>`
        s += arrowDown(q.x, topY(q), '#D4A245')
      }
    })
    if (bands.length > 1) s += `<path d="M${CORRIDOR} ${t0}V${trunkOf(bands.length - 1)}" ${GOLD}/>`
  }

  // Branches: parent stem, a bar across its children, a drop into each.
  const EDGE = ['#7AA2F7', '#9ECE6A', '#E0AF68', '#BB9AF7', '#7DCFFF', '#F7768E', '#73DACA', '#FF9E64']
  let hueAt = 0
  for (const [id, kids] of kidsOf) {
    if (!kids.length || !pos.has(id)) continue
    const p = pos.get(id)!
    const dirNode = dirMeta.get(id)
    const color = id.startsWith('cx:') ? CX : dirNode?.outside ? '#6B7280' : EDGE[hueAt++ % EDGE.length]
    const hot = busy.has(id) || kids.some(k => busy.has(k))
    const op = hot ? 1 : 0.85
    // A folder node is short, so its stem starts and its bar runs higher than a file's.
    const stem0 = dirNode ? p.y + 44 : stemTop(p)
    const bar0 = dirNode ? p.y + 66 : busY(p)
    // One bar per row of children: the first fed by the stem, the rest by a spine down the left.
    const rows = new Map<number, string[]>()
    for (const k of kids) {
      const y = Math.round(pos.get(k)!.y)
      rows.set(y, [...(rows.get(y) ?? []), k])
    }
    const rowList = [...rows.entries()].sort((a, b) => a[0] - b[0])
    const spineX = Math.min(...kids.map(k => pos.get(k)!.x - ((span.get(k) ?? 1) * COL) / 2)) - 3 - ((p as { depth?: number }).depth ?? 0) % 3 * 4
    const barOf = (rowY: number, i: number) => (i === 0 ? bar0 : rowY - IH / 2 - 72)
    s += `<path d="M${p.x.toFixed(1)} ${stem0.toFixed(1)}V${bar0.toFixed(1)}" stroke="${color}" ${DOTS} opacity="${op}"/>`
    if (rowList.length > 1)
      s += `<path d="M${spineX.toFixed(1)} ${bar0.toFixed(1)}V${barOf(rowList[rowList.length - 1][0], rowList.length - 1).toFixed(1)}" stroke="${color}" ${DOTS} opacity="${op}"/>`
    rowList.forEach(([rowY, rowKids], i) => {
      const by = barOf(rowY, i)
      const xs = rowKids.map(k => pos.get(k)!.x)
      const lo = Math.min(...xs, ...(i === 0 ? [p.x] : []), ...(rowList.length > 1 ? [spineX] : []))
      const hi = Math.max(...xs, ...(i === 0 ? [p.x] : []))
      if (hi - lo > 1) s += `<path d="M${lo.toFixed(1)} ${by.toFixed(1)}H${hi.toFixed(1)}" stroke="${color}" ${DOTS} opacity="${op}"/>`
      for (const k of rowKids) {
        const q = pos.get(k)!
        s += `<path d="M${q.x.toFixed(1)} ${by.toFixed(1)}V${topY(q).toFixed(1)}" stroke="${color}" ${DOTS} opacity="${busy.has(k) || busy.has(id) ? 1 : 0.85}"/>`
        s += arrowDown(q.x, topY(q), color)
      }
    })
  }

  // Folder nodes: a small folder, its path, and how many files hang under it.
  for (const [id, meta] of dirMeta) {
    const p = pos.get(id)
    if (!p) continue
    const body = meta.outside ? '#6B7280' : '#C9A24A'
    const tab = meta.outside ? '#8B949E' : '#E3B95C'
    s += `<g transform="translate(${(p.x - 17).toFixed(1)},${(p.y - 14).toFixed(1)})">`
    if (meta.folded) s += `<rect x="6" y="-6" width="30" height="24" rx="3" fill="#0D1117" stroke="${tab}" stroke-width="1.2" opacity=".7"/><rect x="3" y="-3" width="30" height="24" rx="3" fill="#0D1117" stroke="${tab}" stroke-width="1.2" opacity=".85"/>`
    s += `<path d="M0 4a3 3 0 0 1 3-3h9l4 4h15a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3z" fill="${body}"/><path d="M0 9a3 3 0 0 1 3-3h28a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3z" fill="${tab}"/>`
    // Its own name in bold; the folders above it, dimmer, with the file count.
    const parts = meta.label.split('/')
    const name = parts[parts.length - 1]
    const above = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    s += `<text x="17" y="${26 + 14}" text-anchor="middle" class="m" font-size="11" font-weight="700" fill="${meta.outside ? '#9CA3AF' : '#F0D58C'}">${esc(meta.outside || meta.label === 'project root' ? meta.label : midTrunc(name, 17))}</text>`
    const count = `${meta.folded ? '▸' : '▾'} ${fmtK(meta.files)} file${meta.files === 1 ? '' : 's'}`
    s += `<text x="17" y="${26 + 27}" text-anchor="middle" class="m" font-size="9.5" fill="${meta.folded ? '#E3B95C' : '#8B949E'}">${esc(above ? `${meta.folded ? '▸' : '▾'} ${fmtK(meta.files)} · in ${above.length > 9 ? `…${above.slice(-8)}` : above}` : count)}</text>`
    // The outside folder can be hidden altogether.
    if (meta.outside && sessionDir) s += `<g transform="translate(${HIDE_CHIP.x},${HIDE_CHIP.y})"><rect width="${HIDE_CHIP.w}" height="${HIDE_CHIP.h}" rx="8" fill="#161B22" stroke="#6B7280" stroke-width="1"/><text x="${HIDE_CHIP.w / 2}" y="11.5" text-anchor="middle" font-size="9.5" fill="#B8C1CC">✕ hide</text></g>`
    s += '</g>'
  }

  /** Where a Claude sits over a file, as the centre of its sprite. */
  const SPR = { w: 16 * 2.2, h: 9 * 2.2 }
  const seat = (p: Spot, slot: number, of: number) => ({ x: p.x + (slot - 0.5 * (of - 1)) * 40, y: p.y - IH / 2 - 8 - SPR.h / 2 })
  /** A hop up or down its own column (a file under another): it swings out to the side instead of across. */
  const isStraight = (a: Spot, b: Spot) => Math.abs(b.x - a.x) < 40
  /**
   * A hop's path. Up or down its own column: out to the side, clear of the files between, and down
   * onto the top of the file it goes to (going down it swings out to the right, going up to the left,
   * rising over the file before it drops onto it). Across: a low arc that rises a little over the
   * higher end (more for a longer hop, never more than 60), its curve spread evenly along the way.
   */
  const arc = (pts: Spot[]) => {
    const a = pts[0]
    const b = pts[pts.length - 1]
    const n = (v: number) => v.toFixed(1)
    if (isStraight(a, b)) {
      const dy = Math.abs(b.y - a.y)
      // How far out: past an icon's half-width and its name, short of the next column (120 away).
      const side = Math.min(110, 70 + dy * 0.08)
      const down = b.y > a.y
      const sx = down ? 1 : -1
      // Down: up and out first, then down onto the top of the file. Up: out and up past the file, then down onto it.
      const c1 = down ? { x: a.x + sx * side, y: a.y - 40 } : { x: a.x + sx * side, y: a.y - dy * 0.35 }
      const c2 = down ? { x: b.x + sx * side, y: b.y - 70 } : { x: b.x + sx * side * 0.7, y: b.y - 80 }
      return `M${n(a.x)} ${n(a.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}`
    }
    const lift = Math.min(60, 16 + Math.abs(b.x - a.x) * 0.1)
    const top = Math.min(a.y, b.y) - lift
    const c1 = { x: a.x + (b.x - a.x) * 0.25, y: top }
    const c2 = { x: a.x + (b.x - a.x) * 0.75, y: top }
    return `M${n(a.x)} ${n(a.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}`
  }
  const hopLength = (pts: Spot[]) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)
  const hopMs = (pts: Spot[]) => Math.min(SWING_MS, Math.max(700, hopLength(pts) * 2.4))

  // A jump leaves a fading trail along its path.
  for (const a of live) {
    const p = a.from ? pos.get(a.from) : undefined
    const q = pos.get(a.node)
    if (!p || !q) continue
    const pts = [seat(p, 0, 1), seat(q, 0, 1)]
    const ms = hopMs(pts)
    const t = now - a.movedAt
    if (t >= ms) continue
    s += `<path d="${arc(pts)}" stroke="${colorOf(a)}" stroke-width="2.6" stroke-linecap="round" fill="none" opacity="0"><animate attributeName="opacity" values="0;.9;.9;0" keyTimes="0;.1;.75;1" dur="${(ms / 1000).toFixed(2)}s" begin="${(-t / 1000).toFixed(2)}s" fill="freeze"/></path>`
  }

  // Files.
  for (const n of files) {
    const p = pos.get(n.id)
    if (!p) continue
    const [badge, color] = fileType(n.id)
    const here = live.filter(a => a.node === n.id)
    const ghost = n.kind === 'ghost'
    const edited = !!(c.changes[n.id] && (c.changes[n.id].edits || c.changes[n.id].added || c.changes[n.id].removed))
    const edge = here.length > 1 ? '#E3B341' : here.length ? colorOf(here[0]) : ghost ? '#4B5563' : edited ? EDITED : '#E8DFC8'
    const writing = here.some(a => a.state === 'busy' && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(a.tool))
    const ch = c.changes[n.id]
    const away = dirMeta.size > 0 && groupOf(n.id) === OUTSIDE
    const hit = isHit(n.id)
    // Files nobody touched for a while fade back, so the current work stands out.
    const old = !here.length && !hit && now - (n.touchedAt || 0) > FADE_MS
    const op = hit ? 1 : (ghost ? 0.5 : away ? 0.65 : 1) * (old ? 0.4 : 1)
    // The icon fades; the name keeps a readable contrast (4.5:1 or better on the map's black).
    s += `<g transform="translate(${(p.x - IW / 2).toFixed(1)},${(p.y - IH / 2).toFixed(1)})"><g${op < 1 ? ` opacity="${+op.toFixed(2)}"` : ''}>`
    if (hit) s += `<rect x="-8" y="-8" width="${IW + 16}" height="${RING_H}" rx="9" fill="#FFFFFF" fill-opacity=".08" stroke="#FFFFFF" stroke-width="2"/>`
    if (here.length) s += `<rect x="-6" y="-6" width="${IW + 12}" height="${RING_H - 2}" rx="8" fill="${edge}" opacity=".14"/>`
    s += `<path d="M0 0H${IW - 10}L${IW} 10V${IH}H0Z" fill="#0D1117" stroke="${edge}" stroke-width="${here.length ? 2.4 : 2}" stroke-linejoin="round"${ghost ? ' stroke-dasharray="4 3"' : ''}/>`
    s += `<path d="M${IW - 10} 0V10H${IW}" fill="none" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/>`
    for (let i = 0; i < (lite ? 0 : 4); i++) {
      const w = [22, 16, 24, 12][(i + hash(n.id)) % 4]
      const ly = 12 + i * 6
      const anim = writing && i === 3 ? ` style="transform-origin:left center;${loop('write', 1.1, 0, 'steps(4,end)')}"` : ''
      s += `<path d="M6 ${ly} q${w / 4} -2 ${w / 2} 0 t${w / 2} 0" class="q" stroke="${color}"${anim}/>`
    }
    const bw = badge.length * 5.6 + 6
    s += `<rect x="-4" y="${IH - 12}" width="${bw}" height="11" rx="2" fill="${color}"/><text x="${bw / 2 - 4}" y="${IH - 3.6}" text-anchor="middle" font-size="7.5" font-weight="800" fill="#0D1117">${esc(badge)}</text>`
    if (isTest(n.id))
      s += `<circle cx="${IW}" cy="${IH - 2}" r="5.5" fill="#2EA043"/><path d="M${IW - 2.6} ${IH - 2}l1.8 1.8 3.2-3.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`
    // A file a build or test failed on: a red outline and a count of its errors.
    const errs = (c.problems ?? []).filter(pr => pr.path === n.id).length
    if (errs) {
      s += `<path d="M-3 -3H${IW - 9}L${IW + 3} 9V${IH + 3}H-3Z" fill="none" stroke="#F85149" stroke-width="1.6" stroke-linejoin="round" style="${loop('pulse', 1.6)}"/>`
      s += `<circle cx="${IW - 1}" cy="1" r="8" fill="#DA3633" stroke="#0D1117" stroke-width="1.5"/><text x="${IW - 1}" y="4.6" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff">${errs > 9 ? '9+' : errs}</text>`
    }
    s += '</g>'
    s += `<text x="${IW / 2}" y="${IH + 15}" text-anchor="middle" class="m" font-size="11" font-weight="600" fill="${errs ? '#FF7B72' : op < 1 ? '#9CA3AF' : '#E6E0D4'}">${esc(drawnNames.get(n.id) ?? midTrunc(nameOf(n), 17))}</text>`
    if (ch && (ch.added || ch.removed))
      s += `<text x="${IW / 2}" y="${IH + 27}" text-anchor="middle" class="m" font-size="9.5"><tspan fill="#3FB950">+${fmtK(ch.added)}</tspan> <tspan fill="#F85149">−${fmtK(ch.removed)}</tspan></text>`
    const also = lite ? [] : alsoFrom(n.id).map(id => c.nodes[id]?.label ?? baseName(id))
    if (also.length) {
      const lines: string[] = []
      let cur = '← also '
      for (const name of also) {
        const piece = (cur.endsWith(' ') ? '' : ', ') + name
        if ((cur + piece).length > 20 && lines.length < 1) {
          lines.push(cur)
          cur = name
        } else cur += piece
      }
      lines.push(trunc(cur, 21))
      lines.forEach((l, i) => {
        s += `<text x="${IW / 2}" y="${IH + 40 + i * 12}" text-anchor="middle" class="m" font-size="9.5" fill="#B8C1CC">${esc(l)}</text>`
      })
    }
    s += '</g>'
  }

  const underTrees = s.length
  // Codex's tree: its badge, its threads, and the files they worked on.
  for (const [id, m] of cxMeta) {
    const p = pos.get(id)
    if (!p) continue
    if (m.kind === 'root') {
      const latest = groupList[0]?.[1][0]
      const on = shownRuns.some(r => r.status === 'running')
      s += `<g transform="translate(${(p.x - 72).toFixed(1)},${(p.y - 26).toFixed(1)})">`
      s += `<rect width="144" height="52" rx="12" fill="#0B231C" stroke="${CX}" stroke-width="${on ? 2.6 : 1.8}"/>`
      s += `<g transform="translate(22,26)"><path d="${hexagon(13)}" fill="none" stroke="${CX}" stroke-width="2.4"/><circle r="4.2" fill="${CX}"${on ? ` style="${loop('pulse', 1.4)}"` : ''}/></g>`
      s += `<text x="44" y="24" font-size="13" font-weight="800" fill="#E6FFF6">Codex</text>`
      s += `<text x="44" y="39" class="m" font-size="8.5" fill="#7FD8BE">${esc(trunc(latest ? `${latest.model} · ${latest.effort}` : "", 20))}</text></g>`
      continue
    }
    if (m.kind === 'thread') {
      const rs = m.runs ?? []
      const on = rs.find(r => r.status === 'running')
      const last = rs[0]
      const sub = on
        ? `running · ${Math.max(0, Math.round((now - on.startedAt) / 60000))}m`
        : last
          ? `${last.status} · ${fmtK(rs.length)} run${rs.length === 1 ? '' : 's'}`
          : ''
      s += `<g transform="translate(${(p.x - IW / 2).toFixed(1)},${(p.y - IH / 2).toFixed(1)})">`
      if (on) s += `<rect x="-6" y="-6" width="${IW + 12}" height="${IH + 12}" rx="10" fill="${CX}" opacity=".14"/>`
      s += `<rect width="${IW}" height="${IH - 6}" rx="8" fill="#0D1117" stroke="${CX}" stroke-width="${on ? 2.4 : 1.8}"/><path d="M10 ${IH - 6}l-2 7 9-7" fill="#0D1117" stroke="${CX}" stroke-width="1.6" stroke-linejoin="round"/>`
      for (let i = 0; i < 3; i++) s += `<rect x="8" y="${10 + i * 7}" width="${[22, 16, 19][i]}" height="2.6" rx="1.3" fill="${CX}" opacity=".8"/>`
      s += `<text x="${IW / 2}" y="${IH + 15}" text-anchor="middle" class="m" font-size="11" font-weight="600" fill="#BFF3E2">${esc(trunc(m.label, 15))}</text>`
      s += `<text x="${IW / 2}" y="${IH + 27}" text-anchor="middle" font-size="9.5" fill="${on ? '#56D4DD' : '#8B949E'}">${esc(sub)}</text></g>`
      continue
    }
    const [badge, color] = fileType(m.path ?? '')
    const edge = m.edit ? CX : '#3D5A52'
    s += `<g transform="translate(${(p.x - IW / 2).toFixed(1)},${(p.y - IH / 2).toFixed(1)})"${m.edit ? '' : ' opacity=".75"'}>`
    s += `<path d="M0 0H${IW - 10}L${IW} 10V${IH}H0Z" fill="#0D1117" stroke="${edge}" stroke-width="2" stroke-linejoin="round"${m.edit ? '' : ' stroke-dasharray="4 3"'}/>`
    s += `<path d="M${IW - 10} 0V10H${IW}" fill="none" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/>`
    for (let i = 0; i < 4; i++) {
      const w = [22, 16, 24, 12][(i + hash(m.path ?? '')) % 4]
      s += `<path d="M6 ${12 + i * 6} q${w / 4} -2 ${w / 2} 0 t${w / 2} 0" class="q" stroke="${color}"/>`
    }
    const bw = badge.length * 5.6 + 6
    s += `<rect x="-4" y="${IH - 12}" width="${bw}" height="11" rx="2" fill="${color}"/><text x="${bw / 2 - 4}" y="${IH - 3.6}" text-anchor="middle" font-size="7.5" font-weight="800" fill="#0D1117">${esc(badge)}</text>`
    s += `<text x="${IW / 2}" y="${IH + 15}" text-anchor="middle" class="m" font-size="11" font-weight="600" fill="#D7EFE7">${esc(trunc(m.label, 15))}</text>`
    s += `<text x="${IW / 2}" y="${IH + 27}" text-anchor="middle" font-size="9.5" fill="${m.edit ? CX : '#8B949E'}">${m.edit ? 'edited' : 'read'}</text></g>`
  }

  // Tool stations on the right.
  for (const n of tools) {
    const p = pos.get(n.id)
    if (!p) continue
    const here = live.filter(a => a.node === n.id)
    const edge = here.length ? colorOf(here[0]) : '#4B5563'
    s += `<g transform="translate(${(p.x - 22).toFixed(1)},${(p.y - 18).toFixed(1)})">`
    if (n.id === '$terminal') {
      s += `<rect width="44" height="34" rx="5" fill="#0D1117" stroke="${edge}" stroke-width="2"/><rect width="44" height="8" rx="3" fill="${edge}" opacity=".35"/><text x="7" y="25" class="m" font-size="11" font-weight="700" fill="#7EE787">&gt;_</text>`
      s += testBadge(c.tests ?? [], loop)
      if ((c.tests ?? []).some(t => t.status === 'running')) {
        s += `<text x="22" y="52" text-anchor="middle" class="m" font-size="10" font-weight="700" fill="${TEST_TINT}">tests running</text></g>`
        continue
      }
      const cmds = runningShells(c, now).length
      if (cmds) {
        s += `<text x="22" y="52" text-anchor="middle" class="m" font-size="10" font-weight="700" fill="#FFA657">${fmtK(cmds)} running</text></g>`
        continue
      }
    } else if (n.id === '@web')
      s += `<circle cx="22" cy="17" r="16" fill="#0D1117" stroke="${edge}" stroke-width="2"/><ellipse cx="22" cy="17" rx="7" ry="16" fill="none" stroke="#56D4DD" stroke-width="1.2"/><path d="M6 17H38M9 9H35M9 25H35" stroke="#56D4DD" stroke-width="1"/>`
    else if (n.id === '@browser')
      // A browser window: tab strip, address bar, page.
      s += `<rect width="44" height="34" rx="5" fill="#0D1117" stroke="${edge}" stroke-width="2"/><path d="M2 9H42" stroke="${edge}" stroke-width="1.4"/><circle cx="7" cy="5" r="1.6" fill="#FF7B72"/><circle cx="12" cy="5" r="1.6" fill="#E3B341"/><circle cx="17" cy="5" r="1.6" fill="#7EE787"/><rect x="6" y="13" width="32" height="5" rx="2.5" fill="#1F2A37" stroke="#56D4DD" stroke-width=".8"/><path d="M8 23H30M8 28H24" stroke="#56D4DD" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>`
    else if (n.id === '@computer' || n.id === '@remote')
      // A monitor on a stand; the remote one with a link mark.
      s += `<rect x="2" y="1" width="40" height="26" rx="3" fill="#0D1117" stroke="${edge}" stroke-width="2"/><rect x="6" y="5" width="32" height="18" rx="1.5" fill="#132235"/><path d="M8 19l6-6 4 4 7-8 9 10" fill="none" stroke="#FFA657" stroke-width="1.4" stroke-linejoin="round"/><path d="M18 27v4M26 27v4M13 33h18" stroke="${edge}" stroke-width="2" stroke-linecap="round"/>${n.id === '@remote' ? `<circle cx="38" cy="5" r="4.5" fill="#0D1117" stroke="#79C0FF" stroke-width="1.4"/><path d="M36 5h4" stroke="#79C0FF" stroke-width="1.4"/>` : ''}`
    else if (n.id === '@docs')
      // A page with a folded corner and a heading.
      s += `<path d="M8 1H30L38 9V35H8Z" fill="#0D1117" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/><path d="M30 1V9H38" fill="none" stroke="${edge}" stroke-width="1.4"/><path d="M13 13H28" stroke="#E3B341" stroke-width="2.4" stroke-linecap="round"/><path d="M13 20H33M13 25H31M13 30H26" stroke="#9CA3AF" stroke-width="1.3" stroke-linecap="round"/>`
    else if (n.id === '@claude')
      s += `<rect width="44" height="34" rx="8" fill="#0D1117" stroke="${edge}" stroke-width="2"/><text x="22" y="25" text-anchor="middle" font-size="20" fill="#D97757">✻</text>`
    else if (n.id.startsWith('@app:')) {
      // Any other app or service: a tile with its initials.
      const initials = n.label.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
      const tint = PALETTE[hash(n.id) % PALETTE.length]
      s += `<rect width="44" height="34" rx="8" fill="#0D1117" stroke="${edge}" stroke-width="2"/><rect x="4" y="4" width="36" height="26" rx="5" fill="${tint}" opacity=".22"/><text x="22" y="23" text-anchor="middle" font-size="13" font-weight="800" fill="${tint}">${esc(initials || '◆')}</text>`
    } else
      s += `<circle cx="18" cy="15" r="11" fill="#0D1117" stroke="${edge}" stroke-width="2.4"/><path d="M26 23L36 33" stroke="${edge}" stroke-width="3.4" stroke-linecap="round"/><circle cx="18" cy="15" r="6" fill="none" stroke="#E3B341" stroke-width="1.2" opacity=".7"/>`
    s += `<text x="22" y="52" text-anchor="middle" class="m" font-size="10" fill="#9CA3AF">${esc(midTrunc(n.label, 16))}</text></g>`
  }

  // The folder itself, drawn over the links that leave it.
  const worked = Object.values(c.changes ?? {})
  const added = worked.reduce((n, ch) => n + ch.added, 0)
  const removed = worked.reduce((n, ch) => n + ch.removed, 0)
  s += `<g transform="translate(${fold.x.toFixed(1)},${fold.y})">${FOLDER_BODY}`
  s += `<text x="${FOLDER.w / 2}" y="${FOLDER.h + 14}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#F0BC55">worked files</text>`
  s += `<text x="${FOLDER.w / 2}" y="${FOLDER.h + 27}" text-anchor="middle" class="m" font-size="10" fill="#B8C1CC">${fmtK(worked.length)} file${worked.length === 1 ? '' : 's'}</text>`
  s += `<text x="${FOLDER.w / 2}" y="${FOLDER.h + 39}" text-anchor="middle" class="m" font-size="10"><tspan fill="#3FB950">+${fmtK(added)}</tspan> <tspan fill="#F85149">−${fmtK(removed)}</tspan></text></g>`

  // Claudes: parked over their file, or swinging down the link from the last one.
  const U = 2.2
  const sprite = (color: string, look: number, off: number) => {
    const R = (x: number, y: number, w: number, h: number, fill: string) =>
      `<rect x="${(x * U).toFixed(1)}" y="${(y * U).toFixed(1)}" width="${(w * U).toFixed(1)}" height="${(h * U).toFixed(1)}" fill="${fill}"/>`
    return (
      R(2, 0, 12, 7, color) +
      R(0, 3, 2, 2, color) +
      R(14, 3, 2, 2, color) +
      [3, 5, 10, 12].map(x => R(x, 7, 1, 2, color)).join('') +
      `<g style="transform-origin:center;${loop('blink', 4.2, off, 'linear')}">${R(4 + look, 2, 1, 2, '#0D1117')}${R(11 + look, 2, 1, 2, '#0D1117')}</g>`
    )
  }
  const anchor = (p: Spot, slot: number, of: number) => {
    const ctr = seat(p, slot, of)
    return { x: ctr.x - SPR.w / 2, y: ctr.y - SPR.h / 2 }
  }
  const dots = () => [0, 1, 2].map(i => `<tspan style="${loop('dot', 1.2, i * 0.2, 'linear')}">.</tspan>`).join('')
  const parked = new Map<string, number>()
  const landing = new Map<string, number>()
  for (const a of live) {
    const p = pos.get(a.node)
    if (!p) continue
    const slot = parked.get(a.node) ?? 0
    const of = live.filter(x => x.node === a.node).length
    parked.set(a.node, slot + 1)
    const color = colorOf(a)
    const off = (hash(a.id) % 10) / 10
    const at = anchor(p, slot, of)
    const from = a.from ? pos.get(a.from) : undefined
    const t = now - a.movedAt
    const pts = from ? [seat(from, 0, 1), seat(p, slot, of)] : []
    const ms = from ? hopMs(pts) : 0
    s += `<g transform="translate(${at.x.toFixed(1)},${at.y.toFixed(1)})">`
    if (from && t < ms) {
      // Out to the gutter, along it, over to the new file: a swing that never crosses a file.
      landing.set(a.node, Math.max(landing.get(a.node) ?? 0, ms - t))
      const end = pts[pts.length - 1]
      const rel = pts.map(q => ({ x: q.x - end.x, y: q.y - end.y }))
      const begin = `${(-t / 1000).toFixed(2)}s`
      const dur = `${(ms / 1000).toFixed(2)}s`
      s += `<g><animateMotion path="${arc(rel)}" dur="${dur}" begin="${begin}" fill="freeze" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines=".45 0 .3 1"/>`
      s += `<g transform="translate(${SPR.w / 2},0)"><g>${isStraight(pts[0], pts[pts.length - 1]) ? '' : `<animateTransform attributeName="transform" type="rotate" values="0;${rel[0].x > 0 ? 10 : -10};${rel[0].x > 0 ? -6 : 6};2;0" keyTimes="0;.3;.65;.85;1" dur="${dur}" begin="${begin}" fill="freeze"/>`}<g transform="translate(${-SPR.w / 2},0)">${sprite(color, rel[0].x > 0 ? -0.6 : 0.6, off)}</g></g></g></g>`
    } else {
      s += `<g style="${loop('bob', 1.6, off + slot * 0.4)}">${sprite(color, slot % 2 ? -0.6 : 0.6, off)}</g>`
    }
    s += '</g>'
  }

  // Codex at work: a robot over the file it is on (else its thread), with what it is doing.
  const robot = (off: number) =>
    `<g style="${loop('bob', 1.4, off)}"><path d="M17 -1V-6" stroke="${CX}" stroke-width="2"/><circle cx="17" cy="-8" r="2.4" fill="#7EE787" style="${loop('pulse', 1.2, off)}"/>` +
    `<rect width="34" height="22" rx="6" fill="${CX}"/><rect x="5" y="5" width="24" height="10" rx="4" fill="#0D1117"/>` +
    `<g style="transform-origin:center;${loop('blink', 3.6, off, 'linear')}"><circle cx="12" cy="10" r="2.3" fill="#56D4DD"/><circle cx="22" cy="10" r="2.3" fill="#56D4DD"/></g>` +
    `<rect x="6" y="22" width="6" height="3" rx="1" fill="#0B6B52"/><rect x="22" y="22" width="6" height="3" rx="1" fill="#0B6B52"/></g>`
  const codexAt = new Map<string, Spot>()
  for (const r of shownRuns.filter(x => x.status === 'running')) {
    const group = r.thread || 'one-off'
    const onFile = r.focus ? `cx:f:${group}:${r.focus}` : ''
    const node = onFile && pos.get(onFile) ? onFile : `cx:t:${group}`
    const p = pos.get(node)
    if (!p) continue
    const at = { x: p.x, y: p.y - IH / 2 - 22 }
    codexAt.set(r.id, at)
    s += `<g transform="translate(${(at.x - 17).toFixed(1)},${(at.y - 11).toFixed(1)})">${robot((hash(r.id) % 10) / 10)}</g>`
    const label = trunc(r.activity || 'Working', 30)
    const w = label.length * 5.1 + 26
    s += `<g transform="translate(${(at.x - w / 2).toFixed(1)},${(at.y - 50).toFixed(1)})"><rect width="${w.toFixed(1)}" height="16" rx="8" fill="#0D1117" stroke="${CX}" stroke-width="1.3"/>`
    s += `<path d="M${(w / 2 - 4).toFixed(1)} 15.4L${(w / 2).toFixed(1)} 21L${(w / 2 + 4).toFixed(1)} 15.4" fill="#0D1117" stroke="${CX}" stroke-width="1.3" stroke-linejoin="round"/><rect x="${(w / 2 - 3.4).toFixed(1)}" y="14" width="6.8" height="2" fill="#0D1117"/>`
    s += `<text x="${(w / 2).toFixed(1)}" y="11.4" text-anchor="middle" font-size="9.5" font-weight="600" fill="#BFF3E2">${esc(label)}${dots()}</text></g>`
  }

  // The line between Codex and whoever asked: the task travels out while it works,
  // the answer travels back for a few seconds after it finishes.
  let wires = ''
  for (const r of shownRuns.filter(x => x.status === 'running' || now - x.endedAt < CODEX_REPLY_MS)) {
    const asker = c.agents.find(a => a.id === r.caller)
    const askerPos = asker?.node ? pos.get(asker.node) : undefined
    const askerAt = askerPos ? seat(askerPos, 0, 1) : { x: foldCx, y: fold.y + fold.h + 30 }
    const group = r.thread || 'one-off'
    const threadPos = pos.get(`cx:t:${group}`)
    const codexSpot = codexAt.get(r.id) ?? (threadPos ? { x: threadPos.x, y: threadPos.y - IH / 2 - 10 } : undefined)
    if (!codexSpot) continue
    const out = r.status === 'running'
    const [from, to] = out ? [askerAt, codexSpot] : [codexSpot, askerAt]
    const bow = Math.max(60, Math.abs(to.y - from.y) * 0.35)
    const side = to.x >= from.x ? 1 : -1
    const d = `M${from.x.toFixed(1)} ${from.y.toFixed(1)}C${(from.x + side * bow).toFixed(1)} ${(from.y + (to.y - from.y) * 0.25).toFixed(1)} ${(to.x - side * bow).toFixed(1)} ${(from.y + (to.y - from.y) * 0.75).toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`
    const tone = out ? CX : '#7EE787'
    wires += `<path d="${d}" stroke="${tone}" stroke-width="2.2" fill="none" opacity=".7" stroke-linecap="round"/>`
    wires += `<circle r="4.5" fill="${tone}"><animateMotion path="${d}" dur="1.8s" repeatCount="indefinite"/></circle>`
    wires += `<circle r="3" fill="${tone}" opacity=".6"><animateMotion path="${d}" dur="1.8s" begin="-.9s" repeatCount="indefinite"/></circle>`
    const who = asker?.name ?? (r.caller === 'main' ? 'Claude' : 'a subagent')
    const text = out
      ? `${who} → Codex: ${trunc(oneLine(r.task), 34)}`
      : `Codex → ${who}: ${r.status}${r.files.length ? `, ${fmtK(r.files.length)} file${r.files.length === 1 ? '' : 's'}` : ''}`
    // The label sits near Codex's end, in the open band around its tree rather than over the files.
    const u = out ? 0.75 : 0.25
    const c1 = { x: from.x + side * bow, y: from.y + (to.y - from.y) * 0.25 }
    const c2 = { x: to.x - side * bow, y: from.y + (to.y - from.y) * 0.75 }
    const bez = (a: number, b: number, c: number, d2: number) => (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u ** 2 * c + u ** 3 * d2
    const mx = bez(from.x, c1.x, c2.x, to.x)
    const my = bez(from.y, c1.y, c2.y, to.y)
    const tw = text.length * 5.3 + 16
    wires += `<g transform="translate(${(mx - tw / 2).toFixed(1)},${(my - 9).toFixed(1)})"><rect width="${tw.toFixed(1)}" height="18" rx="9" fill="#0B231C" stroke="${tone}" stroke-width="1.1"/><text x="${(tw / 2).toFixed(1)}" y="12.5" text-anchor="middle" font-size="9" font-weight="600" fill="#E6FFF6">${esc(text)}</text></g>`
  }

  s = s.slice(0, underTrees) + wires + s.slice(underTrees)

  // Bubbles: one per file. A lone Claude's says what it is doing; Claudes
  // sharing a file share one bubble, a row each. A bubble waits for a swing to land.
  for (const [node] of parked) {
    const p = pos.get(node)
    if (!p) continue
    const crew = live.filter(a => a.node === node)
    const wait = landing.get(node)
    const fade = wait ? ` opacity="0"><animate attributeName="opacity" values="0;1" dur=".25s" begin="${(wait / 1000).toFixed(2)}s" fill="freeze"/` : ''
    if (crew.length === 1) {
      const [label, tint] = act(crew[0])
      const at = seat(p, 0, 1)
      const w = label.length * 5.9 + 28
      const top = at.y - SPR.h / 2 - 26
      s += `<g transform="translate(${(at.x - w / 2).toFixed(1)},${top.toFixed(1)})"${fade}>`
      s += `<rect width="${w.toFixed(1)}" height="16" rx="8" fill="#0D1117" stroke="${tint}" stroke-width="1.2"/>`
      s += `<path d="M${(w / 2 - 4).toFixed(1)} 15.4L${(w / 2).toFixed(1)} 21L${(w / 2 + 4).toFixed(1)} 15.4" fill="#0D1117" stroke="${tint}" stroke-width="1.2" stroke-linejoin="round"/><rect x="${(w / 2 - 3.4).toFixed(1)}" y="14" width="6.8" height="2" fill="#0D1117"/>`
      s += `<text x="${(w / 2).toFixed(1)}" y="11.6" text-anchor="middle" font-size="9.5" font-weight="600" fill="${tint}">${esc(label)}${dots()}</text></g>`
    } else {
      const rows = crew.map(a => ({ a, act: act(a) }))
      const w = Math.max(...rows.map(r => r.act[0].length * 5.9)) + 42
      const h = 8 + rows.length * 13
      const left = anchor(p, 0, crew.length).x
      const right = anchor(p, crew.length - 1, crew.length).x + 16 * U
      const cx = (left + right) / 2
      const top = anchor(p, 0, crew.length).y - 14 - h
      s += `<g transform="translate(${(cx - w / 2).toFixed(1)},${top.toFixed(1)})"${fade}>`
      s += `<rect width="${w.toFixed(1)}" height="${h}" rx="9" fill="#0D1117" stroke="#E3B341" stroke-width="1.2"/>`
      s += `<path d="M${(w / 2 - 5).toFixed(1)} ${h - 0.6}L${(w / 2).toFixed(1)} ${h + 7}L${(w / 2 + 5).toFixed(1)} ${h - 0.6}" fill="#0D1117" stroke="#E3B341" stroke-width="1.2" stroke-linejoin="round"/>`
      s += `<rect x="${(w / 2 - 4).toFixed(1)}" y="${h - 2}" width="8" height="2.4" fill="#0D1117"/>`
      rows.forEach(({ a, act: [label, tint] }, i) => {
        const y = 15 + i * 13
        s += `<rect x="8" y="${y - 7}" width="7" height="7" rx="1.5" fill="${colorOf(a)}"/>`
        s += `<text x="20" y="${y}" font-size="9.5" font-weight="600" fill="${tint}">${esc(label)}${dots()}</text>`
      })
      s += '</g>'
    }
  }

  if (!files.length && !tools.length) {
    s += `<text x="${needW / 2}" y="${TOP - 8}" text-anchor="middle" font-size="13" font-weight="600" fill="#9CA3AF">Nothing here yet</text>`
    s += `<text x="${needW / 2}" y="${TOP + 12}" text-anchor="middle" font-size="10.5" fill="#8B949E">Files appear as Claude opens them · ▶ demo for a preview</text>`
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round((H * W) / needW)}" viewBox="0 0 ${needW} ${H}">` +
    `<style>${MAP_CSS}</style><rect width="${needW}" height="${H}" rx="10" fill="#07080B"/>${s}</svg>`
  const alt = `Mind map of ${files.length} files; ${live.map(a => `${a.name} on ${c.nodes[a.node]?.label ?? `the folder ${dirMeta.get(a.node)?.label ?? a.node}`}`).join(', ') || 'nobody working'}`
  // Targets in map units: the pane turns them into the window it shows.
  const k = 1
  // Where each thing a click can open sits on the drawn map, in drawn pixels.
  const targets: MapTarget[] = []
  for (const n of files) {
    const p = pos.get(n.id)
    if (p && !n.id.startsWith('demo/')) targets.push({ id: n.id, kind: 'file', path: n.id, name: n.label, x: (p.x - 46) * k, y: (p.y - IH / 2 - 4) * k, w: 92 * k, h: (IH + 24) * k })
  }
  for (const [id, meta] of dirMeta) {
    const p = pos.get(id)
    if (!p) continue
    const rel = meta.group
    const demo = rel !== OUTSIDE && !sessionDir
    const path = meta.outside || demo || !sessionDir ? '' : rel === '.' ? sessionDir : `${sessionDir}/${rel}`
    targets.push({ id, kind: 'dir', path, name: meta.label, fold: rel, x: (p.x - 46) * k, y: (p.y - 16) * k, w: 92 * k, h: 60 * k })
    if (meta.outside && sessionDir) targets.push({ id: 'hide-outside', kind: 'hide', path: '', name: 'outside project', x: p.x - 17 + HIDE_CHIP.x - 3, y: p.y - 14 + HIDE_CHIP.y - 3, w: HIDE_CHIP.w + 6, h: HIDE_CHIP.h + 6 })
  }
  for (const [id, m] of cxMeta) {
    const p = pos.get(id)
    if (p && m.kind === 'file' && m.path && !m.path.startsWith('demo/')) targets.push({ id, kind: 'file', path: m.path, name: m.label, x: (p.x - 46) * k, y: (p.y - IH / 2 - 4) * k, w: 92 * k, h: (IH + 24) * k })
  }
  if (sessionDir && !files.every(n => n.id.startsWith('demo/'))) targets.push({ id: 'root', kind: 'dir', path: sessionDir, name: 'the project folder', x: fold.x, y: fold.y, w: fold.w, h: fold.h + 30 })
  const busyAt = live.map(a => pos.get(a.node)).filter((p): p is Cell => !!p).map(p => ({ x: p.x, y: p.y }))
  // Resting the pointer on a thing: its full name (the map shortens long ones), what a click does, its links.
  const relOf = (id: string) => (id.startsWith('demo/') ? id.slice(5) : sessionDir && id.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`) ? id.slice(sessionDir.length + 1) : id)
  const at = (id: string): [number, number] | undefined => (pos.get(id) ? [pos.get(id)!.x, pos.get(id)!.y] : undefined)
  const hoverable: Record<string, HoverInfo> = {}
  /** A file's icon outline (the search outline's shape) and the bottom of its name, counts and "also" lines. */
  const fileMarks = (id: string, p: Spot, extraLine: boolean) => {
    const top = p.y - IH / 2
    const also = lite ? [] : alsoFrom(id).map(x => c.nodes[x]?.label ?? baseName(x))
    const alsoLines = also.length ? (`← also ${also.join(', ')}`.length > 20 ? 2 : 1) : 0
    const ch = c.changes[id]
    const lastLine = alsoLines ? IH + 40 + (alsoLines - 1) * 12 : extraLine || (ch && (ch.added || ch.removed)) ? IH + 27 : IH + 15
    return { ring: isHit(id) ? undefined : { x: p.x - IW / 2 - 8, y: top - 8, w: IW + 16, h: RING_H, rx: 9 }, top: top - 8, bottom: top + lastLine + 4, cx: p.x }
  }
  for (const t of targets) {
    if (t.kind === 'file') {
      const p = pos.get(t.id)
      if (!p) continue
      const node = c.nodes[t.id]
      const near = node ? [...node.imports, ...files.filter(f => f.imports.includes(t.id)).map(f => f.id)].filter((x, i, all) => x !== t.id && all.indexOf(x) === i) : []
      const ch = c.changes[t.path]
      hoverable[t.id] = { ...fileMarks(t.id, p, t.id.startsWith('cx:')), from: [p.x, p.y], title: relOf(t.path), sub: `${ch?.edits ? `+${fmtK(ch.added)} −${fmtK(ch.removed)} · ` : ch?.reads ? 'read · ' : ''}click to open`, links: near.map(at).filter((q): q is [number, number] => !!q) }
    } else if (t.kind === 'dir' && t.fold !== undefined) {
      const p = pos.get(t.id)
      const meta = dirMeta.get(t.id)
      if (!p || !meta) continue
      // The folder icon (34×26 at its top-left), and the stacked pages behind a folded one.
      const lift = meta.folded ? 6 : 0
      const ring = { x: p.x - 17 - 5, y: p.y - 14 - 5 - lift, w: 34 + 10 + (meta.folded ? 2 : 0), h: 26 + 10 + lift, rx: 7 }
      hoverable[t.id] = { ring, top: ring.y, bottom: p.y - 14 + 53 + 4, cx: p.x, from: [p.x, p.y], title: meta.outside ? 'outside project' : meta.label, sub: `${fmtK(meta.files)} file${meta.files === 1 ? '' : 's'} · click to ${meta.folded ? 'unfold' : 'fold'}${t.path ? ' · Ctrl-click: file manager' : ''}`, links: [] }
    } else if (t.kind === 'dir') {
      const ring = { x: fold.x - 6, y: fold.y - 6, w: FOLDER.w + 12, h: FOLDER.h + 12, rx: 10 }
      hoverable[t.id] = { ring, top: ring.y, bottom: fold.y + FOLDER.h + 39 + 4, cx: foldCx, from: [foldCx, fold.y + fold.h / 2], title: 'worked files', sub: 'click to open the project folder', links: [] }
    } else {
      const ring = { x: t.x + 1, y: t.y + 1, w: t.w - 2, h: t.h - 2, rx: 10 }
      // The tip goes under the folder's name and count beside the chip, not over them.
      const folderRow = t.y - HIDE_CHIP.y + 3 + 14
      hoverable[t.id] = { ring, top: ring.y, bottom: folderRow - 14 + 53 + 4, cx: t.x + t.w / 2, from: [t.x + t.w / 2, t.y + t.h / 2], title: 'Hide files outside the project', sub: '"show outside" below the map brings them back', links: [] }
    }
  }
  const hits = files
    .filter(n => isHit(n.id) && pos.has(n.id))
    .map(n => pos.get(n.id)!)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(p => ({ x: p.x, y: p.y }))
  return {
    svg,
    body: svg.slice(svg.indexOf('>') + 1, -'</svg>'.length),
    mw: needW,
    mh: H,
    alt,
    targets,
    busyAt,
    hits,
    folded: [...dirMeta.values()].filter(m => m.folded).map(m => m.group),
    outsideHidden,
    codexShown: shownRuns.length > 0,
    // Every thing drawn (demo files too), with its name and counts below it: what the key must not cover.
    drawn: [...pos.values()].map(p => ({ x: p.x - 52, y: p.y - IH / 2 - 8, w: 104, h: IH + 56 })),
    hoverable,
  }
}

/**
 * What the map shows, minus the clock: two renders with the same key draw the
 * same picture, so the last one is reused and the image is not swapped.
 */
const mapKey = (c: Crew, W: number, now: number, codex: CodexRun[], q: string) =>
  JSON.stringify([
    W,
    q.trim().toLowerCase(),
    c.folds ?? {},
    !!c.hideOutside,
    codex
      .filter(r => r.status === 'running' || now - (r.endedAt || now) < CODEX_KEEP_MS)
      .map(r => [r.id, r.status, r.thread, r.caller, r.activity, r.focus, r.model, r.effort, r.files.length, r.touched.map(t => t.path + t.kind).join(), r.status !== 'running' && now - r.endedAt < CODEX_REPLY_MS, r.status === 'running' ? Math.round((now - r.startedAt) / 60000) : 0]),
    Object.values(c.nodes).map(n => [n.id, n.kind, n.imports, now - (n.touchedAt || 0) > FADE_MS, now - (n.touchedAt || 0) > FOLD_MS]),
    c.agents
      .filter(a => (a.state === 'busy' || a.state === 'thinking') && a.node)
      .map(a => [a.id, a.hue, a.node, a.from, activityOf(a)[0], now - a.movedAt < SWING_MS ? a.movedAt : 0]),
    // Mid-hop the picture's hop timing is baked in: a cached one drawn again would replay the hop from where it was.
    c.agents.some(a => (a.state === 'busy' || a.state === 'thinking') && a.from && now - a.movedAt < SWING_MS) ? now : 0,
    Object.entries(c.changes ?? {}).map(([p, ch]) => [p, ch.added, ch.removed]),
    (c.tests ?? []).map(t => [t.id, t.status, t.passed, t.failed]),
    runningShells(c, now).length,
    (c.problems ?? []).map(p => p.path + p.line),
    c.agents.map(a => !!a.stuck),
  ])
let lastMap: { key: string; map: ReturnType<typeof mindMap> } | undefined
const cachedMap = (c: Crew, W: number, now: number, codex: CodexRun[] = [], q = '') => {
  const key = mapKey(c, W, now, codex, q)
  if (lastMap?.key !== key) {
    let map = mindMap(c, W, now, codex, false, q)
    // Room is left for the window's own drawing (the key, the hover tip).
    if (map.svg.length > SVG_LIMIT - 14_000) map = mindMap(c, W, now, codex, true, q)
    lastMap = { key, map }
  }
  return lastMap.map
}

// ─── The intro: the title with the crew hopping on it, about six seconds ────────────────────

/** How long the intro plays before the pane takes over, in ms. */
const BOOT_MS = 6200

/**
 * The intro as one SVG whose CSS animations run from the moment it is shown:
 * the title rises a letter at a time under a light sweep, little Claudes drop
 * onto the letters and hop along them, all bounce together as a bar fills, and
 * it zooms out into the pane. Nothing in it depends on the
 * clock, so redraws while it plays show the same markup and do not restart it.
 */
const bootSvg = (W: number) => {
  const VW = 960
  const VH = 380
  const O = '#D97757'
  const G = '#3FB950'
  const at = (s: number) => `animation-delay:${s.toFixed(2)}s`
  let css = `
text{font-family:ui-monospace,"Cascadia Code",Consolas,Menlo,monospace}
.sans{font-family:ui-sans-serif,system-ui,"Segoe UI",sans-serif}
.a{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.8,.2,1);transform-box:fill-box;transform-origin:center}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes rise{from{transform:translateY(22px);opacity:0}to{transform:none;opacity:1}}
@keyframes fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes sheen{from{transform:translateX(-300px)}to{transform:translateX(640px)}}
@keyframes out{0%{transform:scale(1);opacity:1}100%{transform:scale(1.06);opacity:0}}
@keyframes glow{0%,100%{opacity:.45}50%{opacity:.9}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
`
  let s = ''
  s += `<defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#161C27" stroke-width="1"/></pattern>`
  s += `<radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${O}" stop-opacity=".28"/><stop offset="1" stop-color="${O}" stop-opacity="0"/></radialGradient>`
  s += `<linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
  s += `<rect width="${VW}" height="${VH}" fill="#06070A"/>`
  s += `<g class="a" style="animation:out .7s cubic-bezier(.6,0,.4,1) both;${at(5.3)}">`
  s += `<rect width="${VW}" height="${VH}" fill="url(#grid)" class="a" style="animation:fadeIn .6s both;${at(0)}"/>`
  // The halo fades in, then breathes: two elements, so the breathing cannot show it early.
  const cx = VW / 2
  const base = 236
  s += `<g class="a" style="animation:fadeIn .8s both;${at(0.1)}"><ellipse cx="${cx}" cy="${base - 26}" rx="330" ry="150" fill="url(#halo)" style="animation:glow 2.4s ease-in-out infinite"/></g>`

  // The title, a letter at a time, then a light sweep across it.
  const title = 'CLAUDE CREW'
  const size = 66
  // Each letter as wide as it is in a bold sans (in ems), so W does not crowd E.
  const EM: Record<string, number> = { C: 0.7, L: 0.58, A: 0.74, U: 0.74, D: 0.76, E: 0.64, R: 0.7, W: 0.98, ' ': 0.34 }
  const gap = 0.05
  const widths = [...title].map(ch => (EM[ch] ?? 0.7) * size)
  const total = widths.reduce((n, w) => n + w, 0) + gap * size * (title.length - 1)
  const xs: number[] = []
  let run = cx - total / 2
  for (const w of widths) {
    xs.push(run + w / 2)
    run += w + gap * size
  }
  const letter = (ch: string, i: number, extra: string) => `<text x="${xs[i].toFixed(1)}" y="${base}" font-size="${size}" font-weight="800" text-anchor="middle" class="${extra ? 'a sans' : 'sans'}"${extra}>${ch}</text>`
  s += `<clipPath id="tclip">${[...title].map((ch, i) => (ch === ' ' ? '' : letter(ch, i, ''))).join('')}</clipPath>`
  ;[...title].forEach((ch, i) => {
    if (ch !== ' ') s += letter(ch, i, ` fill="#F5F0E8" style="animation:rise .5s both;${at(0.15 + i * 0.06)}"`)
  })
  s += `<g clip-path="url(#tclip)"><rect x="${cx - 300}" y="${base - 60}" width="160" height="80" fill="url(#sh)" class="a" style="animation:sheen 1s ease-in-out both;${at(1.0)}"/></g>`
  s += `<text x="${cx}" y="${base + 34}" font-size="13" text-anchor="middle" fill="#8B949E" letter-spacing="4" class="a" style="animation:fadeIn .5s both;${at(0.8)}">LIVE MAP OF CLAUDE AND ITS CREW</text>`

  // Little Claudes: each drops onto a letter, hops along the title, and all bounce together at the end.
  const U = 2.8
  const SW = 16 * U
  const SH = 9 * U
  const top = base - size * 0.72
  const sprite = (color: string, blinkOff: number) => {
    const R = (a: number, b: number, w: number, hh: number, f: string) =>
      `<rect x="${(a * U - SW / 2).toFixed(1)}" y="${(b * U - SH).toFixed(1)}" width="${(w * U).toFixed(1)}" height="${(hh * U).toFixed(1)}" fill="${f}"/>`
    return (
      R(2, 0, 12, 7, color) +
      R(0, 3, 2, 2, color) +
      R(14, 3, 2, 2, color) +
      [3, 5, 10, 12].map(a => R(a, 7, 1, 2, color)).join('') +
      `<g style="transform-box:fill-box;transform-origin:center;animation:blink 2.6s linear infinite;animation-delay:-${blinkOff}s">${R(4, 2, 1, 2, '#0D1117')}${R(11, 2, 1, 2, '#0D1117')}</g>`
    )
  }
  const BOUNCE = 4.7
  const crew: { color: string; path: number[]; start: number }[] = [
    { color: O, path: [0, 2, 4, 7, 9], start: 1.1 },
    { color: '#6CB6FF', path: [10, 8, 5, 3, 1], start: 1.3 },
    { color: '#7EE787', path: [5, 3, 0, 2, 4], start: 1.5 },
    { color: '#D2A8FF', path: [7, 9, 10, 8, 7], start: 1.7 },
  ]
  const DROP = 0.38
  const HOLD = 0.16
  const HOP = 0.44
  crew.forEach((c, n) => {
    // Times are relative to the sprite's start; positions are its feet.
    const frames: { t: number; x: number; y: number; ease: string }[] = []
    const lands: number[] = []
    const x0 = xs[c.path[0]]
    frames.push({ t: 0, x: x0, y: -40, ease: 'cubic-bezier(.5,0,1,1)' })
    let t = DROP
    frames.push({ t, x: x0, y: top, ease: 'linear' })
    lands.push(t)
    const hop = (fromX: number, toX: number, lift: number) => {
      t += HOLD
      frames.push({ t, x: fromX, y: top, ease: 'cubic-bezier(.2,.7,.4,1)' })
      t += HOP / 2
      frames.push({ t, x: (fromX + toX) / 2, y: top - lift, ease: 'cubic-bezier(.6,0,.8,.3)' })
      t += HOP / 2
      frames.push({ t, x: toX, y: top, ease: 'linear' })
      lands.push(t)
    }
    for (let k = 1; k < c.path.length; k++) {
      const a = xs[c.path[k - 1]]
      const b = xs[c.path[k]]
      hop(a, b, 34 + Math.abs(b - a) * 0.22)
    }
    // Wait for the others, then one bounce together.
    const last = xs[c.path[c.path.length - 1]]
    const endAt = BOUNCE - c.start
    if (endAt > t + HOLD) {
      t = endAt - HOLD
      hop(last, last, 26)
    }
    const T = t + 0.05
    const pct = (v: number) => Math.min(100, (v / T) * 100).toFixed(2)
    css += `@keyframes m${n}{${frames.map(f => `${pct(f.t)}%{transform:translate(${f.x.toFixed(1)}px,${f.y.toFixed(1)}px);animation-timing-function:${f.ease}}`).join('')}100%{transform:translate(${last.toFixed(1)}px,${top.toFixed(1)}px)}}\n`
    // A squash on every landing.
    css += `@keyframes q${n}{0%{transform:none}${lands
      .map(l => `${pct(Math.max(0, l - 0.01))}%{transform:none}${pct(l + 0.03)}%{transform:scale(1.2,.72)}${pct(l + 0.13)}%{transform:none}`)
      .join('')}100%{transform:none}}\n`
    s += `<g style="animation:m${n} ${T.toFixed(2)}s linear both;${at(c.start)}"><g style="transform-box:fill-box;transform-origin:50% 100%;animation:q${n} ${T.toFixed(2)}s linear both;${at(c.start)}">${sprite(c.color, n * 0.7)}</g></g>`
  })

  // The bar fills, then says so.
  s += `<rect x="${cx - 170}" y="${base + 62}" width="340" height="4" rx="2" fill="#1B2230" class="a" style="animation:fadeIn .3s both;${at(3.9)}"/>`
  s += `<rect x="${cx - 170}" y="${base + 62}" width="340" height="4" rx="2" fill="${O}" class="a" style="transform-origin:left center;animation:fill .8s cubic-bezier(.6,0,.2,1) both;${at(4.0)}"/>`
  s += `<text x="${cx}" y="${base + 92}" font-size="11" text-anchor="middle" font-weight="700" fill="${G}" letter-spacing="2" class="a" style="animation:fadeIn .3s both;${at(4.75)}">● ALL SYSTEMS ONLINE</text>`
  s += `</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round((W * VH) / VW)}" viewBox="0 0 ${VW} ${VH}"><style>${css}</style>${s}</svg>`
}

const FOLDER_BODY =
  `<path d="M4 12a4 4 0 0 1 4-4h20l7 7h41a4 4 0 0 1 4 4v37a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#B8862F"/>` +
  `<rect x="10" y="18" width="62" height="30" rx="2" fill="#F3EAD3"/><path d="M16 26h40M16 32h30M16 38h44" stroke="#C9BFA6" stroke-width="2" stroke-linecap="round"/>` +
  `<path d="M4 24a4 4 0 0 1 4-4h68a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#E3A93B"/>` +
  `<path d="M4 24a4 4 0 0 1 4-4h68a4 4 0 0 1 4 4v3H4z" fill="#F0BC55"/>`

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** How many Codex runs the codex-bridge mod has published (0 without it). */
let codexCount = 0
/** Claudes whose current turn the app started (a background task reporting in), not the user. */
const noticeTurn = new Set<string>()
const codexRunCount = async ($: EngineInterface) =>
  (((await $.state.get({ plugin: 'codex-bridge', key: 'runs' } as never).catch(() => ({}))) as { value?: unknown[] }).value ?? []).length
/** Plays the intro: the pane shows it until BOOT_MS from now, then redraws as itself. */
let playIntro: (() => Promise<void>) | undefined

/** The replay's play timer, while it plays. */
let player: { cancel: () => void } | undefined
let writeReplay: ((fn: (r: Replay) => Replay) => Promise<unknown>) | undefined
const REPLAY_STEP_MS = 900
let replayShown = { at: -1, stamp: 0 }

/** Moves the replay: to a step, by a step, playing on from where it is, or back to live. */
const replayTo = async (how: 'start' | 'back' | 'fwd' | 'end' | 'play' | 'pause' | 'live') => {
  const c = await readCrew?.()
  const last = Math.max(0, (c?.timeline.length ?? 1) - 1)
  if (how === 'live' || how === 'pause' || how === 'start' || how === 'back' || how === 'fwd' || how === 'end') {
    player?.cancel()
    player = undefined
  }
  if (how === 'live') return writeReplay?.(() => ({ on: false, at: 0, playing: false }))
  if (how === 'play') {
    await writeReplay?.(r => ({ on: true, at: r.on && r.at < last ? r.at : 0, playing: true }))
    player?.cancel()
    player = every?.(REPLAY_STEP_MS, () => {
      void writeReplay?.(r => {
        if (!r.playing || r.at >= last) {
          player?.cancel()
          player = undefined
          return { ...r, playing: false }
        }
        return { ...r, at: r.at + 1 }
      })
    })
    return
  }
  return writeReplay?.(r => ({
    on: true,
    playing: false,
    at: how === 'start' ? 0 : how === 'end' ? last : how === 'back' ? Math.max(0, r.at - 1) : how === 'fwd' ? Math.min(last, r.at + 1) : r.at,
  }))
}

const agentOf = (e: unknown) => (e as { agentId?: string }).agentId ?? 'main'

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
/** How full a context is, as a colour: plenty of room, getting full, about to compact. */
const ctxTint = (pct: number) => (pct >= 85 ? '#FF7B72' : pct >= 60 ? '#E3B341' : '#56D4DD')

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
    writeReplay = fn => update($, replay, fn)
    playIntro = async () => {
      const until = Date.now() + BOOT_MS
      await update($, intro, () => ({ until, played: true }))
      // Ending it is a write, so the pane redraws as itself (unless a newer play started meanwhile).
      $.clock.after(BOOT_MS + 80, () => void update($, intro, cur => (cur.until === until ? { ...cur, until: 0 } : cur)))
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

    await $.command.register({ name: 'crew', description: 'Open the Claude Crew pane: the live map of agents at work' })
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
    await update($, replay, () => ({ on: false, at: 0, playing: false }))
    player?.cancel()
    player = undefined
    // While a test runs, tick once a second so its timer counts up; give up on background runs nobody reads after 30 minutes.
    ticker?.cancel()
    ticker = $.clock.every(1000, () => {
      void (async () => {
        if (diagDirty) {
          diagDirty = false
          // Several panes (one per chat) share the store: keep the record of the one last used.
          const kept = (await $.store.get('diag').catch(() => undefined)) as { lastInputAt?: number } | undefined
          if (!kept || (kept.lastInputAt ?? 0) <= lastInputAt)
            await $.store.set('diag', { version: VERSION, at: new Date().toISOString(), lastInputAt, cwd: sessionDir, draws, hovers, frames: perf.frames, avgChainMs: Math.round(perf.chainMs / Math.max(1, perf.frames)), avgRenderMs: Math.round(perf.renderMs / Math.max(1, perf.frames)), events: diag }).catch(() => undefined)
        }
        const c = await read($, crew)
        const running = (c.tests ?? []).filter(t => t.status === 'running')
        const shellsOn = (c.shells ?? []).filter(x => x.status === 'running')
        if (!running.length && !shellsOn.length) return
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
    if ((await $.store.get('map-live').catch(() => undefined)) === true && !(await read($, mapLive))) await update($, mapLive, () => true)
    await update($, hoverOn, () => '')
    hoverMirror = ''
    deskMax = 0
    // Once per session: a reload or a worker restart starts the module again, not the session.
    if ((await $.store.get('intro').catch(() => undefined)) !== 'off' && !(await read($, intro)).played) await playIntro()
    void $.ui.open({ id: PANE, title: 'Claude Crew' })

    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    if ((await $.store.get('intro').catch(() => undefined)) !== 'off') await playIntro?.()
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
          ? { goal: trunc(oneLine(e.text), 500), progress: -1, progressSrc: 'est' as const, todosDone: 0, todosTotal: 0, todosDoing: 0, doing: '', calls: 0, since: Date.now(), thoughts: [], actions: [], stuck: '', recent: [] }
          : {}),
      }))
      if (id === 'main' && e.text) {
        if (d.tasks) d.tasks = Object.fromEntries(Object.entries(d.tasks).map(([k, t]) => [k, t.status === 'completed' ? { ...t, old: true } : t]))
        // What the task's summary is measured against.
        d.turnBase = {
          at: Date.now(),
          goal: trunc(oneLine(e.text), 500),
          changes: Object.fromEntries(Object.entries(d.changes).filter(([, ch]) => ch.edits).map(([p, ch]) => [p, { added: ch.added, removed: ch.removed }])),
          tokens: d.spent?.tokens ?? 0,
          cost: d.spent?.cost ?? 0,
          tests: 0,
          failed: 0,
          codex: codexCount,
        }
        d.summary = null
      }
      return id === 'main' && e.text ? log(d, id, 'info', `new task: ${trunc(oneLine(e.text), 120)}`) : d
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = agentOf(e)
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
  on('turn.step', async function* ($, e, next) {
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
          goal: trunc(oneLine([spawnDesc, typeof e.prompt === 'string' ? e.prompt.slice(0, 2000) : ''].filter(Boolean).join(': ')), 500),
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
      const lines = blocks
        .map(b => (b.type === 'thinking' ? b.thinking : b.type === 'text' ? b.text : '') ?? '')
        .map(summarise)
        .filter(Boolean)
        .slice(0, 2)
      if (lines.length) {
        const id = agentOf(e)
        await write?.(c => lines.reduce((d, line) => think(d, id, line), c))
      }
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    // A call without a tool name is none of the pane's business.
    if (typeof e.tool !== 'string' || !e.tool) return next(e)
    const a = e as unknown as Record<string, unknown>
    const id = e.agentId ?? 'main'
    const node = nodeOf(e.tool, a)
    const detail = detailOf(e.tool, a).slice(0, 300)
    const callId = e.tool_use_id ?? `call-${Date.now()}-${Math.random()}`
    const line = trunc(actionLine(e.tool, node, detail, typeof a.description === 'string' ? a.description : ''), 200)

    // Todo lists are the agent's own word on how far along it is.
    const todos = Array.isArray(a.todos) ? (a.todos.filter(t => t && typeof t === 'object') as { status?: string; content?: string; activeForm?: string }[]) : undefined

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
        }
        if (todos) {
          const doing = todos.find(t => t.status === 'in_progress')
          upd = { ...upd, todosTotal: todos.length, todosDone: todos.filter(t => t.status === 'completed').length, todosDoing: todos.filter(t => t.status === 'in_progress').length, doing: doing?.activeForm ?? doing?.content ?? '' }
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
      return log({ ...d, calls: d.calls + 1 }, id, 'act', line)
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
      let settled: TestRun[] = []
      let stuckNote = ''
      let problemNote = ''
      await write?.(c => {
        settled = []
        stuckNote = ''
        problemNote = ''
        let d = ok && delta && node && !isSpecial(node) ? record(c, node, id, delta) : c
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
        if (e.tool === 'Agent' || e.tool === 'Task')
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
    if (e.element !== 'pan') return next(e)
    lastInputAt = Date.now()
    // Anything from the map's hand means the surface delivers the mouse: say so once, and remember it.
    if (!(await read($, mapLive))) {
      await update($, mapLive, () => true)
      void $.store.set('map-live', true).catch(() => undefined)
    }
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
    const pair = (x: unknown): [number, number] | null => (Array.isArray(x) && x.length === 2 && num(x[0]) !== undefined && num(x[1]) !== undefined ? [x[0] as number, x[1] as number] : null)
    const d = (e.data ?? {}) as { view?: { x?: unknown; y?: unknown; k?: unknown }; hover?: unknown; click?: unknown; ctrl?: unknown; zoom?: unknown; fit?: unknown; cell?: unknown }
    hoverAt = pair(d.hover)
    const vx = num(d.view?.x)
    const vy = num(d.view?.y)
    const vk = num(d.view?.k)
    const click = pair(d.click)
    if (click || d.zoom !== undefined || d.fit !== undefined) note(`pan: ${click ? `click ${Math.round(click[0])},${Math.round(click[1])} ` : ''}frame=${lastFrame.vw}x${lastFrame.vh} targets=${lastFrame.targets.length}`)
    else hovers++
    // How far a small file may be from the pointer and still count: most of one of the hand's cells (at most 24 px).
    const cell = pair(d.cell)
    const reach = cell ? Math.min(24, Math.max(6, 0.6 * Math.max(cell[0], cell[1]))) : 8
    // The window the pointer was measured against: the one the map's hand last had drawn.
    const seen = vx !== undefined && vy !== undefined && vk ? { x: vx, y: vy, k: vk } : lastFrame.view
    // What the pointer rests on: outlined, its links lit, its full name in a tip.
    const over = hoverAt ? (targetAt(hoverAt[0], hoverAt[1], seen, lastFrame.targets, reach)?.id ?? '') : ''
    if (over !== hoverMirror) {
      hoverMirror = over
      await update($, hoverOn, () => over)
    }
    if (click) {
      const t = targetAt(click[0], click[1], seen, lastFrame.targets, reach)
      note(`click lands on ${t ? `${t.kind} ${t.name}` : 'nothing'} (map ${Math.round(seen.x + click[0] / seen.k)},${Math.round(seen.y + click[1] / seen.k)} at ${seen.k.toFixed(2)})`)
      if (t) void pressTarget($, t, d.ctrl === true)
    }
    // The keyboard, once the map has the focus: + and − zoom about the middle, 0 shows the whole map.
    const zf = num(d.zoom)
    if (zf && zf > 0) void zoomBy($, Math.min(2, Math.max(0.5, zf)))
    if (d.fit === true) await update($, mapView, v => ({ ...v, ...lastFrame.fit, auto: false, follow: 0, rev: `r${++viewRev}` }))
    return {}
  })

  // The pan module failed to load or run here: draw the fixed map with click buttons instead.
  on('ui.fault', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.element === 'pan') panFailed = true
    note(`fault ${e.element}: ${String((e as { reason?: unknown }).reason ?? '').slice(0, 120)}`)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const renderStart = Date.now()
    // Every value the pane draws from, read side by side (one round trip, not nine in a row).
    const [c, , codexPublished, playing, rp, sq, vs, hoverId, mapLiveNow] = await Promise.all([
      read($, crew),
      // Read so the pane redraws each second while a timer runs.
      read($, tick),
      // Codex runs as the codex-bridge mod publishes them (another plugin's value: read only, typed loosely here).
      $.state.get({ plugin: 'codex-bridge', key: 'runs' } as never).catch(() => ({})),
      read($, intro),
      read($, replay),
      read($, search),
      read($, mapView),
      read($, hoverOn),
      read($, mapLive),
    ])
    const published = (codexPublished as unknown as { value?: CodexRun[] }).value ?? []
    const codexRuns = [...published, ...(c.demoCodex ?? [])]
    editor = c.editor || 'code'
    const nameFor = (id: string) => c.agents.find(a => a.id === id)?.name ?? (id === 'main' ? 'Claude' : 'a subagent')
    const { Box, Text, Button, Client, Svg, Select, Input } = $.ui.resolve(e) as unknown as Record<string, (props: unknown) => unknown>
    const cols = Math.max(40, e.props?.bodyColumns ?? e.viewport?.columns ?? 80)
    const isTerminal = e.surface === 'terminal'
    if (!isTerminal && Date.now() < playing.until)
      return (
        <Box flexDirection="column">
          <Svg source={bootSvg(Math.round(Math.min(1180, Math.max(360, (cols - 2) * CELL_W))))} alt="Claude Crew starting up: the title rises while little Claudes hop across its letters." />
          <Box flexDirection="row">
            <Box flexGrow={1} />
            <Button key="intro-skip" plain onPress={() => void update($, intro, cur => ({ ...cur, until: 0 }))}>
              {'skip ▸'}
            </Button>
            <Text>{'    '}</Text>
            <Button
              key="intro-off"
              plain
              dimColor
              onPress={() => {
                void $.store.set('intro', 'off').catch(() => undefined)
                void update($, intro, cur => ({ ...cur, until: 0 }))
                void $.ui.toast('Intro off. The ⏻ intro button in the header plays it any time, and turns it back on.')
              }}
            >
              {"don't show again"}
            </Button>
          </Box>
        </Box>
      )

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

    // Map props.
    const nodes = Object.values(c.nodes)
    const dupes = new Set(nodes.map(n => n.label).filter((l, i, all) => all.indexOf(l) !== i))
    const onMap = live.filter(a => a.node && c.nodes[a.node])
    const neighbours = (id: string) => {
      const out = new Set(c.nodes[id]?.imports ?? [])
      for (const n of nodes) if (n.imports.includes(id)) out.add(n.id)
      return [...out].filter(x => c.nodes[x])
    }
    const mapProps = !isTerminal ? { rows: 0, nodes: [], edges: [], agents: [] } : {
      rows: isTerminal ? 12 : 15,
      nodes: nodes.map(n => {
        const here = onMap.filter(a => a.node === n.id)
        const lead = here.find(a => a.state === 'busy') ?? here[0]
        return {
          id: n.id,
          label: dupes.has(n.label) && n.dir ? `${baseName(n.dir)}/${n.label}` : n.label,
          kind: n.kind,
          x: n.x,
          y: n.y,
          heat: n.heat,
          color: lead ? colorOf(lead) : undefined,
          count: here.length,
          typing: here.some(a => a.state === 'busy' && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(a.tool)),
        }
      }),
      edges: [
        ...nodes.flatMap(n => n.imports.filter(t => c.nodes[t]).map(t => ({ a: n.id, b: t, k: 'import' as const }))),
        ...c.trails
          .filter(t => c.nodes[t.a] && c.nodes[t.b] && !c.nodes[t.a].imports.includes(t.b) && !c.nodes[t.b].imports.includes(t.a))
          .map(t => ({ a: t.a, b: t.b, k: 'trail' as const })),
      ],
      agents: onMap.map(a => {
        const options = neighbours(a.node).filter(x => !a.visited.slice(0, 4).includes(x))
        const ahead = options.sort((x, y) => (c.nodes[x].heat ?? 0) - (c.nodes[y].heat ?? 0))[0]
        return { id: a.id, initial: a.name[0], color: colorOf(a), node: a.node, next: ahead, busy: a.state === 'busy' }
      }),
    }

    // Desktop: the picture map and the worked-files folder.
    // The window: the pane's width, and as tall as the map needs up to most of the pane's height.
    // Desks and folder cards (the default), or the tree map with its hand.
    const deskMode = (c.view ?? 'desks') === 'desks'
    const panning = !isTerminal && !!Client && !panFailed && !deskMode
    const inputLive = !isTerminal && !!Client && !panFailed && mapLiveNow
    const vwCols = Math.max(40, Math.min(300, cols - 1))
    const mapW = Math.round(vwCols * CELL_W)
    const bodyRows = Math.max(16, (e.props as { scroll?: { bodyRows?: number } } | undefined)?.scroll?.bodyRows ?? 40)
    // In a replay the map is drawn from the timeline at the chosen step, without Codex.
    const frames = c.timeline ?? []
    const replaying = rp.on && frames.length > 0
    const rpAt = Math.min(rp.at, Math.max(0, frames.length - 1))
    // The step's swing starts when the step is first shown, so a redraw does not restart it.
    if (replaying && replayShown.at !== rpAt) replayShown = { at: rpAt, stamp: Date.now() }
    const map = isTerminal || deskMode
      ? { svg: '', body: '', mw: 1, mh: 1, alt: '', targets: [] as MapTarget[], busyAt: [] as { x: number; y: number }[], hits: [] as { x: number; y: number }[], folded: [] as string[], outsideHidden: 0, codexShown: false, drawn: [] as { x: number; y: number; w: number; h: number }[], hoverable: {} as Record<string, HoverInfo> }
      : replaying
        ? cachedMap(crewAt(c, rpAt, replayShown.stamp), mapW, Date.now(), [], sq.q)
        : cachedMap(c, mapW, Date.now(), codexRuns, sq.q)
    const vhRows = Math.max(10, Math.min(Math.round(bodyRows * 0.62), Math.ceil((map.mh * mapW) / map.mw / CELL_H)))
    const vh = vhRows * CELL_H
    const fit = fitView(mapW, vh, map.mw, map.mh)
    const limits = { vw: mapW, vh, mw: map.mw, mh: map.mh, kMin: Math.min(fit.k, 0.3) * 0.8, kMax: 2.5 }
    // A search hit the window still follows: centred, at full size or closer.
    const hitNo = map.hits.length ? sq.i % map.hits.length : 0
    const onHit = panning && !!sq.q.trim() && map.hits.length > 0 && vs.follow === sq.rev
    const hitView = onHit
      ? (() => {
          const at = map.hits[hitNo]
          const k = Math.max(1, Math.min(limits.kMax, vs.auto ? 1 : vs.k))
          return clampView({ x: at.x - mapW / k / 2, y: at.y - vh / k / 2, k }, limits)
        })()
      : undefined
    const view = hitView ?? (vs.auto || !panning ? startView(mapW, vh, map.mw, map.mh, map.busyAt) : clampView(vs, limits))
    const panRev = hitView ? `s${sq.rev}:${hitNo}:${mapW}x${vh}` : vs.auto || !panning ? `fit:${Math.round(map.mw)}x${Math.round(map.mh)}:${mapW}x${vh}:${Math.round(view.y)}` : vs.rev
    const surfaceKey = `${e.surface}${panning ? '+pan' : ''}`
    draws[surfaceKey] = (draws[surfaceKey] ?? 0) + 1
    // A drawing without the pan module (another surface, the terminal) must not replace the window the
    // module's drags and clicks are measured against.
    if (panning) lastFrame = { ...limits, view, fit, rev: panRev, targets: map.targets, folded: map.folded }
    const hovered = panning ? map.hoverable[hoverId] : undefined
    // Whether the window shows less than the whole map: then there is somewhere to move it.
    const canGo = {
      left: panning && view.k > 0 && view.x > 0.5,
      up: panning && view.k > 0 && view.y > 0.5,
      down: panning && view.k > 0 && view.y + vh / view.k < map.mh - 0.5,
      right: panning && view.k > 0 && view.x + mapW / view.k < map.mw - 0.5,
    }
    const canMove = canGo.left || canGo.up || canGo.down || canGo.right
    const worked = Object.entries(c.changes ?? {}).sort((x, y) => y[1].at - x[1].at)
    const totalAdded = worked.reduce((n, [, ch]) => n + ch.added, 0)
    const totalRemoved = worked.reduce((n, [, ch]) => n + ch.removed, 0)

    /** A row with a dim label in a fixed column, so rows in a window line up. */
    const field = (label: string, body: unknown) => (
      <Box flexDirection="row">
        <Text dimColor>{label.padEnd(6)}</Text>
        <Box flexShrink={1} flexDirection="row">
          {body}
        </Box>
      </Box>
    )
    const twoUp = cols >= 110 && shown.length + codexRuns.filter(r => r.status === 'running' || Date.now() - r.endedAt < 10 * 60_000).slice(0, 2).length > 1
    // Two windows side by side share the width less the one-column gap between them.
    const winWidth = twoUp ? Math.floor((cols - 1) / 2) : '100%'
    const winCols = twoUp ? Math.floor(cols / 2) - 2 : cols - 2
    const barW = Math.max(10, Math.min(40, winCols - 26))

    // Tests: the one running (with a timer), else the last result for a while.
    const tests = c.tests ?? []
    const runningTests = tests.filter(t => t.status === 'running')
    // Commands running now: Claude's (tests aside, they have their own box), and the one each Codex run is in.
    const cmdsRunning = [
      ...runningShells(c, Date.now()).map(x => {
        const who = c.agents.find(a => a.id === x.agentId)
        return { who: x.who, color: who ? colorOf(who) : PALETTE[x.hue % PALETTE.length], label: x.label, startedAt: x.startedAt, background: x.background }
      }),
      ...codexRuns
        .filter(r => r.status === 'running')
        .flatMap(r => {
          const cmd = [...r.events].reverse().find(ev => ev.kind === 'cmd')
          return cmd && cmd.ok === undefined && Date.now() - cmd.at >= SHELL_SHOW_MS ? [{ who: 'Codex', color: CX, label: cmdGist(cmd.text), startedAt: cmd.at, background: false }] : []
        }),
    ].sort((p, q) => p.startedAt - q.startedAt)
    // Everything running now, tests first: who, what for, how long; ◌ in the background.
    const runs = [
      ...[...runningTests].reverse().map(t => {
        const who = c.agents.find(a => a.id === t.agentId)
        return { tint: TEST_TINT, mark: '⚗', who: t.who, color: who ? colorOf(who) : '#D97757', label: t.purpose || testPurpose(t.command, ''), startedAt: t.startedAt, background: t.background }
      }),
      ...cmdsRunning.map(x => ({ tint: '#FFA657', mark: '$', ...x })),
    ]
    const runItem = (x: (typeof runs)[number]) => (
      <Box flexDirection="row" flexShrink={1}>
        <Text color={x.tint}>{`${elapsed(Date.now() - x.startedAt)} ${x.mark} `}</Text>
        <Text bold color={x.color}>{`${x.who}${x.background ? ' ◌' : ''} `}</Text>
        <Box flexShrink={1}>
          <Text wrap="truncate">{x.label}</Text>
        </Box>
      </Box>
    )
    // One row, always there: what runs now (the oldest one or two as the width allows, the rest counted), or that nothing does.
    const runFit = cols >= 110 ? 2 : cols >= 60 ? 1 : 0
    const runningBox = (
      <Box key="running" flexDirection="row" height={1} overflow="hidden">
        {runs.length ? <Text bold color="#FFA657">{`● ${fmtK(runs.length)} running  `}</Text> : <Text dimColor>{'○ nothing running'}</Text>}
        {runs.slice(0, runFit).map((x, i) => (
          <Box flexDirection="row" flexShrink={1}>
            {i ? <Text dimColor>{'   '}</Text> : null}
            {runItem(x)}
          </Box>
        ))}
        {runs.length > runFit && runFit ? <Text dimColor>{`   +${fmtK(runs.length - runFit)} more`}</Text> : null}
      </Box>
    )
    const testLine = (a: Agent) => {
      const mine = tests.filter(t => t.agentId === a.id)
      const t = mine.filter(x => x.status === 'running').pop() ?? mine.filter(x => Date.now() - x.endedAt < TEST_SHOW_MS).pop()
      if (!t) return null
      const tone = { running: TEST_TINT, passed: '#3FB950', failed: '#F85149', unknown: '#8B949E' }[t.status]
      const head =
        t.status === 'running'
          ? `⚗ ${elapsed(Date.now() - t.startedAt)}${t.background ? ' ◌' : ''}`
          : t.status === 'unknown'
            ? '? no result'
            : `${t.status === 'failed' ? '✗' : '✓'} ${testWords(t)} · ${elapsed(t.endedAt - t.startedAt)}`
      return field(
        'test',
        <Box flexDirection="row" flexShrink={1}>
          <Text bold color={tone}>{`${head} `}</Text>
          <Text dimColor wrap="truncate">{t.purpose || testPurpose(t.command, '')}</Text>
        </Box>,
      )
    }

    const agentWindow = (a: Agent) => {
      const color = colorOf(a)
      const verb = verbOf(a)
      const actColor = ACT_COLOR[verb] ?? '#8B949E'
      const where =
        a.state === 'busy' && a.tool !== COMPACT
          ? a.tool === 'Bash' || a.tool === 'PowerShell'
            ? trunc((a.actions[0]?.startsWith('$ ') ? a.actions[0].slice(2) : cmdGist(a.detail)).replace(/^ran /, ''), 28)
            : a.node && c.nodes[a.node]
              ? c.nodes[a.node].label
              : trunc(a.detail, 24)
          : ''
      const { pct, src, doing: onNow, total } = progressOf(a, c)
      const fill = pct >= 0 ? Math.round((pct / 100) * barW) : 0
      const shade = pct >= 0 && total ? Math.min(barW - fill, Math.round((onNow / total) * barW)) : 0
      const dot = a.state === 'busy' ? '●' : a.state === 'thinking' ? '◌' : a.state === 'done' ? '✓' : '○'
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={a.needs ? NEEDS : color} paddingX={1} width={winWidth}>
          <Box flexDirection="row">
            <Box flexShrink={1} flexDirection="row">
              <Text bold color={color}>{`✻ ${trunc(a.name, 18)}`}</Text>
              <Text dimColor wrap="truncate">{a.name.toLowerCase().startsWith(a.kind.toLowerCase()) ? '' : ` ${a.kind}`}</Text>
            </Box>
            <Box flexGrow={1} />
            <Box flexShrink={2}>
              {(() => {
                const w = waitOf(a, c, Date.now())
                if (w?.urgent) return <Text bold color={NEEDS} wrap="truncate">{' ⏸ waiting on you'}</Text>
                if (w && w.kind === 'you') return <Text dimColor wrap="truncate">{' ○ your turn'}</Text>
                if (w) return <Text color={WAIT_TINT[w.kind]} wrap="truncate">{` ⏳ waiting on ${w.short}`}</Text>
                return <Text color={actColor} wrap="truncate">{` ${dot} ${verb}${where ? ` ${where}` : ''}`}</Text>
              })()}
            </Box>
            {a.id !== 'main' && a.state === 'done' ? (
              <Box flexDirection="row" flexShrink={0}>
                <Text>{'  '}</Text>
                <Button key={`fold:${a.id}`} plain dimColor onPress={() => void write?.(d => ({ ...d, unfolded: { ...(d.unfolded ?? {}), [a.id]: false } }))}>
                  {'– fold'}
                </Button>
              </Box>
            ) : null}
          </Box>
          {(() => {
            const goal = a.goal && !systemNote(a.goal) ? oneLine(a.goal) : ''
            // One row: the whole goal is in the summary when the turn ends.
            return field('goal', <Text wrap="truncate" dimColor={!goal}>{goal || (a.id === 'main' ? 'waiting for a prompt' : '…')}</Text>)
          })()}
          {pct >= 0 && (a.state === 'busy' || a.state === 'thinking')
            ? field(
                'work',
                <Box flexDirection="row" flexShrink={1}>
                  <Text color={color}>{'█'.repeat(fill)}</Text>
                  <Text color={color} dimColor>{'▒'.repeat(shade)}</Text>
                  <Text dimColor>{'░'.repeat(barW - fill - shade)}</Text>
                  <Text bold>{` ${String(pct).padStart(3)}%`}</Text>
                  <Text dimColor wrap="truncate">{src === 'done' ? '' : ` ${src}`}</Text>
                </Box>,
              )
            : field('work', <Text dimColor wrap="truncate">{src && (a.state === 'busy' || a.state === 'thinking') ? src : a.state === 'done' ? 'done' : '—'}</Text>)}
          {field('cost', a.tokens ? <Text wrap="truncate">{`${fmtK(a.tokens)} tokens · ${fmtUsd(a.cost ?? 0)}`}</Text> : <Text dimColor>{'—'}</Text>)}
          {(() => {
            // How full its context is: a bar, the share, the window, and how often it was compacted.
            const x = a.ctx
            const squeezed = a.compactions ? ` · compacted ${fmtK(a.compactions)}×` : ''
            if (!x || !x.window) return field('ctx', <Text dimColor wrap="truncate">{`—${squeezed}`}</Text>)
            const pct = Math.max(0, Math.min(100, Math.round((x.tokens / x.window) * 100)))
            const w = Math.max(6, Math.min(20, barW))
            const lit = Math.round((pct / 100) * w)
            return field(
              'ctx',
              <Box flexDirection="row" flexShrink={1}>
                <Text color={ctxTint(pct)}>{'█'.repeat(lit)}</Text>
                <Text dimColor>{'░'.repeat(w - lit)}</Text>
                <Text bold color={pct >= 85 ? ctxTint(pct) : undefined}>{` ${String(pct).padStart(3)}%`}</Text>
                <Text dimColor wrap="truncate">{` of ${fmtK(x.window)}${pct >= 85 ? ' · compacts soon' : ''}${squeezed}`}</Text>
              </Box>,
            )
          })()}
          {a.needs ? (
            field('⏸', <Text bold wrap="truncate" color={NEEDS}>{`needs you: ${a.needs.what}`}</Text>)
          ) : a.stuck ? (
            field('⚠', <Text wrap="truncate" color="#FF7B72">{`Stuck? It ${a.stuck}.`}</Text>)
          ) : (testLine(a) ?? (doingOf(a, c) ? field('now', <Text wrap="truncate">{doingOf(a, c)}</Text>) : null)) ?? (a.thoughts.length ? (
            <Box flexDirection="row">
              <Text color={color}>{'› '}</Text>
              <Box flexShrink={1}>
                <Text wrap="truncate" color="#E6EDF3">
                  {a.thoughts[0]}
                </Text>
              </Box>
            </Box>
          ) : (
            <Text>{' '}</Text>
          ))}
          {[0, 1].map(i =>
            a.actions[i] ? (
              <Box flexDirection="row">
                <Text dimColor>{'  '}</Text>
                <Text wrap="truncate" dimColor>
                  {a.actions[i]}
                </Text>
              </Box>
            ) : (
              <Text>{' '}</Text>
            ),
          )}
        </Box>
      )
    }

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
          text: ev.kind === 'cmd' ? `$ ${cmdGist(ev.text)}${ev.ok === false ? ' ✗ failed' : ''}` : ev.kind === 'file' ? `✎ ${ev.text}` : ev.text,
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
    const codexWins = codexRuns.filter(r => r.status === 'running' || Date.now() - r.endedAt < 10 * 60_000).slice(0, 2)
    const codexWindow = (r: CodexRun) => {
      const tone = { running: '#56D4DD', done: '#7EE787', failed: '#FF7B72', stopped: '#E3B341' }[r.status]
      const mark = { running: '●', done: '✓', failed: '✗', stopped: '■' }[r.status]
      const asker = c.agents.find(a => a.id === r.caller)
      const secs = Math.round(((r.endedAt || Date.now()) - r.startedAt) / 1000)
      const took = elapsed(secs * 1000)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={CX} paddingX={1} width={winWidth}>
          <Box flexDirection="row">
            <Box flexShrink={1} flexDirection="row">
              <Text bold color={CX} wrap="truncate">{`◎ Codex${r.thread ? ` · ${r.thread}` : ''}`}</Text>
              <Text dimColor wrap="truncate">{` ${r.model} · ${r.effort}`}</Text>
            </Box>
            <Box flexGrow={1} />
            <Box flexShrink={2}>
              <Text color={tone} wrap="truncate">{` ${mark} ${r.status === 'running' ? r.activity || 'working' : r.status}`}</Text>
            </Box>
          </Box>
          {field(
            'from',
            <Box flexDirection="row" flexShrink={1}>
              <Text bold color={asker ? colorOf(asker) : '#D97757'}>
                {nameFor(r.caller)}
              </Text>
              <Text dimColor wrap="truncate">{` · ${took} · ${r.mode}${r.resumed ? ' · same thread' : ''}`}</Text>
            </Box>,
          )}
          {(() => {
            const [t1, t2] = twoLines(oneLine(r.task), Math.max(10, winCols - 8))
            return (
              <Box flexDirection="column">
                {field('task', <Text wrap="truncate">{t1}</Text>)}
                {field('', <Text wrap="truncate">{t2 || ' '}</Text>)}
              </Box>
            )
          })()}
          {[0, 1, 2, 3].map(i => {
            const ev = r.events.slice(-4)[i]
            if (!ev) return <Text>{' '}</Text>
            return (
              <Box flexDirection="row">
                <Text color={ev.kind === 'cmd' ? '#FFA657' : ev.kind === 'file' ? '#7EE787' : ev.kind === 'error' ? '#FF7B72' : CX}>
                  {`${{ say: '›', think: '·', cmd: '$', file: '✎', plan: '☐', info: '•', error: '!' }[ev.kind] ?? '•'} `}
                </Text>
                <Box flexShrink={1}>
                  <Text wrap="truncate" dimColor={ev.kind === 'think'}>
                    {`${ev.kind === 'cmd' ? (ev.ok === undefined ? cmdGist(ev.text).replace(/^ran /, 'running ') : cmdGist(ev.text)) : oneLine(ev.text)}${ev.kind === 'cmd' ? (ev.ok === undefined ? '  …' : ev.ok ? '  ✓' : '  ✗') : ''}`}
                  </Text>
                </Box>
              </Box>
            )
          })}
          {[0, 1].map(i => {
            if (i === 1 && r.files.length > 2) return <Text dimColor>{`  ✎ +${fmtK(r.files.length - 1)} more`}</Text>
            const f = r.files[i]
            if (!f) return <Text>{' '}</Text>
            return (
              <Box flexDirection="row">
                <Text color="#7EE787">{'  ✎ '}</Text>
                <Button key={`open:${r.id}:${f}`} plain onPress={() => void openAndSay($, 'file', f, baseName(f), true)}>
                  {trunc(f.startsWith('demo/') ? f.slice(5) : shortPath(f), winCols - 8)}
                </Button>
              </Box>
            )
          })}
          <Text dimColor wrap="truncate">
            {r.status !== 'running'
              ? `${fmtK(r.files.length)} file${r.files.length === 1 ? '' : 's'} changed · ${fmtK(r.commands)} command${r.commands === 1 ? '' : 's'}${r.failedCommands ? ` (${fmtK(r.failedCommands)} failed)` : ''}${r.notesUpdated ? ' · notes updated' : ''}`
              : ' '}
          </Text>
        </Box>
      )
    }
    const logLines = [...c.log, ...codexLog].sort((x, y) => x.at - y.at).slice(isTerminal ? -6 : -12)
    const nameW = Math.min(cols < 80 ? 8 : 12, Math.max(6, ...c.agents.map(a => a.name.length)))
    const demoOn = c.agents.some(a => a.id.startsWith('demo-') && a.state !== 'done')
    const totalTokens = c.spent?.tokens ?? c.agents.reduce((n, a) => n + (a.tokens ?? 0), 0)
    const totalCost = c.spent?.cost ?? c.agents.reduce((n, a) => n + (a.cost ?? 0), 0)

    // The last task's summary: what changed, tests, cost; copied as Markdown for a PR or notes.
    const sm = c.summary
    const summaryCard = sm ? (
      <Box key="summary" flexDirection="column" borderStyle="round" borderColor="#3FB950" paddingX={1}>
        <Box flexDirection="row">
          <Box flexShrink={1}>
            <Text bold color="#3FB950" wrap="truncate">{`✓ Done in ${elapsed(sm.ms)}`}</Text>
          </Box>
          <Box flexGrow={1} />
          <Button
            key="copy-summary"
            plain
            onPress={(press: { surface: never }) =>
              void $.ui
                .copy({ text: summaryMarkdown(sm), surface: press.surface })
                .then(r => $.ui.toast(r.isCopied ? 'Summary copied as Markdown' : "Couldn't reach the clipboard here"))
                .catch(() => undefined)
            }
          >
            {'⧉ copy'}
          </Button>
          <Text>{'   '}</Text>
          <Button key="close-summary" plain onPress={() => void write?.(d => ({ ...d, summary: null }))}>
            {'✕'}
          </Button>
        </Box>
        {sm.goal ? field('goal', <Text wrap="wrap" dimColor>{trunc(sm.goal, cols * 2)}</Text>) : null}
        {field(
          'files',
          <Box flexDirection="row" flexShrink={1}>
            <Text>{`${fmtK(sm.files.length)} changed `}</Text>
            <Text color="#3FB950">{`+${fmtK(sm.files.reduce((n, f) => n + f.added, 0))}`}</Text>
            <Text color="#F85149">{` −${fmtK(sm.files.reduce((n, f) => n + f.removed, 0))}`}</Text>
            <Text dimColor wrap="truncate">{`${sm.read ? ` · ${fmtK(sm.read)} read` : ''} · ${sm.claudes.join(', ')}${sm.codex ? ` · ${fmtK(sm.codex)} Codex run${sm.codex === 1 ? '' : 's'}` : ''}`}</Text>
          </Box>,
        )}
        {field(
          'tests',
          <Text wrap="wrap" color={sm.tests.failed && !sm.tests.last.startsWith('passed') ? '#F85149' : undefined}>
            {sm.tests.runs ? `${fmtK(sm.tests.runs)} run${sm.tests.runs === 1 ? '' : 's'}${sm.tests.failed ? `, ${fmtK(sm.tests.failed)} failed` : ''} · last ${sm.tests.last}` : 'none run'}
          </Text>,
        )}
        {field('cost', <Text wrap="wrap">{`${fmtK(sm.tokens)} tokens · ${fmtUsd(sm.cost)}${sm.problems ? ` · ${fmtK(sm.problems)} open problem${sm.problems === 1 ? '' : 's'}` : ''}`}</Text>)}
      </Box>
    ) : null

    // Problems: the errors the last failing build or test named, each opening at its line.
    const problems = c.problems ?? []
    const problemsBox = problems.length ? (
      <Box key="problems" flexDirection="column" borderStyle="round" borderColor="#F85149" paddingX={1}>
        <Box flexDirection="row">
          <Box flexShrink={1}>
            <Text bold color="#F85149" wrap="truncate">{`✗ ${fmtK(problems.length)} problem${problems.length === 1 ? '' : 's'} · ${problems[0].source}`}</Text>
          </Box>
          <Box flexGrow={1} />
          <Text dimColor>{` ${problems[0].by} · ${clock(problems[0].at)}`}</Text>
        </Box>
        {problems.slice(0, 8).map((p, i) => (
          <Box flexDirection="column">
            <Button key={`problem:${i}:${p.path}:${p.line}`} plain onPress={() => void openAndSay($, 'file', p.path, `${baseName(p.path)}:${p.line}`, false, p.line)}>
              {`${trunc(p.path.startsWith('demo/') ? p.path.slice(5) : shortPath(p.path), Math.max(30, cols - 12))}${p.line ? `:${p.line}` : ''}`}
            </Button>
            <Text wrap="truncate" dimColor>{`   ${oneLine(p.message)}`}</Text>
          </Box>
        ))}
        {problems.length > 8 ? <Text dimColor>{`+${fmtK(problems.length - 8)} more`}</Text> : null}
      </Box>
    ) : null

    // Replay: step through the session's map, one tool call at a time.
    const rf = replaying ? frames[rpAt] : undefined
    const trackW = Math.max(10, Math.min(80, cols - 6))
    const replayBar = rf ? (
      <Box key="replay" flexDirection="column" borderStyle="round" borderColor="#D2A8FF" paddingX={1}>
        <Box flexDirection="row">
          <Box flexShrink={1}>
            <Text bold color="#D2A8FF" wrap="truncate">{`⏪ replay ${rpAt + 1}/${frames.length}${frames.length >= MAX_FRAMES ? ' (latest steps)' : ''} · ${clock(rf.at)}`}</Text>
          </Box>
          <Box flexGrow={1} />
          <Button key="rp-start" plain onPress={() => void replayTo('start')}>{'⏮'}</Button>
          <Text>{' '}</Text>
          <Button key="rp-back" plain onPress={() => void replayTo('back')}>{'◀'}</Button>
          <Text>{' '}</Text>
          <Button key="rp-play" plain onPress={() => void replayTo(rp.playing ? 'pause' : 'play')}>{rp.playing ? '⏸' : '▶'}</Button>
          <Text>{' '}</Text>
          <Button key="rp-fwd" plain onPress={() => void replayTo('fwd')}>{'▶|'}</Button>
          <Text>{' '}</Text>
          <Button key="rp-end" plain onPress={() => void replayTo('end')}>{'⏭'}</Button>
          <Text>{'   '}</Text>
          <Button key="rp-live" plain onPress={() => void replayTo('live')}>{'● live'}</Button>
        </Box>
        <Box flexDirection="row">
          <Text color="#D2A8FF">{'━'.repeat(Math.round(((rpAt + 1) / frames.length) * trackW))}</Text>
          <Text dimColor>{'─'.repeat(trackW - Math.round(((rpAt + 1) / frames.length) * trackW))}</Text>
        </Box>
        <Box flexDirection="row">
          <Text bold color={PALETTE[rf.hue % PALETTE.length]}>{`${rf.name} `}</Text>
          <Text wrap="truncate">{actionLine(rf.tool, rf.node, rf.detail)}</Text>
        </Box>
      </Box>
    ) : null

    // Spend per Claude, and the budget it is measured against.
    const spenders = c.agents.filter(a => (a.cost ?? 0) > 0).sort((x, y) => y.cost - x.cost)
    const topSpend = spenders[0]?.cost ?? 0
    const budgetTone = c.budget > 0 ? (totalCost >= c.budget ? '#F85149' : totalCost >= c.budget * 0.8 ? '#E3B341' : '#3FB950') : '#8B949E'
    const spendRow = !spenders.length && !c.budget ? null : (
      <Box key="spend" flexDirection="row" flexWrap="wrap">
        <Text dimColor>{'spend '}</Text>
        {spenders.slice(0, 5).map(a => (
          <Box flexDirection="row">
            <Text color={colorOf(a)}>{'█'.repeat(Math.max(1, Math.round((a.cost / (topSpend || 1)) * 8)))}</Text>
            <Text dimColor>{` ${a.name} ${fmtUsd(a.cost)}  `}</Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        {spenders.length > 5 ? <Text dimColor>{`+${fmtK(spenders.length - 5)} more  `}</Text> : null}
        {c.budget > 0 ? <Text color={budgetTone}>{totalCost >= c.budget * 10 ? `${fmtK(Math.round(totalCost / c.budget))}× the budget  ` : `${fmtK(Math.round((totalCost / c.budget) * 100))}% of budget  `}</Text> : null}
        {Input && !isTerminal ? (
          <Box width={30}>
            <Input
              key="budget"
              label="budget $"
              placeholder="none"
              value={c.budget ? String(c.budget) : ''}
              submitLabel="set"
              onSubmit={(v: string) => {
                const n = Number(v.replace(/[$,\s]/g, ''))
                const budget = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
                void write?.(d => ({ ...d, budget, budgetWarned: 0 }))
                void $.store.set('budget', budget).catch(() => undefined)
                void $.ui.toast(budget ? `Budget set to ${fmtUsd(budget)}: you'll get a heads-up at 50%, 80% and 100%` : 'Budget cleared')
              }}
            />
          </Box>
        ) : null}
      </Box>
    )

    // The worked-files list: pinned open under the map by its button, or shown by hovering the folder.
    const workedRows = worked.slice(0, 22).map(([path, ch]) => {
      const [badge, color] = fileType(path)
      return (
        <Box flexDirection="row">
          <Text color={color} bold>
            {badge.padEnd(5)}
          </Text>
          <Button key={`open:${path}`} plain onPress={() => void openAndSay($, 'file', path, baseName(path), ch.edits > 0)}>
            {trunc(path.startsWith('demo/') ? path.slice(5) : shortPath(path), Math.max(24, cols - 34))}
          </Button>
          <Box flexGrow={1} />
          {ch.edits ? (
            <Box flexDirection="row">
              <Text color="#3FB950">{` +${fmtK(ch.added)}`}</Text>
              <Text color="#F85149">{` −${fmtK(ch.removed)}`}</Text>
            </Box>
          ) : (
            <Text dimColor>{' read'}</Text>
          )}
          <Text color={PALETTE[ch.hue % PALETTE.length]}>{` ${ch.by}`}</Text>
        </Box>
      )
    })
    const workedList = (
      <Box flexDirection="column">
        {worked.length === 0 ? (
          <Text dimColor>{'none yet'}</Text>
        ) : (
          <Text dimColor wrap="truncate">{editor === 'system' ? 'click to open: each in its own app' : 'click to open · pictures, media and documents in their own app · edited code as a diff'}</Text>
        )}
        {workedRows}
        {worked.length > 22 ? <Text dimColor>{`+${fmtK(worked.length - 22)} more`}</Text> : null}
      </Box>
    )

    // This draw answers the last window write: note how long the frame took, and let the next move through.
    if (lastViewWriteAt && renderStart - lastViewWriteAt < 1500) {
      perf.frames++
      perf.chainMs += renderStart - lastViewWriteAt
      perf.renderMs += Date.now() - renderStart
      lastViewWriteAt = 0
      diagDirty = true
    }
    renderDone?.()
    renderDone = null
    // ── Desks: one card per Claude at work (and each Codex run), what it is on now, and before ──
    const src = replaying ? crewAt(c, rpAt, replayShown.stamp) : c
    // Desks fill the row edge to edge, as many across as fit.
    const deskPer = cols >= 170 ? 5 : cols >= 130 ? 4 : cols >= 100 ? 3 : cols >= 60 ? 2 : 1
    const deskW = deskPer === 1 ? cols - 1 : Math.floor((cols - (deskPer - 1)) / deskPer)
    const deskAgents = replaying ? src.agents.filter(a => a.id === 'main' || a.state === 'busy' || a.state === 'thinking') : shown
    const nowOf = (a: Agent): [string, string] => {
      const w = waitOf(a, src, Date.now())
      if (w) return [w.what, w.label]
      if (a.tool === COMPACT && a.state === 'busy') return ['compacting', 'freeing up room']
      if (a.state === 'busy' && a.node && src.nodes[a.node] && !isSpecial(a.node)) return [baseName(a.node), verbOf(a)]
      // A command: Claude's own words for it, as it runs (not "ran …").
      if (a.state === 'busy' && (a.tool === 'Bash' || a.tool === 'PowerShell'))
        return [(a.actions[0]?.startsWith('$ ') ? a.actions[0].slice(2) : cmdGist(a.detail)).replace(/^ran /, ''), 'running']
      if (a.state === 'busy') return [a.detail ? trunc(oneLine(a.detail), 40) : verbOf(a), verbOf(a)]
      if (a.state === 'thinking') return ['thinking', 'planning its next step']
      if (a.state === 'done') return ['done', a.cost ? fmtUsd(a.cost) : 'finished']
      return ['—', a.id === 'main' ? 'waiting for a prompt' : 'idle']
    }
    const desk = (a: Agent) => {
      const color = colorOf(a)
      const [what, how] = nowOf(a)
      const wait = waitOf(a, src, Date.now())
      // Waiting on helpers or a command: a slow bob (it is not working itself); on you: still.
      const mood = a.needs ? 'needs' : wait && wait.kind !== 'you' ? 'thinking' : a.state === 'busy' ? 'busy' : a.state === 'thinking' ? 'thinking' : a.state === 'done' ? 'done' : 'idle'
      const waitTint = wait && wait.kind !== 'you' ? WAIT_TINT[wait.kind] : undefined
      // The folder only while it works on a file there (not while it waits, asks or compacts).
      const onAFile = a.state === 'busy' && !a.needs && a.tool !== COMPACT && !!a.node && !!src.nodes[a.node] && !isSpecial(a.node)
      const where = onAFile ? groupOf(a.node) : ''
      const before = a.visited.filter(v => v !== a.node && src.nodes[v] && !isSpecial(v)).slice(0, 3).map(v => src.nodes[v].label || baseName(v))
      return (
        <Box key={`desk-${a.id}`} flexDirection="column" borderStyle="round" borderColor={a.needs ? NEEDS : color} paddingX={1} width={deskW}>
          <Box flexDirection="row">
            {isTerminal ? <Text color={color}>{'✻ '}</Text> : <Svg source={deskSprite(color, mood, hash(a.id))} alt={`${a.name}: ${how || what}`} width={52} height={34} />}
            <Box flexDirection="column" flexShrink={1}>
              <Text bold color={color} wrap="truncate">{`${isTerminal ? '' : ' '}${a.name}`}</Text>
              <Text wrap="truncate" color={a.needs ? NEEDS : waitTint} dimColor={!a.needs && !waitTint}>{`${isTerminal ? '' : ' '}${a.needs ? '⏸ ' : waitTint ? '⏳ ' : ''}${how}`}</Text>
            </Box>
          </Box>
          <Text bold wrap="truncate" color={a.needs ? NEEDS : waitTint ?? (a.state === 'busy' ? '#E6EDF3' : undefined)} dimColor={a.state !== 'busy' && !a.needs && !waitTint}>
            {what}
          </Text>
          <Text dimColor wrap="truncate">{where ? (where === OUTSIDE ? 'outside the project' : where === '.' ? 'project top' : where) : ' '}</Text>
          <Text dimColor wrap="truncate">{before.length ? `before: ${before.join(', ')}` : ' '}</Text>
        </Box>
      )
    }
    const codexDesk = (r: CodexRun) => {
      const cmd = [...r.events].reverse().find(ev => ev.kind === 'cmd' || ev.kind === 'file')
      const what = r.status !== 'running' ? r.status : cmd ? (cmd.kind === 'cmd' ? cmdGist(cmd.text).replace(/^ran /, '') : baseName(cmd.text)) : r.activity || 'working'
      const activity = r.status === 'running' && r.activity && r.activity !== what ? r.activity : ''
      return (
        <Box key={`desk-cx-${r.id}`} flexDirection="column" borderStyle="round" borderColor={CX} paddingX={1} width={deskW}>
          <Box flexDirection="row">
            {isTerminal ? <Text color={CX}>{'◎ '}</Text> : <Svg source={deskSprite(CX, r.status === 'running' ? 'busy' : 'done', hash(r.id))} alt={`Codex: ${what}`} width={52} height={34} />}
            <Box flexDirection="column" flexShrink={1}>
              <Text bold color={CX} wrap="truncate">{`${isTerminal ? '' : ' '}Codex${r.thread ? ` · ${r.thread}` : ''}`}</Text>
              <Text dimColor wrap="truncate">{`${isTerminal ? '' : ' '}for ${nameFor(r.caller)}`}</Text>
            </Box>
          </Box>
          <Text bold wrap="truncate" color={r.status === 'running' ? '#E6EDF3' : undefined} dimColor={r.status !== 'running'}>
            {what}
          </Text>
          <Text dimColor wrap="truncate">{r.status === 'running' ? activity || ' ' : `${fmtK(r.files.length)} file${r.files.length === 1 ? '' : 's'} changed`}</Text>
          <Text dimColor wrap="truncate">{r.files.length ? `files: ${r.files.slice(0, 3).map(baseName).join(', ')}` : ' '}</Text>
        </Box>
      )
    }
    // Codex at its desk while it runs, and a little after (as a helper's lingers); the rest counted.
    const codexAtDesks = replaying ? [] : codexRuns.filter(r => r.status === 'running' || Date.now() - (r.endedAt || 0) < WINDOW_LINGER_MS)
    const CODEX_DESKS = 3
    const deskCount = deskAgents.length + Math.min(CODEX_DESKS, codexAtDesks.length) + (codexAtDesks.length > CODEX_DESKS ? 1 : 0)
    deskMax = Math.max(deskMax, deskCount)
    const deskRows = Math.max(1, Math.ceil(deskMax / deskPer))
    // A desk is seven rows: the sprite beside its name and state (two), what it is on, where, before (three),
    // and its border (two). The area keeps at least room for the most there have been, and grows if a desk
    // draws taller than that (it never clips one).
    const desksH = deskRows * 7 + (deskRows - 1)

    // ── Folder cards: each folder the work touched, its files as chips (green edited, red with errors) ──
    // Built from the session's record of touched files (it keeps edits, and the order files were first
    // reached), not from the tree's capped nodes: an edited file never drops off, a folder never moves.
    const q = sq.q.trim().toLowerCase()
    type CardFile = { id: string; label: string; touchedAt: number }
    const relPath = (id: string) => (id.startsWith('demo/') ? id.slice(5) : sessionDir && id.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`) ? id.slice(sessionDir.length + 1) : id)
    const matchesQ = (f: CardFile) => !!q && (relPath(f.id).toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
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
    const chip = (f: CardFile) => {
      const ch = src.changes[f.id]
      const edited = !!(ch && (ch.edits || ch.added || ch.removed))
      const errs = errsOf(f.id)
      const who = onFile.get(f.id) ?? []
      const hit = matchesQ(f)
      const old = !who.length && Date.now() - (f.touchedAt || 0) > FADE_MS
      const plus = edited && (ch!.added || ch!.removed) ? ` +${fmtK(ch!.added)}` : ''
      const minus = edited && ch!.removed ? `−${fmtK(ch!.removed)}` : ''
      const bang = errs ? ` !${errs > 9 ? '9+' : errs}` : ''
      // The name gets what the card leaves after the dots and counts.
      const room = cardW - 4 - 2 - who.length * 2 - textW(plus) - textW(minus) - textW(bang)
      return (
        <Box key={`chip-${f.id}`} flexDirection="row" flexShrink={0}>
          <Button key={`file:${f.id}`} plain dimColor={!hit && old && !errs} onPress={() => void openAndSay($, 'file', f.id, f.label, !!ch?.edits)}>
            {who.map(a => (
              <Text color={a.needs ? NEEDS : colorOf(a)}>{'● '}</Text>
            ))}
            <Text bold={hit || !!who.length} color={errs ? '#FF7B72' : hit ? '#FFFFFF' : edited ? EDITED : undefined}>
              {midCut(f.label, Math.max(6, Math.min(30, room)))}
            </Text>
            {plus ? <Text color={EDITED}>{plus}</Text> : null}
            {minus ? <Text color="#F85149">{minus}</Text> : null}
            {bang ? <Text color="#FF7B72">{bang}</Text> : null}
          </Button>
          <Text>{'  '}</Text>
        </Box>
      )
    }
    const card = ([g, info]: [string, { files: CardFile[]; first: number }]) => {
      const files = [...info.files].sort(natural)
      const shownFiles = q ? files.filter(matchesQ) : files
      const open = !!src.cardsOpen?.[g]
      // Folded, a card still shows what matters: files a Claude is on and files with errors, then the rest by name.
      const key = (f: CardFile) => onFile.has(f.id) || errsOf(f.id) > 0
      const pinned = shownFiles.filter(key).slice(0, CHIPS)
      const pick = new Set([...pinned, ...shownFiles.filter(f => !key(f)).slice(0, CHIPS - pinned.length)].map(f => f.id))
      const list = open ? shownFiles : shownFiles.filter(f => pick.has(f.id))
      const edits = files.filter(f => src.changes[f.id]?.edits).length
      const busy = files.some(f => onFile.has(f.id))
      const label = g === OUTSIDE ? 'outside the project' : g === '.' ? 'project top' : g
      const dirPath = g === OUTSIDE || g.startsWith('demo') ? '' : g === '.' ? sessionDir : `${sessionDir}/${g}`
      return (
        <Box key={`card-${g}`} flexDirection="column" borderStyle="round" borderColor={busy ? '#E3B95C' : '#30363D'} paddingX={1} width={cardW}>
          <Box flexDirection="row">
            {dirPath ? (
              <Button key={`dir:${g}`} plain onPress={() => void openAndSay($, 'dir', dirPath, label)}>
                <Text bold color="#E3B95C">{`📁 ${trunc(label, Math.max(10, cardW - 24))}`}</Text>
                <Text color="#E3B95C" dimColor>{' ↗'}</Text>
              </Button>
            ) : (
              <Text bold color="#E3B95C" wrap="truncate">{`📁 ${label}`}</Text>
            )}
            <Box flexGrow={1} />
            <Text dimColor>{` ${fmtK(files.length)} file${files.length === 1 ? '' : 's'}${edits ? ` · ${fmtK(edits)} edited` : ''}`}</Text>
            {g === OUTSIDE && sessionDir ? (
              <Box flexDirection="row" flexShrink={0}>
                <Text>{'  '}</Text>
                <Button key="hide-outside" plain dimColor onPress={() => void write?.(d => ({ ...d, hideOutside: true }))}>
                  {'✕ hide'}
                </Button>
              </Box>
            ) : null}
          </Box>
          <Box flexDirection="row" flexWrap="wrap">
            {list.map(chip)}
            {shownFiles.length > CHIPS ? (
              <Button key={`more:${g}`} plain dimColor onPress={() => void write?.(d => ({ ...d, cardsOpen: { ...(d.cardsOpen ?? {}), [g]: !open } }))}>
                {open ? '▴ fewer' : `+${fmtK(shownFiles.length - list.length)} more`}
              </Button>
            ) : null}
          </Box>
        </Box>
      )
    }
    const cardsShown = folders.filter(([, info]) => !q || info.files.some(matchesQ))
    const deskSection = (
      <Box flexDirection="column" rowGap={1}>
        <Box key="desks" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} minHeight={desksH}>
          {deskAgents.map(desk)}
          {codexAtDesks.slice(0, CODEX_DESKS).map(codexDesk)}
          {codexAtDesks.length > CODEX_DESKS ? <Text key="desk-more-codex" dimColor>{`+${fmtK(codexAtDesks.length - CODEX_DESKS)} more Codex`}</Text> : null}
        </Box>
        <Box key="cards" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {cardsShown.length ? (
            cardsShown.map(card)
          ) : (
            <Text dimColor wrap="wrap">{q ? `No match for "${trunc(sq.q.trim(), 40)}".` : 'No files yet: folders appear here as the Claudes open files.'}</Text>
          )}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Box flexDirection="row">
            {frames.length > 1 && !replaying ? (
              <Button key="replay" plain onPress={() => void replayTo('play')}>
                {'⏪ replay'}
              </Button>
            ) : (
              <Text dimColor>{'⏪ replay'}</Text>
            )}
            <Text>{'   '}</Text>
          </Box>
          {sessionDir ? (
            <Box flexDirection="row">
              <Button key="open-project" plain onPress={() => void openAndSay($, 'dir', sessionDir, 'the project folder')}>
                {'📁 folder'}
              </Button>
              <Text>{'   '}</Text>
            </Box>
          ) : null}
          <Button key="files" plain onPress={() => void write?.(d => ({ ...d, showFiles: !d.showFiles }))}>
            {`${c.showFiles ? '▾' : '▸'} files ${fmtK(worked.length)}`}
          </Button>
          <Box flexDirection="row" flexShrink={0}>
            <Text color="#3FB950">{`  +${fmtK(totalAdded)}`}</Text>
            <Text color="#F85149">{` −${fmtK(totalRemoved)}`}</Text>
          </Box>
          {outsideCount ? <Text>{'   '}</Text> : null}
          {outsideCount ? (
            <Button key="show-outside" plain onPress={() => void write?.(d => ({ ...d, hideOutside: false }))}>
              {`👁 ${fmtK(outsideCount)} hidden`}
            </Button>
          ) : null}
          {q ? <Text dimColor>{`   ${fmtK(matches)} match${matches === 1 ? '' : 'es'}`}</Text> : null}
          <Box flexGrow={1} />
          <Button key="view-map" plain onPress={() => void write?.(d => ({ ...d, view: 'map' }))}>
            {'⊞ tree map'}
          </Button>
          <Text dimColor>{'   code in '}</Text>
          <Select
            key="editor"
            options={[
              { value: 'code', label: 'VS Code' },
              { value: 'cursor', label: 'Cursor' },
              { value: 'system', label: 'default app' },
            ]}
            value={c.editor || 'code'}
            onSelect={(v: string) => {
              void write?.(d => ({ ...d, editor: v }))
              void $.store.set('editor', v).catch(() => undefined)
            }}
          />
        </Box>
        {c.showFiles ? (
          <Box flexDirection="column" borderStyle="round" borderColor="#F0BC55" paddingX={1}>
            {workedList}
          </Box>
        ) : null}
      </Box>
    )

    const pane = (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold color="#D97757">
            {`✻ CLAUDE CREW v${VERSION}`}
          </Text>
          {waitingOnYou.length ? <Text bold color={NEEDS}>{`  ⏸ ${fmtK(waitingOnYou.length)} waiting on you`}</Text> : null}
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate">
              {(() => {
                // As much as the header has room for beside the search box: all of it, the main counts, or just who is busy.
                const busy = live.filter(a => a.state === 'busy').length
                const claudes = `${fmtK(c.agents.length)} claude${c.agents.length === 1 ? '' : 's'}`
                const codex = codexRuns.length ? ` · codex ${codexRuns.filter(r => r.status === 'running').length}/${codexRuns.length}` : ''
                const squeeze = c.agents.some(a => a.tool === COMPACT && a.state === 'busy') ? ' · 🗜 compacting' : ''
                const spend = totalTokens ? ` · ${fmtUsd(totalCost)}${c.budget ? ` of ${fmtUsd(c.budget)}` : ''}` : ''
                if (isTerminal || cols >= 170)
                  return `  ${claudes} · ${fmtK(busy)} busy · ${fmtK(files)} file${files === 1 ? '' : 's'} · ${fmtK(c.calls)} call${c.calls === 1 ? '' : 's'}${totalTokens ? ` · ${fmtK(totalTokens)} tokens` : ''}${spend}${codex}${squeeze} · ${uptime}`
                if (cols >= 140) return `  ${claudes} · ${fmtK(busy)} busy · ${fmtK(files)} file${files === 1 ? '' : 's'}${spend}${codex}${squeeze} · ${uptime}`
                if (cols >= 110) return `  ${claudes} · ${fmtK(busy)} busy${spend}${codex}${squeeze}`
                if (cols >= 96) return `  ${fmtK(busy)}/${fmtK(c.agents.length)} busy${spend}${squeeze}`
                return ''
              })()}
            </Text>
          </Box>
          <Box flexGrow={1} />
          <Box key="controls" flexDirection="row" flexShrink={0}>
          {!isTerminal && Input && Client && !panFailed ? (
            <Box flexDirection="row" flexShrink={0}>
              {/* Which match of how many; nothing when none (the map simply shows no outline). */}
              {sq.q.trim() && map.hits.length ? <Text dimColor>{`  ${(sq.i % map.hits.length) + 1}/${fmtK(map.hits.length)} `}</Text> : null}
              {/* Just the field: matches show on the map as each letter is typed (Enter also steps to the next one). */}
              {inputLive ? (
                // Just the field: a click gives it the keyboard; each letter typed searches the map.
                <Box width={cols < 90 ? 17 : 26} borderStyle="round" borderColor="#30363D" paddingX={1}>
                  <Client key="search" module="./search.tsx" props={{ q: sq.q }} width={(cols < 90 ? 17 : 26) - 4} height={1} />
                </Box>
              ) : (
                <Box width={cols < 90 ? 17 : 26}>
                  <Input
                    key="search"
                    placeholder="Search files..."
                    value={sq.q}
                    submitLabel=""
                    onInput={(v: string) => void searchFor($, v)}
                    onSubmit={(v: string) => void searchFor($, v, true)}
                  />
                </Box>
              )}
              <Text>{'  '}</Text>
            </Box>
          ) : null}
          {!isTerminal ? (
            <Button
              key="intro"
              plain
              dimColor
              onPress={() => {
                void $.store.set('intro', 'on').catch(() => undefined)
                void playIntro?.()
              }}
            >
              {'⏻ intro'}
            </Button>
          ) : null}
          {!isTerminal ? <Text>{'  '}</Text> : null}
          {!isTerminal ? (
            <Button key="demo" plain dimColor={demoOn} onPress={() => startDemo()}>
              {demoOn ? 'demo…' : '▶ demo'}
            </Button>
          ) : null}
          </Box>
        </Box>

        {deskMode ? deskSection : isTerminal ? (
          <Box flexDirection="column" borderStyle="round" borderColor="#30363D" paddingX={1}>
            <Text dimColor wrap="truncate">
              map · ─ imports · ┄ path taken · ○ not opened yet · ··· where they may go next
            </Text>
            {/* Client props must be plain JSON: the round trip drops undefined fields. */}
            <Client key="map" module="./map.tsx" props={JSON.parse(JSON.stringify(mapProps))} width="100%" height={mapProps.rows} />
            <Box flexDirection="row">
              <Box flexGrow={1} />
              <Button key="view-desks" plain onPress={() => void write?.(d => ({ ...d, view: 'desks' }))}>
                {'▤ desks'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row">
            <Box key="map" flexDirection="column" width={vwCols} height={vhRows} overflow="hidden">
              <Svg source={windowSvg(map.body, mapW, vh, view, (map.drawn.length ? legendSvg(mapW, vh, map.codexShown, view, map.drawn) : "") + hoverTip(hovered, view, mapW, vh), hoverOnMap(hovered))} alt={map.alt} width={mapW} height={vh} />
              {panning ? (
                // The map's hand: hover and click (the arrows and zoom buttons move the map). In the layout,
                // not absolute (an absolute Box passes the pointer to its parent), drawn over the picture.
                // It fills its box (a surface may draw a hand's own cells at another size than text rows).
                <Box marginTop={-vhRows} width={vwCols} height={vhRows} overflow="hidden">
                  <Client
                    key="pan"
                    module="./pan.tsx"
                    props={{ cw: CELL_W, ch: CELL_H, vw: mapW, vh, mw: map.mw, mh: map.mh, kMin: limits.kMin, kMax: limits.kMax, view: { x: view.x, y: view.y, k: view.k }, rev: panRev }}
                    width="100%"
                    height="100%"
                  />
                </Box>
              ) : null}
            </Box>
            </Box>
            <Box flexDirection="row" flexWrap="wrap">
              <Box flexDirection="row">
                {frames.length > 1 && !replaying ? (
                  <Button key="replay" plain onPress={() => void replayTo('play')}>
                    {'⏪ replay'}
                  </Button>
                ) : (
                  <Text dimColor>{'⏪ replay'}</Text>
                )}
                <Text>{'   '}</Text>
              </Box>
              {sessionDir ? (
                <Box flexDirection="row">
                  <Button key="open-project" plain onPress={() => void openAndSay($, 'dir', sessionDir, 'the project folder')}>
                    {'📁 folder'}
                  </Button>
                  <Text>{'   '}</Text>
                </Box>
              ) : null}
              <Button key="files" plain onPress={() => void write?.(d => ({ ...d, showFiles: !d.showFiles }))}>
                {`${c.showFiles ? '▾' : '▸'} files ${fmtK(worked.length)}`}
              </Button>
              <Box flexDirection="row" flexShrink={0}>
                <Text color="#3FB950">{`  +${fmtK(totalAdded)}`}</Text>
                <Text color="#F85149">{` −${fmtK(totalRemoved)}`}</Text>
              </Box>
              {map.outsideHidden ? <Text>{'  '}</Text> : null}
              {map.outsideHidden ? (
                <Button key="show-outside" plain onPress={() => void write?.(d => ({ ...d, hideOutside: false }))}>
                  {`👁 ${fmtK(map.outsideHidden)} hidden`}
                </Button>
              ) : null}
              <Box flexGrow={1} />
              <Text>{' '}</Text>
              <Button key="view-desks" plain onPress={() => void write?.(d => ({ ...d, view: 'desks' }))}>
                {'▤ desks'}
              </Button>
              {panning ? <Text>{'  '}</Text> : null}
              {panning
                ? ([['left', '◀', -1, 0], ['up', '▲', 0, -1], ['down', '▼', 0, 1], ['right', '▶', 1, 0]] as const).map(([dir, glyph, dx, dy]) => (
                    <Box key={`move-${dir}`} flexDirection="row">
                      {canGo[dir] ? (
                        <Button key={`move-${dir}`} plain onPress={() => nudgeView($, dx, dy)}>
                          {glyph}
                        </Button>
                      ) : (
                        <Text dimColor>{glyph}</Text>
                      )}
                      <Text>{' '}</Text>
                    </Box>
                  ))
                : null}
              <Text>{'  '}</Text>
              <Button key="smaller" plain onPress={() => void zoomBy($, 1 / 1.25)}>
                {'−'}
              </Button>
              <Text dimColor>{` ${String(Math.round(view.k * 100)).padStart(3)}% `}</Text>
              <Button key="bigger" plain onPress={() => void zoomBy($, 1.25)}>
                {'+'}
              </Button>
              <Text>{' '}</Text>
              <Button key="fit" plain onPress={() => void update($, mapView, v => ({ ...v, ...fit, auto: false, follow: 0, rev: `r${++viewRev}` }))}>
                {'⤢ fit'}
              </Button>
              <Text dimColor>{'  code in '}</Text>
              <Select
                key="editor"
                options={[
                  { value: 'code', label: 'VS Code' },
                  { value: 'cursor', label: 'Cursor' },
                  { value: 'system', label: 'default app' },
                ]}
                value={c.editor || 'code'}
                onSelect={(v: string) => {
                  void write?.(d => ({ ...d, editor: v }))
                  void $.store.set('editor', v).catch(() => undefined)
                }}
              />
            </Box>
            {c.showFiles ? (
              <Box flexDirection="column" borderStyle="round" borderColor="#F0BC55" paddingX={1}>
                {workedList}
              </Box>
            ) : null}
          </Box>
        )}

        {replayBar}
        {runningBox}

        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {shown.map(agentWindow)}
          {codexWins.map(codexWindow)}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#30363D" paddingX={1}>
          {/* The log's title row also names the helpers that finished (no row of its own to come and go). */}
          <Box flexDirection="row">
            <Text dimColor>{'log'}</Text>
            <Box flexGrow={1} />
            {folded.length ? <Text dimColor>{'done: '}</Text> : null}
            {[...folded]
              .sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0))
              .slice(0, cols >= 140 ? 4 : cols >= 100 ? 2 : 1)
              .map(a => (
                <Box key={`done-${a.id}`} flexDirection="row" flexShrink={0}>
                  <Button key={`unfold:${a.id}`} plain dimColor onPress={() => void write?.(d => ({ ...d, unfolded: { ...(d.unfolded ?? {}), [a.id]: true } }))}>
                    {`▸ ${trunc(a.name, 14)}${a.cost ? ` ${fmtUsd(a.cost)}` : ''}`}
                  </Button>
                  <Text>{'  '}</Text>
                </Box>
              ))}
            {folded.length > (cols >= 140 ? 4 : cols >= 100 ? 2 : 1) ? <Text dimColor>{`+${fmtK(folded.length - (cols >= 140 ? 4 : cols >= 100 ? 2 : 1))}`}</Text> : null}
          </Box>
          {logLines.length === 0 ? <Text dimColor>none yet</Text> : null}
          {/* Blank rows up to the log's fixed height, so it never grows as lines come in. */}
          {Array.from({ length: Math.max(0, (isTerminal ? 6 : LOG_ROWS) - Math.max(1, logLines.length)) }, () => <Text>{' '}</Text>)}
          {logLines.map(l => (
            <Box flexDirection="row">
              <Text dimColor>{`${clock(l.at)} `}</Text>
              <Text color={l.hue < 0 ? CX : PALETTE[l.hue % PALETTE.length]} bold>
                {trunc(l.who, nameW).padEnd(nameW)}
              </Text>
              <Text
                wrap="truncate"
                dimColor={l.kind === 'info'}
                color={l.kind === 'think' ? '#E6EDF3' : undefined}
                italic={l.kind === 'think'}
              >
                {l.kind === 'think' ? ` › ${l.text}` : ` ${l.text}`}
              </Text>
            </Box>
          ))}
        </Box>

        {problemsBox}
        {summaryCard}
        {spendRow}
      </Box>
    )
    // The desktop draws long lines whole and lets the box clip them: cut them to fit first.
    return isTerminal ? pane : fitPane(pane, cols)
  })
}
