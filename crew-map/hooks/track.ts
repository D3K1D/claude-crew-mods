import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Agent, Change, Chat, Crew, LogLine, PlanTask, ShellRun, Summary } from '../types'
import { EMPTY } from './empty'
import { isDemoAgent, isDemoPath } from './demo'
import { homeDir, hostId, journal, journalSid, later$, listDir, nested, readJson } from './web'
import type { ChatFile } from './web'

// Claude Crew's record of the chat: the crew's state, and what each event changes in it (commands,
// tests, problems, tasks, costs, colours), with the words and helpers the rest of the mod shares.

// ─── State ──────────────────────────────────────────────────────────────────

export const PANE = 'crew-map'
/** Shown in the pane's header, so it is plain which version a chat is running. Keep in step with plugin.json. */
export const VERSION = '1.9.0'
/** How /crew's request to Claude starts: the log and the last task leave that turn out. */
export const OPEN_ASK = 'Open my Claude Crew website in the browser pane'
/** How /crew-review's request to Claude starts (that turn, too, is not the chat's goal). */
export const REVIEW_ASK = 'Start a Crew Review of this project'
export const MAX_AGENTS = 12
/** Files reached but not edited or read whole (searched in, named by an error), kept at most. */
export const MAX_REACHED = 60
export const LINGER_MS = 90_000

// Each file that reads or writes a value declares its atom itself (the engine reads them per file): the
// same plugin and key are the same value. The crew, here and in model.ts and register.tsx.
const crew = atom({ plugin: 'crew-map', key: 'crew' } as const, EMPTY)
// ─── Tests ──────────────────────────────────────────────────────────────────

/**
 * A command tidied, with heredoc bodies taken out (the text it carries, not what it runs).
 * Only a real heredoc counts: `cat <<EOF`, not the shift in `$((1<<4))`.
 */
export const cmdHead = (cmd: string) =>
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
export const cmdParts = (cmd: string): string[][] => {
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
export const SUBCOMMANDS = /^(git|npm|pnpm|yarn|bun|cargo|go|docker|kubectl|gh|claude|dotnet|uv|pip|pip3|brew|terraform|make|deno|winget|choco|rustup|poetry)$/
/** Housekeeping that says nothing about the work: left out when a command does more. */
export const CHORES = /^(cd|pushd|popd|echo|printf|true|false|set|export|sleep|test|\[|exit|wait|head|tail|grep|rg|wc|sort|uniq|cut|tr|tee|xargs|less|more|cat|jq)$/
/**
 * What a command runs, in a few words and without its arguments, for when Claude gave no
 * description: "ran sed, cp, diff", "ran a Python script", "ran claude plugin validate".
 */
export const cmdGist = (cmd: string) => {
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
export const TESTY = /(^|[\\/_.-])(tests?|specs?)([\\/_.-]|$)/i
export const TEST_PROGS = /^(pytest|py\.test|jest|vitest|mocha|ava|tap|nextest|ctest|rspec|phpunit|unittest|nose2|tox|karma)$/
/** Whether one part of a command runs tests. */
export const isTestPart = (w: string[]) => {
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
export const isTestCmd = (cmd: string) => cmdParts(cmd).some(isTestPart) || TESTY.test(watchedFile(cmd) === 'a log file' ? '' : watchedFile(cmd))
export const TEST_SHOW_MS = 10 * 60_000
/** A command in the foreground shows as running once it has run this long (a quick `ls` never flashes up). */
export const SHELL_SHOW_MS = 2000
/** A background command nobody hears about again is let go after this long. */
export const SHELL_GIVE_UP_MS = 6 * 60 * 60_000
/** The shell commands running now that are worth showing: background ones, and foreground ones past a moment. */
export const runningShells = (c: Crew, now: number) => (c.shells ?? []).filter(x => x.status === 'running' && (x.background || now - x.startedAt >= SHELL_SHOW_MS))
/** A background shell's end, as its id names it: in what Claude read of it, a stop, or the app's task notice. */
export const endShell = (c: Crew, shellId: string, status: ShellRun['status'], now: number): Crew => {
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
export const testLabel = (cmd: string) => {
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
export const watchedFile = (cmd: string) => {
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
export const testTargets = (cmd: string) => {
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
export const testPurpose = (cmd: string, description: string) => {
  const said = oneLine(description).replace(/\.$/, '')
  if (said) return said
  const watched = watchedFile(cmd)
  if (watched) return `Waiting on a test run (${baseName(watched)})`
  const targets = testTargets(cmd)
  const kind = testKind(cmd)
  return targets ? `${kind[0].toUpperCase()}${kind.slice(1)}: ${targets}` : `All ${kind}`
}

/** The kind of test run, in words, from the runner the command uses. */
export const testKind = (cmd: string) =>
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
export const testCounts = (out: string): { passed: number; failed: number } | undefined => {
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

export const testWords = (t: { status: string; passed: number; failed: number }) =>
  t.passed || t.failed
    ? [t.failed ? `${fmtK(t.failed)} failed` : '', t.passed ? `${fmtK(t.passed)} passed` : ''].filter(Boolean).join(', ')
    : t.status === 'passed'
      ? 'passed'
      : t.status === 'failed'
        ? 'failed'
        : 'no result seen'

export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}

/** How long something took, as the log shows it: 340ms, 2.4s, 1m12s, 1h03m. */
export const took = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : ms < 60_000 ? `${(Math.floor(ms / 100) / 10).toFixed(1)}s` : elapsed(ms))

/** A tool result's text, whatever shape it came back in. */
export const resultText = (r: unknown): string => {
  if (!r || typeof r !== 'object') return typeof r === 'string' ? r : ''
  const o = r as { text?: unknown; content?: unknown; output?: unknown; stdout?: unknown; stderr?: unknown }
  const parts = [o.text, o.output, o.stdout, o.stderr].filter((x): x is string => typeof x === 'string')
  if (typeof o.content === 'string') parts.push(o.content)
  else if (Array.isArray(o.content))
    for (const b of o.content) if (b && typeof (b as { text?: unknown }).text === 'string') parts.push((b as { text: string }).text)
  return parts.join('\n').slice(-20_000)
}

/** Settles a running test from its output and outcome; the log and a toast say how it went. */
export const settleTest = (c: Crew, testId: string, out: string, isError: boolean, now: number): Crew => {
  const t = c.tests.find(x => x.id === testId)
  if (!t || t.status !== 'running') return c
  const counts = testCounts(out)
  const failed = isError || (counts ? counts.failed > 0 : /\b(FAIL|FAILED|failures?:\s*[1-9])\b/.test(out))
  const done: typeof t = { ...t, endedAt: now, status: failed ? 'failed' : 'passed', passed: counts?.passed ?? 0, failed: counts?.failed ?? 0 }
  const secs = Math.max(1, Math.round((now - t.startedAt) / 1000))
  const d = { ...c, tests: c.tests.map(x => (x.id === testId ? done : x)), turnBase: failed && t.startedAt >= c.turnBase.at && !isDemoAgent(t.agentId) ? { ...c.turnBase, failed: (c.turnBase.failed ?? 0) + 1 } : c.turnBase }
  return log(d, t.agentId, 'info', `${failed ? '✗ tests failed' : '✓ tests passed'} (${testWords(done)}) in ${secs}s · ${trunc(t.purpose || testPurpose(t.command, ''), 60)}`)
}

// ─── Problems: errors a build or test names, by file and line ──────────────

/** Builds, type checks and linters, named as a command runs them (so `rm -rf build` is not one). */
/** Whether one part of a command builds, type-checks or lints (so `rm -rf build`, `npm i -D eslint` do not). */
export const isBuildPart = (w: string[]) => {
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
export const isBuildCmd = (cmd: string) => cmdParts(cmd).some(isBuildPart)
export const MAX_PROBLEMS = 30
export const SRC = String.raw`((?:[A-Za-z]:)?[^\s:()"'<>|*?]*[\w-]\.[A-Za-z][\w]{0,5})`

/**
 * Errors in a build's or test's output that name a file: rustc and cargo
 * panics, tsc, C#/MSBuild, gcc/clang/go, Python tracebacks and pytest,
 * jest/vitest stack frames. Paths come back as written; the caller resolves them.
 */
export const parseProblems = (out: string): { path: string; line: number; message: string }[] => {
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
export const cmdDir = (raw: string, base: string) => {
  const m = raw.match(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)/)
  if (!m) return base
  const d = m[1].replace(/^["']|["']$/g, '')
  return /^([A-Za-z]:[\\/]|[\\/])/.test(d) ? norm(d) : norm(`${base}/${d}`)
}

/** A path from tool output made absolute against the folder the command ran in. */
export const resolvePath = (p: string, dir: string) => {
  const s = p.replace(/^\.[\\/]/, '')
  return /^([A-Za-z]:[\\/]|[\\/])/.test(s) || !dir ? norm(s) : norm(`${dir}/${s}`)
}

// ─── Stuck: the same thing failing over and over ────────────────────────────

export const STUCK_WINDOW_MS = 10 * 60_000
/** Why an agent looks stuck from its recent calls, or ''. */
export const stuckReason = (recent: Agent['recent'], now: number): string => {
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
export const relPath = (p: string) =>
  isDemoPath(p) ? p.slice(5) : sessionDir && p.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`) ? p.slice(sessionDir.length + 1) : shortPath(p)

export const summaryMarkdown = (s: Summary) => {
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
export const summarise1 = (c: Crew, now: number, codexRuns: number): Summary => {
  const base = c.turnBase
  const files = Object.entries(c.changes)
    .filter(([p, ch]) => !isDemoPath(p) && ch.at >= base.at && ch.edits > 0)
    .map(([path, ch]) => ({ path, added: ch.added - (base.changes[path]?.added ?? 0), removed: ch.removed - (base.changes[path]?.removed ?? 0) }))
    .filter(f => f.added || f.removed)
    .sort((x, y) => y.added + y.removed - (x.added + x.removed))
  const read = Object.entries(c.changes).filter(([p, ch]) => !isDemoPath(p) && ch.at >= base.at && ch.edits === 0).length
  const lastTest = [...c.tests].reverse().find(t => t.startedAt >= base.at && t.status !== 'running' && !isDemoAgent(t.agentId))
  return {
    at: now,
    goal: base.goal,
    ms: now - (base.at || now),
    files,
    read,
    tests: { runs: base.tests ?? 0, failed: base.failed ?? 0, last: lastTest ? `${lastTest.status} (${testWords(lastTest)})` : 'a run still going' },
    tokens: Math.max(0, (c.spent?.tokens ?? 0) - base.tokens),
    cost: Math.max(0, (c.spent?.cost ?? 0) - base.cost),
    // Who worked on it: the main Claude, and each helper that acted since it began.
    claudes: c.agents.filter(a => a.id === 'main' || (a.calls > 0 && a.doneAt >= base.at)).map(a => a.name),
    codex: Math.max(0, codexRuns - base.codex),
    problems: c.problems.length,
  }
}

/** Where code and text files open: 'code' (VS Code), 'cursor' or 'system', chosen in the pane. Other files open in their own app. */
export let editor = 'code'
/** The session's folder, for paths in tool output; set at session start. */
export let sessionDir = ''
export let platform: 'win' | 'mac' | 'linux' | undefined
/** Which OS this runs on: Windows says so in OS; elsewhere uname tells macOS from Linux. */
export async function platformOf($: EngineInterface) {
  if (platform) return platform
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return (platform = 'win')
  const u = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined)
  return (platform = /darwin/i.test(u?.stdout ?? '') ? 'mac' : 'linux')
}
export let tempDir = ''

/**
 * Anthropic API list prices, dollars per million tokens (cached 2026-09):
 * input, output, cache read, cache write. Matched on the model id.
 */
export const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/i, [10, 50, 0.25, 12.5]],
  [/opus-5-5/i, [4, 20, 0.2, 5]],
  [/opus/i, [5, 25, 0.5, 6.25]],
  [/sonnet-5/i, [2, 10, 0.2, 2.5]],
  [/sonnet/i, [3, 15, 0.3, 3.75]],
  [/haiku/i, [1, 5, 0.1, 1.25]],
]
export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; model?: string }
/** A count that can be added up: a finite number of zero or more, else 0 (a junk usage never poisons a total). */
export const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
export const tokensOf = (u: Usage) => fin(u.input_tokens) + fin(u.output_tokens) + fin(u.cache_read_input_tokens) + fin(u.cache_creation_input_tokens)
export const costOf = (u: Usage) => {
  const [i, o, r, w] = (PRICES.find(([re]) => re.test(typeof u.model === 'string' ? u.model : '')) ?? PRICES[1])[1]
  return (fin(u.input_tokens) * i + fin(u.output_tokens) * o + fin(u.cache_read_input_tokens) * r + fin(u.cache_creation_input_tokens) * w) / 1e6
}
/** A count in at most five characters: 7, 950, 1.2k, 12k, 345k, 1.0M, 33M, 2.1B. */
export const fmtK = (v: number) => {
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
export const fmtUsd = (n: number) => (!(n > 0) ? '$0' : n < 0.01 ? '<$0.01' : n < 100 ? `$${n.toFixed(2)}` : n < 999.5 ? `$${Math.round(n)}` : `$${fmtK(n)}`)

// Set from session.start, so timers and handlers outlive the dispatch that made them.
export let write: ((fn: (c: Crew) => Crew) => Promise<unknown>) | undefined
/** Every write of the crew waits for the one before it: parallel tool calls never race (a race made each retry, N² writes). */
export let writeQueue: Promise<unknown> = Promise.resolve()
// ── Nested chats: the chats started from this one, read from the desktop app's own session list ──
export const LIST_TOOL = 'mcp__ccd_session_mgmt__list_sessions'
/**
 * The chats under this one, from list_sessions' `{ linked: true }` answer (this chat's family, less
 * itself): this chat is the one that started those whose starter the list doesn't hold.
 */
/** The app's list as rows: each chat's id, title, short name, who started it, folder, branch, running, last active. */
export const listRows = (text: string) => {
  let rows: unknown
  try {
    rows = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(rows)) return undefined
  return rows
}
export const chatsOf = (text: string, selfId = ''): Chat[] | undefined => {
  const rows = listRows(text)
  if (!rows) return undefined
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const all = (rows.filter(r => r && typeof r === 'object') as Record<string, unknown>[])
    .filter(r => str(r, 'sessionId') && r.isArchived !== true)
    .map(r => ({ id: str(r, 'sessionId'), title: str(r, 'title') || str(r, 'name') || 'A chat', name: str(r, 'name'), parent: str(r, 'startedBy'), cwd: str(r, 'cwd').replace(/\\/g, '/'), branch: str(r, 'branch'), running: r.isRunning === true, at: Date.parse(str(r, 'lastActivityAt')) || 0, depth: 1, seen: Date.now() }))
  const ids = new Set(all.map(x => x.id))
  const self = selfId ? [selfId] : [...new Set(all.filter(x => x.parent && !ids.has(x.parent)).map(x => x.parent))]
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
/** The project this chat works in: its git repository's top (the main checkout, for a worktree), else its folder. */
export let projectRoot = ''
/** How many same-project chats are shown at most (the most recently active). */
export const SIBLINGS_MAX = 6
export const inProject = (cwd: string) => {
  const root = projectRoot.toLowerCase()
  const at = norm(cwd).toLowerCase()
  return !!root && !!at && (at === root || at.startsWith(`${root}/`))
}
/** A chat's file is this project's: by the root it recorded, else its folder, else (an older file) the app's list. */
export const fileInProject = (f: Pick<ChatFile, 'root' | 'cwd'> | undefined, listed?: Pick<Chat, 'cwd'>) =>
  f?.root ? !!projectRoot && norm(f.root).toLowerCase() === projectRoot.toLowerCase() : f?.cwd ? inProject(f.cwd) : listed ? inProject(listed.cwd) : false
/**
 * The chats that worked in this project, from the files each one writes about itself (so archived and
 * deleted chats too, never another project's): written since `after` (ms), the newest 30 at most.
 */
export const projectChatFiles = async (c: Crew, after = 0) => {
  if (!homeDir) return []
  const dir = `${homeDir}/.claude/crew-map/chats`
  const listed = new Map([...(c.chats ?? []), ...(c.siblings ?? [])].map(x => [x.id, x]))
  const entries = (await listDir(dir))
    .filter(e => /^local_[\w-]+\.json$/.test(e.name) && e.name !== `${hostId}.json` && (!after || (e.mtimeMs ?? 0) >= after))
    .sort((x, y) => (y.mtimeMs ?? 0) - (x.mtimeMs ?? 0))
    .slice(0, 300)
  const out: { id: string; journal: string; nested: boolean; label: string }[] = []
  for (const e of entries) {
    if (out.length >= 30) break
    const id = e.name.slice(0, -5)
    const f = (await readJson(`${dir}/${e.name}`)) as ChatFile | undefined
    if (!f || typeof f.journal !== 'string' || !/^[\w-]+$/.test(f.journal) || !fileInProject(f, listed.get(id))) continue
    const ch = listed.get(id)
    out.push({ id, journal: f.journal, nested: !!(c.chats ?? []).some(x => x.id === id), label: trunc(ch ? ch.name || ch.title : typeof f.goal === 'string' && f.goal ? `no longer listed, it was asked: ${f.goal}` : 'no longer listed', 100) })
  }
  return out
}
/** The other chats in this project, from the app's whole list: not archived, not this chat, not one nested under it. */
export const siblingsOf = (text: string, selfId: string, nestedIds: Set<string>): Chat[] | undefined => {
  const rows = listRows(text)
  if (!rows || !selfId) return undefined
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return (rows.filter(r => r && typeof r === 'object') as Record<string, unknown>[])
    .filter(r => str(r, 'sessionId') && str(r, 'sessionId') !== selfId && !nestedIds.has(str(r, 'sessionId')) && r.isArchived !== true && inProject(str(r, 'cwd')))
    .map(r => ({ id: str(r, 'sessionId'), title: str(r, 'title') || str(r, 'name') || 'A chat', name: str(r, 'name'), parent: str(r, 'startedBy'), cwd: str(r, 'cwd').replace(/\\/g, '/'), branch: str(r, 'branch'), running: r.isRunning === true, at: Date.parse(str(r, 'lastActivityAt')) || 0, depth: 1, seen: Date.now() }))
    .sort((a, b) => b.at - a.at)
    // Every one at work; of the rest, the newest few (a bound on what is read).
    .filter((x, i, all) => x.running || all.filter(y => !y.running).indexOf(x) < SIBLINGS_MAX)
    .slice(0, 20)
}
/**
 * Where a Crew Review starts: since this chat began (no argument), a span back ("2h", "90m", "3d", "1w"),
 * a date ("2026-11-18"), or a git ref ("since v1.8.8", "main"). Anything else: what to type instead.
 */
export type ReviewSince = { label: string; at: number; git: string } | { error: string }
export const REVIEW_USAGE = 'Usage: /crew-review, /crew-review 2h (or 90m, 3d, 1w), /crew-review since 2026-11-18, or /crew-review since v1.8.8 (a git tag, branch or commit).'
export const reviewSince = (args: string, startedAt: number, now = Date.now()): ReviewSince => {
  const a = oneLine(args).replace(/^since\s+/i, '').trim()
  const iso = (ms: number) => new Date(ms).toISOString()
  if (!a) return { label: 'since this chat began', at: startedAt, git: `git log --since="${iso(startedAt)}" --stat` }
  const span = a.match(/^(\d{1,4})\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/i)
  if (span) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[span[2][0].toLowerCase() as 'm' | 'h' | 'd' | 'w']
    const at = now - Number(span[1]) * unit
    return { label: `in the last ${span[1]}${span[2][0].toLowerCase()}`, at, git: `git log --since="${iso(at)}" --stat` }
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(a) && Number.isFinite(Date.parse(a))) {
    const at = Date.parse(a)
    return { label: `since ${a}`, at, git: `git log --since="${iso(at)}" --stat` }
  }
  // A git ref, as git names them (no spaces, no shell characters): the review starts at it.
  if (/^[\w][\w./@^~-]{0,79}$/.test(a) && !a.includes('..')) return { label: `since ${a}`, at: 0, git: `git log ${a}..HEAD --stat` }
  return { error: `Couldn't read "${trunc(a, 40)}" as a time or a git ref. ${REVIEW_USAGE}` }
}
/** The request /crew-review sends Claude: start the "Crew Review" chat, with its whole brief. */
export const reviewAsk = async (since: Exclude<ReviewSince, { error: string }>, c: Crew) => {
  const base = homeDir ? `${homeDir}/.claude/crew-map` : '~/.claude/crew-map'
  // Only chats whose own file says they worked in this project (by its git root or folder), active since the start.
  const files = await projectChatFiles(c, since.at)
  const mine = journalSid ? [`${base}/journals/${journalSid}/ (this chat)`] : []
  const kids = files.filter(f => f.nested).map(f => `${base}/journals/${f.journal}/ (nested chat "${f.label}")`)
  const project = files.filter(f => !f.nested).map(f => `${base}/journals/${f.journal}/ (a chat in this project: ${f.label})`)
  const from = since.at ? `Only lines whose "at" (milliseconds since 1970) is at least ${since.at} (${new Date(since.at).toISOString()}).` : `All lines (the review starts at a git ref; match them up by time with the git history).`
  const brief = [
    `You are the Crew Review for the project in ${sessionDir || 'this folder'}. Review the changes ${since.label} and summarise them for the person. Read only: don't edit code, run builds or change git unless they ask you to.`,
    '',
    'Sources:',
    `- Claude Crew's logs (each folder holds numbered chunks, 000001.json and on: JSON arrays of lines {at, who, kind, text, more?, path?, took?, bad?}; "more" holds an edit's diff or a command's last output; touched.json lists the files touched). ${from}`,
    ...[...mine, ...kids].map(p => `  - ${p}`),
    ...(project.length ? ['- Optional, if they relate: the other chats in this project.', ...project.map(p => `  - ${p}`)] : []),
    `- Each chat's own summary of its cards and steps: ${base}/chats/<app id>.json (its "root" names its project: read only those whose root is ${projectRoot || sessionDir}).`,
    "- No other chat's logs: the folders above are this project's only.",
    `- Git: ${since.git}, then git diff for the files that matter (and git status for work not committed yet).`,
    `- Saved logs and summaries, if any: .claude/crew-logs/ in the project.`,
    '',
    'Write the summary under these headings: What changed (by area, with the files), How (the approach), Why (the reasons given in the logs and commits), Problems and fixes (what failed and what fixed it), and What is open (unfinished steps, failing tests, follow-ups). Be concrete and short; name commits and files.',
    '',
    'Then ask the person what to do with it, for example: save it to .claude/crew-logs/reviews/<date>-review.md, turn it into release notes, or into a pull request description. Change nothing until they say.',
  ].join('\n')
  return [
    `${REVIEW_ASK}: start a nested chat with mcp__ccd_session__start_session, initiation "user_asked", title "Crew Review", context "fresh", in this project's folder, with exactly this brief as its prompt:`,
    '',
    '"""',
    brief,
    '"""',
  ].join('\n')
}
export let readCrew: (() => Promise<Crew>) | undefined
export let after: ((ms: number, fn: () => void) => void) | undefined
export let every: ((ms: number, fn: () => void) => { cancel: () => void }) | undefined
export let readFile: ((path: string) => Promise<string>) | undefined
/** At session start: the engine's calls that timers and handlers use outside the dispatch that made them. */
export function bindEngine($: EngineInterface) {
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
}
/** At session start: the chat's folder, and its project (its git repository's top; the main checkout's, for a worktree). */
export function setFolder($: EngineInterface, dir: string) {
  sessionDir = dir
  projectRoot = dir
  void later$(() => $.process.run(['git', '-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 5000 }))
    .then(r => {
      const git = norm(String(r?.stdout ?? '').trim())
      if (r?.exitCode === 0 && /\/\.git$/i.test(git)) projectRoot = git.slice(0, -5)
    })
    .catch(() => undefined)
}

// ─── Vocabulary ─────────────────────────────────────────────────────────────

// Twelve identity colours, given out in this order (the main Claude always the first, clay); 7-12 are
// paler ones (the pale clay last, as it reads close to the main Claude's). No green, yellow, red or grey: those mean working, waiting on you, an error, and Codex.
// (The dark theme's; the website has each theme's own.)
export const PALETTE = ['#D97757', '#6CB6FF', '#F778BA', '#56D4DD', '#C297FF', '#C9A47E', '#B6DCFF', '#A8EEF2', '#E2CCFF', '#FFB8DA', '#E8D2B4', '#F2B49B']
export const NAMES: Record<string, string> = { Explore: 'Scout', Plan: 'Architect', 'general-purpose': 'Helper', fork: 'Twin' }
export const VERB: Record<string, string> = {
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
export const ICON: Record<string, string> = { Read: '◇', Edit: '✎', MultiEdit: '✎', Write: '✎', Bash: '▸', PowerShell: '▸', Grep: '⌕', Glob: '⌕', WebFetch: '◎', WebSearch: '◎', Agent: '⇢', Task: '⇢', 'mcp__codex-bridge__codex': '◎' }
VERB['mcp__codex-bridge__codex'] = 'asking Codex'
export const SPECIAL_LABEL: Record<string, string> = {
  $terminal: 'terminal',
  '@web': 'web',
  '?search': 'search',
  '@browser': 'browser',
  '@computer': 'this PC',
  '@remote': 'remote PC',
  '@docs': 'documents',
  '@claude': 'Claude app',
}
/** Where a tool works when it is not a file: the terminal, the web, a browser, an app. */
export const isSpecial = (id: string) => id in SPECIAL_LABEL || id.startsWith('@app:')

// ─── Tools beyond the built-in ones: MCP servers, browsers, the computer ───

export const KNOWN_APPS: Record<string, string> = {
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
export const appName = (raw: string) => {
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
export const mcpParts = (tool: string) => {
  const m = tool.match(/^mcp__(.+?)__(.+)$/)
  return m ? { server: m[1], name: m[2] } : undefined
}
/**
 * The station a tool works at, when it is not a file: a browser (the app's own
 * pane, Claude in Chrome, Playwright…), this computer or a remote one, the
 * documents tools, the Claude app's own controls, or another MCP server (an app
 * such as Blender). '' for the built-in tools and Codex.
 */
export const stationOf = (tool: string): string => {
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
export const stationLabel = (id: string) => SPECIAL_LABEL[id] ?? (id.startsWith('@app:') ? appName(id.slice(5)) : '')
export const STATION_ICON: Record<string, string> = { '@browser': '◍', '@computer': '▣', '@remote': '▣', '@docs': '▤', '@claude': '⧉' }
/** The pseudo-tool a Claude is "using" while the engine compacts its conversation. */
export const COMPACT = '__compact'
/** A doc rather than code: what Claude writes for people to read. */
export const DOC_EXT = /\.(md|mdx|markdown|txt|rst|adoc|docx?|odt|rtf|html?)$/i

/** What a Claude is doing, in a word or two (Coding, Viewing an image, Browsing): its row says it. */
export const activityOf = (a: Agent): string => {
  if (a.needs) return 'Needs you'
  if (a.state !== 'busy')
    return /\b(maybe|could|alternativ|options?|ideas?|what if|perhaps|approach|consider|instead)\b/i.test(a.thoughts[0] ?? '')
      ? 'Brainstorming'
      : 'Thinking'
  const cmd = a.detail
  switch (a.tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return DOC_EXT.test(a.node) ? 'Writing docs' : 'Coding'
    case 'Read':
      return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.node) ? 'Viewing an image' : /\.pdf$/i.test(a.node) ? 'Reading a PDF' : 'Reading'
    case 'Grep':
    case 'Glob':
      return 'Searching'
    case 'Bash':
    case 'PowerShell':
      if (isTestCmd(cmd)) return 'Waiting on tests'
      if (isBuildCmd(cmd)) return 'Building'
      if (/\bgit\s+(commit|push|merge|rebase)\b/i.test(cmd)) return 'Committing'
      if (/\b(gdb|lldb|debug|RUST_BACKTRACE)\b/i.test(cmd)) return 'Debugging'
      return 'Running'
    case 'WebFetch':
    case 'WebSearch':
      return 'Researching'
    case 'Agent':
    case 'Task':
      return 'Delegating'
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Planning'
    case 'Skill':
      return 'Using a skill'
    case COMPACT:
      return 'Compacting memory'
    default: {
      if (/__codex$/.test(a.tool)) return 'Asking Codex'
      const st = stationOf(a.tool)
      if (st === '@browser') return 'Browsing'
      if (st === '@computer') return 'Using the PC'
      if (st === '@remote') return 'Using the remote PC'
      if (st === '@docs') return 'Writing a document'
      if (st === '@claude') return 'Using the app'
      if (st) return `Using ${stationLabel(st)}`
      return 'Working'
    }
  }
}

export const colorOf = (a: { hue: number }) => PALETTE[a.hue % PALETTE.length]
/** Later than any time: a holder at work now. */
export const NOW_ON = 9e15
/**
 * The next colour nobody holds (the main Claude keeps the first). Past 12: the one whose holders have
 * been done or idle the longest. Colours are never given back while the chat lasts: their lines stay.
 */
export const pickColor = (c: Crew) => {
  const lastAt = new Map<number, number>()
  for (const [k, v] of Object.entries(c.colors ?? {})) {
    const a = c.agents.find(x => x.id === k)
    const ch = k.includes('~') ? undefined : c.chats?.find(x => `chat:${x.id}` === k)
    const at = a ? (a.state === 'busy' || a.state === 'thinking' || a.needs ? NOW_ON : a.doneAt || v.at) : ch ? (ch.running ? NOW_ON : ch.at || v.at) : v.at
    lastAt.set(v.i, Math.max(lastAt.get(v.i) ?? 0, at))
  }
  for (let i = 1; i < PALETTE.length; i++) if (!lastAt.has(i)) return i
  return [...lastAt].filter(([i]) => i > 0).sort((x, y) => x[1] - y[1])[0]?.[0] ?? 1
}
/** Gives `key` (chat:<id>, or chat:<id>~<helper id>) a colour when it has none. */
export const giveColor = (c: Crew, key: string): Crew => (c.colors?.[key] ? c : { ...c, colors: { ...c.colors, [key]: { i: pickColor(c), at: Date.now() } } })
/** The colours as last read (for lines drawn outside a read of the crew). */
export let knownColors: NonNullable<Crew['colors']> = {}
/** The choices a draw last read: where files open, and who has which colour (for lines drawn outside a read). */
export const seeChoices = (c: Crew) => {
  editor = c.editor || 'code'
  knownColors = c.colors ?? {}
}
/** A nested chat's colour (its main Claude's too), or one of its helpers': an index into PALETTE. */
export const chatHue = (id: string, helper = '') =>
  knownColors[helper ? `chat:${id}~${helper}` : `chat:${id}`]?.i ?? 1 + ([...`${id}${helper}`].reduce((n, x) => n + x.charCodeAt(0), 0) % (PALETTE.length - 1))
export const verbOf = (a: Agent) =>
  a.state === 'busy' ? (VERB[a.tool] ?? activityOf(a).toLowerCase()) : a.state === 'thinking' ? 'thinking' : a.state === 'done' ? 'done' : 'idle'
export const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
/** The last three segments of a path: enough to tell files apart. */
export const shortPath = (p: string) => {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/')
}
export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const trunc = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
/**
 * Text cut short to fit, done by the pane itself. The desktop draws a `wrap: "truncate"` Text in
 * a row at its full length and the box's edge clips it (no "…"), so before a desktop pane is
 * returned, every such Text is cut to the columns its row leaves it. Widths are in text cells: the
 * pane's columns, less borders, padding and what else stands in the row; a wide glyph counts two,
 * and a little is kept spare because the desktop's font is proportional (some letters are wider).
 */
export type FitNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | number | null | undefined | false
export const kidsOf = (x: FitNode): FitNode[] => (x && typeof x === 'object' ? ((x.children ?? (x.props?.children as unknown[] | undefined) ?? []) as FitNode[]) : [])
// The element as given when nothing in it changed; else a copy with its children where it keeps
// them. The engine keeps them on the element and refuses a "children" prop (a whole pane drew
// nothing for it once), so they are never moved into props.
export const withKids = (x: Exclude<FitNode, string | number | null | undefined | false>, kids: FitNode[]) => {
  const was = kidsOf(x)
  if (kids.length === was.length && kids.every((k, i) => k === was[i])) return x
  if (Array.isArray(x.children)) return { ...x, children: kids }
  if (x.props && Array.isArray(x.props.children)) return { ...x, props: { ...x.props, children: kids } }
  return { ...x, children: kids }
}
export const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
export const glyphW = (ch: string) => (WIDE.test(ch) ? 2 : 1)
export const textW = (t: string) => {
  let n = 0
  for (const ch of t) n += glyphW(ch)
  return n
}
/** A string cut to `w` cells, ending in "…" when cut. */
export const cutTo = (t: string, w: number) => {
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
export const wrapRows = (t: string, w: number, max: number): string[] => {
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
/** The model each Claude runs on, by agent, as its model steps say. */
export const agentModel = new Map<string, string>()
/** When each Claude's current model step began, by agent: how long it has been thinking (kept here, not written). */
export const stepStart = new Map<string, number>()

/** How long a helper's row stays (marked done) after it finishes, so rows do not blink in and out. */
export const WINDOW_LINGER_MS = 20_000
/** Lines the log keeps to scroll back through. */
export const LOG_KEEP = 120
/** How many lines a press of ▲ or ▼ moves the log. */
export const LOG_STEP = 3
/**
 * A turn the app started by itself, not a prompt: a background task or monitor
 * reporting in, a CI event, a slash command's output. Returns a short line for
 * the log, or '' for a real prompt.
 */
export const SYSTEM_TAG = /^\s*<(task-notification|agent-message|system-reminder|ci-monitor-event|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-notification|bash-input|bash-stdout|user-memory-input|[a-z][\w-]*-(?:notification|event|reminder))[\s>]/i
export const systemNote = (full: string) => {
  if (full.startsWith(OPEN_ASK)) return 'opening Claude Crew'
  if (full.startsWith(REVIEW_ASK)) return 'starting a Crew Review'
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
export const relayedOf = (full: string): { from: string; body: string } | undefined => {
  const m = full.slice(0, 8000).match(/^\s*<(cross-session-message|channel|[a-z]+-message)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/i)
  if (!m) return undefined
  const attr = (k: string) => m[2].match(new RegExp(`\\b${k}="([^"]*)"`, 'i'))?.[1]?.trim() ?? ''
  const from = attr('from-name') || attr('sender') || attr('user') || attr('name') || (m[1].toLowerCase() === 'cross-session-message' ? 'another session' : m[1].replace(/-/g, ' '))
  return { from: trunc(oneLine(from), 40), body: oneLine(m[3].replace(/<[^>]*>/g, ' ')) }
}
/** What a prompt asks, without the app's wrapper round it. */
export const promptOf = (t: string) => relayedOf(t)?.body || t
/** A message in the log: yours, or another session's (also one logged as yours before this was told apart). */
export const messageOf = (l: LogLine): { from: string; body: string } | undefined =>
  l.kind === 'msg' ? { from: l.who, body: l.text } : l.kind === 'you' ? (relayedOf(l.text) ?? { from: '', body: l.text }) : undefined
/** A log line as it reads closed, and opened whole: a thought's every word, an action and what came of it. */
export const shortOf = (l: LogLine) => {
  const m = messageOf(l)
  return m ? (m.from ? `${m.from}: ${m.body}` : m.body) : l.kind === 'think' ? l.text : `${l.text.replace(/^$ /, SHELL_MARK)}${failMark(l)}`
}
/** A failed action's words: added where it shows (its text is its key; a line from before carries them). */
export const failMark = (l: LogLine) => (l.kind !== 'act' || !l.bad || / ✗ (failed|refused)$/.test(l.text) ? '' : l.refused ? ' ✗ refused' : ' ✗ failed')
export const fullOf = (l: LogLine) => (l.kind === 'think' && l.full ? l.full : l.more ? `${shortOf(l)}\n${l.more}` : shortOf(l))
export const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
/** A log line's address, for opening it: its time and what it says. */
// (A nested chat's line by the chat's id and who there did it, not the chat's name, which the app may change.)
export const logKey = (l: LogLine) => `${l.at}:${(hash(`${l.chat ? `${l.chat}|${l.by ?? 'Claude'}` : l.who}|${l.kind}|${l.text}`) >>> 0).toString(36)}`
export const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const norm = (p: string) => {
  const raw = p.replace(/\\/g, '/')
  const parts: string[] = []
  for (const seg of raw.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  const joined = (raw.startsWith('//') ? '//' : raw.startsWith('/') ? '/' : '') + parts.join('/')
  return /^[a-z]:/.test(joined) ? joined[0].toUpperCase() + joined.slice(1) : joined
}

export const nodeOf = (tool: string, a: Record<string, unknown>): string => {
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

export const detailOf = (tool: string, a: Record<string, unknown>): string => {
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
export const SHELL_MARK = '▸ '

export const actionLine = (tool: string, node: string, detail: string, said = '') => {
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
export const cleanSaid = (text: string) => oneLine(text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>]/g, ''))
export const summarise = (text: string): string => {
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

export const blank = (id: string, name: string, kind: string, hue: number): Agent => ({
  id,
  name,
  kind,
  hue,
  node: '',
  tool: '',
  detail: '',
  pending: [],
  state: 'idle',
  doneAt: 0,
  calls: 0,
  goal: '',
  thoughts: [],
  actions: [],
  todosDone: 0,
  todosTotal: 0,
  doing: '',
  since: 0,
  tokens: 0,
  cost: 0,
  stuck: '',
  recent: [],
})

/** Files with an app of their own (pictures, sound, video, documents, archives, fonts, 3D): the system's app for the type opens them. */
export const OWN_APP =
  /\.(png|jpe?g|jfif|gif|bmp|webp|tiff?|ico|heic|heif|avif|psd|cr2|nef|arw|dng|exr|hdr|dds|tga|xcf|kra|aseprite|mp3|wav|flac|ogg|oga|m4a|aac|wma|opus|aiff?|midi?|mp4|m4v|mov|mkv|avi|wmv|webm|flv|mpe?g|3gp|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub|xps|zip|7z|rar|tar|gz|tgz|bz2|xz|iso|dmg|ttf|otf|woff2?|blend|fbx|glb|stl|3mf|rbxl|rbxm|unitypackage)$/i
/** Programs, which the system would run rather than open: shown in their folder instead. */
export const PROGRAM = /\.(exe|com|msi|msp|msix|appx|scr|pif|lnk|url|cpl|hta|jar|app|appimage|run|dll|sys|appref-ms)$/i
/** Scripts the system would run if handed one: opened in an editor, else shown in their folder. */
export const SCRIPT = /\.(bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|reg|sh|command|desktop)$/i
/**
 * Where a click on a file sends it: the system's app for its type, the editor chosen in the pane (code and
 * text), or its folder with it picked out (a program, or a script with no editor to open it in).
 */
export const routeOf = (path: string, os: string, choice = editor): 'app' | 'editor' | 'reveal' => {
  if (PROGRAM.test(path)) return 'reveal'
  if (OWN_APP.test(path)) return 'app'
  // cmd would act on these characters in a path, so such a file goes to the system, not the editor's launcher.
  if (choice === 'system' || (os === 'win' && /[&|<>^%!"]/.test(path))) return SCRIPT.test(path) ? 'reveal' : 'app'
  return 'editor'
}
/** How the system opens a path with its default app, and how it shows a file picked out in its folder. */
export const defaultApp = (os: string, path: string) => (os === 'win' ? ['explorer', path.replace(/\//g, '\\')] : os === 'mac' ? ['open', path] : ['xdg-open', path])
// Explorer's /select wants the path in quotes of its own, which an argument list cannot pass when the path
// has a space; PowerShell passes it as written (the path in a literal string, its quotes doubled).
export const revealIn = (os: string, path: string) =>
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
export async function openInEditor($: EngineInterface, path: string, hasEdits: boolean, line = 0): Promise<Opened> {
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
export type Opened = { ok: boolean; why: string }

/** A shell command as a person would read it: leading variable assignments and `cd … &&` dropped. */
export const tidyCmd = (cmd: string) => {
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
export const lineDiff = (before: string, after: string) => {
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
export const MORE_MAX = 1400
export const clipLines = (lines: string[]) => lines.map(l => trunc(l.replace(/\s+$/, ''), 200))
/** The last lines of an output (at most n, and about 900 characters), saying how many came before. */
export const tailOf = (s: string, n = 15) => {
  const all = s.replace(/\s+$/, '').split('\n')
  let k = Math.max(0, all.length - n)
  while (k < all.length - 1 && all.slice(k).join('\n').length > 900) k++
  return [...(k ? [`… ${k} earlier lines`] : []), ...clipLines(all.slice(k))].join('\n')
}
/** A small diff of one edit: the lines it changes (what both sides share at the ends is left out). */
export const editDiff = (before: string, after: string, max = 16) => {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  const lines = clipLines([...a.slice(i, a.length - j).map(l => `- ${l}`), ...b.slice(i, b.length - j).map(l => `+ ${l}`)])
  return (lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more changed lines`] : lines).join('\n')
}

export const record = (c: Crew, path: string, id: string, delta: { added: number; removed: number } | 'read'): Crew => {
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
export const MAX_CHANGES = 300
/**
 * A Claude still "thinking" a while after its last call has gone quiet: idle (main) or done (helper).
 * Top-level, so the timer keeps only the id and the stamp (not the call and its result), and it
 * writes only if the Claude is still as it was left.
 */
export const settleLater = (id: string, stamp: number) =>
  after?.(LINGER_MS, () => {
    void (async () => {
      const c = await readCrew?.()
      if (!c?.agents.some(x => x.id === id && x.state === 'thinking' && x.doneAt === stamp)) return
      await write?.(d => ({ ...d, agents: d.agents.map(x => (x.id === id && x.state === 'thinking' && x.doneAt === stamp ? { ...x, state: x.id === 'main' ? 'idle' : 'done' } : x)) }))
    })()
  })
export const MAIN = () => blank('main', 'Claude', 'main', 0)

export const freshName = (list: Agent[], kind: string) => {
  const base = NAMES[kind] ?? (kind === 'agent' ? 'Helper' : (kind.split(':').pop() ?? kind))
  const n = list.filter(w => w.name === base || w.name.startsWith(`${base} `)).length
  return n ? `${base} ${n + 1}` : base
}
/** A new helper: the colour it had (it dropped off the list and came back), else the next one. */
export const newSub = (c: Crew, id: string, kind: string) => blank(id, freshName(c.agents, kind), kind, c.colors?.[id]?.i ?? pickColor(c))

export const upsert = (c: Crew, id: string, fn: (a: Agent) => Agent): Crew => {
  const found = c.agents.find(a => a.id === id)
  const made = fn(found ?? (id === 'main' ? MAIN() : newSub(c, id, 'agent')))
  // A new helper keeps its colour for the whole chat (a pretend session's stay out).
  if (!found && id !== 'main' && !isDemoAgent(id) && c.colors?.[id]?.i !== made.hue) c = { ...c, colors: { ...c.colors, [id]: { i: made.hue, at: Date.now() } } }
  const agents = found ? c.agents.map(a => (a.id === id ? made : a)) : [...c.agents, made]
  while (agents.length > MAX_AGENTS) {
    const i = agents.findIndex(a => a.id !== 'main' && (a.state === 'done' || a.state === 'idle'))
    agents.splice(i >= 0 ? i : 1, 1)
  }
  return { ...c, agents }
}

export const log = (c: Crew, id: string, kind: LogLine['kind'], text: string, full?: string): Crew => {
  const a = c.agents.find(x => x.id === id)
  if (!a || !text) return c
  const line: LogLine = { at: Date.now(), who: a.name, hue: a.hue, kind, text: trunc(text, 300), ...(full && full !== text ? { full: trunc(full, 2000) } : {}) }
  return { ...c, log: [...c.log, line].slice(-LOG_KEEP) }
}

export const think = (c: Crew, id: string, line: string, full?: string): Crew => {
  if (!line || c.agents.find(a => a.id === id)?.thoughts[0] === line) return c
  return log(upsert(c, id, a => ({ ...a, thoughts: [line, ...a.thoughts].slice(0, 6) })), id, 'think', line, full)
}

/** Notes a file the work reached, so Touched and Files list it (a tool's station is no file). */
export const reach = (c: Crew, id: string): Crew => {
  if (!id || isSpecial(id)) return c
  const reached = { ...c.reached, [id]: Date.now() }
  const keys = Object.keys(reached)
  if (keys.length > MAX_REACHED) for (const k of keys.filter(k => k !== id).sort((x, y) => reached[x] - reached[y]).slice(0, keys.length - MAX_REACHED)) delete reached[k]
  return { ...c, reached }
}

// ─── Progress ───────────────────────────────────────────────────────────────

/** The tasks a Claude made that are part of its work now (not those finished before the latest message). */
export const tasksOf = (a: Agent, c: Pick<Crew, 'tasks'>) => Object.values(c.tasks ?? {}).filter(t => t.by === a.id && !t.old)

/**
 * Claude Code's task list after a task call that went through: a new task (its id from the result), a
 * change of status or wording, a deletion, or the whole list as TaskList / TaskGet report it.
 */
export const applyTaskCall = (c: Crew, tool: string, a: Record<string, unknown>, ran: unknown, out: string, who: string): Crew => {
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
export const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
/** The desktop app's wrap-up, which also checks off the whole task list. */
export const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
export const planAfter = (was: { content: string; status: string }[], a: Record<string, unknown>) => {
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

/**
 * A Claude's steps, as its card counts them: Claude Code's task list, else its latest list, the to-dos
 * (TodoWrite) or the app's plan (update_plan; checked off on wrap-up).
 */
export const stepsOf = (a: Agent, c: Pick<Crew, 'tasks'>): { text: string; status: string }[] => {
  const tasks = tasksOf(a, c)
  if (tasks.length) return tasks.map(t => ({ text: t.active && t.status === 'in_progress' ? t.active : t.subject, status: t.status }))
  return (a.todoList ?? a.plan ?? []).map(t => ({ text: t.status === 'in_progress' && 'activeForm' in t && t.activeForm ? t.activeForm : t.content, status: t.status }))
}
export const stepMark = (status: string) => (status === 'completed' ? '✓' : status === 'in_progress' ? '▸' : '○')
/** What a Claude is on now, from its plan: the task in progress (its spinner words), else the to-do. */
export const doingOf = (a: Agent, c: Pick<Crew, 'tasks'>) => {
  const t = tasksOf(a, c).find(x => x.status === 'in_progress')
  return t ? t.active || t.subject : a.doing
}

// ─── Diagnosis ──────────────────────────────────────────────────────────────

export const CX = '#10A37F'
/** The last 40 things worth knowing when something goes wrong (the website's errors), kept in the store as 'diag'. */
export const diag: string[] = []
let diagDirty = false
export const note = (text: string) => {
  diag.push(`${new Date().toISOString().slice(11, 19)} ${text}`)
  if (diag.length > 40) diag.shift()
  diagDirty = true
}
/** Keeps the notes in the store as 'diag' when there are new ones (the 1 s clock asks). */
export async function flushDiag($: EngineInterface) {
  if (!diagDirty) return
  diagDirty = false
  await $.store.set('diag', { version: VERSION, at: new Date().toISOString(), cwd: sessionDir, events: diag }).catch(() => undefined)
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** How many Codex runs the codex-bridge mod has published (0 without it). */
export let codexCount = 0
/** Counts the Codex runs again (at a turn's start and end). */
export async function recountCodex($: EngineInterface) {
  codexCount = await codexRunCount($)
}
/** Claudes whose current turn the app started (a background task reporting in), not the user. */
export const noticeTurn = new Set<string>()
export async function codexRunCount($: EngineInterface) {
  return (((await $.state.get({ plugin: 'codex-bridge', key: 'runs' } as never).catch(() => ({}))) as { value?: unknown[] }).value ?? []).length
}

export const agentOf = (e: unknown) => (e as { agentId?: string }).agentId ?? 'main'

/** What the whole chat has cost so far, as /cost totals it (none where Claude Code keeps no ledger). */
export async function readChatCost($: EngineInterface) {
  let usd: unknown
  try {
    usd = (await $.session.usage()).cost?.usd
  } catch {
    return
  }
  if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) await write?.(c => (c.chatCost === usd ? c : { ...c, chatCost: usd }))
}

/** Tools that wait on the person by their nature, and what they wait for. */
export const ASKS: Record<string, string> = { AskUserQuestion: 'answer a question', ExitPlanMode: 'approve the plan' }
/** What a permission prompt asks, in a few words: "allow running npm test", "allow editing token.ts". */
export const needsText = (rawTool: string, input: unknown) => {
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
export let mainWindow = 0
export const setMainWindow = (n: number) => {
  mainWindow = n
}
/** Each Claude's context as last written, so an unchanged one is not written again. */
export const lastCtx = new Map<string, string>()
export let mainModel = ''
export const setMainModel = (m: string) => {
  mainModel = m
}
/** A model's context window: the measured one for the main model, a million for a [1m] model, else 200k. */
export const windowOf = (model: string) => (/\[1m\]|-1m\b/i.test(model) ? 1_000_000 : model && model === mainModel && mainWindow ? mainWindow : 200_000)
