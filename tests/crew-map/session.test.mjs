globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const toasts = []
let now = Date.parse('2026-10-03T14:00:00')
Date.now = () => now
const tick = ms => {
  now += ms
}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async t => toasts.push(t) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => 'old line\n', exists: async () => false },
  model: { complete: async () => ({ isAnswered: true, text: '55' }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : n === 'TEMP' ? 'C:/Users/me/Temp' : undefined) },
  state: { get: async ref => ({ value: globalThis.__codexRuns, version: 0 }) },
}
register((ev, m, fn) => {
  hooks[ev] = fn ?? m
  return { catch() {} }
}, {})
const ok = async () => ({ text: 'ok' })
let n = 0
const call = (e, next = ok) => hooks['tool.call']($, { tool_use_id: `t${n++}`, ...e }, next)
const say = (blocks, agentId) =>
  hooks['session.append']($, { door: 'response', message: { role: 'assistant', content: blocks }, origin: {}, uuid: 'u', ...(agentId ? { agentId } : {}) }, async () => ({}))
const crew = () => globalThis.__store.get('crew')
const main = () => crew().agents.find(a => a.id === 'main')
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => {
  if (!x || typeof x !== 'object') return out
  if (pred(x)) out.push(x)
  for (const c of x.props?.children ?? []) find(c, pred, out)
  return out
}
const render = surface => hooks['ui.render']($, { surface, props: { bodyColumns: 120 }, viewport: { columns: 120 } })
const windows = async () => {
  const tree = await render('desktop')
  const boxes = find(tree, x => x.type === 'Box' && x.props.borderStyle === 'round')
  const wins = boxes.filter(b => b.props.borderColor !== '#30363D' && b.props.borderColor !== '#F0BC55')
  const logBox = boxes.filter(b => b.props.borderColor === '#30363D').pop()
  return { wins: wins.map(b => b.props.children.map(text).join('\n')), log: logBox.props.children.map(text) }
}
let fails = 0
const check = (label, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`)
}

await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
check('main exists and is idle at start', main()?.state === 'idle')
let w = await windows()
check('main window says waiting before any prompt', w.wins[0]?.includes('waiting for a prompt'), w.wins[0]?.split('\n')[1])

tick(1000)
await hooks['turn.start']($, { text: 'Fix the chunk loader so far chunks stream in', turnId: 'T1' }, async () => ({ turnId: 'T1' }))
check('turn.start sets the goal', main().goal === 'Fix the chunk loader so far chunks stream in')
check('turn.start: main thinking', main().state === 'thinking')

tick(500)
await say([
  { type: 'thinking', thinking: 'The loader reads chunks synchronously. I should check world/chunk.rs first.' },
  { type: 'text', text: 'Let me look at the chunk loader.' },
  { type: 'tool_use', id: 'x', name: 'Read', input: {} },
])
check('two thoughts recorded from one reply', main().thoughts.length === 2, main().thoughts.join(' | '))
check('reply order kept: the later block is the newest thought', main().thoughts[0] === 'Let me look at the chunk loader.', main().thoughts[0])

tick(500)
await call({ tool: 'Read', file_path: 'C:/cw/src/world/chunk.rs' })
check('file names survive summarising', main().thoughts.some(t => t.includes('world/chunk.rs first.')), main().thoughts.join(' | '))
check('Read moves main to the file', main().node === 'C:/cw/src/world/chunk.rs')
check('after the call main is thinking again', main().state === 'thinking' && main().pending.length === 0)

await say([{ type: 'text', text: 'Maybe we could cache chunks instead of re-reading them.' }])
await call({
  tool: 'TodoWrite',
  todos: [
    { content: 'Read loader', status: 'completed' },
    { content: 'Add cache', status: 'in_progress', activeForm: 'Adding the chunk cache' },
    { content: 'Test', status: 'pending' },
  ],
})
check('todos drive progress 1/3', main().todosTotal === 3 && main().todosDone === 1, `${main().todosDone}/${main().todosTotal}`)
check('current todo shown', main().doing === 'Adding the chunk cache')

tick(800)
await call({ tool: 'Edit', file_path: 'C:/cw/src/world/chunk.rs', old_string: 'a\nb', new_string: 'a\nc\nd' })
const ch = () => crew().changes['C:/cw/src/world/chunk.rs']
check('edit counted +2 -1', ch()?.added === 2 && ch()?.removed === 1, JSON.stringify(ch()))
await call({ tool: 'Edit', file_path: 'C:/cw/src/world/chunk.rs', old_string: 'x', new_string: 'y' }, async () => ({ text: 'String not found', isError: true }))
check('failed edit not counted', ch()?.edits === 1)

let during
await call({ tool: 'Bash', command: 'cargo test chunk' }, async () => {
  during = { state: main().state, tool: main().tool }
  return { text: 'test failed', isError: true }
})
check('main busy while the call runs', during.state === 'busy' && during.tool === 'Bash')

tick(1000)
await call({ tool: 'Agent', description: 'Map chunk IO', prompt: 'Find every place chunks are read from disk', subagent_type: 'Explore' }, async () => {
  check('main busy delegating while subagent runs', main().state === 'busy' && main().tool === 'Agent')
  await hooks['agent.spawn'](
    $,
    { tool_use_id: 'agent-call', prompt: 'Find every place chunks are read from disk', description: 'Map chunk IO', subagentType: 'Explore', provider: {}, parentModel: 'm' },
    async () => ({ model: 'haiku', agentId: 'sub1' }),
  )
  await say([{ type: 'text', text: 'Searching for chunk reads.' }], 'sub1')
  await hooks['tool.call']($, { tool: 'Grep', tool_use_id: 'g1', pattern: 'read_chunk', agentId: 'sub1' }, ok)
  await hooks['tool.call']($, { tool: 'Read', tool_use_id: 'r1', file_path: 'C:/cw/src/world/io.rs', agentId: 'sub1' }, ok)
  const sub = crew().agents.find(a => a.id === 'sub1')
  check('subagent named by type', sub?.name === 'Scout', sub?.name)
  check('subagent goal from spawn', sub?.goal.startsWith('Map chunk IO'), sub?.goal)
  check('subagent thoughts kept apart from main', sub?.thoughts[0] === 'Searching for chunk reads.' && !main().thoughts.includes('Searching for chunk reads.'))
  tick(2000)
  await hooks['turn.complete']($, { reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 'S1', agentId: 'sub1' }, async () => ({ text: 'done' }))
  check('subagent turn end leaves main busy', main().state === 'busy', main().state)
  return { text: 'report' }
})
const sub = crew().agents.find(a => a.id === 'sub1')
check('subagent done after its Agent call returns', sub.state === 'done' && sub.progress === 100, `${sub.state} ${sub.progress}`)

w = await windows()
console.log('\n--- main window mid-turn ---\n' + w.wins[0])

tick(1500)
await hooks['turn.complete']($, { reason: 'answer', answer: 'Fixed.', durationMs: 9000, isAborted: false, turnId: 'T1' }, async () => ({ text: 'Fixed.' }))
check('main idle after its turn', main().state === 'idle')
check('main progress 100 after answer', main().progress === 100)
check('no stale todo after the turn', main().doing === '')
check('failed edit and test marked in the log', crew().log.some(l => l.text === '✎ editing chunk.rs ✗ failed') && crew().log.some(l => l.text === '$ ran cargo test ✗ failed'))
check('failed test marked in the window', main().actions.includes('$ ran cargo test ✗ failed'), main().actions.join(' | '))
w = await windows()
console.log('\n--- main window after turn ---\n' + w.wins[0])
console.log('\n--- log ---\n' + w.log.join('\n'))

const lines = crew().log
const dupes = lines.filter((l, i) => i && l.text === lines[i - 1].text && l.who === lines[i - 1].who)
check('no repeated log lines', dupes.length === 0, dupes.map(d => d.text).join(' | '))
check('log is in time order', lines.every((l, i) => !i || l.at >= lines[i - 1].at))
const acts = lines.filter(l => l.kind === 'act').map(l => l.text)
check('every main action logged', ['chunk.rs', 'planning', 'editing', 'ran cargo test', 'delegating'].every(t => acts.some(a => a.includes(t))), acts.join(' | '))

tick(5000)
await hooks['turn.start']($, { text: 'Now add a unit test', turnId: 'T2' }, async () => ({ turnId: 'T2' }))
check('second prompt resets goal and progress', main().goal === 'Now add a unit test' && main().progress === -1 && main().todosTotal === 0)
check('second prompt clears old thoughts and actions', main().thoughts.length === 0 && main().actions.length === 0)
w = await windows()
console.log('\n--- main window at second prompt ---\n' + w.wins[0])
const term = await render('terminal')
check('terminal surface renders', !!term)
console.log(`\ntoasts: ${JSON.stringify(toasts)}`)
console.log(`${fails} failing check(s)`)
