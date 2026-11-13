// Opening a cut-off message in the log, as Claude Code's own engine draws it and its hit module takes
// the click: the whole message shows, every word, held still as new lines come in; ▾ folds it again.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60, contentRows: 120 }, view: {} },
  }) as never

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const walk = (x: unknown, out: El[] = []) => {
  if (!x || typeof x !== 'object') return out
  out.push(x as El)
  for (const k of (x as El).children ?? []) walk(k, out)
  return out
}
const pictures = (tree: unknown) => walk(tree).filter(e => e.type === 'Svg').map(e => ({ source: String(e.props?.source ?? ''), height: Number(e.props?.height ?? 0), width: Number(e.props?.width ?? 0) }))
/** The viewer's rows: the words on each baseline, left to right. */
const rowsOf = (src: string) => {
  const by = new Map<number, { x: number; t: string }[]>()
  for (const m of src.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
    const y = Math.round(Number(m[2]) / 19)
    by.set(y, [...(by.get(y) ?? []), { x: Number(m[1]), t: m[3].replace(/&amp;/g, '&') }])
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, gs]) => gs.sort((a, b) => a.x - b.x).map(g => g.t).join(' '))
}
const spotOf = (src: string, word: string) => {
  const m = [...src.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].find(x => x[3] === word)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined
}

const MSG = Array.from({ length: 8 }, (_, i) => `point ${i + 1} is that the inventory panel should keep its size when items come and go`).join('; ')

test('a long message opens whole in the log, and folds again', async ($, on) => {
  mock.clock(on, { now: Date.parse('2031-01-01T10:00:00Z') })
  mock.store(on, { intro: 'off' })
  mock.env(on, { OS: 'Windows_NT' })
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  on('turn.start', async () => ({ turnId: 'T' }) as never)
  on('session.start', async () => ({ cwd: 'C:/work/game' }) as never)
  on('command.register', async () => ({ value: true }) as never)
  on('session.cwd', async () => ({ value: 'C:/work/game' }) as never)
  on('ui.open', async () => ({ value: true }) as never)
  on('ui.toast', async () => ({ value: true }) as never)
  await $.session.start({ source: 'startup', cwd: 'C:/work/game' } as never)
  await $.turn.start({ text: MSG, turnId: 'T' } as never)
  for (const f of ['a', 'b']) await $.tool.call({ tool: 'Read', tool_use_id: `r-${f}`, file_path: `C:/work/game/src/${f}.ts` } as never)

  for (const cols of [87, 140]) {
    const ui = await $.ui.mount({ plugin: 'crew-map', surface: 'desktop', ...PANE(cols) })
    const vwCols = cols - 1
    const click = async (pic: { width: number; height: number }, x: number, y: number) => {
      await ui.resize({ columns: vwCols, rows: pic.height / 19, in: 'hit-view' })
      const c = { x: Math.floor((x / pic.width) * vwCols), y: Math.floor(y / 19) }
      await ui.pointer({ type: 'down', x: c.x, y: c.y, button: 'left', in: 'hit-view' } as never)
      await ui.pointer({ type: 'up', x: c.x, y: c.y, button: 'left', in: 'hit-view' } as never)
    }
    let view = pictures(await ui.drawn())[1]
    const opener = spotOf(view.source, '›')
    expect(!!opener, `${cols}: the message has a ›`).toBe(true)
    await click(view, opener!.x + 3, opener!.y - 4)
    view = pictures(await ui.drawn())[1]
    const opened = rowsOf(view.source)
    const words = opened.join(' ').replace(/\s+/g, ' ')
    expect(MSG.split(' ').every(w => words.includes(w)) && words.includes('point 8 is that'), `${cols}: opened, every word of it shows: ${opened.join(' / ').slice(0, 900)}`).toBe(true)
    expect(opened.length <= 12, `${cols}: within the viewer's 12 rows`).toBe(true)
    // Live: Claude keeps working while it's open, new lines coming in. It stays whole and in place.
    for (const f of ['e', 'f', 'g']) await $.tool.call({ tool: 'Read', tool_use_id: `r-${cols}-${f}`, file_path: `C:/work/game/src/${f}-${cols}.ts` } as never)
    view = pictures(await ui.drawn())[1]
    expect(rowsOf(view.source).join('\n') === opened.join('\n'), `${cols}: live, the log holds still while it's open`).toBe(true)
    const folder = spotOf(view.source, '▾')
    expect(!!folder, `${cols}: opened, its mark is ▾`).toBe(true)
    await click(view, folder!.x + 3, folder!.y - 4)
    view = pictures(await ui.drawn())[1]
    expect(!rowsOf(view.source).some(r => r.includes('▾')), `${cols}: folded again`).toBe(true)
    await ui.unmount()
  }
})
