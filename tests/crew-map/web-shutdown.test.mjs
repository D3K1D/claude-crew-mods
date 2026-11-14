// The website's server stops on its own when nobody needs it: when the process that started it is gone,
// and when the mod has not pushed or pinged for a while (the page's own requests don't keep it up).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../../crew-map/web/server.mjs', import.meta.url))
const FAST = { CREW_CHECK_MS: '100', CREW_QUIET_MS: '1500' }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' } }
/** Waits until a process is gone, up to `ms`; true if it went. */
const gone = async (pid, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (!alive(pid)) return true
  return !alive(pid)
}
/** The first line a child writes that starts with `word`. */
const lineOf = (ch, word) => new Promise((ok, no) => {
  let buf = ''
  ch.stdout.on('data', d => {
    buf += d
    const l = buf.split('\n').find(x => x.startsWith(word))
    if (l) ok(l.trim())
  })
  ch.on('exit', () => no(new Error(`exited before ${word}`)))
})
const left = []

// ── Its parent gone (Claude closed or crashed): it stops. The stand-in parent starts it detached, so
// nothing but the server's own check can end it, as when the app does not take its children down.
{
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const s = spawn(process.execPath, [${JSON.stringify(SERVER)}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CREW_CHECK_MS: '100' } })
    s.stdout.on('data', d => { if (String(d).startsWith('READY')) console.log('SERVER ' + s.pid) })
    setInterval(() => {}, 1000)
  `], { stdio: ['ignore', 'pipe', 'inherit'] })
  const pid = Number((await lineOf(parent, 'SERVER')).split(' ')[1])
  left.push(pid)
  check('the server runs while its parent does', alive(pid))
  await wait(400)
  check('...and keeps running', alive(pid))
  parent.kill('SIGKILL')
  check('its parent killed outright: the server stops by itself within a second', await gone(pid, 1500))
}

// ── The mod quiet: it stops after the quiet time; a push or a ping keeps it up, the page's presses don't.
{
  const s = spawn(process.execPath, [SERVER], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...FAST } })
  left.push(s.pid)
  const [, port, token] = (await lineOf(s, 'READY')).split(' ')
  const base = `http://127.0.0.1:${port}/${token}`
  const post = (path, body = '') => fetch(`${base}/${path}`, { method: 'POST', body }).then(r => r.status).catch(() => 0)
  check('a ping is answered', (await post('ping')) === 204)
  for (let i = 0; i < 6; i++) {
    await wait(400)
    await post(i % 2 ? 'ping' : 'push', i % 2 ? '' : '{}')
  }
  check('pinged and pushed for longer than the quiet time: still up', alive(s.pid))
  for (let i = 0; i < 6; i++) {
    await wait(400)
    await post('act', JSON.stringify({ id: 'x' }))
  }
  check("only the page's presses for longer than the quiet time: it stops", !alive(s.pid) || (await gone(s.pid, 500)))
}

for (const pid of left) try { process.kill(pid) } catch {}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
