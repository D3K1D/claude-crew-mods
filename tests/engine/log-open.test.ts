// Opening a cut-off message in the log, as Claude Code's own engine draws and presses it: the whole
// message shows, every word, and folding it brings the log back.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60, contentRows: 120 }, view: {} },
  }) as never

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const kidsOf = (x: unknown) => ((x && typeof x === 'object' ? (x as El).children : undefined) ?? []) as unknown[]
const textOf = (x: unknown): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : kidsOf(x).map(textOf).join(''))
const walk = (x: unknown, out: El[] = []) => {
  if (!x || typeof x !== 'object') return out
  out.push(x as El)
  for (const k of kidsOf(x)) walk(k, out)
  return out
}
/** The log box's rows, as text. */
const logRows = (tree: unknown) => {
  const box = walk(tree).find(e => e.type === 'Box' && e.props?.borderStyle && /^\s*log\b/.test(textOf(kidsOf(e)[0])))
  return box ? kidsOf(box).slice(1).map(textOf) : []
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
  // A few lines come in after it, so opened it no longer fits in the rows above them.
  for (const f of ['a', 'b', 'c', 'd']) await $.tool.call({ tool: 'Read', tool_use_id: `r-${f}`, file_path: `C:/work/game/src/${f}.ts` } as never)

  for (const cols of [87, 140]) {
    const ui = await $.ui.mount({ plugin: 'crew-map', surface: 'desktop', ...PANE(cols) })
    const folded = logRows(await ui.drawn())
    const opener = (await ui.findAll({ type: 'Button' } as never)).find(b => String((b as { key?: string }).key ?? '').startsWith('logopen:')) as { key: string } | undefined
    expect(!!opener, `${cols}: the message has a ›`).toBe(true)
    await ui.press({ key: opener!.key } as never)
    const opened = logRows(await ui.drawn())
    const words = opened.join(' ').replace(/\s+/g, ' ')
    expect(MSG.split(' ').every(w => words.includes(w)) && words.includes('point 8 is that'), `${cols}: opened, every word of it shows`).toBe(true)
    // Blank rows only as the log's padding above its first line, never in place of the message.
    const firstText = opened.findIndex(r => r.trim())
    expect(firstText >= 0 && opened.slice(firstText).filter(r => !r.trim()).length, `${cols}: opened, no blank rows where it was`).toBe(0)
    expect(/reading d\.ts/.test(opened.at(-1) ?? ''), `${cols}: the lines after it stay below it`).toBe(true)
    // Live: Claude keeps working while it's open, new lines coming in. It stays whole and in place.
    for (const f of ['e', 'f', 'g']) await $.tool.call({ tool: 'Read', tool_use_id: `r-${cols}-${f}`, file_path: `C:/work/game/src/${f}-${cols}.ts` } as never)
    const live = logRows(await ui.drawn())
    const liveWords = live.join(' ').replace(/\s+/g, ' ')
    expect(MSG.split(' ').every(w => liveWords.includes(w)) && liveWords.includes('point 8 is that'), `${cols}: live, still whole as new lines come in`).toBe(true)
    expect(live.join('\n') === opened.join('\n'), `${cols}: live, the log holds still while it's open`).toBe(true)
    await ui.press({ key: opener!.key } as never)
    expect(logRows(await ui.drawn()).length, `${cols}: folded again, the log is its 12 rows`).toBe(12)
    await ui.unmount()
  }
})
