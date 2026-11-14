// Reading the pane as the person sees it: the words its pictures draw and its text, and pressing its
// Buttons by what they say (or by the names older tests gave them: "Scout: Details", "Settings"...).
export const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
export const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
export const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of kids(x)) find(c, pred, out)
  return out
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
/** The colour roles of the pane's text, by colour. */
const ROLE_OF = { '#E6EDF3': 'text', '#8B949E': 'dim', '#6E7681': 'faint', '#E3B341': 'amber', '#3FB950': 'green', '#F85149': 'red', '#D97757': 'brand', text: 'text', inactive: 'dim', subtle: 'faint', warning: 'amber', success: 'green', error: 'red', claude: 'brand' }
/** The viewer: the Box keyed "view", and its height in rows. */
export const viewHeight = t => viewOf(t)?.props?.height
const viewOf = t => find(t, x => x.type === 'Box' && x.props?.key === 'view')[0]
const inView = t => {
  const v = viewOf(t)
  const set = new Set()
  if (v) find(v, () => true).forEach(x => set.add(x))
  return set
}
/** The pictures that are pieces of a one-row line (read with their row, not as bands of their own). */
const rowPics = t => new Set(find(t, x => x.type === 'Box' && x.props?.height === 1).flatMap(r => find(r, y => y.type === 'Svg')))
export const pics = t => {
  const inRows = rowPics(t)
  return find(t, x => x.type === 'Svg' && !inRows.has(x)).map(x => x.props)
}
/** The words a picture draws, in order: place, size, colour role, bold, set by its end. */
const wordsIn = src =>
  [...src.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)" class="f-(\w+)"([^>]*)>([^<]*)<\/text>/g)].map(m => ({
    x: +m[1], y: +m[2], size: +m[3], role: m[4], bold: m[5].includes('700'), end: m[5].includes('end'), t: unxml(m[6]),
  }))
/** The words drawn in the pictures (with place and colour role, each picture placed under the last), and the text. */
const svgGlyphs = t => {
  let off = 0
  return pics(t).flatMap(p => {
    const out = wordsIn(p.source).map(g => ({ ...g, y: g.y + off }))
    off += Number(p.height) || 0
    return out
  })
}
/** The text the pane draws as Text, row by row: each row Box of one line, its words in order. */
const textRows = (root, skip = new Set()) => {
  const rows = find(root, x => x.type === 'Box' && x.props?.height === 1 && !skip.has(x))
  // A lone mark (a coloured dot, an action's glyph) is not a word; the › and ▾ that open and fold a line are.
  // A row's words in order: its Text, and the words its pictures draw (a line's read-only runs are pictures).
  return rows.map(r =>
    find(r, x => x.type === 'Text' || x.type === 'Svg')
      .flatMap(x => (x.type === 'Svg' ? wordsIn(String(x.props.source)).map(g => ({ t: g.t.trim(), role: g.role, bold: g.bold })) : [{ t: text(x).trim(), role: ROLE_OF[x.props?.color] ?? 'text', bold: !!x.props?.bold }]))
      .filter(g => g.t && !/^[^\p{L}\p{N}›▾]$/u.test(g.t)),
  )
}
export const glyphs = (t, band) => {
  if (band === 'view') return textRows(viewOf(t) ?? {}).flat()
  const view = inView(t)
  const rest = textRows(t, view).flat()
  return band === 'top' ? [...svgGlyphs(t), ...rest] : [...svgGlyphs(t), ...rest, ...textRows(viewOf(t) ?? {}).flat()]
}
export const words = (t, band) => glyphs(t, band).map(g => g.t)
export const has = (t, s, band) => words(t, band).some(w => w.includes(s))
/** The words on each line: the pictures' by baseline, then the Text rows; the viewer's rows alone for 'view'. */
export const lines = (t, band) => {
  if (band === 'view') return textRows(viewOf(t) ?? {})
  const left = g => (g.end ? g.x - g.t.length * g.size * 0.6 : g.x)
  const out = []
  for (const g of svgGlyphs(t).sort((a, b) => a.y - b.y)) {
    const last = out.at(-1)
    if (last && g.y - last.y <= 5) last.gs.push(g)
    else out.push({ y: g.y, gs: [g] })
  }
  return out.map(l => l.gs.sort((a, b) => left(a) - left(b)))
}
/** What older tests called a target, as the Button now says it. */
const ALIAS = { Settings: '⚙', Search: '⌕', 'Scroll up': '▲ older', 'Scroll down': '▼ newer', 'Back to the latest': '⤓ latest', 'Show the whole line': '›', 'Fold the line': '▾' }
const buttonFor = (t, label) => {
  const buttons = find(t, x => x.type === 'Button')
  if (label instanceof RegExp) return buttons.find(b => label.test(text(b)))
  // A row's Details: the Button beside the picture of the row that names that Claude.
  const det = typeof label === 'string' && label.match(/^(.+): (Details|Shown below|Hide)$/)
  if (det) {
    const row = find(t, x => x.type === 'Box' && String(x.props?.key ?? '').startsWith('row-') && find(x, y => y.type === 'Svg' && String(y.props.alt).startsWith(`${det[1]}:`)).length)[0]
    return row ? find(row, x => x.type === 'Button')[0] : undefined
  }
  if (label === 'All files') return buttons.find(b => /^Files \d+$/.test(text(b)))
  const close = typeof label === 'string' && label.match(/^Close (.+)'s details$/)
  if (close) return buttons.find(b => text(b) === `${close[1]} ✕`)
  const want = ALIAS[label] ?? label
  // A file or folder by its name: past the mark before it (a dot for the Claude on it, a folder's glyph), before its counts.
  const bare = b => text(b).replace(/^[^\p{L}\p{N}.+−✕]\s/u, '')
  return buttons.find(b => text(b) === want) ?? buttons.find(b => bare(b) === want) ?? buttons.find(b => bare(b).startsWith(`${want} `))
}
/** Draws the pane and presses the Button `label` names (a RegExp: a match). Returns false when there is none. */
export const makePress = (elements, render, tick = () => new Promise(r => setTimeout(r, 5))) => async (label, ...args) => {
  const b = buttonFor(await render(...args), label)
  if (!b) return false
  await b.props.onPress({ surface: 'desktop' })
  await tick()
  return true
}
/** The labels of every Button the pane draws now. */
export const targets = async (elements, render, ...args) => find(await render(...args), x => x.type === 'Button').map(text)
