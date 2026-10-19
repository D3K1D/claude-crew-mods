// Long text fits its box on the desktop: the desktop never cuts a "truncate" Text short itself (it
// draws it whole and the box's edge clips it, with no "…"), so the pane cuts every such line to the
// room its row leaves. Here every line of every bordered box is measured against the box's inside,
// at several pane widths, with long goals, thoughts, actions, commands and log lines.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
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
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const plain = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(plain).join(''))
const width = t => [...t].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u.test(ch) ? 2 : 1), 0)

// A long prompt, a long thought, long actions, a long command running, and long log lines.
const long = 'When the claude moves downward in the tree from terminal and then downward within the same column to search or terminal etc, the curve line goes straight up and then down through the items'
await hooks['turn.start']($, { text: long, turnId: 'T' }, async () => ({}))
await hooks['session.append']($, { door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: `I think ${long.toLowerCase()} and so I will change the path to swing out to the side.` }] }, origin: {}, uuid: 'u' }, async () => ({}))
for (let i = 0; i < 3; i++) await hooks['tool.call']($, { tool: 'Read', tool_use_id: `r${i}`, file_path: `${P}/src/a-really-quite-long-folder-name/and-an-even-longer-file-name-number-${i}.generated.ts` }, async () => ({ text: 'ok' }))
let mid = []
await hooks['tool.call']($, { tool: 'Bash', tool_use_id: 'b1', command: 'npm run build', description: 'Build the whole project with every optional feature turned on so the bundle can be checked for size regressions' }, async () => {
  now += 3000
  for (const cols of [60, 97, 140, 200]) mid.push([cols, await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: cols, scroll: { bodyRows: 50 } }, viewport: { columns: cols } })])
  return { text: 'ok' }
})

// Every bordered box: each of its lines (a Text, or a row of them) is no wider than its inside.
for (const [cols, tree] of mid) {
  const over = []
  const walk = (x, avail) => {
    if (!x || typeof x !== 'object') return
    const p = x.props ?? {}
    if (x.type !== 'Box') return
    const own = typeof p.width === 'number' ? Math.min(p.width, avail) : avail
    const inside = own - (p.borderStyle ? 2 : 0) - 2 * (p.paddingX ?? 0)
    if (p.borderStyle)
      for (const line of kids(x)) {
        if (!line || typeof line !== 'object' || line.type === 'Svg' || line.type === 'Client' || line.props?.flexDirection === 'column' || line.props?.flexWrap) continue
        const t = plain(line)
        if (width(t) > inside) over.push(`${width(t)}>${inside}: ${t.slice(0, 50)}`)
      }
    for (const k of kids(x)) walk(k, p.flexWrap || (p.flexDirection ?? 'row') === 'column' ? inside : inside)
  }
  walk(tree, Math.floor(cols * 0.97) - 1)
  check(`${cols} cols: every line fits inside its box`, over.length === 0, over.slice(0, 3).join(' | '))
  // The goal line was the one in the screenshot: cut with "…".
  const goalLine = JSON.stringify(tree).includes('When the claude moves downward')
  check(`${cols} cols: the long goal is shown, cut short with "…"`, goalLine && /When the claude moves downward[^"]*…/.test(JSON.stringify(tree)))
}
// The running line, a row of its own: cut to the pane too.
{
  const [cols, tree] = mid[1]
  const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
  const run = find(tree, x => x.props?.key === 'running')[0]
  check('the running line fits the pane', !!run && width(plain(run)) <= Math.floor(cols * 0.97) - 1, run && `${width(plain(run))} of ${cols}: ${plain(run)}`)
}
console.log(`\n${fails} failing check(s)`)
