// web/prune.mjs: old journals and chat files go; the current chat's journal, one a chat still uses,
// and anything outside ~/.claude/crew-map stay.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRUNE = fileURLToPath(new URL('../../crew-map/web/prune.mjs', import.meta.url))
let fails = 0
const check = (label, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`)
}
const home = mkdtempSync(join(tmpdir(), 'crew-prune-'))
const root = join(home, '.claude', 'crew-map')
const file = (rel, text = '[]', daysOld = 0) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
  const t = new Date(Date.now() - daysOld * 86_400_000)
  utimesSync(p, t, t)
  return p
}
try {
  file('journals/old/000001.json', '[]', 40)
  utimesSync(join(root, 'journals/old'), new Date(Date.now() - 40 * 86_400_000), new Date(Date.now() - 40 * 86_400_000))
  file('journals/fresh/000001.json')
  file('journals/legacy.json', '[]', 40)
  file('journals/mine/000001.json', '[]', 40)
  utimesSync(join(root, 'journals/mine'), new Date(Date.now() - 40 * 86_400_000), new Date(Date.now() - 40 * 86_400_000))
  // A chat resumed after 40 days: its journal is old, but its chats/ file was just written.
  file('journals/resumed/000001.json', '[]', 40)
  utimesSync(join(root, 'journals/resumed'), new Date(Date.now() - 40 * 86_400_000), new Date(Date.now() - 40 * 86_400_000))
  file('chats/local_resumed.json', JSON.stringify({ id: 'local_resumed', journal: 'resumed' }))
  file('chats/local_gone.json', '{}', 40)
  writeFileSync(join(home, '.claude', 'stranger.txt'), 'x')
  const out = execFileSync(process.execPath, [PRUNE, root, '30', 'mine'], { encoding: 'utf8' })
  check('a journal nothing wrote for 30 days goes', !existsSync(join(root, 'journals/old')), out.trim())
  check('an old single-file journal goes too', !existsSync(join(root, 'journals/legacy.json')))
  check('a chat file nothing wrote for 30 days goes', !existsSync(join(root, 'chats/local_gone.json')))
  check('a fresh journal stays', existsSync(join(root, 'journals/fresh/000001.json')))
  check("this chat's own journal stays, however old", existsSync(join(root, 'journals/mine/000001.json')))
  check('a journal a chat still uses (its chat file is fresh) stays', existsSync(join(root, 'journals/resumed/000001.json')))
  check('nothing outside crew-map is touched', existsSync(join(home, '.claude', 'stranger.txt')))
  let refused = 0
  try {
    execFileSync(process.execPath, [PRUNE, join(home, '.claude'), '30'])
  } catch (err) {
    refused = err.status
  }
  check('any other folder is refused', refused === 2, String(refused))
  // Past the newest 300 journals, the oldest go even when fresh.
  for (let i = 0; i < 305; i++) {
    const p = file(`journals/n${i}.json`)
    const t = new Date(Date.now() - (305 - i) * 1000)
    utimesSync(p, t, t)
  }
  execFileSync(process.execPath, [PRUNE, root, '30', 'mine'])
  check('past the newest 300 journals, the oldest go', !existsSync(join(root, 'journals/n0.json')) && existsSync(join(root, 'journals/n304.json')))
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 300)}`, false)
}
rmSync(home, { recursive: true, force: true })
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
