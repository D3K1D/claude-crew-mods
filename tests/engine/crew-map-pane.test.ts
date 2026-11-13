// The pane drawn by the engine itself (its own elements and rules), on the desktop and the terminal,
// empty and in a busy session: it draws every time, with no element the engine would refuse; and a
// click on a picture goes through the real hit module to what is drawn under it.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 80 }, view: {} },
  }) as never

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
/** Every element of a drawing. */
const walk = (x: unknown, out: El[] = []) => {
  if (!x || typeof x !== 'object') return out
  const el = x as El
  out.push(el)
  for (const k of el.children ?? []) walk(k, out)
  return out
}
const textOf = (x: unknown): string => {
  if (typeof x === 'string' || typeof x === 'number') return String(x)
  if (!x || typeof x !== 'object') return ''
  return ((x as { children?: unknown[] }).children ?? []).map(textOf).join('')
}
const pictures = (tree: unknown) => walk(tree).filter(e => e.type === 'Svg').map(e => ({ source: String(e.props?.source ?? ''), height: Number(e.props?.height ?? 0), width: Number(e.props?.width ?? 0) }))
const wordsOf = (src: string) => [...src.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1].replace(/&amp;/g, '&'))
/** Where a word is drawn in a picture: its x (its right end for text set by its end) and baseline. */
const spotOf = (src: string, word: string) => {
  const m = [...src.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].find(x => x[3] === word)
  return m ? { x: Number(m[1]), y: Number(m[2]), end: /text-anchor="end"/.test(m[0]) } : undefined
}

const drawAll = async ($: any, label: string) => {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const cols of [60, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(cols) })
      const tree = await ui.drawn()
      const all = walk(tree)
      const pics = pictures(tree)
      const header = surface === 'desktop' ? pics.some(p => p.source.includes('class="f-brand"')) : /✻ Claude Crew/.test(textOf(tree))
      expect(header, `${label} ${surface} ${cols}: header`).toBe(true)
      expect(all.filter(e => e.props && 'children' in e.props).length, `${label} ${surface} ${cols}: no children prop`).toBe(0)
      if (surface === 'desktop') {
        expect(pics.length, `${label} desktop ${cols}: two pictures`).toBe(2)
        // The engine names the module by its path in the plugin.
        expect(all.filter(e => e.type === 'Client' && /(^|\/)hit\.tsx$/.test(String(e.props?.module))).length, `${label} desktop ${cols}: a hit module over each`).toBe(2)
        expect(pics.every(p => p.source.length < 131072 && p.height % 19 === 0), `${label} desktop ${cols}: within the engine's size, whole rows`).toBe(true)
      } else expect(pics.length, `${label} terminal ${cols}: no pictures`).toBe(0)
      await ui.unmount()
    }
  }
}

test('the pane draws empty, and in a busy session', async ($, on) => {
  mock.clock(on, { now: Date.parse('2031-01-01T10:00:00Z') })
  mock.store(on, { intro: 'off' })
  mock.env(on, { OS: 'Windows_NT' })
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  on('turn.start', async () => ({ turnId: 'T' }) as never)
  on('classic.PermissionRequest' as never, async () => ({}) as never)
  on('turn.step', async function* () {
    return { turnId: 'T', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 150000, output_tokens: 900, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } } as never
  } as never)
  on('session.start', async () => ({ cwd: 'C:/work/game' }) as never)
  on('command.register', async () => ({ value: true }) as never)
  on('session.cwd', async () => ({ value: 'C:/work/game' }) as never)
  on('ui.open', async () => ({ value: true }) as never)
  on('ui.toast', async () => ({ value: true }) as never)
  await $.session.start({ source: 'startup', cwd: 'C:/work/game' } as never)
  await drawAll($, 'empty')

  await $.turn.start({ text: 'When the claude moves downward in the tree from terminal and then downward within the same column to search or terminal etc, the curve line goes straight up and then down', turnId: 'T' } as never)
  for (const f of ['src/a.ts', 'src/b.ts', 'src/a-really-quite-long-folder-name/and-an-even-longer-file-name.generated.ts', 'docs/guide.md'])
    await $.tool.call({ tool: 'Read', tool_use_id: `r-${f}`, file_path: `C:/work/game/${f}` } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: 'C:/work/game/src/a.ts', old_string: 'a', new_string: 'b\nc' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clear the old build folder' } } as never)
  const steps = $.turn.step({ turnId: 'T', index: 0, model: 'claude-opus-5-5', messageCount: 3 } as never)
  for await (const _ of steps as AsyncIterable<unknown>);
  await drawAll($, 'busy')

  // What the busy desktop pane says: needing you, with its whole request; Touched with the edit.
  const cols = 87
  const ui = await $.ui.mount({ plugin: 'crew-map', surface: 'desktop', ...PANE(cols) })
  let [top, view] = pictures(await ui.drawn())
  const said = wordsOf(top.source)
  expect(said.includes('Needs you'), 'needs you').toBe(true)
  expect(said.some(w => w.startsWith('Allow running Clear the old build folder?')), 'its whole request').toBe(true)
  expect(said.includes('a.ts') && said.includes('+2'), 'Touched names the edited file').toBe(true)

  // A click on "Details", through the hit module: the viewer shows that Claude.
  const vwCols = cols - 1
  const click = async (key: string, pic: { width: number; height: number }, x: number, y: number) => {
    await ui.resize({ columns: vwCols, rows: pic.height / 19, in: key })
    const c = { x: Math.floor((x / pic.width) * vwCols), y: Math.floor(y / 19) }
    await ui.pointer({ type: 'down', x: c.x, y: c.y, button: 'left', in: key } as never)
    await ui.pointer({ type: 'up', x: c.x, y: c.y, button: 'left', in: key } as never)
  }
  const det = spotOf(top.source, 'Details')!
  await click('hit-top', top, det.x - 12, det.y - 4)
  ;[top, view] = pictures(await ui.drawn())
  expect(wordsOf(top.source).includes('Shown below'), "a click on Details shows that Claude's details").toBe(true)
  expect(wordsOf(top.source).includes('Claude ✕'), '...in its own tab').toBe(true)

  // A click on a tab: every file.
  const filesTab = wordsOf(top.source).find(w => /^Files \d+$/.test(w))!
  const files = spotOf(top.source, filesTab)!
  await click('hit-top', top, files.x + 6, files.y - 4)
  ;[top, view] = pictures(await ui.drawn())
  expect(wordsOf(view.source).some(w => w.startsWith('and-an-even-longer')), 'the Files tab lists every file').toBe(true)
  await ui.unmount()
})
