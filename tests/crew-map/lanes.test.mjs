// The lanes: one per Claude, hung on one thin tree. The main Claude's lane starts it (a dot, the line
// running down); each helper's lane carries the line on and branches off it, the last one ending it.
// Each lane's picture is exactly its lines tall, so the lanes stack into one unbroken tree. From six
// lanes up, each lane is one line; the plan track shows each task, and Codex gets a lane of its own.
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
  store: { get: async k => (k === 'intro' ? 'off' : k === 'theme' ? 'dark' : undefined), set: async () => {} },
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
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const lanes = t => kids(find(t, x => x.props?.key === 'desks')[0]).filter(x => String(x.props?.key ?? '').startsWith('desk-'))
const pic = d => find(d, x => x.type === 'Svg')[0]?.props
const spawn = id => fire('tool.call', { tool: 'Agent', tool_use_id: `sp${id}`, description: `Part ${id}`, prompt: `Do ${id}`, subagent_type: 'general-purpose', run_in_background: true }, async e => {
  await fire('agent.spawn', { tool_use_id: e.tool_use_id, prompt: `Do ${id}`, description: `Part ${id}`, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: id }))
  return { text: 'Started' }
})
const read = (agentId, f) => fire('tool.call', { tool: 'Read', tool_use_id: `r${now++}`, ...(agentId ? { agentId } : {}), file_path: `${P}/${f}` }, async () => ({ text: 'ok' }))

await fire('session.start', {}, async () => ({}))
await fire('turn.start', { text: 'Fan out', turnId: 'T' }, async () => ({}))
await read(undefined, 'src/a.ts')
await spawn('s1')
await spawn('s2')
await read('s1', 'src/b.ts')
await read('s2', 'src/c.ts')
let t = await render()
let L = lanes(t)
check('three lanes: the main Claude first, then its helpers in the order they started', L.map(d => d.props.key).join(',') === 'desk-main,desk-s1,desk-s2', L.map(d => d.props.key).join(','))
check('the main lane starts the tree: a dot, and the line running down', /<circle cx="7" cy="19" r="3\.2"/.test(pic(L[0]).source) && /<path d="M7 19V38"/.test(pic(L[0]).source))
check('a helper in between carries the line on, and branches off it', /<path d="M7 0V38"/.test(pic(L[1]).source) && /<path d="M7 19H18"/.test(pic(L[1]).source))
check('the last helper ends the line at its branch', /<path d="M7 0V19"/.test(pic(L[2]).source) && !/<path d="M7 0V38"/.test(pic(L[2]).source))
check('every picture is its two lines tall (38 px), so the tree joins up', L.every(d => pic(d).height === 38))

// A plan: the track has a dot per task, the done ones filled, the Claude on the one in progress.
const task = (agentId, id, subject) => fire('tool.call', { tool: 'TaskCreate', tool_use_id: `t${id}`, agentId, subject, description: subject, activeForm: subject }, async () => ({ result: { task: { id, subject } }, text: 'ok' }))
const status = (agentId, id, s) => fire('tool.call', { tool: 'TaskUpdate', tool_use_id: `u${id}${s}`, agentId, taskId: id, status: s }, async () => ({ result: { success: true, taskId: id, updatedFields: ['status'] }, text: 'ok' }))
for (const [id, sub] of [['1', 'Read the docs'], ['2', 'Write the parser'], ['3', 'Test it'], ['4', 'Ship it']]) await task('s1', id, sub)
await status('s1', '1', 'completed')
await status('s1', '2', 'in_progress')
t = await render()
const s1 = pic(lanes(t)[1]).source
const dots = [...s1.matchAll(/<circle cx="([\d.]+)" cy="32" r="3\.2" fill="([^"]+)"/g)]
check('a plan of four: four dots on the track, one done', dots.length === 4 && dots.filter(d => d[2] !== 'none').length === 1, dots.map(d => d[2]).join(','))
// The last group placed in the picture is the Claude (the first is the tile's icon).
const sprite = [...s1.matchAll(/<g transform="translate\(([\d.]+),/g)].at(-1)
check('...the Claude standing on the second, the one in progress', !!sprite && Math.abs(Number(sprite[1]) + 12 - Number(dots[1][1])) < 0.6, `${sprite?.[1]} vs ${dots[1]?.[1]}`)
check('...and the lane says "2 of 4"', /2 of 4/.test(text(lanes(t)[1])), text(lanes(t)[1]))

// Six lanes and up: one line each, the pictures one row tall.
for (const id of ['s3', 's4', 's5']) { await spawn(id); await read(id, `src/${id}.ts`) }
t = await render()
L = lanes(t)
check('six lanes: each one line, its picture one row tall', L.length === 6 && L.every(d => kids(kids(kids(d)[0])[1]).length === 1 && pic(d).height === 19), L.map(d => `${kids(kids(kids(d)[0])[1]).length}/${pic(d).height}`).join(','))
check('...and no line runs past the pane at 87 columns', L.every(d => text(kids(kids(kids(d)[0])[1])[0]).length <= Math.floor(87 * 0.97) - 1 - 4 - Math.ceil(pic(d).width / 7.9)), L.map(d => text(d).length).join(','))
console.log(`\n${fails} failing check(s)`)
