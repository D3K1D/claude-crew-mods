// Four things a watcher needs at a glance:
//  1. "Needs you": a Claude waiting on a permission prompt, a question or a plan says so (amber
//     window, first in line, a header count, a bubble on the map) until that is settled.
//  2. A context meter per Claude, from its last model request, with how often it was compacted.
//  3. One colour per file for what was done to it: dashed not opened, light read, green edited.
//  4. Finished helpers fold into the log's title row after a moment; a click opens one again.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T10:00:00')
Date.now = () => now
const P = 'C:/work/game'
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
// Every hook kept with its matcher; an event runs the matching ones as a chain, first registered outermost.
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
await fire('session.start', {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await fire('turn.start', { text: 'Fix the login flow', turnId: 'T' }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const agent = id => crew().agents.find(a => a.id === id)
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = () => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: 150, scroll: { bodyRows: 50 } }, viewport: { columns: 150 } }, async () => ({}))
const windowOf = (tree, name) => find(tree, x => x.type === 'Box' && x.props.borderStyle && find(x, y => y.type === 'Text' && text(y) === `✻ ${name}`).length)[0]
const svgOf = tree => find(tree, x => x.type === 'Svg')[0].props.source
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
let n = 0
const call = (tool, input, during, result = { text: 'ok' }, more = {}) => fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input, ...more }, async () => { if (during) await during(); return result })

// ── 1. Needs you ──
let tree
await call('Bash', { command: 'npm test', description: 'Run the auth tests' }, async () => {
  await fire('classic.PermissionRequest', { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the auth tests' } }, async () => ({}))
  tree = await render()
})
{
  const win = windowOf(tree, 'Claude')
  check('a permission prompt marks the Claude as waiting on you', /needs you: allow running Run the auth tests/.test(text(win)), text(win).slice(0, 160))
  check('...its window turns amber and says so in its corner', win.props.borderColor === '#E3B341' && text(win).includes('⏸ waiting on you'))
  check('...the header counts it', text(tree).includes('⏸ 1 waiting on you'))
  check('...its bubble on the map says "Needs you"', svgOf(tree).includes('Needs you'))
  check('...and the log says what it needs', crew().log.some(l => l.text === '⏸ needs you: allow running Run the auth tests'))
}
check('when the call ends (answered and run), it no longer waits on you', !agent('main').needs && !text(await render()).includes('waiting on you'))
// A hook beneath that decided at once: no prompt was shown, so nothing waits.
await fire('classic.PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: `${P}/src/a.ts` } }, async () => ({ decision: { behavior: 'allow' } }))
check('a permission a hook decided at once leaves nothing waiting', !agent('main').needs)
// A denial ends it.
await fire('classic.PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: `${P}/src/a.ts` } }, async () => ({}))
check('an edit prompt names the file', agent('main').needs?.what === 'allow editing a.ts', JSON.stringify(agent('main').needs))
await fire('classic.PermissionDenied', { tool_name: 'Edit' }, async () => ({}))
check('a denial ends the wait', !agent('main').needs)
// A question: waits while the tool runs.
await call('AskUserQuestion', { questions: [] }, async () => { tree = await render() })
check('a question waits on you while it is open', text(windowOf(tree, 'Claude')).includes('needs you: answer a question'))
check('...and not once it is answered', !agent('main').needs)
// A helper waiting on you comes first among the windows.
await fire('agent.spawn', { tool_use_id: 'sp1', prompt: 'Look at the tests', description: 'Scout', subagentType: 'Explore', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
await call('Read', { file_path: `${P}/tests/a.test.ts` }, async () => {}, { text: 'ok' }, { agentId: 'sub1' })
await call('Bash', { command: 'rm -rf build' }, async () => {
  await fire('classic.PermissionRequest', { agent_id: 'sub1', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, async () => ({}))
  tree = await render()
}, { text: 'ok' }, { agentId: 'sub1' })
{
  const wins = find(tree, x => x.type === 'Box' && x.props.borderStyle && find(x, y => y.type === 'Text' && /^✻ /.test(text(y))).length)
  const first = find(wins[0], y => y.type === 'Text' && /^✻ /.test(text(y)))[0]
  // Windows keep their places (a static layout): waiting on you shows in amber, not by moving.
  const waiting = wins.find(w => w.props.borderColor === '#E3B341')
  check('a helper waiting on you keeps its place, its window amber', !!first && text(first) === '✻ Claude' && !!waiting && !/✻ Claude\b/.test(text(find(waiting, y => y.type === 'Text' && /^✻ /.test(text(y)))[0])), wins.map(w => text(find(w, y => y.type === 'Text' && /^✻ /.test(text(y)))[0])).join(', '))
}
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'S', agentId: 'sub1', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
check('its turn ending ends any wait', !agent('sub1').needs)

// ── 2. Context meter ──
const step = async (agentId, model, usage) => {
  const it = fire('turn.step', { turnId: 'T', index: 0, model, messageCount: 4, agentId }, () => (async function* () { yield { kind: 'text', text: 'hi' }; return { turnId: 'T', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } })())
  let r = await it.next()
  while (!r.done) r = await it.next()
  return r.value
}
const res = await step(undefined, 'claude-opus-5-5', { input_tokens: 1000, cache_read_input_tokens: 120000, cache_creation_input_tokens: 500, output_tokens: 500, model: 'claude-opus-5-5' })
check('a model request passes through untouched', res?.stopReason === 'end_turn')
tree = await render()
check('the window shows how full its context is (61% of 200k)', /ctx\s*█+░*\s+61% of 200k/.test(text(windowOf(tree, 'Claude'))), text(windowOf(tree, 'Claude')))
await fire('session.measure', { context: { tokens: 400000, window: 1000000, percent: 40 }, rateLimits: [] }, async () => ({ changed: true }))
check("the engine's own measure gives the main window's true size", /40% of 1\.0M/.test(text(windowOf(await render(), 'Claude'))))
await step('sub1', 'claude-haiku-5-5', { input_tokens: 175000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1000, model: 'claude-haiku-5-5' })
await fire('agent.spawn', { tool_use_id: 'sp2', prompt: 'Big job', description: 'Builder', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub2' }))
await call('Read', { file_path: `${P}/src/b.ts` }, async () => {
  await step('sub2', 'claude-sonnet-5-5[1m]', { input_tokens: 300000, output_tokens: 1000, model: 'claude-sonnet-5-5' })
  tree = await render()
}, { text: 'ok' }, { agentId: 'sub2' })
check('a [1m] model counts against a million', agent('sub2').ctx?.window === 1_000_000)
{
  const w = windowOf(tree, agent('sub1').name)
  const pctText = find(w, x => x.type === 'Text' && /^ +88%$/.test(text(x)))[0]
  check('nearly full says it compacts soon, the share in red', !!w && /88% of 200k · compacts soon/.test(text(w)) && pctText?.props.color === '#FF7B72', w && text(w).match(/ctx.{0,60}/)?.[0])
}
await fire('session.compact', { trigger: 'auto', messages: [1, 2, 3] }, async () => ({ messages: [1] }))
tree = await render()
check('a compaction is counted, and the meter waits for the next request', agent('main').compactions === 1 && /ctx\s*— · compacted 1×/.test(text(windowOf(tree, 'Claude'))), text(windowOf(tree, 'Claude')))
await step(undefined, 'claude-opus-5-5', { input_tokens: 30000, output_tokens: 100, model: 'claude-opus-5-5' })
check('...then shows the new size with the count', /3% of 1\.0M · compacted 1×/.test(text(windowOf(await render(), 'Claude'))), text(windowOf(await render(), 'Claude')).match(/ctx.{0,50}/)?.[0])

// ── 3. One colour per file ──
await call('Read', { file_path: `${P}/src/read-only.ts` })
await call('Edit', { file_path: `${P}/src/changed.ts`, old_string: 'a', new_string: 'b\nc' })
for (const a of crew().agents) if (a.state !== 'done') a.state = 'idle'
now += 1000
tree = await render()
{
  const svg = svgOf(tree)
  const outline = name => { const i = svg.indexOf(`>${name}</text>`); const g = svg.lastIndexOf('<g transform="translate(', i); return svg.slice(g, i).match(/<path d="M0 0H\d+L\d+ 10V\d+H0Z" fill="#0D1117" stroke="([^"]+)"/)?.[1] }
  check('an edited file is outlined green', outline('changed.ts') === '#3FB950', outline('changed.ts'))
  check('a file only read keeps the light outline', outline('read-only.ts') === '#E8DFC8', outline('read-only.ts'))
  check('the key says green is edited', svg.includes('green = edited'))
}

// ── 4. Finished helpers fold away ──
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'S2', agentId: 'sub2', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
tree = await render()
const name2 = agent('sub2').name
check('a helper that just finished keeps its window a moment, with a fold button', !!windowOf(tree, name2) && !!find(tree, x => x.type === 'Button' && x.props.key === 'fold:sub2').length)
now += 25_000
tree = await render()
check('...then folds away', !windowOf(tree, name2))
const unfold = find(tree, x => x.type === 'Button' && x.props.key === 'unfold:sub2')[0]
check("...into the log's title row, as a button", !!unfold && text(unfold).includes(name2))
await unfold.props.onPress()
tree = await render()
check('a click opens its window again', !!windowOf(tree, name2))
await find(tree, x => x.type === 'Button' && x.props.key === 'fold:sub2')[0].props.onPress()
tree = await render()
check('and "– fold" puts it away', !windowOf(tree, name2) && !!find(tree, x => x.type === 'Button' && x.props.key === 'unfold:sub2').length)
// Junk from the engine changes nothing shown.
{
  const before = JSON.stringify(agent('main').ctx)
  await fire('session.measure', { context: { tokens: NaN, window: -5 }, rateLimits: [] }, async () => ({}))
  await step(undefined, 'claude-opus-5-5', { input_tokens: NaN, output_tokens: 5 })
  check('a nonsense measure or usage leaves the meter as it was', JSON.stringify(agent('main').ctx) === before && !/NaN|-5/.test(text(windowOf(await render(), 'Claude'))), JSON.stringify(agent('main').ctx))
}
console.log(`\n${fails} failing check(s)`)
