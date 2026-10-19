// The mind map: a character-cell graph of the files the crew touches, drawn
// and animated here on the surface so updates never reload anything.

type MapNodeProp = {
  id: string
  label: string
  kind: 'file' | 'ghost' | 'special'
  x: number
  y: number
  heat: number
  color?: string
  count: number
  typing: boolean
}
type MapEdgeProp = { a: string; b: string; k: 'import' | 'trail' }
type MapAgentProp = { id: string; initial: string; color: string; node: string; next?: string; busy: boolean }
type MapProps = { nodes: MapNodeProp[]; edges: MapEdgeProp[]; agents: MapAgentProp[]; rows: number }

type Zip = { node: string; from: string; start: number }
type State = { t: number; zips: Record<string, Zip> }

type Cell = { ch: string; fg?: string; bold?: boolean; dim?: boolean }
type Placed = { id: string; x0: number; y: number; len: number; cx: number }

const TICK = 80
const ZIP_MS = 720
const NBSP = ' '
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const IMPORT = '#3B4C6B'
const TRAIL = '#4B5363'
const TEXT = '#C9D1D9'
const GHOST = '#6E7681'
const SPECIAL: Record<string, [string, string]> = {
  $terminal: ['$', '#FFA657'],
  '@web': ['◎', '#56D4DD'],
  '?search': ['⌕', '#E3B341'],
  '@browser': ['◍', '#56D4DD'],
  '@computer': ['▣', '#FFA657'],
  '@remote': ['▣', '#79C0FF'],
  '@docs': ['▤', '#E3B341'],
  '@claude': ['✻', '#D97757'],
}
/** Any other station (an MCP app such as Blender): a plain tile mark. */
const STATION: [string, string] = ['▤', '#D2A8FF']

const LINES = '─│╭╮╰╯┼'
const isLine = (ch: string) => LINES.includes(ch)

/** The map clock runs only while something moves: a busy Claude spins, a zip is under way. */
let liveUntil = 0

export default function CrewMap(p: MapProps, s: any) {
  const { Box, Text } = s.elements
  const st = s.state as State | undefined
  if (!st) {
    s.every(TICK, () => {
      const cur = s.state as State
      // Nothing moving: no redraw (the next change of props draws, and starts the clock again).
      if (!cur || cur.t > liveUntil) return
      s.setState({ ...cur, t: cur.t + TICK })
    })
    s.setState({ t: 0, zips: {} })
    return <Text dimColor>{NBSP}</Text>
  }

  // Start a zip for every agent whose node changed since the last call.
  let changed = false
  const zips: Record<string, Zip> = { ...st.zips }
  for (const a of p.agents) {
    const z = zips[a.id]
    if (!z) {
      zips[a.id] = { node: a.node, from: a.node, start: -1e9 }
      changed = true
    } else if (z.node !== a.node) {
      zips[a.id] = { node: a.node, from: z.node, start: st.t }
      changed = true
    }
  }
  // Agents that left take their zips with them.
  for (const id of Object.keys(zips)) if (!p.agents.some(a => a.id === id)) { delete zips[id]; changed = true }
  if (changed) s.setState({ ...st, zips })
  liveUntil = Math.max(...Object.values(zips).map(z => z.start + ZIP_MS), p.agents.some(a => a.busy) ? st.t + 1000 : 0, changed ? st.t + TICK * 2 : 0)

  const cols = Math.max(30, s.columns || 80)
  const rows = Math.max(6, s.rows || p.rows)
  const t = st.t
  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: ' ' })))
  const put = (x: number, y: number, ch: string, fg?: string, more: Partial<Cell> = {}) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return
    const cur = grid[y][x]
    if (isLine(ch) && isLine(cur.ch) && cur.ch !== ch) {
      const vert = (c: string) => c === '│'
      const horiz = (c: string) => c === '─'
      if ((vert(ch) && horiz(cur.ch)) || (horiz(ch) && vert(cur.ch))) ch = '┼'
    }
    grid[y][x] = { ch, fg, ...more }
  }

  if (p.nodes.length === 0) {
    const msg = 'no files yet · the map grows as Claudes open files'
    const y = Math.floor(rows / 2)
    const x = Math.max(0, Math.floor((cols - msg.length) / 2))
    for (let i = 0; i < msg.length; i++) put(x + i, y, msg[i], GHOST)
  }

  // Place labels: most important first, nudged off each other.
  const labelOf = (n: MapNodeProp) => {
    const sp = SPECIAL[n.id] ?? (n.kind === 'special' ? STATION : undefined)
    const mark = sp ? sp[0] : n.kind === 'ghost' ? '○' : n.count > 1 ? '★' : n.count ? '◆' : '◇'
    return `${mark} ${n.label}`
  }
  const taken: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
  const placed = new Map<string, Placed>()
  const order = [...p.nodes].sort((a, b) => b.count - a.count || b.heat - a.heat)
  for (const n of order) {
    const text = labelOf(n).slice(0, cols - 2)
    const len = text.length
    const bx = Math.round(n.x * (cols - len - 2)) + 1
    const by = Math.round(n.y * (rows - 1))
    let best: { x0: number; y: number } | undefined
    search: for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      for (const dx of [0, -4, 4, -8, 8, -12, 12]) {
        const y = by + dy
        const x0 = Math.min(Math.max(1, bx + dx), cols - len - 1)
        if (y < 0 || y >= rows) continue
        let free = true
        for (let x = x0 - 1; x <= x0 + len; x++) if (taken[y][x]) free = false
        if (free) {
          best = { x0, y }
          break search
        }
      }
    }
    if (!best) continue
    for (let x = best.x0 - 1; x <= best.x0 + len; x++) if (x >= 0 && x < cols) taken[best.y][x] = true
    placed.set(n.id, { id: n.id, x0: best.x0, y: best.y, len, cx: best.x0 + Math.floor(len / 2) })
  }

  // An elbow route between two labels: along A's row, then down or up into B.
  const route = (aId: string, bId: string): [number, number, string][] => {
    const a = placed.get(aId)
    const b = placed.get(bId)
    if (!a || !b || a === b) return []
    const out: [number, number, string][] = []
    if (a.y === b.y) {
      const [l, r] = a.x0 < b.x0 ? [a, b] : [b, a]
      for (let x = l.x0 + l.len + 1; x < r.x0 - 1; x++) out.push([x, a.y, '─'])
      return a.x0 < b.x0 ? out : out.reverse()
    }
    const right = b.cx >= a.cx
    const down = b.y > a.y
    const sx = right ? a.x0 + a.len + 1 : a.x0 - 2
    if ((right && b.cx >= sx) || (!right && b.cx <= sx)) {
      for (let x = sx; right ? x < b.cx : x > b.cx; x += right ? 1 : -1) out.push([x, a.y, '─'])
      out.push([b.cx, a.y, right ? (down ? '╮' : '╯') : down ? '╭' : '╰'])
      for (let y = a.y + (down ? 1 : -1); down ? y < b.y : y > b.y; y += down ? 1 : -1) out.push([b.cx, y, '│'])
    } else {
      // B sits over A's label: leave from A's middle straight up or down.
      for (let y = a.y + (down ? 1 : -1); down ? y < b.y : y > b.y; y += down ? 1 : -1) out.push([a.cx, y, '│'])
    }
    return out
  }

  // Edges.
  const zipRoutes = new Map<string, [number, number, string][]>()
  const hot = new Map<string, string>()
  for (const a of p.agents) {
    const z = zips[a.id]
    if (z && z.from !== z.node && t - z.start < ZIP_MS + 600) hot.set([z.from, z.node].sort().join('|'), a.color)
  }
  for (const e of p.edges) {
    const color = hot.get([e.a, e.b].sort().join('|'))
    for (const [x, y, ch] of route(e.a, e.b)) {
      if (e.k === 'trail' && !color) put(x, y, '┄' === ch ? ch : ch === '─' ? '┄' : ch === '│' ? '┆' : ch, TRAIL)
      else put(x, y, ch, color ?? IMPORT, color ? { bold: true } : {})
    }
  }

  // Where each agent might head next: a faint dotted lead.
  for (const a of p.agents) {
    if (!a.next || !a.busy) continue
    const r = route(a.node, a.next)
    r.forEach(([x, y], i) => {
      if (i % 2 === 0 && !isLine(grid[y][x].ch)) put(x, y, '·', a.color, { dim: true })
    })
  }

  // Labels.
  for (const n of p.nodes) {
    const pl = placed.get(n.id)
    if (!pl) continue
    const text = labelOf(n).slice(0, pl.len)
    const sp = SPECIAL[n.id] ?? (n.kind === 'special' ? STATION : undefined)
    const fg = n.count > 1 ? '#E3B341' : n.color ?? (sp ? sp[1] : n.kind === 'ghost' ? GHOST : TEXT)
    for (let i = 0; i < text.length; i++)
      put(pl.x0 + i, pl.y, text[i], i === 0 && sp && !n.color ? sp[1] : fg, { bold: n.count > 0, dim: n.kind === 'ghost' })
    if (n.typing && (t / 400) % 2 < 1) put(pl.x0 + pl.len, pl.y, '▍', n.color ?? TEXT)
  }

  // Agents: parked over their node, or zipping along the route.
  const parked = new Map<string, number>()
  for (const a of p.agents) {
    const z = zips[a.id] ?? { node: a.node, from: a.node, start: -1e9 }
    const pl = placed.get(a.node)
    if (!pl) continue
    const glyph = a.busy ? SPIN[Math.floor(t / TICK) % SPIN.length] : '◌'
    const k = Math.min(1, (t - z.start) / ZIP_MS)
    if (k < 1 && z.from !== z.node && placed.has(z.from)) {
      const r = route(z.from, z.node)
      if (r.length) {
        const i = Math.floor(k * (r.length - 1))
        for (let j = Math.max(0, i - 4); j < i; j++) put(r[j][0], r[j][1], '•', a.color, { dim: j < i - 2 })
        put(r[i][0], r[i][1], a.initial, a.color, { bold: true })
        continue
      }
    }
    const slot = parked.get(a.node) ?? 0
    parked.set(a.node, slot + 1)
    const above = pl.y > 0 && !taken[pl.y - 1][pl.x0 + slot * 3]
    const y = above ? pl.y - 1 : Math.min(rows - 1, pl.y + 1)
    const x = pl.x0 + slot * 3
    put(x, y, glyph, a.color)
    put(x + 1, y, a.initial, a.color, { bold: true })
  }

  // Merge each row into runs of one style.
  return (
    <Box flexDirection="column">
      {grid.map(row => {
        const runs: { text: string; c: Cell }[] = []
        for (const c of row) {
          const last = runs[runs.length - 1]
          if (last && last.c.fg === c.fg && !!last.c.bold === !!c.bold && !!last.c.dim === !!c.dim) last.text += c.ch
          else runs.push({ text: c.ch, c })
        }
        return (
          <Box flexDirection="row">
            {runs.map(r => (
              <Text color={r.c.fg} bold={r.c.bold} dimColor={r.c.dim}>
                {r.text.replace(/ /g, NBSP)}
              </Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}
