// The crew's starting value, in a file of its own that imports nothing: every file that declares the
// crew's atom needs it as the module loads, before the files that import each other have.
import type { Crew } from '../types'

/** A chat's crew before anything happened. */
export const EMPTY: Crew = {
  agents: [],
  log: [],
  calls: 0,
  startedAt: 0,
  changes: {},
  demoCodex: [],
  editor: 'code',
  tests: [],
  problems: [],
  budget: 0,
  budgetWarned: 0,
  turnBase: { at: 0, goal: '', changes: {}, tokens: 0, cost: 0, tests: 0, failed: 0, codex: 0 },
  summary: null,
  spent: { tokens: 0, cost: 0 },
}
