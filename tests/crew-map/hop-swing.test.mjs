// A hop up or down its own column (a file right under another, files between): it swings out to the
// side, clear of the files between, and comes down onto the top of the file it goes to. Going down it
// swings to the right, going up to the left. A hop across keeps its low arc.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2031-01-01T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'Look around', turnId: 'T' }, async () => ({}))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const svgNow = async () => find(await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 115, scroll: { bodyRows: 60 } }, viewport: { columns: 115 } }), x => x.type === 'Svg')[0].props.source
let n = 0
const read = (f, during) => hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${n++}`, file_path: `${P}/${f}` }, async () => { if (during) await during(); return { text: 'ok' } })

// A folder of many files wraps into rows: files in one column sit under each other.
const names = Array.from({ length: 16 }, (_, i) => `src/f${String(i).padStart(2, '0')}.ts`)
for (const f of names) { await read(f); now += 2000 }
now += 10_000
const svg = await svgNow()
const at = label => { const i = svg.indexOf(`>${label}</text>`); const g = svg.lastIndexOf('<g transform="translate(', i); return svg.slice(g + 24, svg.indexOf(')', g)).split(',').map(Number) }
const spots = names.map(f => [f, at(f.slice(4))])
// Two files in the same column with at least one file between them.
const pair = (() => {
  for (const [fa, [xa, ya]] of spots)
    for (const [fb, [xb, yb]] of spots) if (Math.abs(xa - xb) < 1 && yb > ya + 1) {
      const between = spots.some(([, [x, y]]) => Math.abs(x - xa) < 1 && y > ya + 1 && y < yb - 1)
      if (between) return { top: fa, bottom: fb, x: xa, ya, yb }
    }
})()
check('the test has two files in one column with one between', !!pair, JSON.stringify(spots.slice(0, 6)))

/** The hop drawn mid-flight from one file to another: its path's points. */
const hop = async (from, to) => {
  await read(from)
  now += 10_000
  let path
  await read(to, async () => {
    now += 150
    const src = await svgNow()
    path = src.match(/<animateMotion path="M(-?[\d.]+) (-?[\d.]+)C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/)?.slice(1).map(Number)
  })
  now += 10_000
  return path
}
const bez = (p, t) => {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p
  const u = 1 - t
  return [u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]
}
const samples = p => Array.from({ length: 41 }, (_, i) => bez(p, i / 40))

if (pair) {
  // A hop's path is drawn relative to the seat it lands on (0, 0), above the file it goes to: the
  // column's middle is x 0, and a file's icon (46 tall) starts about 18 below its seat.
  const mid = 0
  const between = spots.filter(([, [x, y]]) => Math.abs(x - pair.x) < 1 && y > pair.ya + 1 && y < pair.yb - 1).map(([, [, y]]) => y)
  const clearOf = (p, to) => samples(p).every(([x, y]) => !between.some(by => y > by - to + 10 && y < by - to + 70) || Math.abs(x - mid) > 30)

  const down = await hop(pair.top, pair.bottom)
  check('a hop down the column is drawn', !!down, String(down))
  if (down) {
    check('going down, it swings out to the right', Math.max(...samples(down).map(([x]) => x)) > mid + 40 && Math.min(...samples(down).map(([x]) => x)) > mid - 8, JSON.stringify(down))
    check('...clear of the files between', clearOf(down, pair.yb))
    check('...not out as far as the next column', Math.max(...samples(down).map(([x]) => x)) < mid + 100)
    check('...and comes down onto the top of the file it goes to', down[7] === 0 && down[5] < down[7], JSON.stringify(down))
  }
  const up = await hop(pair.bottom, pair.top)
  check('a hop up the column is drawn', !!up, String(up))
  if (up) {
    check('going up, it swings out to the left', Math.min(...samples(up).map(([x]) => x)) < mid - 40 && Math.max(...samples(up).map(([x]) => x)) < mid + 8, JSON.stringify(up))
    check('...clear of the files between', clearOf(up, pair.ya))
    check('...rises over the file it goes to, then comes down onto it', Math.min(...samples(up).map(([, y]) => y)) < up[7] - 10 && up[5] < up[7], JSON.stringify(up))
  }
  // A hop across keeps its low arc (no swing to the side).
  const other = spots.find(([, [x, y]]) => Math.abs(y - pair.ya) < 1 && Math.abs(x - pair.x) > 100)
  if (other) {
    const across = await hop(pair.top, other[0])
    check('a hop across keeps a low arc over its higher end', !!across && Math.min(across[3], across[5]) >= Math.min(across[1], across[7]) - 60, JSON.stringify(across))
  }
}
console.log(`\n${fails} failing check(s)`)
