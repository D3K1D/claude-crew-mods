// Nested chats through the real engine: the pane asks whether the app's session list may be read
// without asking anyone, reads it, and draws the chats this one started as rows; its own read is not
// one of Claude's actions in the log.
import { test, expect, mock } from 'claude-code/testing'

const LIST = 'mcp__ccd_session_mgmt__list_sessions'
const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'crew-map',
    props: { title: 'Claude Crew', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 80 }, view: {} },
  }) as never
const family = [
  { sessionId: 'local_kid', title: 'Optimus M9', cwd: 'C:\\work\\game', isArchived: false, isRunning: true, lastActivityAt: '2031-01-01T09:59:00Z', name: 'm9', startedBy: 'local_me' },
  { sessionId: 'local_grand', title: 'Optimus lead programmer', cwd: 'C:\\work\\game', isArchived: false, isRunning: false, lastActivityAt: '2031-01-01T09:50:00Z', name: 'lead', startedBy: 'local_kid' },
]

for (const allowed of [true, false]) {
  test(`nested chats, the read ${allowed ? 'allowed' : 'needing approval'}`, async ($, on) => {
    mock.clock(on, { now: Date.parse('2031-01-01T10:00:00Z') })
    mock.env(on, { OS: 'Windows_NT' })
    let reads = 0
    on('tool.check' as never, async (_$: unknown, e: any) => ({ decision: e.tool === LIST ? (allowed ? 'allow' : 'ask') : 'allow' }) as never)
    on('tool.call', async (_$: unknown, e: any) => {
      if (e.tool === LIST) {
        reads++
        return { result: { content: [{ type: 'text', text: JSON.stringify(family) }] }, text: JSON.stringify(family) } as never
      }
      return { result: { text: 'ok' } } as never
    })
    on('session.start', async () => ({ cwd: 'C:/work/game' }) as never)
    on('command.register', async () => ({ value: true }) as never)
    on('session.cwd', async () => ({ value: 'C:/work/game' }) as never)
    on('ui.open', async () => ({ value: true }) as never)
    await $.session.start({ source: 'startup', cwd: 'C:/work/game' } as never)
    for (let i = 0; i < 5 && allowed && !reads; i++) await new Promise(r => setTimeout(r, 50))
    const ui = await $.ui.mount({ plugin: 'crew-map', surface: 'terminal', ...PANE(100) })
    const drawn = JSON.stringify(await ui.drawn())
    if (allowed) {
      expect(reads, 'the list was read').toBeGreaterThan(0)
      expect(drawn.includes('Optimus M9') && drawn.includes('Optimus lead programmer'), 'a row for each nested chat').toBe(true)
      expect(/list_sessions|Listed sessions/i.test(drawn), "the pane's own read is not in the log").toBe(false)
    } else {
      expect(reads, 'never read when it would ask someone').toBe(0)
      expect(drawn.includes('Optimus M9'), 'no rows').toBe(false)
    }
    await ui.unmount()
  })
}
