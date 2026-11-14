// This chat's Claude Crew website. The mod starts it (one per chat), pushes the view to it as JSON,
// and reads what is pressed on the page from its output:
//
//   READY <port> <token>    it is up; the page is at http://127.0.0.1:<port>/<token>/
//   WATCH <n>               how many pages have it open (the mod sends views only while one does)
//   ACT {"id":"…"}          a press; the mod looks the id up in what it handed out
//   ACT {"search":"…"}      the search field
//
// Only this computer can reach it (127.0.0.1), every path starts with a random token, and a request
// must name 127.0.0.1 as its host, so no other website can drive it.
//
// It stops when the mod stops it, and on its own when nobody needs it any more: when the process that
// started it is gone (Claude closed or crashed), or when the mod has not been heard from (a push or
// its ping every 15 seconds) for a minute. Its standard input is closed from the start, so that is no sign.
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
// The address this chat had before (port and token, from the mod), so a page left open, or the browser
// pane the app brings back, finds it again; a new one when there was none, or the port is taken.
const [wantPort, wantToken] = process.argv.slice(2)
const want = Number(wantPort) >= 1024 && Number(wantPort) <= 65535 ? Number(wantPort) : 0
let token = want && /^[0-9a-f]{24}$/.test(wantToken ?? '') ? wantToken : randomBytes(12).toString('hex')
const FILES = {
  '': ['index.html', 'text/html; charset=utf-8'],
  'app.css': ['app.css', 'text/css; charset=utf-8'],
  'app.js': ['app.js', 'text/javascript; charset=utf-8'],
}
const MAX_BODY = 8 * 1024 * 1024
let view = ''
const watchers = new Set()
const say = line => process.stdout.write(`${line}\n`)
const send = (res, data) => res.write(`data: ${data}\n\n`)
const parent = process.ppid
const QUIET_MS = Number(process.env.CREW_QUIET_MS) || 60_000
let heard = Date.now()
const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
setInterval(() => {
  if (!alive(parent) || Date.now() - heard > QUIET_MS) process.exit(0)
}, Number(process.env.CREW_CHECK_MS) || 5_000)

const srv = http.createServer((req, res) => {
  const { port } = srv.address()
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.writeHead(403)
    return res.end()
  }
  const [, tok, ...rest] = (req.url ?? '/').split('?')[0].split('/')
  const path = rest.join('/')
  if (tok !== token) {
    res.writeHead(404)
    return res.end()
  }
  const plain = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  if (req.method === 'GET' && path in FILES) {
    const [file, type] = FILES[path]
    res.writeHead(200, { 'content-type': type, ...plain })
    return res.end(readFileSync(join(here, file)))
  }
  if (req.method === 'GET' && path === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', ...plain })
    watchers.add(res)
    say(`WATCH ${watchers.size}`)
    if (view) send(res, view)
    const beat = setInterval(() => res.write(': beat\n\n'), 15_000)
    req.on('close', () => {
      clearInterval(beat)
      watchers.delete(res)
      say(`WATCH ${watchers.size}`)
    })
    return
  }
  // The mod's ping: it is still there (the page's own requests don't count).
  if (req.method === 'POST' && path === 'ping') {
    heard = Date.now()
    res.writeHead(204, plain)
    return res.end()
  }
  if (req.method === 'POST' && (path === 'push' || path === 'act')) {
    if (path === 'push') heard = Date.now()
    let body = ''
    req.on('data', d => {
      body += d
      if (body.length > MAX_BODY) req.destroy()
    })
    req.on('end', () => {
      if (path === 'push') {
        view = body
        for (const w of watchers) send(w, view)
      } else {
        try {
          const msg = JSON.parse(body)
          const out = typeof msg.id === 'string' ? { id: msg.id.slice(0, 40) } : typeof msg.search === 'string' ? { search: msg.search.slice(0, 200), next: msg.next === true } : undefined
          if (out) say(`ACT ${JSON.stringify(out)}`)
        } catch {}
      }
      res.writeHead(204, plain)
      res.end()
    })
    return
  }
  res.writeHead(404)
  res.end()
})
srv.on('listening', () => say(`READY ${srv.address().port} ${token}`))
srv.on('error', err => {
  if (err.code !== 'EADDRINUSE' || srv.address()) throw err
  token = randomBytes(12).toString('hex')
  srv.listen(0, '127.0.0.1')
})
srv.listen(want, '127.0.0.1')
