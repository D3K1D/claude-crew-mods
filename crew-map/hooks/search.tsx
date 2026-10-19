// The map's search field, drawn here on the surface so it is just a field: no Enter button beside
// it. A click gives it the keyboard (Escape gives it back); each letter typed searches at once.

type Props = {
  /** The search as the hooks module last had it; a different one (cleared elsewhere) replaces the typed text. */
  q: string
}
/** `sent`: what this field posted that has not come back yet, oldest first. */
type Live = { q: string; seen: string; focused: boolean; sent: string[] }

const MAX = 80
const lives = new WeakMap<object, Live>()

const Search = (props: Props, surface: any) => {
  const { Box, Text } = surface.elements
  let live: Live | undefined = lives.get(surface) ?? surface.state
  if (!live) {
    const me: Live = { q: props.q, seen: props.q, focused: false, sent: [] }
    live = me
    lives.set(surface, me)
    surface.setState({ ...me })
    const change = (q: string) => {
      me.q = q.slice(0, MAX)
      me.sent = [...me.sent.slice(-99), me.q]
      surface.post({ q: me.q })
      surface.setState({ ...me })
    }
    surface.onPointer((e: any) => {
      if (e.type === 'down' && !me.focused) {
        me.focused = true
        surface.setState({ ...me })
      }
    })
    surface.onKey((e: any) => {
      if (!me.focused) {
        me.focused = true
        surface.setState({ ...me })
      }
      if (e.ctrl || e.meta) return
      if (e.key === 'backspace') change(me.q.slice(0, -1))
      else if (e.key === 'delete') change('')
      else if (e.key === 'return') surface.post({ q: me.q, next: true })
      else if (e.key.length === 1) change(me.q + e.key)
    })
  }
  // The hooks module's search comes back a frame or more behind the typing: one this field sent is its
  // own echo (and everything sent before it is stale), so only a search changed elsewhere replaces the text.
  if (props.q !== live.seen) {
    live.seen = props.q
    const echo = live.sent.indexOf(props.q)
    if (echo >= 0) live.sent = live.sent.slice(echo + 1)
    else {
      live.q = props.q
      live.sent = []
    }
  }
  const q = live.q
  // One line: the text typed (or the placeholder), and a caret once it has the keyboard.
  return (
    <Box width={surface.columns || undefined} flexDirection="row">
      <Text color={q ? '#E6EDF3' : '#8B949E'} wrap="truncate">
        {q || 'Search files...'}
      </Text>
      {live.focused ? <Text color="#79C0FF">{'▏'}</Text> : null}
    </Box>
  )
}

export default Search
