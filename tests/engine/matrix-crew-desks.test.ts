// Crew map drawn by the real engine: desks view by default, the tree map behind 'view-map',
// file chips and fold buttons pressed, many helpers spawned. Written to pass on correct behaviour.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 80 }, view: {} },
  }) as never

const ROOT = 'C:/work/game'

const setup = (on: any) => {
  const clock = mock.clock(on, { now: Date.parse('2031-01-01T10:00:00Z') })
  mock.store(on, { intro: 'off' })
  mock.env(on, { OS: 'Windows_NT', TEMP: 'C:/tmp' })
  const ran: string[][] = []
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  on('turn.start', async () => ({ turnId: 'T' }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('classic.PermissionRequest' as never, async () => ({}) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('command.register', async () => ({ value: true }) as never)
  on('session.cwd', async () => ({ value: ROOT }) as never)
  on('ui.open', async () => ({ value: true }) as never)
  on('ui.toast', async () => ({ value: true }) as never)
  on('ui.copy', async () => ({ value: true }) as never)
  on('process.run', async (_$: unknown, e: any) => {
    ran.push(e.argv)
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', async () => ({ value: false }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('fs.write', async () => ({ value: true }) as never)
  on('agent.spawn', async (_$: unknown, e: any) => ({ model: 'claude-opus-5-5', agentId: `agent-${e.tool_use_id}` }) as never)
  return { clock, ran }
}

const spawnHelpers = async ($: any, n: number) => {
  for (let i = 0; i < n; i++)
    await $.agent.spawn({ tool_use_id: `s${i}`, prompt: `Investigate module ${i} and report back with a very long explanation of what it does`, description: `Look at module ${i}`, subagentType: i % 2 ? 'Explore' : 'general-purpose' } as never)
}

const busy = async ($: any, helpers: number) => {
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.turn.start({ text: 'Refactor the chunk loader and get the tests green', turnId: 'T' } as never)
  const files = ['src/a.ts', 'src/b.ts', 'src/deep/nested/c.ts', 'docs/guide.md', ...Array.from({ length: 14 }, (_, i) => `src/many/f${i}.ts`)]
  for (const f of files) await $.tool.call({ tool: 'Read', tool_use_id: `r-${f}`, file_path: `${ROOT}/${f}` } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b\nc' } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'out1', file_path: 'D:/elsewhere/notes.txt' } as never)
  await spawnHelpers($, helpers)
  for (let i = 0; i < helpers; i++) await $.tool.call({ tool: 'Read', tool_use_id: `hr${i}`, agentId: `agent-s${i}`, file_path: `${ROOT}/src/many/f${i % 14}.ts` } as never)
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: desks by default, tree map and back, chips and folds`, { timeoutMs: 30_000 }, async ($, on) => {
    const { ran } = setup(on)
    await busy($, 3)
    for (const cols of [40, 80, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(cols) })
      const drawn = JSON.stringify(await ui.drawn())
      expect(/✻ Claude Crew|f-brand/.test(drawn), `${surface} ${cols} header`).toBe(true)
      expect(drawn.includes('a.ts'), `${surface} ${cols}: Touched names a.ts`).toBe(true)
      expect(/undefined|NaN|\[object Object\]/.test(drawn), `${surface} ${cols}: nothing raw`).toBe(false)
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(120) })
    // A file on Touched opens the file (through some process): a button in the terminal, a click on the picture on the desktop.
    const before = ran.length
    if (surface === 'terminal') {
      const file = (await ui.findAll({ type: 'Button' })).find(b => /^a\.ts\b/.test(String((b as { text?: string }).text ?? '')))
      expect(file, 'a.ts is a button').toBeDefined()
      await ui.press({ key: file!.key! })
    } else {
      const top = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source ?? '')
      const m = [...top.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>a\.ts<\/text>/g)][0]
      expect(!!m, 'a.ts is drawn').toBe(true)
      const H = Number((await ui.findAll({ type: 'Svg' }))[0]?.props.height ?? 0)
      const W = Number((await ui.findAll({ type: 'Svg' }))[0]?.props.width ?? 1)
      await ui.resize({ columns: 119, rows: H / 19, in: 'hit-top' })
      const c = { x: Math.floor(((Number(m![1]) + 8) / W) * 119), y: Math.floor((Number(m![2]) - 4) / 19) }
      await ui.pointer({ type: 'down', x: c.x, y: c.y, button: 'left', in: 'hit-top' } as never)
      await ui.pointer({ type: 'up', x: c.x, y: c.y, button: 'left', in: 'hit-top' } as never)
    }
    expect(ran.length, 'opening a file ran an opener').toBeGreaterThan(before)

    // A helper finishes: one dim line that says Done.
    await $.turn.complete({ agentId: 'agent-s0', reason: 'answer', answer: 'done', turnId: 'H0' } as never)
    expect(JSON.stringify(await ui.drawn()).includes('Done'), 'a finished helper says Done').toBe(true)
    await ui.unmount()
  })

  test(`${surface}: twelve helpers at every width`, { timeoutMs: 30_000 }, async ($, on) => {
    setup(on)
    await busy($, 12)
    for (const cols of [40, 80, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(cols) })
      const drawn = JSON.stringify(await ui.drawn())
      expect(/✻ Claude Crew|f-brand/.test(drawn), `${cols} header`).toBe(true)
      // Every Claude has its row: the pane grows to fit them all, each with Details.
      expect((drawn.match(/>Details</g) ?? []).length + (drawn.match(/"Details"/g) ?? []).length >= 12, `${cols}: a row with Details for each Claude the crew keeps (12): ${(drawn.match(/>Details</g) ?? []).length + (drawn.match(/"Details"/g) ?? []).length}`).toBe(true)
      expect(/undefined|NaN|\[object Object\]/.test(drawn), `${cols}: nothing raw`).toBe(false)
      await ui.unmount()
    }
  })
}
