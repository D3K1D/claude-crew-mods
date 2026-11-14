// The website: the mod starts its server (a real Node process here), the pane on the desktop says
// where it is, a page that connects gets the view, a press on the page reaches the mod, /crew asks
// Claude to open it, and nothing but this computer's own page can drive it.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Link: el('Link') }
const { register } = await import('../.build/crew-map.mjs')
const here = fileURLToPath(new URL('.', import.meta.url))
const hooks = {}
const children = []
const timers = []
const prompts = []
const later = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  clock: { every: (ms, fn) => (timers.push({ ms, fn }), { cancel() {} }), after: (ms, fn) => (later.push(fn), { cancel() {} }) },
  fs: { read: async () => 'line\n', exists: async () => false },
  model: { complete: async () => ({ isAnswered: true, text: '' }) },
  store: { get: async () => undefined, set: async () => {} },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
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
  prompt: { submit: async p => prompts.push(p) },
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
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of x.props?.children ?? []) find(c, pred, out)
  return out
}
const render = surface => hooks['ui.render']($, { surface, props: { bodyColumns: 100 }, viewport: { columns: 100 } })
const done = () => {
  for (const ch of children) ch.kill()
  console.log(`${fails} failing check(s)`)
  process.exit(fails ? 1 : 0)
}

try {
  await hooks['session.start']($, {}, async () => ({}))
  let link
  for (let i = 0; i < 100 && !link; i++) {
    await wait(50)
    link = find(await render('desktop'), x => x.type === 'Link')[0]
  }
  check('the mod starts its website, and the desktop pane shows where', !!link, link?.props?.href)
  const url = link?.props?.href ?? ''
  check('the address is this computer only, with a long random token', /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{24}\/$/.test(url), url)
  const pane = await render('desktop')
  check('the pane says how to open it: /crew', text(pane).includes('/crew'), text(pane).slice(0, 160))
  check('the terminal still draws the whole pane', text(await render('terminal')).includes('Activity'))

  const page = await fetch(url)
  const html = await page.text()
  check('the page loads', page.ok && html.includes('<title>Claude Crew</title>'))
  check('its script and styles load', (await fetch(`${url}app.js`)).ok && (await fetch(`${url}app.css`)).ok)
  const wrongToken = await fetch(url.replace(/[0-9a-f]{24}/, '0'.repeat(24)))
  check('a wrong token gets nothing', wrongToken.status === 404, String(wrongToken.status))
  const port = new URL(url).port
  const otherHost = await new Promise(res => {
    import('node:http').then(({ request }) => {
      const rq = request({ host: '127.0.0.1', port, path: new URL(url).pathname, headers: { host: 'evil.example' } }, r => res(r.statusCode))
      rq.end()
    })
  })
  check('a request naming another host is refused', otherHost === 403, String(otherHost))

  // A page connects: it gets the view.
  const ac = new AbortController()
  const stream = await fetch(`${url}events`, { signal: ac.signal })
  const reader = stream.body.getReader()
  let got = ''
  const nextView = async () => {
    const until = Date.now() + 4000
    while (Date.now() < until) {
      const at = got.indexOf('\n\n')
      if (at >= 0) {
        const chunk = got.slice(0, at)
        got = got.slice(at + 2)
        const data = chunk.split('\n').find(l => l.startsWith('data: '))
        if (data) return JSON.parse(data.slice(6))
        continue
      }
      const r = await Promise.race([reader.read(), wait(300).then(() => null)])
      if (r?.value) got += new TextDecoder().decode(r.value)
    }
    return null
  }
  let v = await nextView()
  check('a page that connects gets the view', !!v && Array.isArray(v.rows), v ? Object.keys(v).join(',') : 'nothing')
  check('the view has the main Claude, idle', v?.rows?.[0]?.name === 'Claude' && v.rows[0].state === 'idle', JSON.stringify(v?.rows?.[0] ?? {}).slice(0, 120))
  check('and the tabs, Activity shown', v?.tab === 'activity' && v.tabs.some(t => t.t === 'Activity' && t.on))

  // Work happens: the next send has it.
  await hooks['turn.start']($, { text: 'Fix the loader', turnId: 'T1' }, async () => ({ turnId: 'T1' }))
  await hooks['tool.call']($, { tool_use_id: 'a1', tool: 'Read', file_path: 'C:/proj/src/loader.ts' }, async () => ({ text: 'ok' }))
  const pub = timers.find(t => t.ms === 800)
  check('the mod sends the view on a timer', !!pub)
  await pub?.fn()
  await wait(100)
  v = await nextView()
  check('the read shows in the log', v?.log?.some(l => /loader\.ts/.test(l.text)), JSON.stringify(v?.log?.map(l => l.text) ?? []).slice(0, 200))
  check('and in Touched', v?.touched?.folders?.some(d => d.files.some(f => f.name === 'loader.ts')), JSON.stringify(v?.touched ?? {}).slice(0, 200))
  const same = got
  await pub?.fn()
  await wait(150)
  check('nothing is sent when nothing changed', got === same)

  // A press on the page: the Files tab.
  const files = v?.tabs?.find(t => t.label === 'All files')
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: files?.act }) })
  let pane2
  for (let i = 0; i < 40; i++) {
    await wait(50)
    pane2 = globalThis.__store.get('crew')?.pane
    if (pane2?.tab === 'files') break
  }
  check('a press on the page reaches the mod (Files tab)', pane2?.tab === 'files', JSON.stringify(pane2))
  v = await nextView()
  check('and the page gets the Files view back', v?.tab === 'files' && v.lines.some(l => l.segs.some(s => s.t === 'loader.ts')), v?.tab)
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: 'nope' }) })
  await wait(150)
  check('an id the mod never gave does nothing', globalThis.__store.get('crew')?.pane?.tab === 'files')

  // /crew asks Claude to open it in the browser pane once the command is done, and shows the address.
  const r = await hooks['command.run']($, { command: 'crew', args: '' }, async () => ({}))
  check('/crew shows the address, to click if it does not open', String(r?.text).includes(url), String(r?.text))
  check('and asks nothing while the command still runs', !prompts.length, JSON.stringify(prompts))
  await later.splice(0).reduce((p, fn) => p.then(fn), Promise.resolve())
  await wait(20)
  check('then asks Claude to open it in the browser pane, and show the pane', prompts.some(p => p.text.includes(url) && p.text.includes('preview_start') && p.text.includes('show_pane') && p.asUser), JSON.stringify(prompts))
  // That turn is not a task: the log calls it a note, and the last task stays the person's.
  await hooks['turn.start']($, { text: prompts[0]?.text ?? '', turnId: 'T9' }, async () => ({ turnId: 'T9' }))
  check("/crew's turn keeps the person's goal", globalThis.__store.get('crew')?.agents.find(a => a.id === 'main')?.goal === 'Fix the loader', globalThis.__store.get('crew')?.agents.find(a => a.id === 'main')?.goal)

  // Keep the page's address for a look in a real browser (tests/.build/web-url.txt), then stop.
  writeFileSync(join(here, '..', '.build', 'web-url.txt'), url)
  if (process.env.CREW_WEB_HOLD) {
    console.log(`holding ${url}`)
    await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: v?.tabs?.find(t => t.t === 'Activity')?.act }) })
    await wait(Number(process.env.CREW_WEB_HOLD))
  }
  ac.abort()
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 300)}`, false)
}
done()
