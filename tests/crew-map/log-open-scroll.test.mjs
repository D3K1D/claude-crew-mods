// A log line cut short has a › to open it whole, over as many rows as it needs (▾ folds it). ▲ and ▼
// scroll the log back and forth; scrolled back (or with a line open) it holds still while new lines
// come in below, says how many, and ⤓ latest follows again. A desk with a line cut short has › more.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T09:00:00')
Date.now = () => now
const P = 'C:/work/game'
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async () => undefined, set: async () => {} },
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
const render = (cols = 87) => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const { lines, glyphs, words, pics, find: findIn, text: textOf, viewHeight } = await import('./kit.mjs')
// The viewer's rows: each row's words, left to right, as one string.
const logRows = t => lines(t, 'view').map(l => l.map(g => g.t).join(' '))
const logText = t => logRows(t).join('\n')
const mark = (t, w) => glyphs(t, 'view').concat(glyphs(t, 'top')).find(g => g.t === w)
// Presses a target by its label (the last one drawn, when several share it: the newest line).
const press = async label => {
  const saved = elements.Client
  elements.Client = undefined
  const t = await render()
  elements.Client = saved
  const want = { 'Show the whole line': '›', 'Fold the line': '▾', 'Scroll up': '▲ older', 'Scroll down': '▼ newer', 'Back to the latest': '⤓ latest' }[label] ?? label
  const b = findIn(t, x => x.type === 'Button' && textOf(x) === want).at(-1)
  if (!b) throw new Error('no target ' + label)
  await b.props.onPress({ surface: 'desktop' })
  await tick()
}
const say = (agentId, words) => fire('session.append', { ...(agentId ? { agentId } : {}), door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: words }] }, origin: {}, uuid: `u${now}` }, async () => ({}))
let n = 0
const act = async what => { now += 1000; await fire('tool.call', { tool: 'Bash', tool_use_id: `b${n++}`, command: 'x', description: what }, async () => ({ text: 'ok' })) }

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Fix the save bug', turnId: 'T' }, async () => ({}))
for (let i = 1; i <= 14; i++) await act(`Step number ${i}`)
// A long thought: its gist in the log, and all of it behind the ›.
now += 1000
const long = 'The save bug comes from the slot index being read before the profile loads. So the fix is to wait for the profile, then read the slot, and add a test that loads a profile slowly to prove the order holds on every platform we ship to.'
await say(undefined, long)
let t = await render()
check('the viewer is its 12 rows', viewHeight(t) === 12 && logRows(t).length <= 12, String(logRows(t).length))
check('a thought cut short has a › to open it', logRows(t).some(r => /^\S+ Claude The save bug .*… ›/.test(r)), logRows(t).at(-1))
check('a line that fits has no ›', logRows(t).filter(r => /Step number 14/.test(r)).every(r => !r.includes('›')))
check('following: ▼ newer is dim (nowhere newer to go), and so is ⤓ latest', mark(t, '▼ newer')?.role === 'dim' && mark(t, '⤓ latest')?.role === 'dim')

// Open it: all of it, over as many rows as it takes, every word; the log holds still.
await press('Show the whole line')
t = await render()
const rows = logRows(t)
const at = rows.findIndex(r => /Claude The save bug/.test(r))
const whole = [rows[at]?.replace(/^\S+ Claude /, '').replace(/ ▾( \S+)?$/, ''), ...rows.slice(at + 1)].join(' ')
check('opened, the thought reads whole over several rows', at >= 0 && whole.replace(/ ▾/, '') === long.replace(/^the/, 'The'), whole)
check('...its mark is now ▾ to fold it', rows[at]?.includes('▾'))
check('...and the log holds there: ⤓ latest lights up', mark(t, '⤓ latest')?.role === 'text')

// New lines come in while it's held: what shows stays.
const before = logText(t)
await act('A newer step')
await act('Another newer step')
t = await render()
check('held: new lines do not move it', logText(t) === before)

// Scroll back with ▲, forward with ▼.
await press('Fold the line')
await press('Scroll up')
t = await render()
check('▲ shows older lines', /Step number 8\b/.test(logText(t)) && !/A newer step/.test(logText(t)), logRows(t)[0])
await press('Scroll down')
await press('Scroll down')
await press('Scroll down')
t = await render()
check('▼ back to the newest follows again', /Another newer step/.test(logText(t)) && mark(t, '⤓ latest')?.role === 'dim', logRows(t).at(-1))
check('folded, the log is its 12 rows again', logRows(t).length <= 12 && viewHeight(t) === 12)
await press('Scroll up')
await press('Scroll up')
t = await render()
check('scrolled back, ⤓ latest lights up', mark(t, '⤓ latest')?.role === 'text')
await press('Back to the latest')
await act('The very latest step')
t = await render()
check('⤓ latest: following again, the newest line at the bottom', /The very latest step/.test(logRows(t).at(-1)) && mark(t, '⤓ latest')?.role === 'dim', logRows(t).at(-1))
{
  const { find: f2 } = await import('./kit.mjs')
  const view = f2(t, x => x.type === 'Box' && x.props?.key === 'view')[0]
  const rows = f2(view, x => x.type === 'Box' && x.props?.height === 1)
  check('every row of the log is one line, cut to the pane (never past it)', rows.length > 0 && rows.every(r => r.props.overflow === 'hidden'))
}

// A long message of yours: one row, then › opens the rest.
const msg = Array.from({ length: 12 }, (_, i) => `point ${i + 1} is that the inventory panel should keep its size when items come and go`).join('; ')
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
now += 1000
await fire('turn.start', { text: msg, turnId: 'U' }, async () => ({}))
t = await render()
check('a long message of yours has a › on its row', logRows(t).some(r => / You Point 1 is that .*›$|  You point 1 .*›$/.test(r) || (/ You /.test(r) && r.endsWith('›'))), logRows(t).at(-1))
await press('Show the whole line')
t = await render()
const all = logRows(t)
const yAt = all.findIndex(r => / You /.test(r))
const yWhole = [all[yAt]?.replace(/^\S+ You /, '').replace(/ ▾$/, ''), ...all.slice(yAt + 1)].join(' ')
check('opened, your message reads from its start over the whole viewer, word for word, cut with … only past its 12 rows', all.length === 12 && yAt === 0 && yWhole.endsWith('…') && msg.toLowerCase().startsWith(yWhole.slice(0, -1).trimEnd().toLowerCase()), yWhole.slice(-80))
await press('Fold the line')
await press('Back to the latest')

// A helper's Details: all it was asked.
const job = 'Rebuild the inventory panel so it keeps its size when items come and go, then check it at 1080p and 4K on Windows and macOS, and write the notes for the release'
await fire('tool.call', { tool: 'Agent', tool_use_id: 'sp1', description: 'Inventory panel', prompt: job, subagent_type: 'general-purpose', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: job, description: 'Inventory panel', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  return { text: 'Started in the background' }
})
const name = globalThis.__store.get('crew').agents.find(a => a.id === 'sub1').name
const { makePress, find: f3, text: t3 } = await import('./kit.mjs')
const pressRow = makePress(elements, () => render(), tick)
await pressRow(`${name}: Details`)
t = await render()
check("each row's Details opens what the helper was asked, whole", words(t, 'view').join(' ').replace(/\s+/g, ' ').includes(job), words(t, 'view').join(' | ').slice(0, 300))
check('...its row says Hide', f3(t, x => x.type === 'Button' && t3(x) === 'Hide').length === 1)
await pressRow(`${name}: Hide`)
check('pressed again, the viewer goes back to Activity', !f3(await render(), x => x.type === 'Button' && t3(x) === 'Hide').length)
console.log(`\n${fails} failing check(s)`)
