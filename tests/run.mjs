// Builds both mods for Node (the engine's `claude-code` module swapped for tests/stub.mjs),
// then runs every tests/**/*.test.mjs in its own process. Exits 1 if any check fails.
//
//   npm install
//   npm test                  # all suites
//   npm test -- crew-map      # only files whose path contains "crew-map"
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readdirSync, mkdirSync, existsSync, rmSync, cpSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..')
const out = join(here, '.build')
mkdirSync(join(out, 'out'), { recursive: true })

for (const mod of ['crew-map', 'codex-bridge'])
  await build({
    entryPoints: [join(root, mod, 'hooks', 'register.tsx')],
    outfile: join(out, `${mod}.mjs`),
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsxFactory: 'h',
    alias: { 'claude-code': join(here, 'stub.mjs') },
    // The mods' tsconfig extends types Claude Code generates on load; the build needs none of it.
    tsconfigRaw: {},
    logLevel: 'warning',
  })

// The terminal map module, built on its own.
await build({
  entryPoints: [join(root, 'crew-map', 'hooks', 'map.tsx')],
  outfile: join(out, 'crew-map-terminal.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsxFactory: 'h',
  tsconfigRaw: {},
  logLevel: 'warning',
})
// The search field's surface module, built on its own.
await build({
  entryPoints: [join(root, 'crew-map', 'hooks', 'search.tsx')],
  outfile: join(out, 'crew-map-search.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsxFactory: 'h',
  tsconfigRaw: {},
  logLevel: 'warning',
})
// The desktop map's pan module, built on its own.
await build({
  entryPoints: [join(root, 'crew-map', 'hooks', 'pan.tsx')],
  outfile: join(out, 'crew-map-pan.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsxFactory: 'h',
  tsconfigRaw: {},
  logLevel: 'warning',
})

const filter = process.argv[2] ?? ''
const files = ['crew-map', 'codex-bridge']
  .flatMap(dir => readdirSync(join(here, dir)).filter(f => f.endsWith('.test.mjs')).map(f => join(here, dir, f)))
  .filter(f => f.includes(filter))

let failed = 0
let checks = 0
for (const file of files) {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: root })
  const lines = `${r.stdout}${r.stderr}`.split(/\r?\n/)
  const fails = lines.filter(l => l.startsWith('FAIL'))
  const passes = lines.filter(l => l.startsWith('PASS')).length
  const crashed = r.status !== 0 && !fails.length
  checks += passes + fails.length
  failed += fails.length + (crashed ? 1 : 0)
  console.log(`${fails.length || crashed ? '✗' : '✓'} ${relative(root, file)}  (${passes} passed${fails.length ? `, ${fails.length} failed` : ''})`)
  for (const l of fails) console.log(`    ${l}`)
  if (crashed) console.log(lines.filter(Boolean).slice(-12).map(l => `    ${l}`).join('\n'))
}
// The pane drawn by Claude Code's own engine (its elements and rules, not this folder's stand-ins):
// `claude plugin test` over a copy of the mod with tests/engine's test beside it. Skipped, and said
// so, when no Claude Code is found (CLAUDE_EXE names one; else the desktop app's newest).
if (!filter || 'engine'.includes(filter) || filter.includes('engine')) {
  const appData = process.env.APPDATA ?? ''
  const versions = appData && existsSync(join(appData, 'Claude', 'claude-code')) ? readdirSync(join(appData, 'Claude', 'claude-code')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []
  const exe =
    process.env.CLAUDE_EXE ??
    versions
      .reverse()
      .flatMap(v => readdirSync(join(appData, 'Claude', 'claude-code', v)).map(d => join(appData, 'Claude', 'claude-code', v, d, 'claude.exe')))
      .find(p => existsSync(p))
  if (!exe) console.log('- engine test skipped: no Claude Code found (set CLAUDE_EXE)')
  else {
    // Each test runs in a copy of the mod it is about (its name says which: codex tests in Codex Bridge).
    const tests = readdirSync(join(here, 'engine')).filter(t => t.endsWith('.test.ts'))
    const groups = { 'crew-map': tests.filter(t => !/codex-pane/.test(t)), 'codex-bridge': tests.filter(t => /codex-pane/.test(t)) }
    for (const [mod, list] of Object.entries(groups)) {
      if (!list.length) continue
      const at = join(out, 'engine', mod)
      rmSync(at, { recursive: true, force: true })
      cpSync(join(root, mod), join(at, mod), { recursive: true })
      for (const t of list) cpSync(join(here, 'engine', t), join(at, mod, t))
      const r = spawnSync(exe, ['plugin', 'test', mod], { encoding: 'utf8', cwd: at, timeout: 300_000 })
      const text = `${r.stdout}${r.stderr}`
      const pass = Number(text.match(/(\d+) pass/)?.[1] ?? 0)
      const fail = Number(text.match(/(\d+) fail/)?.[1] ?? (r.status === 0 ? 0 : 1))
      checks += pass + fail
      failed += fail
      console.log(`${fail ? '✗' : '✓'} engine: ${mod} (${list.length} file${list.length === 1 ? '' : 's'}) drawn by Claude Code ${relative(appData, exe).split(/[\\/]/)[2] ?? ''}  (${pass} passed${fail ? `, ${fail} failed` : ''})`)
      if (fail) console.log(text.split(/\r?\n/).filter(l => /\(fail\)|Error|expected|Received|refused/i.test(l)).slice(0, 14).map(l => `    ${l}`).join('\n'))
    }
  }
}

console.log(`\n${checks} checks in ${files.length} files: ${failed ? `${failed} failed` : 'all passed'}`)
process.exit(failed ? 1 : 0)
