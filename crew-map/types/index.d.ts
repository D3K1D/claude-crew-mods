export type AgentState = 'busy' | 'thinking' | 'idle' | 'done'

export type Agent = {
  /** 'main' for the main loop, a subagent's id, or 'demo-N'. */
  id: string
  name: string
  /** 'main', or the subagent type (Explore, Plan, general-purpose, ...). */
  kind: string
  /** Index into the palette; 0 is Claude orange. */
  hue: number
  /** The map node it is at ('' before its first file). */
  node: string
  /** Nodes it visited, newest first. */
  visited: string[]
  tool: string
  detail: string
  pending: string[]
  state: AgentState
  doneAt: number
  calls: number
  goal: string
  /** Summarised chain-of-thought lines, newest first. */
  thoughts: string[]
  /** Short action lines, newest first. */
  actions: string[]
  /** 0-100, or -1 while unknown. */
  progress: number
  progressSrc: 'todos' | 'model' | 'est' | 'done'
  todosDone: number
  todosTotal: number
  /** To-dos (TodoWrite) in progress. */
  todosDoing?: number
  /** The todo in progress, when it keeps a list. */
  doing: string
  /** Its steps on the desktop app's task list (update_plan), as the app holds them. */
  plan?: { content: string; status: string }[]
  /** Its to-do list (TodoWrite), when that is its latest list. */
  todoList?: { content: string; status: string; activeForm?: string }[]
  /** When it took on its current goal: the window's clock for a Claude without a to-do list. */
  since: number
  /** The node it last moved from, and when: the map zips it across. */
  from: string
  movedAt: number
  /** Tokens its finished turns used (input, output and cache), from the engine's own count. */
  tokens: number
  /** What those tokens would cost at Anthropic's API list prices, in dollars. */
  cost: number
  spawnId?: string
  /** Why it looks stuck ('' when it does not): the same command failing again and again, and the like. */
  stuck: string
  /** Its last tool calls, newest last: what the stuck check reads. */
  recent: { sig: string; ok: boolean; at: number }[]
  /** What it was started for, in its starter's words (a helper: the Agent call's description). */
  job?: string
  /** The Claude that started it (a helper's parent), when known. */
  parent?: string
  /** What it is waiting on the person for (a permission, an answer, a plan to approve), and for which tool. */
  needs?: { what: string; tool: string; at: number }
  /** Its context window as of its last model request: tokens in it and the window's size. */
  ctx?: { tokens: number; window: number; at: number }
  /** How many times its conversation was compacted. */
  compactions?: number
}

/** A compiler or test error that names a file and line. */
export type Problem = {
  path: string
  line: number
  message: string
  /** The command whose output named it, tidied. */
  source: string
  by: string
  hue: number
  at: number
}

/** What one finished task came to: the card the pane shows and copies as Markdown. */
export type Summary = {
  at: number
  goal: string
  ms: number
  files: { path: string; added: number; removed: number }[]
  read: number
  tests: { runs: number; failed: number; last: string }
  tokens: number
  cost: number
  claudes: string[]
  codex: number
  problems: number
}

/** What the crew did to one file this session. */
export type Change = { added: number; removed: number; edits: number; reads: number; by: string; hue: number; at: number }

export type MapNode = {
  /** A normalised file path, or '$terminal', '@web', '?search'. */
  id: string
  label: string
  dir: string
  kind: 'file' | 'ghost' | 'special'
  /** Layout position, 0-1 each way. */
  x: number
  y: number
  heat: number
  /** Node ids this file imports. */
  imports: string[]
  scanned: boolean
  touchedAt: number
  demo?: boolean
}

export type Trail = { a: string; b: string; w: number }

/** One line of the log; 'you' is a message the person sent, 'msg' one another session sent (`who` names it). */
export type LogLine = { at: number; who: string; hue: number; kind: 'act' | 'think' | 'info' | 'you' | 'msg'; text: string; /** All of what a Claude said, when the line is its gist. */ full?: string; /** The tool call it records, and how long that took once done (ms). */ call?: string; took?: number; /** What came of an action, shown when its line is opened: an edit's diff, a command's output tail, an error (capped). */ more?: string; /** The action failed (refused: by a permission rule or the person). */ bad?: true; refused?: true; /** The file an edit changed. */ path?: string; /** A nested chat's line (its app id; `who` is then the chat's name), and the helper there who did it. */ chat?: string; by?: string }

/** One task on Claude Code's task list, as the crew last saw it. */
export type PlanTask = {
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  /** The Claude that made it: its work bar counts it. */
  by: string
  /** What it says while on it ("Running tests"). */
  active?: string
  /** Finished before the person's latest message: not part of the work now. */
  old?: boolean
}

export type Crew = {
  agents: Agent[]
  nodes: Record<string, MapNode>
  trails: Trail[]
  log: LogLine[]
  calls: number
  startedAt: number
  /** Per file path: lines added and removed, reads. */
  changes: Record<string, Change>
  /** The map's size, a multiple of the width the pane's columns suggest. */
  zoom: number
  /** Whether the worked-files list is pinned open under the map. */
  showFiles: boolean
  /** A pretend Codex run the demo shows; empty outside the demo. */
  demoCodex: CodexRun[]
  /** Where a clicked file opens: 'code' (VS Code), 'cursor' or 'system'. Kept in the store across sessions. */
  editor: string
  /** Shell commands (not test runs) running, and those that just ended, newest last. */
  shells?: ShellRun[]
  /** Claude Code's task list (TaskCreate, TaskUpdate, TaskList), by task id. */
  tasks?: Record<string, PlanTask>
  /** Test runs the crew started, newest last. */
  tests: TestRun[]
  /** Errors from the last failing build or test, by file and line. */
  problems: Problem[]
  /** Tokens and dollars the whole session has used: kept here, since old helpers drop off the agent list. */
  spent: { tokens: number; cost: number }
  /** What the whole chat has cost, as Claude Code's own /cost totals it (every reply, helpers' too), when it says. */
  chatCost?: number
  /** Spending limit in dollars (0: none), and the highest share of it already announced. */
  budget: number
  budgetWarned: number
  /** Where the current task started from: its goal, time, and totals then. */
  turnBase: { at: number; goal: string; changes: Record<string, { added: number; removed: number }>; tokens: number; cost: number; tests: number; failed: number; codex: number }
  /** The last finished task's summary, until dismissed. */
  summary: Summary | null
  /** Folders the person folded or unfolded on the map, by folder (relative to the project, '.', or '~outside'). */
  folds?: Record<string, 'open' | 'closed'>
  /** Whether files outside the project are hidden from the map. */
  hideOutside?: boolean
  /** Save the log to the project after each task, not only on the Save button. */
  autoSave?: boolean
  /** A toast when a test run ends ("✓ Tests passed …"); off unless the person turns it on. Kept in the store. */
  testToasts?: boolean
  /** Finished helpers whose windows the person opened again (true) or folded at once (false). */
  unfolded?: Record<string, boolean>
  /** Where the person scrolled the log to (absent: it follows the newest line), and the lines they opened. */
  logView?: { anchor?: number; open?: string[] }
  /** The theme the pane paints for: auto (follows the app), or light or dark as the person chose. */
  theme?: 'auto' | 'light' | 'dark'
  /** The Claude the tree map's camera follows, and the camera's state when following began (moving the map by hand stops it). */
  track?: { id: string; rev: string }
  /** Desks the person opened to read every line whole, by agent. */
  deskOpen?: Record<string, boolean>
  /** Which picture of the work the pane shows: desks and folder cards (absent: desks), or the tree map. */
  view?: 'desks' | 'map'
  /** Folder cards the person opened to show every file (by folder). */
  cardsOpen?: Record<string, boolean>
  /** The viewer: which tab shows (a Claude's details: 'claude' with its id), and how far its list is scrolled. */
  pane?: { tab?: 'activity' | 'files' | 'search' | 'settings' | 'claude'; focus?: string; top?: number }
  /** The chats started from this one (and theirs), as the desktop app lists them: nested under it, by depth. */
  chats?: Chat[]
  /** Whether the pane can read that list by itself; when not, each chat is only as new as Claude's last look at it (`seen`). */
  chatsLive?: boolean
  /**
   * Who holds which identity colour for the whole chat, and since when: a helper by its id, a nested chat
   * as chat:<id>, its helpers as chat:<id>~<their id>. (The main Claude always has colour 0.)
   */
  colors?: Record<string, { i: number; at: number }>
  /** The other chats working in this project (not started from this one), newest first, as the app lists them. */
  siblings?: Chat[]
}

/** A chat started from this one with the app's start_session, or from one of those. */
export type Chat = {
  id: string
  title: string
  name: string
  parent: string
  cwd: string
  branch: string
  running: boolean
  at: number
  depth: number
  /** When this was read from the app (ms). */
  seen?: number
}

/** One test command a Claude ran, and how it came out. */
/** A shell command a Claude ran: shown while it runs, in words (Claude's description, else what it runs). */
export type ShellRun = {
  id: string
  agentId: string
  who: string
  hue: number
  label: string
  startedAt: number
  endedAt: number
  status: 'running' | 'done' | 'failed' | 'stopped' | 'unknown'
  /** Started with run_in_background: it runs on after the call returns, until read, stopped or reported. */
  background: boolean
  /** The background shell's id, to match a later read, stop or task notice to this command. */
  shellId?: string
}

export type TestRun = {
  id: string
  agentId: string
  who: string
  hue: number
  /** The command as shown (shell noise dropped). */
  command: string
  /** What the run is for: Claude's own description of the command, else its kind and targets. */
  purpose?: string
  startedAt: number
  endedAt: number
  status: 'running' | 'passed' | 'failed' | 'unknown'
  /** Counts read from the output, when it gave them. */
  passed: number
  failed: number
  /** Started with run_in_background: the Claude is not blocked on it. */
  background: boolean
  /** The background shell's id, to match later output reads to this run. */
  shellId?: string
}

/**
 * A Codex run as the codex-bridge mod publishes it (its state, read only here):
 * the fields the crew map draws. The bridge owns and writes it.
 */
export type CodexRun = {
  id: string
  task: string
  mode: 'read-only' | 'write'
  root?: string
  cwd?: string
  model: string
  effort: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: number
  endedAt: number
  thread: string
  resumed: boolean
  caller: string
  activity: string
  focus: string
  touched: { path: string; kind: 'look' | 'edit'; at: number }[]
  events: { at: number; kind: string; text: string; ok?: boolean }[]
  files: string[]
  commands: number
  failedCommands: number
  answer: string
  notesUpdated: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'crew-map': {
      crew: Crew
      /** Bumped once a second while something runs, so its timer counts up. */
      tick: number
      /** What the search box holds. */
      search: { q: string }
    }
  }
}
