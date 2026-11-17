// Claude Crew's page: draws the view the mod sends (over /events), and sends each press back to it
// (/act) as the id the mod gave that button. Scrolling the log, opening a long line and the drag line
// are the page's own; everything else is the mod's.
'use strict'
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
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
  const sc = SC[r.state]
  const lead = r.state === 'done' ? `<span class="dot" style="background:${color(r.hue)}"></span>` : r.name === 'Codex' && r.hue === 'cx' ? codexIcon : sprite(r.hue)
  const details = btn(r.details, r.focused ? 'Hide' : 'Details', `u fix${r.focused ? ' text' : ''}`, `${r.focused ? 'Hide' : 'Show'} ${r.name}'s details`)
  const l1 = `<div class="l1">${lead}<span class="fix ${r.state === 'done' ? 'dim' : 'text'}">${esc(r.name)}</span>${icon(r.kind, sc)}<span class="status" style="color:${color(sc)}">${esc(r.status)}</span><span class="cut ${r.state === 'done' ? 'dim' : 'text'}">${esc(r.object)}</span><span class="time${r.state === 'you' ? ' amber' : ''}">${esc(r.time)}</span></div>`
  let more = ''
  if (r.state === 'you') more = `<div class="ask">${esc(r.ask)}</div><div class="l2"><span class="cut dim">${esc(r.where)}</span>${details}</div>`
  else if (r.state !== 'done') {
    const pips = r.total ? `<span class="pips">${Array.from({ length: Math.min(5, r.total) }, (_, k) => `<span class="pip" style="${k < r.done ? `background:${color(sc)};` : ''}${k <= r.done ? `border-color:${color(sc)}` : ''}"></span>`).join('')}</span>` : ''
    more = `<div class="l2">${pips}<span class="cut ${r.stuck ? 'amber' : 'dim'}">${esc(r.progress)}</span>${r.model ? `<span class="fix faint w">${esc(r.model)}</span>` : ''}${details}</div>`
  }
  const indent = r.state === 'you' ? 0 : Math.min(3, r.depth) * 20
  return `<div class="card ${r.state === 'you' ? 'you' : ''} ${r.state === 'done' ? 'done' : ''} ${r.focused ? 'open' : ''}" style="margin-left:${indent}px">${l1}${more}</div>`
}
const drawCrew = () => {
  const rc = V.recap
  const recap = !rc
    ? ''
    : rc.full
      ? `<div class="recap"><div class="l1">${icon('done', 'green', 15, 2)}<span class="fix b">${esc(rc.title)}</span><span class="cut dim">${esc(rc.goal)}</span><span class="time">${esc(rc.ago)}</span></div>${rc.facts.map(([k, v, role]) => `<div class="fact"><span>${esc(k)}</span><span class="cut" style="color:${color(role)}">${esc(v)}</span></div>`).join('')}</div>`
      : `<div class="recap"><span class="dim">${esc(rc.title)}</span></div>${rc.demo ? `<div style="padding-left:12px">${btn(rc.demo, '▶ Try a pretend session', 'u')}</div>` : ''}`
  $('crew').innerHTML = V.rows.map(card).join('') + recap
}

// 3 · Touched
const drawTouched = () => {
  const t = V.touched
  const head = `<div class="row"><span class="b">Touched</span><span class="dim">${esc(t.sum)}</span><span class="grow"></span>${t.open ? btn(t.open, 'Open folder', 'u') : ''}</div>`
  const rows = t.folders.length
    ? t.folders.map(d => `<div class="row"><span class="folder" title="${esc(d.name)}">${esc(d.name)}</span>${d.files.map(f => btn(f.act, `${f.on ? `<span style="color:${color(f.on)}">● </span>` : ''}<span style="color:${f.errs ? 'var(--red)' : f.read ? 'var(--dim)' : 'var(--text)'}">${esc(f.name)}</span>${f.errs ? `<span class="red b"> ✕${f.errs}</span>` : ''}${f.add ? `<span class="green"> ${esc(f.add)}</span>` : ''}${f.del ? `<span class="dim"> ${esc(f.del)}</span>` : ''}`, 'fix')).join('')}${d.more ? btn(t.more, `+${d.more} more`, 'u fix') : ''}</div>`).join('')
    : `<div class="row dim">No files yet. Folders show here as the Claudes open files.</div>`
  $('touched').innerHTML = head + rows
}

// 4 · The viewer
const drawTabs = () => {
  $('tabs').innerHTML = [
    ...V.tabs.map(t => (t.t === '⌕' || t.t === '⚙' ? btn(t.act, uiIcon(t.t === '⌕' ? 'search' : 'settings'), `ib tip-l${t.on ? ' on' : ''}`, t.label) : btn(t.act, esc(t.t), t.on ? 'on' : '', t.label))),
    `<span class="grow"></span>`,
    ...(V.tab === 'activity' && V.logActs
      ? [
          V.logSave?.busy ? `<span class="faint">saving…</span>` : V.logSave?.at ? `<span class="faint w" title="${esc(V.logSave.file)}">saved ${esc(V.logSave.at.slice(0, 5))}</span>` : '',
          btn(V.logActs.copy, uiIcon('copy'), 'ib', 'Copy the whole log as Markdown'),
          btn(V.logActs.download, uiIcon('download'), 'ib', 'Download the log as a .md file'),
          btn(V.logActs.save, uiIcon('save'), 'ib', 'Save the log and a summary into this project'),
          `<span class="sep"></span>`,
        ]
      : []),
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
const logLine = l => {
  const open = opened.has(l.key)
  // A click on the line opens it whole (and again folds it); › marks one with more than it shows.
  return `<div class="ln${l.full ? ' can' : ''}${open ? ' open' : ''}" data-line="${esc(l.key)}"><span class="when">${esc(l.time.slice(0, 5))}${W(esc(l.time.slice(5)))}</span><span style="color:${color(l.dot)}">●</span><span class="who">${esc(l.who)}</span>${icon(l.kind, l.running ? 'green' : 'dim', 13, 1.8)}<span class="cut ${l.thought ? 'thought' : l.dim ? 'dim' : ''}">${esc(l.text)}</span>${l.full ? `<span class="more" aria-hidden="true">${open ? '▾' : '›'}</span>` : ''}<span class="dur${l.running ? ' run' : ''}">${l.running ? '● ' : ''}${esc(l.dur)}</span></div>${open ? `<div class="whole ${l.thought ? 'thought' : ''}">${esc(l.full || l.text)}</div>` : ''}`
}
const seg = g => {
  const lead = `${g.dot ? `<span style="color:${color(g.dot)}">●</span> ` : ''}${g.icon ? icon(g.icon[0], g.icon[1], 13, 1.8) : ''}${g.bar !== undefined && g.bar !== null ? `<svg width="72" height="8" viewBox="0 0 72 8" aria-hidden="true"><rect width="72" height="8" rx="4" fill="var(--line)"/><rect width="${Math.max(8, 72 * Math.min(1, g.bar))}" height="8" rx="4" fill="${color(g.role === 'red' || g.role === 'amber' ? g.role : 'dim')}"/></svg>` : ''}`
  const words = g.parts ? g.parts.map(([t, role]) => `<span style="color:${color(role)}">${esc(t)}</span>`).join('') : esc(g.t)
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
const drawBody = () => {
  const body = $('body')
  if (V.tab === 'settings' && V.settings) {
    // Not while you are typing a budget or picking an editor.
    if (!body.contains(document.activeElement) || document.activeElement === body) body.innerHTML = settingsHtml(V.settings)
    return
  }
  if (V.tab === 'activity') body.innerHTML = V.log.length ? V.log.map(logLine).join('') : `<div class="empty">Nothing yet: each thing a Claude does shows here.</div>`
  else body.innerHTML = V.lines.map(vLine).join('')
  // A line the page's width cuts off can be opened too: marked like the others.
  if (V.tab === 'activity')
    for (const ln of body.querySelectorAll('.ln:not(.can):not(.open)')) {
      const cut = ln.querySelector('.cut')
      if (cut && cut.scrollWidth > cut.clientWidth + 1) {
        ln.classList.add('can')
        cut.insertAdjacentHTML('afterend', '<span class="more" aria-hidden="true">›</span>')
      }
    }
  if (V.tab === 'activity' && following()) body.scrollTop = body.scrollHeight
}
$('body').addEventListener('scroll', () => {
  const body = $('body')
  const was = following()
  stuck = body.scrollHeight - body.scrollTop - body.clientHeight < 24
  if (V && was !== following()) drawTabs()
})
// The page or the drag line changes the log's height: it stays on the newest line if it was there.
new ResizeObserver(() => {
  const body = $('body')
  if (V?.tab === 'activity' && following()) body.scrollTop = body.scrollHeight
}).observe($('body'))
// Narrow, as the design's 450 px board: the shorter words.
new ResizeObserver(([e]) => $('app').classList.toggle('narrow', e.contentRect.width < 520)).observe($('app'))

let lastTab = ''
const draw = () => {
  document.documentElement.dataset.theme = V.theme || 'auto'
  drawHead()
  drawCrew()
  drawTouched()
  drawTabs()
  const body = $('body')
  const fresh = V.tab !== lastTab
  lastTab = V.tab
  drawBody()
  if (fresh) {
    stuck = true
    opened.clear()
    body.scrollTop = V.tab === 'activity' ? body.scrollHeight : 0
  }
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
      drawBody()
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
      opened.clear()
      stuck = true
      drawBody()
      drawTabs()
      body.scrollTop = body.scrollHeight
    } else if (b.dataset.scroll === 'end') body.scrollTop = 0
    else body.scrollBy({ top: b.dataset.scroll === 'up' ? -page : page })
  } else if (b.dataset.budget) {
    send({ set: { budget: Math.max(0, Number($('budget').value) || 0) } })
    $('budget').blur()
  }
})
document.addEventListener('change', ev => {
  if (ev.target.id === 'editor') {
    send({ set: { editor: ev.target.value } })
    ev.target.blur()
  }
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
