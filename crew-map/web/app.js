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
const btn = (act, inner, cls = '', label = '') => (act ? `<button class="nb ${cls}" data-act="${esc(act)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>` : `<span class="${cls}">${inner}</span>`)

// 1 · Header
const drawHead = () => {
  const h = V.head
  $('head').innerHTML = [
    `<span class="brand">✻ Claude Crew</span>`,
    ...h.counts.map(([t, role, b]) => `<span style="color:${color(role)};font-weight:${b ? 700 : 400}">${esc(t)}</span>`),
    `<span class="grow"></span>`,
    h.cost ? `<span style="color:${color(h.costRole)}">${esc(h.cost)}</span>` : '',
    h.budget ? `<span class="dim">${esc(h.budget)}</span>` : '',
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
    more = `<div class="l2">${pips}<span class="cut ${r.stuck ? 'amber' : 'dim'}">${esc(r.progress)}</span>${r.model ? `<span class="fix faint">${esc(r.model)}</span>` : ''}${details}</div>`
  }
  const indent = r.state === 'you' ? 0 : Math.min(3, r.depth) * 20
  return `<div class="card ${r.state === 'you' ? 'you' : ''} ${r.state === 'done' ? 'done' : ''} ${r.focused ? 'open' : ''}" style="margin-left:${indent}px">${l1}${more}</div>`
}
const drawCrew = () => {
  const rc = V.recap
  const recap = !rc
    ? ''
    : rc.copy
      ? `<div class="recap"><div class="l1">${icon('done', 'green', 15, 2)}<span class="fix b">${esc(rc.title)}</span><span class="cut dim">${esc(rc.goal)}</span><span class="time">${esc(rc.ago)}</span></div>${rc.facts.map(([k, v, role]) => `<div class="fact"><span>${esc(k)}</span><span class="cut" style="color:${color(role)}">${esc(v)}</span></div>`).join('')}</div><div style="padding-left:12px"><button class="nb u" data-copy="1">Copy as Markdown</button></div>`
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
    ...V.tabs.map(t => btn(t.act, esc(t.t), t.on ? 'on' : '', t.label)),
    `<span class="grow"></span>`,
    `<button class="nb" data-scroll="up">▲ older</button>`,
    `<button class="nb" data-scroll="down">▼ newer</button>`,
    `<button class="nb" data-scroll="end">⤓ latest</button>`,
  ].join('')
  const sr = $('searchRow')
  sr.hidden = V.tab !== 'search'
  const box = $('search')
  if (document.activeElement !== box) box.value = V.q ?? ''
}
const logLine = l => {
  const open = opened.has(l.key)
  return `<div class="ln"><span class="when">${esc(l.time)}</span><span style="color:${color(l.dot)}">●</span><span class="who" title="${esc(l.who)}">${esc(l.who)}</span>${icon(l.kind, l.running ? 'green' : 'dim', 13, 1.8)}<span class="cut ${l.thought ? 'thought' : l.dim ? 'dim' : ''}" title="${esc(l.full || l.text)}">${esc(l.text)}</span>${l.full ? `<button class="nb" data-open="${esc(l.key)}" aria-label="${open ? 'Fold the line' : 'Show the whole line'}">${open ? '▾' : '›'}</button>` : ''}<span class="dur${l.running ? ' run' : ''}">${l.running ? '● ' : ''}${esc(l.dur)}</span></div>${open ? `<div class="whole ${l.thought ? 'thought' : ''}">${esc(l.full)}</div>` : ''}`
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
const drawBody = () => {
  const body = $('body')
  const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24
  if (V.tab === 'activity') body.innerHTML = V.log.length ? V.log.map(logLine).join('') : `<div class="empty">Nothing yet: each thing a Claude does shows here.</div>`
  else body.innerHTML = V.lines.map(vLine).join('')
  if (V.tab === 'activity' && atEnd) body.scrollTop = body.scrollHeight
}

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
  if (fresh) body.scrollTop = V.tab === 'activity' ? body.scrollHeight : 0
}

// Presses
document.addEventListener('click', ev => {
  const b = ev.target.closest('button')
  if (!b) return
  if (b.dataset.act) send({ id: b.dataset.act })
  else if (b.dataset.open) {
    opened.has(b.dataset.open) ? opened.delete(b.dataset.open) : opened.add(b.dataset.open)
    drawBody()
  } else if (b.dataset.scroll) {
    const body = $('body')
    const page = Math.max(19, body.clientHeight - 38)
    if (b.dataset.scroll === 'end') body.scrollTop = V?.tab === 'activity' ? body.scrollHeight : 0
    else body.scrollBy({ top: b.dataset.scroll === 'up' ? -page : page })
  } else if (b.dataset.copy && V?.recap?.copy) {
    navigator.clipboard?.writeText(V.recap.copy).then(
      () => { b.textContent = 'Copied' ; setTimeout(() => (b.textContent = 'Copy as Markdown'), 1500) },
      () => { b.textContent = "Couldn't copy here" },
    )
  }
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
events.onerror = () => {
  if (events.readyState !== EventSource.OPEN) $('gone').hidden = false
}
events.onopen = () => ($('gone').hidden = true)
