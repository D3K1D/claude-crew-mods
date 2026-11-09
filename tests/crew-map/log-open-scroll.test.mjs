// A log line cut short has a › to open it whole, over as many rows as it needs (⌄ folds it). ▲ and ▼
// scroll the log back and forth; scrolled back (or with a line open) it holds still while new lines
// come in below, says how many, and ⤓ latest follows again. A desk with a line cut short has › more.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
let now = Date.parse('2031-01-01T09:00:00')
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
const render = (cols = 87) => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } }, async () => ({}))
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const logBox = t => find(t, x => x.type === 'Box' && x.props.borderStyle && /^\s*log\b/i.test(text(kids(x)[0])))[0]
const logRows = t => kids(logBox(t)).slice(1)
const logText = t => logRows(t).map(text).join('\n')
const button = (t, pred) => find(t, x => x.type === 'Button' && pred(String(x.props.key ?? ''), text(x)))[0]
const press = async b => { b.props.onPress(); await tick() }
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
check('the log is its 12 rows', logRows(t).length === 12, String(logRows(t).length))
const opener = button(t, k => k.startsWith('logopen:'))
check('a thought cut short has a › to open it', !!opener && text(opener) === ' ›', opener && text(opener))
check('a line that fits has no ›', !button(t, (k, l) => k.startsWith('logopen:') && false) && logRows(t).filter(r => /Step number 14/.test(text(r))).every(r => !find(r, x => x.type === 'Button').length))
check('following: no ▼ and no ⤓ latest', !button(t, k => k === 'log-down') && !button(t, k => k === 'log-latest'))

// Open it: all of it, over as many rows as it takes, every word; the log holds still.
await press(opener)
t = await render()
const said = logRows(t).filter(r => kids(r)[1] && /^\s*$|Claude/.test(text(kids(r)[1])) && kids(r).length === 4).map(r => text(kids(r)[3]).trim())
const at = said.findIndex(s => s.startsWith('The save bug'))
const whole = said.slice(at).join(' ')
check('opened, the thought reads whole over several rows', at >= 0 && whole === long, whole)
check('...its mark is now ⌄ to fold it', text(button(t, k => k.startsWith('logopen:'))) === ' ⌄')
check('...and the log holds there: ⤓ latest shows', !!button(t, k => k === 'log-latest'))

// New lines come in while it's held: what shows stays, and it counts them.
const before = logText(t)
await act('A newer step')
await act('Another newer step')
t = await render()
check('held: new lines do not move it', logText(t) === before)
check('...and it says how many came in', /⤓ latest · 2 new/.test(text(button(t, k => k === 'log-latest'))), text(button(t, k => k === 'log-latest')))

// Scroll back with ▲, forward with ▼.
await press(button(t, k => k === 'log-up'))
t = await render()
check('▲ shows older lines', /Step number 8\b/.test(logText(t)) && !/A newer step/.test(logText(t)), logText(t).split('\n')[0])
await press(button(t, k => k === 'log-down'))
await press(button(await render(), k => k === 'log-down'))
t = await render()
check('▼ back to the newest follows again', /Another newer step/.test(logText(t)) && !button(t, k => k === 'log-latest'))
// Fold the thought again (found by its ⌄), then ⤓ latest from a scrolled-back log.
await press(button(t, k => k.startsWith('logopen:') && text(button(t, x => x === k)) === ' ⌄') ?? button(t, k => k.startsWith('logopen:')))
t = await render()
check('folded, the log is its 12 rows again', logRows(t).length === 12, String(logRows(t).length))
await press(button(t, k => k === 'log-up'))
await press(button(await render(), k => k === 'log-up'))
t = await render()
check('scrolled back, ⤓ latest shows', !!button(t, k => k === 'log-latest'))
await press(button(t, k => k === 'log-latest'))
await act('The very latest step')
t = await render()
check('⤓ latest: following again, the newest line at the bottom', /The very latest step/.test(text(logRows(t).at(-1))) && !button(t, k => k === 'log-latest'), text(logRows(t).at(-1)))
check('no row of the log runs past it at 87 columns', logRows(t).every(r => text(r).length <= Math.floor(87 * 0.97) - 1 - 4), logRows(t).map(r => text(r).length).join(','))

// A long message of yours: three rows, then › opens the rest.
const msg = Array.from({ length: 12 }, (_, i) => `point ${i + 1} is that the inventory panel should keep its size when items come and go`).join('; ')
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage: { input_tokens: 1, output_tokens: 1, model: 'claude-opus-5-5' } }, async () => ({ text: 'ok' }))
now += 1000
await fire('turn.start', { text: msg, turnId: 'U' }, async () => ({}))
t = await render()
const youOpen = logRows(t).find(r => /You/.test(text(kids(r)[1] ?? '')) && find(r, x => x.type === 'Button').length)
check('a long message of yours has a › on its first row', !!youOpen)
await press(find(youOpen, x => x.type === 'Button')[0])
t = await render()
const mine = logRows(t).filter(r => kids(r).length === 4 && kids(r)[1].props?.width && kids(r)[0].props?.width === 9)
const yAt = mine.findIndex(r => /You/.test(text(kids(r)[1])))
const yRows = mine.slice(yAt).map(r => text(kids(r)[3]).trim())
check('opened, all of your message reads, every word', yRows.join(' ') === msg, `${yRows.length} rows`)

// A helper's desk: its job in short, and › more opens all it was asked; ⌄ less folds it.
const job = 'Rebuild the inventory panel so it keeps its size when items come and go, then check it at 1080p and 4K on Windows and macOS, and write the notes for the release'
await fire('tool.call', { tool: 'Agent', tool_use_id: 'sp1', description: 'Inventory panel', prompt: job, subagent_type: 'general-purpose', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: job, description: 'Inventory panel', subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: 'sub1' }))
  return { text: 'Started in the background' }
})
const desk = t => find(t, x => x.props?.key === 'desk-sub1')[0]
t = await render()
const more = find(desk(t), x => x.type === 'Button' && x.props.key === 'deskopen:sub1')[0]
check('a helper asked more than its job says has › more', !!more && /› more/.test(text(more)))
const folded = kids(desk(t)).length
await press(more)
t = await render()
const jobRows = kids(kids(kids(desk(t))[0]).find(k => k.type === 'Box')).slice(1).map(x => text(x).trim())
check('opened, the desk reads all it was asked', jobRows.join(' ') === `Inventory panel: ${job}`, jobRows.join(' | '))
check('...and says ⌄ less', /⌄ less/.test(text(find(desk(t), x => x.type === 'Button' && x.props.key === 'deskopen:sub1')[0])))
await press(find(desk(t), x => x.type === 'Button' && x.props.key === 'deskopen:sub1')[0])
check('⌄ less folds it back to its size', kids(desk(await render())).length === folded && kids(kids(kids(desk(await render()))[0]).find(k => k.type === 'Box')).length === 3)
console.log(`\n${fails} failing check(s)`)
