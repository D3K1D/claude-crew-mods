// A message you send shows in the log as yours ("You"), one row cut with "…" and a › that opens it
// whole; the viewer keeps its height. Commands read as Claude's words for them, with no shell prompt's $
// anywhere in the pane. Another session's message reads as from it, never the app's wrapper.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const { glyphs, words, pics, makePress } = await import('./kit.mjs')
let now = Date.parse('2031-01-01T08:21:54')
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
const regs = []
register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
const fire = (ev, e, bottom) => {
  const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
  const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
  return run(0)
}
const render = cols => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const press = makePress(elements, () => render(150), () => new Promise(r => setTimeout(r, 20)))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
// The viewer's rows: each row's words, left to right.
const rowsOf = t => {
  const by = new Map()
  for (const g of glyphs(t, 'view')) by.set(g.y, [...(by.get(g.y) ?? []), g])
  return [...by.values()].map(gs => gs.sort((a, b) => a.x - b.x).map(g => g.t).join(' '))
}

await fire('session.start', {}, async () => ({}))
const long = "I feel like we're going to have to keep hard coding stuff the entire time we're working on this project. And it's going to keep breaking every time the layout changes, so can we find a way to make the panels size themselves from what they hold instead, and then check it on a 1080p screen and a 4K one too?"
await fire('turn.start', { text: long, turnId: 'T' }, async () => ({}))
now += 35_000
await fire('tool.call', { tool: 'Bash', tool_use_id: 'b1', command: 'node tests/run.mjs rehearsal-7c', description: 'See why rehearsal 7c failed' }, async () => ({ text: 'ok' }))

for (const cols of [150, 100, 70]) {
  const t = await render(cols)
  const rows = rowsOf(t)
  const mine = rows.filter(r => / You I feel like/.test(r))
  check(`${cols} cols: your message is marked as yours, not "new task"`, mine.length === 1 && !rows.some(r => /new task/.test(r)), rows.find(r => /You/.test(r)))
  check(`${cols} cols: it is one row, cut with "…", with a › to open it whole`, /…/.test(mine[0] ?? '') && /›/.test(mine[0] ?? ''), mine[0])
  check(`${cols} cols: the viewer keeps its height (12 rows)`, pics(t)[1].height === 12 * 19)
  check(`${cols} cols: the command reads "See why rehearsal 7c failed"`, rows.some(r => /Claude See why rehearsal 7c failed/.test(r)), rows.at(-1))
  check(`${cols} cols: no $ anywhere in the pane`, !words(t).some(w => w.includes('$')), words(t).find(w => w.includes('$')))
}
await press('Show the whole line')
let t = await render(150)
const opened = rowsOf(t).filter(r => /panels size themselves|4K one too\?/.test(r))
check('opened, the message reads whole over the rows it needs', opened.length >= 1 && rowsOf(t).some(r => /4K one too\?$/.test(r)), rowsOf(t).join(' | '))
await press('Fold the line')
await press('Back to the latest')

// While it runs: its row and its line name the command without a $.
await fire('tool.call', { tool: 'Bash', tool_use_id: 'b2', command: 'cargo build', description: 'Build the game' }, async () => {
  const t = await render(150)
  check('while it runs, the pane names it "Build the game" and shows no $', words(t).some(w => /Build the game/.test(w)) && !words(t).some(w => w.includes('$')))
  return { text: 'ok' }
})

// A short message is one row, whole.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('turn.start', { text: 'thanks, ship it', turnId: 'U' }, async () => ({}))
t = await render(150)
check('a short message of yours is one row, whole', rowsOf(t).filter(r => / You Thanks, ship it$| You thanks, ship it$/.test(r)).length === 1, rowsOf(t).filter(r => /ship/.test(r)).join(''))

// A message another Claude session sent: its sender and words, never the app's wrapper.
const relay = (id, body) =>
  `<cross-session-message from="uds:\\\\.\\pipe\\LOCAL\\cc-msg-${id}" from-session="local_3a9ebe96-e007-4da8-ac79-8bac53e21eed" from-name="NPC Factory">\n${body}\n</cross-session-message>`
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'U', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('turn.start', { text: relay('738331bce6fa7d569a78a8979157e626', 'Merge D-16 and run the suite, then tell me which rehearsals still fail.'), turnId: 'V' }, async () => ({}))
let release
const reading = fire('tool.call', { tool: 'Read', tool_use_id: 'r9', file_path: `${P}/a.ts` }, () => new Promise(r => (release = r)))
await new Promise(r => setTimeout(r, 20))
t = await render(150)
check("another session's message is logged as a message from it", rowsOf(t).some(r => /NPC Factory: Merge D-16 and run the suite/.test(r)), rowsOf(t).find(r => /NPC/.test(r)))
check('...with none of the wrapper (no tag, pipe or session id) anywhere in the pane', !words(t).some(w => /cross-session|from-session|pipe|local_3a9e/.test(w)))
await press('Claude: Details')
t = await render(150)
check("...and the Claude's Details say what it asks", words(t, 'view').some(w => /Merge D-16 and run the suite/.test(w)), words(t, 'view').slice(0, 4).join(' | '))
await press('Activity')
release({ text: 'ok' })
await reading
// One logged before 1.3.8 (as yours, the wrapper and all) reads the same.
globalThis.__store.get('crew').log.push({ at: Date.now(), who: 'You', hue: 0, kind: 'you', text: relay('83e86450c568a0801507967244441cef', 'Old one: check the bus.').replace(/\n/g, ' ') })
t = await render(150)
check('a message logged the old way reads as from NPC Factory, not as raw tags', rowsOf(t).some(r => /NPC Factory: Old one: check the bus\./.test(r)) && !words(t).some(w => /cross-session/.test(w)), rowsOf(t).at(-1))
console.log(`\n${fails} failing check(s)`)
