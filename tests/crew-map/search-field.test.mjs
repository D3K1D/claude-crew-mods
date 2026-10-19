// The search field drawn on the surface: just a line of text (no Enter button), a click gives it the
// keyboard, every letter typed is sent at once, Backspace and Delete edit, Enter asks for the next
// match, and a search cleared elsewhere clears the field.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
const { default: Search } = await import('../.build/crew-map-search.mjs')
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const text = x => (typeof x === 'string' ? x : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }

const posts = []
let onPointer = null
let onKey = null
const el = name => props => ({ type: name, props })
const surface = {
  elements: { Box: el('Box'), Text: el('Text') },
  state: undefined,
  setState(s) { this.state = s },
  columns: 22,
  rows: 1,
  every: () => () => {},
  onPointer: fn => { onPointer = fn; return () => {} },
  onKey: fn => { onKey = fn; return () => {} },
  post: d => posts.push(d),
}
let tree = Search({ q: '' }, surface)
check('empty, it shows the placeholder', text(tree) === 'Search files...')
check('it is text only: no Button, no Input', !find(tree, x => x.type === 'Button' || x.type === 'Input').length)
check('the placeholder is a readable grey', find(tree, x => x.type === 'Text')[0].props.color === '#8B949E')
onPointer({ type: 'down', button: 'left', x: 3, y: 0 })
tree = Search({ q: '' }, surface)
check('a click gives it the caret', text(tree).endsWith('▏'))
for (const k of ['l', 'i', 'b']) onKey({ key: k })
check('each letter is sent as it is typed', posts.map(p => p.q).join(',') === 'l,li,lib', JSON.stringify(posts))
tree = Search({ q: 'li' }, surface)
check('it shows what was typed', text(tree).startsWith('lib'), text(tree))
onKey({ key: 'backspace' })
check('Backspace removes a letter', posts.at(-1).q === 'li')
onKey({ key: 'return' })
check('Enter asks for the next match', posts.at(-1).next === true && posts.at(-1).q === 'li')
onKey({ key: 'c', ctrl: true })
check('Ctrl+letter types nothing', posts.at(-1).next === true)
onKey({ key: 'delete' })
check('Delete clears it', posts.at(-1).q === '')
for (let i = 0; i < 100; i++) onKey({ key: 'x' })
check('it holds at most 80 characters', posts.at(-1).q.length === 80)
// Cleared elsewhere (the hooks module's search went back to empty): the field follows.
Search({ q: 'x'.repeat(80) }, surface)
tree = Search({ q: '' }, surface)
check('a search cleared elsewhere clears the field', text(tree).startsWith('Search files...'), text(tree))
check('every post is plain data', posts.every(p => JSON.stringify(JSON.parse(JSON.stringify(p))) === JSON.stringify(p)))
console.log(`\n${fails} failing check(s)`)
