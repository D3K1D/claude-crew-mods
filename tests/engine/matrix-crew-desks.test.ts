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
      const tree = await ui.drawn()
      expect(tree, `${surface} ${cols} drawn`).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /CLAUDE CREW v\d+\.\d+\.\d+/ }), `${surface} ${cols} header`).toBeDefined()
      expect(await ui.find({ key: 'view-map' }), `${surface} ${cols}: desks view shows the 'tree map' toggle`).toBeDefined()
      expect(await ui.find({ key: 'view-desks' }), `${surface} ${cols}: not on the tree map`).toBeUndefined()
      expect((await ui.findAll({ type: 'Button', key: 'file:' + ROOT + '/src/a.ts' })).length, `${surface} ${cols}: a.ts chip`).toBe(1)
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(120) })
    // A file chip opens the file (through some process).
    const before = ran.length
    await ui.press({ key: `file:${ROOT}/src/a.ts` })
    expect(ran.length, 'pressing a chip ran an opener').toBeGreaterThan(before)
    // A folder name opens the folder.
    const dir = (await ui.findAll({ type: 'Button' })).find(b => (b.key ?? '').startsWith('dir:'))
    expect(dir, 'a folder button').toBeDefined()
    await ui.press({ key: dir!.key! })
    // +N more on a card of 15+ files.
    const more = (await ui.findAll({ type: 'Button' })).find(b => (b.key ?? '').startsWith('more:'))
    expect(more, 'a +N more button on the big card').toBeDefined()
    await ui.press({ key: more!.key! })

    // To the tree map and back.
    await ui.press({ key: 'view-map' })
    expect(await ui.find({ key: 'view-desks' }), 'tree map shows the desks toggle').toBeDefined()
    for (const k of ['fit', 'bigger', 'smaller']) if (await ui.find({ key: k })) await ui.press({ key: k })
    const moves = (await ui.findAll({ type: 'Button' })).filter(b => (b.key ?? '').startsWith('move-'))
    for (const m of moves) await ui.press({ key: m.key! })
    await ui.press({ key: 'view-desks' })
    expect(await ui.find({ key: 'view-map' }), 'back on the desks').toBeDefined()

    // A helper finishes: its window gets – fold; folding puts it on the log's title row, unfold opens it again.
    await $.turn.complete({ agentId: 'agent-s0', reason: 'answer', answer: 'done', turnId: 'H0' } as never)
    expect(await ui.find({ key: 'fold:agent-s0' }), 'finished helper window has – fold').toBeDefined()
    await ui.press({ key: 'fold:agent-s0' })
    expect(await ui.find({ key: 'unfold:agent-s0' }), 'folded helper is a button on the log title row').toBeDefined()
    await ui.press({ key: 'unfold:agent-s0' })
    expect(await ui.find({ key: 'fold:agent-s0' }), 'unfolded again').toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: twelve helpers at every width`, { timeoutMs: 30_000 }, async ($, on) => {
    setup(on)
    await busy($, 12)
    for (const cols of [40, 80, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(cols) })
      expect(await ui.find({ type: 'Text', text: /CLAUDE CREW v/ }), `${cols} header`).toBeDefined()
      await ui.press({ key: 'view-map' })
      expect(await ui.find({ key: 'view-desks' }), `${cols} tree map with 12 helpers`).toBeDefined()
      await ui.press({ key: 'view-desks' })
      await ui.unmount()
    }
  })
}
