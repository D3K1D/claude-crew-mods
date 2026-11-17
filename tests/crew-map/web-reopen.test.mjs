// Reopening Claude: a chat's website comes back at the address it had, so the browser pane the app
// brings back (or a page left open) finds it; if that port is taken meanwhile, it gets a new one.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'

// A home folder of its own, for the chat's journal (its whole log, kept on disk).
const home = mkdtempSync(join(tmpdir(), 'crew-home-')).replace(/\\/g, '/')

globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Link: el('Link') }
const { register } = await import('../.build/crew-map.mjs')
const here = fileURLToPath(new URL('.', import.meta.url))
const hooks = {}
const children = []
const kept = new Map([['intro', 'off']])
const ticks = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  clock: { every: (ms, fn) => (ticks.push({ ms, fn }), { cancel() {} }), after: (ms, fn) => (setTimeout(fn, ms), { cancel() {} }) },
  fs: {
    read: async p => (p.startsWith(home) ? readFileSync(p, 'utf8') : 'line\n'),
    exists: async () => false,
    write: async (p, t) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, t)),
    list: async p => {
      try {
        return readdirSync(p, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file', mtimeMs: statSync(join(p, e.name)).mtimeMs }))
      } catch {
        return []
      }
    },
  },
  prompt: { submit: async () => {} },
  model: { complete: async () => ({ isAnswered: true, text: '' }) },
  store: { get: async k => kept.get(k), set: async (k, v) => void kept.set(k, v) },
  session: { cwd: async () => 'C:/proj', id: async () => 'chat-1' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : n === 'USERPROFILE' ? home : undefined) },
  state: { get: async () => ({ value: [], version: 0 }) },
  plugin: { root: join(here, '..', '..', 'crew-map') },
  process: {
    spawn: ({ argv }) => {
      const ch = spawn(argv[0], argv.slice(1))
      children.push(ch)
      return (async function* () {
        for await (const d of ch.stdout) yield { stream: 'stdout', text: d.toString() }
      })()
    },
  },
  http: { fetch: (url, o) => fetch(url, o) },
  prompt: { submit: async () => {} },
}
register((ev, m, fn) => {
  hooks[ev] = fn ?? m
  return { catch() {} }
}, {})
let fails = 0
const check = (label, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of x.props?.children ?? []) find(c, pred, out)
  return out
}
const urlNow = async () => find(await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 100 }, viewport: { columns: 100 } }), x => x.type === 'Link')[0]?.props?.href ?? ''
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (await fn()) return true
  return false
}
// Claude closing: the server goes, and the mod with it.
const close = async () => {
  for (const ch of children.splice(0)) ch.kill()
  return until(async () => !(await urlNow()))
}

try {
  await hooks['session.start']($, {}, async () => ({}))
  await wait(400)
  check('a chat that never opened its website runs no server for it', !(await urlNow()) && !children.length)
  const said = await hooks['command.run']($, { command: 'crew', args: '' }, async () => ({}))
  await until(urlNow)
  const first = await urlNow()
  check('/crew starts it, and says where it is', String(said?.text).includes(first) && !!first, String(said?.text))
  check('the website starts',/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{24}\/$/.test(first), first)
  check('its address is kept for this chat', kept.get('webAddress')?.['chat-1']?.token === first.split('/')[3], JSON.stringify(kept.get('webAddress')))

  check('Claude closes: the website stops', await close())
  await hooks['session.start']($, {}, async () => ({}))
  await until(urlNow)
  const again = await urlNow()
  check('the chat opens again: its website is back at the same address', again === first, `${first} then ${again}`)
  check('and the page loads there', (await fetch(again)).ok)

  // Claude reopened before the old website had wound down: the new one asks it to stop, and keeps the address.
  await close()
  const old = spawn(process.execPath, [join(here, '..', '..', 'crew-map', 'web', 'server.mjs'), new URL(first).port, first.split('/')[3]])
  await new Promise(r => old.stdout.once('data', r))
  check('(the old website is still up at that address)', (await fetch(first)).ok)
  const oldGone = new Promise(r => old.once('exit', () => r(true)))
  await hooks['session.start']($, {}, async () => ({}))
  await until(urlNow, 8000)
  const back = await urlNow()
  check('the old website winding down: the new one still gets the same address', back === first, `${first} then ${back}`)
  check('and the old one stopped', await Promise.race([oldGone, wait(3000).then(() => false)]))

  // The log survives Claude closing: the journal on disk has it, and the next chat start reads it back.
  await hooks['tool.call']($, { tool_use_id: 'j1', tool: 'Read', file_path: 'C:/proj/src/keep.ts' }, async () => ({ text: 'ok' }))
  const journalTick = () => Promise.all(ticks.filter(t => t.ms === 3000).map(t => t.fn()))
  await journalTick()
  await until(async () => {
    try {
      return readFileSync(`${home}/.claude/crew-map/journals/chat-1/000001.json`, 'utf8').includes('keep.ts')
    } catch {
      return false
    }
  })
  check('the whole log is kept on disk as it grows', readFileSync(`${home}/.claude/crew-map/journals/chat-1/000001.json`, 'utf8').includes('keep.ts'))
  globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), log: [] })
  await close()
  await hooks['session.start']($, {}, async () => ({}))
  await until(urlNow)
  await wait(200)
  const exported = []
  const ac = new AbortController()
  const page = await fetch(`${await urlNow()}events`, { signal: ac.signal })
  const reader = page.body.getReader()
  const acts = await (async () => {
    let got = ''
    for (const end = Date.now() + 3000; Date.now() < end; ) {
      const r = await Promise.race([reader.read(), wait(200).then(() => null)])
      if (r?.value) got += new TextDecoder().decode(r.value)
      const m = got.match(/data: (\{.*"logActs".*\})\n/)
      if (m) return JSON.parse(m[1]).logActs
    }
  })()
  await fetch(`${await urlNow()}act`, { method: 'POST', body: JSON.stringify({ id: acts?.copy }) })
  let text = ''
  for (const end = Date.now() + 3000; Date.now() < end && !text.includes('event: export'); ) {
    const r = await Promise.race([reader.read(), wait(200).then(() => null)])
    if (r?.value) text += new TextDecoder().decode(r.value)
  }
  ac.abort()
  check('after Claude reopens, the log still has what happened before', /event: export[\s\S]*keep\.ts/.test(text), text.slice(-200))

  // The port was taken by something else while Claude was closed: a new address, and the chat keeps that one.
  await close()
  const port = Number(new URL(first).port)
  const squatter = createServer().listen(port, '127.0.0.1')
  await new Promise(r => squatter.once('listening', r))
  await hooks['session.start']($, {}, async () => ({}))
  await until(urlNow, 12000)
  const moved = await urlNow()
  check('its port taken meanwhile: the website starts at a new address', !!moved && moved !== first, moved)
  check('with a new token too', !!moved && moved.split('/')[3] !== first.split('/')[3])
  check('and the chat keeps the new one', kept.get('webAddress')?.['chat-1']?.port === Number(new URL(moved).port))
  squatter.close()
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 300)}`, false)
}
for (const ch of children) ch.kill()
rmSync(home, { recursive: true, force: true })
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
