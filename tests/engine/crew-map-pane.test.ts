// The pane drawn by the engine itself (its own elements and rules), on the desktop and the terminal,
// empty and in a busy session: it draws every time, with no element the engine would refuse.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 80 }, view: {} },
  }) as never

/** Every element of a drawing, and whether any carries a "children" prop (the engine refuses one). */
const walk = (x: unknown, out: { type?: string; props?: Record<string, unknown> }[] = []) => {
  if (!x || typeof x !== 'object') return out
  const el = x as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  out.push(el)
  for (const k of el.children ?? []) walk(k, out)
  return out
}
const textOf = (x: unknown): string => {
  if (typeof x === 'string' || typeof x === 'number') return String(x)
  if (!x || typeof x !== 'object') return ''
  return ((x as { children?: unknown[] }).children ?? []).map(textOf).join('')
}

const drawAll = async ($: any, label: string) => {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const cols of [60, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(cols) })
      const tree = await ui.drawn()
      const all = walk(tree)
      expect(all.some(e => e.type === 'Text' && /CLAUDE CREW v/.test(textOf(e))), `${label} ${surface} ${cols}: header`).toBe(true)
      expect(all.filter(e => e.props && 'children' in e.props).length, `${label} ${surface} ${cols}: no children prop`).toBe(0)
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

  // What the busy desktop pane says: waiting on you, the context, the cut goal.
  const ui = await $.ui.mount({ plugin: 'crew-map', surface: 'desktop', ...PANE(120) })
  const text = textOf(await ui.drawn())
  expect(text.includes('waiting on you'), 'waiting on you').toBe(true)
  expect(/ctx/.test(text), 'context row').toBe(true)
  expect(/When the claude moves downward[^]*…/.test(text), 'long goal cut with …').toBe(true)
  await ui.unmount()
})
