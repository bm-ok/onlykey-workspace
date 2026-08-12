'use strict'

// The window. Four tabs: Operations, Live, Work, All actions.
//
// The rule it is written against: an answer belongs where the person was already
// looking. Results of a button press appear in the notice bar next to the button,
// a review shows the diff itself rather than a pointer to where it is recorded,
// and anything that looks irreversible says in plain words what will and will not
// happen before it does it.

const ECOSYSTEM = new URLSearchParams(location.search).get('ecosystem') || 'local'

const api = async (name, args = {}) => {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ecosystem: ECOSYSTEM, ...args })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

const keep = kids => kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== '')

const el = (tag, attrs = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), attrs)
  keep(kids).forEach(k => node.append(k))
  return node
}
const $ = id => document.getElementById(id)

// Always use this, never replaceChildren directly.
//
// replaceChildren takes (...Node|string) and does NOT flatten: hand it an array
// and the array is stringified, so a column of cards renders as the literal text
// "[object HTMLDivElement]". Every call here passes lists and single nodes
// interchangeably, so flattening belongs in one place rather than in a spread at
// each call site that someone will forget.
const fill = (node, ...kids) => node.replaceChildren(...keep(kids))

// ---- the notice bar ---------------------------------------------------

let noticeTimer
function say (text, kind = 'ok') {
  const bar = $('notice')
  bar.className = `notice ${kind}`
  fill(bar,
    el('span', { textContent: text }),
    el('button', { className: 'notice-x', textContent: '×', onclick: () => bar.classList.add('hidden') }))
  clearTimeout(noticeTimer)
  if (kind === 'ok') noticeTimer = setTimeout(() => bar.classList.add('hidden'), 6000)
}
const oops = e => say(e.message, 'bad')

// ---- tabs -------------------------------------------------------------

let view = 'ops'
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    view = b.dataset.view
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b))
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`))
    if (view === 'live') clearBadge()
  }
})
const showTab = name => document.querySelector(`.tab[data-view="${name}"]`).click()

// ---- the dialog ------------------------------------------------------
//
// In-page rather than native: under NW.js with nw2 disabled, confirm() and
// <dialog> do not appear, and silently return false -- which cancels the action
// behind them without saying so.

function ask ({ title, plain, cost, fields = [], confirm, danger, onYes }) {
  const errBox = el('p', { className: 'dlg-err hidden' })
  const inputs = {}

  const yes = el('button', { className: `btn ${danger ? 'danger' : 'ok'}`, textContent: confirm })
  const no = el('button', { className: 'btn', textContent: 'Never mind' })

  const overlay = el('div', { className: 'dlg-overlay' },
    el('div', { className: 'dlg' },
      el('div', { className: 'dlg-title', textContent: title }),
      plain && plain.length
        ? el('div', {},
            el('div', { className: 'dlg-heading', textContent: 'What this does' }),
            el('ul', {}, ...plain.map(p => el('li', { textContent: p }))))
        : null,
      cost ? el('div', { className: 'dlg-cost' }, el('strong', { textContent: 'Cannot be undone: ' }), cost) : null,
      ...fields.map(f => {
        const input = el('input', { placeholder: f.placeholder || '', value: f.value || '', type: f.type || 'text' })
        inputs[f.name] = input
        return el('div', {}, el('label', { textContent: f.label }), input)
      }),
      errBox,
      el('div', { className: 'dlg-actions' }, no, yes)))

  const close = () => overlay.remove()
  no.onclick = close
  overlay.onclick = e => { if (e.target === overlay) close() }
  yes.onclick = async () => {
    yes.disabled = true
    try {
      const values = {}
      for (const k in inputs) values[k] = inputs[k].value.trim()
      await onYes(values)
      close()
      await draw()
    } catch (e) {
      errBox.textContent = e.message
      errBox.classList.remove('hidden')
      yes.disabled = false
    }
  }
  document.body.append(overlay)
  const first = Object.values(inputs)[0]
  ;(first || yes).focus()
}

// ---- Operations: machines --------------------------------------------

let picked = null
let latest = { machines: [], vbox: { available: false, vms: [] } }

// The folder the repos live in, worked out rather than configured. If they share
// a parent that is the workspace; if they are scattered, the first one is the best
// guess available and better than refusing to open anything.
let workspaceDir = ''
const parentOf = p => p.replace(/[\\/][^\\/]+[\\/]?$/, '')

// The card carries identity and state; the buttons live in one Actions panel so
// there is a single copy of them rather than a set per row.
const vmCard = v => el('div', {
  className: `card pick${picked === v.name ? ' on' : ''}`,
  onclick: () => { picked = v.name; paintMachines() }
},
  el('div', { className: 'card-title' },
    el('span', { className: 'mono', textContent: v.name }),
    el('span', { className: `badge ${v.running ? 'ok' : ''}`, textContent: v.running ? 'running' : 'off' })))

function machineActions () {
  const box = $('machine-actions')
  const v = latest.vbox.vms.find(x => x.name === picked)
  const go = (name, args, msg) => () => { showTab('live'); api(name, args).then(() => { say(msg); return draw() }).catch(oops) }

  // Opening the editor is about the work, not about a virtual machine, so it is
  // here whether or not one is selected -- and it opens the folder the repos are
  // in, which is the only folder a person on this page is ever asking for.
  const editorButton = el('button', {
    className: 'btn',
    textContent: 'Open the work in VS Code',
    onclick: go('openEditor', { id: 'here', where: workspaceDir }, 'VS Code was asked to open it')
  })

  $('actions-context').textContent = v ? `— ${v.name}` : '— nothing selected'
  if (!v) {
    return fill(box, el('div', { className: 'row' }, editorButton),
      el('p', { className: 'empty', style: 'margin-top:8px', textContent: 'Pick a virtual machine on the left for the rest.' }))
  }

  fill(box, el('div', { className: 'row' },
    editorButton,
    el('button', {
      className: 'btn',
      textContent: v.running ? 'Shut it down' : 'Start it',
      onclick: go(v.running ? 'vmStop' : 'vmStart', { name: v.name }, v.running ? 'Asked it to shut down' : 'Starting it')
    }),
    v.running
      ? el('button', {
          className: 'btn danger',
          textContent: 'Power off',
          onclick: () => ask({
            title: `Pull the power on ${v.name}?`,
            plain: ['This is the plug, not the button.'],
            cost: 'Anything it was part-way through writing may be left unfinished.',
            confirm: 'Power off',
            danger: true,
            onYes: () => api('vmStop', { name: v.name, force: true })
          })
        })
      : null,
    el('button', {
      className: 'btn danger',
      textContent: 'Delete it',
      onclick: () => ask({
        title: `Delete ${v.name}?`,
        plain: ['Nothing in your repositories is affected.'],
        cost: 'The virtual machine and its disks are deleted.',
        confirm: 'Delete it',
        danger: true,
        onYes: () => api('vmRemove', { name: v.name }).then(() => say(`${v.name} deleted`))
      })
    })))
}

function paintMachines () {
  fill($('vms'), latest.vbox.available
    ? (latest.vbox.vms.length
        ? latest.vbox.vms.map(vmCard)
        : el('p', { className: 'empty', textContent: 'VirtualBox is here; no virtual machines yet.' }))
    : el('p', { className: 'empty', textContent: 'VirtualBox was not found. Everything else works without it.' }))
  machineActions()
}

$('add-vm-open').onclick = () => ask({
  title: 'Make a virtual machine',
  plain: [
    'This makes the machine and its disk.',
    'It does not install an operating system — give it an installer image and boot it.',
    'ssh will reach it on the port below once it is running.'
  ],
  fields: [
    { name: 'name', label: 'Name', placeholder: 'dev1' },
    { name: 'memory', label: 'Memory, in MB', value: '4096', type: 'number' },
    { name: 'cpus', label: 'Processors', value: '2', type: 'number' },
    { name: 'diskGb', label: 'Disk, in GB', value: '30', type: 'number' },
    { name: 'sshPort', label: 'ssh port on this machine', value: '2222', type: 'number' },
    { name: 'iso', label: 'Installer image, if you have one', placeholder: 'C:\\path\\to\\ubuntu.iso' }
  ],
  confirm: 'Make it',
  onYes: v => {
    showTab('live')
    return api('vmCreate', {
      vm: {
        name: v.name,
        memory: Number(v.memory) || 4096,
        cpus: Number(v.cpus) || 2,
        diskGb: Number(v.diskGb) || 30,
        sshPort: Number(v.sshPort) || 2222,
        iso: v.iso
      }
    }).then(() => say(`${v.name} created`))
  }
})

// ---- Operations: tasks and what is in flight -------------------------

const taskCard = t => el('div', { className: 'card' },
  el('div', { className: 'card-title', textContent: t.title }),
  t.detail ? el('div', { className: 'card-sub', textContent: t.detail }) : null,
  el('div', { className: 'badges' },
    ...t.repos.map(r => el('span', { className: 'badge', textContent: r })),
    ...t.open.map(o => el('span', { className: 'badge warn', textContent: o.status }))),
  el('div', { className: 'row', style: 'margin-top:8px' },
    el('button', {
      className: 'btn ok',
      textContent: 'Work on this',
      disabled: t.open.length > 0,
      title: t.open.length ? 'Already open' : '',
      onclick: () => ask({
        title: t.title,
        plain: [
          'Work happens in your own copies, on the branch you are already on.',
          'No branch is created and nothing is committed until you accept it.',
          'You can throw the attempt away, and put it back afterwards.'
        ],
        confirm: 'Start',
        onYes: () => api('start', { task: t.id }).then(() => say(`Started "${t.title}"`))
      })
    })))

function inFlightCard (w) {
  const detail = el('div')
  const accept = el('button', { className: 'btn ok', textContent: 'Accept it', disabled: true })

  const load = async () => {
    const r = await api('review', { id: w.id })
    fill(detail, reviewView(r))
    accept.disabled = !r.canAccept
    accept.title = r.canAccept ? '' : `Nothing has changed in ${r.missing.join(' or ')}`
    return r
  }

  accept.onclick = async () => {
    const r = await api('review', { id: w.id })
    ask({
      title: 'Accept this work?',
      plain: [
        `This commits to ${r.parts.map(p => p.repo).join(' and ')} — one commit each, on the branch you are on.`,
        'All of them or none: if any cannot commit, the others are undone.',
        'Nothing is pushed anywhere.'
      ],
      fields: [{ name: 'note', label: 'In one line, what did you check?', placeholder: 'read both diffs, the wording is accurate' }],
      confirm: 'Accept',
      onYes: v => api('accept', { id: w.id, note: v.note }).then(() => say(`Accepted "${w.title}"`))
    })
  }

  const card = el('div', { className: 'card' },
    el('div', { className: 'card-title' }, w.title,
      el('span', { className: `badge ${w.status === 'offered' ? 'run' : ''}`, textContent: w.status })),
    el('div', { className: 'card-sub', textContent: w.repos.join(', ') }),
    el('div', { className: 'row', style: 'margin-top:8px' },
      w.status === 'working'
        ? el('button', {
            className: 'btn',
            textContent: 'I am done — offer it',
            onclick: () => api('offer', { id: w.id }).then(() => { say('Offered for review'); return draw() }).catch(oops)
          })
        : accept,
      el('button', { className: 'btn', textContent: 'What changed?', onclick: () => load().catch(oops) }),
      el('button', {
        className: 'btn danger',
        textContent: 'Throw it away',
        onclick: () => ask({
          title: 'Throw this away?',
          plain: [
            'Your files go back to how they were at the last commit.',
            'It is saved to a patch first, so you can put it back.',
            'Nothing in the history changes — no commit is added, removed or rewritten.'
          ],
          confirm: 'Throw away',
          danger: true,
          onYes: () => api('discard', { id: w.id }).then(() => say('Thrown away, and saved so it can be put back'))
        })
      })),
    detail)

  if (w.status === 'offered') load().catch(() => {})
  return card
}

const reviewView = r => el('div', {},
  ...r.parts.map(p => el('div', { style: 'margin-top:8px' },
    el('div', { className: 'card-title' },
      el('span', { className: 'mono', textContent: p.repo }),
      el('span', { className: `badge ${p.ready ? 'ok' : 'warn'}`, textContent: p.ready ? `${p.files.length} files` : 'nothing yet' })),
    p.ready ? el('pre', { className: 'diff', textContent: [p.files.map(f => `${f.how}  ${f.path}`).join('\n'), '', p.stat].join('\n').trim() }) : null)),
  r.moved.length
    ? el('div', { className: 'dlg-cost', style: 'margin-top:10px' },
        el('strong', { textContent: `${r.moved.join(' and ')} moved underneath this. ` }),
        'Something committed there that this did not do. Nothing will change until that is dealt with.')
    : null,
  r.checksFailed.length
    ? el('div', { className: 'dlg-cost', style: 'margin-top:10px' },
        el('strong', { textContent: 'A check this project asked for did not pass. ' }),
        r.checksFailed.map(c => `${c.repo}: ${c.name}`).join('; '))
    : null)

// ---- Work tab --------------------------------------------------------

let openAttempt = null

function paintWork (items) {
  fill($('work-list'), items.length
    ? items.map(w => el('div', {
        className: `card pick${openAttempt === w.id ? ' on' : ''}`,
        onclick: () => { openAttempt = w.id; drawWorkDetail(w) }
      },
        el('div', { className: 'card-title' }, w.title,
          el('span', {
            className: `badge ${w.status === 'accepted' ? 'ok' : w.status === 'thrown away' ? '' : 'run'}`,
            textContent: w.status
          })),
        el('div', { className: 'card-sub mono', textContent: w.id })))
    : el('p', { className: 'empty', textContent: 'Nothing yet.' }))

  const still = items.find(w => w.id === openAttempt)
  if (still) drawWorkDetail(still)
}

async function drawWorkDetail (w) {
  $('work-detail-title').textContent = w.title
  const box = $('work-detail')
  const bits = [
    el('div', { className: 'panel' },
      el('div', { className: 'card-sub mono', textContent: w.id }),
      el('div', { className: 'badges' },
        el('span', { className: 'badge', textContent: w.status }),
        ...w.repos.map(r => el('span', { className: 'badge', textContent: r }))),
      w.note ? el('div', { className: 'card-sub', textContent: `Reviewed: ${w.note}` }) : null,
      w.landed ? el('div', { className: 'card-sub mono', textContent: w.landed.map(l => `${l.repo} ${l.sha.slice(0, 8)}`).join('  ') }) : null,
      w.status === 'thrown away'
        ? el('div', { className: 'row', style: 'margin-top:8px' },
            el('button', {
              className: 'btn ok',
              textContent: 'Put it back',
              onclick: () => api('putBack', { id: w.id }).then(() => { say('Put back'); return draw() }).catch(oops)
            }))
        : null)
  ]
  fill(box, bits)

  if (w.status === 'working' || w.status === 'offered') {
    try { box.append(reviewView(await api('review', { id: w.id }))) } catch { /* it may have gone */ }
  }
}

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
  fill(box, visible.slice(-800).map(lineNode))
  if (follow) box.scrollTop = box.scrollHeight
  $('live-context').textContent = `— ${visible.length} of ${lines.length} lines`

  const counts = new Map()
  for (const e of lines) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)
  fill($('log-tags'), [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => el('button', {
      className: 'chip' + (off.has(tag) ? '' : ' on'),
      onclick: () => { off.has(tag) ? off.delete(tag) : off.add(tag); paintLog() }
    }, tag, el('b', { textContent: String(n) }))))
}

$('log-follow').onchange = e => { follow = e.target.checked; paintLog() }
$('log-find').oninput = e => { find = e.target.value.trim().toLowerCase(); paintLog() }
$('log-clear').onclick = () => api('logClear').then(() => { lines.length = 0; paintLog() }).catch(oops)

const stream = new EventSource('/api/log/stream')
stream.onopen = () => $('link-dot').classList.add('live')
stream.onerror = () => $('link-dot').classList.remove('live')
stream.onmessage = m => {
  const e = JSON.parse(m.data)
  lines.push(e)
  if (lines.length > 2000) lines.splice(0, lines.length - 2000)
  paintLog()
  if (view !== 'live') {
    unseen++
    if (e.level === 'bad') unseenBad = true
    const badge = $('live-badge')
    badge.textContent = String(unseen)
    badge.className = `tab-badge${unseenBad ? ' bad' : ''}`
  }
}

// ---- draw ------------------------------------------------------------

async function draw () {
  const [data, kit, status] = await Promise.all([api('overview'), api('machines'), api('status')])
  latest = kit
  if (!picked && kit.vbox.vms.length) picked = kit.vbox.vms[0].name

  const parents = [...new Set(data.repos.map(r => parentOf(r.dir)))]
  workspaceDir = parents.length === 1 ? parents[0] : (data.repos[0] && data.repos[0].dir) || ''

  $('ecosystem').textContent = data.ecosystem.name
  $('workspace').textContent = data.ecosystem.file
  $('topright').textContent = `${data.repos.length} repos · one branch`

  const missing = data.repos.filter(r => !r.present)
  $('trouble').classList.toggle('hidden', !missing.length)
  fill($('trouble'), missing.map(r => el('div', {},
    el('strong', { textContent: `${r.name} is not where this project says it is. ` }),
    el('span', { className: 'mono', textContent: r.dir }),
    el('div', { className: 'muted', textContent: 'Tasks that need it will not start.' }))))

  paintMachines()

  $('tasks-context').textContent = `— ${data.tasks.length}`
  fill($('tasks'), data.tasks.length
    ? data.tasks.map(taskCard)
    : el('p', { className: 'empty', textContent: 'This project lists no tasks yet.' }))

  const doing = data.work.filter(w => w.status === 'working' || w.status === 'offered')
  fill($('doing'), doing.length
    ? doing.map(inFlightCard)
    : el('p', { className: 'empty', textContent: 'Nothing in flight. Start a task in the middle column.' }))

  paintWork(data.work)
  if (status.serving && status.serving.error) say(status.serving.error, 'bad')
}

// ---- capture ----------------------------------------------------------
//
// Ctrl+Shift+D copies what is on screen -- the rendered DOM, not the source --
// to the clipboard, and saves the same thing to state/capture.html. Looking at
// what a page actually became beats reading what it was supposed to become.

document.addEventListener('keydown', async e => {
  if (!(e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd'))) return
  e.preventDefault()

  const css = [...document.styleSheets].map(sheet => {
    try { return [...sheet.cssRules].map(r => r.cssText).join('\n') } catch { return '' }
  }).join('\n')

  const html = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>captured</title>\n<style>\n${css}\n</style>\n</head>\n${document.body.outerHTML}\n</html>\n`

  try { await navigator.clipboard.writeText(html) } catch { /* the file still gets written */ }
  try {
    const { file, bytes } = await api('capture', { html })
    say(`Copied to the clipboard, and saved ${bytes} bytes to ${file}`)
  } catch (err) {
    oops(err)
  }
})

paintActions().catch(oops)
draw().catch(e => say(e.message, 'bad'))
