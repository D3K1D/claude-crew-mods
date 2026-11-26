import { read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Change, Chat, Crew, LogLine } from '../types'
import { PALETTE, PANE, SHELL_GIVE_UP_MS, VERSION, baseName, chatHue, clock, doingOf, editor, failMark, fileInProject, fmtK, fmtUsd, fullOf, giveColor, hash, isSpecial, knownColors, log, logKey, messageOf, note, oneLine, projectRoot, promptOf, readCrew, sessionDir, shortOf, stepMark, stepsOf, systemNote, tasksOf, took, trunc, write } from './track'
import { isDemoAgent, isDemoPath } from './demo'
import { CELL_W, KIND_ICON, LOG_GLYPH, THEMES, THEME_LABEL, doAction, hueRole, paneModel, searchFor } from './model'
import type { Act, GlanceRow, PaneRow, Seg, VLine } from './model'

// This chat's website (the server, the view it is sent, the page's presses), its journal on disk, the
// nested and same-project chats read from theirs, and saving the log.

/** A log line for the website: what it shows closed; `more` when opening it shows more than its words (the page asks for that). */
export const webLine = (l: LogLine) => {
  const m = messageOf(l)
  const said = oneLine(shortOf(l))
  const t = l.kind === 'think' || m ? said : said.replace(/^[^\p{L}\p{N}"'(\[$~./]+/u, '')
  // A nested chat's line: a bubble in the chat's colour, its name, and the helper there (or who wrote) first.
  const by = l.chat ? (m ? m.from || 'You' : l.by) : ''
  return {
    key: logKey(l),
    at: l.at,
    time: clock(l.at),
    dot: l.chat ? (nested.get(l.chat)?.sibling && !knownColors[`chat:${l.chat}`] ? 'dim' : `h${chatHue(l.chat)}`) : m ? 'text' : l.hue < 0 ? 'cx' : `h${l.hue % PALETTE.length}`,
    ...(l.chat && nested.get(l.chat)?.sibling ? { proj: l.chat } : {}),
    who: l.chat ? l.who : m ? m.from || 'You' : l.who,
    chat: l.chat ? l.who : undefined,
    chatTitle: l.chat ? nested.get(l.chat)?.title : undefined,
    by: by || undefined,
    kind: l.kind === 'think' ? 'thought' : m ? 'msg' : LOG_GLYPH[[...l.text][0]] ?? (l.kind === 'info' ? 'plan' : 'tool'),
    // Still running: the page counts its time up.
    run: l.took === undefined && !!l.call && Date.now() - l.at < SHELL_GIVE_UP_MS ? true : undefined,
    text: t && !/^\S*[/.\\]/.test(t) ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : t,
    more: oneLine(fullOf(l)) !== said ? true : undefined,
    bad: l.bad,
    dim: l.kind === 'think' || l.kind === 'info' ? true : undefined,
    thought: l.kind === 'think' ? true : undefined,
    dur: l.took !== undefined ? took(l.took) : '',
  }
}

/** The chat's Claude Crew website: the server this mod runs for it, its address, and who has it open. */
export let webUrl = ''
/** Posts to the website: the view ('push'), or 'ping' so it knows the mod is still here (it stops after a quiet minute). */
let webPost: ((path: 'push' | 'ping' | 'export' | 'reply', body?: string) => Promise<unknown>) | undefined
let webPinged = 0
let webWatchers = 0
let webSent = ''
let webBusy = false
/** What each press on the page does, by the id the page sends back (only ids the mod handed out). */
// Two maps: the ids of this view and the last, so a big map makes room between views, never in the
// middle of one (an id the page holds still works).
let webActs = new Map<string, Act>()
let webActsBefore = new Map<string, Act>()
const actOf = (id: string) => webActs.get(id) ?? webActsBefore.get(id)
const actId = (a: Act) => {
  const s = JSON.stringify(a)
  // Two hashes (about 64 bits); one that is taken by another press gets a suffix.
  let id = `${(hash(s) >>> 0).toString(36)}${(hash(`crew|${s}`) >>> 0).toString(36)}`
  for (let n = 1; n <= 50 && actOf(id) && JSON.stringify(actOf(id)) !== s; n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  webActs.set(id, a)
  return id
}
const newActs = () => {
  if (webActs.size < 4000) return
  webActsBefore = webActs
  webActs = new Map()
}
/** The website's view: the pane's model as data, each press an id. */
async function webView($: EngineInterface) {
  newActs()
  const m = await paneModel($, 160, 700, true)
  const webRow = (r: PaneRow) => ({
    id: r.id,
    name: r.name,
    hue: hueRole(r.hue),
    state: r.state,
    kind: r.kind,
    status: r.status,
    object: r.object,
    time: r.time,
    total: r.total,
    done: r.done,
    progress: r.progress,
    stuck: !!r.stuck,
    asOf: r.asOf,
    model: r.model,
    depth: r.depth,
    ctx: r.ctx,
    helpers: r.helpers || undefined,
    ask: r.ask,
    where: r.where,
    focused: r.focused,
    details: actId(m.openDetails(r.id)),
  })
  const seg = (g: Seg) => ({
    t: g.t ?? '',
    role: g.role,
    b: g.b || undefined,
    i: g.i || undefined,
    u: g.u || undefined,
    w: g.w ? Math.round(g.w / CELL_W) : undefined,
    flex: g.flex || undefined,
    dot: g.dot,
    icon: g.icon,
    bar: g.bar,
    parts: g.parts,
    tail: g.tail,
    act: g.run && g.run.k !== 'none' ? actId(g.run) : undefined,
    label: g.label,
    tip: g.tip,
  })
  const line = (l: VLine) => ({ segs: l.segs.map(seg), right: (l.right ?? []).map(seg), indent: l.indent ? Math.round(l.indent / CELL_W) : 0, ...(l.head ? { head: true } : {}), ...(l.row ? { row: { ...l.row, run: undefined, act: actId(l.row.run) } } : {}) })
  return {
    v: VERSION,
    theme: m.c.theme ?? 'auto',
    icons: KIND_ICON,
    head: { counts: m.counts, cost: m.totalCost > 0 || m.c.budget > 0 ? fmtUsd(m.totalCost) : '', costRole: m.costRole, budget: m.budgetText, costTitle: m.costTitle },
    rows: m.rowsP.map(webRow),
    project: m.projP.map(r => ({ ...webRow(r), title: r.name, idle: r.state === 'idle' || r.state === 'done', ago: r.ago, plain: r.plain || undefined })),
    recap: m.recap
      ? { title: m.recap.title, goal: m.recap.goal, ago: m.recap.ago, facts: m.recap.facts, full: !!m.recap.copy, demo: m.recap.demo ? actId(m.recap.demo) : '' }
      : null,
    touched: {
      sum: m.touchedSum,
      // (" · 5 by nested chats": on a wide page only.)
      nested: m.byNested ? ` · ${fmtK(m.byNested)} by nested chats` : '',
      open: sessionDir ? actId(m.openDir(sessionDir, 'the project folder')) : '',
      more: actId(m.paneAct({ tab: 'files', top: 0 })),
      folders: m.touchFolders.map(d => ({
        name: d.name,
        files: d.files.slice(0, 12).map(f => ({ name: f.name, errs: f.errs, add: f.add ? `+${fmtK(f.add)}` : '', del: f.del ? `−${fmtK(f.del)}` : '', on: f.on, read: !!f.read, act: actId(f.run), chat: f.chat, title: f.title })),
        more: Math.max(0, d.files.length - 12),
      })),
    },
    tabs: m.tabs.map(t => ({ t: t.t, label: t.label, on: t.on, act: actId(t.run) })),
    tab: m.tab,
    q: m.sq.q,
    settings:
      m.tab === 'settings'
        ? {
            themes: THEMES.map(t => ({ t: THEME_LABEL[t], on: (m.c.theme ?? 'auto') === t, act: actId({ k: 'set', theme: t }) })),
            budget: m.c.budget || 0,
            editor: m.c.editor || 'code',
            hideOutside: !!m.c.hideOutside,
            outside: [actId({ k: 'set', hideOutside: false }), actId({ k: 'set', hideOutside: true })],
            demoOn: m.c.agents.some(a => isDemoAgent(a.id) && a.state !== 'done'),
            demo: actId({ k: 'demo' }),
            autoSave: !!m.c.autoSave,
            autoActs: [actId({ k: 'set', autoSave: false }), actId({ k: 'set', autoSave: true })],
            testToasts: !!m.c.testToasts,
            toastActs: [actId({ k: 'set', testToasts: false }), actId({ k: 'set', testToasts: true })],
            version: VERSION,
          }
        : null,
    log: m.tab === 'activity' ? m.webLog : [],
    // Saved on disk before the oldest line sent: how many, and back to when (Load older says so).
    older: m.tab === 'activity' ? savedBefore(m.webLog[0]?.at ?? Infinity) : null,
    logActs: { copy: actId({ k: 'logout', how: 'copy' }), download: actId({ k: 'logout', how: 'download' }), save: actId({ k: 'logout', how: 'save' }) },
    logSave: { busy: saving, at: lastSave ? clock(lastSave.at) : '', file: lastSave?.file ?? '', summary: !!lastSave?.summary },
    lines: m.tab === 'activity' ? [] : m.listed.slice(0, 600).map(line),
  }
}
/** Sends the website the view when it changed, while anyone has the page open. */
export async function publishWeb($: EngineInterface) {
  if (webPost && Date.now() - webPinged > 15_000) {
    webPinged = Date.now()
    void webPost('ping')
  }
  if (!webPost || !webWatchers || webBusy) return
  webBusy = true
  try {
    const s = JSON.stringify(await webView($))
    if (s !== webSent) {
      webSent = s
      await webPost('push', s)
    }
  } catch (err) {
    note(`web view: ${String(err).slice(0, 160)}`)
  } finally {
    webBusy = false
  }
}
/**
 * The whole log of this chat, kept on disk as it grows (the pane keeps only its newest lines and
 * starts over when Claude restarts), so Save, Copy and Download have all of it. A folder per chat,
 * ~/.claude/crew-map/journals/<session id>/, of numbered chunks of 250 lines (000001.json …, each a
 * JSON array). A tick writes only the chunks that changed: the newest, and an older one whose line
 * finished late. (A chat's single <session id>.json from before is carried over once.) $.fs.write has
 * no rename, so a write is not atomic: a crash in the middle of one can lose that chunk (250 lines at
 * most). A chunk that does not parse is skipped when the journal is read; the others are untouched.
 */
export const journal = new Map<string, LogLine>()
const CHUNK = 250
const JOURNAL_KEEP = 5000
let journalDir = ''
/** Read in (or there was nothing to read): lines can be added. */
let journalOpen = false
/** Its oldest lines were left out (it keeps the newest 5,000): exports say so. */
let journalCut = false
export let journalSid = ''
/** Which chunk each line is in, each chunk's lines in order, and the chunks to write. */
const chunkOf = new Map<string, number>()
const chunks = new Map<number, string[]>()
const dirtyChunks = new Set<number>()
let lastChunk = 1
const chunkName = (n: number) => `${String(n).padStart(6, '0')}.json`
const isLine = (l: unknown): l is LogLine => !!l && typeof (l as LogLine).at === 'number' && typeof (l as LogLine).text === 'string'
/** A line into the journal: a new one at the end of the newest chunk, a changed one where it is. */
export const addToJournal = (l: LogLine, chunk?: number) => {
  const k = logKey(l)
  const at = chunkOf.get(k)
  if (at !== undefined) {
    const was = journal.get(k)
    if (was && was.took === l.took && was.more === l.more && was.bad === l.bad) return
    journal.set(k, l)
    dirtyChunks.add(at)
    return
  }
  const n = chunk ?? ((chunks.get(lastChunk)?.length ?? 0) >= CHUNK ? lastChunk + 1 : lastChunk)
  lastChunk = Math.max(lastChunk, n)
  chunks.set(n, [...(chunks.get(n) ?? []), k])
  chunkOf.set(k, n)
  journal.set(k, l)
  if (chunk === undefined) dirtyChunks.add(n)
  // Bounded: the oldest chunk leaves memory (its file stays, until it is pruned).
  while (journal.size > JOURNAL_KEEP && chunks.size > 1) {
    journalCut = true
    const first = Math.min(...chunks.keys())
    for (const x of chunks.get(first) ?? []) {
      journal.delete(x)
      chunkOf.delete(x)
    }
    chunks.delete(first)
    dirtyChunks.delete(first)
  }
}
export const later$ = <T,>(fn: () => Promise<T> | T) => Promise.resolve().then(fn)
/**
 * Sets one chat's entry in a store map every chat shares (webAddress, logFiles, summarised): read again
 * right before the write, so another chat's entry written meanwhile stays; the newest `keep` stay.
 */
async function storeEntry($: EngineInterface, key: string, id: string, value: unknown, keep: number) {
  const now = ((await $.store.get(key).catch(() => undefined)) ?? {}) as Record<string, unknown>
  const { [id]: _, ...rest } = now
  await $.store.set(key, Object.fromEntries([...Object.entries(rest), [id, value]].slice(-keep))).catch(() => undefined)
}
const journalLines = () => [...journal.values()].sort((x, y) => x.at - y.at)
/** This chat's whole log and its nested chats', in time order: what Copy, Download, Save and Load older have. */
const everyLine = () => [...journalLines(), ...nestedLines()].sort((x, y) => x.at - y.at)
export const listDir = (path: string) => later$(() => fsList?.(path) ?? []).catch(() => []) as Promise<{ name: string; mtimeMs?: number }[]>
export const readJson = (path: string) => later$(async () => JSON.parse(String(await fsRead?.(path))) as unknown).catch(() => undefined)
/** A journal folder's chunk numbers, oldest first. */
const chunkList = async (dir: string, entries?: { name: string; mtimeMs?: number }[]) =>
  (entries ?? (await listDir(dir)))
    .filter(f => /^\d{6}\.json$/.test(f.name))
    .map(f => ({ n: Number(f.name.slice(0, 6)), at: f.mtimeMs ?? 0 }))
    .sort((x, y) => x.n - y.n)
/** The engine's file reads, for the helpers above (set when the journal opens). */
let fsList: ((path: string) => Promise<unknown[]>) | undefined
let fsRead: ((path: string) => Promise<unknown>) | undefined
export async function openJournal($: EngineInterface) {
  // Written only once what was there is read in (the timer may tick before then). A new session in the
  // same process starts from nothing: the last one's lines, chunks and nested chats go.
  journalDir = ''
  journalOpen = false
  journalCut = false
  journal.clear()
  chunkOf.clear()
  chunks.clear()
  dirtyChunks.clear()
  lastChunk = 1
  selfSent = ''
  touchedSent = ''
  colorsSent = ''
  nested.clear()
  nestedVer++
  fsList = p => $.fs.list(p)
  fsRead = p => $.fs.read(p)
  journalSid = String((await later$(() => $.session.id()).catch(() => '')) ?? '')
  const home = String((await later$(() => $.env.get('USERPROFILE')).catch(() => undefined)) ?? (await later$(() => $.env.get('HOME')).catch(() => undefined)) ?? '').replace(/\\/g, '/')
  homeDir = home
  await readHostId($)
  const dir = journalSid && home ? `${home}/.claude/crew-map/journals/${journalSid}` : ''
  if (!dir) return void (journalOpen = true)
  const have = await chunkList(dir)
  if (have.length > Math.ceil(JOURNAL_KEEP / CHUNK)) journalCut = true
  for (const { n } of have.slice(-Math.ceil(JOURNAL_KEEP / CHUNK))) {
    const lines = await readJson(`${dir}/${chunkName(n)}`)
    if (Array.isArray(lines)) for (const l of lines) if (isLine(l) && !journal.has(logKey(l))) addToJournal(l, n)
  }
  lastChunk = Math.max(1, have[have.length - 1]?.n ?? 1)
  if (!have.length) {
    const old = await readJson(`${dir}.json`)
    if (Array.isArray(old)) for (const l of old.slice(-JOURNAL_KEEP)) if (isLine(l)) addToJournal(l)
  }
  // What Touched showed before Claude restarted: back, under what this session touches since.
  const saved = await readJson(`${dir}/touched.json`)
  if (Array.isArray(saved)) {
    const back = Object.fromEntries((saved.filter(f => f && typeof f.path === 'string') as TouchedFile[]).map(({ path, errs: _e, editing: _x, ...ch }) => [path, ch as Change]))
    await write?.(d => ({ ...d, changes: { ...back, ...d.changes } }))
    touchedSent = JSON.stringify(saved)
  }
  // Who had which colour: kept, so a restart gives nobody's colour away (their lines are still in the log).
  const held = await readJson(`${dir}/colors.json`)
  if (held && typeof held === 'object' && !Array.isArray(held)) {
    const back = Object.fromEntries(
      Object.entries(held as Record<string, { i?: unknown; at?: unknown }>)
        .filter(([, v]) => v && Number.isInteger(v.i) && (v.i as number) > 0 && (v.i as number) < PALETTE.length)
        .map(([k, v]) => [k, { i: v.i as number, at: Number(v.at) || 0 }]),
    )
    await write?.(d => ({ ...d, colors: { ...back, ...d.colors } }))
    colorsSent = JSON.stringify(held)
  }
  journalDir = dir
  journalOpen = true
}
/**
 * Old journals and steps files go (none written for 30 days, or past the newest 300 journals): $.fs
 * can't delete, so web/prune.mjs does, with Node (which the website needs anyway). Once a day at most.
 */
export async function pruneOld($: EngineInterface) {
  const today = localDay(Date.now())
  if (!homeDir || (await $.store.get('pruned').catch(() => today)) === today) return
  await $.store.set('pruned', today).catch(() => undefined)
  await later$(() => $.process.run(['node', `${$.plugin.root}/web/prune.mjs`, `${homeDir}/.claude/crew-map`, '30', journalSid], { timeoutMs: 20_000 })).catch(() => undefined)
}
/** Takes the log's new lines into the journal (a pretend session's stay out), and writes the chunks that changed. */
export async function syncJournal($: EngineInterface) {
  const c = await readCrew?.()
  // Not until the journal is open: what is on disk goes in first, in its own chunks.
  if (!c || !journalOpen) return
  const demoNames = new Set(c.agents.filter(a => isDemoAgent(a.id)).map(a => a.name))
  const demoOn = demoNames.size > 0
  for (const l of c.log) if (!demoNames.has(l.who) && !(demoOn && l.who === 'Claude')) addToJournal(l)
  if (journalDir)
    for (const n of [...dirtyChunks]) {
      dirtyChunks.delete(n)
      const lines = (chunks.get(n) ?? []).map(k => journal.get(k)).filter(isLine)
      await later$(() => $.fs.write(`${journalDir}/${chunkName(n)}`, JSON.stringify(lines))).catch(() => dirtyChunks.add(n))
    }
  await writeTouched($, c)
  if (journalDir && c.colors && JSON.stringify(c.colors) !== colorsSent) {
    const s = JSON.stringify(c.colors)
    colorsSent = s
    await later$(() => $.fs.write(`${journalDir}/colors.json`, s)).catch(() => (colorsSent = ''))
  }
  await writeSelf($, c)
}
/**
 * What Touched shows, kept beside the journal as touched.json (the newest 200 files, written when it
 * changes): read back when Claude restarts, and read by the chat above to show this chat's files.
 */
type TouchedFile = Change & { path: string; errs?: number; editing?: boolean }
let touchedSent = ''
/** colors.json as last written. */
let colorsSent = ''
async function writeTouched($: EngineInterface, c: Crew) {
  if (!journalDir) return
  const busy = new Set(c.agents.filter(a => a.state === 'busy' && a.node).map(a => a.node))
  const errs = new Map<string, number>()
  for (const p of c.problems ?? []) errs.set(p.path, (errs.get(p.path) ?? 0) + 1)
  const files: TouchedFile[] = Object.entries(c.changes ?? {})
    .filter(([p]) => !isSpecial(p) && !isDemoPath(p))
    .sort((x, y) => y[1].at - x[1].at)
    .slice(0, 200)
    .map(([path, ch]) => ({ path, ...ch, ...(errs.get(path) ? { errs: errs.get(path) } : {}), ...(busy.has(path) ? { editing: true } : {}) }))
  const s = JSON.stringify(files)
  if (s === touchedSent) return
  touchedSent = s
  await later$(() => $.fs.write(`${journalDir}/touched.json`, s)).catch(() => (touchedSent = ''))
}

// ── Nested chats' steps and lines ──
// Each chat's mod writes a small file about itself, ~/.claude/crew-map/chats/<its app id>.json: its
// journal's name and its steps. The chat that started it (any chat above it) reads that file and the
// journal chunks that changed, every few seconds, so their steps fill its card and their lines join its
// log. (Files, not $.store: one file per chat, so two chats never write the same one.)
/** A Claude of a nested chat, as that chat's own pane shows it: its card, and what its Details show. */
export type NestedRow = Pick<GlanceRow, 'id' | 'name' | 'hue' | 'state' | 'kind' | 'status' | 'object' | 'time' | 'total' | 'done' | 'progress' | 'model' | 'depth' | 'helpers'> & {
  stuck?: boolean
  ask?: string
  info?: { cost: number; tokens: number; ctx?: { tokens: number; window: number }; compactions?: number; asked: string; steps: { mark: string; text: string; on: boolean }[] }
}
export type ChatFile = { id: string; journal: string; total: number; done: number; doing: string; at: number; card?: { rows: NestedRow[]; cost: number; tokens: number }; /** Its folder and its project's root (the git repository's top, else the folder), so a reader can tell projects apart; and what it was asked. */ cwd?: string; root?: string; goal?: string }
/** This chat's id in the desktop app (local_…), and the home folder the files live under. */
export let hostId = ''
/** This chat's app id (local_…), when the desktop app runs it. */
export async function readHostId($: EngineInterface) {
  const id = String((await later$(() => $.env.get('CLAUDE_CODE_HOST_SESSION_ID')).catch(() => undefined)) ?? '')
  hostId = /^local_[\w-]+$/.test(id) ? id : ''
}
export let homeDir = ''
let selfSent = ''
let selfAt = 0
async function writeSelf($: EngineInterface, c: Crew) {
  const a = c.agents.find(x => x.id === 'main')
  if (!hostId || !homeDir || !journalSid || !a) return
  const tasks = tasksOf(a, c)
  const total = tasks.length || a.todosTotal
  const done = tasks.length ? tasks.filter(t => t.status === 'completed').length : a.todosDone
  const doing = doingOf(a, c) || tasks.find(t => t.status !== 'completed')?.subject || ''
  // Its cards as its own pane draws them (its main Claude and up to 12 helpers; times as marks the
  // reader counts up), what each one's Details show, and what the chat cost.
  const m = await later$(() => paneModel($, 160, 700, true)).catch(() => undefined)
  const rows: NestedRow[] = (m?.rowsP ?? [])
    .filter(r => !/^(chat-|cx-|demo-)/.test(r.id))
    .slice(0, 13)
    .map(r => {
      const x = c.agents.find(y => y.id === r.id)
      const asked = x ? [x.goal && !systemNote(x.goal) ? oneLine(promptOf(x.goal)) : '', x.job ?? ''].sort((p, q) => q.length - p.length)[0] ?? '' : ''
      return {
        ...{ id: r.id, name: r.name, hue: r.hue, state: r.state, kind: r.kind, status: r.status, object: trunc(r.object, 200), time: r.time, total: r.total, done: r.done, progress: trunc(r.progress, 200), model: r.model, depth: r.depth },
        ...(r.stuck ? { stuck: true } : {}),
        ...(r.helpers ? { helpers: true } : {}),
        ...(r.state === 'you' ? { ask: trunc(r.ask, 600) } : {}),
        ...(x
          ? {
              info: {
                cost: x.cost ?? 0,
                tokens: x.tokens ?? 0,
                ...(x.ctx ? { ctx: { tokens: x.ctx.tokens, window: x.ctx.window } } : {}),
                ...(x.compactions ? { compactions: x.compactions } : {}),
                asked: trunc(asked, 600),
                steps: stepsOf(x, c)
                  .slice(0, 12)
                  .map(t => ({ mark: stepMark(t.status), text: trunc(t.text, 160), on: t.status === 'in_progress' })),
              },
            }
          : {}),
      }
    })
  const card = { rows, cost: c.chatCost ?? c.spent?.cost ?? 0, tokens: c.spent?.tokens ?? 0 }
  const goal = a.goal && !systemNote(a.goal) ? trunc(oneLine(promptOf(a.goal)), 160) : ''
  const s = JSON.stringify({ id: hostId, journal: journalSid, cwd: sessionDir, root: projectRoot, ...(goal ? { goal } : {}), total, done, doing: trunc(oneLine(doing), 120), card })
  // Written when it changed, and once a minute so a reader can tell it is still there.
  if (s === selfSent && Date.now() - selfAt < 60_000) return
  selfSent = s
  selfAt = Date.now()
  await later$(() => $.fs.write(`${homeDir}/.claude/crew-map/chats/${hostId}.json`, `${s.slice(0, -1)},"at":${selfAt}}`)).catch(() => undefined)
}
/** What this chat knows of each nested chat: its file, and its journal's chunks (lines as this log shows them). */
type Nested = { file?: ChatFile; fileM: number; title?: string; name?: string; /** A same-project chat (not started from this one). */ sibling?: boolean; touched?: TouchedFile[]; touchedM?: number; chunkM: Map<number, number>; chunkLines: Map<number, LogLine[]>; lines: LogLine[] }
export const nested = new Map<string, Nested>()
/**
 * A nested chat still at work (its Claude working, waiting on its own helpers or chats, or needing you):
 * as its card says while the card is fresh, else as the app's list says.
 */
export const chatWorking = (ch: Chat) => {
  const f = nested.get(ch.id)?.file
  const head = f?.card?.rows?.[0]
  if (head && Date.now() - (Number(f?.at) || 0) < 3 * 60_000) return head.state === 'work' || head.state === 'wait' || head.state === 'you'
  return ch.running
}
/** All nested chats' lines in time order, made again only when one changed. */
let nestedVer = 0
/** Which project chats' lines the website's Who list asks for: '' none, '*' all of them, or one chat's app id. */
export let webProject = ''
let projVer = -1
let sortedProject: LogLine[] = []
/** The project chats' lines in time order (under their titles), made again only when one changed. */
export const projectLines = () => {
  if (projVer !== nestedVer) {
    sortedProject = [...nested.values()].filter(x => x.sibling && (!x.file || (!x.file.root && !x.file.cwd) || fileInProject(x.file))).flatMap(x => x.lines.map(l => ({ ...l, who: x.title ?? l.who }))).sort((x, y) => x.at - y.at)
    projVer = nestedVer
  }
  return sortedProject
}
let sortedVer = -1
let sortedNested: LogLine[] = []
export const nestedLines = () => {
  if (sortedVer !== nestedVer) {
    // Under the chat's name now (the app may rename it; the lines keep their keys, which use its id).
    sortedNested = [...nested.values()].filter(x => !x.sibling).flatMap(x => x.lines.map(l => ({ ...l, who: x.name ?? l.who }))).sort((x, y) => x.at - y.at)
    sortedVer = nestedVer
  }
  return sortedNested
}
/** Nested chats' touched files by path: each chat that touched it, the latest first. Made again only on a change. */
type NestedTouch = TouchedFile & { chat: string; name: string }
let touchVer = -1
let touchByPath = new Map<string, NestedTouch[]>()
export const nestedTouched = () => {
  if (touchVer !== nestedVer) {
    touchByPath = new Map()
    for (const [id, x] of [...nested].filter(([, v]) => !v.sibling))
      for (const f of x.touched ?? []) touchByPath.set(f.path, [...(touchByPath.get(f.path) ?? []), { ...f, chat: id, name: x.name ?? 'a chat' }])
    for (const list of touchByPath.values()) list.sort((a, b) => b.at - a.at)
    touchVer = nestedVer
  }
  return touchByPath
}
/** How many of those come before a time. */
const nestedBefore = (at: number) => {
  const all = nestedLines()
  let lo = 0
  let hi = all.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((all[mid]?.at ?? 0) < at) lo = mid + 1
    else hi = mid
  }
  return lo
}
/** The nested chats' newest lines the view carries (older ones come with Load older). */
export const NESTED_VIEW = 200
/** How many of the newest lines each view to the website carries. */
export const WEB_WINDOW = 150
const savedBefore = (at: number) => {
  let left = nestedBefore(at)
  let first = nestedLines()[0]?.at ?? Infinity
  for (const l of journal.values()) {
    if (l.at < at) left++
    if (l.at < first) first = l.at
  }
  return { left, first: Number.isFinite(first) ? clock(first).slice(0, 5) : '' }
}
let readingNested = false
export async function readNested($: EngineInterface) {
  const c = await readCrew?.()
  if (!c || !homeDir || readingNested) return
  readingNested = true
  try {
    const siblingIds = new Set((c.siblings ?? []).map(x => x.id))
    const chats = [...(c.chats ?? []), ...(c.siblings ?? []).filter(x => !(c.chats ?? []).some(y => y.id === x.id))]
    let changed = false
    for (const k of [...nested.keys()])
      if (!chats.some(x => x.id === k)) {
        nested.delete(k)
        changed = true
      }
    if (chats.length) {
      const dir = `${homeDir}/.claude/crew-map`
      const files = await listDir(`${dir}/chats`)
      for (const ch of chats) {
        const cur: Nested = nested.get(ch.id) ?? { fileM: 0, chunkM: new Map(), chunkLines: new Map(), lines: [] }
        const name = trunc(ch.name || ch.title, 24)
        if (cur.name !== name || cur.title !== ch.title) changed = true
        cur.title = ch.title
        cur.name = name
        cur.sibling = siblingIds.has(ch.id)
        nested.set(ch.id, cur)
        const fm = files.find(f => f.name === `${ch.id}.json`)?.mtimeMs ?? 0
        if (fm && fm !== cur.fileM) {
          const f = (await readJson(`${dir}/chats/${ch.id}.json`)) as ChatFile | undefined
          if (f && typeof f.journal === 'string' && /^[\w-]+$/.test(f.journal)) {
            cur.file = f
            cur.fileM = fm
            changed = true
          }
        }
        if (!cur.file) continue
        // Only the chunks that changed since the last read, of its newest 5,000 lines.
        const asHere = (l: LogLine): LogLine => ({ ...l, chat: ch.id, ...(l.who !== 'Claude' ? { by: l.who } : {}) })
        const jdir = `${dir}/journals/${cur.file.journal}`
        const entries = await listDir(jdir)
        // Its touched files, when they changed.
        const tm = entries.find(e => e.name === 'touched.json')?.mtimeMs ?? 0
        if (tm && tm !== cur.touchedM) {
          const t = await readJson(`${jdir}/touched.json`)
          if (Array.isArray(t)) {
            cur.touched = (t.filter(f => f && typeof f.path === 'string') as TouchedFile[]).slice(0, 200)
            cur.touchedM = tm
            changed = true
          }
        }
        const have = (await chunkList(jdir, entries)).slice(-Math.ceil(JOURNAL_KEEP / CHUNK))
        let mine = false
        for (const n of [...cur.chunkLines.keys()])
          if (!have.some(x => x.n === n)) {
            cur.chunkLines.delete(n)
            cur.chunkM.delete(n)
            mine = true
          }
        for (const { n, at } of have) {
          if (!at || cur.chunkM.get(n) === at) continue
          const lines = await readJson(`${dir}/journals/${cur.file.journal}/${chunkName(n)}`)
          if (!Array.isArray(lines)) continue
          cur.chunkLines.set(n, lines.filter(l => isLine(l) && !l.chat).map(asHere))
          cur.chunkM.set(n, at)
          mine = true
        }
        if (mine) {
          cur.lines = [...cur.chunkLines.entries()].sort((x, y) => x[0] - y[0]).flatMap(x => x[1])
          changed = true
        }
      }
    }
    // Each nested chat and each of its helpers: a colour of its own, the first time it is seen.
    // (A chat in this project only once it works: an idle one keeps the plain dot.)
    const keys = chats.filter(ch => !siblingIds.has(ch.id) || chatWorking(ch)).flatMap(ch => [`chat:${ch.id}`, ...(nested.get(ch.id)?.file?.card?.rows ?? []).filter(r => r && typeof r.id === 'string' && r.id !== 'main').map(r => `chat:${ch.id}~${r.id}`)])
    if (keys.some(k => !c.colors?.[k])) await write?.(d => keys.reduce(giveColor, d))
    if (changed) {
      nestedVer++
      $.ui.invalidate('ui.render')
    }
  } finally {
    readingNested = false
  }
}
const pad2 = (n: number) => String(n).padStart(2, '0')
const localDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
/** The log as Markdown: who did what and when, and what each Claude was thinking. */
const logMarkdown = (lines: LogLine[], c: Crew) => {
  const goal = lines.find(l => l.kind === 'you' && !l.chat)?.text ?? ''
  const what = (l: LogLine) => (l.kind === 'think' ? 'thought' : l.kind === 'you' ? 'asked' : l.kind === 'msg' ? 'said' : l.kind === 'info' ? 'note' : 'did')
  const first = lines[0]
  const last = lines[lines.length - 1]
  return [
    `# Claude Crew log${goal ? `: ${trunc(oneLine(promptOf(goal)), 80)}` : ''}`,
    '',
    `- Project: \`${sessionDir || 'unknown'}\``,
    `- Chat: ${journalSid || 'this chat'}`,
    first ? `- From ${localDay(first.at)} ${clock(first.at)} to ${localDay(last.at)} ${clock(last.at)}` : '- Nothing happened yet',
    ...(journalCut ? [`- Earlier lines are left out: the log keeps the newest ${JOURNAL_KEEP.toLocaleString("en-US")} lines`] : []),
    // (With its nested chats', as the header counts it.)
    `- Cost so far: ${fmtUsd((c.chatCost ?? c.spent?.cost ?? 0) + (c.chats ?? []).reduce((n, ch) => n + (Number(nested.get(ch.id)?.file?.card?.cost) || 0), 0))}`,
    '',
    '## Activity',
    '',
    ...lines.map(l => `- ${clock(l.at)} **${l.chat ? `${l.who}${l.by ? ` · ${l.by}` : ''}` : l.who}** ${what(l)}: ${oneLine(l.text)}${failMark(l)}${l.took !== undefined ? ` _(${took(l.took)})_` : ''}${l.full && oneLine(l.full) !== oneLine(l.text) ? `\n  > ${oneLine(l.full)}` : ''}`),
    '',
  ].join('\n')
}
/** Where the logs and their summaries go, in the project. */
const LOG_DIR = '.claude/crew-logs'
const SUMMARY_SYSTEM = 'You write notes that a future Claude, working in the same project, reads to understand an earlier chat. Be concrete: file names, commands, decisions and their reasons. No preamble.'
const SUMMARY_ASK = 'Below is the activity log of one chat in this project: who did what and when, and what they were thinking. Summarise it in Markdown under these headings: Goal; What was done (files and commands); How and why (the key decisions and the reasoning behind them); Problems hit and how they were solved; Left open. Keep it under 400 words.'
const UPDATE_ASK =
  'Below is the summary of one chat in this project so far, then the lines of its activity log since that summary. Return the whole summary brought up to date with what the new lines add, in the same Markdown under the same headings: Goal; What was done (files and commands); How and why (the key decisions and the reasoning behind them); Problems hit and how they were solved; Left open. Keep it under 400 words.'
let saving = false
let lastSave:{ at: number; file: string; summary: boolean } | undefined
const slugOf = (s: string) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chat'
/** Saves this chat's log into the project, and a summary of it by a cheaper model (Haiku) beside it. */
export async function saveLog($: EngineInterface, why: 'button' | 'task') {
  if (saving) return
  if (!sessionDir) {
    if (why === 'button') void $.ui.toast("Couldn't save the log: this chat has no project folder.")
    return
  }
  saving = true
  void publishWeb($)
  try {
    await syncJournal($)
    const c = await readCrew?.()
    const lines = everyLine()
    if (!c || !lines.length) {
      if (why === 'button') void $.ui.toast('Nothing to save yet: the log is empty.')
      return
    }
    // One file per chat: the same name each time it is saved.
    const names = ((await $.store.get('logFiles').catch(() => undefined)) ?? {}) as Record<string, string>
    const key = journalSid || 'chat'
    const base = names[key] ?? `${localDay(lines[0].at)}-${slugOf(promptOf(lines.find(l => l.kind === 'you' && !l.chat)?.text ?? 'chat'))}-${key.slice(0, 8)}`
    if (!names[key]) await storeEntry($, 'logFiles', key, base, 200)
    const md = logMarkdown(lines, c)
    const dir = `${sessionDir}/${LOG_DIR}`
    await $.fs.write(`${dir}/${base}.md`, md)
    // The summary: written once from the whole log, then brought up to date with only the lines since
    // (and not asked for at all when nothing is new).
    const marks = ((await $.store.get('summarised').catch(() => undefined)) ?? {}) as Record<string, number>
    const upTo = marks[key] ?? 0
    const before = upTo ? String((await later$(() => $.fs.read(`${dir}/${base}.summary.md`)).catch(() => '')) ?? '').trim() : ''
    const fresh = before ? lines.filter(l => l.at > upTo) : lines
    const cap = (s: string) => (s.length > 150_000 ? `(earlier lines left out)\n${s.slice(-150_000)}` : s)
    const ask = before ? `${UPDATE_ASK}\n\n## The summary so far\n\n${before}\n\n## The log since\n\n${cap(logMarkdown(fresh, c))}` : `${SUMMARY_ASK}\n\n${cap(md)}`
    const r =
      before && !fresh.length
        ? { isAnswered: true, text: before }
        : ((await later$(() => $.model.complete({ model: 'haiku', system: SUMMARY_SYSTEM, prompt: ask, maxTokens: 1500, timeoutMs: 120_000 })).catch(() => undefined)) as { isAnswered?: boolean; text?: string } | undefined)
    const summary = r?.isAnswered && r.text ? r.text.trim() : ''
    if (summary && summary !== before) await $.fs.write(`${dir}/${base}.summary.md`, `${summary}\n`)
    if (summary) await storeEntry($, 'summarised', key, lines[lines.length - 1]?.at ?? 0, 200)
    lastSave = { at: Date.now(), file: `${LOG_DIR}/${base}.md`, summary: !!summary }
    if (why === 'button') void $.ui.toast(`Log saved to ${LOG_DIR}/${base}.md${summary ? ', with a summary beside it' : " (the summary couldn't be written)"}`)
  } catch (err) {
    note(`save log: ${String(err).slice(0, 160)}`)
    if (why === 'button') void $.ui.toast(`Couldn't save the log: ${String(err).slice(0, 120)}`)
  } finally {
    saving = false
    void publishWeb($)
  }
}
/** The whole log as Markdown, to the page, which copies it or saves it as a file. */
export async function exportLog($: EngineInterface, how: 'copy' | 'download') {
  await syncJournal($)
  const c = await readCrew?.()
  if (!c) return
  const text = logMarkdown(everyLine(), c)
  // Copy: Claude's own clipboard first (the browser pane may not let a page write to it); the page shows the text if that fails.
  if (how === 'copy') {
    const r = (await later$(() => $.ui.copy({ text, surface: 'desktop' as never })).catch(() => undefined)) as { isCopied?: boolean } | undefined
    if (r?.isCopied) return $.ui.toast('Claude Crew: the whole log is copied as Markdown')
  }
  await webPost?.('export', JSON.stringify({ how, name: `claude-crew-log-${localDay(Date.now())}.md`, text }))
}
/** A log line opened on the page: all of it (a thought whole, an action and what came of it), from the log or the journal. */
const openLine = async (key: string) => {
  const c = await readCrew?.()
  const l = c?.log.find(x => logKey(x) === key) ?? journal.get(key) ?? nestedLines().find(x => logKey(x) === key)
  // An action's line already says what it was: below it, what came of it (an edit with its Open diff).
  const act = l?.path ? actId({ k: 'file', path: l.path, name: baseName(l.path), edits: true }) : ''
  await webPost?.('reply', JSON.stringify({ open: { key, text: l ? (l.kind !== 'think' && l.more) || fullOf(l) : '', act } }))
}
/** Load older on the page: the journal's lines before its oldest, a page at a time. */
const OLDER_PAGE = 200
async function olderLines($: EngineInterface, before: number) {
  await syncJournal($)
  // This chat's journal and its nested chats', in time order.
  const all = everyLine().filter(l => l.at < before)
  await webPost?.('reply', JSON.stringify({ older: { before, lines: all.slice(-OLDER_PAGE).map(webLine), end: all.length <= OLDER_PAGE } }))
}
/** Tells new chats in the project that earlier chats left logs and summaries, so Claude reads them when useful. */
export let logsNote = ''
export async function findLogs($: EngineInterface) {
  logsNote = ''
  if (!sessionDir) return
  const found = ((await later$(() => $.fs.list(`${sessionDir}/${LOG_DIR}`)).catch(() => [])) ?? []) as { name: string; mtimeMs?: number }[]
  const sums = found.filter(f => f.name.endsWith('.summary.md')).sort((x, y) => (y.mtimeMs ?? 0) - (x.mtimeMs ?? 0))
  if (sums.length)
    logsNote = `Earlier chats in this project saved Claude Crew logs in ${LOG_DIR}/ (${sums.length} summar${sums.length === 1 ? 'y' : 'ies'}; newest: ${sums
      .slice(0, 3)
      .map(f => f.name)
      .join(', ')}). When you need to know what was done before in this project, how, or why, read the relevant *.summary.md, and its .md log for the detail.`
}

/** Starts this chat's website (a small Node server beside the mod) and answers what is pressed on it. */
/**
 * The website runs only once it is wanted: on the first /crew, or at session start for a chat that had
 * one before Claude restarted (so its browser pane finds it again). A chat nobody opens keeps no server.
 */
export let webState: 'off' | 'checking' | 'starting' | 'on' = 'off'
/** It could not start at all (no Node): the pane then draws the whole view itself. */
export let webFailed = false
let restarts: number[] = []
export function startWeb($: EngineInterface, onlyIfKept = false) {
  if (webState !== 'off') return
  // At session start it only looks for a saved address first; "Starting…" shows once it starts.
  webState = onlyIfKept ? 'checking' : 'starting'
  void later$(() => $.ui.invalidate('ui.render')).catch(() => undefined)
  void (async () => {
    try {
      // The address this chat's website had last time (kept per chat in the store), so after Claude
      // reopens, the chat's browser pane finds its website where it was.
      const sid = await Promise.resolve()
        .then(() => $.session.id())
        .catch(() => '')
      const kept = ((await $.store.get('webAddress').catch(() => undefined)) ?? {}) as Record<string, { port: number; token: string; key?: string; at: number }>
      const was = sid ? kept[sid] : undefined
      if (onlyIfKept && !was) {
        webState = 'off'
        return
      }
      webState = 'starting'
      void later$(() => $.ui.invalidate('ui.render')).catch(() => undefined)
      const server = $.process.spawn({ argv: ['node', `${$.plugin.root}/web/server.mjs`, ...(was ? [String(was.port), was.token, ...(was.key ? [was.key] : [])] : [])] })
      let buf = ''
      for await (const piece of server as AsyncIterable<{ text: string }>) {
        buf += piece.text
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line.startsWith('READY ')) {
            const [port, token, key = ''] = line.slice(6).split(' ')
            const base = `http://127.0.0.1:${port}/${token}`
            webUrl = `${base}/`
            webState = 'on'
            webFailed = false
            if (sid) {
              void storeEntry($, 'webAddress', sid, { port: Number(port), token, key, at: Date.now() }, 40)
            }
            webPost = (path, body = '') => $.http.fetch(`${base}/${path}`, { method: 'POST', body, headers: { 'x-crew-key': key } }).catch(() => undefined)
            $.ui.invalidate('ui.render')
          } else if (line.startsWith('WATCH ')) {
            webWatchers = Number(line.slice(6)) || 0
            webSent = ''
            void publishWeb($)
          } else if (line.startsWith('ACT ')) {
            let msg: { id?: unknown; search?: unknown; open?: unknown; older?: unknown; project?: unknown; set?: { budget?: unknown; editor?: unknown } } = {}
            try {
              msg = JSON.parse(line.slice(4))
            } catch {}
            // A press that fails is noted, and the website keeps running.
            try {
              const act = typeof msg.id === 'string' ? actOf(msg.id) : undefined
              if (act) await doAction($, act, undefined)
              else if (typeof msg.search === 'string') await searchFor($, msg.search)
              // The Who list picked the whole project or one chat in it (or let it go): its lines come with the view.
              else if (typeof msg.project === 'string') webProject = msg.project === '*' || /^local_[\w-]+$/.test(msg.project) ? msg.project : ''
              // The page's own asks (a line opened, older lines): answered with a reply, the view is unchanged.
              else if (typeof msg.open === 'string') {
                await openLine(msg.open)
                continue
              } else if (typeof msg.older === 'number') {
                await olderLines($, msg.older)
                continue
              } else if (msg.set && typeof msg.set === 'object') {
                // Settings' budget box and editor list: only values the pane's own choices could set.
                const { budget, editor } = msg.set
                if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 0 && budget <= 100_000) await doAction($, { k: 'set', budget: Math.round(budget * 100) / 100 }, undefined)
                if (editor === 'code' || editor === 'cursor' || editor === 'system') await doAction($, { k: 'set', editor }, undefined)
              }
            } catch (err) {
              note(`press: ${String(err).slice(0, 160)}`)
            }
            void publishWeb($)
          }
        }
      }
    } catch (err) {
      note(`web server: ${String(err).slice(0, 160)}`)
    }
    const was = webUrl
    const watched = webWatchers > 0
    webUrl = ''
    webState = 'off'
    if (!was) webFailed = true
    webPost = undefined
    webWatchers = 0
    void later$(() => $.ui.invalidate('ui.render')).catch(() => undefined)
    if (!was) void Promise.resolve().then(() => $.ui.open({ id: PANE, title: 'Claude Crew' })).catch(() => undefined)
    // It stopped while a page had it open (after the PC slept, say): back at the same address, so the
    // page finds it again. A few times at most in ten minutes.
    restarts = restarts.filter(t => Date.now() - t < 600_000)
    if (was && watched && restarts.length < 3) {
      restarts.push(Date.now())
      $.clock.after(1000, () => startWeb($))
    }
  })()
}
