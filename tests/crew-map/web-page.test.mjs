// The page's own script (web/app.js), run in Node with a stand-in for the browser: views come in as
// the server sends them, and what the page keeps of the log is checked. (Its drawing is the browser's;
// here the elements are stand-ins that take what they are given.)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const APP = process.env.CREW_APP || fileURLToPath(new URL('../../crew-map/web/app.js', import.meta.url))
let fails = 0
const check = (label, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`)
}
const el = (find = true) => ({
  innerHTML: '',
  outerHTML: '',
  textContent: '',
  hidden: false,
  value: '',
  style: { setProperty() {} },
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {},
  // (The page asks only its own boxes for a child by tag; a line it looks for is not drawn here.)
  querySelector: sel => (find && !/\[data-k=|\.lw|\.ln|\.empty|olderRow/.test(sel) ? el(false) : null),
  querySelectorAll: () => [],
  insertAdjacentHTML() {},
  remove() {},
  contains: () => false,
  getBoundingClientRect: () => ({ height: 0 }),
  setPointerCapture() {},
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 400,
  clientWidth: 800,
})
const els = new Map()
const sent = []
let source
const context = {
  document: {
    getElementById: id => els.get(id) ?? els.set(id, el()).get(id),
    documentElement: { dataset: {} },
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: el,
    body: el(),
    activeElement: null,
  },
  window: { getSelection: () => '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async (path, o) => (sent.push({ path, body: JSON.parse(o?.body ?? '{}') }), {}),
  EventSource: class {
    constructor() {
      this.on = {}
      source = this
    }
    addEventListener(name, fn) {
      this.on[name] = fn
    }
  },
  ResizeObserver: class {
    observe() {}
  },
  CSS: { escape: s => s },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearTimeout() {},
  location: { reload() {} },
  navigator: {},
  URL,
  Blob: class {},
  console,
}
vm.createContext(context)
// The script's own names (const at its top level) are read through what it is given at its end.
vm.runInContext(`${readFileSync(APP, 'utf8')}\n;globalThis.__page = { LOG, byKey, filt, shown, cols, sizeCol, loadCols, card, vLine, projectHtml, setV: v => (V = v) }`, context)
const page = context.__page
const view = log => ({
  v: 'test',
  theme: 'dark',
  icons: {},
  head: { counts: [], cost: '', costRole: 'text', budget: '' },
  rows: [],
  recap: null,
  touched: { sum: '', open: '', more: '', folders: [] },
  tabs: [],
  tab: 'activity',
  q: '',
  settings: null,
  log,
  older: { left: 0, first: '' },
  logActs: { copy: 'c', download: 'd', save: 's' },
  logSave: { busy: false, at: '', file: '', summary: false },
  lines: [],
})
const push = log => source.onmessage({ data: JSON.stringify(view(log)) })
const line = (key, o = {}) => ({ key, at: Number(key.split(':')[0]), time: '10:00:00', dot: 'h0', who: 'Claude', kind: 'shell', text: 'Build the app', dur: '', ...o })

try {
  // Running, then finished: the line is the one line, and no longer running.
  push([line('1:a', { run: true, more: true })])
  check('a running line comes in', page.LOG.length === 1 && page.byKey.get('1:a')?.run === true)
  push([line('1:a', { more: true, dur: '1.2s' })])
  check('finished: the same line, no longer running', page.LOG.length === 1 && !page.byKey.get('1:a').run && page.byKey.get('1:a').dur === '1.2s', JSON.stringify(page.byKey.get('1:a')))
  check('...and the log holds that line itself, not the old one', page.LOG[0] === page.byKey.get('1:a'))
  // Failed: marked bad, still one line (its key did not change).
  push([line('1:a', { more: true, dur: '1.2s' }), line('2:b', { run: true })])
  push([line('1:a', { more: true, dur: '1.2s' }), line('2:b', { bad: true, more: true, dur: '5.0s' })])
  check('a call that fails stays one line, marked bad, not running', page.LOG.length === 2 && page.byKey.get('2:b').bad === true && !page.byKey.get('2:b').run)
  // A mark taken away goes too (a view that drops `bad`, `more`).
  push([line('1:a', { dur: '1.2s' }), line('2:b', { bad: true, more: true, dur: '5.0s' })])
  check('a mark the line no longer has goes', page.byKey.get('1:a').more === undefined)
  // A nested chat renamed: its lines keep their keys (the mod keys them by the chat's id), so the page
  // takes the new name on the same line rather than a second copy.
  push([line('3:c', { chat: 'docs', who: 'docs', text: 'Edited a.md' })])
  push([line('3:c', { chat: 'docs-build', who: 'docs-build', text: 'Edited a.md' })])
  check('a renamed nested chat: one line, with the new name', page.LOG.filter(l => l.key === '3:c').length === 1 && page.byKey.get('3:c').who === 'docs-build')
  // Lines in a view that come out of order take their place by time.
  push([line('0:z', { text: 'Earlier' }), line('4:d')])
  check('a line from earlier goes in by its time', page.LOG.map(l => l.key).join(',') === '0:z,1:a,2:b,3:c,4:d', page.LOG.map(l => l.key).join(','))
  // The filter: failures only, then one nested chat.
  Object.assign(page.filt, { kind: 'bad' })
  check('failures only: just the failed line', page.LOG.filter(page.shown).map(l => l.key).join(',') === '2:b')
  Object.assign(page.filt, { kind: '', who: 'c:docs-build' })
  check('one nested chat: just its lines', page.LOG.filter(page.shown).map(l => l.key).join(',') === '3:c')
  // Older lines: asked for on Load older, put in before the oldest, only once.
  Object.assign(page.filt, { who: '' })
  source.on.reply({ data: JSON.stringify({ older: { before: 0, lines: [line('-1:y')], end: true } }) })
  check('older lines the page did not ask for are not taken', !page.byKey.has('-1:y'))
  // Columns: their limits, and What keeps 120 (the log here is 800 wide).
  page.loadCols()
  check('the columns start at 62 / 96 / 60', page.cols.time === 62 && page.cols.who === 96 && page.cols.took === 60, JSON.stringify(page.cols))
  page.sizeCol('who', 500)
  check('a column stops at its largest (Who 200)', page.cols.who === 200)
  page.sizeCol('time', 10)
  check('and at its smallest (Time 40)', page.cols.time === 40)
  page.sizeCol('took', 100)
  page.sizeCol('who', 72)
  context.document.getElementById('body').clientWidth = 300
  page.loadCols()
  check('a narrow log keeps What at 120: Who gives way first', 300 - 8 - page.cols.time - page.cols.who - page.cols.took - 24 >= 120 && page.cols.who < 72 && page.cols.time === 40, JSON.stringify(page.cols))
  context.document.getElementById('body').clientWidth = 800
  page.loadCols()
  check('with room again, a column that gave way is back at its width', page.cols.who === 72 && page.cols.took === 100, JSON.stringify(page.cols))
  // A card's context bar: 24 wide, filled to its share (3 at least), dim, amber from 60%, red from 85%;
  // an empty slot when not known; none on a done line. The time sits in its fixed slot after it.
  page.setV(view([]))
  const row = o => ({ id: 'x', name: 'Scout', hue: 'h1', state: 'work', kind: 'edit', status: 'Writing code', object: 'a.js', time: '7m', total: 0, done: 0, progress: '', model: '', depth: 1, details: 'd', ...o })
  const bar = html => (html.match(/<span class="ctx"[^>]*>(.*?)<\/span>/) ?? [])[0] ?? ''
  check('a context bar at 40%: dim, 10 of 24 filled, says how full', /width="10"[^>]*fill="var\(--dim\)"/.test(bar(page.card(row({ ctx: 40 })))) && /title="Context 40% full"/.test(bar(page.card(row({ ctx: 40 })))), bar(page.card(row({ ctx: 40 }))))
  check('...amber from 60%, red from 85% with "compacts soon"', /var\(--amber\)/.test(bar(page.card(row({ ctx: 71 })))) && /var\(--red\)/.test(bar(page.card(row({ ctx: 90 })))) && /compacts soon/.test(bar(page.card(row({ ctx: 90 })))))
  check('...at 0% still 3 wide', /width="3"/.test(bar(page.card(row({ ctx: 0 })))))
  check('not known: the empty slot, so the bars line up', bar(page.card(row({ ctx: -1 }))) === '<span class="ctx"></span>')
  check('a done line: no bar, no slot', !page.card(row({ state: 'done', ctx: 40 })).includes('class="ctx"'))
  check('the bar comes right before the time', /class="ctx"[\s\S]*?<\/span><span class="time">7m<\/span>/.test(page.card(row({ ctx: 40 }))))
  // Details: a Claude under the one shown, one button that opens its Details.
  const dr = page.vLine({ segs: [], right: [], row: { hue: 'h3', chat: false, name: 'Atlas', state: 'work', status: 'Running tests', object: 'npm test', done: 1, total: 3, time: '6m', depth: 1, act: 'a7' } })
  check('a helper in Details: one button with its colour, name, state, what, pips and time', /^<button class="nb dr" style="--d:1" data-act="a7"/.test(dr) && dr.includes('background:var(--h3)') && />Atlas</.test(dr) && />Running tests</.test(dr) && dr.includes('class="pips"') && />6m</.test(dr), dr.slice(0, 200))
  const dc = page.vLine({ segs: [], right: [], row: { hue: 'h2', chat: true, name: 'docs-build', state: 'done', status: 'Done', object: '', done: 0, total: 0, time: '', depth: 0, act: 'a8' } })
  // Waiting on its helpers or chats: the wait colour (indigo) on its status and pips; other waits stay grey.
  const waiting = page.card(row({ state: 'wait', kind: 'wait', status: 'Waiting', object: 'for Scout', helpers: true, total: 3, done: 1 }))
  check('waiting on helpers: status and pips in the wait colour', /class="status" style="color:var\(--wait\)"/.test(waiting) && /background:var\(--wait\)/.test(waiting), waiting.slice(0, 300))
  check('waiting on something else (a command): grey', /class="status" style="color:var\(--dim\)"/.test(page.card(row({ state: 'wait', kind: 'wait', status: 'Waiting', object: 'for npm test' }))))
  check('...and a chat not read live stays grey', /class="status" style="color:var\(--dim\)"/.test(page.card(row({ state: 'wait', status: 'Waiting', helpers: true, asOf: '13:09' }))))
  check('a Details row waiting on helpers: the wait colour', page.vLine({ segs: [], right: [], row: { hue: 'h1', name: 'Scout', state: 'wait', helpers: true, status: 'Waiting', object: 'for Atlas', done: 0, total: 0, time: '', depth: 0, act: 'a9' } }).includes('color:var(--wait)'))
  check("a section's title gets the space above it", /^<div class="vl gh"/.test(page.vLine({ head: true, segs: [{ t: 'Steps', b: true, role: 'dim' }], right: [] })))
  // ── The other chats in this project ──
  const sib = (id, o = {}) => ({ id: `chat-${id}`, name: `Chat ${id}`, title: `Chat ${id}: a long title for it`, hue: 'h3', state: 'idle', kind: 'idle', status: 'Idle', object: '', time: '', total: 0, done: 0, progress: 'main · game', model: '', depth: 0, details: `d${id}`, idle: true, ago: '2h', plain: true, ...o })
  const busy = [sib('a', { state: 'you', idle: false, status: 'Needs you', ask: 'Allow this?', where: 'its own chat · answer there' }), sib('b', { state: 'work', idle: false, status: 'Writing code', object: 'a.js', ctx: 30, plain: false })]
  page.setV({ ...view([]), project: [...busy, ...['c', 'd', 'e', 'f', 'g'].map(x => sib(x))] })
  let ph = page.projectHtml()
  check('a group under "This project", its counts in state colours', /data-proj="1" aria-expanded="true">▾ This project/.test(ph) && /color:var\(--amber\)">1 needs you/.test(ph) && /color:var\(--green\)">1 working/.test(ph) && /5 idle/.test(ph), ph.slice(0, 400))
  check('...a card for each one at work or needing you (its title whole in the tooltip, not pinned: no indent, amber)', /class="card you/.test(ph) && /title="Chat b: a long title for it">Chat b</.test(ph) && /its own chat · answer there/.test(ph))
  check('...the idle ones as dim lines with a hollow dot, 3 of them, then "+2 idle"', (ph.match(/class="pidle"/g) ?? []).length === 3 && /class="hdot"><\/span>/.test(ph) && />\+2 idle</.test(ph) && /<span class="w">last active <\/span>2h ago/.test(ph), ph.slice(-600))
  page.setV({ ...view([]), project: ['c', 'd'].map(x => sib(x)) })
  ph = page.projectHtml()
  check('all idle: folded to its title', /aria-expanded="false">▸ This project/.test(ph) && !/pidle/.test(ph), ph)
  // Their lines: only while the Who list picks the project or one of its chats.
  const own = line('9:own')
  const theirs = line('9:proj', { chat: 'Chat b', proj: 'b' })
  Object.assign(page.filt, { who: '', kind: '' })
  check("Everyone: this chat's lines, not the project's", page.shown(own) && !page.shown(theirs))
  Object.assign(page.filt, { who: 'p:*' })
  check('Whole project: its lines only', page.shown(theirs) && !page.shown(own))
  Object.assign(page.filt, { who: 'p:b' })
  check('...one chat in it: its lines', page.shown(theirs))
  Object.assign(page.filt, { who: 'p:c' })
  check('...another: not these', !page.shown(theirs))
  Object.assign(page.filt, { who: 'c:Chat b' })
  check('a nested-chat pick never shows a project chat of the same name', !page.shown(theirs))
  Object.assign(page.filt, { who: '' })
  check('a nested chat: its bubble; done is dim', dc.includes('stroke="var(--h2)"') && dc.includes('class="nb dr done"'), dc.slice(0, 200))
} catch (err) {
  check(`no crash: ${String(err?.stack ?? err).slice(0, 400)}`, false)
}
console.log(`${fails} failing check(s)`)
process.exit(fails ? 1 : 0)
