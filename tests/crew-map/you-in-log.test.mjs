// A message you send shows in the log as yours ("You"), over up to three rows that start under each
// other, the last cut with "…"; the log keeps its height. Commands read as ▸ and Claude's words for
// them, with no shell prompt's $ anywhere in the pane.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
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
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const render = cols => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
// The log box: the bordered box whose title row says "log".
const logBox = t => find(t, x => x.type === 'Box' && x.props.borderStyle && /^\s*log\b/i.test(text(kids(x)[0])))[0]
const rowsOf = box => kids(box).slice(1)

await fire('session.start', {}, async () => ({}))
const long = "I feel like we're going to have to keep hard coding stuff the entire time we're working on this project. And it's going to keep breaking every time the layout changes, so can we find a way to make the panels size themselves from what they hold instead, and then check it on a 1080p screen and a 4K one too?"
await fire('turn.start', { text: long, turnId: 'T' }, async () => ({}))
now += 35_000
await fire('tool.call', { tool: 'Bash', tool_use_id: 'b1', command: 'node tests/run.mjs rehearsal-7c', description: 'See why rehearsal 7c failed' }, async () => ({ text: 'ok' }))

for (const cols of [150, 100, 70]) {
  const t = await render(cols)
  const box = logBox(t)
  const rows = rowsOf(box)
  const youText = rows.map(text).join('\n')
  check(`${cols} cols: your message is marked as yours, not "new task"`, /08:21:54\s*You\s+(› )?I feel like/.test(youText) && !/new task/.test(youText), youText.split('\n').find(l => /You/.test(l)))
  const mine = rows.filter(r => r.type === 'Box' && kids(r)[1]?.props?.width && /You|^\s*$/.test(text(kids(r)[1])) && kids(r)[1].props.width >= 6 && kids(r)[0].props?.width === 9)
  check(`${cols} cols: it takes up to three rows, whole or cut with "…", no words lost between rows`, mine.length === 3 && /(…|4K one too\?)$/.test(text(mine[2]).trimEnd()) && long.startsWith(mine.map(r => text(kids(r)[3]).trim()).join(' ').replace(/…$/, '')), mine.map(text).join(' | '))
  check(`${cols} cols: every row of it starts in the same column (fixed-width time and name)`, mine.every(r => kids(r)[0].props.width === 9 && kids(r)[1].props.width === kids(mine[0])[1].props.width))
  const inner = Math.floor(cols * 0.97) - 1 - 4
  check(`${cols} cols: no row of it runs past the log box`, mine.every(r => 9 + kids(r)[1].props.width + 2 + text(kids(r)[3]).length <= inner), mine.map(r => 9 + kids(r)[1].props.width + 2 + text(kids(r)[3]).length).join(','))
  check(`${cols} cols: the log keeps its height (12 rows)`, rows.length === 12, String(rows.length))
  check(`${cols} cols: the command reads "▸ See why rehearsal 7c failed"`, /Claude\s+▸ See why rehearsal 7c failed/.test(youText), youText.split('\n').at(-1))
  check(`${cols} cols: no $ anywhere in the pane`, !/\$/.test(text(t)), (text(t).match(/.{0,30}\$.{0,30}/) ?? [''])[0])
}

// While it runs: the desk, the window and the bubble name the command without a $.
await fire('tool.call', { tool: 'Bash', tool_use_id: 'b2', command: 'cargo build', description: 'Build the game' }, async () => {
  const t = await render(150)
  check('while it runs, the pane names it "Build the game" and shows no $', /Build the game/.test(text(t)) && !/\$/.test(text(t)))
  return { text: 'ok' }
})

// A short message is one row, and the log still keeps its height.
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('turn.start', { text: 'thanks, ship it', turnId: 'U' }, async () => ({}))
const t = await render(150)
const rows = rowsOf(logBox(t))
check('a short message of yours is one row', rows.filter(r => /You\s*thanks, ship it/.test(text(r))).length === 1, rows.map(text).filter(l => /ship/.test(l)).join(''))
check('...and the log still keeps its height', rows.length === 12, String(rows.length))

// A message another Claude session sent: its sender and words, never the app's wrapper.
const relay = (id, body) =>
  `<cross-session-message from="uds:\\\\.\\pipe\\LOCAL\\cc-msg-${id}" from-session="local_3a9ebe96-e007-4da8-ac79-8bac53e21eed" from-name="NPC Factory">\n${body}\n</cross-session-message>`
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'U', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
await fire('turn.start', { text: relay('738331bce6fa7d569a78a8979157e626', 'Merge D-16 and run the suite, then tell me which rehearsals still fail.'), turnId: 'V' }, async () => ({}))
await fire('tool.call', { tool: 'Read', tool_use_id: 'r9', file_path: `${P}/a.ts` }, async () => {
  const t2 = await render(150)
  const all = text(t2)
  const logText = rowsOf(logBox(t2)).map(text).join('\n')
  check("another session's message is logged as a message from it", /Msg\s*NPC Factory: Merge D-16 and run the suite, then tell me which rehearsals still fail\./.test(logText), logText.split('\n').find(l => /NPC/.test(l)))
  check('...with none of the wrapper (no tag, pipe or session id) anywhere in the pane', !/cross-session|from-session|pipe|local_3a9e/.test(all), (all.match(/.{0,20}(cross-session|from-session|pipe).{0,20}/) ?? [''])[0])
  const goalRow = find(t2, x => x.type === 'Box' && x.props.flexDirection === 'row' && text(kids(x)[0]).trim() === 'goal')[0]
  check("...and the window's goal is what it asks", /^goal\s*Merge D-16 and run the suite/.test(text(goalRow)), text(goalRow))
  return { text: 'ok' }
})
// One logged before 1.3.8 (as yours, the wrapper and all) reads the same.
globalThis.__store.get('crew').log.push({ at: Date.now(), who: 'You', hue: 0, kind: 'you', text: relay('83e86450c568a0801507967244441cef', 'Old one: check the bus.').replace(/\n/g, ' ') })
const t3 = await render(150)
const old = rowsOf(logBox(t3)).map(text).join('\n')
check('a message logged the old way reads as from NPC Factory, not as raw tags', /Msg\s*NPC Factory: Old one: check the bus\./.test(old) && !/cross-session/.test(old), old.split('\n').at(-1))
check('...and the log still keeps its height', rowsOf(logBox(t3)).length === 12, String(rowsOf(logBox(t3)).length))
console.log(`\n${fails} failing check(s)`)
