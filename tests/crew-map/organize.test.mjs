// Keeping a big map readable: old files fade, quiet folders fold up (and a click folds or unfolds
// one), a Claude in a folded folder sits on it, the search finds and follows files, files outside
// the project can be hidden, the map takes the whole width (no minimap) and the arrows move it, and
// clicks still open the right thing however the map is zoomed and moved.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const ran = []
const toasts = []
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => toasts.push(t), copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async argv => (ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'Tidy the docs and the loader', turnId: 'T' }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 50 } }, viewport: { columns: 150 } })
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const read = p => hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${n++}`, file_path: `${P}/${p}` }, async () => ({ text: 'ok' }))
const settle = () => { for (const a of crew().agents) if (a.state !== 'idle') a.state = 'idle' }

let tree, pan
const draw = async () => {
  tree = await render()
  pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]
  return tree
}
const svg = () => find(tree, x => x.type === 'Svg')[0].props.source
const props = () => pan.props.props
/** The group drawn around a label, and where it sits in the window. */
const groupAt = label => {
  const src = svg()
  const i = src.indexOf(`>${label}</text>`)
  const g = src.lastIndexOf('<g transform="translate(', i)
  return i < 0 ? null : src.slice(g, src.indexOf('>', g) + 1)
}
const drawnOf = label => { const src = svg(); const i = src.indexOf(`>${label}</text>`); return src.slice(src.lastIndexOf('<g transform="translate(', src.lastIndexOf('<path d="M0 0H28', i)), i) }
const spotOf = (label, dx, dy) => {
  const head = groupAt(label)
  const [x, y] = head.slice(24).split(')')[0].split(',').map(Number)
  const v = props().view
  return [(x + dx - v.x) * v.k, (y + dy - v.y) * v.k]
}
const msg = async data => { await hooks['ui.message']($, { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'pan', module: './pan.tsx', data: { view: props().view, rev: props().rev, ...data } }, async () => ({})); await new Promise(r => setTimeout(r, 5)) }
const tick = () => new Promise(r => setTimeout(r, 10))
/** The window's middle to a map point at its zoom, written as the engine keeps the window (as the arrows and zoom buttons could leave it). */
let moves = 0
const centreOn = async to => { const v = globalThis.__store.get('view'); const k = props().view.k; globalThis.__store.set('view', { ...v, x: to[0] - props().vw / k / 2, y: to[1] - props().vh / k / 2, k, auto: false, follow: 0, rev: `t${++moves}` }) }
const press = async key => { const b = find(tree, x => x.type === 'Button' && x.props.key === key)[0]; if (!b) throw new Error(`no ${key}`); await b.props.onPress() }
/** Draws until no move is waiting (each draw lets the next waiting move through). */
const settleView = async () => { for (let i = 0; i < 4; i++) await draw() }
const middle = () => { const v = props().view; return [v.x + props().vw / v.k / 2, v.y + props().vh / v.k / 2] }
/** The window at zoom k with its corner at (x, y), as the zoom buttons and the arrows can leave it. */
const setView = async ({ x, y, k }) => {
  for (let i = 0; i < 8 && Math.abs(props().view.k - k) > 1e-9; i++) {
    await msg({ zoom: Math.min(2, Math.max(0.5, k / props().view.k)) })
    await draw()
  }
  await centreOn([x + props().vw / k / 2, y + props().vh / k / 2])
  await draw()
}

// A project: a loader, docs, and two files from elsewhere.
for (const f of ['src/loader.ts', 'src/chunk.ts', 'src/gen.ts', 'docs/guide.md', 'docs/setup.md', 'docs/faq.md']) await read(f)
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${n++}`, file_path: 'C:/other/notes/z1.ts' }, async () => ({ text: 'ok' }))
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${n++}`, file_path: 'C:/other/notes/z2.ts' }, async () => ({ text: 'ok' }))
settle()
await draw()
check('before the map has had the mouse, the search is the built-in field', !!find(tree, x => x.type === 'Input' && x.props.key === 'search')[0] && !find(tree, x => x.type === 'Client' && x.props.key === 'search').length)
check('...and the toolbar does not ask to drag or scroll the map itself', !/drag to move|scroll to zoom|move the mouse over the map/.test(JSON.stringify(tree)))
check('fresh files are drawn at full strength', !/opacity/.test(drawnOf('guide.md')), drawnOf('guide.md').slice(0, 80))

// ── Fading ──
now += 6 * 60_000
await read('src/loader.ts')
settle()
await draw()
check('a file untouched for five minutes fades', /opacity="0\.4"/.test(drawnOf('guide.md')), drawnOf('guide.md').slice(0, 90))
check('a file just touched does not', !/opacity/.test(drawnOf('loader.ts')), drawnOf('loader.ts').slice(0, 80))

// ── Folding by itself ──
now += 5 * 60_000
await read('src/chunk.ts')
settle()
await draw()
check('a folder untouched for ten minutes folds up', !svg().includes('>guide.md</text>') && svg().includes('▸ 3 files'))
check('a folder in use stays open', svg().includes('>chunk.rs</text>') || svg().includes('>chunk.ts</text>'))
check('a small folder does not fold by itself', svg().includes('>z1.ts</text>'))
// The person unfolds it: it stays open, though quiet.
await msg({ click: spotOf('docs', 17, 14) })
await draw()
check('a click unfolds a folded folder, and it stays open', crew().folds?.docs === 'open' && svg().includes('>guide.md</text>'))
// Folded by hand, with a Claude working inside: the Claude sits on the folder.
await msg({ click: spotOf('docs', 17, 14) })
check('a click folds it again', crew().folds?.docs === 'closed')
await hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${n++}`, file_path: `${P}/docs/faq.md` }, async () => {
  await draw()
  return { text: 'ok' }
})
check('a folder folded by hand stays folded while a Claude works in it', !svg().includes('>faq.md</text>'))
const docsAt = groupAt('docs').match(/translate\(([\d.]+),([\d.]+)\)/).slice(1).map(Number)
// A Claude's sprite: parked (bobbing), or still swinging in from its last file.
const sprites = [...svg().matchAll(/<g transform="translate\(([\d.-]+),([\d.-]+)\)"><g(?: style="transform-box:fill-box;animation:bob|><animateMotion)/g)].map(m => [Number(m[1]), Number(m[2])])
check('the Claude working inside sits on the folded folder', sprites.some(([x, y]) => Math.abs(x + 17.6 - (docsAt[0] + 17)) < 30 && y < docsAt[1] && docsAt[1] - y < 70), JSON.stringify({ docsAt, sprites }))
check('the map says so in words too', find(tree, x => x.type === 'Svg')[0].props.alt.includes('Claude on the folder docs'), find(tree, x => x.type === 'Svg')[0].props.alt)
settle()
await msg({ click: spotOf('docs', 17, 14) })
await draw()

// ── Search ──
/** Typing in the search field the surface draws: each change arrives as a message, Enter as `next`. */
const typeSearch = (q, next = false) => hooks['ui.message']($, { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'search', module: './search.tsx', data: { q, next } }, async () => ({}))
const searchField = () => find(tree, x => x.type === 'Client' && x.props.key === 'search')[0]
check('once the map has had the mouse, the search is a field of our own (no Enter button)', !!searchField() && searchField().props.module === './search.tsx' && !find(tree, x => x.type === 'Input' && x.props.key === 'search').length)
check('it is one line inside a quiet field border, nothing else', searchField()?.props.height === 1 && find(tree, x => x.type === 'Box' && x.props.borderColor === '#30363D' && x.props.borderStyle === 'round' && (x.props.children ?? []).some(c => c?.props?.key === 'search')).length === 1)
await msg({ click: spotOf('docs', 17, 14) })
await draw()
check('(docs folded for the search)', !svg().includes('>setup.md</text>'))
await typeSearch('setup')
await draw()
check('a search opens the folded folder its hit is in', svg().includes('>setup.md</text>'))
check('the hit is outlined', /<rect x="-8" y="-8"[^>]*stroke="#FFFFFF"/.test(svg()))
check('it says which hit of how many', text(tree).includes('1/1'))
check('the window goes to the hit, at full size or closer', props().rev.startsWith('s') && props().view.k >= 1, JSON.stringify(props().view))
const [hx, hy] = spotOf('setup.md', 19, 23)
check('the hit is in the middle of the window', Math.abs(hx - props().vw / 2) < 40 && Math.abs(hy - props().vh / 2) < 40, `${hx.toFixed(0)},${hy.toFixed(0)} of ${props().vw}x${props().vh}`)
await typeSearch('.md')
await draw()
check('several hits are counted', text(tree).includes('1/3'))
const firstHit = props().view
await typeSearch('.md', true)
await draw()
check('Enter goes to the next hit', text(tree).includes('2/3') && (props().view.x !== firstHit.x || props().view.y !== firstHit.y))
await typeSearch('zzz')
await draw()
check('no hit shows nothing beside the field (no "no match" to push it over)', !text(tree.props.children[0]).includes('no match') && !/\d+\/\d+/.test(text(tree.props.children[0])))
await typeSearch('faq')
await draw()
const beforeDrag = props().view
await press('move-right')
await draw()
await draw()
check('moving the map after a search leaves it where it was moved (the search no longer pulls it back)', props().view.x > beforeDrag.x + 1, JSON.stringify({ beforeDrag, after: props().view }))
await typeSearch('')
await draw()
check('clearing the search clears the count and the outline', !/\d+\/\d+ |no match/.test(text(tree.props.children[0])) && !/<rect x="-8" y="-8"[^>]*stroke="#FFFFFF"/.test(svg()), text(tree.props.children[0]))

// ── Hiding files from outside the project ──
await find(tree, x => x.type === 'Button' && x.props.key === 'fit')[0].props.onPress()
await draw()
ran.length = 0
await msg({ click: spotOf('outside project', 48 + 22, -2 + 8) })
await draw()
check('the hide chip hides files outside the project', crew().hideOutside === true && !svg().includes('>z1.ts</text>') && !svg().includes('outside project') && ran.length === 0)
const show = find(tree, x => x.type === 'Button' && x.props.key === 'show-outside')[0]
check('a button below the map says how many are hidden', !!show && text(show).includes('2 hidden'), show && text(show))
await show.props.onPress()
await draw()
check('and brings them back', !crew().hideOutside && svg().includes('>z1.ts</text>'))

// ── No minimap: the map takes the whole width; the arrows and the zoom buttons move it ──
await press('fit')
await draw()
check('the key shows in the empty bottom-left corner, drawn by the window', svg().split('not opened').length === 2 && svg().indexOf('not opened') > svg().lastIndexOf(' scale('))
check('there is no minimap, and no hand for one', !find(tree, x => x.props?.key === 'minimap').length && !find(tree, x => x.type === 'Client' && x.props.key === 'mini').length && !find(tree, x => x.type === 'Svg' && /minimap/i.test(String(x.props.alt))).length)
check('the map takes the whole width', find(tree, x => x.type === 'Box' && x.props.key === 'map')[0].props.width === 150 - 1)
{
  for (let i = 0; i < 3; i++) await press('bigger')
  await settleView()
  const arrows = ['left', 'up', 'down', 'right'].map(d => find(tree, x => x.type === 'Button' && x.props.key === `move-${d}`)[0])
  check('zoomed in, the toolbar has arrows to move the map', arrows.every(Boolean) && arrows.map(text).join('') === '◀▲▼▶', arrows.map(b => b && text(b)).join(''))
  const v1 = props().view
  const halfW = props().vw / v1.k / 2
  const halfH = props().vh / v1.k / 2
  // Half a window, but never past the map's far edge (nor back past its near one).
  const edgeX = (x, d) => Math.min(Math.max(x + d * halfW, Math.min(0, x)), Math.max(x, props().mw - props().vw / v1.k))
  const edgeY = (y, d) => Math.min(Math.max(y + d * halfH, Math.min(0, y)), Math.max(y, props().mh - props().vh / v1.k))
  await arrows[3].props.onPress()
  await settleView()
  check('▶ moves the window right by half of it (stopping at the map edge)', Math.abs(props().view.x - edgeX(v1.x, 1)) < 1e-6 && props().view.y === v1.y, JSON.stringify({ v1, now: props().view }))
  const v2 = props().view
  await arrows[2].props.onPress()
  await arrows[2].props.onPress()
  await settleView()
  check('two ▼ presses in a row add up (stopping at the map edge)', Math.abs(props().view.y - edgeY(v2.y, 2)) < 1e-6, JSON.stringify({ v2, now: props().view }))
  await arrows[1].props.onPress()
  await arrows[1].props.onPress()
  await arrows[0].props.onPress()
  await settleView()
  check('◀ and ▲ move it back', props().view.x < v2.x && props().view.y < v2.y + 2 * halfH)
  check('arrows keep the zoom', props().view.k === v1.k)
  // Far off the map: the window keeps a quarter of itself over it.
  for (let i = 0; i < 12; i++) await arrows[0].props.onPress()
  for (let i = 0; i < 12; i++) await arrows[1].props.onPress()
  await settleView()
  check('however far the arrows push, the window stays partly over the map', props().view.x >= -(props().vw / props().view.k) * 0.75 - 1e-6 && props().view.y >= -(props().vh / props().view.k) * 0.75 - 1e-6, JSON.stringify(props().view))
  await press('fit')
  await draw()
  check('at the whole map, the arrows are drawn dim and do nothing (nowhere to move)', !find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('move-')).length && /◀/.test(text(tree)))
}

// ── Hover: an outline, the import lines, and the full name in a tip ──
await msg({ hover: spotOf('loader.ts', 19, 23) })
await draw()
// The outline is the search outline's shape: around the icon (38×46), 8 out at the top and sides, 4 below (clear of the name).
const blueRing = () => svg().match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="9" fill="#79C0FF" fill-opacity=".08" stroke="#79C0FF"/)
const loaderAt = groupAt('loader.ts').match(/translate\(([\d.-]+),([\d.-]+)\)/).slice(1).map(Number)
check('resting on a file outlines its icon, the same shape as the search outline', (() => {
  const m = blueRing()
  return !!m && Math.abs(Number(m[1]) - (loaderAt[0] - 8)) < 0.2 && Math.abs(Number(m[2]) - (loaderAt[1] - 8)) < 0.2 && Number(m[3]) === 38 + 16 && Number(m[4]) === 46 + 12
})(), String(blueRing()?.[0]))
// Its bottom edge clears the name under the icon: an 11 px name's glyphs reach about 8 above its baseline (15 below the icon).
check('the outline ends above the file name, with a gap', (() => { const m = blueRing(); return !!m && Number(m[2]) + Number(m[4]) <= loaderAt[1] + 46 + 15 - 8 - 2 })())
// The tip starts below the file's name (its baseline 15 below the icon, plus descent), in window pixels.
check('the tip sits below the file name, not over it', (() => {
  const m = svg().match(/<g transform="translate\(([\d.]+),([\d.]+)\)"><rect width="([\d.]+)" height="38"/)
  const nameBottom = (loaderAt[1] + 46 + 15 + 4 - props().view.y) * props().view.k
  return !!m && Number(m[2]) >= nameBottom
})())
check('...and its tip names it in full, and says what a click does', svg().includes('>src/loader.ts</text>') && svg().includes('click to open</text>'))
check('...the tip lies inside the window', (() => {
  const m = svg().match(/<g transform="translate\(([\d.]+),([\d.]+)\)"><rect width="([\d.]+)" height="38"/)
  return !!m && Number(m[1]) >= 4 && Number(m[1]) + Number(m[3]) <= props().vw - 3 && Number(m[2]) >= 4 && Number(m[2]) + 38 <= props().vh
})())
await msg({ hover: spotOf('docs', 17, 14) })
await draw()
check('resting on a folder says how many files, and what click and Ctrl-click do', svg().includes('>docs</text>') && /3 files · click to (un)?fold · Ctrl-click: file manager/.test(svg()))
await msg({ hover: [2, 2] })
await draw()
check('empty map shows no tip', !svg().includes('fill="#161B22" stroke="#79C0FF"'))
// A search hit already has its white outline: hovering it adds no second one, only the tip and links.
await typeSearch('loader')
await draw()
await msg({ hover: spotOf('loader.ts', 19, 23) })
await draw()
check('hovering a search hit adds no second outline', !blueRing() && svg().includes('>src/loader.ts</text>') && /<rect x="-8" y="-8"[^>]*stroke="#FFFFFF"/.test(svg()))
await typeSearch('')
await draw()
await msg({ hover: spotOf('loader.ts', 19, 23) })
await msg({ hover: null, sel: false })
await draw()
check('leaving the map clears it', !svg().includes('fill="#161B22" stroke="#79C0FF"'))

// ── One move in flight at a time: moves that arrive while one is being drawn replace each other ──
// (The stub's clock never fires, so a move waits for a draw: each draw() here stands for one frame.)
{
  for (let i = 0; i < 3; i++) await find(tree, x => x.type === 'Button' && x.props.key === 'bigger')[0].props.onPress()
  await settleView()
  const v0 = props().view
  const half = props().vw / v0.k / 2
  const edge = (x, n) => Math.min(Math.max(x + n * half, Math.min(0, x)), Math.max(x, props().mw - props().vw / v0.k))
  // Three ▶ presses while the first is being drawn: the first lands at once, the other two together.
  await press('move-right')
  await press('move-right')
  await press('move-right')
  await draw()
  const x1 = edge(v0.x, 1)
  check('the first move is drawn at once', Math.abs(props().view.x - x1) < 1e-6, String(props().view.x - v0.x))
  await draw()
  check('the moves that arrived meanwhile land together, in one frame', Math.abs(props().view.x - edge(x1, 2)) < 1e-6, String(props().view.x - v0.x))
  const settled = props().view.x
  await draw()
  check('...and nothing is left queued behind it', props().view.x === settled)
  // Zoom presses in a burst compound into one zoom, about the middle.
  await find(tree, x => x.type === 'Button' && x.props.key === 'fit')[0].props.onPress()
  await draw()
  const k0 = props().view.k
  const [m0x, m0y] = middle()
  await msg({ zoom: 1.25 })
  await msg({ zoom: 1.25 })
  await msg({ zoom: 1.25 })
  await draw()
  check('the first zoom press zooms at once', Math.abs(props().view.k - k0 * 1.25) < 1e-6, `${k0} → ${props().view.k}`)
  await draw()
  check('the presses that arrived meanwhile compound into one zoom', Math.abs(props().view.k - k0 * 1.25 ** 3) < 1e-6, `${props().view.k} vs ${k0 * 1.25 ** 3}`)
  check('...about the middle', Math.abs(middle()[0] - m0x) < 0.5 && Math.abs(middle()[1] - m0y) < 0.5)
  // A zoom and an arrow press waiting together: both land (neither replaces the other).
  const k1 = props().view.k
  await msg({ zoom: 1.25 })
  await msg({ zoom: 0.8 })
  const before = props().view
  await press('move-down')
  await msg({ zoom: 1.25 })
  await settleView()
  check('a zoom and an arrow press waiting together both land', Math.abs(props().view.k - k1 * 1.25) < 1e-6 && props().view.y > before.y, JSON.stringify({ k1, before, view: props().view }))
  await find(tree, x => x.type === 'Button' && x.props.key === 'fit')[0].props.onPress()
  await settleView()
}

// ── The keyboard: + and − zoom, 0 shows the whole map (the pan module sends these) ──
const kBefore = props().view.k
await msg({ zoom: 1.25 })
await draw()
check('+ zooms in about the middle', Math.abs(props().view.k - Math.min(2.5, kBefore * 1.25)) < 1e-6, `${kBefore} → ${props().view.k}`)
await msg({ zoom: 0.8 })
await msg({ zoom: 'x' })
await msg({ zoom: -3 })
await draw()
check('− zooms out; junk is ignored', Math.abs(props().view.k - kBefore) < 1e-6, `${kBefore} → ${props().view.k}`)
await msg({ zoom: 1.25 })
await msg({ fit: true })
await draw()
check('0 shows the whole map', props().view.k * props().mw <= props().vw + 1 && props().view.k * props().mh <= props().vh + 1)

// ── Contrast: names stay readable when their file fades ──
now += 6 * 60_000
await draw()
// Every faded icon's group is followed by its name: that name is drawn in a readable grey (or error red).
const fadedNames = [...svg().matchAll(/<g opacity="[\d.]+">[\s\S]*?<\/g><text [^>]*fill="([^"]+)"/g)].map(m => m[1])
check('a faded file keeps its name in a readable grey', fadedNames.length > 0 && fadedNames.every(f => f === '#9CA3AF' || f === '#FF7B72'), JSON.stringify(fadedNames))
check('no text on the map is drawn in a grey too dark to read', !/<text[^>]*fill="#(6B7280|4B5563|30363D)"/.test(svg()))

// ── Clicks after zooming and moving ──
const opens = async (label, dx, dy, path) => {
  ran.length = 0
  const spot = spotOf(label, dx, dy)
  await msg({ click: spot })
  await tick()
  return ran.some(a => a.join(' ').endsWith(`code -g ${P}/${path}`))
}
await find(tree, x => x.type === 'Button' && x.props.key === 'fit')[0].props.onPress()
await draw()
check('at fit, a click opens the file under it', await opens('gen.ts', 19, 23, 'src/gen.ts'))
{
  const [gx, gy] = groupAt('gen.ts').slice(24).split(')')[0].split(',').map(Number)
  await msg({ zoom: 2 })
  await settleView()
  await centreOn([gx + 19, gy + 23])
  await draw()
}
check('after a zoom, a click opens the file under it', props().view.k > 1 && (await opens('gen.ts', 19, 23, 'src/gen.ts')), JSON.stringify(props().view))
{
  await press('move-left')
  await press('move-up')
  await settleView()
}
check('after the arrows moved the window, a click opens the file under it', await opens('gen.ts', 19, 23, 'src/gen.ts'))
// A press that moves on the map itself moves nothing (the map's hand sends no window).
{
  const before = props().view
  await msg({ hover: [10, 10] })
  await draw()
  check('the map itself does not move under the pointer', props().view.x === before.x && props().view.y === before.y && props().view.k === before.k)
}
check('a click just beside a file opens nothing', await (async () => {
  ran.length = 0
  const [x, y] = spotOf('gen.ts', 19, 23)
  // Files sit 120 map units apart and a file's area reaches 46 either side: 60 is in the gap.
  await msg({ click: [x + 60 * props().view.k, y] })
  await tick()
  return ran.length === 0
})())
const [lx, ly] = groupAt('loader.ts').slice(24).split(')')[0].split(',').map(Number)
for (const k of [0.6, 1.7, 2.4]) {
  // The window centred on the file at this zoom, as the zoom buttons and the arrows could leave it.
  await setView({ x: lx + 19 - props().vw / k / 2, y: ly + 23 - props().vh / k / 2, k })
  check(`at ${Math.round(k * 100)}%, a click opens the file under it`, Math.abs(props().view.k - k) < 1e-6 && (await opens('loader.ts', 19, 23, 'src/loader.ts')), JSON.stringify(props().view))
}
console.log(`\n${fails} failing check(s)`)
