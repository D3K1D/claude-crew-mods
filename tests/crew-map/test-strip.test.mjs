// The tests strip: a title saying what the run is for, the command cleaned up, poll loops read as
// "watching <file>", and many runs at once in one box.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => 'C:/proj' },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : n === 'TEMP' ? 'C:/Users/me/Temp' : undefined) },
  state: { get: async () => ({ value: [], version: 0 }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x?.props?.children ?? []).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const render = () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 120 }, viewport: { columns: 120 } })
const stripOf = tree => find(tree, x => x.type === 'Box' && x.props.key === 'running')[0]
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

// [command, Claude's description, the command as shown, the title]
const cases = [
  ['timeout 2400 .venv/Scripts/python.exe -m unittest discover -s tests > "C:/Users/me/AppData/Local/Temp/claude/x/out.txt" 2>&1', '', 'python -m unittest discover -s tests', 'Python tests (unittest): tests'],
  ['cd "C:/p" && cargo test chunk --release 2>&1 | tail -20', '', 'cargo test chunk --release', 'Rust tests (cargo): chunk'],
  ['"C:/Program Files/nodejs/npx.cmd" vitest run src/a.test.ts', 'Run the auth unit tests.', 'npx vitest run src/a.test.ts', 'Run the auth unit tests'],
  ['pytest tests/test_world.py -k "spawn"', '', 'pytest tests/test_world.py -k "spawn"', 'Python tests (pytest): test_world.py, spawn'],
  // The command from the screenshot: a loop watching a test log, started in the background.
  ['start=$(grep -c "^tick" tests/runs/p10-full.txt); until [ $(grep -c "^tick" tests/runs/p10-full.txt) -ge $((start + 50)) ]; do sleep 10; done', '', 'watching tests/runs/p10-full.txt', 'Waiting on a test run (p10-full.txt)'],
]
let n = 0
for (const [cmd, description, shown, title] of cases) {
  let strip
  await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `b${n++}`, command: cmd, description }, async () => {
    strip = stripOf(await render())
    return { text: 'OK' }
  })
  const t = globalThis.__store.get('crew').tests.at(-1)
  check(`shown as: ${shown}`, t.command === shown, t.command)
  check(`titled: ${title}`, t.purpose === title, t.purpose)
  const lines = strip.props.children.map(text)
  check(`running line: who and what for, marked a test, no raw command (${title})`, lines[0].startsWith('● 1 running') && lines[1].includes(`⚗ Claude ${title}`) && !lines.some(l => l.includes(' $ ')), JSON.stringify(lines))
}
check('tidying drops a whole `x=$(…)` assignment', !globalThis.__store.get('crew').log.some(l => /\$ -c "\^tick"/.test(l.text)), globalThis.__store.get('crew').log.map(l => l.text).find(l => l.includes('tick')))

// Eight runs in the background at once: one box, the newest first, the rest counted.
for (let i = 0; i < 8; i++)
  await hooks['tool.call']($, { tool: 'Bash', tool_use_id: `bg${i}`, command: `cargo test shard_${i}`, description: `Run test shard ${i}`, run_in_background: true }, async () => ({ text: `Command running in background with ID: bash_${i}` }))
const tree = await render()
const box = stripOf(tree)
const all = text(box)
check('eight runs share one line', find(tree, x => x.type === 'Box' && x.props.key === 'running').length === 1 && all.startsWith('● 8 running'), all.slice(0, 60))
check('it shows the newest two and counts the rest', all.includes('Run test shard 7') && all.includes('Run test shard 6') && !all.includes('Run test shard 5') && all.includes('+6 more'))
check('it marks the ones in the background', (all.match(/Claude ◌/g) ?? []).length === 2)
const svg = find(tree, x => x.type === 'Svg')[0]?.props.source ?? ''
check('the map counts them in a pill that fits', svg.includes('>×8</text>') && /<rect x="-?[\d.]+" y="-20" width="2[\d.]+"/.test(svg), svg.match(/<rect x="[-\d.]+" y="-20"[^>]*>/)?.[0])
console.log(`\n${fails} failing check(s)`)
