'use strict'

// The log, and every action the server has.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- All actions -----------------------------------------------------

async function paintActions () {
  const { actions } = await api('actions')
  fill($('action-list'), actions.map(a => el('div', { className: 'act' },
    el('code', { textContent: a.name }),
    el('span', { className: 'about', textContent: a.about }),
    el('span', { className: 'takes', textContent: a.takes.length ? a.takes.join(', ') : '' }))))
}

// ---- Live ------------------------------------------------------------

const lines = []
const off = new Set()
let follow = true
let find = ''
let unseen = 0
let unseenBad = false

const clearBadge = () => {
  unseen = 0
  unseenBad = false
  $('live-badge').classList.add('hidden')
}

const shown = e => !e.tags.some(t => off.has(t)) &&
  (!find || e.text.toLowerCase().includes(find) || e.tags.some(t => t.includes(find)))

const lineNode = e => el('div', { className: `line ${e.level}` },
  el('span', { className: 't', textContent: e.at.slice(11, 19) }),
  el('span', { className: 'g', textContent: e.tags.join(' ') }),
  el('span', { className: 'm', textContent: e.text }))

function paintLog () {
  const box = $('live')
  const visible = lines.filter(shown)
  const slice = visible.slice(-800)

  // An entry never changes after it is logged, so the ids in view say exactly
  // what is drawn. Worth guarding twice over: this runs per line rather than per
  // poll, and refilling the box also sent the scrollback to the top, so reading
  // anything above the fold during an install was impossible.
  if (changed('log', slice.map(e => e.id))) {
    fill(box, slice.map(lineNode))
    if (follow) box.scrollTop = box.scrollHeight
  } else if (follow) {
    box.scrollTop = box.scrollHeight
  }

  setText($('live-context'), `— ${visible.length} of ${lines.length} lines`)

  const counts = new Map()
  for (const e of lines) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (!changed('logTags', [ordered, [...off].sort()])) return

  fill($('log-tags'), ordered
    .map(([tag, n]) => el('button', {
      className: 'chip' + (off.has(tag) ? '' : ' on'),
      onclick: () => { off.has(tag) ? off.delete(tag) : off.add(tag); paintLog() }
    }, tag, el('b', { textContent: String(n) }))))
}

$('log-follow').onchange = e => { follow = e.target.checked; paintLog() }
$('log-find').oninput = e => { find = e.target.value.trim().toLowerCase(); paintLog() }
$('log-clear').onclick = () => api('logClear').then(() => { lines.length = 0; paintLog() }).catch(oops)

// Anything that happened to a machine may have changed what the list should say --
// a guest reporting in, a machine starting, one being deleted from elsewhere. It
// was only guest lines before, so a machine deleted by another client sat in the
// list looking alive until something else forced a redraw.
//
// Debounced, because creating a machine logs a couple of dozen lines in a second
// and each one would otherwise mean asking VirtualBox for the whole list again.
let refreshSoon
const refresh = () => {
  clearTimeout(refreshSoon)
  refreshSoon = setTimeout(() => draw().catch(() => {}), 400)
}

function onLine (e) {
  lines.push(e)
  if (lines.length > 2000) lines.splice(0, lines.length - 2000)
  paintLog()

  if (e.tags.includes('vm') || e.tags.includes('guest')) refresh()

  if (view !== 'live') {
    unseen++
    if (e.level === 'bad') unseenBad = true
    const badge = $('live-badge')
    badge.textContent = String(unseen)
    badge.className = `tab-badge${unseenBad ? ' bad' : ''}`
  }
}

// Says so in the same log as everything else, which also proves the window and the
// server are sharing one node context rather than each holding its own copy.
liveLog.on('window').good('window opened')

// Everything already logged, then everything from here on.
lines.push(...liveLog.all())
paintLog()
liveLog.subscribe(onLine)
$('link-dot').classList.add('live')
