// Crew map with Codex runs published by codex-bridge (its `codex-bridge.runs` value, in the
// shape codex-bridge/types declares), drawn by the real engine: a running Codex gets a desk and
// a window, finished and failed runs log lines, and nothing raw leaks into the pane.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 80 }, view: {} },
  }) as never
const ROOT = 'C:/work/game'
const NOW = Date.now()

const run = (id: string, status: 'running' | 'done' | 'failed' | 'stopped', extra: Record<string, unknown> = {}) => ({
  id,
  task: 'Make chunk loading async while keeping the public API the same, and report every place that still blocks. '.repeat(3),
  mode: 'write',
  cwd: ROOT,
  root: ROOT,
  model: 'gpt-5.6-sol',
  effort: 'high',
  status,
  startedAt: NOW - 90_000,
  endedAt: status === 'running' ? 0 : NOW - 5_000,
  session: 'th-1',
  thread: 'chunk-loader',
  threadKey: 'chunk-loader',
  resumed: true,
  caller: 'main',
  activity: 'Running cargo test',
  focus: `${ROOT}/src/chunk/loader.rs`,
  touched: [{ path: `${ROOT}/src/chunk/loader.rs`, kind: 'edit', at: NOW - 10_000 }, { path: `${ROOT}/src/lib.rs`, kind: 'look', at: NOW - 20_000 }],
  events: [
    { at: NOW - 60_000, kind: 'think', text: 'Looking at the loader' },
    { at: NOW - 50_000, kind: 'cmd', text: 'cargo test -p loader', ok: false, ref: 'c1' },
    { at: NOW - 40_000, kind: 'file', text: 'update loader.rs' },
    { at: NOW - 30_000, kind: 'error', text: 'stream error: unexpected status 500' },
    { at: NOW - 20_000, kind: 'plan', text: '1/3 steps · next: make it async' },
    { at: NOW - 10_000, kind: 'cmd', text: 'cargo test', ref: 'c2' },
  ],
  files: [`${ROOT}/src/chunk/loader.rs`, `${ROOT}/src/a-very-long-folder-name/with/a-very-long-file-name-that-goes-on.generated.rs`, `${ROOT}/src/lib.rs`],
  commands: 2,
  failedCommands: 1,
  answer: '',
  tokens: 15400,
  notesUpdated: status === 'done',
  ...extra,
})

for (const surface of ['desktop', 'terminal'] as const)
  test(`${surface}: crew map draws codex-bridge runs`, { timeoutMs: 30_000 }, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, { intro: 'off' })
    mock.env(on, { OS: 'Windows_NT', TEMP: 'C:/T' })
    const runs = [run('r1', 'running'), run('r2', 'running', { caller: 'agent-s0', thread: '' }), run('r3', 'done'), run('r4', 'failed', { thread: '' }), run('r5', 'stopped')]
    on('state.get', { plugin: 'codex-bridge' } as never, async (_$: unknown, e: any) => ({ value: { value: e.key === 'runs' ? runs : undefined, version: 1 } }) as never)
    on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
    on('turn.start', async () => ({ turnId: 'T' }) as never)
    on('session.start', async () => ({ cwd: ROOT }) as never)
    on('session.cwd', async () => ({ value: ROOT }) as never)
    on('command.register', async () => ({ value: { command: 'crew' } }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
    on('fs.exists', async () => ({ value: false }) as never)
    on('fs.read', async () => ({ deny: 'none' }) as never)
    on('fs.write', async () => ({ value: undefined }) as never)
    on('agent.spawn', async (_$: unknown, e: any) => ({ model: 'claude-opus-5-5', agentId: `agent-${e.tool_use_id}` }) as never)

    await $.session.start({ source: 'startup', cwd: ROOT } as never)
    await $.turn.start({ text: 'Have Codex look at the loader', turnId: 'T' } as never)
    await $.agent.spawn({ tool_use_id: 's0', prompt: 'help', description: 'Helper', subagentType: 'Explore' } as never)
    await $.tool.call({ tool: 'mcp__codex-bridge__codex', tool_use_id: 'cx', task: 'Look at the loader', thread: 'chunk-loader' } as never)

    for (const cols of [40, 80, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'crew-map', surface, ...PANE(cols) })
      const all = await ui.findAll({})
      const text = all.map((x: any) => x.text).join('\n')
      expect(/Codex/.test(text), `${surface} ${cols}: Codex on the crew map`).toBe(true)
      expect(all.some((x: any) => String(x.key).startsWith('desk-cx-')), `${surface} ${cols}: a Codex desk for a running run`).toBe(true)
      expect(/undefined|NaN|\[object Object\]/.test(text), `${surface} ${cols}: nothing raw`).toBe(false)
      if (surface === 'desktop') {
        // The tree map with Codex's own tree on it, then back (the terminal has no way back: reported separately).
        await ui.press({ key: 'view-map' })
        expect(/Codex/.test((await ui.findAll({})).map((x: any) => `${x.text} ${x.props?.alt ?? ''}`).join('\n')), `${cols}: Codex on the tree map`).toBe(true)
        await ui.press({ key: 'view-desks' })
      }
      await ui.unmount()
    }
  })
