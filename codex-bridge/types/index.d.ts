export type RunStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One line of what a Codex run did, newest last. */
export type RunEvent = {
  at: number
  kind: 'say' | 'think' | 'cmd' | 'file' | 'plan' | 'info' | 'error'
  text: string
  /** A command's outcome: undefined while it runs. */
  ok?: boolean
  /** The Codex item this line came from, so a command's line can be updated when it ends. */
  ref?: string
}

/** A file a run read or ran something on ('look'), or changed ('edit'). Absolute, forward slashes. */
export type Touch = { path: string; kind: 'look' | 'edit'; at: number }

export type Run = {
  id: string
  task: string
  mode: 'read-only' | 'write'
  cwd: string
  /** The project root the memory folder lives in (the git top level, else cwd). */
  root: string
  model: string
  effort: string
  status: RunStatus
  startedAt: number
  endedAt: number
  /** Codex's own session id: what continues this conversation. */
  session: string
  /** The named workstream this run belongs to; '' for a one-off. */
  thread: string
  /** The thread's key in threads.json (its name as a slug, made unique). */
  threadKey?: string
  /** True when this run continued an earlier Codex session. */
  resumed: boolean
  /** Who asked: 'main' or a subagent's id (the loop that called the tool). */
  caller: string
  /** What Codex is doing right now, in a few words. */
  activity: string
  /** The file it is on right now, if any (absolute, forward slashes). */
  focus: string
  touched: Touch[]
  events: RunEvent[]
  files: string[]
  commands: number
  failedCommands: number
  answer: string
  tokens: number
  /** True once Codex rewrote its NOTES.md during this run. */
  notesUpdated: boolean
}

/** One rate-limit window of the Codex plan, as Codex last reported it. */
export type Limit = {
  /** Minutes the window spans: 300 is the 5-hour limit, 10080 the weekly one. */
  windowMinutes: number
  usedPercent: number
  /** When the window resets, ms since the epoch (0 if not said). */
  resetsAt: number
}

/** The Codex plan's usage, read from Codex's own session logs. */
export type Usage = {
  plan: string
  limits: Limit[]
  /** When Codex wrote these numbers (the log's time), and when they were read. */
  seenAt: number
  readAt: number
  /** Why there are no numbers, when there are none. */
  missing: string
}

/** A named Codex workstream in a project's .codex-bridge/threads.json. */
export type ThreadInfo = {
  name: string
  session: string
  created: number
  updated: number
  runs: number
  model: string
  effort: string
  last: string
  archived?: boolean
}
export type Registry = Record<string, ThreadInfo>

/** The pane's own controls: which thread is being renamed, which delete awaits a second press. */
export type PaneUi = { renaming: string; confirmDelete: string; showArchived: boolean }

declare module 'claude-code' {
  interface PluginState {
    'codex-bridge': {
      runs: Run[]
      usage: Usage
      /** Each project's thread registry, by project root. */
      threads: Record<string, Registry>
      ui: PaneUi
    }
  }
}
