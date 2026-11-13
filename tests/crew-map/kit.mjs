// Reading the pane as the person sees it: the words its pictures draw, in order, and pressing what is
// drawn by its label (each picture's targets, drawn as plain buttons when no hit module runs).
export const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
export const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
export const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of kids(x)) find(c, pred, out)
  return out
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
/** Each picture's words, in drawing order; `band` picks the top one ('top') or the viewer ('view'). */
export const pics = t => find(t, x => x.type === 'Svg').map(x => x.props)
export const words = (t, band) => {
  const ps = pics(t)
  const list = band === 'top' ? ps.slice(0, 1) : band === 'view' ? ps.slice(-1) : ps
  return list.flatMap(p => [...p.source.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => unxml(m[1])))
}
/** The words drawn with their place and colour role: { t, x, y, role, bold, end }. */
export const glyphs = (t, band) => {
  const ps = pics(t)
  const list = band === 'top' ? ps.slice(0, 1) : band === 'view' ? ps.slice(-1) : ps
  return list.flatMap(p =>
    [...p.source.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)" class="f-(\w+)"([^>]*)>([^<]*)<\/text>/g)].map(m => ({
      x: +m[1], y: +m[2], size: +m[3], role: m[4], bold: m[5].includes('700'), end: m[5].includes('end'), t: unxml(m[6]),
    })),
  )
}
export const has = (t, s, band) => words(t, band).some(w => w.includes(s))
/** The words drawn on each line (within a few pixels of one baseline), left to right; text set by its right end sorts by its left. */
export const lines = (t, band) => {
  const left = g => (g.end ? g.x - g.t.length * g.size * 0.6 : g.x)
  const out = []
  for (const g of glyphs(t, band).sort((a, b) => a.y - b.y)) {
    const last = out.at(-1)
    if (last && g.y - last.y <= 5) last.gs.push(g)
    else out.push({ y: g.y, gs: [g] })
  }
  return out.map(l => l.gs.sort((a, b) => left(a) - left(b)))
}
/**
 * Draws the pane once without a hit module, so its targets are buttons, and presses the one labelled
 * `label` (a string: its whole label; a RegExp: a match). Returns false when there is none.
 */
export const makePress = (elements, render, tick = () => new Promise(r => setTimeout(r, 5))) => async (label, ...args) => {
  const saved = elements.Client
  elements.Client = undefined
  let t
  try {
    t = await render(...args)
  } finally {
    elements.Client = saved
  }
  const b = find(t, x => x.type === 'Button' && (label instanceof RegExp ? label.test(text(x)) : text(x) === label))[0]
  if (!b) return false
  await b.props.onPress({ surface: 'desktop' })
  await tick()
  return true
}
/** The labels of every target the pane draws now. */
export const targets = async (elements, render, ...args) => {
  const saved = elements.Client
  elements.Client = undefined
  try {
    return find(await render(...args), x => x.type === 'Button').map(text)
  } finally {
    elements.Client = saved
  }
}
