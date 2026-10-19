// Codex Bridge drawn by the real engine: the pane empty and with many runs (long tasks, errors,
// failed commands, changed files, threads), at four widths on two surfaces; the tool without a
// Codex CLI; thread buttons pressed. Written to pass on correct behaviour.
import { test, expect, mock } from 'claude-code/testing'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'codex-bridge',
    props: { title: 'Codex', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 80 }, view: {} },
  }) as never

const ROOT = 'C:/work/game'
const P = (p: string) => String(p).replace(/\\/g, '/')
const TOOL = 'mcp__codex-bridge__codex'

type World = { installed: boolean; files: Map<string, string>; ran: string[][]; spawned: string[][] }

const setup = (on: any): World => {
  const w: World = { installed: false, files: new Map(), ran: [], spawned: [] }
  mock.clock(on, { now: Date.parse('2031-01-01T10:00:00Z') })
  mock.store(on, {})
  mock.env(on, { OS: 'Windows_NT', LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U', TEMP: 'C:\\T' })
  w.files.set('C:/U/.codex/models_cache.json', JSON.stringify({ models: [{ slug: 'm-fast', display_name: 'Fast', description: 'Fast one.', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], default_reasoning_level: 'low' }] }))
  w.files.set('C:/U/.codex/config.toml', 'model = "m-fast"\nmodel_reasoning_effort = "low"\n')
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('session.cwd', async () => ({ value: ROOT }) as never)
  on('tool.register', async () => ({ value: { tool: TOOL } }) as never)
  on('command.register', async () => ({ value: { command: 'codex' } }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('ui.status', async () => ({ value: undefined }) as never)
  on('fs.read', async (_$: unknown, e: any) => (w.files.has(P(e.path)) ? { value: w.files.get(P(e.path)) } : { deny: `no file ${P(e.path)}` }) as never)
  on('fs.write', async (_$: unknown, e: any) => {
    w.files.set(P(e.path), e.text ?? e.content ?? e.data ?? '')
    return { value: undefined } as never
  })
  on('fs.exists', async (_$: unknown, e: any) => ({ value: w.installed && /codex\.exe$/.test(P(e.path)) }) as never)
  on('fs.stat', async () => ({ value: { kind: 'file', size: 10, mtimeMs: 1, isLink: false } }) as never)
  on('fs.list', async (_$: unknown, e: any) => ({ value: w.installed && /OpenAI\/Codex\/bin$/.test(P(e.path)) ? [{ name: '1.0', kind: 'dir' }] : [] }) as never)
  on('process.run', async (_$: unknown, e: any) => {
    w.ran.push(e.argv)
    const a = e.argv.join(' ')
    if (/rev-parse --show-toplevel/.test(a)) return { value: { exitCode: 0, stdout: `${ROOT}\n`, stderr: '' } } as never
    if (/rev-parse --git-path/.test(a)) return { value: { exitCode: 0, stdout: '.git/info/exclude\n', stderr: '' } } as never
    if (/^git .* status/.test(a)) return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  on('process.spawn', async function* (_$: unknown, e: any) {
    w.spawned.push(e.argv)
    const input: string = e.input ?? ''
    const fail = /FAIL/.test(input)
    const lines = [
      { type: 'thread.started', thread_id: `th-${w.spawned.length}` },
      { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'powershell.exe -Command "cargo test --package chunk-loader -- --nocapture src/chunk/loader.rs"' } },
      { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'cargo test', exit_code: fail ? 101 : 0 } },
      { type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: 'src/chunk/loader.rs', kind: 'update' }, { path: 'src/a-very-long-folder-name/with/a-very-long-file-name-that-goes-on.generated.rs', kind: 'add' }] } },
      ...(fail ? [{ type: 'turn.failed', error: { message: 'stream error: unexpected status 500 Internal Server Error; retrying would not help because the model is overloaded right now' } }] : []),
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: `Done. ${'All good. '.repeat(40)}\n### NOTES.md\n# Notes\n- loader is async now, and the chunk cache is bounded` } },
      { type: 'turn.completed', usage: { input_tokens: 12000, output_tokens: 3400 } },
    ]
    for (const l of lines) yield { stream: 'stdout', text: `${JSON.stringify(l)}\n` }
    if (fail) yield { stream: 'stderr', text: 'Error: model overloaded\n' }
    return { value: { code: fail ? 1 : 0, signal: null } }
  } as never)
  return w
}

const LONG = 'Make chunk loading async while keeping the public API the same, and report every place that still blocks the main thread, including the editor preview and the asset baker that runs in CI. '.repeat(3)

const drawAll = async ($: any, label: string, needles: RegExp[]) => {
  for (const surface of ['desktop', 'terminal'] as const)
    for (const cols of [40, 80, 120, 200]) {
      const ui = await $.ui.mount({ plugin: 'codex-bridge', surface, ...PANE(cols) })
      const all = (await ui.findAll({})).map((x: any) => x.text).join('\n')
      for (const n of needles) expect(n.test(all), `${label} ${surface} ${cols}: ${n}`).toBe(true)
      expect(/undefined|NaN|\[object Object\]/.test(all), `${label} ${surface} ${cols}: no raw undefined/NaN`).toBe(false)
      await ui.unmount()
    }
}

test('the tool and the pane without a Codex CLI', { timeoutMs: 30_000 }, async ($, on) => {
  setup(on)
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await drawAll($, 'empty', [/CODEX v\d+\.\d+\.\d+/, /No Codex runs yet/, /Threads/])
  const r: any = await $.tool.call({ tool: TOOL, tool_use_id: 'x1', task: 'Review the renderer' } as never)
  expect(JSON.stringify(r), 'not-installed message').toMatch(/Codex CLI was not found/)
  const u: any = await $.tool.call({ tool: TOOL, tool_use_id: 'x2', action: 'usage' } as never)
  expect(JSON.stringify(u), 'usage without logs').toMatch(/No Codex usage numbers/)
})

test('many runs: long tasks, errors, threads, buttons', { timeoutMs: 60_000 }, async ($, on) => {
  const w = setup(on)
  w.installed = true
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  for (let i = 0; i < 9; i++) {
    const r: any = await $.tool.call({
      tool: TOOL,
      tool_use_id: `t${i}`,
      task: `${i % 3 === 0 ? 'FAIL ' : ''}${LONG}`,
      ...(i % 2 ? { thread: `chunk loader ${i % 4}` } : {}),
      mode: i % 2 ? 'write' : 'read-only',
      ...(i === 4 ? { model: 'm-fast', effort: 'medium' } : {}),
    } as never)
    expect(JSON.stringify(r), `run ${i} reports back`).toMatch(/Codex (finished|failed)/)
  }
  expect(w.spawned.length, 'codex spawned per run').toBeGreaterThanOrEqual(9)
  await drawAll($, 'busy', [/CODEX v\d+\.\d+\.\d+/, /chunk loader/, /files changed/, /model overloaded|overloaded/])

  // Thread controls.
  const ui = await $.ui.mount({ plugin: 'codex-bridge', surface: 'desktop', ...PANE(120) })
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key as string)
  const rename = keys.find(k => k.startsWith('rename:'))
  expect(rename, 'a rename button').toBeDefined()
  await ui.press({ key: rename! })
  const input = await ui.find({ type: 'Input' })
  expect(input, 'rename input shown').toBeDefined()
  await ui.input({ key: input!.key!, text: 'Loader v2' })
  const archive = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key as string).find(k => k.startsWith('archive:'))
  await ui.press({ key: archive! })
  await ui.press({ key: 'show-archived' })
  const del = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key as string).find(k => k.startsWith('delete:'))
  await ui.press({ key: del! })
  const sure = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key as string).find(k => k.startsWith('delete-yes:'))
  expect(sure, 'second press asked for').toBeDefined()
  await ui.press({ key: sure! })
  await ui.press({ key: 'usage-refresh' })
  const open = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key as string).find(k => k.startsWith('open:'))
  expect(open, 'changed file button').toBeDefined()
  await ui.press({ key: open! })
  await ui.unmount()
})
