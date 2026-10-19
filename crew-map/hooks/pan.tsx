// The map's hand, drawn over the map picture on the desktop: click to open what is under the
// pointer, rest on something to see what it is. The map does not move under a drag (the arrow
// buttons move it). It draws nothing itself; it tells the hooks module where the pointer is.

type View = { x: number; y: number; k: number }
type Props = {
  /** One text cell in CSS pixels, to turn pointer cells into pixels. */
  cw: number
  ch: number
  /** The window's size in pixels. */
  vw: number
  vh: number
  /** Where the hooks module last put the window, and its stamp. */
  view: View
  rev: string
}
type Live = {
  props: Props
  press: null | { x: number; y: number; moved: boolean; ctrl: boolean }
  hover: [number, number] | null
}

/** How far the pointer may wander before a press stops counting as a click, in pixels. */
const SLOP = 4

const lives = new WeakMap<object, Live>()

const Pan = (props: Props, surface: any) => {
  const { Box } = surface.elements
  let live: Live | undefined = lives.get(surface) ?? surface.state
  if (!live) {
    const me: Live = { props, press: null, hover: null }
    live = me
    lives.set(surface, me)
    surface.setState(me)
    // The pointer in window pixels, as a share of the region: a surface may draw this region's cells
    // at another size than the pane's text rows, so cells are never multiplied by a guessed size.
    const px = (e: any): [number, number] => {
      const p = me.props
      const cols = surface.columns || p.vw / p.cw
      const rows = surface.rows || p.vh / p.ch
      return [((e.fine?.x ?? e.x + 0.5) / cols) * p.vw, ((e.fine?.y ?? e.y + 0.5) / rows) * p.vh]
    }
    // The window the pointer was measured against goes with every report, so a click lands on what was drawn;
    // and how coarse the pointer is here (one cell, in window pixels), so a small file near it still counts.
    const send = (extra: Record<string, unknown> = {}) => {
      const p = me.props
      const cell = [+(p.vw / (surface.columns || p.vw / p.cw)).toFixed(2), +(p.vh / (surface.rows || p.vh / p.ch)).toFixed(2)]
      surface.post({ view: p.view, rev: p.rev, hover: me.hover, cell, ...extra })
    }
    surface.onPointer((e: any) => {
      const [x, y] = px(e)
      // A press counts unless it names another button: a surface may not say which one went down.
      if (e.type === 'down' && (e.button === undefined || e.button === 'left')) {
        me.press = { x, y, moved: false, ctrl: e.ctrl === true }
        return
      }
      if (e.type === 'move' && me.press) {
        if (Math.hypot(x - me.press.x, y - me.press.y) >= SLOP) me.press.moved = true
        return
      }
      if (e.type === 'up' && me.press) {
        const p = me.press
        me.press = null
        if (!p.moved) send({ click: [x, y], ctrl: p.ctrl || e.ctrl === true })
        return
      }
      if (e.type === 'move' || e.type === 'enter') {
        me.hover = [x, y]
        send()
        return
      }
      if (e.type === 'leave') {
        me.press = null
        me.hover = null
        send()
      }
    })
    // The keyboard, once a click gave the map the focus: + and − zoom, 0 shows all of it.
    surface.onKey((e: any) => {
      if (e.key === '+' || e.key === '=') send({ zoom: 1.25 })
      else if (e.key === '-' || e.key === '_') send({ zoom: 0.8 })
      else if (e.key === '0') send({ fit: true })
    })
  }
  live.props = props
  return <Box width="100%" height="100%" />
}

export default Pan
