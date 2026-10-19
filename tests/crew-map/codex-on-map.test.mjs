// Claude Crew with Codex runs alongside: the map, the windows and the log.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const OUT = fileURLToPath(new URL('../.build/out', import.meta.url))
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2026-10-04T10:00:00')
Date.now = () => now
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : n === 'TEMP' ? 'C:/Users/me/Temp' : undefined) },
  state: { get: async () => ({ value: globalThis.__codexRuns, version: 0 }) },
}
register((ev, m, fn) => {
  hooks[ev] = fn ?? m
  return { catch() {} }
}, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
const ok = async () => ({ text: 'ok' })
const P = 'C:/cw/src'
await hooks['turn.start']($, { text: 'Speed up chunk streaming', turnId: 'T' }, async () => ({}))
await hooks['tool.call']($, { tool: 'Read', tool_use_id: 'a', file_path: `${P}/main.rs` }, ok)
await hooks['agent.spawn']($, { tool_use_id: 'sp', prompt: 'Find the chunk loading path', description: 'Chunk IO', subagentType: 'Explore', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
await hooks['tool.call']($, { tool: 'Read', tool_use_id: 'b', file_path: `${P}/world/mod.rs`, agentId: 'sub1' }, ok)
const crew = globalThis.__store.get('crew')
crew.nodes[`${P}/main.rs`].imports = [`${P}/world/mod.rs`]

const run = (o) => ({ mode: 'write', model: 'gpt-6.1-sol', effort: 'high', resumed: false, events: [], files: [], commands: 0, failedCommands: 0, answer: '', notesUpdated: false, touched: [], focus: '', activity: '', endedAt: 0, ...o })
globalThis.__codexRuns = [
  run({
    id: 'r2',
    task: 'Make chunk loading async in world/chunk.rs and stream far chunks first',
    status: 'running',
    startedAt: now - 95_000,
    thread: 'chunk-loader',
    resumed: true,
    caller: 'sub1',
    activity: 'Running cargo test chunk',
    focus: `${P}/world/chunk.rs`,
    touched: [
      { path: `${P}/world/mod.rs`, kind: 'look', at: now - 80_000 },
      { path: `${P}/world/gen.rs`, kind: 'look', at: now - 60_000 },
      { path: `${P}/world/chunk.rs`, kind: 'edit', at: now - 20_000 },
    ],
    events: [
      { at: now - 60_000, kind: 'cmd', text: 'rg -n "load_chunk" src', ok: true },
      { at: now - 20_000, kind: 'file', text: 'update chunk.rs' },
      { at: now - 5_000, kind: 'cmd', text: 'cargo test chunk', ok: undefined },
    ],
    commands: 1,
  }),
  run({
    id: 'r1',
    task: 'Review the renderer for unnecessary allocations',
    status: 'done',
    mode: 'read-only',
    model: 'gpt-6-astra',
    effort: 'xhigh',
    startedAt: now - 400_000,
    endedAt: now - 3_000,
    thread: '',
    caller: 'main',
    activity: 'Done',
    touched: [{ path: `${P}/render/mesh.rs`, kind: 'look', at: now - 300_000 }],
    events: [{ at: now - 3_500, kind: 'say', text: 'Found two per-frame Vec allocations in mesh.rs.' }],
    answer: 'Found two per-frame Vec allocations in mesh.rs.',
    notesUpdated: true,
  }),
]

const tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 150 }, viewport: { columns: 150 } })
const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of x.props?.children ?? []) find(c, pred, out)
  return out
}
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const svg = find(tree, x => x.type === 'Svg').map(x => x.props.source).find(src => src.includes('Codex')) ?? ''
let fails = 0
const check = (label, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`)
}
check('map has the Codex badge', svg.includes('>Codex</text>'))
check('map has both thread nodes', svg.includes('>chunk-loader</text>') && svg.includes('>one-off</text>'))
check('map has Codex files: edited and read', svg.includes('>chunk.rs</text>') && svg.includes('>gen.rs</text>') && svg.includes('>mesh.rs</text>') && svg.includes('>edited</text>') && svg.includes('>read</text>'))
check('Codex robot bubble shows its activity', svg.includes('Running cargo test chunk'))
check('wire from Scout to Codex with the task', svg.includes('Scout → Codex: Make chunk loading async'))
check('answer wire back to Claude after finishing', svg.includes('Codex → Claude: done'))
check('Scout waits on Codex', svg.includes('Waiting on Codex'))
const windows = find(tree, x => x.type === 'Box' && x.props.borderStyle === 'round' && x.props.borderColor === '#10A37F').map(b => b.props.children.map(text).join('\n'))
check('two Codex windows', windows.length === 2, String(windows.length))
check('Codex window names who asked', /from +Scout/.test(windows[0] ?? '') && windows[0]?.includes('same thread'), windows[0]?.split('\n').slice(0, 2).join(' / '))
check('finished Codex window summary', windows[1]?.includes('notes updated'))
const log = find(tree, x => x.type === 'Box' && x.props.borderColor === '#30363D').pop()
const logText = log.props.children.map(text).join('\n')
console.log('\n--- log ---\n' + logText + '\n')
check('log shows Codex being asked and answering', logText.replace(/ +/g, ' ').includes('Codex ← Scout [chunk-loader]') && logText.replace(/ +/g, ' ').includes('Codex → Claude: done'))
check('log shows Codex running a command, in words', logText.replace(/ +/g, ' ').includes('Codex $ ran cargo test'))
console.log('\n--- Codex windows ---\n' + windows.join('\n---\n'))
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/codex.svg`, svg)
writeFileSync(`${OUT}/codex.html`, '<!doctype html><body style="margin:0;background:#222"><img src="codex.svg" style="width:99vw"></body>')
console.log(`\n${fails} failing check(s)`)
