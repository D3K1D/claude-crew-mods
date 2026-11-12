// After a burst of helpers the main Claude's desk stays its own height (the area's spare room never
// stretches it), and the area gives that room back a minute after they went. The whole chat's cost,
// as Claude Code's /cost totals it, shows in the header at every width and leads the spend row.
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
let usd = 0
let usageWorks = true
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async () => '', exists: async () => false, write: async () => {} },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P, usage: async () => { if (!usageWorks) throw new Error('no ledger'); return { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } } },
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
const tick = () => new Promise(r => setTimeout(r, 5))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const area = t => find(t, x => x.props?.key === 'desks')[0]
const header = t => text(kids(find(t, x => x.type === 'Box' && x.props.flexDirection === 'column' && x.props.rowGap === 1)[0])[0])
const usage = { input_tokens: 1000, output_tokens: 500, model: 'claude-opus-5-5' }

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Fan out', turnId: 'T' }, async () => ({}))
// Seven helpers at once, then all done and gone.
for (let i = 1; i <= 7; i++)
  await fire('tool.call', { tool: 'Agent', tool_use_id: `s${i}`, description: `Part ${i}`, prompt: `Do part ${i}`, subagent_type: 'general-purpose', run_in_background: true }, async e => {
    await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: `Do part ${i}`, description: `Part ${i}`, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: `sub${i}` }))
    return { text: 'Started in the background' }
  })
let t = await render(87)
const busyH = area(t).props.minHeight
check('eight Claudes at 87 columns: two lines each, and the area keeps room for them', busyH >= 8 * 2 && find(area(t), x => x.type === 'Svg').every(x => x.props.height === 38), `${busyH} · ${find(area(t), x => x.type === 'Svg').map(x => x.props.height).join(',')}`)
for (let i = 1; i <= 7; i++) await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: `S${i}`, agentId: `sub${i}`, usage }, async () => ({ text: 'ok' }))
now += 30_000
t = await render(87)
check('the rows stack, each its own height (none stretched to fill the room kept)', area(t).props.flexDirection === 'column', String(area(t).props.flexDirection))
check('...which it keeps for a while after they go, so the cards hold still', area(t).props.minHeight === busyH, String(area(t).props.minHeight))
now += 25_000
t = await render(87)
now += 40_000
t = await render(87)
check('a minute after they went, it gives the room back (still room for the rows left)', area(t).props.minHeight >= 2 * find(area(t), x => String(x.props?.key ?? '').startsWith('desk-')).length && area(t).props.minHeight < busyH, `${area(t).props.minHeight} for ${find(area(t), x => String(x.props?.key ?? '').startsWith('desk-')).length} rows`)

// The chat's cost: Claude Code's own total, at every width.
usd = 12.4
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T', usage }, async () => ({ text: 'ok' }))
await tick()
for (const cols of [60, 87, 120, 200]) {
  t = await render(cols)
  check(`${cols} cols: the header shows the chat's cost`, /chat \$12\.40/.test(header(t)), header(t))
}
const spend = find(t, x => x.props?.key === 'spend')[0]
check('the spend row leads with the chat total', /^spend chat \$12\.40/.test(text(spend)), text(spend))
// It follows Claude Code's ledger as the chat goes on.
usd = 15.05
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'U', usage }, async () => ({ text: 'ok' }))
await tick()
check('...and follows it as the chat goes on', /chat \$15\.05/.test(header(await render(87))), header(await render(87)))

// Where Claude Code keeps no ledger, what the crew counted stands in.
usageWorks = false
delete globalThis.__store.get('crew').chatCost
await fire('turn.start', { text: 'Again', turnId: 'V' }, async () => ({}))
await fire('turn.complete', { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'V', usage }, async () => ({ text: 'ok' }))
await tick()
t = await render(87)
check('with no ledger, the header shows what the crew counted', /chat \$\d+\.\d\d/.test(header(t)) && globalThis.__store.get('crew').chatCost === undefined, header(t))
console.log(`\n${fails} failing check(s)`)
