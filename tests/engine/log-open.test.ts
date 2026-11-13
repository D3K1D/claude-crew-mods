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
const textOf = (x: unknown): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : ((x as El)?.children ?? []).map(textOf).join(''))
/** The viewer's rows (the Box keyed "view"), each as its words. */
const rowsOf = (tree: unknown) => {
  const view = walk(tree).find(e => e.type === 'Box' && e.props?.key === 'view')
  return walk(view).filter(e => e.type === 'Box' && e.props?.height === 1).map(r => textOf(r).replace(/\s+/g, ' ').trim()).filter(Boolean)
}
/** The key of the last Button that says `label` (the newest line's). */
const keyOf = (tree: unknown, label: string) => walk(tree).filter(e => e.type === 'Button' && textOf(e).trim() === label).map(e => String(e.props?.key)).at(-1)

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
    const opener = keyOf(await ui.drawn(), '›')
    expect(!!opener, `${cols}: the message has a ›`).toBe(true)
    await ui.press({ key: opener! })
    const opened = rowsOf(await ui.drawn())
    const words = opened.join(' ').replace(/\s+/g, ' ')
    expect(MSG.split(' ').every(w => words.includes(w)) && words.includes('point 8 is that'), `${cols}: opened, every word of it shows: ${opened.join(' / ').slice(0, 900)}`).toBe(true)
    expect(opened.length <= 60, `${cols}: within the pane's rows`).toBe(true)
    // Live: Claude keeps working while it's open, new lines coming in. It stays whole and in place.
    for (const f of ['e', 'f', 'g']) await $.tool.call({ tool: 'Read', tool_use_id: `r-${cols}-${f}`, file_path: `C:/work/game/src/${f}-${cols}.ts` } as never)
    expect(rowsOf(await ui.drawn()).join('\n') === opened.join('\n'), `${cols}: live, the log holds still while it's open`).toBe(true)
    const folder = keyOf(await ui.drawn(), '▾')
    expect(!!folder, `${cols}: opened, its mark is ▾`).toBe(true)
    await ui.press({ key: folder! })
    expect(!rowsOf(await ui.drawn()).some(r => r.includes('▾')), `${cols}: folded again`).toBe(true)
    await ui.unmount()
  }
})
