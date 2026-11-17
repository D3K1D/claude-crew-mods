// Prunes Claude Crew's own files under ~/.claude/crew-map: a chat's journal (journals/<session id>/ or
// an old journals/<session id>.json) and its steps file (chats/<app id>.json) once nothing has written
// them for 30 days, and the oldest journals past the newest 300. The mod runs it at most once a day:
//
//   node prune.mjs <~/.claude/crew-map> [days] [session id to keep]
//
// It touches nothing outside those two folders, and only names Claude Crew writes there.
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [root, daysArg, keep = ''] = process.argv.slice(2)
if (!root || !/[\\/]\.claude[\\/]crew-map[\\/]?$/.test(root)) process.exit(2)
const cutoff = Date.now() - (Number(daysArg) > 0 ? Number(daysArg) : 30) * 86_400_000
const KEEP_JOURNALS = 300
const NAME = /^[\w-]+(\.json)?$/
const list = dir => {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
// When an entry was last written: a folder by its newest file.
const touched = path => {
  try {
    const st = statSync(path)
    if (!st.isDirectory()) return st.mtimeMs
    return Math.max(st.mtimeMs, ...list(path).map(e => statSync(join(path, e.name)).mtimeMs))
  } catch {
    return Date.now()
  }
}
let removed = 0
const remove = path => {
  try {
    rmSync(path, { recursive: true, force: true })
    removed++
  } catch {}
}

const journals = join(root, 'journals')
const entries = list(journals)
  .filter(e => NAME.test(e.name) && e.name.replace(/\.json$/, '') !== keep)
  .map(e => ({ path: join(journals, e.name), at: touched(join(journals, e.name)) }))
  .sort((x, y) => y.at - x.at)
entries.forEach((e, i) => (e.at < cutoff || i >= KEEP_JOURNALS) && remove(e.path))
const chats = join(root, 'chats')
for (const e of list(chats)) if (e.isFile() && NAME.test(e.name) && touched(join(chats, e.name)) < cutoff) remove(join(chats, e.name))
process.stdout.write(`pruned ${removed}\n`)
