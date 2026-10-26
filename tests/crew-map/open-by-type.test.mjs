// A click opens a file the way its type wants: pictures, media and documents in the system's app for
// them (Photos for a .png on Windows), code and text in the chosen editor, programs (and scripts with
// no editor to open them) picked out in their folder, never run. A card's folder opens the file manager.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const P = 'C:/work/game'
const ran = []
const toasts = []
let os = 'Windows_NT'
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => void toasts.push(t) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? os : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async argv => { ran.push(argv); return { exitCode: 0, stdout: '', stderr: '' } } },
}
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 60 } }, viewport: { columns: 150 } }, async () => ({}))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Look around', turnId: 'T' }, async () => ({}))
const files = ['art/hero sprite.png', 'art/intro.mp4', 'docs/spec.pdf', 'docs/notes.xlsx', 'src/loader.ts', 'tools/build.bat', 'tools/setup.exe', 'tools/run.ps1']
for (const f of files) await fire('tool.call', { tool: 'Read', tool_use_id: `c${n++}`, file_path: `${P}/${f}` }, async () => ({ text: 'ok' }))
const click = async (key, choice) => {
  if (choice) globalThis.__store.get('crew').editor = choice
  const tree = await render()
  const b = find(tree, x => x.type === 'Button' && x.props.key === key)[0]
  ran.length = 0
  toasts.length = 0
  await b?.props.onPress()
  await new Promise(r => setTimeout(r, 5))
  return { argv: ran[0] ?? [], toast: toasts[0] ?? '', found: !!b }
}
const win = p => `${P}/${p}`.replace(/\//g, '\\')
// Picked out in Explorer through PowerShell, which keeps a path with spaces whole.
const revealed = (argv, p) => argv[0] === 'powershell' && argv.at(-1) === `Start-Process explorer.exe -ArgumentList ('/select,"' + '${win(p)}' + '"')`

let r = await click(`file:${P}/art/hero sprite.png`)
check('a .png opens in the system app for pictures (Photos on Windows), not VS Code', r.argv[0] === 'explorer' && r.argv[1] === win('art/hero sprite.png'), JSON.stringify(r.argv))
check('...and says so', r.toast === 'Opening hero sprite.png in its app…', r.toast)
r = await click(`file:${P}/art/intro.mp4`)
check('a video opens in its app', r.argv[0] === 'explorer' && r.argv[1] === win('art/intro.mp4'), JSON.stringify(r.argv))
r = await click(`file:${P}/docs/spec.pdf`)
check('a PDF opens in its app', r.argv[0] === 'explorer' && r.argv[1] === win('docs/spec.pdf'), JSON.stringify(r.argv))
r = await click(`file:${P}/docs/notes.xlsx`)
check('a spreadsheet opens in its app', r.argv[0] === 'explorer' && r.argv[1] === win('docs/notes.xlsx'), JSON.stringify(r.argv))
r = await click(`file:${P}/src/loader.ts`)
check('code still opens in the editor chosen', r.argv.join(' ').endsWith(`code -g ${P}/src/loader.ts`) && r.toast === 'Opening loader.ts…', `${JSON.stringify(r.argv)} ${r.toast}`)
r = await click(`file:${P}/tools/setup.exe`)
check('a program is never run: it is picked out in its folder', revealed(r.argv, 'tools/setup.exe'), JSON.stringify(r.argv))
check('...and the toast says it is shown, not run', /^Showing setup\.exe in its folder/.test(r.toast), r.toast)
r = await click(`file:${P}/tools/build.bat`)
check('a script opens in the editor when one is chosen', r.argv.join(' ').endsWith(`code -g ${P}/tools/build.bat`), JSON.stringify(r.argv))
r = await click(`file:${P}/tools/build.bat`, 'system')
check('with "default app", a script is shown in its folder, not run', revealed(r.argv, 'tools/build.bat'), JSON.stringify(r.argv))
r = await click(`file:${P}/src/loader.ts`, 'system')
check('with "default app", code opens in the system app', r.argv[0] === 'explorer' && r.argv[1] === win('src/loader.ts'), JSON.stringify(r.argv))
r = await click(`file:${P}/art/hero sprite.png`, 'cursor')
check('with Cursor chosen, a picture still opens in its app', r.argv[0] === 'explorer' && r.argv[1] === win('art/hero sprite.png'), JSON.stringify(r.argv))

// Folders: the card's name opens the file manager, and shows it can.
globalThis.__store.get('crew').editor = 'code'
const tree = await render()
const dirBtn = find(tree, x => x.type === 'Button' && x.props.key === 'dir:art')[0]
check("a card's folder name is a button marked ↗", !!dirBtn && /📁 art ↗/.test(text(dirBtn)), text(dirBtn))
r = await click('dir:art')
check('...that opens the folder in the file manager', r.argv[0] === 'explorer' && r.argv[1] === win('art') && r.toast === 'Opening art in the file manager…', `${JSON.stringify(r.argv)} ${r.toast}`)

// macOS: open / open -R; Linux: xdg-open (the folder for a program).
const platformTry = async (name, uname) => {
  // A fresh copy of the mod, so it asks the OS again.
  const mod = await import(`../.build/crew-map.mjs?${name}`)
  const regs2 = []
  mod.register((ev, m, fn) => { regs2.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
  const fire2 = (ev, e, bottom) => { const mine = regs2.filter(x => x.ev === ev && Object.entries(x.m).every(([k, v]) => e[k] === v)); const run = i => (i < mine.length ? mine[i].fn($2, e, y => run(i + 1, y)) : bottom(e)); return run(0) }
  const out = []
  const $2 = { ...$, env: { get: async () => undefined }, process: { run: async argv => { out.push(argv); return { exitCode: 0, stdout: argv[0] === 'uname' ? uname : '', stderr: '' } } } }
  globalThis.__store = new Map()
  await fire2('session.start', {}, async () => ({}))
  for (const f of ['art/hero sprite.png', 'tools/setup.exe']) await fire2('tool.call', { tool: 'Read', tool_use_id: `m${n++}`, file_path: `/home/me/game/${f}` }, async () => ({ text: 'ok' }))
  const t = await fire2('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 60 } }, viewport: { columns: 150 } }, async () => ({}))
  const got = []
  for (const f of ['art/hero sprite.png', 'tools/setup.exe']) {
    out.length = 0
    await find(t, x => x.type === 'Button' && x.props.key === `file:/home/me/game/${f}`)[0]?.props.onPress()
    await new Promise(res => setTimeout(res, 5))
    got.push(out.filter(a => a[0] !== 'uname').at(-1) ?? [])
  }
  return got
}
const [macPng, macExe] = await platformTry('mac', 'Darwin')
check('on a Mac a picture opens with `open` (Preview or its app)', macPng.join(' ') === 'open /home/me/game/art/hero sprite.png', JSON.stringify(macPng))
check('...and a program is revealed in Finder (open -R)', macExe.join(' ') === 'open -R /home/me/game/tools/setup.exe', JSON.stringify(macExe))
const [linPng, linExe] = await platformTry('linux', 'Linux')
check('on Linux a picture opens with xdg-open', linPng.join(' ') === 'xdg-open /home/me/game/art/hero sprite.png', JSON.stringify(linPng))
check("...and a program's folder opens instead of the program", linExe.join(' ') === 'xdg-open /home/me/game/tools', JSON.stringify(linExe))
console.log(`\n${fails} failing check(s)`)
