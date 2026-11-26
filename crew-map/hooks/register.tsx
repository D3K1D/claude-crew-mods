import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Agent, Chat, Crew, LogLine, Problem, ShellRun, Summary, TestRun } from '../types'
import { EMPTY } from './empty'
import { ASKS, COMPACT, LIST_TOOL, LOG_KEEP, MAIN, MORE_MAX, OPEN_ASK, PALETTE, PANE, PLAN_TOOL, SHELL_GIVE_UP_MS, TEST_SHOW_MS, WRAP_TOOL, actionLine, after, agentModel, agentOf, applyTaskCall, baseName, bindEngine, chatsOf, cleanSaid, cmdDir, cmdGist, codexCount, costOf, cutTo, detailOf, editDiff, elapsed, endShell, fin, flushDiag, fmtK, fmtUsd, freshName, isBuildCmd, isSpecial, isTestCmd, lastCtx, lineDiff, log, needsText, nodeOf, norm, note, noticeTurn, oneLine, parseProblems, planAfter, promptOf, reach, readChatCost, readCrew, readFile, record, recountCodex, relPath, relayedOf, resolvePath, resultText, reviewAsk, reviewSince, sessionDir, setFolder, setMainModel, setMainWindow, settleLater, settleTest, siblingsOf, stepStart, stuckReason, summarise, summarise1, systemNote, tailOf, testCounts, testLabel, testPurpose, testWords, textW, think, tidyCmd, tokensOf, took, trunc, upsert, windowOf, wrapRows, write } from './track'
import type { Usage } from './track'
import { isDemoAgent, stopDemo, withoutDemo } from './demo'
import { CELL_W, KIND_GLYPH, doAction, hueRole, paintPane, paneModel, searchFor, stateRole } from './model'
import type { Act, PaneRow, Seg, VLine } from './model'
import { addToJournal, findLogs, hostId, journal, logsNote, nested, openJournal, pruneOld, publishWeb, readHostId, readNested, saveLog, startWeb, syncJournal, webFailed, webState, webUrl } from './web'

// Claude Crew (crew-map): the hooks Claude Code calls, the /crew and /crew-review commands, and the
// pane, drawn as text in a terminal (and on the desktop when the website can't start). The record is
// kept in track.ts, the view worked out in model.ts, the website and journal in web.ts.

// The values the hooks write (declared in each file that uses them; the same key is the same value).
const crew = atom({ plugin: 'crew-map', key: 'crew' } as const, EMPTY)
/** Bumped once a second while something runs, so its timer counts up. */
const tick = atom({ plugin: 'crew-map', key: 'tick' } as const, 0)

/** The 1 s clock: one, kept so a second session start replaces it rather than adding another. */
let ticker: { cancel(): void } | undefined
/** Reads the chats started from this one (and the project's others) from the app's list. */
let refreshChats: (() => Promise<void>) | undefined
let chatPoller: { cancel(): void } | undefined
/** True while the pane itself reads the list, so its own call is not logged as Claude's. */
let pollingChats = false
/** When the pane last read the list by itself. */
let chatsReadAt = 0
/** The website's clocks: sending the view, writing the journal, reading the nested chats. */
let webTimer: { cancel(): void } | undefined
let journalTimer: { cancel(): void } | undefined
let nestedTimer: { cancel(): void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    bindEngine($)
    stopDemo()

    await $.command.register({ name: 'crew', description: "Open this chat's Claude Crew website in the browser pane" })
    await $.command.register({ name: 'crew-review', description: 'Start a "Crew Review" chat that summarises the recent changes from Claude Crew\'s logs and git (/crew-review 2h, /crew-review since v1.8.8)' })
    await update($, crew, c => {
      // A reload drops in-flight calls and the demo; migrate older state shapes too.
      // (What older versions kept for the map, the desks and the replay is dropped.)
      const { nodes: _n, trails: _t, timeline: _f, zoom: _z, showFiles: _s, folds: _o, track: _k, deskOpen: _d, view: _v, cardsOpen: _c, unfolded: _u, ...old } = (Array.isArray(c?.agents) ? c : {}) as Partial<Crew> & Record<string, unknown>
      const base = withoutDemo({ ...EMPTY, ...old, spent: old.spent ?? { tokens: 0, cost: 0 } })
      const agents = base.agents
        .map(({ from: _f, movedAt: _m, visited: _v, kinds: _k, ...a }: Agent & Record<string, unknown>) => ({ tokens: 0, cost: 0, stuck: '', recent: [], since: 0, ...a }))
        .map(a => (a.state === 'busy' ? { ...a, state: 'thinking' as const, pending: [] } : a))
      return {
        ...base,
        logView: undefined,
        // A reload loses the calls that were waiting on tests; a background run may still be going but can't be followed.
        tests: (base.tests ?? [])
          .map(t => (t.status === 'running' ? { ...t, status: 'unknown' as const, endedAt: Date.now() } : t)),
        shells: (base.shells ?? []).filter(x => x.status === 'running' && x.background && x.shellId),
        spent: base.spent ?? { tokens: agents.reduce((n, a) => n + (a.tokens ?? 0), 0), cost: agents.reduce((n, a) => n + (a.cost ?? 0), 0) },
        startedAt: base.startedAt || Date.now(),
        agents: agents.some(a => a.id === 'main') ? agents : [MAIN(), ...agents],
      }
    })
    // The editor choice lives in the store, so it survives across sessions.
    const saved = await $.store.get('editor').catch(() => undefined)
    if (typeof saved === 'string' && saved) await update($, crew, c => ({ ...c, editor: saved }))
    const budget = await $.store.get('budget').catch(() => undefined)
    if (typeof budget === 'number' && budget > 0) await update($, crew, c => ({ ...c, budget }))
    setFolder($, norm(await $.session.cwd().catch(() => '')))
    // This chat's app id, before the first read of the chat list (that read needs it to find this chat's nested and same-project chats).
    await readHostId($)
    // While a test runs, tick once a second so its timer counts up; give up on background runs nobody reads after 30 minutes.
    ticker?.cancel()
    ticker = $.clock.every(1000, () => {
      void (async () => {
        await flushDiag($)
        const c = await read($, crew)
        const running = (c.tests ?? []).filter(t => t.status === 'running')
        const shellsOn = (c.shells ?? []).filter(x => x.status === 'running')
        // A Claude at work or thinking has clocks on its row and in the log that count each second.
        const atWork = c.agents.some(a => a.state === 'busy' || a.state === 'thinking')
        if (!running.length && !shellsOn.length && !atWork) return
        await update($, tick, n => n + 1)
        const now = Date.now()
        if (shellsOn.some(x => now - x.startedAt > SHELL_GIVE_UP_MS))
          await write?.(d => ({ ...d, shells: (d.shells ?? []).map(x => (x.status === 'running' && now - x.startedAt > SHELL_GIVE_UP_MS ? { ...x, status: 'unknown' as const, endedAt: now } : x)) }))
        if (running.some(t => now - t.startedAt > 30 * 60_000))
          await write?.(d => ({
            ...d,
            tests: d.tests.map(t => (t.status === 'running' && now - t.startedAt > 30 * 60_000 ? { ...t, status: 'unknown' as const, endedAt: now } : t)),
          }))
      })()
    })
    // The chats started from this one: read from the app's own list every 15 seconds, only while the
    // session lets that read run without asking anyone. Where it doesn't (auto mode, the terminal), it
    // keeps checking, and the chats are only as new as Claude's own last look (the cards say so).
    refreshChats = async () => {
      if (pollingChats) return
      pollingChats = true
      try {
        const may = await Promise.resolve()
          .then(() => $.tool.check({ tool: LIST_TOOL, input: hostId ? {} : { linked: true } }))
          .catch(() => undefined)
        const live = may?.decision === 'allow'
        const r = live
          ? ((await Promise.resolve()
              .then(() => $.tool.call((hostId ? { tool: LIST_TOOL, limit: 100 } : { tool: LIST_TOOL, linked: true, limit: 50 }) as never))
              .catch(() => undefined)) as { text?: string; isError?: boolean } | undefined)
          : undefined
        const chats = r && !r.isError && typeof r.text === 'string' ? chatsOf(r.text, hostId) : undefined
        const siblings = chats && r?.text ? siblingsOf(r.text, hostId, new Set(chats.map(x => x.id))) : undefined
        if (chats) chatsReadAt = Date.now()
        if (siblings) await write?.(d => (JSON.stringify((d.siblings ?? []).map(({ seen, ...x }) => x)) === JSON.stringify(siblings.map(({ seen, ...x }) => x)) ? d : { ...d, siblings }))
        await write?.(d => {
          // Live: written only when a chat changed (its `seen` matters only once the reads stop).
          const bare = (x: Chat[]) => JSON.stringify(x.map(({ seen, ...rest }) => rest))
          if (chats) return d.chatsLive && bare(d.chats ?? []) === bare(chats) ? d : { ...d, chats, chatsLive: true }
          return d.chatsLive === false ? d : { ...d, chatsLive: false, chats: (d.chats ?? []).map(x => ({ ...x, seen: Math.max(x.seen ?? 0, chatsReadAt) })) }
        })
      } finally {
        pollingChats = false
      }
    }
    chatPoller?.cancel()
    chatPoller = $.clock.every(15_000, () => void refreshChats?.())
    void refreshChats()
    void readChatCost($)
    const savedTheme = await $.store.get('theme').catch(() => undefined)
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto') await write?.(d => (d.theme === savedTheme ? d : { ...d, theme: savedTheme }))
    // This chat's website: back at once only if it had one before (else on its first /crew), and sent
    // the view while anyone has it open. The pane opens by itself only when the website can't start.
    if (!webUrl) startWeb($, true)
    void openJournal($).then(() => pruneOld($))
    journalTimer?.cancel()
    journalTimer = $.clock.every(3000, () => void syncJournal($))
    nestedTimer?.cancel()
    nestedTimer = $.clock.every(4000, () => void readNested($))
    if ((await $.store.get('autoSave').catch(() => undefined)) === true) await write?.(d => ({ ...d, autoSave: true }))
    if ((await $.store.get('testToasts').catch(() => undefined)) === true) await write?.(d => ({ ...d, testToasts: true }))
    void findLogs($)
    webTimer?.cancel()
    webTimer = $.clock.every(800, () => void publishWeb($))

    return next(e)
  })

  // /crew: Claude opens this chat's website in the browser pane (a mod can't open the pane itself), asked
  // once the command has finished, when the chat can take a prompt; the link stays in case it doesn't.
  // Without the website, the pane opens as before.
  // New chats in a project with saved logs: one line telling Claude where they are.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return logsNote ? { ...r, sections: [...r.sections, { id: 'crew-map:logs', text: logsNote, scope: 'session' as const }] } : r
  })

  on('command.run', { command: 'crew' }, async $ => {
    // The website starts now if it isn't running (half a second or so), once a session start's look for
    // a saved address is done.
    const settle = async () => {
      for (let i = 0; i < 50 && !webUrl && (webState === 'starting' || webState === 'checking'); i++) await new Promise<void>(r => void $.clock.after(100, () => r()))
    }
    await settle()
    if (!webUrl) startWeb($)
    await settle()
    if (webUrl) {
      const url = webUrl
      $.clock.after(400, () =>
        void $.prompt
          .submit({ text: `${OPEN_ASK} and show me that pane: call preview_start with the url ${url}, then mcp__ccd_view__show_pane for the browser pane.`, asUser: true })
          .then(
            r => $.store.set('crewOpen', { at: new Date().toISOString(), result: JSON.stringify(r ?? null).slice(0, 300) }),
            err => $.store.set('crewOpen', { at: new Date().toISOString(), error: String(err).slice(0, 300) }),
          )
          .catch(() => undefined),
      )
      return { text: `Claude Crew for this chat: ${url} (opening it beside the chat; click it if it doesn't open)` }
    }
    await $.ui.open({ id: PANE, title: 'Claude Crew' })
    return { text: 'Claude Crew pane opened.' }
  })

  // /crew-review: Claude starts a nested chat, "Crew Review", that reads this chat's (and its nested
  // chats') Claude Crew logs and the git history since a starting point, summarises what changed, and
  // asks what to do with the summary. (A mod can't start a chat itself: it asks Claude, as /crew does.)
  on('command.run', { command: 'crew-review' }, async ($, e) => {
    const c = await read($, crew)
    const since = reviewSince(typeof e.args === 'string' ? e.args : '', c.startedAt || Date.now())
    if ('error' in since) return { text: since.error }
    const ask = await reviewAsk(since, c)
    $.clock.after(400, () => void $.prompt.submit({ text: ask, asUser: true }).catch(() => undefined))
    return { text: `Starting a Crew Review of the changes ${since.label}: Claude opens it as a nested chat.` }
  })

  on('turn.start', async ($, e, next) => {
    const id = agentOf(e)
    // The app reporting in (a background task, a monitor, CI): logged, but the goal stays the user's.
    const note = e.text ? systemNote(e.text) : ''
    if (note) noticeTurn.add(id)
    else noticeTurn.delete(id)
    if (note) {
      const taskId = e.text?.match(/<task-id>\s*([\w-]+)\s*<\/task-id>/)?.[1] ?? ''
      const status = e.text?.match(/<status>\s*(\w+)\s*<\/status>/)?.[1]?.toLowerCase() ?? ''
      if (taskId && /^(completed|failed|killed|stopped)$/.test(status))
        await write?.(c => endShell(c, taskId, status === 'completed' ? 'done' : status === 'failed' ? 'failed' : 'stopped', Date.now()))
      await write?.(c => log(upsert(c, id, a => ({ ...a, state: a.state === 'busy' ? 'busy' : 'thinking' })), id, 'info', `↻ ${note}`))
      return next(e)
    }
    if (id === 'main' && e.text) await recountCodex($)
    await write?.(c => {
      const d = upsert(c, id, a => ({
        ...a,
        state: a.state === 'busy' ? 'busy' : 'thinking',
        ...(id === 'main' && e.text
          ? { goal: trunc(oneLine(promptOf(e.text)), 500), todosDone: 0, todosTotal: 0, doing: '', plan: undefined, todoList: undefined, calls: 0, since: Date.now(), thoughts: [], actions: [], stuck: '', recent: [] }
          : {}),
      }))
      if (id === 'main' && e.text) {
        if (d.tasks) d.tasks = Object.fromEntries(Object.entries(d.tasks).map(([k, t]) => [k, t.status === 'completed' ? { ...t, old: true } : t]))
        // What the task's summary is measured against.
        d.turnBase = {
          at: Date.now(),
          goal: trunc(oneLine(promptOf(e.text)), 500),
          changes: Object.fromEntries(Object.entries(d.changes).filter(([, ch]) => ch.edits).map(([p, ch]) => [p, { added: ch.added, removed: ch.removed }])),
          tokens: d.spent?.tokens ?? 0,
          cost: d.spent?.cost ?? 0,
          tests: 0,
          failed: 0,
          codex: codexCount,
        }
        d.summary = null
      }
      if (id !== 'main' || !e.text) return d
      const relayed = relayedOf(e.text)
      const line: LogLine = relayed
        ? { at: Date.now(), who: relayed.from, hue: 0, kind: 'msg', text: trunc(relayed.body, 2000) }
        : { at: Date.now(), who: 'You', hue: 0, kind: 'you', text: trunc(oneLine(e.text), 2000) }
      return { ...d, log: [...d.log, line].slice(-LOG_KEEP) }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = agentOf(e)
    void readChatCost($)
    if (id === 'main' && e.reason === 'answer')
      $.clock.after(2000, () => void (async () => ((await readCrew?.())?.autoSave ? saveLog($, 'task') : undefined))())
    if (id === 'main') await recountCodex($)
    let budgetNote = ''
    let summary: Summary | undefined
    await write?.(c => {
      budgetNote = ''
      summary = undefined
      const u = e.usage as Usage | undefined
      const d = upsert(c, id, a => ({
        ...a,
        state: id === 'main' ? 'idle' : 'done',
        pending: [],
        needs: undefined,
        doneAt: Date.now(),
        doing: '',
        tokens: (a.tokens ?? 0) + (u ? tokensOf(u) : 0),
        cost: (a.cost ?? 0) + (u ? costOf(u) : 0),
      }))
      let f = log(d, id, 'info', e.reason === 'answer' ? 'finished' : `stopped (${e.reason})`)
      if (u && !isDemoAgent(id)) f = { ...f, spent: { tokens: (f.spent?.tokens ?? 0) + tokensOf(u), cost: (f.spent?.cost ?? 0) + costOf(u) } }
      // Spending: said once each as it passes half, 80% and all of the budget.
      const spent = f.spent?.cost ?? 0
      if (f.budget > 0) {
        const share = [1, 0.8, 0.5].find(s => spent >= f.budget * s) ?? 0
        if (share > (f.budgetWarned ?? 0)) {
          budgetNote =
            share >= 1
              ? `💸 Over budget: about ${fmtUsd(spent)} spent of your ${fmtUsd(f.budget)}`
              : `💸 ${Math.round(share * 100)}% of your ${fmtUsd(f.budget)} budget used (about ${fmtUsd(spent)})`
          f = log({ ...f, budgetWarned: share }, 'main', 'info', budgetNote)
        }
      }
      // A turn a background task started does not end the user's task: no summary, no "done" toast.
      if (id === 'main' && e.reason === 'answer' && !noticeTurn.has(id) && f.turnBase?.at && f.agents.find(a => a.id === 'main')?.calls) {
        summary = summarise1(f, Date.now(), codexCount)
        f = { ...f, summary }
      }
      return f
    })
    if (budgetNote) void $.ui.toast(budgetNote)
    if (summary) {
      const s = summary
      void $.ui.toast(`✓ Done in ${elapsed(s.ms)}: ${s.files.length} file${s.files.length === 1 ? '' : 's'} changed${s.tests.runs ? `, tests ${s.tests.last.split(' ')[0]}` : ''}, ≈ ${fmtUsd(s.cost)}`)
    }
    return r
  })

  // Waiting on the person: a permission prompt is shown (the classic PermissionRequest is raised only
  // when one is), or a tool that asks (a question, a plan). It ends with that tool's call, a denial,
  // or the turn. A hook beneath that decides at once (allow or deny) means no prompt was shown.
  const setNeeds = (id: string, what: string, rawTool: string) => {
    const tool = typeof rawTool === 'string' ? rawTool.slice(0, 80) : ''
    return write?.(c => log(upsert(c, id, a => ({ ...a, needs: { what, tool, at: Date.now() } })), id, 'info', `⏸ needs you: ${what}`))
  }
  const clearNeeds = (id: string, rawTool?: string) => {
    const tool = typeof rawTool === 'string' ? rawTool.slice(0, 80) : undefined
    return write?.(c => (c.agents.some(a => a.id === id && a.needs && (!tool || a.needs.tool === tool)) ? upsert(c, id, a => ({ ...a, needs: undefined })) : c))
  }
  on('classic.PermissionRequest', async ($, e, next) => {
    const id = e.agent_id ?? 'main'
    await setNeeds(id, needsText(e.tool_name, e.tool_input), e.tool_name)
    const r = await next(e)
    if ((r as { decision?: unknown } | undefined)?.decision) await clearNeeds(id, e.tool_name)
    return r
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    await clearNeeds((e as { agent_id?: string }).agent_id ?? 'main')
    return next(e)
  })
  // A question or a plan to approve: the Claude waits on the person until the call returns.
  const asking = async (e: { agentId?: string; tool: string }, run: () => Promise<unknown>) => {
    const id = e.agentId ?? 'main'
    await setNeeds(id, ASKS[e.tool], e.tool)
    try {
      return await run()
    } finally {
      await clearNeeds(id, e.tool)
    }
  }
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => (await asking(e, () => next(e))) as Awaited<ReturnType<typeof next>>)
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => (await asking(e, () => next(e))) as Awaited<ReturnType<typeof next>>)
  // Each model request: how much of its context window the Claude is using now.
  on('turn.step', async function* ($, e, next) {
    // When this model step began, kept here (no write per step): how long "thinking" has run.
    stepStart.set(e.agentId ?? 'main', Date.now())
    if (e.model) agentModel.set(e.agentId ?? 'main', e.model)
    const r = yield* next(e)
    const u = (r as { usage?: Usage | null } | undefined)?.usage
    if (u && fin(u.input_tokens) + fin(u.cache_read_input_tokens) + fin(u.cache_creation_input_tokens) > 0) {
      const id = e.agentId ?? 'main'
      if (id === 'main') setMainModel(e.model)
      const tokens = fin(u.input_tokens) + fin(u.cache_read_input_tokens) + fin(u.cache_creation_input_tokens) + fin(u.output_tokens)
      const window = windowOf(e.model)
      if (lastCtx.get(id) !== `${tokens}/${window}`) {
        lastCtx.set(id, `${tokens}/${window}`)
        void write?.(c => upsert(c, id, a => ({ ...a, ctx: { tokens, window, at: Date.now() } })))
      }
    }
    return r
  })
  // The engine's own measure of the main window: its true size.
  on('session.measure', async ($, e, next) => {
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
    if (ok(e.context?.window)) setMainWindow(e.context.window)
    if (ok(e.context?.window) && typeof e.context.tokens === 'number' && Number.isFinite(e.context.tokens) && e.context.tokens >= 0) {
      const tokens = e.context.tokens
      const window = e.context.window
      void write?.(c => upsert(c, 'main', a => ({ ...a, ctx: { tokens, window, at: Date.now() } })))
    }
    return next(e)
  })

  // Compaction: the conversation is being summarised to free up room. The
  // Claude shows "Compacting memory" until it is done, and the log says how
  // many messages went in and came out.
  on('session.compact', async ($, e, next) => {
    // Precompute only prepares a summary ahead of time; nothing is compacted.
    if ((e.trigger as string) === 'precompute') return next(e)
    const id = e.agentId ?? 'main'
    const before = e.messages?.length ?? 0
    let was: Agent['state'] = 'idle'
    await write?.(c => {
      const d = upsert(c, id, a => {
        was = a.state
        return { ...a, tool: COMPACT, detail: '', state: 'busy', pending: [...a.pending, COMPACT] }
      })
      return log(d, id, 'info', `🗜 compacting the conversation (${e.trigger}): ${before} message${before === 1 ? '' : 's'}`)
    })
    let out: unknown
    try {
      out = await next(e)
      return out as Awaited<ReturnType<typeof next>>
    } finally {
      const r = out as { messages?: unknown[]; skip?: string; usage?: Usage } | undefined
      const line = r?.skip ? `🗜 compaction skipped: ${r.skip}` : r?.messages ? `🗜 compacted: ${before} → ${r.messages.length} messages` : '🗜 compaction did not finish'
      await write?.(c => {
        const d = upsert(c, id, a => {
          const pending = a.pending.filter(p => p !== COMPACT)
          return { ...a, pending, state: pending.length ? 'busy' : was === 'busy' ? 'thinking' : was, tool: a.tool === COMPACT ? '' : a.tool, ...(r?.messages && !r.skip ? { compactions: (a.compactions ?? 0) + 1, ctx: undefined } : {}) }
        })
        // The summarising call costs tokens too; turns do not count them.
        const u = r?.usage
        const spent = u && !isDemoAgent(id) ? { tokens: (d.spent?.tokens ?? 0) + tokensOf(u), cost: (d.spent?.cost ?? 0) + costOf(u) } : d.spent
        return log({ ...d, spent }, id, 'info', line)
      })
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const id = r.agentId
      const parent = agentOf(e)
      const spawnKind = typeof e.subagentType === 'string' && e.subagentType ? e.subagentType.slice(0, 60) : 'general-purpose'
      const spawnDesc = typeof e.description === 'string' ? e.description.slice(0, 200) : ''
      await write?.(c => {
        const from = c.agents.find(a => a.id === parent)?.node ?? ''
        const d = upsert(c, id, a => ({
          ...a,
          ...(a.kind === 'agent' ? { kind: spawnKind, name: freshName(c.agents.filter(x => x.id !== id), spawnKind) } : {}),
          spawnId: e.tool_use_id,
          parent,
          job: trunc(oneLine(spawnDesc || (typeof e.prompt === 'string' ? e.prompt.slice(0, 600) : '')), 400),
          goal: trunc(oneLine([spawnDesc, typeof e.prompt === 'string' ? e.prompt.slice(0, 3000) : ''].filter(Boolean).join(': ')), 1500),
          since: Date.now(),
          state: 'thinking',
          node: from,
        }))
        return log(d, id, 'info', `joined${spawnDesc ? ` · ${spawnDesc}` : ''}`)
      })
    }
    return r
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.door === 'response' && e.message?.role === 'assistant') {
      const blocks = (Array.isArray(e.message.content) ? e.message.content : []) as unknown as {
        type: string
        text?: string
        thinking?: string
      }[]
      // Its gist for its row and the log, and all of it for the log line opened.
      const lines = blocks
        .map(b => (b.type === 'thinking' ? b.thinking : b.type === 'text' ? b.text : '') ?? '')
        .map(t => ({ line: summarise(t), full: cleanSaid(t) }))
        .filter(x => x.line)
        .slice(0, 2)
      if (lines.length) {
        const id = agentOf(e)
        await write?.(c => lines.reduce((d, x) => think(d, id, x.line, x.full), c))
      }
    }
    return r
  })

  // Claude's own look at the chat list keeps the nested chats current too; a chat it starts shows soon after.
  on('tool.call', { tool: LIST_TOOL }, async ($, e, next) => {
    const r = await next(e)
    const a = e as unknown as Record<string, unknown>
    if (!pollingChats && !a.group && 'text' in r && typeof r.text === 'string' && !r.isError && (a.linked === true || hostId)) {
      const chats = chatsOf(r.text, a.linked === true ? '' : hostId)
      const siblings = a.linked === true || !chats ? undefined : siblingsOf(r.text, hostId, new Set(chats.map(x => x.id)))
      if (chats) await write?.(d => ({ ...d, chats, ...(siblings ? { siblings } : {}) }))
    }
    return r
  })
  // Claude working with the other chats (starting one, messaging it, reading it, changing it): the list
  // is read again soon after, and a chat Claude read itself takes what it saw.
  on('tool.call', { tool: /^(SendMessage|mcp__ccd_session(_mgmt)?__\w+)$/ }, async ($, e, next) => {
    if (typeof e.tool !== 'string' || pollingChats || e.tool === LIST_TOOL) return next(e)
    const r = await next(e)
    after?.(1500, () => void refreshChats?.())
    const text = 'text' in r && typeof r.text === 'string' && !r.isError ? r.text : ''
    if (e.tool.endsWith('__get_session') && text) {
      let s: Record<string, unknown> = {}
      try {
        s = JSON.parse(text)
      } catch {}
      const id = typeof s.sessionId === 'string' ? s.sessionId : ''
      if (id)
        await write?.(d =>
          d.chats?.some(x => x.id === id)
            ? { ...d, chats: d.chats.map(x => (x.id === id ? { ...x, running: s.isRunning === true, at: Date.parse(String(s.lastActivityAt ?? '')) || x.at, seen: Date.now() } : x)) }
            : d,
        )
    }
    return r
  })
  on('tool.call', async ($, e, next) => {
    // A call without a tool name is none of the pane's business, nor the pane's own read of the chat list.
    if (typeof e.tool !== 'string' || !e.tool || (pollingChats && e.tool === LIST_TOOL)) return next(e)
    const a = e as unknown as Record<string, unknown>
    const id = e.agentId ?? 'main'
    const node = nodeOf(e.tool, a)
    const detail = detailOf(e.tool, a).slice(0, 300)
    const callId = e.tool_use_id ?? `call-${Date.now()}-${Math.random()}`
    const started = Date.now()
    const line = trunc(actionLine(e.tool, node, detail, typeof a.description === 'string' ? a.description : ''), 200)

    // Todo lists are the agent's own word on how far along it is: TodoWrite's, or the desktop app's task list.
    const todos = Array.isArray(a.todos) ? (a.todos.filter(t => t && typeof t === 'object') as { status?: string; content?: string; activeForm?: string }[]) : undefined
    const plans = e.tool === PLAN_TOOL

    // Lines this call adds and removes, known before it runs (a Write's from the file it replaces).
    const str = (k: string, o: Record<string, unknown> = a) => (typeof o[k] === 'string' ? (o[k] as string) : '')
    let delta: { added: number; removed: number } | 'read' | undefined
    if (e.tool === 'Edit') delta = lineDiff(str('old_string'), str('new_string'))
    else if (e.tool === 'MultiEdit' && Array.isArray(a.edits))
      delta = (a.edits.filter(ed => ed && typeof ed === 'object') as Record<string, unknown>[]).reduce<{ added: number; removed: number }>(
        (s, ed) => {
          const d = lineDiff(str('old_string', ed), str('new_string', ed))
          return { added: s.added + d.added, removed: s.removed + d.removed }
        },
        { added: 0, removed: 0 },
      )
    else if (e.tool === 'Write') delta = lineDiff(readFile ? await readFile(node).catch(() => '') : '', str('content'))
    else if (e.tool === 'NotebookEdit') delta = lineDiff('', str('new_source'))
    else if (e.tool === 'Read') delta = 'read'

    // Two Claudes editing one file within a minute can trample each other: say so.
    if (typeof delta === 'object' && node && readCrew) {
      const before = await readCrew()
      const last = before.changes?.[node]
      const me = before.agents.find(x => x.id === id)?.name ?? (id === 'main' ? 'Claude' : 'a helper')
      if (last && last.edits && last.by && last.by !== me && Date.now() - last.at < 60_000)
        void $.ui.toast(`⚠ ${me} and ${last.by} are both editing ${baseName(node)}`)
    }

    // A test run: shown as running until its output comes back (or, in the background, until it is read).
    const shell = e.tool === 'Bash' || e.tool === 'PowerShell'
    const testCmd = shell ? tidyCmd(str('command')).slice(0, 300) : ''
    const testId = testCmd && isTestCmd(str('command')) ? `test-${callId}` : ''
    const background = a.run_in_background === true
    // Reading a background shell's output can settle the test it was running.
    const outputOf = /^(BashOutput|TaskOutput|KillShell|KillBash|TaskStop)$/.test(e.tool) ? String(a.bash_id ?? a.shell_id ?? a.task_id ?? a.id ?? '') : ''

    await write?.(c => {
      let d = reach(c, node)
      if (testId) {
        const who = d.agents.find(x => x.id === id)
        const run: TestRun = {
          id: testId,
          agentId: id,
          who: who?.name ?? 'Claude',
          hue: who?.hue ?? 0,
          command: testLabel(testCmd),
          purpose: trunc(testPurpose(str('command'), str('description')), 90),
          startedAt: Date.now(),
          endedAt: 0,
          status: 'running',
          passed: 0,
          failed: 0,
          background,
        }
        const kept = (d.tests ?? []).filter(t => t.status === 'running' || Date.now() - t.endedAt < TEST_SHOW_MS)
        // Running ones are kept before finished ones, but never more than 11: a pile of background runs nobody reads drops its oldest.
        const running = kept.filter(t => t.status === 'running').slice(-11)
        // (Counting from the front: slice(-0) would keep them all.)
        const finished = kept.filter(t => t.status !== 'running')
        const recent = finished.slice(Math.max(0, finished.length - (11 - running.length)))
        d = { ...d, tests: [...recent, ...running, run], turnBase: { ...d.turnBase, tests: (d.turnBase?.tests ?? 0) + 1 } }
        d = log(d, id, 'info', `⚗ tests started${background ? ' in the background' : ''} · ${trunc(run.purpose || testPurpose(run.command, ''), 70)}`)
      } else if (shell) {
        const who = d.agents.find(x => x.id === id)
        const sh: ShellRun = { id: `sh-${callId}`, agentId: id, who: who?.name ?? 'Claude', hue: who?.hue ?? 0, label: trunc(oneLine(str('description')).replace(/\.$/, '') || cmdGist(str('command')), 90), startedAt: Date.now(), endedAt: 0, status: 'running', background }
        // Running ones stay (the newest 12); finished ones are kept a little for their log line, then go.
        const kept = (d.shells ?? []).filter(x => x.status === 'running' || Date.now() - x.endedAt < 60_000)
        d = { ...d, shells: [...kept.filter(x => x.status !== 'running').slice(-8), ...kept.filter(x => x.status === 'running').slice(-11), sh] }
      }
      d = upsert(d, id, x => {
        let upd: Agent = {
          ...x,
          node: node || x.node,
          tool: e.tool,
          detail,
          pending: [...x.pending, callId],
          state: 'busy',
          calls: x.calls + 1,
          actions: [line, ...x.actions].slice(0, 5),
        }
        // The app checks off the whole task list itself when Claude wraps up (no update_plan follows): every step done.
        const wrapped = e.tool === WRAP_TOOL && !!x.plan?.length && !x.todoList
        const list = plans ? planAfter(x.plan ?? [], a) : wrapped ? (x.plan ?? []).map(t => ({ ...t, status: 'completed' })) : todos
        if (list) {
          const doing = list.find(t => t.status === 'in_progress') as { content?: string; activeForm?: string } | undefined
          upd = {
            ...upd,
            ...(plans || wrapped
              ? { plan: list as Agent['plan'], todoList: undefined }
              : { todoList: list.slice(0, 40).map(t => ({ content: trunc(oneLine(String(t.content ?? '')), 120), status: String(t.status ?? 'pending'), ...(t.activeForm ? { activeForm: trunc(oneLine(String(t.activeForm)), 120) } : {}) })) }),
            todosTotal: list.length,
            todosDone: list.filter(t => t.status === 'completed').length,
            doing: doing?.activeForm ?? doing?.content ?? '',
          }
        }
        return upd
      })
      const logged = log({ ...d, calls: d.calls + 1 }, id, 'act', line)
      const last = logged.log[logged.log.length - 1]
      // An edit keeps its file (for Open diff); a command shows what it runs while it runs.
      const extra = { call: callId, ...(typeof delta === 'object' && node ? { path: node } : {}), ...(shell ? { more: `$ ${trunc(oneLine(str('command')), 300)}` } : {}) }
      return last && last !== d.log[d.log.length - 1] ? { ...logged, log: [...logged.log.slice(0, -1), { ...last, ...extra }] } : logged
    })

    let ran: unknown
    try {
      const result = await next(e)
      ran = result
      return result
    } finally {
      const stamp = Date.now()
      const ok = !!ran && !(ran as { isError?: boolean }).isError && !(ran as { deny?: string }).deny
      const out = resultText(ran)
      // What came of it, for its line opened: a command's last lines and how it ended, an error, an
      // edit's file (+added −removed) and the lines it changed.
      const more = trunc(
        (() => {
          if (shell) {
            const code = out.match(/exit(?: code)?:?\s*(-?\d+)/i)?.[1]
            const n = testCounts(out)
            const end =
              background && ok
                ? 'started in the background'
                : [ok ? '✓ Exit 0' : code ? `✕ Exit ${code}` : '✕ Failed', n ? [n.failed ? `${n.failed} failed` : '', `${n.passed} passed`].filter(Boolean).join(', ') : '', took(stamp - started)].filter(Boolean).join(' · ')
            return [`$ ${trunc(oneLine(str('command')), 300)}`, background && ok ? '' : tailOf(out), end].filter(Boolean).join('\n')
          }
          if (!ok) return tailOf(out) || (ran as { deny?: string } | undefined)?.deny || "It didn't run."
          const head = typeof delta === 'object' && node ? `${relPath(node)} +${delta.added} −${delta.removed}\n` : ''
          if (e.tool === 'Edit') return head + editDiff(str('old_string'), str('new_string'))
          if (e.tool === 'Write') return head + editDiff('', str('content'), 12)
          if (e.tool === 'NotebookEdit') return head + editDiff('', str('new_source'), 12)
          return ''
        })(),
        MORE_MAX,
      )
      let settled: TestRun[] = []
      let stuckNote = ''
      let problemNote = ''
      await write?.(c => {
        settled = []
        stuckNote = ''
        problemNote = ''
        let d = ok && delta && node && !isSpecial(node) ? record(c, node, id, delta) : c
        // How long the call took, on its line in the log.
        const finished = (l: LogLine): LogLine => ({ ...l, took: Math.max(0, stamp - l.at), ...(more ? { more } : {}), ...(ok ? {} : { bad: true as const }) })
        if (d.log.some(l => l.call === callId && l.took === undefined)) d = { ...d, log: d.log.map(l => (l.call === callId && l.took === undefined ? finished(l) : l)) }
        else {
          // A long call whose line has left the pane's log: its line in the journal finishes instead.
          const kept = [...journal.values()].find(l => l.call === callId && l.took === undefined)
          if (kept) addToJournal(finished(kept))
        }
        if (ok && /^Task(Create|Update|List|Get)$/.test(e.tool)) d = applyTaskCall(d, e.tool, a, ran, out, id)
        // The call is over: a permission it waited on is settled.
        if (d.agents.some(x => x.id === id && x.needs?.tool === e.tool.slice(0, 80))) d = upsert(d, id, x => ({ ...x, needs: undefined }))
        if (testId) {
          // In the background the call returns at once with a shell id; the test runs on.
          const shellId = out.match(/\bID:\s*([\w-]+)/i)?.[1] ?? out.match(/\b(bash_\w+|shell_\w+)\b/)?.[1] ?? ''
          if (background && ok) d = { ...d, tests: d.tests.map(t => (t.id === testId ? { ...t, shellId } : t)) }
          else if (!ok && !out.trim()) d = { ...d, tests: d.tests.map(t => (t.id === testId ? { ...t, status: 'unknown' as const, endedAt: stamp } : t)) }
          else d = settleTest(d, testId, out, !ok, stamp)
        }
        if (shell && !testId) {
          const shId = `sh-${callId}`
          const shellId = out.match(/\bID:\s*([\w-]+)/i)?.[1] ?? out.match(/\b(bash_\w+|shell_\w+)\b/)?.[1] ?? ''
          d = {
            ...d,
            shells: (d.shells ?? []).map(x =>
              x.id !== shId ? x : background && ok && shellId ? { ...x, shellId } : { ...x, status: ok ? ('done' as const) : ('failed' as const), endedAt: stamp },
            ),
          }
        }
        if (outputOf) {
          if (/^(Kill|TaskStop)/.test(e.tool)) d = endShell(d, outputOf, 'stopped', stamp)
          else if (/status>\s*(completed|failed|killed)|<exit_code>|\bexit code\b|status:\s*(completed|failed|killed)/i.test(out))
            d = endShell(d, outputOf, /exit_code>\s*[1-9]|exit code:?\s*[1-9]|status>\s*failed|status:\s*failed/i.test(out) ? 'failed' : /killed/i.test(out) ? 'stopped' : 'done', stamp)
          const t = (d.tests ?? []).find(x => x.status === 'running' && x.background && x.shellId && x.shellId === outputOf)
          const killed = /^(Kill|TaskStop)/.test(e.tool)
          const finished = /status>\s*(completed|failed|killed)|<exit_code>|\bexit code\b|status:\s*(completed|failed|killed)/i.test(out)
          if (t && killed) d = log({ ...d, tests: d.tests.map(x => (x.id === t.id ? { ...x, status: 'unknown' as const, endedAt: stamp } : x)) }, t.agentId, 'info', `⚗ tests stopped · ${trunc(t.purpose || testPurpose(t.command, ''), 60)}`)
          else if (t && finished) d = settleTest(d, t.id, out, /exit_code>\s*[1-9]|exit code:?\s*[1-9]|status>\s*failed|status:\s*failed/i.test(out), stamp)
        }
        settled = (d.tests ?? []).filter(t => t.endedAt === stamp && t.status !== 'running' && t.status !== 'unknown')

        // Problems: a failing build or test replaces the list with the errors it names; a clean one clears it.
        if (shell && !(background && ok) && (testId || isBuildCmd(str('command')) || !ok)) {
          const dir = cmdDir(str('command'), sessionDir)
          const found = parseProblems(out).map(p => ({ ...p, path: resolvePath(p.path, dir) }))
          const testFailed = (d.tests ?? []).some(t => t.id === testId && t.status === 'failed')
          const who = d.agents.find(x => x.id === id)
          if (found.length && (!ok || testFailed || /\berror\b/i.test(out))) {
            const problems: Problem[] = found.map(p => ({ ...p, source: testLabel(testCmd), by: who?.name ?? 'Claude', hue: who?.hue ?? 0, at: stamp }))
            d = { ...d, problems }
            // A broken file joins Touched, so its red mark has somewhere to sit.
            for (const p of problems.slice(0, 8)) if (!d.reached?.[p.path]) d = reach(d, p.path)
            problemNote = `✗ ${problems.length} error${problems.length === 1 ? '' : 's'} in ${[...new Set(problems.map(p => baseName(p.path)))].slice(0, 3).join(', ')}`
            d = log(d, id, 'info', `${problemNote} (from ${trunc(testId ? testPurpose(str('command'), str('description')) : cmdGist(str('command')), 50)})`)
          } else if (ok && !testFailed && (testId || isBuildCmd(str('command'))) && (d.problems ?? []).length) {
            d = log({ ...d, problems: [] }, id, 'info', `✓ problems cleared: ${trunc(testLabel(testCmd), 50)} ran clean`)
          }
        }

        // Stuck: the same command failing again and again, and the like.
        const sig = shell ? `$ ${testLabel(testCmd)}` : typeof delta === 'object' && node ? `✎ ${baseName(node)}` : `${e.tool}`
        const me = d.agents.find(x => x.id === id)
        if (me && !/^(TodoWrite|TaskCreate|TaskUpdate|Agent|Task)$/.test(e.tool)) {
          const recent = [...(me.recent ?? []), { sig, ok, at: stamp }].slice(-12)
          const why = stuckReason(recent, stamp)
          if (why && !me.stuck) stuckNote = `⚠ ${me.name} looks stuck: it ${why}`
          d = upsert(d, id, x => ({ ...x, recent, stuck: why }))
          if (stuckNote) d = log(d, id, 'info', stuckNote)
        }
        if (!ok) {
          // Mark the call failed (or refused) in its recent actions. Its log line keeps its words (they are its
          // key) and is marked `bad` above; a refusal is marked too, and the words are added where it shows.
          const refused = !!(ran as { deny?: string } | undefined)?.deny
          if (refused) d = { ...d, log: d.log.map(l => (l.call === callId ? { ...l, refused: true as const } : l)) }
          d = upsert(d, id, x => ({ ...x, actions: x.actions.map((t, i) => (i === x.actions.indexOf(line) ? t + (refused ? ' ✗ refused' : ' ✗ failed') : t)) }))
        }
        d = upsert(d, id, x => {
          const pending = x.pending.filter(p => p !== callId)
          return { ...x, pending, state: pending.length ? 'busy' : x.state === 'busy' ? 'thinking' : x.state, doneAt: stamp }
        })
        // (One started in the background works on after the call returns: its own turn's end says it is done.)
        if ((e.tool === 'Agent' || e.tool === 'Task') && a.run_in_background !== true)
          d = {
            ...d,
            agents: d.agents.map(x =>
              !!e.tool_use_id && x.spawnId === e.tool_use_id && x.state !== 'busy'
                ? { ...x, state: 'done', doneAt: stamp, pending: [] }
                : x,
            ),
          }
        return d
      })
      if (stuckNote) void $.ui.toast(stuckNote)
      if (problemNote && !settled.length) void $.ui.toast(problemNote)
      const toastTests = settled.length ? !!(await readCrew?.())?.testToasts : false
      for (const t of toastTests ? settled : [])
        // Short and in words: who, how it went, what for. Never the command. (Settings: Test toasts, off by default.)
        void $.ui.toast(`${t.status === 'failed' ? '✗ Tests failed' : '✓ Tests passed'} (${testWords(t)}) · ${trunc(t.purpose || testPurpose(t.command, ''), 48)}${t.agentId === 'main' ? '' : ` · ${t.who}`}`)
      settleLater(id, stamp)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e) as unknown as Record<string, (props: unknown) => unknown>
    const cols = Math.max(40, e.props?.bodyColumns ?? e.viewport?.columns ?? 80)

    // The website runs: the pane on the desktop only says where, and how to open it beside the chat.
    // On the desktop the pane points at the website: running, starting, or to be opened with /crew. Only
    // when it could not start at all (no Node) does the pane draw the whole view itself.
    if (e.surface !== 'terminal' && !webFailed) {
      const c = await read($, crew)
      const atWork = c.agents.filter(a => a.state === 'busy' || a.state === 'thinking').length
      const needs = c.agents.filter(a => a.needs).length
      const total = c.chatCost ?? c.spent?.cost ?? 0
      const status = [`${fmtK(c.agents.length)} Claude${c.agents.length === 1 ? '' : 's'}`, needs ? `${fmtK(needs)} need${needs === 1 ? 's' : ''} you` : '', atWork ? `${fmtK(atWork)} working` : 'nothing running', total > 0 ? fmtUsd(total) : ''].filter(Boolean).join(' · ')
      return paintPane(
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold color="#D97757">{'✻ Claude Crew'}</Text>
            <Text color="#8B949E">{" · this chat's crew is a website"}</Text>
          </Box>
          {webUrl ? (
            <Box flexDirection="row">
              <Text color="#3FB950">{'● '}</Text>
              <Text>{'running at '}</Text>
              <Link href={webUrl} />
            </Box>
          ) : (
            <Text color="#8B949E">{webState === 'starting' ? 'Starting…' : 'Type /crew to open it beside the chat'}</Text>
          )}
          {webUrl ? <Text color="#8B949E">{'Type /crew to open it beside the chat, or click the address.'}</Text> : null}
          <Text color={needs ? '#E3B341' : '#8B949E'}>{status}</Text>
        </Box>,
        c.theme ?? 'auto',
      )
    }

    // The terminal, or the desktop when the website could not start: the pane as lines of text, each
    // thing pressed a Button.
    const m = await paneModel($, cols, e.props?.scroll?.bodyRows ?? 0)
    const { c, sq, vwCols, totalCost, wide, paneAct, tab, rowsP, openDetails, openDir, counts, costRole, budgetText, recap, touchFolders, touchedSum, BODY_ROWS, listed, top0, scroll, tabs } = m
    const mode = c.theme ?? 'auto'
    const TONE: Record<string, string> = { text: '#E6EDF3', dim: '#8B949E', faint: '#8B949E', amber: '#E3B341', green: '#3FB950', red: '#F85149', brand: '#D97757', line: '#30363D', cx: '#8B949E', wait: '#8C8CFF' }
    const toneOf = (role: string) => TONE[role] ?? (/^h\d+$/.test(role) ? PALETTE[Number(role.slice(1))] : '#E6EDF3')
    const press = (act: Act) => (p: { surface: unknown }) => void doAction($, act, p?.surface)
    const segEl = (g: Seg, k: string) => {
      const lead = `${g.dot ? '● ' : ''}${g.icon ? `${KIND_GLYPH[g.icon[0]] ?? '•'} ` : ''}${g.bar !== undefined ? `${'▮'.repeat(Math.round(g.bar * 8))}${'▯'.repeat(8 - Math.round(g.bar * 8))} ` : ''}`
      const t = `${lead}${g.t ?? ''}`
      if (!t && !g.parts) return null
      const cells = g.w ? Math.floor(g.w / CELL_W) : 0
      const body = cells ? cutTo(t, Math.max(1, cells)).padEnd(cells) : t
      const tone = toneOf(g.dot ?? g.role ?? 'text')
      if (g.run) {
        const act = g.run
        // A Button holds its words as Text, so a file keeps its colours: its name, its +/− and its errors.
        return (
          <Button key={k} plain onPress={press(act)}>
            {(g.parts ?? [[body, g.role ?? 'text']]).map(([pt, role], i) => (
              <Text key={`${k}p${i}`} mono size="footnote" color={toneOf(role)} bold={g.b} underline={g.u}>
                {pt}
              </Text>
            ))}
          </Button>
        )
      }
      // A mark before words (a Claude's dot, a kind's glyph) in its own colour, the words in theirs.
      if (lead && g.t && !cells)
        return [
          <Text key={`${k}m`} mono size="footnote" color={tone}>
            {lead}
          </Text>,
          <Text key={k} mono size="footnote" color={toneOf(g.role ?? 'text')} bold={g.b} italic={g.i} wrap="truncate">
            {g.t}
          </Text>,
        ]
      return (
        <Text key={k} mono size="footnote" color={tone} bold={g.b} italic={g.i} wrap="truncate">
          {body}
        </Text>
      )
    }
    const lineEl = (l: VLine, k: string) => (
      <Box key={k} flexDirection="row" height={1} overflow="hidden">
        {l.indent ? <Text mono size="footnote">{' '.repeat(Math.round(l.indent / CELL_W))}</Text> : null}
        {l.segs.map((g, i) => (
          <Box key={`${k}s${i}`} flexDirection="row" flexShrink={g.flex ? 1 : 0}>
            {segEl(g, `${k}g${i}`)}
            <Text mono size="footnote">{' '}</Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        {(l.right ?? []).map((g, i) => (
          <Box key={`${k}r${i}`} flexDirection="row" flexShrink={0}>
            <Text mono size="footnote">{' '}</Text>
            {segEl(g, `${k}h${i}`)}
          </Box>
        ))}
      </Box>
    )

    // The header: the brand, the counts by state, and the one cost.
    const headLine: VLine = { segs: [{ t: '✻ Claude Crew', b: true, role: 'brand' }, ...counts.map(([t, role, b]) => ({ t, role, b }))], right: totalCost > 0 || c.budget > 0 ? [{ t: `${fmtUsd(totalCost)}${budgetText ? ` ${budgetText}` : ''}`, role: costRole }] : [] }

    // The Claudes: a row's lines in a Box of its own, its Details a Button on its last line.
    const rowLines = (r: PaneRow): VLine[] => {
      const indent = r.state === 'you' ? 0 : Math.min(3, r.depth) * 2 * CELL_W
      const details: Seg = { t: r.focused ? 'Hide' : 'Details', role: 'dim', run: openDetails(r.id) }
      // A chat not read live: its state dim, "as of 13:09" faint (in a terminal, after its state).
      const sr = stateRole(r)
      const term = r.asOf && e.surface === 'terminal'
      const one: VLine = { indent, segs: [{ dot: hueRole(r.hue), t: r.name, b: r.state !== 'done', role: r.state === 'done' ? 'dim' : 'text' }, { icon: [r.kind, sr], t: term ? `${r.status} (as of ${r.asOf})` : r.status, b: true, role: sr }, { t: term ? '' : r.object, flex: true, role: r.asOf ? 'faint' : r.state === 'done' ? 'dim' : 'text' }], right: [{ t: r.time, role: 'dim' }] }
      if (r.state === 'done') return [one]
      if (r.state === 'you') return [one, ...wrapRows(r.ask, Math.max(16, cols - 6), 6).map(t => ({ indent: indent + 2 * CELL_W, segs: [{ t }] })), { indent: indent + 2 * CELL_W, segs: [{ t: r.where, role: 'dim', flex: true }], right: [details] }]
      // A pip per step, up to 15 (none above): ● done, ○ to come.
      const pips = r.total && r.total <= 15 ? `${'●'.repeat(Math.min(r.total, r.done))}${'○'.repeat(Math.max(0, r.total - r.done))}` : ''
      return [one, { indent: indent + 2 * CELL_W, segs: [{ t: pips, role: 'dim' }, { t: r.progress, role: r.stuck ? 'amber' : 'dim', flex: true }], right: [...(wide && r.model ? [{ t: r.model, role: 'faint' }] : []), details] }]
    }
    const recapLines: VLine[] = recap
      ? recap.copy
        ? [{ segs: [{ icon: ['done', 'green'], t: recap.title, b: true, role: 'green' }, { t: recap.goal, role: 'dim', flex: true }], right: [{ t: recap.ago, role: 'dim' }] }, ...recap.facts.map(([k, v, role]) => ({ indent: 2 * CELL_W, segs: [{ t: k, w: 9 * CELL_W, role: 'dim' }, { t: v, role, flex: true }] })), { indent: 2 * CELL_W, segs: [{ t: 'Copy as Markdown', role: 'dim', u: true, run: recap.copy }] }]
        : [{ segs: [{ t: recap.title, role: 'dim', flex: true }] }, { segs: [{ t: '▶ Try a pretend session', role: 'dim', u: true, run: recap.demo }] }]
      : []

    // Touched: a line per folder, each file a Button in its colours, as many as the line holds, then +N more.
    const folderCols = wide ? 15 : 12
    const touchLines: VLine[] = [
      { segs: [{ t: 'Touched', b: true }, { t: touchedSum, role: 'dim', flex: true }], right: sessionDir ? [{ t: 'Open folder', role: 'dim', u: true, run: openDir(sessionDir, 'the project folder') }] : [] },
      ...touchFolders.map(d => {
        let room = vwCols - folderCols - 2
        const files: Seg[] = []
        for (const [i, f] of d.files.entries()) {
          const parts: [string, string][] = [...(f.on ? ([['● ', f.on]] as [string, string][]) : []), [f.name, f.errs ? 'red' : f.read ? 'dim' : 'text'], ...(f.errs ? ([[` ✕${f.errs}`, 'red']] as [string, string][]) : []), ...(f.add ? ([[` +${fmtK(f.add)}`, 'green']] as [string, string][]) : []), ...(f.del ? ([[` −${fmtK(f.del)}`, 'dim']] as [string, string][]) : [])]
          const w = parts.reduce((n, [t]) => n + textW(t), 0) + 2
          // Room for this file, and for "+N more" after it when more are left.
          if (room < w + (i < d.files.length - 1 ? 10 : 0)) break
          files.push({ parts, t: parts.map(p => p[0]).join(''), run: f.run })
          room -= w
        }
        if (files.length < d.files.length) files.push({ t: `+${fmtK(d.files.length - files.length)} more`, role: 'dim', u: true, run: paneAct({ tab: 'files', top: 0 }) })
        return { segs: [{ t: d.name, w: folderCols * CELL_W, role: 'dim' }, ...files] }
      }),
      ...(touchFolders.length ? [] : [{ segs: [{ t: 'No files yet. Folders show here as the Claudes open files.', role: 'dim', flex: true }] }]),
    ]
    while (touchLines.length < 4) touchLines.push({ segs: [] })

    // The tabs (the one shown bold), then scrolling: each a Button, readable at rest.
    const tabLine: VLine = {
      segs: tabs.map(t => ({ t: t.t, role: t.on ? 'text' : 'dim', b: t.on, u: t.on, run: t.run, gap: 2 })),
      right: [
        { t: '▲ older', role: scroll.canUp ? 'text' : 'dim', run: scroll.up },
        { t: '▼ newer', role: scroll.canDown ? 'text' : 'dim', run: scroll.down },
        { t: '⤓ latest', role: scroll.held ? 'text' : 'dim', run: scroll.latest },
      ],
    }
    const searchEl = tab === 'search' ? (
      <Box key="search-row" flexDirection="row">
        <Text mono size="footnote" color="#8B949E">{'⌕ '}</Text>
        <Box flexGrow={1}>
          <Input key="search-input" placeholder="Search files and the log..." value={sq.q} submitLabel="" onInput={(v: string) => void searchFor($, v)} onSubmit={(v: string) => void searchFor($, v)} />
        </Box>
      </Box>
    ) : null
    const view = listed.slice(top0, top0 + BODY_ROWS)
    return paintPane(
      <Box flexDirection="column">
        {lineEl(headLine, 'head')}
        <Box key="crew" flexDirection="column" marginTop={1}>
          {rowsP.map(r => (
            <Box key={`row-${r.id}`} flexDirection="column">
              {rowLines(r).map((l, i) => lineEl(l, `${r.id}:${i}`))}
            </Box>
          ))}
          {recapLines.map((l, i) => lineEl(l, `recap${i}`))}
        </Box>
        <Box key="touched" flexDirection="column" marginTop={1}>
          {touchLines.map((l, i) => lineEl(l, `touch${i}`))}
        </Box>
        <Box key="tabs" flexDirection="column" marginTop={1}>
          {lineEl(tabLine, 'tabs')}
        </Box>
        {searchEl}
        <Box key="view" flexDirection="column" height={BODY_ROWS} overflow="hidden">
          {view.map((l, i) => lineEl(l, `body${i}`))}
        </Box>
      </Box>,
      mode,
    )
  })
}
