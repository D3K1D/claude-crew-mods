// This chat's Claude Crew website. The mod starts it (one per chat), pushes the view to it as JSON,
// and reads what is pressed on the page from its output:
//
//   READY <port> <token> <key>  it is up; the page is at http://127.0.0.1:<port>/<token>/, and the mod's
//                               own requests (push, ping, export, reply, quit) carry <key>, which the page never sees
//   WATCH <n>               how many pages have it open (the mod sends views only while one does)
//   ACT {"id":"…"}          a press; the mod looks the id up in what it handed out
//   ACT {"search":"…"}      the search field
//   ACT {"set":{…}}         Settings' budget box or editor list
//   ACT {"open":"<key>"}    a log line opened: the mod replies with all of it
//   ACT {"older":<ms>}      the log scrolled back: the mod replies with the lines before that time
//
// The mod's replies (POST reply) and the log it exports (POST export) reach the pages as events of their own.
//
// Only this computer can reach it (127.0.0.1), every path starts with a random token, and a request
// must name 127.0.0.1 as its host and, when it says where it comes from, come from the page itself, so no
// other website can drive it. The page can only press and ask; changing what it shows, or stopping it,
// takes the mod's key as well.
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
const [wantPort, wantToken, wantKey] = process.argv.slice(2)
const want = Number(wantPort) >= 1024 && Number(wantPort) <= 65535 ? Number(wantPort) : 0
let token = want && /^[0-9a-f]{24}$/.test(wantToken ?? '') ? wantToken : randomBytes(12).toString('hex')
// The mod's key: kept with the address, so the website that comes back after Claude reopens can ask the
// old one (still winding down) to hand the address over.
const key = /^[0-9a-f]{32}$/.test(wantKey ?? '') ? wantKey : randomBytes(16).toString('hex')
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
const CHECK_MS = Number(process.env.CREW_CHECK_MS) || 5_000
let checked = Date.now()
setInterval(() => {
  // A check far later than its interval: the computer slept, and the mod's ping is as late as this
  // check. That silence is not the mod gone, so it starts counting again.
  if (Date.now() - checked > CHECK_MS * 4) heard = Date.now()
  checked = Date.now()
  if (!alive(parent) || Date.now() - heard > QUIET_MS) process.exit(0)
}, CHECK_MS)

// A request's body, up to 8 MB (more ends the request).
const bodyOf = (req, then) => {
  let body = ''
  req.on('data', d => {
    body += d
    if (body.length > MAX_BODY) req.destroy()
  })
  req.on('end', () => then(body))
}
const MOD_PATHS = new Set(['push', 'ping', 'export', 'reply', 'quit'])
const srv = http.createServer((req, res) => {
  const { port } = srv.address()
  const origin = req.headers.origin
  if (req.headers.host !== `127.0.0.1:${port}` || (req.method === 'POST' && origin && origin !== `http://127.0.0.1:${port}`)) {
    res.writeHead(403)
    return res.end()
  }
  const [, tok, ...rest] = (req.url ?? '/').split('?')[0].split('/')
  const path = rest.join('/')
  if (tok !== token || (MOD_PATHS.has(path) && req.headers['x-crew-key'] !== key)) {
    res.writeHead(404)
    return res.end()
  }
  const plain = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
  if (req.method === 'GET' && path in FILES) {
    const [file, type] = FILES[path]
    res.writeHead(200, {
      'content-type': type,
      ...plain,
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'x-frame-options': 'DENY',
    })
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
  // This chat's website starting again (Claude reopened) while this one is still winding down: it
  // hands over its address and stops.
  if (req.method === 'POST' && path === 'quit') {
    res.writeHead(204, plain)
    res.end()
    srv.close()
    for (const w of watchers) w.destroy()
    return setTimeout(() => process.exit(0), 50)
  }
  // The mod's ping: it is still there (the page's own requests don't count).
  if (req.method === 'POST' && path === 'ping') {
    heard = Date.now()
    res.writeHead(204, plain)
    return res.end()
  }
  if (req.method !== 'POST' || !['export', 'reply', 'push', 'act'].includes(path)) {
    res.writeHead(404)
    return res.end()
  }
  if (path !== 'act') heard = Date.now()
  bodyOf(req, body => {
    // From the mod to the pages: the view, the whole log as Markdown (to copy or save), or a reply to what a page asked.
    if (path === 'push') {
      view = body
      for (const w of watchers) send(w, view)
    } else if (path !== 'act') for (const w of watchers) w.write(`event: ${path}\ndata: ${body.replace(/\n/g, ' ')}\n\n`)
    else
      try {
        const msg = JSON.parse(body)
        const set = msg.set && typeof msg.set === 'object' ? msg.set : undefined
        const out =
          typeof msg.id === 'string'
            ? { id: msg.id.slice(0, 40) }
            : typeof msg.search === 'string'
              ? { search: msg.search.slice(0, 200), next: msg.next === true }
              : typeof msg.open === 'string'
                ? { open: msg.open.slice(0, 60) }
                : Number.isFinite(msg.older)
                  ? { older: msg.older }
                  : set
                    ? { set: { ...(Number.isFinite(set.budget) ? { budget: set.budget } : {}), ...(typeof set.editor === 'string' ? { editor: set.editor.slice(0, 20) } : {}) } }
                    : undefined
        if (out) say(`ACT ${JSON.stringify(out)}`)
      } catch {}
    res.writeHead(204, plain)
    res.end()
  })
})
srv.on('listening', () => say(`READY ${srv.address().port} ${token} ${key}`))
// The address is taken: most likely this chat's own website from before Claude reopened, still winding
// down. Ask it to stop (only it knows the token and key), and try again for a few seconds; something else
// holds the port after that, so take a new address.
const TAKEOVER_MS = 6000
let firstTry = 0
srv.on('error', err => {
  if (err.code !== 'EADDRINUSE' || srv.address()) throw err
  if (want && !firstTry) {
    firstTry = Date.now()
    fetch(`http://127.0.0.1:${want}/${token}/quit`, { method: 'POST', headers: { 'x-crew-key': key } }).catch(() => {})
  }
  if (want && Date.now() - firstTry < TAKEOVER_MS) return setTimeout(() => srv.listen(want, '127.0.0.1'), 250)
  token = randomBytes(12).toString('hex')
  srv.listen(0, '127.0.0.1')
})
srv.listen(want, '127.0.0.1')
