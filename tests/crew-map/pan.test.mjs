// The desktop map's hand on a fake surface: a press that does not move is a click, a press that
// moves is nothing (the map does not move under a drag; the arrows move it), resting the
// pointer reports where it is, and + − 0 ask for zooms. Every report carries the window it was
// measured against.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
const { default: Pan } = await import('../.build/crew-map-pan.mjs')
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

const posts = []
let onPointer = null
let onKey = null
let ticks = 0
const surface = {
  elements: { Box: props => ({ type: 'Box', props }) },
  state: undefined,
  setState(s) { this.state = s },
  columns: 100,
  rows: 30,
  every: () => { ticks++; return () => {} },
  onPointer: fn => { onPointer = fn; return () => {} },
  onKey: fn => { onKey = fn; return () => {} },
  post: d => posts.push(d),
}
const base = { cw: 8, ch: 20, vw: 800, vh: 600, view: { x: 0, y: 0, k: 1 }, rev: 'fit:a' }
const tree = Pan(base, surface)
check('it fills its region and draws nothing', tree.type === 'Box' && tree.props.width === '100%' && tree.props.height === '100%')
check('it listens to the pointer and runs no frame clock (nothing glides)', typeof onPointer === 'function' && ticks === 0)
const onP = onPointer
Pan(base, surface)
check('a redraw adds no second listener', onPointer === onP)

// A press that does not move: a click at that spot, in window pixels.
onPointer({ type: 'down', button: 'left', x: 10, y: 5 })
onPointer({ type: 'move', button: 'left', x: 10, y: 5, fine: { x: 10.2, y: 5.6 } })
onPointer({ type: 'up', button: 'left', x: 10, y: 5 })
const click = posts.at(-1)
// Pixels are the pointer's share of the region times the window's size (here 10.5 of 100 columns of 800 px).
check('a press without a move is a click', Array.isArray(click.click) && Math.abs(click.click[0] - 84) < 1e-6 && Math.abs(click.click[1] - 110) < 1e-6, JSON.stringify(click))
check('...measured against the window as drawn', click.view.x === 0 && click.view.k === 1 && click.rev === 'fit:a')

// A press that moves: no click, and the window stays where it is.
posts.length = 0
onPointer({ type: 'down', button: 'left', x: 10, y: 5 })
onPointer({ type: 'move', button: 'left', x: 40, y: 12 })
onPointer({ type: 'up', button: 'left', x: 40, y: 12 })
check('a drag is not a click', !posts.some(p => p.click))
check('...and moves nothing', posts.every(p => p.view.x === 0 && p.view.y === 0 && p.view.k === 1))

// Resting the pointer: its place, for the outline and tip; leaving clears it.
onPointer({ type: 'move', x: 20, y: 10 })
check('hovering reports the pointer', posts.at(-1).hover[0] === 164 && posts.at(-1).hover[1] === 210, JSON.stringify(posts.at(-1).hover))
onPointer({ type: 'leave', x: -1, y: -1 })
check('leaving the map clears the hover', posts.at(-1).hover === null)

// The window the hooks module drew last is the one reports are measured against.
Pan({ ...base, view: { x: 300, y: 100, k: 2 }, rev: 'm7' }, surface)
onPointer({ type: 'down', x: 20, y: 10 })
onPointer({ type: 'up', x: 20, y: 10 })
check('a click after the window moved is measured against the new window', posts.at(-1).view.x === 300 && posts.at(-1).view.k === 2 && posts.at(-1).rev === 'm7')
check('a press with no button named still clicks', Array.isArray(posts.at(-1).click))

// The keyboard: + and − ask for a zoom, 0 for the whole map; arrows do nothing now.
check('it listens for keys', typeof onKey === 'function')
const nKeys = posts.length
onKey({ key: 'right' })
onKey({ key: 'down', shift: true })
check('arrows do not move the map', posts.length === nKeys)
onKey({ key: '+' })
check('+ asks for a zoom in', posts.at(-1).zoom === 1.25)
onKey({ key: '-' })
check('− asks for a zoom out', posts.at(-1).zoom === 0.8)
onKey({ key: '0' })
check('0 asks for the whole map', posts.at(-1).fit === true)

const beforeRight = posts.length
onPointer({ type: 'down', button: 'right', x: 20, y: 10 })
onPointer({ type: 'up', button: 'right', x: 20, y: 10 })
check('a right press does nothing', posts.length === beforeRight)
check('every post is plain data', posts.every(p => JSON.stringify(JSON.parse(JSON.stringify(p))) === JSON.stringify(p) && !/NaN|Infinity/.test(JSON.stringify(p))))
console.log(`\n${fails} failing check(s)`)
