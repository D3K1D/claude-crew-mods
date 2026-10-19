// The busiest map stays under the Svg element's 131072-character limit: 60 files with long names,
// 8 busy Claudes, several stations, tests running and four Codex threads of six files each.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const P = 'C:/work/big-project'
const codexRuns = Array.from({ length: 4 }, (_, i) => ({
  id: `r${i}`, task: 'Refactor the chunk pipeline for streaming', mode: 'write', root: P, cwd: P, model: 'gpt-6.1-sol', effort: 'high', status: 'running', startedAt: now - 60_000, endedAt: 0,
  thread: `thread-number-${i}`, resumed: false, caller: 'main', activity: 'Editing a file', focus: '', events: [], files: [], commands: 0, failedCommands: 0, answer: '', notesUpdated: false,
  touched: Array.from({ length: 6 }, (_, k) => ({ path: `${P}/src/codex/area-${i}/module-with-a-long-name-${k}.ts`, kind: k % 2 ? 'edit' : 'look', at: now - k })),
}))
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: codexRuns }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'Big job', turnId: 'T' }, async () => ({}))
let n = 0
const dirs = ['src/components', 'src/hooks', 'src/lib/util', 'tests/unit', 'tests/integration', 'docs']
for (let i = 0; i < 60; i++)
  await hooks['tool.call']($, { tool: 'Edit', tool_use_id: `e${n++}`, file_path: `${P}/${dirs[i % dirs.length]}/some-rather-long-file-name-${i}.test.tsx`, old_string: 'a', new_string: 'b\nc' }, async () => ({ text: 'ok' }))
for (const tool of ['mcp__Claude_Browser__navigate', 'mcp__computer-use__screenshot', 'mcp__blender__get_scene_info', 'WebSearch'])
  await hooks['tool.call']($, { tool, tool_use_id: `s${n++}`, url: 'https://example.com', query: 'q' }, async () => ({ text: 'ok' }))
for (const cmd of ['npm test', 'cargo test'])
  void hooks['tool.call']($, { tool: 'Bash', tool_use_id: `b${n++}`, command: cmd, run_in_background: true }, async () => ({ text: 'Command running in background with ID: bash_1' }))
// Eight Claudes, each busy on a file.
for (let i = 0; i < 8; i++) {
  await hooks['agent.spawn']($, { tool_use_id: `sp${i}`, prompt: 'x', description: `Job ${i}`, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: `a${i}` }))
  void hooks['tool.call']($, { tool: 'Edit', tool_use_id: `w${n++}`, agentId: `a${i}`, file_path: `${P}/${dirs[i % dirs.length]}/some-rather-long-file-name-${i * 5}.test.tsx`, old_string: 'a', new_string: 'b' }, () => new Promise(() => {}))
}
await new Promise(r => setTimeout(r, 20))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
for (const cols of [60, 150, 320]) {
  const tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: cols }, viewport: { columns: cols } })
  const svg = find(tree, x => x.type === 'Svg')[0].props.source
  check(`the busiest map fits the Svg limit at ${cols} columns`, svg.length < 131072, `${svg.length} chars`)
  check(`...with no NaN or undefined in it (${cols} columns)`, !/NaN|undefined|Infinity/.test(svg))
}
// Zoomed in, the window adds its key and hover tip: still within the limit.
for (let i = 0; i < 4; i++) await find(await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 150 }, viewport: { columns: 150 } }), x => x.type === 'Button' && x.props.key === 'bigger')[0].props.onPress()
const zoomed = find(await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 150 }, viewport: { columns: 150 } }), x => x.type === 'Svg')[0].props.source
check('zoomed in, the busiest map still fits', zoomed.length < 131072 && !zoomed.includes('minimap'), `${zoomed.length} chars`)
const fileNodes = Object.values(globalThis.__store.get('crew').nodes).filter(x => x.kind === 'file').length
check('the map holds up to 60 things, and draws every file it holds', Object.keys(globalThis.__store.get('crew').nodes).length === 60 && (zoomed.match(/>[^<]*(?:some-rat|name-\d)[^<]*</g) ?? []).length === fileNodes, `${fileNodes} files, ${(zoomed.match(/>[^<]*(?:some-rat|name-\d)[^<]*</g) ?? []).length} drawn`)
console.log(`\n${fails} failing check(s)`)
