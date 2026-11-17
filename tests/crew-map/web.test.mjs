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
const written = new Map()
const asked = []
const exports = []
const replies = []
const stored = new Map()
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, invalidate: () => {} },
  // (Short waits run at once, as the mod's wait for its website; the rest wait for the test.)
  clock: { every: (ms, fn) => (timers.push({ ms, fn }), { cancel() {} }), after: (ms, fn) => (ms <= 100 ? setTimeout(fn, ms) : later.push(fn), { cancel() {} }) },
  fs: {
    read: async p => (written.has(p) ? written.get(p) : 'line\n'),
    exists: async () => false,
    write: async (p, text) => void written.set(p, text),
    list: async p => (p.endsWith('.claude/crew-logs') ? [{ name: '2031-01-01-old-work-abcd1234.summary.md', mtimeMs: 1 }] : []),
  },
  model: { complete: async r => (asked.push(r), { isAnswered: true, text: '## Goal\nFix the loader.' }) },
  store: { get: async k => stored.get(k), set: async (k, v) => void stored.set(k, v) },
  session: { cwd: async () => 'C:/proj', id: async () => 'chat-web' },
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
const until = async (fn, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (await fn()) return true
  return false
}
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
  await wait(300)
  check('no website until it is asked for', !children.length)
  check('the desktop pane says how to open it, with no address yet', text(await render('desktop')).includes('Type /crew to open it beside the chat') && !find(await render('desktop'), x => x.type === 'Link').length, text(await render('desktop')).slice(0, 200))
  // The first /crew starts it.
  await hooks['command.run']($, { command: 'crew', args: '' }, async () => ({}))
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
  // Everything the page is sent, as it comes (a read left waiting would swallow what arrives next).
  void (async () => {
    for (let r = await reader.read(); !r.done; r = await reader.read()) got += new TextDecoder().decode(r.value)
  })().catch(() => {})
  const nextView = async () => {
    const until = Date.now() + 4000
    while (Date.now() < until) {
      const at = got.indexOf('\n\n')
      if (at >= 0) {
        const chunk = got.slice(0, at)
        got = got.slice(at + 2)
        const data = chunk.split('\n').find(l => l.startsWith('data: '))
        // An export (the whole log for the page to copy or save) is kept apart from the views.
        if (data && chunk.startsWith('event: export')) exports.push(JSON.parse(data.slice(6)))
        else if (data && chunk.startsWith('event: reply')) replies.push(JSON.parse(data.slice(6)))
        else if (data) return JSON.parse(data.slice(6))
        continue
      }
      await wait(30)
    }
    return null
  }
  let v = await nextView()
  check('a page that connects gets the view', !!v && Array.isArray(v.rows), v ? Object.keys(v).join(',') : 'nothing')
  check('the view has the main Claude, idle', v?.rows?.[0]?.name === 'Claude' && v.rows[0].state === 'idle', JSON.stringify(v?.rows?.[0] ?? {}).slice(0, 120))
  check('and the tabs, Activity shown', v?.tab === 'activity' && v.tabs.some(t => t.t === 'Activity' && t.on))
  check('its card has a context slot, empty until a model request measures it (-1), in clay', v?.rows?.[0]?.ctx === -1 && v.rows[0].hue === 'h0', JSON.stringify(v?.rows?.[0] ?? {}).slice(0, 160))

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

  // Settings' budget box and editor list.
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ set: { budget: 12, editor: 'cursor' } }) })
  await until(() => globalThis.__store.get('crew')?.editor === 'cursor')
  check('the budget typed on the page is set', globalThis.__store.get('crew')?.budget === 12, String(globalThis.__store.get('crew')?.budget))
  check('and the editor picked', globalThis.__store.get('crew')?.editor === 'cursor')
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ set: { budget: -5, editor: 'calc.exe' } }) })
  await wait(200)
  check('a budget or editor the list does not offer is ignored', globalThis.__store.get('crew')?.budget === 12 && globalThis.__store.get('crew')?.editor === 'cursor')

  // An MCP tool: in the log with its own icon.
  await hooks['tool.call']($, { tool_use_id: 'm1', tool: 'mcp__github__create_issue', title: 'Loader fails offline' }, async () => ({ text: 'ok' }))
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: v?.tabs?.find(t => t.t === 'Activity')?.act }) })
  await pub?.fn()
  let va
  for (let i = 0; i < 6 && !(va?.tab === 'activity' && va.log?.some(l => l.kind === 'mcp')); i++) {
    await pub?.fn()
    va = (await nextView()) ?? va
  }
  const mcp = va?.log?.find(l => l.kind === 'mcp')
  check('an MCP tool call is in the log, with the MCP icon', !!mcp, JSON.stringify(va?.log?.map(l => [l.kind, l.text]) ?? []).slice(0, 300))
  check('the page has the MCP icon to draw', !!va?.icons?.mcp)

  // An action opened: what came of it, asked for by the page (kept small, not sent with every view).
  await hooks['tool.call']($, { tool_use_id: 'e1', tool: 'Edit', file_path: 'C:/proj/src/loader.ts', old_string: 'a\nold line\nb', new_string: 'a\nnew line\nb' }, async () => ({ text: 'ok' }))
  await hooks['tool.call']($, { tool_use_id: 'b9', tool: 'Bash', command: 'npm run build', description: 'Build it' }, async () => ({ isError: true, text: `${'noise\n'.repeat(4000)}error TS2304: Cannot find name 'x'\nExit code 2` }))
  let vd
  for (let i = 0; i < 6 && !vd?.log?.some(l => l.bad); i++) {
    await pub?.fn()
    vd = (await nextView()) ?? vd
  }
  const edit = vd?.log?.find(l => l.kind === 'edit')
  const build = vd?.log?.find(l => l.bad)
  check('an edit can be opened (more), a failed command is marked bad', edit?.more === true && build?.more === true && build.kind === 'shell', JSON.stringify([edit, build]).slice(0, 300))
  check('the view carries no diff or output itself', !JSON.stringify(vd).includes('old line') && !JSON.stringify(vd).includes('TS2304'))
  const kept = globalThis.__store.get('crew')?.log.find(l => l.call === 'b9')
  check('what is kept of a long output is capped', !!kept?.more && kept.more.length <= 1200, String(kept?.more?.length))
  const ask = async msg => {
    replies.length = 0
    await fetch(`${url}act`, { method: 'POST', body: JSON.stringify(msg) })
    for (let i = 0; i < 20 && !replies.length; i++) await nextView()
    return replies[0]
  }
  const opened = await ask({ open: edit?.key })
  check('opening the edit gets its file, +added −removed, and its diff', opened?.open?.key === edit?.key && /^src\/loader\.ts \+1 −1\n/.test(opened.open.text) && /- old line/.test(opened.open.text) && /\+ new line/.test(opened.open.text), JSON.stringify(opened))
  check('with an Open diff to press', typeof opened?.open?.act === 'string' && opened.open.act.length > 0)
  const openedB = await ask({ open: build?.key })
  check('opening the failed build gets the command, the end of its output, and how it ended', /^\$ npm run build\n… \d+ earlier lines\n/.test(openedB?.open?.text) && /TS2304/.test(openedB.open.text) && /\n✕ Exit 2 · \d/.test(openedB.open.text), String(openedB?.open?.text).slice(0, 200))
  // Older lines: the page asks for the lines before its oldest, from the journal on disk.
  await timers.find(t => t.ms === 3000)?.fn()
  await pub?.fn()
  const vo = await nextView()
  check('the view says how many lines are saved before its oldest', vo?.older && typeof vo.older.left === 'number' && /^\d\d:\d\d$/.test(vo.older.first), JSON.stringify(vo?.older))
  const old = await ask({ older: edit?.at })
  check('the page can load older lines from the journal', old?.older?.before === edit?.at && old.older.lines.some(l => /loader\.ts/.test(l.text)) && old.older.lines.every(l => l.at < edit.at) && old.older.end === true, JSON.stringify(old).slice(0, 200))
  // A running call: its timer counts on the page, the view stays the same each second.
  let finish
  const running = hooks['tool.call']($, { tool_use_id: 'r1', tool: 'Bash', command: 'sleep 5', description: 'Wait a while' }, () => new Promise(r => (finish = r)))
  await wait(50)
  let vr
  for (let i = 0; i < 4; i++) {
    await pub?.fn()
    vr = (await nextView()) ?? vr
  }
  check('a running line is marked for the page to time', vr?.log?.some(l => l.run && !l.dur) && JSON.stringify(vr.rows).includes('\uE000'), JSON.stringify(vr?.rows?.[0] ?? {}).slice(0, 200))
  const still = got
  await wait(1100)
  await pub?.fn()
  await wait(150)
  check('and nothing is sent as the seconds pass', got === still)
  finish({ text: 'ok' })
  await running

  // The whole log: copied on the page, and saved in the project with a summary beside it.
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: va?.logActs?.copy }) })
  for (let i = 0; i < 20 && !exports.length; i++) await nextView()
  check('Copy sends the page the whole log as Markdown', exports[0]?.how === 'copy' && exports[0].text.startsWith('# Claude Crew log') && exports[0].text.includes('loader.ts'), String(exports[0]?.text).slice(0, 160))
  await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: va?.logActs?.save }) })
  await until(() => [...written.keys()].some(p => p.endsWith('.summary.md')))
  const saved = [...written.keys()].filter(p => p.includes('/.claude/crew-logs/'))
  check('Save writes the log into the project', saved.some(p => /\/\.claude\/crew-logs\/\d{4}-\d\d-\d\d-fix-the-loader-[\w-]+\.md$/.test(p) && !p.endsWith('.summary.md')), saved.join(' | '))
  check('and a summary beside it, from a cheaper model', saved.some(p => p.endsWith('.summary.md')) && asked[0]?.model === 'haiku', asked[0]?.model)
  check('the summary is what the model wrote', [...written.entries()].find(([p]) => p.endsWith('.summary.md'))?.[1]?.includes('Fix the loader.'))
  // Saved again: with nothing new, no model is asked; after a new line, only the lines since go with the summary.
  const saveAgain = async () => {
    const n = asked.length
    await fetch(`${url}act`, { method: 'POST', body: JSON.stringify({ id: va?.logActs?.save }) })
    await until(() => asked.length > n, 1500)
    await wait(100)
    return asked.slice(n)
  }
  check('saved again with nothing new: no model asked', !(await saveAgain()).length)
  await hooks['tool.call']($, { tool_use_id: 'n1', tool: 'Read', file_path: 'C:/proj/src/fresh.ts' }, async () => ({ text: 'ok' }))
  const [upd] = await saveAgain()
  check('after a new line: the summary so far and only the new lines are sent', /summary so far[\s\S]*Fix the loader\.[\s\S]*The log since[\s\S]*fresh\.ts/.test(upd?.prompt ?? '') && !/The log since[\s\S]*loader\.ts\*\*/.test(upd?.prompt ?? '') && !/Reading loader\.ts/.test((upd?.prompt ?? '').split('The log since')[1] ?? ''), String(upd?.prompt).slice(-400))
  const composed = await hooks['prompt.compose']($, {}, async () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }))
  check('new chats in the project are told where the saved logs are', composed.sections.some(s => s.id === 'crew-map:logs' && s.text.includes('.claude/crew-logs')), JSON.stringify(composed.sections.map(s => s.id)))

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

  // The website stops while a page has it open (as after the PC slept): it comes back at the same address.
  const linkNow = async () => find(await render('desktop'), x => x.type === 'Link')[0]?.props?.href ?? ''
  const servers = children.length
  children[servers - 1].kill()
  await until(async () => !(await linkNow()))
  await later.splice(0).reduce((p, fn) => p.then(fn), Promise.resolve())
  await until(async () => (await linkNow()) === url, 5000)
  check('stopped while a page had it open: it starts again, at the same address', children.length === servers + 1 && (await linkNow()) === url, `${servers} then ${children.length}: ${await linkNow()}`)

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
