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
        expect(pics.length >= 2, `${label} desktop ${cols}: the header and a row are pictures`).toBe(true)
        expect(all.filter(e => e.type === 'Client').length, `${label} desktop ${cols}: nothing laid over a picture`).toBe(0)
        expect(all.some(e => e.type === 'Button'), `${label} desktop ${cols}: the controls are Buttons`).toBe(true)
        expect(pics.every(p => p.source.length < 131072), `${label} desktop ${cols}: within the engine's size`).toBe(true)
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
  const said = pictures(await ui.drawn()).flatMap(p => wordsOf(p.source))
  expect(said.includes('Needs you'), 'needs you').toBe(true)
  expect(said.some(w => w.startsWith('Allow running Clear the old build folder?')), 'its whole request').toBe(true)
  const buttonText = async () => (await ui.findAll({ type: 'Button' })).map(b => textOf(b) || String((b as { text?: string }).text ?? ''))
  const labels = await buttonText()
  expect(labels.some(t => /a\.ts\s*\+2/.test(t)), `Touched has the edited file as a Button, with its lines: ${labels.join(' | ').slice(0, 300)}`).toBe(true)

  // Pressed as the person presses it: Details shows that Claude in the viewer, in its own tab.
  await ui.press({ key: 'details:main' })
  expect((await buttonText()).includes('Claude ✕'), "Details shows that Claude's tab").toBe(true)
  expect((await buttonText()).includes('Hide'), '...and its row says Hide').toBe(true)

  // A tab: every file.
  const filesTab = (await ui.findAll({ type: 'Button' })).find(b => /^Files \d+$/.test(textOf(b) || String((b as { text?: string }).text ?? '')))
  await ui.press({ key: filesTab!.key! })
  expect(JSON.stringify(await ui.drawn()).includes('and-an-even-longer-file-name.generated.ts'), 'the Files tab lists every file').toBe(true)
  await ui.unmount()
})
