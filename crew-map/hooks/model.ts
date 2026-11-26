import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Agent, Chat, CodexRun, Crew, LogLine } from '../types'
import { EMPTY } from './empty'
import { COMPACT, CX, LOG_STEP, PALETTE, SHELL_GIVE_UP_MS, SHELL_MARK, SIBLINGS_MAX, VERSION, WINDOW_LINGER_MS, activityOf, agentModel, baseName, chatHue, clock, cmdGist, colorOf, cutTo, defaultApp, dirOf, doingOf, editor, elapsed, fileInProject, fmtK, fmtUsd, fullOf, isSpecial, kidsOf, knownColors, log, logKey, mainModel, messageOf, note, oneLine, openInEditor, platformOf, promptOf, readCrew, relPath, routeOf, runningShells, seeChoices, sessionDir, shortOf, stepMark, stepStart, stepsOf, summaryMarkdown, systemNote, tasksOf, testPurpose, textW, took, trunc, verbOf, withKids, wrapRows, write } from './track'
import type { FitNode, Opened } from './track'
import { isDemoAgent, isDemoPath, startDemo } from './demo'
import { NESTED_VIEW, WEB_WINDOW, chatWorking, exportLog, nested, nestedLines, nestedTouched, projectLines, saveLog, webLine, webProject } from './web'
import type { NestedRow } from './web'

// What the pane shows, worked out once for both surfaces: each Claude's row, the last task, Touched,
// the tabs and their lines, the light and dark colours, and what a press does.

// The values the view reads (declared in each file that uses them; the same key is the same value).
const crew = atom({ plugin: 'crew-map', key: 'crew' } as const, EMPTY)
const tick = atom({ plugin: 'crew-map', key: 'tick' } as const, 0)
/** What the search box holds. */
const search = atom({ plugin: 'crew-map', key: 'search' } as const, { q: '' })

// ─── Light and dark ─────────────────────────────────────────────────────────
// The pane is drawn with dark-tuned colours, then painted for the theme in one pass at the end:
//  - auto (the default): each colour of a Text or a border becomes the engine's theme colour of the
//    same meaning or hue ('claude', 'warning', 'autoAccept'…), which Claude Code itself tunes for a
//    light or a dark theme; a colour with no such key is moved to a middle shade that reads on both.
//  - light / dark: chosen in Settings when auto guesses wrong; light swaps every colour for its
//    light-theme twin, dark draws as tuned.
type ThemeMode = 'auto' | 'light' | 'dark'
export const THEMES: ThemeMode[] = ['auto', 'light', 'dark']
export const THEME_LABEL: Record<ThemeMode, string> = { auto: '◐ auto', light: '☀ light', dark: '☾ dark' }
const hex6 = (h: string) => {
  const x = h.replace('#', '').toUpperCase()
  return x.length === 3 ? `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}` : `#${x.slice(0, 6)}`
}
/** A theme colour of the same meaning, for a colour the text pane draws (auto). */
const THEME_KEY: Record<string, string> = {
  '#E6EDF3': 'text', '#8B949E': 'inactive', '#30363D': 'subtle', '#D97757': 'claude', '#6CB6FF': 'suggestion',
  '#3FB950': 'success', '#56D4DD': 'planMode', '#F778BA': 'bashBorder', '#E3B341': 'warning', '#F85149': 'error',
}
/** Each colour the text pane draws, as the website's light theme has it. */
const LIGHT_OF: Record<string, string> = {
  '#E6EDF3': '#1F2328', '#8B949E': '#59636E', '#30363D': '#D0D7DE', '#D97757': '#BC5A34', '#3FB950': '#1A7F37', '#E3B341': '#9A6700', '#F85149': '#CF222E', '#8C8CFF': '#4D4DD8',
  // The identity colours.
  '#6CB6FF': '#0969DA', '#F778BA': '#BF3989', '#56D4DD': '#0A7B83', '#C297FF': '#8250DF', '#C9A47E': '#8A6234', '#B6DCFF': '#0A3F8A', '#A8EEF2': '#05555B', '#E2CCFF': '#55279E', '#FFB8DA': '#7D1D56', '#E8D2B4': '#5A3E1C', '#F2B49B': '#7C3115',
}
const rgbOf = (h: string) => { const x = hex6(h); return [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16) / 255) as [number, number, number] }
const hexOf = (c: number[]) => `#${c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const lum = (c: number[]) => { const [r, g, b] = c.map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const toHsl = ([r, g, b]: number[]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
const fromHsl = ([h, s, l]: number[]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}
/** The shade of a colour whose light-relative luminance falls in [lo, hi], its hue kept. */
const shadeTo = (h: string, lo: number, hi: number) => {
  const [hu, s, l0] = toHsl(rgbOf(h))
  const at = (l: number) => lum(fromHsl([hu, s, l]))
  if (at(l0) >= lo && at(l0) <= hi) return hex6(h)
  let a = 0, b = 1
  const want = at(l0) > hi ? hi : lo
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (at(m) < want) a = m; else b = m }
  return hexOf(fromHsl([hu, s, (a + b) / 2]))
}
/** A colour's twin on a light background: dark grounds turn light, bright marks turn deep. */
const lightOf = (h: string) => {
  const k = hex6(h)
  if (LIGHT_OF[k]) return LIGHT_OF[k]
  const c = rgbOf(k), L = lum(c), [hu, s] = toHsl(c)
  if (L < 0.03) return hexOf(fromHsl([hu, s * 0.5, 0.97]))
  if (L < 0.08) return hexOf(fromHsl([hu, s * 0.6, 0.9]))
  return shadeTo(k, 0.05, 0.16)
}
/** For a Text or a border in auto: the theme's colour of that meaning, else a shade that reads on both. */
const autoOf = (h: string) => {
  const k = hex6(h)
  if (THEME_KEY[k]) return THEME_KEY[k]
  const c = rgbOf(k), [, s] = toHsl(c), L = lum(c)
  if (s < 0.15) return L > 0.5 ? 'text' : L > 0.12 ? 'inactive' : 'subtle'
  return shadeTo(k, 0.15, 0.3)
}
/** The pane painted for the theme: Text and border colours. */
export const paintPane = <T,>(tree: T, mode: ThemeMode): T => (mode === 'dark' ? tree : (paintNode(tree as unknown as FitNode, mode) as unknown as T))
const paintNode = (x: FitNode, mode: ThemeMode): FitNode => {
  if (!x || typeof x !== 'object') return x
  const p = x.props ?? {}
  let np: Record<string, unknown> = p
  for (const k of ['color', 'borderColor', 'backgroundColor']) {
    const v = p[k]
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v)) continue
    const to = mode === 'auto' ? autoOf(v) : lightOf(v)
    if (to === v) continue
    if (np === p) np = { ...p }
    np[k] = to
  }
  const y = np === p ? x : { ...x, props: np }
  return withKids(y, kidsOf(y).map(k => paintNode(k, mode)))
}

// ─── At a glance: one row per Claude ────────────────────────────────────────
// What each Claude is doing, in plain words, for anyone glancing over: its kind of action (one icon each,
// from one classifier of the tool it calls), how far along it is, its model.

/** The kinds of thing a Claude does: every tool call, hook and pause is one of these. 16-unit stroke icons. */
export const KIND_ICON: Record<string, string> = {
  read: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  edit: 'M10.5 2.5l3 3L6 13H3v-3l7.5-7.5zM9 4l3 3',
  shell: 'M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5H11',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2',
  web: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
  agent: 'M5 2.5v11M5 9c0-3 6-2 6-6.5M11 2.5v.01',
  skill: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z',
  plan: 'M3 4h10M3 8h10M3 12h6',
  tool: 'M10 2.5a3.5 3.5 0 0 0-3.2 4.9L2.5 11.7l1.8 1.8 4.3-4.3A3.5 3.5 0 0 0 13.5 6l-2 2-2-2 2-2a3.5 3.5 0 0 0-1.5-1.5z',
  hook: 'M11 2v6.5a3.5 3.5 0 1 1-7 0V7M4 7l-1.6 1.6M4 7l1.6 1.6',
  hookBlock: 'M11 2v6.5a3.5 3.5 0 1 1-7 0V7M4 7l-1.6 1.6M4 7l1.6 1.6',
  think: 'M4 8h.01M8 8h.01M12 8h.01',
  wait: 'M4.5 2h7M4.5 14h7M5.5 2c0 3.5 5 3.5 5 6s-5 2.5-5 6M10.5 2c0 3.5-5 3.5-5 6s5 2.5 5 6',
  you: 'M8 2.2l6.3 11.3H1.7zM8 6.5v3M8 11.6v.2',
  done: 'M3 8.5l3 3 7-7',
  idle: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.2l2 1.3',
  folder: 'M1.5 4h5l1.5 1.5h6.5v7.5h-13z',
  msg: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  mcp: 'M6 1.5v3M10 1.5v3M4.5 4.5h7v3a3.5 3.5 0 0 1-7 0zM8 11v3.5',
  thought: 'M3 7.2C3 4.6 5.2 2.8 8 2.8s5 1.8 5 4.4-2.2 4.4-5 4.4c-.6 0-1.2-.1-1.7-.2L3.5 13l.6-2.6C3.4 9.6 3 8.5 3 7.2z',
}
/** Each kind as plain words: what a Claude doing it is doing. */
const KIND_WORDS: Record<string, string> = {
  read: 'Reading', edit: 'Writing code', shell: 'Running a command', search: 'Searching the code', web: 'Reading online',
  agent: 'Starting a helper', skill: 'Using a skill', plan: 'Planning', tool: 'Working', think: 'Thinking',
  hook: 'Your hook ran', hookBlock: 'Your hook blocked it', mcp: 'Using a connector',
}
/** The text glyph for a kind, in the text pane. */
export const KIND_GLYPH: Record<string, string> = { read: '◇', edit: '✎', shell: '▸', search: '⌕', web: '◎', agent: '⇢', skill: '✦', plan: '☐', mcp: '⧉', tool: '•', hook: '⚓', hookBlock: '⚓', think: '›', wait: '⏳', you: '!', done: '✓', idle: '○' }
/** What kind of thing a tool call is. */
const KINDS: [RegExp, string][] = [
  [/^(Read|NotebookRead|LS)$/, 'read'],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'edit'],
  [/^(Bash|PowerShell|BashOutput|KillShell|KillBash|Monitor)$/, 'shell'],
  [/^(Grep|Glob|ToolSearch)$/, 'search'],
  [/^(WebFetch|WebSearch)$|browser|chrome/i, 'web'],
  [/^(Agent|Task)$|^mcp__codex-bridge__codex$/, 'agent'],
  [/^(Skill|SlashCommand)$/, 'skill'],
  [/^(TodoWrite|Task(Create|Update|List|Get)|EnterPlanMode|ExitPlanMode)$/, 'plan'],
]
const kindOf = (tool: string) => KINDS.find(([re]) => re.test(tool))?.[1] ?? 'tool'
/**
 * What a Claude at work is doing, in plain words: its kind's words, made specific where the work says
 * more (Writing docs, Viewing an image, Building, Researching, Browsing, Using Blender, Using the PC).
 */
const workWords = (a: Agent, kind: string) => {
  const w = activityOf(a)
  if (kind === 'edit') return w === 'Writing docs' ? w : KIND_WORDS.edit
  if (kind === 'read') return w === 'Reading' ? KIND_WORDS.read : w
  if (kind === 'shell') return ['Building', 'Committing', 'Debugging'].includes(w) ? w : KIND_WORDS.shell
  if (kind === 'web') return a.tool === 'WebSearch' ? 'Researching' : w === 'Browsing' ? w : KIND_WORDS.web
  if (kind === 'tool') return w === 'Working' ? KIND_WORDS.tool : w
  return KIND_WORDS[kind] ?? KIND_WORDS.tool
}
/** A model's id as people say it: claude-opus-5-5 → Opus 5.5. */
const shortModel = (m: string) => {
  const x = m.replace(/^.*?claude-/, '').match(/^([a-z]+)-(\d+)(?:-(\d{1,2}))?/i)
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ''}` : trunc(m, 14)
}
/** A short clock for a row: 48s, 14m, 1h05. */
const shortTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}`
}
/** How long ago, in one whole unit: 3m, 2h, 4d. */
const agoText = (ms: number) => {
  const m = Math.max(1, Math.floor(ms / 60_000))
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}
/** How full a context window is, 0-100; -1 when unknown. */
const ctxPct = (x?: { tokens: number; window: number }) => (x && x.window > 0 && Number.isFinite(x.tokens) ? Math.min(100, Math.max(0, Math.round((x.tokens / x.window) * 100))) : -1)

/** One Claude's row as the pane draws it. */
export type GlanceRow = {
  id: string
  name: string
  hue: string
  state: 'work' | 'wait' | 'you' | 'done' | 'idle'
  kind: string
  status: string
  object: string
  time: string
  total: number
  done: number
  progress: string
  /** It looks stuck: its second line says why, in amber. */
  stuck?: boolean
  /** A nested chat not read live: the time (13:09) it was last seen; its state is drawn dim. */
  asOf?: string
  model: string
  depth: number
  /** How full its context is (0-100), -1 when unknown (Codex, a chat not read live); none for a done one. */
  ctx?: number
  /** Waiting on its helpers or the chats it started: its own state colour (indigo), not the grey of other waits. */
  helpers?: boolean
  /** (A chat in this project) when it was last active, as a mark; and whether it has no identity colour yet (idle so far). */
  ago?: string
  plain?: boolean
  request: string[]
  /** Needing you: the whole request, in one line (the pane wraps it). */
  ask?: string
  where: string
}
/** A row's state colour: green working, indigo waiting on its helpers or chats, amber needing you, else grey (a chat not read live: grey). */
export const stateRole = (r: Pick<GlanceRow, 'state' | 'asOf' | 'helpers'>) => (r.asOf ? 'dim' : r.state === 'work' ? 'green' : r.state === 'you' ? 'amber' : r.state === 'wait' && r.helpers ? 'wait' : 'dim')
/**
 * What a Claude is waiting on, when it is waiting at all:
 * - you: a permission, an answer or a plan it needs (urgent), or, for the main Claude whose turn is over
 *   with nothing else running, your next message;
 * - helpers: the helpers it started, while it sits in the call that runs them, or (main, turn over)
 *   while helpers it started in the background still work;
 * - command: a command it runs and waits for, or (main, turn over) a background command still running.
 */
type Wait = { kind: 'you' | 'helpers' | 'command'; urgent: boolean; label: string; what: string; short: string }
const waitOf = (a: Agent, c: Crew, now: number): Wait | undefined => {
  if (a.needs) return { kind: 'you', urgent: true, label: 'waiting on you', what: a.needs.what.replace(/^allow (running )?/, ''), short: 'you' }
  const kids = c.agents.filter(h => h.id !== a.id && (h.parent ?? 'main') === a.id && (h.state === 'busy' || h.state === 'thinking'))
  const names = (list: { name: string }[]) => (list.length > 2 ? `${list.slice(0, 2).map(h => h.name).join(', ')} +${list.length - 2}` : list.map(h => h.name).join(', '))
  const helpers = (list: { name: string }[]): Wait => ({ kind: 'helpers', urgent: false, label: `waiting on ${list.length === 1 ? 'a helper' : `${list.length} helpers`}`, what: names(list), short: names(list) })
  const shells = runningShells(c, now).filter(x => x.agentId === a.id)
  const command = (label: string): Wait => ({ kind: 'command', urgent: false, label: 'waiting on a command', what: label, short: trunc(label, 28) })
  if (a.state === 'busy') {
    // In the call that runs helpers: the ones that call started, else every helper of its own at work.
    if (a.tool === 'Agent' || a.tool === 'Task') {
      const mine = kids.filter(h => !!h.spawnId && a.pending.includes(h.spawnId))
      return mine.length || kids.length ? helpers(mine.length ? mine : kids) : { kind: 'helpers', urgent: false, label: 'waiting on a helper', what: a.detail ? trunc(oneLine(a.detail), 60) : 'starting it', short: 'a helper' }
    }
    if (a.tool === 'Bash' || a.tool === 'PowerShell') return command((a.actions[0]?.startsWith(SHELL_MARK) ? a.actions[0].slice(SHELL_MARK.length) : cmdGist(a.detail)).replace(/^ran /, ''))
    // Reading a background task's output (it may block until the task ends): the command or the helpers it waits on.
    if (/^(BashOutput|TaskOutput|AgentOutput|Monitor)$/.test(a.tool)) return shells.length ? command(shells[0].label) : kids.length ? helpers(kids) : command('a background task')
    return undefined
  }
  // The main Claude's turn is over: still waiting on what it left running, else on you.
  if (a.id === 'main' && (a.state === 'idle' || a.state === 'done')) {
    // Its helpers still at work, and the chats it started that still work: "Waiting for crew-coder, Scout".
    const chatsOn = (c.chats ?? []).filter(ch => ch.depth === 1 && chatWorking(ch)).map(ch => ({ name: trunc(ch.name || ch.title, 24) }))
    if (kids.length || chatsOn.length) return helpers([...kids, ...chatsOn])
    if (shells.length) return command(shells.length > 1 ? `${shells[0].label} +${shells.length - 1}` : shells[0].label)
    return { kind: 'you', urgent: false, label: 'your turn', what: 'waiting for your next message', short: 'your turn' }
  }
  return undefined
}

/** What the search box holds now. */
export function searchFor($: EngineInterface, typed: string) {
  return update($, search, () => ({ q: typed.slice(0, 80) }))
}

/** The unit the pane's line model measures widths and indents in: one text column (the page and the text pane count columns). */
export const CELL_W = 7.9

/** Opens a folder in the system's file manager. */
async function openFolder($: EngineInterface, path: string): Promise<Opened> {
  const argv = defaultApp(await platformOf($), path)
  const r = await $.process.run(argv, { timeoutMs: 20_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
  // Explorer exits 1 even when it opened the folder: only a failure to start counts.
  return r.exitCode === -1 ? { ok: false, why: r.stderr } : { ok: true, why: '' }
}

/** Opens a file or folder from a click, and says so: "Opening …", or why it could not. */
async function openAndSay($: EngineInterface, what: 'file' | 'dir', path: string, name: string, hasEdits = false, line = 0) {
  if (isDemoPath(path)) return void $.ui.toast(`${name} is a pretend file from the demo.`)
  const route = what === 'file' ? routeOf(path, await platformOf($)) : 'dir'
  const where = { dir: ' in the file manager', app: ' in its app', editor: '', reveal: ' in its folder (a program or script: shown, not run)' }[route]
  void $.ui.toast(`${route === 'reveal' ? 'Showing' : 'Opening'} ${name}${where}…`)
  const r = what === 'dir' ? await openFolder($, path) : await openInEditor($, path, hasEdits, line)
  if (!r.ok) void $.ui.toast(`Couldn't open ${name}: ${r.why || 'the program did not start'}${route === 'editor' ? ` (is \`${editor}\` on your PATH? "open files in" can pick another app)` : ''}`)
}

/** The folder group of files outside the session's project. */
const OUTSIDE = '~outside'
/** A file's folder relative to the session's ('.' for its top), or OUTSIDE. */
const groupOf = (id: string) => {
  if (isDemoPath(id)) return dirOf(id.slice(5)) || '.'
  if (sessionDir && id.toLowerCase().startsWith(`${sessionDir.toLowerCase()}/`)) {
    const d = dirOf(id)
    return d.length > sessionDir.length ? d.slice(sessionDir.length + 1) : '.'
  }
  return OUTSIDE
}
/** The colour role of a Claude's hue (its palette colour), or Codex's. */
export const hueRole = (hex: string) => {
  const i = PALETTE.indexOf(hex)
  return i >= 0 ? `h${i}` : 'cx'
}
/** What a click on the pane does, as data: open a file or folder, move the viewer, set a setting, and the rest. */
export type Act =
  | { k: 'none' }
  | { k: 'file'; path: string; name: string; edits: boolean; line?: number }
  | { k: 'dir'; path: string; name: string }
  | { k: 'pane'; tab?: NonNullable<Crew['pane']>['tab']; focus?: string; top?: number }
  | { k: 'log'; anchor?: number | null; toggle?: string; hold?: number | null }
  | { k: 'set'; theme?: ThemeMode; budget?: number; editor?: string; hideOutside?: boolean; autoSave?: boolean; testToasts?: boolean }
  | { k: 'logout'; how: 'copy' | 'download' | 'save' }
  | { k: 'demo' }
  | { k: 'copy' }
const NONE: Act = { k: 'none' }

/** A run of text on a line of the viewer: words, a fixed column, the rest cut to fit, a button. */
export type Seg = {
  /** (Website) words after `t` shown only on a wide page. */
  tail?: string
  t?: string
  size?: number
  role?: string
  b?: boolean
  i?: boolean
  u?: boolean
  /** A fixed column this wide (the text cut to it). */
  w?: number
  /** Takes the room the others leave, cut with … to it. */
  flex?: boolean
  /** A coloured dot, an icon, or a bar this full (0-1), before or instead of the text. */
  dot?: string
  icon?: [string, string]
  bar?: number
  /** Space after it (8 by default). */
  gap?: number
  run?: Act
  /** A Button's words in their colours: [text, role]. */
  parts?: [string, string][]
  label?: string
  /** (Website) the whole of what the words cut short, on hover. */
  tip?: string
}
/** (Details) A Claude under the one shown, drawn on the website as one button: its colour (a bubble for a nested chat), name, state, what it is on, steps, time. */
type DRow = { hue: string; chat?: boolean; name: string; state: GlanceRow['state']; helpers?: boolean; status: string; object: string; done: number; total: number; time: string; depth: number; run: Act }
export type VLine = { segs: Seg[]; right?: Seg[]; indent?: number; row?: DRow; /** A section's title (the website puts space above it). */ head?: boolean }
/** One Claude's row as the pane draws it: the glance row, its whole request unwrapped, and whether its Details show. */
export type PaneRow = GlanceRow & { ask: string; focused: boolean }

/** The last task's card in the crew's place while nobody works: how long, what changed, tests, cost, who. */
type Recap = { title: string; goal: string; ago: string; facts: [string, string, string][]; copy?: Act; demo?: Act }

/** A file on a Touched line: its name, errors, lines added and removed, and the dot of the Claude on it now. */
type TouchFile = { name: string; errs: number; add: number; del: number; on: string; read?: boolean; run: Act; /** A nested chat touched it: its colour, filled while it edits the file now. */ chat?: { hue: string; fill: boolean }; title?: string }
type TouchFolder = { name: string; files: TouchFile[] }
/** The viewer's tab row: the tabs (the one shown bold and underlined), then ▲ ▼ and back to the latest. */
type Tab = { id: string; t: string; label: string; on: boolean; run: Act }
/** Does what a click on the pane asked for. */
export async function doAction($: EngineInterface, a: Act, surface: unknown) {
  if (a.k === 'file') return openAndSay($, 'file', a.path, a.name, a.edits, a.line ?? 0)
  if (a.k === 'dir') return openAndSay($, 'dir', a.path, a.name)
  if (a.k === 'pane') {
    const { k: _, ...patch } = a
    return write?.(d => {
      const p = { ...(d.pane ?? {}), ...patch }
      return { ...d, pane: { ...p, focus: p.focus || undefined } }
    })
  }
  if (a.k === 'log')
    return write?.(d => {
      const v = d.logView ?? {}
      if (a.toggle === undefined) return { ...d, logView: { ...v, anchor: a.anchor ?? undefined } }
      // Opening a line holds the log where it is, so new lines don't push it away while it's read.
      const open = (v.open ?? []).filter(x => x !== a.toggle)
      const opening = open.length === (v.open ?? []).length
      return { ...d, logView: { anchor: v.anchor ?? (opening ? a.hold ?? undefined : undefined), open: opening ? [...open, a.toggle].slice(-30) : open } }
    })
  if (a.k === 'set') {
    if (a.theme) void $.store.set('theme', a.theme).catch(() => undefined)
    if (a.editor) void $.store.set('editor', a.editor).catch(() => undefined)
    if (a.autoSave !== undefined) void $.store.set('autoSave', a.autoSave).catch(() => undefined)
    if (a.testToasts !== undefined) void $.store.set('testToasts', a.testToasts).catch(() => undefined)
    if (a.budget !== undefined) {
      void $.store.set('budget', a.budget).catch(() => undefined)
      void $.ui.toast(a.budget ? `Budget set to ${fmtUsd(a.budget)}: you'll get a heads-up at 50%, 80% and 100%` : 'Budget cleared')
    }
    return write?.(d => ({
      ...d,
      ...(a.theme ? { theme: a.theme } : {}),
      ...(a.editor ? { editor: a.editor } : {}),
      ...(a.budget !== undefined ? { budget: a.budget, budgetWarned: 0 } : {}),
      ...(a.hideOutside !== undefined ? { hideOutside: a.hideOutside } : {}),
      ...(a.autoSave !== undefined ? { autoSave: a.autoSave } : {}),
      ...(a.testToasts !== undefined ? { testToasts: a.testToasts } : {}),
    }))
  }
  if (a.k === 'logout') return a.how === 'save' ? saveLog($, 'button') : exportLog($, a.how)
  if (a.k === 'demo') return startDemo()
  if (a.k === 'copy') {
    const sm = (await readCrew?.())?.summary
    if (!sm) return
    const r = await $.ui.copy({ text: summaryMarkdown(sm), surface: surface as never }).catch(() => ({ isCopied: false }))
    return $.ui.toast(r.isCopied ? 'Summary copied as Markdown' : "Couldn't reach the clipboard here")
  }
}

/** A log line's kind of action, by the mark its words start with. */
export const LOG_GLYPH: Record<string, string> = { '✎': 'edit', '◇': 'read', '▸': 'shell', '⌕': 'search', '◎': 'web', '⇢': 'agent', '🗜': 'think', '◍': 'web', '▣': 'tool', '▤': 'read', '✻': 'agent', '•': 'tool', '⚗': 'shell', '⏸': 'you', '✓': 'done', '✗': 'hookBlock', '←': 'agent', '→': 'agent', '⚓': 'hook', '⧉': 'mcp' }

/**
 * What the pane shows, worked out once for any surface: the counts and cost, each Claude's row, the last
 * task, Touched, the tabs and the lines of the one shown. The pane draws it; the website gets it as data.
 */
export async function paneModel($: EngineInterface, cols: number, bodyRows: number, web = false) {
    // Time since a moment: for the website, a mark its page counts up itself (so the view stays the same each second).
    const since = (from: number, f: 'e' | 's' | 't') => (web ? `\uE000${f}${Math.round(from)}\uE001` : (f === 'e' ? elapsed : f === 's' ? shortTime : took)(Date.now() - from))
    // Every value the pane draws from, read side by side (one round trip, not nine in a row).
    const [c, , codexPublished, sq] = await Promise.all([
      read($, crew),
      // Read so the pane redraws each second while a timer runs.
      read($, tick),
      // Codex runs as the codex-bridge mod publishes them (another plugin's value: read only, typed loosely here).
      $.state.get({ plugin: 'codex-bridge', key: 'runs' } as never).catch(() => ({})),
      read($, search),
    ])
    const published = (codexPublished as unknown as { value?: CodexRun[] }).value ?? []
    const codexRuns = [...published, ...(c.demoCodex ?? [])]
    seeChoices(c)
    const nameFor = (id: string) => c.agents.find(a => a.id === id)?.name ?? (id === 'main' ? 'Claude' : 'a subagent')
    // A finished helper keeps its row a moment after it is done, so rows don't blink in and out.
    const isOpen = (a: Agent) =>
      a.id === 'main' || a.state === 'busy' || a.state === 'thinking' || !!a.needs || (a.state === 'done' && Date.now() - (a.doneAt || 0) < WINDOW_LINGER_MS)
    // In the order they started: a row never moves (waiting on you is pinned on top instead).
    const shown = c.agents.filter(isOpen)

    const worked = Object.entries(c.changes ?? {}).sort((x, y) => y[1].at - x[1].at)
    const totalAdded = worked.reduce((n, [, ch]) => n + ch.added, 0)
    const totalRemoved = worked.reduce((n, [, ch]) => n + ch.removed, 0)
    const vwCols = Math.max(40, Math.min(300, cols - 1))
    // Codex speaks in the log too: what it was asked, what it ran and changed, and what it sent back.
    const codexLog: LogLine[] = codexRuns.flatMap(r => [
      { at: r.startedAt, who: 'Codex', hue: -1, kind: 'info' as const, text: `← ${nameFor(r.caller)}${r.thread ? ` [${r.thread}]` : ''}: ${trunc(oneLine(r.task), 90)}` },
      ...r.events
        .filter(ev => ev.kind === 'cmd' || ev.kind === 'file' || ev.kind === 'say')
        .slice(-12)
        .map(ev => ({
          at: ev.at,
          who: 'Codex',
          hue: -1,
          kind: (ev.kind === 'say' ? 'think' : 'act') as LogLine['kind'],
          text: ev.kind === 'cmd' ? `${SHELL_MARK}${cmdGist(ev.text)}${ev.ok === false ? ' ✗ failed' : ''}` : ev.kind === 'file' ? `✎ ${relPath(ev.text)}` : ev.text,
        })),
      ...(r.endedAt
        ? [
            {
              at: r.endedAt,
              who: 'Codex',
              hue: -1,
              kind: 'info' as const,
              text: `→ ${nameFor(r.caller)}: ${r.status}${r.files.length ? ` · ${r.files.length} file${r.files.length === 1 ? '' : 's'} changed` : ''}${r.notesUpdated ? ' · notes updated' : ''}`,
            },
          ]
        : []),
    ])
    // The log: its lines, scrolled (held at a line while new ones come in below), and the ones opened whole.
    const lv = c.logView ?? {}
    const openLog = new Set(lv.open ?? [])
    // This chat's lines, Codex's, and the nested chats' newest (all of theirs come with Load older).
    const allLog = [...c.log, ...codexLog, ...nestedLines().slice(-NESTED_VIEW)].sort((x, y) => x.at - y.at)
    const held = typeof lv.anchor === 'number'
    let upto = held ? allLog.filter(l => l.at <= (lv.anchor as number)) : allLog
    if (!upto.length) upto = allLog.slice(0, 1)
    const newerCount = allLog.length - upto.length
    const demoOn = c.agents.some(a => isDemoAgent(a.id) && a.state !== 'done')
    // The chat's cost as Claude Code totals it, else what the crew counted of it.
    const ownCost = c.chatCost ?? c.spent?.cost ?? c.agents.reduce((n, a) => n + (a.cost ?? 0), 0)
    // With its nested chats' (each counts its own, so none twice): one total, and the budget applies to it.
    const chatCosts = (c.chats ?? []).map(ch => ({ name: trunc(ch.name || ch.title, 24), cost: Number(nested.get(ch.id)?.file?.card?.cost) || 0 })).filter(x => x.cost > 0)
    const totalCost = ownCost + chatCosts.reduce((n, x) => n + x.cost, 0)
    const costTitle = chatCosts.length ? [`this chat ${fmtUsd(ownCost)}`, ...chatCosts.map(x => `${x.name} ${fmtUsd(x.cost)}`)].join(' · ') : ''
    const sm = c.summary
    const workedGroups: { g: string; rows: (typeof worked)[number][] }[] = []
    for (const w of worked) {
      const g = groupOf(w[0])
      const at = workedGroups.find(x => x.g === g)
      if (at) at.rows.push(w)
      else workedGroups.push({ g, rows: [w] })
    }
    // ── At a glance: one row per Claude at work (and each Codex run) ──
    // Line one: its dot, name, and what it is doing in plain words (the biggest text), its time.
    // Line two: how far along (a pip per step, "Step 2 of 3 · …") and its model. Colour says its state
    // only. One needing you is pinned on top, amber, with its whole request; one done is a dim line.
    const nowOf = (a: Agent): [string, string] => {
      const w = waitOf(a, c, Date.now())
      if (w) return [w.what, w.label]
      if (a.tool === COMPACT && a.state === 'busy') return ['compacting', 'freeing up room']
      if (a.state === 'busy' && a.node && !isSpecial(a.node)) return [baseName(a.node), verbOf(a)]
      // A command: Claude's own words for it, as it runs (not "ran …").
      if (a.state === 'busy' && (a.tool === 'Bash' || a.tool === 'PowerShell'))
        return [(a.actions[0]?.startsWith(SHELL_MARK) ? a.actions[0].slice(SHELL_MARK.length) : cmdGist(a.detail)).replace(/^ran /, ''), 'running']
      if (a.state === 'busy') return [a.detail ? trunc(oneLine(a.detail), 40) : verbOf(a), verbOf(a)]
      if (a.state === 'thinking') return ['thinking', 'planning its next step']
      if (a.state === 'done') return ['done', a.cost ? fmtUsd(a.cost) : 'finished']
      return ['—', a.id === 'main' ? 'waiting for a prompt' : 'idle']
    }
    // Codex in a row while it runs, and a little after (as a helper's lingers); the rest counted.
    const codexRows = codexRuns.filter(r => r.status === 'running' || Date.now() - (r.endedAt || 0) < WINDOW_LINGER_MS)
    const CODEX_ROWS = 3
    // How deep a Claude sits: the main one 0, its helpers 1, theirs 2…
    const depthOf = (a: Agent) => {
      if (a.id === 'main') return 0
      let d = 1
      for (let p = a.parent; p && p !== 'main' && d < 4; p = c.agents.find(x => x.id === p)?.parent) d++
      return d
    }
    const rowOfAgent = (a: Agent): GlanceRow => {
      const now = Date.now()
      const wait0 = waitOf(a, c, now)
      const wait = wait0?.kind === 'command' && a.state === 'busy' ? undefined : wait0
      const runFrom = wait0 && !wait ? Math.min(...[...(c.shells ?? []), ...(c.tests ?? [])].filter(x => x.agentId === a.id && x.status === 'running').map(x => x.startedAt), now) : 0
      const at = a.state === 'busy' || a.state === 'thinking'
      const state: GlanceRow['state'] = a.needs ? 'you' : a.state === 'done' ? 'done' : wait ? (wait.kind === 'you' ? 'idle' : 'wait') : at ? 'work' : 'idle'
      const [what] = nowOf(a)
      const kind =
        state === 'you' || state === 'done' || state === 'wait' || state === 'idle'
          ? state
          : a.state === 'thinking' || a.tool === COMPACT
            ? 'think'
            : kindOf(a.tool)
      const tests = kind === 'shell' && /\b(test|tests|jest|vitest|pytest|mocha|spec)\b/i.test(`${what} ${a.detail}`)
      const status =
        state === 'you' ? 'Needs you' : state === 'done' ? 'Done' : state === 'wait' ? 'Waiting' : state === 'idle' ? 'Idle' : a.tool === COMPACT ? 'Compacting' : tests ? 'Running tests' : workWords(a, kind)
      const goal = a.goal && !systemNote(a.goal) ? oneLine(promptOf(a.goal)) : ''
      const object =
        state === 'you'
          ? ''
          : state === 'done'
            ? a.job || goal
            : state === 'wait'
              ? `for ${wait?.what ?? ''}`
              : state === 'idle'
                ? a.id === 'main'
                  ? 'your turn'
                  : ''
                : a.state === 'thinking'
                  ? // How long its model step has run, and what it last said.
                    [stepStart.has(a.id) ? since(stepStart.get(a.id) ?? 0, 'e') : '', a.thoughts[0] ? oneLine(a.thoughts[0]) : ''].filter(Boolean).join(' · ')
                  : runFrom && now - runFrom >= 1000
                    ? // A test run by what it is for (JS tests (jest): auth), else the command in Claude's words; and how long.
                      `${(t => (t ? t.purpose || testPurpose(t.command, '') : ''))((c.tests ?? []).find(x => x.agentId === a.id && x.status === 'running')) || wait0?.what || what} · ${since(runFrom, 'e')}`
                    : what
      const tasks = tasksOf(a, c)
      const total = tasks.length || a.todosTotal
      const done = tasks.length ? tasks.filter(t => t.status === 'completed').length : a.todosDone
      const step = doingOf(a, c) || tasks.find(t => t.status !== 'completed')?.subject || ''
      const progress = total
        ? `Step ${fmtK(Math.min(total, done + 1))} of ${fmtK(total)}${step ? ` · ${step}` : ''}`
        : state === 'idle' && a.id === 'main'
          ? 'Nothing running · ask Claude something to start'
          : state === 'idle'
            ? 'idle'
            : `${fmtK(a.calls)} action${a.calls === 1 ? '' : 's'} so far`
      const parent = c.agents.find(x => x.id === (a.parent ?? 'main'))
      const ask = a.needs ? `${a.needs.what.charAt(0).toUpperCase()}${a.needs.what.slice(1)}? Answer in the chat.` : ''
      return {
        id: a.id,
        name: a.name,
        hue: colorOf(a),
        state,
        kind,
        status,
        object,
        // At work: since it took this on; its turn over and waiting on what it started: since its turn ended.
        time: at && a.since ? since(a.since, 's') : state === 'wait' && (a.doneAt || a.since) ? since(a.doneAt || a.since, 's') : state === 'done' && a.since ? shortTime((a.doneAt || now) - a.since) : '',
        total,
        done,
        progress: a.stuck && state !== 'done' ? `Stuck? It ${a.stuck}.` : progress,
        stuck: !!a.stuck && state !== 'done',
        model: shortModel(agentModel.get(a.id) ?? (a.id === 'main' ? mainModel : '')),
        depth: depthOf(a),
        ctx: state === 'done' ? undefined : ctxPct(a.ctx),
        ...(state === 'wait' && wait?.kind === 'helpers' ? { helpers: true } : {}),
        request: ask ? wrapRows(ask, Math.max(20, cols - 18), 2) : [],
        ask,
        where: a.needs && a.id !== 'main' && parent ? `helping ${parent.name}` : '',
      }
    }
    const rowOfCodex = (r: CodexRun): GlanceRow => {
      const last = [...r.events].reverse().find(ev => ev.kind === 'cmd' || ev.kind === 'file')
      const running = r.status === 'running'
      const kind = !running ? 'done' : last?.kind === 'cmd' ? 'shell' : last?.kind === 'file' ? 'edit' : 'think'
      const caller = c.agents.find(a => a.id === r.caller)
      return {
        id: `cx-${r.id}`,
        name: 'Codex',
        hue: CX,
        state: running ? 'work' : 'done',
        kind,
        status: running ? KIND_WORDS[kind] : 'Done',
        object: last ? (last.kind === 'cmd' ? cmdGist(last.text).replace(/^ran /, '') : baseName(last.text)) : r.activity || oneLine(r.task),
        time: running && r.startedAt ? since(r.startedAt, 's') : '',
        total: 0,
        done: 0,
        progress: `${fmtK(r.commands)} command${r.commands === 1 ? '' : 's'} · ${fmtK(r.files.length)} file${r.files.length === 1 ? '' : 's'}${r.thread ? ` · ${r.thread}` : ''}`,
        model: r.model ? trunc(r.model, 14) : '',
        depth: caller ? depthOf(caller) + 1 : 1,
        ctx: running ? -1 : undefined,
        request: [],
        where: '',
      }
    }
    // In tree order (each Claude, then the ones it started), the ones needing you pinned on top.
    const byParent = (id: string) => shown.filter(a => a.id !== 'main' && (a.parent ?? 'main') === id)
    const ordered: Agent[] = []
    const walk = (a: Agent) => {
      if (ordered.includes(a)) return
      ordered.push(a)
      byParent(a.id).forEach(walk)
    }
    shown.filter(a => a.id === 'main' || !shown.some(p => p.id === (a.parent ?? 'main'))).forEach(walk)
    // A chat started from this one: its title, working or idle, and where it works; nested under this chat.
    const chatList = c.chats ?? []
    // Not read live (the list needs an approval to read): as of Claude's last look, its time at the right.
    const asOfChat = (ch: Chat) => (c.chatsLive === false && ch.seen ? clock(ch.seen).slice(0, 5) : '')
    // Its steps, from the file it writes about itself: as a Claude's card shows them (its branch and folder
    // are then in Details only); without steps, where it works.
    // A nested chat reads as a helper Claude does: its card as its own pane draws it (from the file it
    // writes), under its short name and colour, its own helpers one step in under it. Before it has
    // written a card: what the chat list says. A card not read live says "as of", and never needs you
    // (that must be live). Needing you, it says to answer in that chat: the mod can't answer it here.
    // (Its times come as marks: the website counts them up, the pane turns them into words.)
    const fromMarks = (t: string) => (web ? t : t.replace(/\uE000([est])(\d+)\uE001/g, (_, k: 'e' | 's' | 't', n: string) => since(Number(n), k)))
    const rowsOfChat = (ch: Chat): GlanceRow[] => {
      const f = nested.get(ch.id)?.file
      const asOf = asOfChat(ch)
      const name = trunc(ch.name || ch.title, 24)
      const [main, ...helpers] = (f?.card?.rows ?? []).filter(r => r && typeof r.name === 'string')
      const total = Math.max(0, Math.round(Number(main?.total ?? f?.total) || 0))
      const done = Math.min(total, Math.max(0, Math.round(Number(main?.done ?? f?.done) || 0)))
      const answer = `${name} · answer in that chat`
      const stateOf = (r: NestedRow): GlanceRow['state'] => (r.state === 'you' && asOf ? 'work' : r.state)
      const head: GlanceRow = {
        id: `chat-${ch.id}`,
        name: main ? name : ch.title,
        hue: PALETTE[chatHue(ch.id)],
        state: main && !asOf ? stateOf(main) : ch.running ? 'work' : 'idle',
        kind: main && !asOf ? main.kind : ch.running ? 'msg' : 'idle',
        status: main && !asOf ? main.status : ch.running ? 'Working' : 'Idle',
        object: asOf ? `as of ${asOf}` : main ? fromMarks(main.object) : ch.running ? 'in its own chat' : ch.at ? `last active ${since(ch.at, 's')} ago` : '',
        time: asOf ? (ch.at ? since(ch.at, 's') : '') : main ? fromMarks(main.time) : '',
        asOf: asOf || undefined,
        total,
        done,
        progress: main
          ? fromMarks(main.progress)
          : total
            ? `Step ${fmtK(Math.min(total, done + 1))} of ${fmtK(total)}${f?.doing ? ` · ${trunc(oneLine(String(f.doing)), 120)}` : ''}`
            : `Chat · ${[ch.branch, baseName(ch.cwd)].filter(Boolean).join(' · ')}`,
        stuck: !!main?.stuck && !asOf,
        model: main?.model ?? '',
        depth: ch.depth,
        ctx: main && !asOf && stateOf(main) === 'done' ? undefined : asOf ? -1 : ctxPct(main?.info?.ctx),
        ...(main && !asOf && main.state === 'wait' && main.helpers === true ? { helpers: true } : {}),
        request: [],
        where: '',
      }
      const you = (r: NestedRow) => r.state === 'you' && !asOf
      const askOf = (r: NestedRow) => (you(r) ? { ask: r.ask ?? '', request: wrapRows(r.ask ?? '', Math.max(20, cols - 18), 2), where: answer } : {})
      return [
        { ...head, ...(main ? askOf(main) : {}) },
        ...helpers.map(h => ({
          id: `chat-${ch.id}~${h.id}`,
          name: h.name,
          hue: PALETTE[chatHue(ch.id, h.id)],
          state: stateOf(h),
          kind: h.kind,
          status: h.status,
          object: fromMarks(h.object),
          time: fromMarks(h.time),
          total: h.total,
          done: h.done,
          progress: fromMarks(h.progress),
          stuck: !!h.stuck && !asOf,
          model: h.model,
          depth: ch.depth + Math.max(1, h.depth),
          ctx: stateOf(h) === 'done' ? undefined : asOf ? -1 : ctxPct(h.info?.ctx),
          ...(!asOf && h.state === 'wait' && h.helpers === true ? { helpers: true } : {}),
          // (Not read live: as stale as its chat, so dim and left out of the counts.)
          asOf: asOf || undefined,
          request: [],
          where: '',
          ...askOf(h),
        })),
      ]
    }
    const glance = [...ordered.map(rowOfAgent), ...chatList.flatMap(rowsOfChat), ...codexRows.slice(0, CODEX_ROWS).map(rowOfCodex)]
    const glanceList = [...glance.filter(r => r.state === 'you'), ...glance.filter(r => r.state !== 'you')]
    // The other chats in this project: each its main card, no indent (its helpers only in its Details); its
    // title for a name; "branch · folder" when it has no steps; needing you, it says to answer there. In
    // order: needing you, working, waiting, then idle by last active (6 idle at most). Not counted above.
    // (A chat listed in this folder whose own file names another project stays out.)
    const siblingList = (c.siblings ?? []).filter(ch => { const f = nested.get(ch.id)?.file; return !f || (!f.root && !f.cwd) || fileInProject(f, ch) })
    const RANK: Record<GlanceRow['state'], number> = { you: 0, work: 1, wait: 2, idle: 3, done: 3 }
    const projAll = siblingList
      .map(ch => {
        const [head, ...helpers] = rowsOfChat(ch)
        const row: GlanceRow = {
          ...head,
          name: ch.title,
          depth: 0,
          progress: head.total > 0 ? head.progress : [ch.branch, baseName(ch.cwd)].filter(Boolean).join(' · '),
          ...(head.state === 'you' ? { where: 'its own chat · answer there' } : {}),
          // (In whole minutes, hours or days: "2h", not a clock.)
          ago: ch.at ? agoText(Date.now() - ch.at) : '',
          plain: !knownColors[`chat:${ch.id}`],
        }
        return { row, helpers, at: ch.at }
      })
      .sort((x, y) => RANK[x.row.state] - RANK[y.row.state] || y.at - x.at)
    const projRows = [...projAll.filter(x => RANK[x.row.state] < 3), ...projAll.filter(x => RANK[x.row.state] === 3).slice(0, SIBLINGS_MAX)].map(x => x.row)
    const projHelpers = projAll.flatMap(x => x.helpers)
    // ── Folder cards: each folder the work touched, its files as chips (green edited, red with errors) ──
    // Built from the session's record of touched files (it keeps edits, and the order files were first
    // reached): an edited file never drops off, a folder never moves.
    type CardFile = { id: string; label: string; touchedAt: number }
    const cardFiles: CardFile[] = []
    const seenFile = new Set<string>()
    for (const [id, ch] of Object.entries(c.changes ?? {}))
      if (!isSpecial(id) && !seenFile.has(id)) {
        seenFile.add(id)
        cardFiles.push({ id, label: baseName(id), touchedAt: c.reached?.[id] || ch.at || 0 })
      }
    for (const [id, at] of Object.entries(c.reached ?? {}))
      if (!isSpecial(id) && !seenFile.has(id)) {
        seenFile.add(id)
        cardFiles.push({ id, label: baseName(id), touchedAt: at })
      }
    // Files nested chats touched (any depth), joined to this chat's: one entry per path.
    const nt = nestedTouched()
    for (const [id, list] of nt)
      if (!isSpecial(id) && !seenFile.has(id)) {
        seenFile.add(id)
        cardFiles.push({ id, label: baseName(id), touchedAt: list[0]?.at ?? 0 })
      }
    // A file's edits by every chat, and who: this chat (its Claude who changed it last) and the nested ones.
    const editsOf = (id: string) => {
      const ch = c.changes[id]
      const others = nt.get(id) ?? []
      const theirs = others.filter(x => x.edits)
      return {
        ch,
        others,
        edited: !!ch?.edits || theirs.length > 0,
        added: (ch?.edits ? ch.added : 0) + theirs.reduce((n, x) => n + x.added, 0),
        removed: (ch?.edits ? ch.removed : 0) + theirs.reduce((n, x) => n + x.removed, 0),
      }
    }
    const onFile = new Map<string, Agent[]>()
    for (const a of c.agents) if ((a.state === 'busy' || a.needs) && a.node) onFile.set(a.node, [...(onFile.get(a.node) ?? []), a])
    const groups = new Map<string, { files: CardFile[]; first: number }>()
    // A folder's place is its first file's: new folders join at the end, none ever moves.
    cardFiles.forEach((f, i) => {
      const g = groupOf(f.id)
      if (g === OUTSIDE && c.hideOutside) return
      const cur = groups.get(g) ?? { files: [], first: i }
      cur.files.push(f)
      groups.set(g, cur)
    })
    const outsideCount = c.hideOutside ? cardFiles.filter(f => groupOf(f.id) === OUTSIDE).length : 0
    const folders = [...groups.entries()].sort((x, y) => x[1].first - y[1].first)
    const errsOf = (id: string) => (c.problems ?? []).filter(pr => pr.path === id).length + (nt.get(id) ?? []).reduce((n, x) => n + (x.errs ?? 0), 0)
    const natural = (x: CardFile, y: CardFile) => x.label.localeCompare(y.label, undefined, { numeric: true, sensitivity: 'base' }) || x.id.localeCompare(y.id)
    // ── The pane, as the design draws it: header, crew, Touched, and the viewer with its tabs ──
    const now = Date.now()
    const wide = cols >= 70
    const ps = c.pane ?? {}
    const paneAct = (p: Omit<Extract<Act, { k: 'pane' }>, 'k'>): Act => ({ k: 'pane', ...p })
    const focusRow = ps.tab === 'claude' ? [...glanceList, ...projRows, ...projHelpers].find(r => r.id === ps.focus) : undefined
    const tab = ps.tab === 'claude' && !focusRow ? 'activity' : ps.tab ?? 'activity'
    const rowsP: PaneRow[] = glanceList.map(r => ({ ...r, ask: r.ask ?? r.request.join(' '), focused: tab === 'claude' && r.id === ps.focus }))
    const projP: PaneRow[] = projRows.map(r => ({ ...r, ask: r.ask ?? r.request.join(' '), focused: tab === 'claude' && r.id === ps.focus }))
    // The header counts only what is known live: a nested chat not read live ("as of") is left out.
    const liveRows = rowsP.filter(r => !r.asOf)
    const count = (s: GlanceRow['state']) => liveRows.filter(r => r.state === s).length
    const standby = !liveRows.some(r => r.state === 'work' || r.state === 'wait' || r.state === 'you')
    const openDetails = (id: string) => (tab === 'claude' && ps.focus === id ? paneAct({ tab: 'activity', focus: '', top: 0 }) : paneAct({ tab: 'claude', focus: id, top: 0 }))
    const openFile = (id: string, name: string): Act => {
      const at = (c.problems ?? []).find(p => p.path === id)?.line
      return { k: 'file', path: id, name, edits: (c.changes[id]?.edits ?? 0) > 0, ...(at ? { line: at } : {}) }
    }
    const openDir = (path: string, name: string): Act => ({ k: 'dir', path, name })
    const label = (g: string) => (g === OUTSIDE ? 'outside the project' : g === '.' ? 'project top' : `${g}/`)
    const dirPathOf = (g: string) => (g === OUTSIDE || g.startsWith('demo') ? '' : g === '.' ? sessionDir : `${sessionDir}/${g}`)

    // Header: counts by state (only those there are), then the one cost and the budget.
    const n = { you: count('you'), work: count('work'), wait: count('wait'), done: count('done'), idle: count('idle') }
    const counts: [string, string, boolean][] = standby
      ? [[`◌ ${fmtK(Math.max(1, n.idle))} idle`, 'dim', false], ...(wide ? ([['· nothing running', 'dim', false]] as [string, string, boolean][]) : [])]
      : ([
          [n.you ? (wide ? `⏸ ${fmtK(n.you)} needs you` : `⏸ ${fmtK(n.you)}`) : '', 'amber', true],
          [n.work ? (wide ? `● ${fmtK(n.work)} working` : `● ${fmtK(n.work)}`) : '', 'green', false],
          [n.wait ? (wide ? `◌ ${fmtK(n.wait)} waiting` : `◌ ${fmtK(n.wait)}`) : '', liveRows.some(r => r.state === 'wait' && r.helpers && !r.asOf) ? 'wait' : 'dim', false],
          [n.done ? (wide ? `✓ ${fmtK(n.done)} done` : `✓ ${fmtK(n.done)}`) : '', 'dim', false],
        ] as [string, string, boolean][]).filter(x => x[0])
    const costRole = c.budget > 0 && totalCost >= c.budget ? 'red' : c.budget > 0 && totalCost >= c.budget * 0.8 ? 'amber' : 'text'
    const budgetText = c.budget > 0 ? (wide ? `of ${fmtUsd(c.budget)}` : `/ ${fmtUsd(c.budget)}`) : ''

    // The last task while nobody works; before any work, what shows here and the demo.
    // Who spent it: this chat's Claudes and the nested chats, the most first.
    const spendersNow = [...c.agents.filter(a => (a.cost ?? 0) > 0).map(a => ({ name: a.name, cost: a.cost })), ...chatCosts].sort((x, y) => y.cost - x.cost)
    const recap: Recap | undefined =
      standby && sm
        ? {
            title: `Last task done in ${elapsed(sm.ms)}`,
            goal: sm.goal ? oneLine(promptOf(sm.goal)) : '',
            ago: `${since(sm.at, 's')} ago`,
            facts: [
              ['Changed', sm.files.length ? `${fmtK(sm.files.length)} file${sm.files.length === 1 ? '' : 's'} · +${fmtK(sm.files.reduce((k, f) => k + f.added, 0))} −${fmtK(sm.files.reduce((k, f) => k + f.removed, 0))}` : 'no files', 'text'],
              ['Tests', sm.tests.runs ? (sm.tests.failed ? `✕ ${fmtK(sm.tests.failed)} failed · last ${sm.tests.last}` : `✓ ${sm.tests.last}`) : 'none run', sm.tests.runs ? (sm.tests.failed ? 'red' : 'green') : 'dim'],
              ['Cost', [fmtUsd(sm.cost), spendersNow.slice(0, wide ? 3 : 1).map(a => `${a.name} ${fmtUsd(a.cost)}`).join(', ') + (spendersNow.length > (wide ? 3 : 1) ? `, ${fmtK(spendersNow.length - (wide ? 3 : 1))} more` : '')].filter(Boolean).join(' · '), 'text'],
              ['Crew', `${sm.claudes.slice(0, wide ? 4 : 2).join(', ')}${sm.claudes.length > (wide ? 4 : 2) ? ` and ${fmtK(sm.claudes.length - (wide ? 4 : 2))} more` : ''}${sm.codex ? ` · ${fmtK(sm.codex)} Codex run${sm.codex === 1 ? '' : 's'}` : ''}`, 'text'],
            ],
            copy: { k: 'copy' },
          }
        : standby && !c.log.length
          ? { title: 'Nothing yet. Each Claude gets a row here as it starts.', goal: '', ago: '', facts: [], demo: { k: 'demo' } }
          : undefined

    // Touched: the three folders worked in most lately (in the order first reached), their files as buttons.
    const lastIn = (files: CardFile[]) => Math.max(0, ...files.map(f => Math.max(f.touchedAt, c.changes[f.id]?.at ?? 0, nt.get(f.id)?.[0]?.at ?? 0)))
    const touchFolders: TouchFolder[] = [...folders]
      .sort((x, y) => lastIn(y[1].files) - lastIn(x[1].files))
      .slice(0, 3)
      .sort((x, y) => x[1].first - y[1].first)
      .map(([g, info]) => ({
        name: label(g),
        files: [...info.files]
          .map(f => ({ f, e: editsOf(f.id), who: onFile.get(f.id) ?? [], errs: errsOf(f.id) }))
          .sort((x, y) => +!!(y.who.length || y.e.others.some(o => o.editing)) - +!!(x.who.length || x.e.others.some(o => o.editing)) || y.errs - x.errs || +y.e.edited - +x.e.edited || Math.max(y.e.ch?.at ?? 0, y.e.others[0]?.at ?? 0) - Math.max(x.e.ch?.at ?? 0, x.e.others[0]?.at ?? 0))
          .map(({ f, e, who, errs }): TouchFile => {
            // The bubble: the chat editing it now, else the latest one to touch it.
            const mark = e.others.find(o => o.editing) ?? e.others[0]
            const whom = [...(e.ch ? [`this chat (${e.ch.by})${who.length ? ', editing it now' : ''}`] : []), ...e.others.map(o => `${o.name} (${o.by})${o.editing ? ', editing it now' : ''}`)]
            return {
              name: f.label,
              errs,
              add: e.edited ? e.added : 0,
              del: e.edited ? e.removed : 0,
              on: who.length ? hueRole(colorOf(who[0])) : '',
              read: !e.edited,
              run: openFile(f.id, f.label),
              ...(mark ? { chat: { hue: `h${chatHue(mark.chat)}`, fill: !!mark.editing } } : {}),
              title: [f.label, e.edited ? `+${fmtK(e.added)} −${fmtK(e.removed)}` : 'read', whom.join(' and ')].filter(Boolean).join(' · '),
            }
          }),
      }))
    const problemsN = (c.problems ?? []).length
    // One count of the files the work touched (edited, read, or named by an error), the same in Touched and Files.
    const filesN = cardFiles.length
    const byNested = cardFiles.filter(f => nt.has(f.id)).length
    const touchedSum = filesN
      ? `${fmtK(filesN)} file${filesN === 1 ? '' : 's'}${wide && (totalAdded || totalRemoved) ? ` · +${fmtK(totalAdded)} −${fmtK(totalRemoved)}` : ''}${problemsN ? ` · ${fmtK(problemsN)} problem${problemsN === 1 ? '' : 's'}` : ''}${!web && wide && byNested ? ` · ${fmtK(byNested)} by nested chats` : ''}`
      : ''

    // The viewer: what each tab lists, as lines; the body shows BODY_ROWS of them from where it is scrolled.
    // Every Claude shows; the viewer takes the rest of the pane, down to its bottom (8 rows at least).
    const aboveRows =
      1 +
      1 +
      rowsP.reduce((n, r) => n + (r.state === 'done' ? 1 : r.state === 'you' ? 2 + wrapRows(r.ask, Math.max(16, cols - 6), 6).length : 2), 0) +
      (recap ? (recap.copy ? 2 + recap.facts.length : 2) : 0)
    const paneRows = Math.max(0, Math.floor(bodyRows))
    const BODY_ROWS = Math.max(8, (paneRows || aboveRows + 1 + 4 + 2 + 1 + 12) - aboveRows - 1 - 4 - 2 - (tab === 'search' ? 1 : 0) - 1)
    const timeW = (wide ? 8 : 5) * CELL_W
    const logCols = Math.max(12, vwCols - (wide ? 8 : 5) - 3 - 7 - 3 - 3 - 9)
    // A line opened reads over as many rows as it takes, up to the viewer's (the rest of a longer one is in the chat).
    const vRowsOf = (l: LogLine) => (openLog.has(logKey(l)) ? wrapRows(fullOf(l), logCols, BODY_ROWS) : [cutTo(oneLine(shortOf(l)), logCols)])
    const vCut = (l: LogLine) => fullOf(l) !== shortOf(l) || textW(oneLine(shortOf(l))) > logCols
    const logLinesOf = (l: LogLine): VLine[] => {
      const m = messageOf(l)
      const kind = l.kind === 'think' ? 'thought' : m ? 'msg' : LOG_GLYPH[[...l.text][0]] ?? (l.kind === 'info' ? 'plan' : 'tool')
      const bare = (t: string) => (l.kind === 'think' || m ? t : t.replace(/^[^\p{L}\p{N}"'(\[$~./]+/u, ''))
      const k = logKey(l)
      const open = openLog.has(k)
      const rowsOf = vRowsOf(l).map((t, i) => (i ? t : bare(t)))
      // Words start with a capital; a path or a file name keeps its own case.
      const first = rowsOf[0] && !/^\S*[/.\\]/.test(rowsOf[0]) ? `${rowsOf[0].charAt(0).toUpperCase()}${rowsOf[0].slice(1)}` : rowsOf[0] ?? ''
      const running = l.took === undefined && !!l.call && now - l.at >= 1000 && now - l.at < SHELL_GIVE_UP_MS
      const dur = l.took !== undefined ? took(l.took) : running ? `● ${since(l.at, 't')}` : ''
      // A nested chat's line: its chat's name and colour, and the helper there (or who wrote) first.
      const who = l.chat ? trunc(l.who, 6) : m ? (m.from ? trunc(m.from, 6) : 'You') : trunc(l.who, 6)
      const by = l.chat ? (m ? m.from || 'You' : l.by) : ''
      const tone = l.kind === 'think' || l.kind === 'info' ? 'dim' : 'text'
      return [
        {
          segs: [
            { t: wide ? clock(l.at) : clock(l.at).slice(0, 5), w: timeW, role: 'faint' },
            { dot: l.chat ? `h${chatHue(l.chat)}` : m ? 'text' : l.hue < 0 ? 'cx' : `h${l.hue % PALETTE.length}` },
            { t: who, w: 6 * CELL_W, role: 'dim' },
            { icon: [kind, running ? 'green' : l.kind === 'you' ? 'text' : 'dim'] },
            ...(by ? [{ t: `${by} ·`, role: 'dim' } as Seg] : []),
            { t: first, flex: true, role: tone, i: l.kind === 'think' },
            ...(vCut(l) ? [{ t: open ? '▾' : '›', role: 'dim', run: { k: 'log', toggle: k, hold: upto[upto.length - 1]?.at ?? null }, label: open ? 'Fold the line' : 'Show the whole line', w: 12 } as Seg] : []),
          ] as Seg[],
          right: [{ t: dur, role: running ? 'green' : 'faint' }],
        },
        ...rowsOf.slice(1).map(t => ({ segs: [{ t, flex: true, role: tone, i: l.kind === 'think' }], indent: timeW + 15 * CELL_W })),
      ]
    }
    // Activity: the log's lines up to where it is scrolled, as many as fill the body.
    let actLines: VLine[] = []
    let actFirst = upto.length
    for (let i = upto.length - 1; i >= 0; i--) {
      const ls = logLinesOf(upto[i])
      if (actLines.length && actLines.length + ls.length > BODY_ROWS) break
      actLines.unshift(...ls)
      actFirst = i
    }
    // A line opened but pushed out by the newer ones under it: the body starts at it instead, so it reads from its first row.
    const openAt = upto.map(l => openLog.has(logKey(l))).lastIndexOf(true)
    if (openAt >= 0 && openAt < actFirst && actFirst - openAt <= 3) {
      actLines = upto.slice(openAt).flatMap(logLinesOf).slice(0, BODY_ROWS)
      actFirst = openAt
    }
    const actLast = upto.length - 1
    // One Claude's details: model, who it helps, time; cost, tokens and context; what it was asked; its steps; its own lines.
    const detailLines = (): VLine[] => {
      if (!focusRow) return []
      const a = c.agents.find(x => x.id === focusRow.id)
      const run = focusRow.id.startsWith('cx-') ? codexRuns.find(x => `cx-${x.id}` === focusRow.id) : undefined
      const textCols = Math.max(16, vwCols - 2)
      const out: VLine[] = []
      // A cost, tokens and context line: as a Claude's here, or as a nested chat's Claude published it.
      const costLine = (x: { cost?: number; tokens?: number; ctx?: { tokens: number; window: number }; compactions?: number }): VLine => {
        const ctx = ctxPct(x.ctx)
        const packed = x.compactions ? ` · compacted ${fmtK(x.compactions)}×` : ''
        return {
          segs: [
            { t: `${fmtUsd(x.cost ?? 0)} · ${fmtK(x.tokens ?? 0)} tokens · context`, role: 'dim' },
            ...(ctx >= 0 && x.ctx
              ? [{ bar: ctx / 100, role: ctx >= 85 ? 'red' : ctx >= 60 ? 'amber' : 'dim' }, { t: `${ctx}% of ${fmtK(x.ctx.window)}${ctx >= 85 ? ' · compacts soon' : ''}${packed}`, role: ctx >= 85 ? 'red' : 'dim', flex: true }]
              : [{ t: `—${packed}`, role: 'dim', flex: true }]),
          ],
        }
      }
      // A section's title, dim bold, with a faint note after it.
      const title = (t: string, note = ''): VLine => ({ head: true, segs: [{ t, b: true, role: 'dim' }, ...(note ? [{ t: `· ${note}`, role: 'faint', flex: true }] : [])] })
      // Its steps (✓ done, ▸ on now, ○ to come), and its own lines, newest first: each under its title, none when empty.
      const stepSection = (list: { mark: string; text: string; on: boolean }[]): VLine[] =>
        list.length ? [title('Steps'), ...list.flatMap(st => wrapRows(st.text, textCols - 2, 3).map((w, i): VLine => ({ segs: [{ t: `${i ? ' ' : st.mark} ${w}`, role: st.on ? 'text' : 'dim' }] })))] : []
      const lineSection = (list: LogLine[]): VLine[] => (list.length ? [title('Its lines', 'newest first'), ...list.flatMap(l => logLinesOf(l).slice(0, 1))] : [])
      // A group of the Claudes under this one: its title and their states, then a row each that opens its Details.
      type Under = { r: GlanceRow; depth: number }
      const group = (name: string, note: string, list: Under[]): VLine[] => {
        if (!list.length) return []
        const n = (st: GlanceRow['state']) => list.filter(x => x.r.state === st).length
        const states = ([['work', 'working'], ['you', 'needs you'], ['wait', 'waiting'], ['idle', 'idle'], ['done', 'done']] as const).filter(([st]) => n(st)).map(([st, w]) => `${fmtK(n(st))} ${w}`).join(', ')
        return [
          title(name, note || states),
          ...list.map(({ r, depth }): VLine => {
            const role = stateRole(r)
            const run = openDetails(r.id)
            const done = r.state === 'done'
            return {
              indent: depth * 2 * CELL_W,
              // (In the pane's text: its dot and 11 letters of its name; the website draws `row`.)
              segs: [{ dot: hueRole(r.hue), t: r.name, w: 13 * CELL_W, b: !done, role: done ? 'dim' : 'text', run }, { t: r.status, b: !done, role }, { t: r.object, flex: true, role: done ? 'dim' : 'text' }],
              right: [{ t: r.time, role: 'dim' }, { t: '›', role: 'dim' }],
              row: { hue: hueRole(r.hue), chat: r.id.startsWith('chat-') && !r.id.includes('~'), name: r.name, state: r.state, ...(r.helpers && !r.asOf ? { helpers: true } : {}), status: r.status, object: r.object, done: r.done, total: r.total, time: r.time, depth, run },
            }
          }),
        ]
      }
      // A Claude's helpers, theirs one step in under each (Codex runs it started too).
      const helpersOf = (id: string, depth = 0): Under[] =>
        depth > 3
          ? []
          : glance
              .filter(r => (r.id.startsWith('cx-') ? codexRuns.find(x => `cx-${x.id}` === r.id)?.caller === id : !r.id.startsWith('chat-') && r.id !== 'main' && r.id !== id && (c.agents.find(x => x.id === r.id)?.parent ?? 'main') === id))
              .flatMap(r => [{ r, depth }, ...(r.id.startsWith('cx-') ? [] : helpersOf(r.id, depth + 1))])
      if (focusRow.id.startsWith('chat-')) {
        // A nested chat, or one of its helpers: the same Details as a Claude's here, from what that chat
        // wrote about itself; its title, branch and folder under the first line; its own lines in the log.
        const [cid = '', hid] = focusRow.id.slice(5).split('~')
        const sib = siblingList.find(x => x.id === cid)
        const chat = chatList.find(x => x.id === cid) ?? sib
        const card = nested.get(cid)?.file?.card?.rows ?? []
        const nrow = card.find(r => r.id === (hid ?? 'main'))
        const by = chat ? chatList.find(x => x.id === chat.parent) : undefined
        const helping = hid ? card.find(r => r.id === 'main')?.name : ''
        const head = [focusRow.model, hid ? `helping ${helping || 'Claude'} in ${trunc(chat?.name || chat?.title || 'its chat', 24)}` : sib ? 'a chat in this project' : `started from ${by ? trunc(by.title, 40) : 'this chat'}`, focusRow.asOf ? '' : focusRow.time].filter(Boolean).join(' · ')
        out.push({ segs: [{ t: focusRow.name, b: true }, { t: head, role: 'dim', flex: !focusRow.asOf }, ...(focusRow.asOf ? [{ t: `· as of ${focusRow.asOf}`, role: 'faint', flex: true }] : [])] })
        // Where it works: a project chat's title is its name already, so "branch · folder" (a long folder
        // from its end, whole on hover); a nested chat's title too, under its short name. Cut to fit.
        if (chat && !hid) out.push({ segs: [{ t: [sib ? '' : chat.title, chat.branch, sib && chat.cwd.length > 40 ? `…/${chat.cwd.split('/').filter(Boolean).slice(-2).join('/')}` : chat.cwd].filter(Boolean).join(' · '), role: 'dim', flex: true, tip: chat.cwd }] })
        if (nrow?.info) {
          out.push(costLine(nrow.info))
          // (What it was asked, unless that is its title: the header has it.)
          const asked = nrow.info.asked && !(sib && oneLine(nrow.info.asked).toLowerCase() === oneLine(chat?.title ?? '').toLowerCase()) ? nrow.info.asked : ''
          for (const t of asked ? wrapRows(asked, textCols, 8) : []) out.push({ segs: [{ t }] })
        }
        if (!hid) out.push(...group('Helpers', '', [...glance, ...projHelpers].filter(r => r.id.startsWith(`chat-${cid}~`)).map(r => ({ r, depth: Math.min(3, Math.max(0, r.depth - (chat?.depth ?? 1) - 1)) }))))
        if (nrow?.info) out.push(...stepSection(nrow.info.steps))
        else if (!nrow) out.push({ segs: [{ t: 'Open it from the sidebar, under this chat.', role: 'dim' }] })
        out.push(...lineSection((sib ? projectLines() : nestedLines()).filter(l => l.chat === cid && (hid ? l.by === nrow?.name : !l.by)).slice(-30).reverse()))
        return out
      }
      const parent = a ? c.agents.find(x => x.id === (a.parent ?? 'main')) : undefined
      const caller = run ? c.agents.find(x => x.id === run.caller) : undefined
      const model = focusRow.model || (run ? trunc(run.model, 14) : '')
      const role = a && a.id !== 'main' && parent ? `helping ${parent.name}` : caller ? `run by ${caller.name}` : ''
      const said: Seg = a?.id === 'main' ? (model ? { t: model, tail: ' · leads this chat' } : { t: 'leads this chat' }) : { t: [model, role].filter(Boolean).join(' · ') }
      out.push({ segs: [{ t: focusRow.name, b: true }, { ...said, role: 'dim' }, { t: focusRow.time ? `${said.t ? '· ' : ''}${focusRow.time}` : '', role: 'dim', flex: true }] })
      // How full its context is: a bar and the share of its window (red once it compacts soon), and how often it was compacted.
      if (a) out.push(costLine(a))
      else if (run) out.push({ segs: [{ t: `${fmtK(run.commands)} command${run.commands === 1 ? '' : 's'} · ${fmtK(run.files.length)} file${run.files.length === 1 ? '' : 's'}${run.thread ? ` · ${run.thread}` : ''}`, role: 'dim' }] })
      const asked = run ? oneLine(run.task) : a ? [a.goal && !systemNote(a.goal) ? oneLine(promptOf(a.goal)) : '', a.job ?? ''].sort((x, y) => y.length - x.length)[0] : ''
      for (const t of asked ? wrapRows(asked, textCols, 8) : []) out.push({ segs: [{ t }] })
      if (a) out.push(...group('Helpers', '', helpersOf(a.id)))
      if (a?.id === 'main')
        out.push(
          ...group(
            'Nested chats',
            'started from this chat',
            chatList.flatMap(ch => glance.filter(r => r.id === `chat-${ch.id}` || r.id.startsWith(`chat-${ch.id}~`)).map(r => ({ r, depth: Math.min(3, Math.max(0, r.id.includes('~') ? r.depth - 1 : ch.depth - 1)) }))),
          ),
        )
      if (a) out.push(...stepSection(stepsOf(a, c).slice(0, 12).map(t => ({ mark: stepMark(t.status), text: t.text, on: t.status === 'in_progress' }))))
      out.push(...lineSection(allLog.filter(l => (run ? l.who === 'Codex' : l.who === focusRow.name && l.hue === (a?.hue ?? -2))).slice(-30).reverse()))
      return out
    }
    // Every file the work touched, under its folder (in the order the work first reached them); a folder's
    // name opens it; files outside the project can be hidden, and are counted when they are.
    const fileLines = (filter: (path: string, name: string) => boolean = () => true): VLine[] => {
      const out: VLine[] = []
      for (const [g, info] of folders) {
        const list = info.files.filter(f => filter(f.id, f.label)).sort(natural)
        if (!list.length) continue
        const dp = dirPathOf(g)
        out.push({
          segs: [{ icon: ['folder', 'dim'], t: label(g), role: 'dim', b: true, flex: true, ...(dp ? { run: openDir(dp, label(g).replace(/\/$/, '')) } : {}) }],
          right: g === OUTSIDE && sessionDir ? [{ t: 'hide them', role: 'dim', u: true, run: { k: 'set', hideOutside: true } }] : [],
        })
        for (const f of list) {
          const e = editsOf(f.id)
          const ch = e.ch
          // Who: this chat's Claude, else the nested chat (its bubble, its name, and its helper on a wide page).
          const other = e.others[0]
          const who: Seg = ch
            ? { t: trunc(ch.by, wide ? 18 : 8), w: wide ? 168 : 60, role: `h${ch.hue % PALETTE.length}` }
            : other
              ? // (The website shows the helper only on a wide page: its words go apart.)
                web && other.by !== 'Claude'
                ? { icon: ['msg', `h${chatHue(other.chat)}`], t: trunc(other.name, 12), tail: ` · ${trunc(other.by, 8)}`, w: 168, role: `h${chatHue(other.chat)}` }
                : { icon: ['msg', `h${chatHue(other.chat)}`], t: trunc(wide && other.by !== 'Claude' ? `${other.name} · ${other.by}` : other.name, wide ? 18 : 5), w: wide ? 168 : 60, role: `h${chatHue(other.chat)}` }
              : { t: '', w: wide ? 168 : 60, role: 'dim' }
          out.push({
            segs: [{ t: f.label, flex: true, role: errsOf(f.id) ? 'red' : e.edited ? 'text' : 'dim', run: openFile(f.id, f.label) }],
            right: [...(e.edited ? [{ t: `+${fmtK(e.added)}`, role: 'green', gap: 5 }, { t: `−${fmtK(e.removed)}`, role: 'dim' }] : [{ t: errsOf(f.id) ? `✕${errsOf(f.id)}` : 'read', role: errsOf(f.id) ? 'red' : 'faint' }]), who],
            indent: 18,
          })
        }
      }
      if (outsideCount) out.push({ segs: [{ t: `${fmtK(outsideCount)} file${outsideCount === 1 ? '' : 's'} outside the project, hidden`, role: 'faint', flex: true }], right: [{ t: 'show them', role: 'dim', u: true, run: { k: 'set', hideOutside: false } }] })
      return out.length ? out : [{ segs: [{ t: 'No files yet: they show here as the Claudes open them.', role: 'dim' }] }]
    }
    const searchLines = (): VLine[] => {
      const qq = sq.q.trim().toLowerCase()
      if (!qq) return [{ segs: [{ t: 'Type to find files, and lines in the log.', role: 'dim' }] }]
      const files = fileLines((p, nm) => relPath(p).toLowerCase().includes(qq) || nm.toLowerCase().includes(qq))
      const hits = allLog.filter(l => oneLine(fullOf(l)).toLowerCase().includes(qq)).slice(-40).reverse()
      const fileCount = cardFiles.filter(f => relPath(f.id).toLowerCase().includes(qq) || f.label.toLowerCase().includes(qq)).length
      return [
        { segs: [{ t: `${fmtK(fileCount)} file${fileCount === 1 ? '' : 's'} and ${fmtK(hits.length)} log line${hits.length === 1 ? '' : 's'} match`, role: 'dim' }] },
        ...(fileCount ? files : []),
        ...hits.flatMap(l => logLinesOf(l).slice(0, 1)),
      ]
    }
    const setW = wide ? 120 : 104
    const choice = (t: string, picked: boolean, run: Act): Seg => ({ t, role: picked ? 'text' : 'dim', b: picked, u: picked, run, gap: 12 })
    const settingLines = (): VLine[] => [
      { segs: [{ t: 'Theme', w: setW, role: 'dim', gap: 12 }, ...THEMES.map(m => choice(THEME_LABEL[m], (c.theme ?? 'auto') === m, { k: 'set', theme: m }))] },
      {
        segs: [
          { t: 'Budget', w: setW, role: 'dim', gap: 12 },
          ...[0, 5, 10, 25, 50, 100].map(v =>
            choice(v ? `$${v}` : 'none', (c.budget || 0) === v, { k: 'set', budget: v }),
          ),
          ...(wide ? [{ t: 'warns at 50, 80, 100%', role: 'faint', flex: true }] : []),
        ],
      },
      { segs: [{ t: 'Open files in', w: setW, role: 'dim', gap: 12 }, ...([['code', 'VS Code'], ['cursor', 'Cursor'], ['system', 'default app']] as const).map(([v, t]) => choice(t, (c.editor || 'code') === v, { k: 'set', editor: v }))] },
      { segs: [{ t: 'Outside files', w: setW, role: 'dim', gap: 12 }, choice('shown', !c.hideOutside, { k: 'set', hideOutside: false }), choice('hidden', !!c.hideOutside, { k: 'set', hideOutside: true })] },
      { segs: [{ t: 'Save log', w: setW, role: 'dim', gap: 12 }, choice('when I press Save', !c.autoSave, { k: 'set', autoSave: false }), choice('after each task', !!c.autoSave, { k: 'set', autoSave: true })] },
      { segs: [{ t: 'Test toasts', w: setW, role: 'dim', gap: 12 }, choice('off', !c.testToasts, { k: 'set', testToasts: false }), choice('on', !!c.testToasts, { k: 'set', testToasts: true }), ...(wide ? [{ t: 'when a test run ends', role: 'faint', flex: true }] : [])] },
      { segs: [{ t: 'Demo', w: setW, role: 'dim', gap: 12 }, { t: demoOn ? 'a pretend session is playing' : '▶ try a pretend session', role: 'dim', u: !demoOn, run: { k: 'demo' } }] },
      { segs: [] },
      { segs: [{ t: `Claude Crew ${VERSION}`, role: 'faint' }] },
    ]
    const listed = tab === 'activity' ? actLines : tab === 'claude' ? detailLines() : tab === 'files' ? fileLines() : tab === 'search' ? searchLines() : settingLines()
    const fit = BODY_ROWS
    const top0 = tab === 'activity' ? 0 : Math.max(0, Math.min(ps.top ?? 0, listed.length - fit))
    const scroll =
      tab === 'activity'
        ? {
            up: actFirst > 0 ? ({ k: 'log', anchor: upto[Math.max(0, actLast - LOG_STEP)]?.at ?? null } as Act) : NONE,
            down: held ? ({ k: 'log', anchor: upto.length - 1 + LOG_STEP >= allLog.length - 1 ? null : allLog[upto.length - 1 + LOG_STEP].at } as Act) : NONE,
            latest: { k: 'log', anchor: null } as Act,
            canUp: actFirst > 0,
            canDown: held && newerCount > 0,
            held,
          }
        : {
            up: paneAct({ top: Math.max(0, top0 - 3) }),
            down: paneAct({ top: Math.min(Math.max(0, listed.length - fit), top0 + 3) }),
            latest: paneAct({ top: 0 }),
            canUp: top0 > 0,
            canDown: top0 + fit < listed.length,
            held: top0 > 0,
          }
    const tabs: Tab[] = [
      { id: 'activity', t: 'Activity', label: 'Activity' },
      { id: 'files', t: `Files ${fmtK(filesN)}`, label: 'All files' },
      { id: 'search', t: '⌕', label: 'Search' },
      { id: 'settings', t: '⚙', label: 'Settings' },
      ...(focusRow ? [{ id: 'claude', t: `${trunc(focusRow.name, 12)} ✕`, label: `Close ${focusRow.name}'s details` }] : []),
    ].map(x => ({
      ...x,
      on: x.id === tab,
      run: x.id === 'claude' ? paneAct({ tab: 'activity', focus: '', top: 0 }) : paneAct({ tab: x.id as NonNullable<Crew['pane']>['tab'], top: 0 }),
    }))
    // The website's log: its newest lines (the page keeps what it was sent, and loads older ones from the
    // journals), each whole (the page cuts it to fit and opens it), oldest first.
    const projLog = web && webProject ? projectLines().filter(l => webProject === '*' || l.chat === webProject).slice(-WEB_WINDOW) : []
    const webLog = [...allLog.slice(-WEB_WINDOW), ...projLog].map(webLine)
    return { c, sq, vwCols, totalCost, costTitle, wide, paneAct, tab, rowsP, projP, openDetails, openDir, counts, costRole, budgetText, recap, touchFolders, touchedSum, byNested, BODY_ROWS, listed, top0, scroll, tabs, webLog }
}
