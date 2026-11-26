import type { CodexRun, Crew, Summary, TestRun } from '../types'
import { actionLine, after, background, every, isTestCmd, log, reach, record, settleTest, think, upsert, write } from './track'

// The pretend session: three Claudes and a Codex run at work on made-up files for half a minute, and
// what keeps them out of the real record.

// ─── Demo ───────────────────────────────────────────────────────────────────

// The pretend session's Claudes have ids that start demo-, its files paths that start demo/: that is all
// that keeps them out of the real record (the journal, the task's summary, costs, colours, touched.json).
export const isDemoAgent = (id: string) => id.startsWith('demo-')
export const isDemoPath = (path: string) => path.startsWith('demo/')
/** The crew without the pretend session: its Claudes, files, tests, commands, problems and Codex run. */
export const withoutDemo = (c: Crew): Crew => {
  const real = <T,>(o: Record<string, T> | undefined) => o && Object.fromEntries(Object.entries(o).filter(([p]) => !isDemoPath(p)))
  return {
    ...c,
    agents: c.agents.filter(a => !isDemoAgent(a.id)),
    changes: real(c.changes) ?? {},
    reached: real(c.reached),
    tests: (c.tests ?? []).filter(t => !isDemoAgent(t.agentId)),
    shells: c.shells?.filter(x => !isDemoAgent(x.agentId)),
    problems: (c.problems ?? []).filter(p => !isDemoPath(p.path)),
    demoCodex: [],
  }
}
const D = (p: string) => `demo/${p}`
const DEMO_CAST = [
  {
    id: 'demo-1',
    kind: 'Explore',
    name: 'Scout',
    hue: 1,
    goal: 'Map how the auth token flows from login to every API call',
    path: ['src/main.tsx', 'src/App.tsx', 'src/hooks/useAuth.ts', 'src/api/token.ts', 'src/api/client.ts', 'src/api/types.ts'],
    tools: ['Read', 'Read', 'Grep', 'Read', 'Read', 'Read'],
    thoughts: [
      'Starting at the entry point to see how providers are wired.',
      'App mounts an AuthProvider; the hook owns the session.',
      'useAuth stores the token in memory and refreshes on focus.',
      'token.ts decodes expiry but never schedules a refresh.',
      'client.ts attaches the bearer header on every request.',
      'Types confirm the refresh token is optional, which explains the 401s.',
    ],
  },
  {
    id: 'demo-2',
    kind: 'Plan',
    name: 'Architect',
    hue: 3,
    goal: 'Design proactive token refresh without breaking the API client',
    path: ['src/api/token.ts', 'src/api/client.ts', 'src/hooks/useAuth.ts', 'src/api/client.ts', 'src/api/token.ts'],
    tools: ['Read', 'Read', 'Read', 'Edit', 'Edit'],
    thoughts: [
      'The cleanest seam is in token.ts: it already knows the expiry.',
      'client.ts should await a refresh promise instead of failing fast.',
      'useAuth only needs to expose the refresh callback.',
      'Adding a single-flight refresh so parallel calls share one request.',
      'Scheduling refresh 60s before expiry; plan is ready for review.',
    ],
  },
  {
    id: 'demo-3',
    kind: 'general-purpose',
    name: 'Helper',
    hue: 2,
    goal: 'Fix the failing login test and keep the suite green',
    path: ['tests/auth.test.ts', '$terminal', 'src/hooks/useAuth.ts', 'tests/auth.test.ts', '$terminal'],
    tools: ['Read', 'Bash', 'Edit', 'Edit', 'Bash'],
    detail: ['', 'npm test -- auth', '', '', 'npm test'],
    thoughts: [
      'The test mocks fetch but not the refresh endpoint.',
      'Running the auth suite to see the real failure first.',
      'useAuth swallows the refresh error; surfacing it instead.',
      'Updating the mock to return a refresh token.',
      'All 42 tests pass now.',
    ],
  },
]

/**
 * The demo's pretend Codex run: the Architect hands it a thread at step 1, it
 * reads, edits and tests over the next steps, and reports back at step 5.
 */
const demoCodexAt = (step: number, now: number, prev: CodexRun[]): CodexRun[] => {
  if (step < 1) return prev
  const cur = prev[0]
  const F = (p: string) => D(p)
  const base: CodexRun = cur ?? {
    id: 'demo-codex',
    task: 'Add a single-flight token refresh in src/api/token.ts and make client.ts await it; keep the auth tests green.',
    model: 'gpt-6.1-sol',
    status: 'running',
    startedAt: now,
    endedAt: 0,
    thread: 'auth-refresh',
    caller: 'demo-2',
    activity: 'Reading its notes',
    events: [{ at: now, kind: 'info', text: 'reading .codex-bridge/NOTES.md' }],
    files: [],
    commands: 0,
    notesUpdated: false,
  }
  const ev = (kind: string, text: string, ok?: boolean) => ({ at: now, kind, text, ...(ok === undefined ? {} : { ok }) })
  switch (step) {
    case 2:
      return [{ ...base, activity: 'Reading token.ts', events: [...base.events, ev('cmd', 'rg -n "refreshToken" src', true)], commands: 1 }]
    case 3:
      return [{ ...base, activity: 'Editing token.ts', files: [F('src/api/token.ts')], events: [...base.events, ev('file', 'update token.ts')] }]
    case 4:
      return [{ ...base, activity: 'Running npm test -- auth', files: [F('src/api/token.ts'), F('src/api/client.ts')], events: [...base.events, ev('file', 'update client.ts'), ev('cmd', 'npm test -- auth')], commands: 2 }]
    case 5:
      return [{ ...base, status: 'done', endedAt: now, activity: 'Done', events: [...base.events.map(e => (e.kind === 'cmd' && e.ok === undefined ? { ...e, ok: true } : e)), ev('say', 'Added a single-flight refresh in token.ts; client.ts now awaits it. 42 auth tests pass.')], notesUpdated: true }]
    case 1:
      return [base]
    default:
      return prev
  }
}

/** The pretend session's clock, while it plays. */
let demo: { cancel: () => void } | undefined
/** Stops the pretend session (a session start does). */
export const stopDemo = () => {
  demo?.cancel()
  demo = undefined
}
let demoRun = 0
export const startDemo = () => {
  if (!every || !write || demo) return
  const w = write
  const run = ++demoRun
  const started = Date.now()
  let k = 0
  const step = () => {
    const now = Date.now()
    if (k === 0) {
      background('demo', w(c => {
        let d: Crew = c
        for (const cast of DEMO_CAST)
          d = upsert(d, cast.id, a => ({ ...a, name: cast.name, kind: cast.kind, hue: cast.hue, goal: cast.goal, state: 'thinking' }))
        return d
      }))
    }
    const step = k
    k++
    if (step >= 7) {
      demo?.cancel()
      demo = undefined
      background('demo', w(c => {
        let d = c
        for (const cast of DEMO_CAST)
          d = log(upsert(d, cast.id, a => ({ ...a, state: 'done', doneAt: now, pending: [] })), cast.id, 'info', 'finished')
        // A pretend summary card for the pretend task.
        const files = Object.entries(d.changes)
          .filter(([p, ch]) => isDemoPath(p) && ch.edits)
          .map(([path, ch]) => ({ path, added: ch.added, removed: ch.removed }))
        const summary: Summary = {
          at: now,
          goal: 'Demo: fix the token refresh race and keep the auth tests green',
          ms: now - started,
          files,
          read: Object.entries(d.changes).filter(([p, ch]) => isDemoPath(p) && !ch.edits).length,
          tests: { runs: 2, failed: 1, last: 'passed (42 passed)' },
          tokens: 184_000,
          cost: 1.37,
          claudes: DEMO_CAST.map(x => x.name),
          codex: 1,
          problems: 0,
        }
        return { ...d, summary }
      }))
      after?.(20_000, () =>
        // A demo started since then owns the demo's files now.
        background('demo', w(c => (run !== demoRun || demo ? c : withoutDemo(c)))),
      )
      return
    }
    background('demo', w(c => {
      let d: Crew = { ...c, demoCodex: demoCodexAt(step, now, c.demoCodex ?? []) }
      // The Helper's test runs come back a step later: the first one fails, the rerun passes.
      for (const t of (d.tests ?? []).filter(x => x.status === 'running' && isDemoAgent(x.agentId))) {
        const first = t.command === 'npm test -- auth'
        d = settleTest(d, t.id, first ? 'Tests:       1 failed, 41 passed, 42 total' : 'Tests:       42 passed, 42 total', first, now)
        // The failing run names the line it failed on; the rerun clears it.
        d = first
          ? {
              ...d,
              problems: [
                { path: D('tests/auth.test.ts'), line: 42, message: 'expect(received).toBe(expected): Expected "refreshed", Received undefined', source: t.command, by: t.who, hue: t.hue, at: now },
                { path: D('src/hooks/useAuth.ts'), line: 18, message: 'TypeError: Cannot read properties of undefined (reading "token")', source: t.command, by: t.who, hue: t.hue, at: now },
              ],
            }
          : { ...d, problems: (d.problems ?? []).filter(p => !isDemoPath(p.path)) }
      }
      DEMO_CAST.forEach(cast => {
        // The Architect hands its work to Codex for a few steps and waits on it.
        if (cast.id === 'demo-2' && step >= 1 && step <= 4) {
          const line = '◎ asking Codex [auth-refresh] Add a single-flight token refresh…'
          d = upsert(d, cast.id, a => ({ ...a, tool: 'mcp__codex-bridge__codex', detail: '[auth-refresh] Add a single-flight token refresh', state: 'busy', pending: ['demo'], ...(step === 1 ? { calls: a.calls + 1, actions: [line, ...a.actions].slice(0, 5) } : {}) }))
          if (step === 1) d = think(log(d, cast.id, 'act', line), cast.id, 'The refresh logic is self-contained: a good job to hand to Codex while I plan the client changes.')
          return
        }
        if (cast.id === 'demo-2' && step === 5) d = think(d, cast.id, 'Codex finished the refresh; reviewing its diff before wiring the client.')
        const i = Math.min(step, cast.path.length - 1)
        if (step >= cast.path.length) {
          d = upsert(d, cast.id, a => ({ ...a, state: 'thinking', pending: [] }))
          return
        }
        const raw = cast.path[i]
        const node = raw.startsWith('$') ? raw : D(raw)
        const tool = cast.tools[i]
        const detail = ('detail' in cast ? cast.detail?.[i] : '') || (tool === 'Grep' ? 'refreshToken' : '')
        d = reach(d, node)
        const edit = tool !== 'Read' && tool !== 'Grep' && !node.startsWith('$')
        if (tool === 'Bash' && isTestCmd(detail)) {
          const run: TestRun = { id: `test-demo-${cast.id}-${step}`, agentId: cast.id, who: cast.name, hue: cast.hue, command: detail, purpose: step < 3 ? "Run the auth tests to see the real failure" : "Rerun the whole suite after the fix", startedAt: now, endedAt: 0, status: 'running', passed: 0, failed: 0, background: false }
          d = log({ ...d, tests: [...(d.tests ?? []), run] }, cast.id, 'info', `⚗ tests started · ${run.purpose}`)
        }
        if (!node.startsWith('$'))
          d = record(
            d,
            node,
            cast.id,
            tool === 'Read' || tool === 'Grep' ? 'read' : { added: 4 + ((step * 7 + cast.hue * 5) % 23), removed: (step * 3 + cast.hue) % 9 },
          )
        d = upsert(d, cast.id, a => ({
          ...a,
          node,
          tool,
          detail,
          state: 'busy',
          pending: ['demo'],
          calls: a.calls + 1,
          actions: [actionLine(tool, node, detail), ...a.actions].slice(0, 5),
          todosDone: i + 1,
          todosTotal: cast.path.length + 1,
          // The demo's context fills as it works, one helper close to compacting.
          ctx: { tokens: Math.round((0.18 + 0.12 * cast.hue) * 200_000 * Math.min(1, (i + 2) / cast.path.length)), window: 200_000, at: Date.now() },
        }))
        d = log(d, cast.id, 'act', actionLine(tool, node, detail))
        d = think(d, cast.id, cast.thoughts[i])
      })
      return d
    }))
  }
  step()
  demo = every(2600, step)
}
