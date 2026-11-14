// Reading the pane as the person sees it: its text, row by row, and pressing its Buttons by what they
// say (or by the names older tests gave them: "Scout: Details", "Settings"...).
export const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
export const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
export const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of kids(x)) find(c, pred, out)
  return out
}
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
/** The text the pane draws, row by row: each row Box of one line, its words in order. */
const textRows = (root, skip = new Set()) => {
  const rows = find(root, x => x.type === 'Box' && x.props?.height === 1 && !skip.has(x))
  // A lone mark (a coloured dot, an action's glyph) is not a word; one pressed (the › and ▾ that open and fold a line) is.
  return rows.map(r => {
    const pressed = new Set(find(r, x => x.type === 'Button').flatMap(b => find(b, y => y.type === 'Text')))
    return find(r, x => x.type === 'Text')
      .map(x => ({ t: text(x).trim(), role: ROLE_OF[x.props?.color] ?? 'text', bold: !!x.props?.bold, pressed: pressed.has(x) }))
      .filter(g => g.t && (g.pressed || !/^[^\p{L}\p{N}]$/u.test(g.t)))
  })
}
export const glyphs = (t, band) => {
  if (band === 'view') return textRows(viewOf(t) ?? {}).flat()
  const rest = textRows(t, inView(t)).flat()
  return band === 'top' ? rest : [...rest, ...textRows(viewOf(t) ?? {}).flat()]
}
export const words = (t, band) => glyphs(t, band).map(g => g.t)
export const has = (t, s, band) => words(t, band).some(w => w.includes(s))
/** The words on each line: the rows above the viewer, or the viewer's rows alone for 'view'. */
export const lines = (t, band) => (band === 'view' ? textRows(viewOf(t) ?? {}) : textRows(t, inView(t)))
/** A row's name: the first words of the row Box (past its mark and indent). */
const nameOf = b => text(find(b, y => y.type === 'Text' && !/^[^\p{L}\p{N}]*$/u.test(text(y).trim()))[0] ?? '').trim()
export const rowBox = (t, name) => find(t, x => x.type === 'Box' && String(x.props?.key ?? '').startsWith('row-') && nameOf(x) === name)[0]
/** What older tests called a target, as the Button now says it. */
const ALIAS = { Settings: '⚙', Search: '⌕', 'Scroll up': '▲ older', 'Scroll down': '▼ newer', 'Back to the latest': '⤓ latest', 'Show the whole line': '›', 'Fold the line': '▾' }
const buttonFor = (t, label) => {
  const buttons = find(t, x => x.type === 'Button')
  if (label instanceof RegExp) return buttons.find(b => label.test(text(b)))
  // A row's Details: the Button in the row that names that Claude.
  const det = typeof label === 'string' && label.match(/^(.+): (Details|Shown below|Hide)$/)
  if (det) {
    const row = rowBox(t, det[1])
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
/** How far a Claude's row is in from the pane's edge, in columns (the spaces its first line starts with). */
export const indentOf = (t, name) => {
  const first = find(rowBox(t, name) ?? {}, x => x.type === 'Box' && x.props?.height === 1)[0]
  const lead = first ? text(find(first, x => x.type === 'Text')[0] ?? '') : ''
  return first ? (/^ +$/.test(lead) ? lead.length : 0) : -1
}
/** The words of a Claude's row, line by line in order (its glyphs: word, colour role, bold). */
export const rowGlyphs = (t, name) => {
  const r = rowBox(t, name)
  return r ? textRows(r).flat() : []
}
/** The names of the rows the crew shows, top to bottom. */
export const rowNames = t => find(t, x => x.type === 'Box' && String(x.props?.key ?? '').startsWith('row-')).map(nameOf)
