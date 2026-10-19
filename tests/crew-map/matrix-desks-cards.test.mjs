// Release matrix for the default view (desks and folder cards): many Claudes, many files, odd
// names, widths 40-300, search, pruning, waiting on you, Codex. Each check states the correct
// behaviour, so a failure is a bug to fix.
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const P = 'C:/work/game'
const kids = x => (x && typeof x === 'object' ? (x.children ?? x.props?.children ?? []) : [])
const text = x => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(text).join(''))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of kids(x)) find(c, pred, out); return out }
const byKey = (tree, key) => find(tree, x => x.props?.key === key)[0]
const tick = () => new Promise(r => setTimeout(r, 2))
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u
const cells = s => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0)
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }

// A fresh mod per scenario (its module state included).
let inst = 0
const fresh = async () => {
  globalThis.__store = new Map()
  const { register } = await import(`../.build/crew-map.mjs?matrix=${inst++}`)
  const E = { now: Date.parse('2031-01-01T10:00:00'), ran: [], codexRuns: [] }
  Date.now = () => E.now
  const $ = {
    command: { register: async () => {} },
    ui: { open: async () => {}, resolve: () => elements, toast: async () => {} },
    clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
    fs: { read: async () => '', exists: async () => false, write: async () => {} },
    store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
    session: { cwd: async () => P },
    env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
    state: { get: async () => ({ value: E.codexRuns }) },
    process: { run: async argv => (E.ran.push(argv), { exitCode: 0, stdout: '', stderr: '' }) },
  }
  const regs = []
  register((ev, m, fn) => { regs.push({ ev, m: fn ? m : {}, fn: fn ?? m }); return { catch() {} } }, {})
  const fire = (ev, e, bottom = async () => ({})) => {
    const mine = regs.filter(r => r.ev === ev && Object.entries(r.m).every(([k, v]) => e[k] === v))
    const run = i => (i < mine.length ? mine[i].fn($, e, x => run(i + 1, x)) : bottom(e))
    return run(0)
  }
  let n = 0
  E.fire = fire
  E.crew = () => globalThis.__store.get('crew')
  E.call = (tool, input, more = {}) => fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input, ...more }, async () => ({ text: 'ok' }))
  /** A call held open (its Claude stays busy on it); returns the function that ends it. */
  E.begin = async (tool, input, more = {}) => {
    let done
    const gate = new Promise(r => (done = r))
    const p = fire('tool.call', { tool, tool_use_id: `c${n++}`, ...input, ...more }, async () => { await gate; return { text: 'ok' } })
    await tick()
    return async () => { done(); await p; await tick() }
  }
  E.spawn = id => fire('agent.spawn', { tool_use_id: `sp-${id}`, prompt: 'Do it', description: id, subagentType: 'general-purpose', provider: {}, parentModel: 'm' }, async () => ({ agentId: id }))
  E.render = (cols = 150, surface = 'desktop') => fire('ui.render', { component: 'Pane', requestId: 'crew-map', surface, props: { bodyColumns: cols, scroll: { bodyRows: 60 } }, viewport: { columns: cols } })
  E.search = q => fire('ui.message', { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'search', module: './search.tsx', data: { q } })
  E.press = async (tree, key) => { const b = byKey(tree, key); if (!b) throw new Error(`no ${key}`); await b.props.onPress(); await tick() }
  await fire('session.start', {})
  await fire('turn.start', { text: 'Fix the login flow', turnId: 'T' })
  return E
}
const deskKeys = t => kids(byKey(t, 'desks')).map(d => d.props.key)
const cardNames = t => kids(byKey(t, 'cards')).map(c => text(find(kids(c)[0], x => x.type === 'Text' && x.props.color === '#E3B95C')[0]).replace(/^📁 /, ''))
const chipKeys = t => find(byKey(t, 'cards'), x => x.type === 'Button' && String(x.props.key).startsWith('file:')).map(b => b.props.key.slice(5))
const WIDTHS = [40, 60, 80, 100, 120, 150, 200, 300]

// ── 1. Desks: 0, 1, 3, 6, 10 Claudes at work, every width: one desk each, all the same height ──
for (const N of [0, 1, 3, 6, 10]) {
  const E = await fresh()
  if (N) await E.begin('Read', { file_path: `${P}/src/main.ts` })
  for (let i = 1; i < N; i++) {
    await E.spawn(`s${i}`)
    await E.begin('Read', { file_path: `${P}/src/mod${i}/file_${i}.ts` }, { agentId: `s${i}` })
  }
  for (const cols of WIDTHS) {
    const t = await E.render(cols)
    const desks = kids(byKey(t, 'desks'))
    const ok = desks.length === Math.max(1, N) && desks.every(d => kids(d).length === 4 && d.props.borderStyle && typeof d.props.width === 'number' && d.props.width <= cols)
    if (!ok || cols === 150) check(`${N} at work, ${cols} cols: ${Math.max(1, N)} desks, four rows each, within the pane`, ok, desks.map(d => `${d.props.width}w/${kids(d).length}r`).join(','))
    const raw = text(t).match(/undefined|NaN|\[object Object\]/g)
    if (raw) check(`${N} at work, ${cols} cols: no raw internal text`, false, raw.join(','))
  }
  const tt = await E.render(100, 'terminal')
  check(`${N} at work: the terminal surface draws the desks too`, kids(byKey(tt, 'desks')).length === Math.max(1, N) && !/undefined|NaN|\[object Object\]/.test(text(tt)))
}

// ── 2. A desk and a card line up when each fills the row (narrow panes) ──
{
  const E = await fresh()
  await E.call('Read', { file_path: `${P}/src/a.ts` })
  for (const cols of [40, 60, 80]) {
    const t = await E.render(cols)
    const dw = kids(byKey(t, 'desks'))[0].props.width
    const cw = kids(byKey(t, 'cards'))[0].props.width
    // Desks may sit two across where a card fills the row: their edges line up either way.
    const across = Math.round((cw + 1) / (dw + 1))
    check(`${cols} cols: desks line up with the folder card below (same outer edges)`, across * dw + (across - 1) === cw, `desk ${dw} ×${across}, card ${cw}`)
  }
}

// ── 3. Waiting on you: the desk turns amber but keeps its place ──
{
  const E = await fresh()
  await E.call('Read', { file_path: `${P}/src/a.ts` })
  for (const id of ['s1', 's2', 's3']) { await E.spawn(id); await E.begin('Read', { file_path: `${P}/src/${id}.ts` }, { agentId: id }) }
  const before = deskKeys(await E.render(150))
  let release
  const pr = E.fire('classic.PermissionRequest', { agent_id: 's3', tool_name: 'Edit', tool_input: { file_path: `${P}/src/s3.ts` } }, () => new Promise(r => (release = r)))
  await tick()
  const t = await E.render(150)
  const during = deskKeys(t)
  check('a helper waiting on you keeps its desk where it was (desks do not reorder)', JSON.stringify(before) === JSON.stringify(during), `${before} → ${during}`)
  check('...and its desk says what it waits for, in amber', /editing s3\.ts/.test(text(byKey(t, 'desk-s3'))) && byKey(t, 'desk-s3').props.borderColor === '#E3B341')
  release({ decision: 'allow' })
  await pr
}

// ── 4. What a desk says: a running command is not "ran"; compacting names no folder ──
{
  const E = await fresh()
  await E.call('Read', { file_path: `${P}/src/a.ts` })
  const end = await E.begin('Bash', { command: 'npm run build', description: 'Build the app' })
  const main = byKey(await E.render(150), 'desk-main')
  check('a desk running a command does not describe it in the past tense', !/\bran\b/.test(text(kids(main)[1])), text(main))
  await end()
  let release
  const comp = E.fire('session.compact', { trigger: 'auto', messages: [1, 2, 3] }, () => new Promise(r => (release = r)))
  await tick()
  const desk = byKey(await E.render(150), 'desk-main')
  check('a compacting desk says so and names no folder it is not in', /compacting/.test(text(kids(desk)[1])) && text(kids(desk)[2]).trim() === '', kids(desk).slice(1).map(text).join(' / '))
  release({ messages: [1] })
  await comp
}

// ── 5. Codex: every running run is shown (or counted) ──
{
  const E = await fresh()
  const run = id => ({ id, task: 't', mode: 'write', root: P, cwd: P, model: 'm', effort: 'e', status: 'running', startedAt: E.now - 10_000, endedAt: 0, thread: id, resumed: false, caller: 'main', activity: 'Running tests', focus: '', touched: [], events: [], files: [], commands: 0, failedCommands: 0, answer: '', notesUpdated: false })
  E.codexRuns.push(run('cx1'), run('cx2'), run('cx3'), run('cx4'))
  const t = await E.render(150)
  const cx = deskKeys(t).filter(k => k.startsWith('desk-cx-'))
  check('four Codex runs at work: four desks, or the ones not shown counted', cx.length === 4 || /\+\d+ more Codex/.test(text(byKey(t, 'desks'))), cx.join(','))
  const d = byKey(t, 'desk-cx-cx1')
  check('a Codex desk does not say the same thing twice', text(kids(d)[1]) !== text(kids(d)[2]), kids(d).slice(1).map(text).join(' / '))
}

// ── 6. Folder order stays as first reached, past MAX_NODES ──
{
  const E = await fresh()
  for (let i = 0; i < 72; i++) await E.call('Read', { file_path: `${P}/src/d${i % 9}/f${i}.ts` })
  const names = cardNames(await E.render(150))
  check('72 files in 9 folders: the folders stay in the order the work first reached them', JSON.stringify(names) === JSON.stringify(Array.from({ length: 9 }, (_, i) => `src/d${i}`)), names.join(','))
}

// ── 7. An edited file keeps its chip after many newer reads ──
{
  const E = await fresh()
  await E.call('Edit', { file_path: `${P}/src/core/engine.ts`, old_string: 'a', new_string: 'b\nc' })
  for (let i = 0; i < 61; i++) { E.now += 1000; await E.call('Read', { file_path: `${P}/lib/r${i}.ts` }) }
  const t = await E.render(150)
  check('an edited file keeps its chip (and its folder card) after 61 newer reads', !!byKey(t, `file:${P}/src/core/engine.ts`), cardNames(t).join(','))
}

// ── 8. A card shows the files that matter without opening it ──
{
  const E = await fresh()
  for (let i = 0; i < 12; i++) await E.call('Read', { file_path: `${P}/src/core/m${i}.ts` })
  await E.call('Edit', { file_path: `${P}/src/core/zz_broken.ts`, old_string: 'a', new_string: 'b' })
  globalThis.__store.set('crew', { ...E.crew(), problems: [{ path: `${P}/src/core/zz_broken.ts`, line: 1, message: 'boom', source: 'tsc', by: 'Claude', at: E.now }] })
  await E.spawn('s1')
  await E.begin('Read', { file_path: `${P}/src/core/zz_busy.ts` }, { agentId: 's1' })
  const keys = chipKeys(await E.render(150))
  check('a folded card still shows the file a Claude is on', keys.includes(`${P}/src/core/zz_busy.ts`), keys.map(k => k.split('/').pop()).join(','))
  check('...and the edited file with errors', keys.includes(`${P}/src/core/zz_broken.ts`))
  check('...and chips sort by number naturally (m2 before m10)', keys.indexOf(`${P}/src/core/m2.ts`) >= 0 && (keys.indexOf(`${P}/src/core/m10.ts`) === -1 || keys.indexOf(`${P}/src/core/m2.ts`) < keys.indexOf(`${P}/src/core/m10.ts`)))
}

// ── 9. Chips fit their card at every width (long names, CJK, dots, line counts, errors) ──
{
  const E = await fresh()
  const long = `${P}/src/core/really_long_module_name_for_parsing.ts`
  const cjk = `${P}/src/i18n/これはとても長い日本語のファイル名ですよね本当に長い.json`
  await E.call('Edit', { file_path: long, old_string: 'a\n'.repeat(567), new_string: 'b\n'.repeat(1234) })
  globalThis.__store.set('crew', { ...E.crew(), problems: Array.from({ length: 12 }, (_, i) => ({ path: long, line: i + 1, message: 'boom', source: 'tsc', by: 'Claude', at: E.now })) })
  await E.spawn('s1'); await E.spawn('s2')
  await E.begin('Read', { file_path: long }, { agentId: 's1' })
  await E.begin('Read', { file_path: long }, { agentId: 's2' })
  await E.begin('Read', { file_path: cjk })
  for (const cols of WIDTHS) {
    const t = await E.render(cols)
    for (const card of kids(byKey(t, 'cards'))) {
      const inner = card.props.width - 4
      for (const b of find(card, x => x.type === 'Button' && String(x.props.key).startsWith('file:'))) {
        const w = cells(text(b))
        if (w > inner) check(`${cols} cols: chip "${text(b)}" fits its card`, false, `${w} cells > ${inner}`)
      }
    }
  }
  check('(chip widths checked at every width)', true)
}

// ── 10. Odd paths: backslashes, unicode, emoji, outside, project top; chips open the right file ──
{
  const E = await fresh()
  const files = [String.raw`C:\work\game\src\win\Backslash File.cs`, `${P}/src/i18n/日本語.json`, `${P}/src/emoji/🚀rocket🔥.md`, 'D:/other/x.ts', `${P}/README`]
  for (const f of files) await E.call('Read', { file_path: f })
  const t = await E.render(100)
  check('odd paths: cards for src/win, src/i18n, src/emoji, outside, project top', JSON.stringify(cardNames(t)) === JSON.stringify(['src/win', 'src/i18n', 'src/emoji', 'outside the project', 'project top']), cardNames(t).join(','))
  for (const f of [`${P}/src/win/Backslash File.cs`, `${P}/src/emoji/🚀rocket🔥.md`, 'D:/other/x.ts']) {
    E.ran.length = 0
    await E.press(t, `file:${f}`)
    check(`chip ${f.split('/').pop()} opens that file`, E.ran.some(a => a.at(-1) === f), JSON.stringify(E.ran))
  }
  E.ran.length = 0
  await E.press(t, 'dir:.')
  check('"project top" opens the project folder', E.ran.some(a => a[0] === 'explorer' && a[1] === 'C:\\work\\game'), JSON.stringify(E.ran))
}

// ── 11. Search: relative paths only; no match says so; hidden files are not counted ──
{
  const E = await fresh()
  for (const f of ['src/auth/login.ts', 'src/auth/token.ts', 'src/ui/button.tsx', 'docs/guide.md']) await E.call('Read', { file_path: `${P}/${f}` })
  await E.call('Read', { file_path: 'C:/other/login-notes.md' })
  await E.search('game')
  let t = await E.render(150)
  check('searching the project folder\'s own name ("game") matches no file (paths are relative)', chipKeys(t).length === 0, `${chipKeys(t).length} chips`)
  await E.search('zzz')
  t = await E.render(150)
  check('a search with no match says so where the cards were', /no match/i.test(text(byKey(t, 'cards'))), JSON.stringify(text(byKey(t, 'cards'))))
  await E.search('')
  await E.press(await E.render(150), 'hide-outside')
  await E.search('notes')
  t = await E.render(150)
  check('a hidden outside file is not counted as a match', !/1 match\b/.test(text(t)) || chipKeys(t).length === 1, `chips ${chipKeys(t).length}`)
  await E.search('login')
  t = await E.render(150)
  check('...and "login" counts only the shown match', /\b1 match\b/.test(text(t)) && chipKeys(t).length === 1, `chips ${chipKeys(t).length}`)
}

// ── 12. A card with more than ten chips opens and closes; the count stays right ──
{
  const E = await fresh()
  for (let i = 0; i < 16; i++) await E.call('Read', { file_path: `${P}/src/api/x${String(i).padStart(2, '0')}.ts` })
  for (const cols of [60, 150]) {
    let t = await E.render(cols)
    const per = cols >= 100 ? 10 : 8
    check(`${cols} cols: ${per} chips and "+${16 - per} more"`, chipKeys(t).length === per && text(byKey(t, 'more:src/api')) === `+${16 - per} more`)
    await E.press(t, 'more:src/api')
    t = await E.render(cols)
    check(`${cols} cols: opened, all 16 and "▴ fewer"`, chipKeys(t).length === 16 && text(byKey(t, 'more:src/api')) === '▴ fewer')
    await E.press(t, 'more:src/api')
  }
}

console.log(`\n${fails} failing check(s)`)
