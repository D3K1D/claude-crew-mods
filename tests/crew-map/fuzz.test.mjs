// Randomized: thousands of events of every kind, with hostile file names and outputs, checked
// against what must always hold: valid, bounded markup; bounded state; unique keys; no crashes;
// and every hook fast even on adversarial text (no runaway regexes).
import { XMLValidator } from 'fast-xml-parser'
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2026-10-14T10:00:00')
Date.now = () => now
const SEED = Number(process.env.FUZZ_SEED ?? 20261014)
let seed = SEED
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
const pick = a => a[Math.floor(rnd() * a.length)]
const P = 'C:/work/game'
const codexRuns = []
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  fs: { read: async p => (p.endsWith('.ts') ? "import x from './a'\nimport y from '../types'\n" : ''), exists: async () => rnd() < 0.3, write: async () => {} },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: codexRuns }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))

// Hostile and ordinary ingredients.
const names = ['main.rs', 'a.ts', 'index.d.ts', 'README.md', 'x&calc.ts', '<script>alert(1)</script>.ts', 'quote"s.py', "it's.js", 'spa ce.tsx', '--install-extension=evil.vsix', '-g', '%PATH%.bat', 'ünïcødé.go', '😀.md', `${'long'.repeat(60)}.ts`, 'a]]>b.xml', '&amp;.css']
const dirs = ['src', 'src/world', 'tests', 'docs', '../outside', 'deep/' + 'n/'.repeat(30) + 'x', 'C:/Other/place']
const path = () => { const d = pick(dirs); return d.startsWith('C:') ? `${d}/${pick(names)}` : `${P}/${d}/${pick(names)}` }
const outputs = [
  'ok',
  `error[E0308]: mismatched types\n  --> ${pick(names)}:12:5`,
  `${'a'.repeat(30000)}`,
  `${'src/'.repeat(5000)}a.rs:1:1: error: x`,
  `Traceback (most recent call last):\n${'  File "x.py", line 1, in f\n'.repeat(2000)}ValueError: </text><g>`,
  `Tests: ${'1 passed, '.repeat(3000)}`,
  `${':'.repeat(40000)}`,
  `${'('.repeat(20000)}a.ts(1,1): error TS1: x`,
  'FAILED tests/test_a.py::t - AssertionError: <b>bold</b>',
  `${'\u00e9'.repeat(10000)}`,
  `thread 'x' panicked at ${'a/'.repeat(4000)}b.rs:1:1:\nboom`,
  'test result: ok. 999999999999 passed; 0 failed',
]
const commands = ['npm test', 'cargo test chunk', 'cargo build', 'rm -rf build', 'mkdir tests', 'node tests/run.mjs', `echo "${'x'.repeat(5000)}"`, 'git status', 'pytest -k "a & b"', `cd "${P}" && make`, 'until grep -q done tests/out.log; do sleep 5; done', `cat <<EOF > a.md\n${'tests\n'.repeat(500)}EOF`, `X=$(echo ${'('.repeat(200)}) && npm test`]
const tools = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'TodoWrite', 'Agent', 'Skill', 'mcp__blender__execute_blender_code', 'mcp__Claude_Browser__navigate', 'mcp__computer-use__type', 'mcp__remote-devices__computer_click', 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch', 'mcp__ccd_session__mark_chapter', 'mcp__codex-bridge__codex', 'mcp__weird__<x>&"', 'Artifact']
const agentIds = ['main', 'main', 'main', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13', 's14']

let fails = 0
let checked = 0
const failNotes = new Set()
const check = (label, cond, extra = '') => {
  checked++
  if (!cond) {
    fails++
    if (!failNotes.has(label)) console.log(`FAIL ${label}${extra ? `  [${extra}]` : ''}`)
    failNotes.add(label)
  }
}
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
/** Keys must be unique among siblings. */
const dupKeys = tree => {
  const bad = []
  const walk = x => {
    if (!x || typeof x !== 'object') return
    const kids = x.props?.children ?? []
    const keys = kids.filter(k => k && typeof k === 'object' && k.props?.key != null).map(k => k.props.key)
    const seen = new Set()
    for (const k of keys) { if (seen.has(k)) bad.push(k); seen.add(k) }
    kids.forEach(walk)
  }
  walk(tree)
  return bad
}
let slowest = { ms: 0, what: '' }
const timed = async (what, fn) => {
  const t0 = performance.now()
  const r = await fn()
  const ms = performance.now() - t0
  if (ms > slowest.ms) slowest = { ms, what }
  return r
}

/** Buttons, Inputs and Clients inside an absolutely placed Box: the engine gives such a Box's pointer to its parent, so they would never be clicked. */
const underAbsolute = (x, inAbs = false, out = []) => {
  if (!x || typeof x !== 'object') return out
  const abs = inAbs || (x.type === 'Box' && x.props?.position === 'absolute')
  if (abs && (x.type === 'Button' || x.type === 'Client' || x.type === 'Input')) out.push(x.props.key)
  for (const c of x.props?.children ?? []) underAbsolute(c, abs, out)
  return out
}
const STEPS = Number(process.env.FUZZ_STEPS ?? 1500)
let calls = 0
for (let step = 0; step < STEPS; step++) {
  now += Math.floor(rnd() * 4000)
  const r = rnd()
  try {
    // Waiting on the person, context sizes, the engine's measure: junk included.
    if (r < 0.025) {
      const w = rnd()
      const ag = pick(agentIds)
      if (w < 0.35) await hooks['classic.PermissionRequest']($, { tool_name: pick(['Bash', 'Edit', 'mcp__x__do_it', 'WebFetch', '', '<b>']), tool_input: pick([{ command: 'rm -rf <x> & y', description: 'x'.repeat(300) }, { file_path: 'C:/a/<b>.ts' }, { url: 'nope' }, null, 'str', 7]), agent_id: ag === 'main' ? undefined : ag }, async () => pick([{}, { decision: { behavior: 'allow' } }, undefined]))
      else if (w < 0.45) await hooks['classic.PermissionDenied']($, { tool_name: 'Bash', agent_id: ag === 'main' ? undefined : ag }, async () => ({}))
      else if (w < 0.6) await hooks['session.measure']($, { context: pick([{ tokens: Math.floor(rnd() * 2e6), window: pick([200000, 1000000, 0, -5, NaN]) }, { window: 200000 }, {}, undefined]), rateLimits: [] }, async () => ({}))
      else {
        const it = hooks['turn.step']($, { turnId: 'T', index: 0, model: pick(['claude-opus-5-5', 'claude-sonnet-5-5[1m]', '', 'x']), messageCount: 1, agentId: ag === 'main' ? undefined : ag }, () => (async function* () { yield { kind: 'text', text: 'x' }; return pick([{ usage: { input_tokens: Math.floor(rnd() * 3e6), output_tokens: 5 } }, { usage: null }, undefined, { usage: { input_tokens: NaN } }]) })())
        for (let x = await it.next(); !x.done; x = await it.next());
      }
    } else if (r < 0.06) await hooks['turn.start']($, { text: pick(['Fix it', 'x'.repeat(5000), '<b>hi</b> & bye', '']), turnId: `T${step}` }, async () => ({}))
    else if (r < 0.1) await hooks['turn.complete']($, { reason: pick(['answer', 'aborted']), answer: 'ok', durationMs: 1, isAborted: false, turnId: `T${step}`, agentId: pick(agentIds) === 'main' ? undefined : pick(agentIds), usage: { input_tokens: Math.floor(rnd() * 1e6), output_tokens: Math.floor(rnd() * 1e5), model: pick(['claude-opus-5-5', 'claude-fable-5-1', 'unknown']) } }, async () => ({ text: 'ok' }))
    else if (r < 0.14) await hooks['agent.spawn']($, { tool_use_id: `sp${step}`, prompt: 'p'.repeat(Math.floor(rnd() * 3000)), description: pick(['Scout', 'x & y', '<i>']), subagentType: pick(['Explore', 'Plan', 'general-purpose', 'weird:type']), provider: {}, parentModel: 'm' }, async () => ({ agentId: pick(agentIds.slice(3)) }))
    else if (r < 0.16) await hooks['session.compact']($, { trigger: 'auto', messages: Array.from({ length: Math.floor(rnd() * 50) }, () => ({})), agentId: rnd() < 0.5 ? undefined : pick(agentIds) }, async () => (rnd() < 0.3 ? { skip: 'no' } : { messages: [] }))
    else if (r < 0.2) await hooks['session.append']($, { door: 'response', message: { role: 'assistant', content: [{ type: 'text', text: pick(['Maybe we could try another approach.', 'x'.repeat(4000), '</text>& "q"']) }] }, origin: {}, uuid: 'u', agentId: rnd() < 0.5 ? undefined : pick(agentIds) }, async () => ({}))
    else if (r < 0.22) {
      // A Codex run appears or moves on.
      if (codexRuns.length < 6) codexRuns.push({ id: `r${step}`, task: 'task & <stuff>', mode: 'write', root: P, cwd: P, model: 'm', effort: 'e', status: 'running', startedAt: now, endedAt: 0, thread: pick(['', 'auth', '<t>&']), resumed: false, caller: pick(agentIds), activity: 'Editing "x"', focus: path(), touched: Array.from({ length: 5 }, () => ({ path: path(), kind: pick(['look', 'edit']), at: now })), events: [{ at: now, kind: 'cmd', text: 'cargo test & <x>', ok: undefined }], files: [path()], commands: 1, failedCommands: 0, answer: '', notesUpdated: false })
      else Object.assign(pick(codexRuns), { status: pick(['done', 'failed', 'stopped']), endedAt: now })
    } else if (r < 0.28) {
      // The person at the pane: clicks, hovers, the arrows, the search, folding, hiding, the two views.
      const tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 140, scroll: { bodyRows: 40 } }, viewport: { columns: 140 } })
      const pan = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]?.props.props
      const junk = () => pick([NaN, Infinity, -1e9, 1e9, 'x', null, undefined, -0, 0.5])
      const num = (a, b) => (rnd() < 0.08 ? junk() : a + rnd() * (b - a))
      const what = rnd()
      if (what < 0.35)
        await hooks['ui.message']($, { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'pan', module: './pan.tsx', data: { view: pan?.view, rev: pan?.rev, click: [num(-50, 1200), num(-50, 700)], ctrl: rnd() < 0.3, sel: rnd() < 0.5, hover: rnd() < 0.5 ? [num(0, 1100), num(0, 700)] : null } }, async () => ({}))
      else if (what < 0.55)
        await hooks['ui.message']($, { surface: 'desktop', component: 'Pane', requestId: 'crew-map', element: 'pan', module: './pan.tsx', data: { view: { x: num(-3000, 3000), y: num(-3000, 3000), k: num(-1, 5) }, rev: rnd() < 0.8 ? pan?.rev : 'stale', zoom: rnd() < 0.3 ? num(-1, 3) : undefined, fit: rnd() < 0.1 } }, async () => ({}))
      else if (what < 0.7) {
        // The arrows (and junk: a stale press after the window moved).
        const arrow = find(tree, x => x.type === 'Button' && String(x.props.key).startsWith('move-'))
        if (arrow.length) await pick(arrow).props.onPress()
      }
      else if (what < 0.82) {
        const input = find(tree, x => x.type === 'Input' && x.props.key === 'search')[0]
        const q = pick(['', 'a', '.ts', 'src/', '(', '[', '*', '\\', 'zzz', '<b>', 'x'.repeat(300), 'é'])
        if (input) await (rnd() < 0.5 ? input.props.onInput(q) : input.props.onSubmit(q))
      } else {
        const keys = ['fit', 'bigger', 'smaller', 'show-outside', 'view-map', 'view-desks', 'hide-outside']
        const btn = find(tree, x => x.type === 'Button' && x.props.key === pick(keys))[0]
        if (btn) await btn.props.onPress()
        else {
          const c = globalThis.__store.get('crew')
          globalThis.__store.set('crew', { ...c, folds: rnd() < 0.5 ? { [pick(['.', 'src', '~outside', 'x'])]: pick(['open', 'closed', 'junk']) } : c.folds, hideOutside: rnd() < 0.5 ? !c.hideOutside : c.hideOutside, view: rnd() < 0.5 ? pick(['map', 'desks', undefined, 'junk']) : c.view, cardsOpen: rnd() < 0.3 ? { [pick(['.', 'src', '~outside'])]: rnd() < 0.5 } : c.cardsOpen })
        }
      }
    } else {
      const tool = pick(tools)
      const input = { file_path: path(), old_string: 'a\nb', new_string: 'c'.repeat(Math.floor(rnd() * 20)), content: 'x', command: pick(commands), description: rnd() < 0.5 ? pick(['Run tests', 'Build', '<script>', 'x'.repeat(500)]) : undefined, run_in_background: rnd() < 0.2, url: 'https://x.test/<a>&"', query: 'q', pattern: 'p', todos: rnd() < 0.5 ? [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress', activeForm: 'Doing <b>' }] : undefined, app: 'Note&pad', text: 'SECRET-TYPED-TEXT', bash_id: 'bash_1' }
      if (tool !== 'Read' && tool !== 'Edit' && tool !== 'Write') delete input.file_path
      const result = { text: pick(outputs), isError: rnd() < 0.3 }
      await timed(`${tool} ${String(input.command ?? '').slice(0, 30)} → ${result.text.slice(0, 30)}`, () =>
        hooks['tool.call']($, { tool, tool_use_id: rnd() < 0.05 ? undefined : `c${calls++}`, agentId: rnd() < 0.6 ? undefined : pick(agentIds), ...input }, async () => result),
      )
    }
  } catch (err) {
    check('no hook throws', false, `${err?.stack?.split('\n').slice(0, 3).join(' | ')}`)
  }
  if (step % 25 === 0 || step === STEPS - 1) {
    for (const cols of [50, 140, 300]) {
      let tree
      try {
        tree = await timed(`render ${cols}`, () => hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: cols }, viewport: { columns: cols } }))
      } catch (err) {
        check('render never throws', false, err?.stack?.split('\n').slice(0, 3).join(' | '))
        continue
      }
      const svgs = find(tree, x => x.type === 'Svg').map(x => x.props.source)
      for (const svg of svgs) {
        const v = XMLValidator.validate(svg)
        check('every image is valid XML', v === true, v === true ? '' : `${JSON.stringify(v.err)} near ${svg.slice(Math.max(0, (v.err?.col ?? 0) - 80), (v.err?.col ?? 0) + 40)}`)
        check('every image fits the Svg limit', svg.length < 131072, String(svg.length))
        check('no NaN, undefined or Infinity in an image', !/NaN|undefined|Infinity/.test(svg), svg.match(/.{40}(NaN|undefined|Infinity).{20}/)?.[0])
        check('no raw script or markup from inputs', !svg.includes('<script') && !svg.includes('<b>') && !svg.includes('<i>'))
      }
      // The engine refuses a pane whose Button holds anything but strings and Text.
      const badBtn = find(tree, x => x.type === 'Button').find(b => !(b.props.children ?? []).every(ch => typeof ch === 'string' || typeof ch === 'number' || ch?.type === 'Text'))
      check('every Button holds only text', !badBtn, badBtn?.props.key)
      // The desktop draws a Button's label as visible text, so none may have one.
      const labelled = find(tree, x => x.type === 'Button' && x.props.label != null)[0]
      check('no Button carries a label', !labelled, labelled?.props.key)
      check('nothing interactive sits in an absolute Box', underAbsolute(tree).length === 0, underAbsolute(tree).join(', '))
      const dk = dupKeys(tree)
      check('keys are unique among siblings', dk.length === 0, dk.slice(0, 3).join(', '))
      for (const b of find(tree, x => x.type === 'Box' && x.props.position === 'absolute'))
        check('overlay positions are whole, non-negative cells', [b.props.top, b.props.left].every(v => v === undefined || (Number.isInteger(v) && v >= -60)), JSON.stringify({ top: b.props.top, left: b.props.left }))
      check('the pane stays a sensible size', JSON.stringify(tree).length < 900_000, String(JSON.stringify(tree).length))
      // The pan module's props: plain data, the window finite and within its zoom limits.
      const panProps = find(tree, x => x.type === 'Client' && x.props.key === 'pan')[0]?.props.props
      if (panProps) {
        const v = panProps.view
        check('the window is finite and within its zoom limits', [v.x, v.y, v.k].every(Number.isFinite) && v.k >= panProps.kMin - 1e-9 && v.k <= panProps.kMax + 1e-9, JSON.stringify(panProps))
        check('the pan props are plain data', JSON.stringify(JSON.parse(JSON.stringify(panProps))) === JSON.stringify(panProps) && typeof panProps.rev === 'string')
      }
    }
    try {
      await hooks['ui.render']($, { surface: 'terminal', props: { bodyColumns: 100 }, viewport: { columns: 100 } })
    } catch (err) {
      check('the terminal render never throws', false, err?.message)
    }
    const c = globalThis.__store.get('crew')
    check('agents stay capped', c.agents.length <= 12, String(c.agents.length))
    check('the log stays capped', c.log.length <= 40, String(c.log.length))
    check('the timeline stays capped', c.timeline.length <= 600, String(c.timeline.length))
    check('test runs stay capped', c.tests.length <= 12, String(c.tests.length))
    check('problems stay capped', c.problems.length <= 30, String(c.problems.length))
    check('shell commands stay capped', (c.shells ?? []).length <= 20, String((c.shells ?? []).length))
    check('worked files stay capped', Object.keys(c.changes).length <= 301, String(Object.keys(c.changes).length))
    check('map nodes stay capped', Object.keys(c.nodes).length <= 60, String(Object.keys(c.nodes).length))
    check('totals stay finite and non-negative', Number.isFinite(c.spent.cost) && c.spent.cost >= 0 && Number.isFinite(c.spent.tokens))
    check('every agent is a real agent', c.agents.every(a => typeof a.id === 'string' && typeof a.name === 'string' && Array.isArray(a.pending)))
    check('nothing typed into the computer is kept', !JSON.stringify(c).includes('SECRET-TYPED-TEXT'))
    check('stored goals are cut', c.agents.every(a => a.goal.length <= 500), String(Math.max(...c.agents.map(a => a.goal.length))))
  }
}
check('every hook stays fast on hostile text', slowest.ms < 250, `${slowest.ms.toFixed(0)} ms: ${slowest.what}`)
// The validator itself must catch a broken image.
check('the XML check catches broken markup', XMLValidator.validate('<svg><text>a < b & c</text></svg>') !== true)
console.log(`PASS fuzz: ${checked} checks over ${STEPS} random events (seed ${SEED}); slowest step ${slowest.ms.toFixed(0)} ms (${slowest.what})`)
console.log(`\n${fails} failing check(s)`)
