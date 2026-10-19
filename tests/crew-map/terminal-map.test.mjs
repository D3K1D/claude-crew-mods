// The terminal map (a Client module drawn in text cells): it draws, it animates while something
// moves, and it stops redrawing when nothing does.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
const { default: CrewMap } = await import('../.build/crew-map-terminal.mjs')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

const el = name => props => ({ type: name, props })
let tick
let sets = 0
const s = {
  elements: { Box: el('Box'), Text: el('Text') },
  columns: 80,
  rows: 12,
  state: undefined,
  every: (ms, fn) => { tick = fn },
  setState: v => { s.state = v; sets++ },
}
const nodes = [
  { id: 'C:/p/a.rs', label: 'a.rs', kind: 'file', x: 0.2, y: 0.3, heat: 2, count: 1, typing: false },
  { id: 'C:/p/b.rs', label: 'b.rs', kind: 'file', x: 0.7, y: 0.6, heat: 1, count: 0, typing: false },
  { id: '@browser', label: 'browser', kind: 'special', x: 0.9, y: 0.2, heat: 1, count: 0, typing: false },
]
const props = busy => ({ rows: 12, nodes, edges: [{ a: 'C:/p/a.rs', b: 'C:/p/b.rs', k: 'import' }], agents: [{ id: 'main', initial: 'C', color: '#D97757', node: 'C:/p/a.rs', busy }] })

CrewMap(props(true), s)
const drawn = text(CrewMap(props(true), s))
check('the terminal map draws its files', drawn.includes('a.rs') && drawn.includes('b.rs'), drawn.slice(0, 120))
check('a station of a new kind gets its mark', /[▤◍][\s ]browser/.test(drawn), drawn.match(/.{2}browser/)?.[0])
// Busy: the clock runs.
sets = 0
for (let i = 0; i < 5; i++) tick()
check('while a Claude is busy the map animates', sets === 5, String(sets))
// Idle, nothing moving: after the last movement settles, ticks stop redrawing.
CrewMap(props(false), s)
for (let i = 0; i < 40; i++) tick()
sets = 0
for (let i = 0; i < 20; i++) tick()
check('when nothing moves it stops redrawing', sets === 0, String(sets))
// A move starts it again.
CrewMap({ ...props(false), agents: [{ id: 'main', initial: 'C', color: '#D97757', node: 'C:/p/b.rs', busy: false }] }, s)
sets = 0
for (let i = 0; i < 3; i++) tick()
check('a Claude moving starts the clock again', sets === 3, String(sets))
// An agent that leaves takes its zip with it.
CrewMap({ ...props(false), agents: [] }, s)
check('zips of agents that left are dropped', Object.keys(s.state.zips).length === 0, JSON.stringify(Object.keys(s.state.zips)))
console.log(`\n${fails} failing check(s)`)
