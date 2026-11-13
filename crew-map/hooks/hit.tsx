// The pane's hand, drawn over each of its pictures on the desktop: a click tells the hooks module where it
// landed, in the picture's pixels, and the hooks module runs what is drawn there. It draws nothing itself.

type Props = {
  /** One text cell in CSS pixels, should the surface not say how many cells the region has. */
  cw: number
  ch: number
  /** The picture's size in pixels. */
  vw: number
  vh: number
}
type Live = { props: Props; press: null | { x: number; y: number; moved: boolean } }

/** How far the pointer may wander before a press stops counting as a click, in pixels. */
const SLOP = 4

const lives = new WeakMap<object, Live>()

const Hit = (props: Props, surface: any) => {
  const { Box } = surface.elements
  let live: Live | undefined = lives.get(surface) ?? surface.state
  if (!live) {
    const me: Live = { props, press: null }
    live = me
    lives.set(surface, me)
    surface.setState(me)
    // The pointer in picture pixels, as a share of the region: a surface may draw this region's cells at
    // another size than the pane's text rows, so cells are never multiplied by a guessed size.
    const px = (e: any): [number, number] => {
      const p = me.props
      const cols = surface.columns || p.vw / p.cw
      const rows = surface.rows || p.vh / p.ch
      return [((e.fine?.x ?? e.x + 0.5) / cols) * p.vw, ((e.fine?.y ?? e.y + 0.5) / rows) * p.vh]
    }
    surface.onPointer((e: any) => {
      const [x, y] = px(e)
      // A press counts unless it names another button: a surface may not say which one went down.
      if (e.type === 'down' && (e.button === undefined || e.button === 'left')) me.press = { x, y, moved: false }
      else if (e.type === 'move' && me.press) {
        if (Math.hypot(x - me.press.x, y - me.press.y) >= SLOP) me.press.moved = true
      } else if (e.type === 'up' && me.press) {
        const p = me.press
        me.press = null
        if (!p.moved) surface.post({ click: [x, y] })
      } else if (e.type === 'leave') me.press = null
    })
  }
  live.props = props
  return <Box width="100%" height="100%" />
}

export default Hit
