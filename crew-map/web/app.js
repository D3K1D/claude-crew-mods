// Claude Crew's page: draws the view the mod sends (over /events), and sends each press back to it
// (/act) as the id the mod gave that button. Scrolling the log, opening a line, the timers and the drag
// line are the page's own; everything else is the mod's.
//
// Only what changed is drawn again: a band whose part of the view is the same is left alone (so hover,
// a selection and a press in it survive), and the log keeps its lines, adding the new ones at the end.
'use strict'
const $ = id => document.getElementById(id)
// Timers: the mod marks "time since" as <kind><ms> and the page counts them up each second.
const elapsed = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}
const shortTime = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}`
}
const took = ms => (ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : ms < 60_000 ? `${(Math.floor(ms / 100) / 10).toFixed(1)}s` : elapsed(ms))
// e, s, t: as the mod writes them; r: a log line still running (shown from its first second).
const since = (f, from) => {
  const ms = Date.now() - from
  return f === 'e' ? elapsed(ms) : f === 's' ? shortTime(ms) : f === 't' ? took(ms) : ms < 1000 ? '' : `● ${took(ms)}`
}
const timer = (f, from) => `<span data-t="${f}${from}">${since(f, from)}</span>`
const esc = s =>
  String(s ?? '')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    .replace(/([est])(\d+)/g, (_, f, n) => timer(f, Number(n)))
setInterval(() => {
  for (const el of document.querySelectorAll('[data-t]')) {
    const t = since(el.dataset.t[0], Number(el.dataset.t.slice(1)))
    if (el.textContent !== t) el.textContent = t
  }
}, 1000)
const store = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} },
}
const send = msg => fetch('act', { method: 'POST', body: JSON.stringify(msg) }).catch(() => {})

let V = null
const opened = new Set()
const ROLE = { text: 'var(--text)', dim: 'var(--dim)', faint: 'var(--faint)', amber: 'var(--amber)', green: 'var(--green)', red: 'var(--red)', brand: 'var(--brand)', line: 'var(--line)', cx: 'var(--cx)' }
const color = role => ROLE[role] ?? (/^h\d$/.test(role ?? '') ? `var(--${role})` : 'var(--text)')
const SC = { work: 'green', wait: 'dim', you: 'amber', done: 'dim', idle: 'dim' }

// Pictures: a kind's icon, the little Claude, Codex's terminal.
const icon = (kind, role, size = 15, width = 1.9) => {
  const d = V?.icons?.[kind] ?? V?.icons?.tool ?? ''
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${color(role)}" stroke-width="${kind === 'think' ? 2.8 : width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${esc(d)}"/></svg>`
}
const sprite = hue => {
  const f = color(hue)
  return `<svg width="17" height="12" viewBox="-8 -11.5 16 12" aria-hidden="true"><rect x="-7" y="-11" width="14" height="8" rx="1.5" fill="${f}"/><rect x="-8" y="-8.5" width="2" height="2" fill="${f}"/><rect x="6" y="-8.5" width="2" height="2" fill="${f}"/><rect x="-4" y="-9" width="2" height="2.6" fill="var(--eye)"/><rect x="2" y="-9" width="2" height="2.6" fill="var(--eye)"/><rect x="-5.5" y="-3" width="1.6" height="2.6" fill="${f}"/><rect x="-2.3" y="-3" width="1.6" height="2.6" fill="${f}"/><rect x="0.7" y="-3" width="1.6" height="2.6" fill="${f}"/><rect x="3.9" y="-3" width="1.6" height="2.6" fill="${f}"/></svg>`
}
const codexIcon = `<svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="0.75" width="14" height="10.5" rx="2"/><path d="M5 4l2.2 2L5 8M9 8.2h3"/></svg>`
// The page's own buttons: one set of icons, all drawn alike (16-unit strokes, the same size and weight).
const UI = {
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2',
  settings: 'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3',
  up: 'M8 13V3.5M4 7.5l4-4 4 4',
  down: 'M8 3v9.5M4 8.5l4 4 4-4',
  latest: 'M8 2.5v7.5M4.5 6.5 8 10l3.5-3.5M3.5 13.5h9',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
  download: 'M8 2.5v7M5 7l3 3 3-3M3 11.5v2h10v-2',
  save: 'M3 2.5h8l2 2v9H3zM5.5 2.5v3h4.5v-3M5.5 13.5v-4h5v4',
}
const uiIcon = name => `<svg class="ico" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${UI[name]}"/></svg>`
// Words for the wide page, and their shorter form when it is narrow (as the design's 450 px board).
const W = (wide, narrow = '') => `<span class="w">${wide}</span>${narrow ? `<span class="n">${narrow}</span>` : ''}`
// An icon button (class ib) shows its label as a tooltip on hover.
const btn = (act, inner, cls = '', label = '') =>
  act ? `<button class="nb ${cls}" data-act="${esc(act)}"${label ? ` aria-label="${esc(label)}"` : ''}${label && /\bib\b/.test(cls) ? ` data-tip="${esc(label)}"` : ''}>${inner}</button>` : `<span class="${cls}">${inner}</span>`

// 1 · Header
const drawHead = () => {
  const h = V.head
  $('head').innerHTML = [
    `<span class="brand">✻${W(' Claude Crew')}</span>`,
    ...h.counts.map(([t, role, b]) => {
      const m = t.match(/^(\S+ \S+)(.*)$/)
      const words = t.startsWith('·') ? W(esc(t)) : m ? `${esc(m[1])}${W(esc(m[2]))}` : esc(t)
      return `<span style="color:${color(role)};font-weight:${b ? 700 : 400}">${words}</span>`
    }),
    `<span class="grow"></span>`,
    h.cost ? `<span style="color:${color(h.costRole)}">${esc(h.cost)}</span>` : '',
    h.budget ? `<span class="dim">${W(esc(h.budget), esc(h.budget.replace(/^of /, '/ ')))}</span>` : '',
    V.v ? `<span class="faint" title="Claude Crew version">v${esc(V.v)}</span>` : '',
  ].join('')
}

// 2 · The Claudes
const card = r => {
  // A nested chat not read live: its state dim, "as of 13:09" faint, and a tooltip saying why.
  const sc = r.asOf ? 'dim' : SC[r.state]
  const lead = r.state === 'done' ? `<span class="dot" style="background:${color(r.hue)}"></span>` : r.name === 'Codex' && r.hue === 'cx' ? codexIcon : sprite(r.hue)
  const details = btn(r.details, r.focused ? 'Hide' : 'Details', `u fix${r.focused ? ' text' : ''}`, `${r.focused ? 'Hide' : 'Show'} ${r.name}'s details`)
  const l1 = `<div class="l1">${lead}<span class="fix ${r.state === 'done' ? 'dim' : 'text'}">${esc(r.name)}</span>${icon(r.kind, sc)}<span class="status" style="color:${color(sc)}">${esc(r.status)}</span><span class="cut ${r.asOf ? 'faint' : r.state === 'done' ? 'dim' : 'text'}">${esc(r.object)}</span><span class="time${r.state === 'you' ? ' amber' : ''}">${esc(r.time)}</span></div>`
  let more = ''
  if (r.state === 'you') more = `<div class="ask">${esc(r.ask)}</div><div class="l2"><span class="cut dim">${esc(r.where)}</span>${details}</div>`
  else if (r.state !== 'done') {
    // A pip per step, up to 15 (none above): done filled, the one on now ringed. They never shrink: the
    // step's name cuts first, "Step n of m" never; only if even that doesn't fit do the pips go (see fitPips).
    const pips =
      r.total && r.total <= 15
        ? `<span class="pips">${Array.from({ length: r.total }, (_, k) => `<span class="pip" style="${k < r.done ? `background:${color(sc)};` : ''}${k <= r.done ? `border-color:${color(sc)}` : ''}"></span>`).join('')}</span>`
        : ''
    const tone = r.stuck ? 'amber' : 'dim'
    const step = r.stuck ? null : String(r.progress).match(/^(Step \S+ of \S+)(.*)$/)
    const words = step ? `<span class="fix ${tone}">${esc(step[1])}</span><span class="cut ${tone}">${esc(step[2])}</span>` : `<span class="cut ${tone}">${esc(r.progress)}</span>`
    more = `<div class="l2">${pips}${words}${r.model ? `<span class="fix faint w">${esc(r.model)}</span>` : ''}${details}</div>`
  }
  const indent = r.state === 'you' ? 0 : Math.min(3, r.depth) * 20
  return `<div class="card ${r.state === 'you' ? 'you' : ''} ${r.state === 'done' ? 'done' : ''} ${r.focused ? 'open' : ''}" style="margin-left:${indent}px"${r.asOf ? ` title="Not read live. Shown as of ${esc(r.asOf)}; it updates the next time Claude checks."` : ''}>${l1}${more}</div>`
}
const drawCrew = () => {
  const rc = V.recap
  const recap = !rc
    ? ''
    : rc.full
      ? `<div class="recap"><div class="l1">${icon('done', 'green', 15, 2)}<span class="fix b">${esc(rc.title)}</span><span class="cut dim">${esc(rc.goal)}</span><span class="time">${esc(rc.ago)}</span></div>${rc.facts.map(([k, v, role]) => `<div class="fact"><span>${esc(k)}</span><span class="cut" style="color:${color(role)}">${esc(v)}</span></div>`).join('')}</div>`
      : `<div class="recap"><span class="dim">${esc(rc.title)}</span></div>${rc.demo ? `<div style="padding-left:12px">${btn(rc.demo, '▶ Try a pretend session', 'u')}</div>` : ''}`
  $('crew').innerHTML = V.rows.map(card).join('') + recap
  fitPips()
}
// A card whose pips, "Step n of m" and Details don't fit even with the step's name cut away (a page
// narrower than 450, or deep nesting) shows "Step n of m" alone.
const fitPips = () => {
  for (const l2 of $('crew').querySelectorAll('.l2')) if (l2.querySelector('.pips') && l2.scrollWidth > l2.clientWidth + 1) l2.querySelector('.pips').remove()
}

// 3 · Touched
// A nested chat touched the file: the log's chat bubble in its colour, filled while it edits the file now.
const chatMark = m =>
  `<svg width="11" height="11" viewBox="0 0 16 16" fill="${m.fill ? color(m.hue) : 'none'}" stroke="${color(m.hue)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>`
const drawTouched = () => {
  const t = V.touched
  const head = `<div class="row"><span class="b">Touched</span><span class="dim">${esc(t.sum)}${t.nested ? W(esc(t.nested)) : ''}</span><span class="grow"></span>${t.open ? btn(t.open, 'Open folder', 'u') : ''}</div>`
  const rows = t.folders.length
    ? t.folders.map(d => `<div class="row"><span class="folder" title="${esc(d.name)}">${esc(d.name)}</span>${d.files.map(f => btn(f.act, `<span class="tf" title="${esc(f.title ?? f.name)}">${f.on ? `<span style="color:${color(f.on)}">●</span>` : ''}${f.chat ? chatMark(f.chat) : ''}<span style="color:${f.errs ? 'var(--red)' : f.read ? 'var(--dim)' : 'var(--text)'}">${esc(f.name)}</span></span>${f.errs ? `<span class="red b"> ✕${f.errs}</span>` : ''}${f.add ? `<span class="green"> ${esc(f.add)}</span>` : ''}${f.del ? `<span class="dim"> ${esc(f.del)}</span>` : ''}`, 'fix')).join('')}${d.more ? btn(t.more, `+${d.more} more`, 'u fix') : ''}</div>`).join('')
    : `<div class="row dim">No files yet. Folders show here as the Claudes open files.</div>`
  $('touched').innerHTML = head + rows
}

// 4 · The viewer
const drawTabs = () => band('tabs', [V.tabs, V.tab, V.q, following()], paintTabs)
// The log's tools row (Activity only): whose lines and which, clear; the count; copy, download, save.
const KINDS = [
  ['', 'All lines', 'lines'],
  ['nothought', 'No thoughts', 'lines'],
  ['edit', 'Edits', 'edits'],
  ['shell', 'Commands', 'commands'],
  ['bad', 'Failures', 'failures'],
]
const filt = (() => {
  try {
    const f = JSON.parse(store.get('crew.filter') || '{}')
    // Who: '' everyone, '@this' this chat only, 'w:<name>' one of this chat's, 'c:<name>' a nested chat (all of it).
    const who = String(f.who ?? '')
    return { who: who && !/^(@this|[wc]:)/.test(who) ? `w:${who}` : who, kind: KINDS.some(k => k[0] === f.kind) ? f.kind : '' }
  } catch {
    return { who: '', kind: '' }
  }
})()
const filtered = () => !!(filt.who || filt.kind)
const whoOk = l =>
  !filt.who || (filt.who === '@this' ? !l.chat : filt.who.startsWith('c:') ? l.chat === filt.who.slice(2) : !l.chat && l.who === filt.who.slice(2))
const shown = l => whoOk(l) && (!filt.kind || (filt.kind === 'nothought' ? !l.thought : filt.kind === 'bad' ? !!l.bad : l.kind === filt.kind))
// This chat's names (You, Claude, its helpers) and the nested chats' short names, as the Who list offers them.
const whoList = () => {
  const mine = ['You']
  const chats = []
  for (const l of LOG) {
    if (l.chat) chats.includes(l.chat) || chats.push(l.chat)
    else mine.includes(l.who) || mine.push(l.who)
  }
  for (const r of V.rows ?? []) if (!r.id.startsWith('chat-') && !mine.includes(r.name)) mine.push(r.name)
  if (filt.who.startsWith('w:') && !mine.includes(filt.who.slice(2))) mine.push(filt.who.slice(2))
  if (filt.who.startsWith('c:') && !chats.includes(filt.who.slice(2))) chats.push(filt.who.slice(2))
  return { mine, chats }
}
const whoWord = () => (filt.who === '@this' ? 'this chat' : filt.who.slice(2) || 'anyone')
const countHtml = () => {
  const n = LOG.length
  if (!filtered()) return W(`${n} line${n === 1 ? '' : 's'}`)
  const k = LOG.reduce((s, l) => s + (shown(l) ? 1 : 0), 0)
  return W(`${k} of ${n} lines`, `${k}/${n}`)
}
const drawTools = () => {
  const row = $('tools')
  row.hidden = V.tab !== 'activity'
  if (row.hidden) return
  const names = whoList()
  band('toolsWho', [names, filt.who], () => {
    const w = $('fWho')
    const opt = (v, t) => `<option value="${esc(v)}"${filt.who === v ? ' selected' : ''}>${esc(t)}</option>`
    w.innerHTML = [
      opt('', 'Everyone'),
      ...(names.chats.length
        ? [opt('@this', 'This chat only'), `<optgroup label="This chat">`, ...names.mine.map(n => opt(`w:${n}`, n)), `</optgroup><optgroup label="Nested chats">`, ...names.chats.map(n => opt(`c:${n}`, n)), `</optgroup>`]
        : names.mine.map(n => opt(`w:${n}`, n))),
    ].join('')
    w.classList.toggle('on', !!filt.who)
  })
  band('toolsKind', filt.kind, () => {
    const k = $('fKind')
    k.innerHTML = KINDS.map(([v, t]) => `<option value="${v}"${filt.kind === v ? ' selected' : ''}>${t}</option>`).join('')
    k.classList.toggle('on', !!filt.kind)
  })
  band('toolsRest', [filtered(), V.logActs, V.logSave], () => {
    $('toolsRest').innerHTML = [
      filtered() ? `<button class="nb u dim" data-clear="1" aria-label="Clear the filter">${W('✕ clear', '✕')}</button>` : '',
      `<span class="grow"></span>`,
      `<span id="count" class="count"></span>`,
      V.logSave?.busy ? `<span class="faint">saving…</span>` : V.logSave?.at ? `<span class="faint w" title="${esc(V.logSave.file)}">saved ${esc(V.logSave.at.slice(0, 5))}</span>` : '',
      btn(V.logActs.copy, uiIcon('copy'), 'ib', 'Copy the whole log as Markdown'),
      btn(V.logActs.download, uiIcon('download'), 'ib', 'Download the log as a .md file'),
      btn(V.logActs.save, uiIcon('save'), 'ib', 'Save the log and a summary into this project'),
    ].join('')
    last.count = ''
  })
  // The count changes with every line: only its words.
  band('count', [LOG.length, filtered() && LOG.filter(shown).length], () => ($('count').innerHTML = countHtml()))
}
const paintTabs = () => {
  $('tabs').innerHTML = [
    ...V.tabs.map(t => (t.t === '⌕' || t.t === '⚙' ? btn(t.act, uiIcon(t.t === '⌕' ? 'search' : 'settings'), `ib tip-l${t.on ? ' on' : ''}`, t.label) : btn(t.act, esc(t.t), t.on ? 'on' : '', t.label))),
    `<span class="grow"></span>`,
    `<button class="nb ib" data-scroll="up" aria-label="Older" data-tip="Older lines">${uiIcon('up')}${W('older')}</button>`,
    `<button class="nb ib" data-scroll="down" aria-label="Newer" data-tip="Newer lines">${uiIcon('down')}${W('newer')}</button>`,
    V.tab === 'activity' && !following()
      ? `<button class="nb ib wake" data-scroll="end" aria-label="Latest" data-tip="Paused: jump to the newest line and follow it again">${uiIcon('latest')}${W('latest')}</button>`
      : `<button class="nb ib" data-scroll="end" aria-label="Latest" data-tip="The newest line">${uiIcon('latest')}${W('latest')}</button>`,
  ].join('')
  const sr = $('searchRow')
  sr.hidden = V.tab !== 'search'
  const box = $('search')
  if (document.activeElement !== box) box.value = V.q ?? ''
}
// The log as the page holds it: every line it was sent or loaded, oldest first, by key.
const LOG = []
const byKey = new Map()
const sigOf = new Map()
const LOG_MAX = 5000
// All of an opened line, as the mod sent it back (asked for when the line is opened).
const wholeOf = new Map()
// One line of the log, in its wrapper (the line, and all of it below when it is open).
// The box under an opened line: what happened, as rows of a gutter mark, words and a button, at most
// 12 rows of content (a faint row says how many more).
const MAX_ROWS = 12
const row = (t, role, o = {}) =>
  `<div class="br${o.gap ? ' gap' : ''}">${o.g ? `<span class="g" style="color:${color(o.gc ?? 'dim')}">${o.g}</span>` : ''}<span class="bt${o.b ? ' b' : ''}${o.i ? ' i' : ''}" style="color:${color(role)}">${o.html ?? esc(t)}</span>${o.btn ?? ''}</div>`
const faintRow = t => row(t, 'faint', { gap: true })
const boxHtml = l => {
  const got = wholeOf.get(l.key)
  const t = got?.text
  if (l.thought) return [row(t ?? l.text, 'dim', { i: true })]
  if (!l.more) return [row(l.text, 'text')]
  if (t === undefined) return [row('…', 'faint')]
  const lines = t.split('\n')
  const earlier = (s, n) => Number(s?.match(/^… (\d+) earlier lines$/)?.[1] ?? 0) + n
  if (l.kind === 'shell') {
    // $ the command, the last lines of its output, and how it ended.
    const [cmd, ...rest] = lines
    const end = /^(✓|✕|started in the background)/.test(rest[rest.length - 1] ?? '') ? rest.pop() : ''
    const cut = /^… \d+ earlier lines$/.test(rest[0] ?? '') ? rest.shift() : ''
    const out = rest.slice(-MAX_ROWS)
    const before = earlier(cut, rest.length - out.length)
    return [
      row(cmd, 'text', { b: true }),
      ...(before ? [faintRow(`… ${before} earlier lines`)] : []),
      ...out.map((x, i) => row(x, 'dim', { gap: i === 0 && !before })),
      ...(end ? [row(end, end.startsWith('✓') ? 'green' : end.startsWith('✕') ? 'red' : 'faint', { b: true, gap: true })] : []),
      ...(l.run ? [faintRow('Still running: its output shows here when it ends.')] : []),
    ]
  }
  if (l.bad) {
    // What it tried, that it failed, and the error.
    const cut = /^… \d+ earlier lines$/.test(lines[0]) ? lines.shift() : ''
    const err = lines.slice(-MAX_ROWS)
    const before = earlier(cut, lines.length - err.length)
    return [row(l.text, 'text'), row('✕ Failed', 'red', { b: true, gap: true }), ...(before ? [row(`… ${before} earlier lines`, 'faint')] : []), ...err.map(x => row(x, 'text'))]
  }
  const head = lines[0].match(/^(.*) \+(\d+) −(\d+)$/)
  if (head) {
    // An edit: its file, +added −removed, Open diff; the lines it took out and put in.
    const [, path, add, del] = head
    const diff = lines.slice(1)
    const more = /^… \d+ more changed lines$/.test(diff[diff.length - 1] ?? '') ? Number(diff.pop().match(/\d+/)[0]) : 0
    const shownDiff = diff.slice(0, MAX_ROWS)
    const left = more + diff.length - shownDiff.length
    const name = path.split('/').pop()
    return [
      row('', 'text', {
        html: `${W(esc(path), esc(name))} <span class="green">+${add}</span><span class="dim"> −${del}</span>`,
        btn: got.act ? btn(got.act, 'Open diff', 'u fix') : '',
      }),
      ...shownDiff.map((x, i) => (x.startsWith('+ ') ? row(x.slice(2), 'text', { g: '+', gc: 'green', gap: i === 0 }) : row(x.slice(2), 'dim', { g: '−', gap: i === 0 }))),
      ...(left ? [faintRow(`… ${left} more changed lines`)] : []),
    ]
  }
  return lines.slice(0, MAX_ROWS).map(x => row(x, 'text'))
}
// One line of the log, in its wrapper (the line, and its box below when it is open).
const logLine = l => {
  const open = opened.has(l.key)
  // A nested chat's line: a bubble in its colour, its short name (its title on hover), and the helper there first.
  const lead = l.chat
    ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="${color(l.dot)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>`
    : `<span style="color:${color(l.dot)}">●</span>`
  // A click on the line opens it (and again folds it); › marks one with more than it shows.
  return `<div class="lw" data-k="${esc(l.key)}"><div class="ln${l.more ? ' can' : ''}${open ? ' open' : ''}" data-line="${esc(l.key)}"><span class="when">${esc(l.time.slice(0, 5))}<span class="sec">${esc(l.time.slice(5))}</span></span><span class="wcol" title="${l.chat ? `Nested chat: ${esc(l.chatTitle || l.chat)}` : esc(l.who)}"><span class="lead">${lead}</span><span class="who">${esc(l.who)}</span></span>${icon(l.kind, l.run ? 'green' : l.bad ? 'red' : 'dim', 13, 1.8)}<span class="cut ${l.thought ? 'thought' : l.dim ? 'dim' : ''}">${l.by ? `<span class="dim" style="font-style:normal">${esc(l.by)} · </span>` : ''}${esc(l.text)}</span>${l.more ? `<span class="more" aria-hidden="true">${open ? '▾' : '›'}</span>` : ''}${l.run ? `<span class="dur run">${timer('r', l.at)}</span>` : `<span class="dur${l.bad ? ' red' : ''}">${l.bad ? '✕ ' : ''}${esc(l.dur)}</span>`}</div>${open ? `<div class="box${l.bad ? ' bad' : ''}">${boxHtml(l).join('')}</div>` : ''}</div>`
}
// A line the page's width cuts off can be opened too: marked like the others.
const markCut = root => {
  for (const ln of root.querySelectorAll('.ln:not(.can):not(.open)')) {
    const cut = ln.querySelector('.cut')
    if (cut && cut.scrollWidth > cut.clientWidth + 1) {
      ln.classList.add('can')
      cut.insertAdjacentHTML('afterend', '<span class="more" aria-hidden="true">›</span>')
    }
  }
}
const lineEl = k => $('body').querySelector(`.lw[data-k="${CSS.escape(k)}"]`)
// Puts a line's element in by its place in LOG, before the next line that is drawn (or at the end).
const place = (l, i) => {
  const body = $('body')
  body.querySelector('.empty')?.remove()
  let next
  for (let j = i + 1; j < LOG.length && !next; j++) next = lineEl(LOG[j].key)
  if (next) next.insertAdjacentHTML('beforebegin', logLine(l))
  else body.insertAdjacentHTML('beforeend', logLine(l))
  const el = lineEl(l.key)
  if (el) markCut(el)
}
// Draws one line again where it is (it changed, or was opened or folded), or takes it out if the filter hides it now.
const redrawLine = k => {
  const el = lineEl(k)
  const l = byKey.get(k)
  if (!l) return
  if (!shown(l)) return el?.remove()
  if (!el) return place(l, LOG.indexOf(l))
  el.outerHTML = logLine(l)
  const now = lineEl(k)
  if (now) markCut(now)
}
// New and changed lines from the mod: a changed one is drawn again in place, a new one put in by its
// time (nearly always at the end).
const mergeLog = lines => {
  const drawn = bodyMode === 'activity'
  for (const l of lines) {
    const sig = JSON.stringify(l)
    if (byKey.has(l.key)) {
      if (sigOf.get(l.key) === sig) continue
      sigOf.set(l.key, sig)
      // Replaced whole: a mark the line no longer has (run, bad, more) goes with the old one.
      LOG[LOG.indexOf(byKey.get(l.key))] = l
      byKey.set(l.key, l)
      // It finished: what came of it is asked for again if it is open.
      wholeOf.delete(l.key)
      if (opened.has(l.key) && l.more) send({ open: l.key })
      if (drawn) redrawLine(l.key)
      continue
    }
    let i = LOG.length
    while (i > 0 && LOG[i - 1].at > l.at) i--
    LOG.splice(i, 0, l)
    byKey.set(l.key, l)
    sigOf.set(l.key, sig)
    if (drawn && shown(l)) place(l, i)
  }
  // A very long log drops its oldest lines (Load older brings them back).
  while (LOG.length > LOG_MAX) {
    const l = LOG.shift()
    byKey.delete(l.key)
    sigOf.delete(l.key)
    wholeOf.delete(l.key)
    if (drawn) lineEl(l.key)?.remove()
    older = 'idle'
  }
}
// ── The log's columns: Time | Who | What | Took, sized by dragging the bars between them (as Explorer's
// details view), kept per browser for the wide page and the narrow one. What takes the rest, never under 120.
const COLS = { time: [40, 100], who: [12, 200], took: [36, 100] }
const COL_DEFAULT = { wide: { time: 62, who: 72, took: 60 }, narrow: { time: 40, who: 72, took: 60 } }
const colBar = (col, label) => `<span class="bar" data-col="${col}" role="separator" aria-orientation="vertical" aria-label="Resize ${label}" tabindex="0"><i></i></span>`
const COL_HEAD = `<div id="colHead" class="colhead"><span class="h-time">Time</span>${colBar('time', 'Time')}<span class="h-who">Who</span>${colBar('who', 'Who')}<span class="h-what">What</span>${colBar('took', 'Took')}<span class="h-took">Took</span></div>`
const cols = { ...COL_DEFAULT.wide }
let colSet = ''
const colKey = () => `crew.cols.${colSet}`
// What has left: the log's width less the three columns and the three 8px gaps between the four.
const whatRoom = () => $('body').clientWidth - 8 - cols.time - cols.who - cols.took - 24
const showCols = () => {
  const b = $('body')
  for (const k of Object.keys(COLS)) b.style.setProperty(`--c-${k}`, `${cols[k]}px`)
  b.classList.toggle('short-time', cols.time < 62)
  b.classList.toggle('no-name', cols.who < 40)
}
// Within the limits, and What never under 120: Who gives way first, then Time, then Took.
const fitCols = () => {
  for (const [k, [lo, hi]] of Object.entries(COLS)) cols[k] = Math.round(Math.min(hi, Math.max(lo, Number(cols[k]) || lo)))
  if ($('body').clientWidth > 0) for (const k of ['who', 'time', 'took']) cols[k] = Math.max(COLS[k][0], cols[k] - Math.max(0, 120 - whatRoom()))
  showCols()
}
// The wide page's widths, or the narrow one's (each kept apart).
const loadCols = () => {
  const set = $('app').classList.contains('narrow') ? 'narrow' : 'wide'
  if (set === colSet) return fitCols()
  colSet = set
  let saved = {}
  try {
    saved = JSON.parse(store.get(colKey()) || '{}') ?? {}
  } catch {}
  for (const k of Object.keys(COLS)) cols[k] = Number.isFinite(saved[k]) ? saved[k] : COL_DEFAULT[set][k]
  fitCols()
}
const sizeCol = (col, w) => {
  const [lo, hi] = COLS[col]
  // Wider only as far as What keeps 120.
  cols[col] = Math.round(Math.max(lo, Math.min(hi, w, w > cols[col] ? cols[col] + Math.max(0, whatRoom() - 120) : w)))
  showCols()
}
const saveCols = () => {
  store.set(colKey(), JSON.stringify(cols))
  if (bodyMode === 'activity') remark()
}
// Its column fitted to the widest value among the loaded lines (one character of this font is as wide as any).
const fitCol = col => {
  const probe = document.createElement('span')
  probe.textContent = '0000000000'
  $('body').append(probe)
  const ch = probe.getBoundingClientRect().width / 10 || 7
  probe.remove()
  const chars = col === 'time' ? 8 : Math.max(1, ...LOG.map(l => (col === 'who' ? l.who.length : (l.run ? 9 : (l.bad ? 2 : 0) + String(l.dur).length))))
  sizeCol(col, Math.ceil(chars * ch) + (col === 'who' ? 20 : 2))
  saveCols()
}
document.addEventListener('pointerdown', ev => {
  const b = ev.target.closest?.('.colhead .bar')
  if (!b) return
  ev.preventDefault()
  b.setPointerCapture(ev.pointerId)
  const col = b.dataset.col
  const head = $('colHead')
  b.classList.add('drag')
  head?.classList.add(`drag-${col}`)
  const x0 = ev.clientX
  const w0 = cols[col]
  // (Took's bar sizes the column to its right: dragging left makes it wider.)
  const move = e => sizeCol(col, w0 + (col === 'took' ? x0 - e.clientX : e.clientX - x0))
  const up = () => {
    b.classList.remove('drag')
    head?.classList.remove(`drag-${col}`)
    b.removeEventListener('pointermove', move)
    b.removeEventListener('pointerup', up)
    b.removeEventListener('pointercancel', up)
    saveCols()
  }
  b.addEventListener('pointermove', move)
  b.addEventListener('pointerup', up)
  b.addEventListener('pointercancel', up)
})
document.addEventListener('dblclick', ev => {
  const b = ev.target.closest?.('.colhead .bar')
  if (b) fitCol(b.dataset.col)
})
document.addEventListener('keydown', ev => {
  const b = ev.target.closest?.('.colhead .bar')
  if (!b) return
  const col = b.dataset.col
  if (ev.key === 'Enter') fitCol(col)
  else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
    ev.preventDefault()
    // The bar moves 8px: right widens the column on its left, narrows Took on its right.
    sizeCol(col, cols[col] + (ev.key === 'ArrowRight' ? 8 : -8) * (col === 'took' ? -1 : 1))
    saveCols()
  }
})
// The log whole: its column header, its Load older row, then the lines the filter shows (or why there are none).
const renderLog = () => {
  const body = $('body')
  const lines = LOG.filter(shown)
  const none = LOG.length
    ? `<div class="empty">No ${KINDS.find(k => k[0] === filt.kind)[2]} from ${esc(whoWord())} in the last ${LOG.length} lines.</div>`
    : EMPTY
  body.innerHTML = `${COL_HEAD}<div id="olderRow" class="older"></div>${lines.length ? lines.map(logLine).join('') : none}`
  last.older = ''
  drawOlder()
  markCut(body)
}
// Load older: the journal on disk has the lines before the page's oldest. Only on a press.
let older = 'idle'
const savedLeft = () => {
  // The mod counts what is saved before the oldest line it sends; lines the page kept from before then are not left.
  const from = V.log[0]?.at ?? Infinity
  let had = 0
  while (had < LOG.length && LOG[had].at < from) had++
  return Math.max(0, (V.older?.left ?? 0) - had)
}
const drawOlder = () => {
  const el = $('olderRow')
  if (!el) return
  const left = older === 'end' ? 0 : savedLeft()
  band('older', [older, left, V.older?.first, LOG[0]?.time], () => {
    el.hidden = !LOG.length
    el.innerHTML =
      older === 'asking'
        ? `<span class="cut faint">Loading older lines…</span>`
        : left
          ? `<button class="nb ib u text" data-older="1">${uiIcon('up')}${W('Load 200 older', '200 older')}</button><span class="cut faint">${W(`${left} more saved, back to ${esc(V.older.first)}${LOG.some(l => l.chat) ? ' · from every chat' : ''}`, `${left} more, back to ${esc(V.older.first)}`)}</span>`
          : `<span class="cut faint">Start of this chat · ${esc(LOG[0]?.time ?? '')}</span>`
  })
}
const askOlder = () => {
  if (older === 'asking' || !LOG.length) return
  older = 'asking'
  drawOlder()
  send({ older: LOG[0].at })
  // No answer (the mod was busy, or reloaded): the button comes back.
  setTimeout(() => {
    if (older !== 'asking') return
    older = 'idle'
    drawOlder()
  }, 8000)
}
const addOlder = x => {
  if (older !== 'asking' || !LOG.length || x.before !== LOG[0].at) return
  const fresh = x.lines.filter(l => !byKey.has(l.key))
  older = x.end ? 'end' : 'idle'
  for (const l of fresh) {
    byKey.set(l.key, l)
    sigOf.set(l.key, JSON.stringify(l))
  }
  LOG.unshift(...fresh)
  if (bodyMode !== 'activity') return
  // Kept where it was: the lines go in above what you were reading.
  const body = $('body')
  const h = body.scrollHeight
  const top = body.scrollTop
  renderLog()
  body.scrollTop = top + body.scrollHeight - h
  drawTools()
}
const seg = g => {
  const lead = `${g.dot ? `<span style="color:${color(g.dot)}">●</span> ` : ''}${g.icon ? icon(g.icon[0], g.icon[1], 13, 1.8) : ''}${g.bar !== undefined && g.bar !== null ? `<svg width="72" height="8" viewBox="0 0 72 8" aria-hidden="true"><rect width="72" height="8" rx="4" fill="var(--line)"/><rect width="${Math.max(8, 72 * Math.min(1, g.bar))}" height="8" rx="4" fill="${color(g.role === 'red' || g.role === 'amber' ? g.role : 'dim')}"/></svg>` : ''}`
  const words = (g.parts ? g.parts.map(([t, role]) => `<span style="color:${color(role)}">${esc(t)}</span>`).join('') : esc(g.t)) + (g.tail ? W(esc(g.tail)) : '')
  const cls = [g.b ? 'b' : '', g.i ? 'i' : '', g.u ? 'u' : '', g.flex ? 'cut' : 'fix'].join(' ')
  const style = `${g.parts ? '' : `color:${color(g.role)};`}${g.w ? `width:${g.w}ch;overflow:hidden;text-overflow:ellipsis;` : ''}`
  if (!lead && !words) return ''
  return g.act ? `<button class="nb ${cls}" style="${style}" data-act="${esc(g.act)}"${g.label ? ` aria-label="${esc(g.label)}"` : ''}>${lead}${words}</button>` : `<span class="${cls}" style="${style}display:flex;align-items:center;gap:6px">${lead}<span class="${g.flex ? 'cut' : ''}">${words}</span></span>`
}
const vLine = l => `<div class="vl" style="padding-left:${l.indent || 0}ch">${l.segs.map(seg).join('')}${l.right.length ? `<span class="right">${l.right.map(seg).join('')}</span>` : ''}</div>`
// Settings, as the design has them: the theme, a budget you type, the editor from a list.
const settingsHtml = s => {
  const row = (label, inner) => `<div class="set"><span class="lab">${label}</span>${inner}</div>`
  const choice = (t, on, act) => btn(act, esc(t), on ? 'on' : '')
  const editors = [['code', 'VS Code'], ['cursor', 'Cursor'], ['system', 'default app']]
  return [
    row('Theme', s.themes.map(o => choice(o.t, o.on, o.act)).join('')),
    row('Budget', `<span>$</span><input id="budget" type="number" min="0" step="1" value="${s.budget || ''}" placeholder="none" aria-label="Budget in dollars"><button class="nb u" data-budget="1">set</button><span class="faint cut">${s.budget ? 'warns at 50, 80, 100%' : 'no budget set'}</span>`),
    row('Open files in', `<select id="editor" aria-label="Open files in">${editors.map(([v, t]) => `<option value="${v}"${s.editor === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`),
    row('Outside files', choice('shown', !s.hideOutside, s.outside[0]) + choice('hidden', s.hideOutside, s.outside[1])),
    row('Save log', choice('when I press Save', !s.autoSave, s.autoActs[0]) + choice('after each task', s.autoSave, s.autoActs[1]) + `<span class="faint cut w">to .claude/crew-logs, with a summary</span>`),
    row('Demo', s.demoOn ? '<span class="dim">a pretend session is playing</span>' : btn(s.demo, '▶ try a pretend session', 'u')),
    `<div class="faint" style="margin-top:12px">Claude Crew ${esc(s.version)}</div>`,
  ].join('')
}
// The log follows the newest line (at the bottom), as a terminal does, while you are at the bottom and
// no line is open; scrolling up or opening a line pauses it. ⤓ latest (lit while paused) follows again.
let stuck = true
const following = () => stuck && !opened.size
// What #body holds now: 'activity' (the log, kept and added to), or another tab's lines, drawn whole when they change.
let bodyMode = ''
const drawBody = () => {
  const body = $('body')
  if (V.tab === 'settings' && V.settings) {
    // Not while you are typing a budget or picking an editor.
    if (!body.contains(document.activeElement) || document.activeElement === body) band('body', ['settings', V.settings], () => (body.innerHTML = settingsHtml(V.settings)))
    bodyMode = 'settings'
    return
  }
  if (V.tab !== 'activity') {
    band('body', [V.tab, V.lines], () => (body.innerHTML = V.lines.map(vLine).join('')))
    bodyMode = 'lines'
    return
  }
  if (bodyMode !== 'activity') {
    bodyMode = 'activity'
    last.body = ''
    mergeLog(V.log)
    renderLog()
  } else {
    const was = LOG.length
    mergeLog(V.log)
    // The first line came: the empty word goes, the Load older row shows.
    if (!was && LOG.length) renderLog()
    drawOlder()
  }
  if (following()) body.scrollTop = body.scrollHeight
}
$('body').addEventListener('scroll', () => {
  const body = $('body')
  stuck = body.scrollHeight - body.scrollTop - body.clientHeight < 24
  if (V) drawTabs()
})
// The page or the drag line changes the log's height: it stays on the newest line if it was there.
// A new width cuts other lines: their › is set again.
// (So does a column sized.)
const remark = () => {
  const body = $('body')
  for (const ln of body.querySelectorAll('.ln.can:not(.open)'))
    if (!byKey.get(ln.dataset.line)?.more) {
      ln.classList.remove('can')
      ln.querySelector('.more')?.remove()
    }
  markCut(body)
}
let logW = 0
new ResizeObserver(() => {
  const body = $('body')
  if (body.clientWidth !== logW) {
    logW = body.clientWidth
    loadCols()
    if (bodyMode === 'activity') remark()
  }
  if (V?.tab === 'activity' && following()) body.scrollTop = body.scrollHeight
}).observe($('body'))
// Narrow, as the design's 450 px board: the shorter words, and the narrow page's column widths.
new ResizeObserver(([e]) => {
  $('app').classList.toggle('narrow', e.contentRect.width < 520)
  loadCols()
  // The cards again, so pips that went for want of room come back when there is room.
  if (V) {
    last.crew = ''
    band('crew', [V.rows, V.recap], drawCrew)
  }
}).observe($('app'))

// A band is drawn again only when its part of the view changed.
const last = {}
const band = (id, data, paint) => {
  const k = JSON.stringify(data)
  if (last[id] === k) return
  last[id] = k
  paint()
}
let lastTab = ''
const draw = () => {
  const theme = V.theme || 'auto'
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme
  band('head', [V.head, V.v], drawHead)
  band('crew', [V.rows, V.recap], drawCrew)
  band('touched', V.touched, drawTouched)
  const body = $('body')
  const fresh = V.tab !== lastTab
  lastTab = V.tab
  if (fresh) {
    stuck = true
    opened.clear()
    bodyMode = ''
  }
  drawBody()
  drawTabs()
  drawTools()
  if (fresh) body.scrollTop = V.tab === 'activity' ? body.scrollHeight : 0
}
// A filter picked or cleared: kept for next time, and the log drawn again with it.
const setFilter = f => {
  Object.assign(filt, f)
  store.set('crew.filter', filtered() ? JSON.stringify(filt) : null)
  if (bodyMode === 'activity') renderLog()
  drawTools()
  if (following()) $('body').scrollTop = $('body').scrollHeight
}

// Presses
document.addEventListener('click', ev => {
  // A log line: opened whole, or folded again (not when you were selecting its words).
  const ln = ev.target.closest('.ln')
  if (ln && !ev.target.closest('button') && !String(window.getSelection?.() ?? '')) {
    const k = ln.dataset.line
    const cut = ln.querySelector('.cut')
    if (opened.has(k) || ln.classList.contains('can') || (cut && cut.scrollWidth > cut.clientWidth + 1)) {
      opened.has(k) ? opened.delete(k) : opened.add(k)
      // All of it comes from the mod (an action's diff or output, a thought whole), asked for the first time.
      if (opened.has(k) && byKey.get(k)?.more && !wholeOf.has(k)) send({ open: k })
      redrawLine(k)
      drawTabs()
    }
    return
  }
  const b = ev.target.closest('button')
  if (!b) return
  if (b.dataset.act) send({ id: b.dataset.act })
  else if (b.dataset.scroll) {
    const body = $('body')
    const page = Math.max(19, body.clientHeight - 38)
    if (b.dataset.scroll === 'end' && V?.tab === 'activity') {
      const was = [...opened]
      opened.clear()
      for (const k of was) redrawLine(k)
      stuck = true
      drawTabs()
      body.scrollTop = body.scrollHeight
    } else if (b.dataset.scroll === 'end') body.scrollTop = 0
    else body.scrollBy({ top: b.dataset.scroll === 'up' ? -page : page })
  } else if (b.dataset.budget) {
    send({ set: { budget: Math.max(0, Number($('budget').value) || 0) } })
    $('budget').blur()
  } else if (b.dataset.older) askOlder()
  else if (b.dataset.clear) setFilter({ who: '', kind: '' })
})
document.addEventListener('change', ev => {
  if (ev.target.id === 'editor') {
    send({ set: { editor: ev.target.value } })
    ev.target.blur()
  } else if (ev.target.id === 'fWho') setFilter({ who: ev.target.value })
  else if (ev.target.id === 'fKind') setFilter({ kind: ev.target.value })
})
document.addEventListener('keydown', ev => {
  if (ev.target.id === 'budget' && ev.key === 'Enter') document.querySelector('[data-budget]')?.click()
})
let typing
$('search').addEventListener('input', ev => {
  clearTimeout(typing)
  typing = setTimeout(() => send({ search: ev.target.value }), 150)
})
$('search').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') send({ search: ev.target.value, next: true })
})

// The drag line: the top's height, kept for next time; a double-click gives it back to the Claudes.
const topEl = $("top")
const grip = $('grip')
const setTop = px => {
  if (px === null) {
    topEl.classList.remove('sized')
    topEl.style.height = ''
  } else {
    topEl.classList.add('sized')
    topEl.style.height = `${px}px`
  }
}
const saved = Number(store.get('crew.topH'))
if (saved > 0) setTop(saved)
grip.addEventListener('pointerdown', ev => {
  ev.preventDefault()
  grip.setPointerCapture(ev.pointerId)
  grip.classList.add('drag')
  const y0 = ev.clientY
  const h0 = topEl.getBoundingClientRect().height
  const move = e => {
    const max = document.getElementById('app').clientHeight - 24 - 120
    setTop(Math.round(Math.max(60, Math.min(max, h0 + e.clientY - y0))))
  }
  const up = () => {
    grip.classList.remove('drag')
    grip.removeEventListener('pointermove', move)
    grip.removeEventListener('pointerup', up)
    store.set('crew.topH', String(Math.round(topEl.getBoundingClientRect().height)))
  }
  grip.addEventListener('pointermove', move)
  grip.addEventListener('pointerup', up)
})
grip.addEventListener('dblclick', () => {
  setTop(null)
  store.set('crew.topH', null)
})

// The view, live from the mod
const events = new EventSource('events')
events.onmessage = ev => {
  try {
    V = JSON.parse(ev.data)
  } catch {
    return
  }
  $('gone').hidden = true
  draw()
}
// The mod's answers to what this page asked: all of an opened line, or older lines.
events.addEventListener('reply', ev => {
  let x
  try {
    x = JSON.parse(ev.data)
  } catch {
    return
  }
  if (x.open && byKey.has(x.open.key)) {
    wholeOf.set(x.open.key, { text: x.open.text || byKey.get(x.open.key).text, act: x.open.act || '' })
    if (opened.has(x.open.key)) redrawLine(x.open.key)
  }
  if (x.older) addOlder(x.older)
})
// The whole log as Markdown, from the mod: copied, or saved as a file.
const showText = text => {
  const box = $('copybox')
  box.querySelector('textarea').value = text
  box.hidden = false
  box.querySelector('textarea').select()
}
events.addEventListener('export', ev => {
  let x
  try {
    x = JSON.parse(ev.data)
  } catch {
    return
  }
  if (x.how === 'download') {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([x.text], { type: 'text/markdown' }))
    a.download = x.name || 'claude-crew-log.md'
    document.body.append(a)
    a.click()
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000)
  } else
    navigator.clipboard?.writeText(x.text).then(
      () => flash('Log copied as Markdown'),
      () => showText(x.text),
    ) ?? showText(x.text)
})
const flash = text => {
  const f = $('flash')
  f.textContent = text
  f.hidden = false
  clearTimeout(flash.t)
  flash.t = setTimeout(() => (f.hidden = true), 1800)
}
$('copybox').querySelector('button').addEventListener('click', () => ($('copybox').hidden = true))
events.onerror = () => {
  if (events.readyState !== EventSource.OPEN) $('gone').hidden = false
}
// Back after Claude reopened (or the mod reloaded): load the page afresh, in case the mod was updated.
let lost = false
events.addEventListener('error', () => (lost = true))
events.onopen = () => {
  if (lost) location.reload()
  $('gone').hidden = true
}
