'use strict'

// The page. Three tabs: the loop, the machines, the live log.
//
// The rule it is written against: an answer belongs where the person was already
// looking. A review shows the diff itself rather than linking to where it is
// recorded, a refusal says what to do about it where it happened, and anything
// that looks irreversible states in plain words what will and will not happen.

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

const el = (tag, attrs = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), attrs)
  kids.flat().filter(k => k !== null && k !== undefined && k !== false).forEach(k => node.append(k))
  return node
}

const $ = id => document.getElementById(id)
const val = id => $(id).value.trim()
const oops = e => alert(e.message)

// ---- tabs -------------------------------------------------------------

document.querySelectorAll('#tabs button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b))
    document.querySelectorAll('.tab').forEach(t => { t.hidden = t.dataset.tab !== b.dataset.tab })
  }
})

// ---- the plain-words dialog -------------------------------------------

const ask = ({ title, plain, confirm, needNote, onYes }) => {
  const dlg = $('ask')
  $('ask-title').textContent = title
  $('ask-body').replaceChildren(el('ul', {}, ...plain.map(line => el('li', { textContent: line }))))

  const note = $('ask-note')
  const error = $('ask-error')
  const yes = $('ask-yes')
  $('ask-note-wrap').hidden = !needNote
  note.value = ''
  error.hidden = true
  yes.textContent = confirm
  yes.disabled = false

  yes.onclick = async () => {
    yes.disabled = true
    try {
      await onYes(note.value)
      dlg.close()
      await draw()
    } catch (e) {
      error.textContent = e.message
      error.hidden = false
      yes.disabled = false
    }
  }
  $('ask-no').onclick = () => dlg.close()
  dlg.showModal()
  if (needNote) note.focus()
}

// ---- the loop ---------------------------------------------------------

const PLAIN_START = [
  'Work happens in your own copies, on the branch you are already on.',
  'Nothing is committed until you accept it.',
  'You can throw the whole attempt away, and put it back afterwards.'
]

const changeView = r => el('div', { className: 'what' },
  ...r.parts.map(p => [
    el('div', {},
      el('b', { textContent: p.repo }),
      el('span', {
        className: 'tag ' + (p.ready ? 'go' : 'warn'),
        textContent: p.ready ? `${p.files.length} file${p.files.length === 1 ? '' : 's'}` : 'nothing yet'
      })),
    p.ready ? el('pre', { textContent: [p.files.map(f => `${f.how}  ${f.path}`).join('\n'), '', p.stat].join('\n').trim() }) : null
  ]),
  r.moved.length
    ? el('div', { className: 'note' },
        el('b', { textContent: `${r.moved.join(' and ')} moved underneath this attempt` }),
        el('div', { textContent: 'Something committed there that this did not do. Nothing will be changed until that is dealt with.' }))
    : null,
  r.checksFailed.length
    ? el('div', { className: 'note' },
        el('b', { textContent: 'A check this project asked for did not pass' }),
        ...r.checksFailed.map(c => el('div', { textContent: `${c.repo}: ${c.name}${c.why ? ' — ' + c.why : ''}` })))
    : null)

function doingCard (w) {
  const body = el('div')
  const accept = el('button', { textContent: 'Accept it' })

  const showReview = async () => {
    const r = await api('review', { id: w.id })
    body.replaceChildren(changeView(r))
    accept.disabled = !r.canAccept
    accept.title = r.canAccept ? '' : `Nothing has changed in ${r.missing.join(' or ')}`
  }

  accept.onclick = async () => {
    const r = await api('review', { id: w.id })
    ask({
      title: 'Accept this work?',
      plain: [
        `This commits to ${r.parts.map(p => p.repo).join(' and ')} — one commit each, on the branch you are on.`,
        'All of them, or none: if any cannot commit, the others are undone.',
        'Nothing is pushed anywhere.',
        'This is the step that makes it official.'
      ],
      confirm: 'Accept',
      needNote: true,
      onYes: note => api('accept', { id: w.id, note })
    })
  }

  const row = el('div', { className: 'row' },
    w.status === 'working'
      ? el('button', { textContent: 'I am done — offer this', onclick: () => api('offer', { id: w.id }).then(draw).catch(oops) })
      : accept,
    el('button', { className: 'quiet', textContent: 'Show me what changed', onclick: () => showReview().catch(oops) }),
    el('button', {
      className: 'quiet',
      textContent: 'Throw it away',
      onclick: () => ask({
        title: 'Throw this away?',
        plain: [
          'Your files go back to how they were at the last commit.',
          'It is saved to a file first, so you can put it back.',
          'Nothing in the history changes — no commit is added, removed or rewritten.'
        ],
        confirm: 'Throw away',
        onYes: () => api('discard', { id: w.id })
      })
    }))

  const card = el('div', { className: 'card' },
    el('h4', { textContent: w.title }),
    el('p', { textContent: `${w.repos.length} ${w.repos.length === 1 ? 'repository' : 'repositories'} · ${w.status}` }),
    ...w.where.map(p => el('div', { className: 'where', textContent: `${p.at} (${p.branch})` })),
    row, body)

  if (w.status === 'offered') showReview().catch(() => {})
  return card
}

const taskCard = t => el('div', { className: 'card' },
  el('h4', { textContent: t.title }),
  t.detail ? el('p', { textContent: t.detail }) : null,
  el('p', { textContent: `${t.repos.length} ${t.repos.length === 1 ? 'repository' : 'repositories'}: ${t.repos.join(', ')}` }),
  el('div', { className: 'row' },
    el('button', {
      textContent: 'Work on this',
      disabled: t.open.length > 0,
      title: t.open.length ? 'This is already open' : '',
      onclick: () => ask({ title: t.title, plain: PLAIN_START, confirm: 'Start', onYes: () => api('start', { task: t.id }) })
    }),
    ...t.open.map(o => el('span', { className: 'tag warn', textContent: `already ${o.status}` }))))

const pastCard = w => el('div', { className: 'card' },
  el('h4', { textContent: w.title }),
  el('p', { textContent: w.status === 'accepted' ? `Accepted — ${w.note}` : 'Thrown away' }),
  w.status === 'thrown away'
    ? el('div', { className: 'row' }, el('button', {
        className: 'quiet',
        textContent: 'Put it back',
        onclick: () => api('putBack', { id: w.id }).then(draw).catch(oops)
      }))
    : null)

// ---- machines ---------------------------------------------------------

function machineCard (m, vms) {
  const vm = m.vm && vms.vms.find(v => v.name === m.vm.name)

  const row = el('div', { className: 'row' },
    el('button', { textContent: 'Open in VS Code', onclick: () => api('openEditor', { id: m.id }).then(() => showTab('log')).catch(oops) }),
    el('button', { className: 'quiet', textContent: 'Set it up', onclick: () => { showTab('log'); api('provision', { id: m.id }).catch(oops) } }),
    el('button', { className: 'quiet', textContent: 'Can I reach it?', onclick: () => { showTab('log'); api('machineReach', { id: m.id }).catch(oops) } }),
    vm
      ? el('button', {
          className: 'quiet',
          textContent: vm.running ? 'Shut it down' : 'Start it',
          onclick: () => { showTab('log'); api(vm.running ? 'vmStop' : 'vmStart', { name: vm.name }).then(draw).catch(oops) }
        })
      : null,
    m.fixed
      ? null
      : el('button', {
          className: 'quiet',
          textContent: 'Remove',
          onclick: () => ask({
            title: `Remove "${m.name}"?`,
            plain: [
              'This forgets the machine here.',
              'Nothing on the machine itself is touched, and no virtual machine is deleted.'
            ],
            confirm: 'Remove',
            onYes: () => api('machineRemove', { id: m.id })
          })
        }))

  return el('div', { className: 'card' },
    el('h4', {}, m.name,
      vm ? el('span', { className: vm.running ? 'on-dot' : 'off-dot', textContent: vm.running ? ' ● running' : ' ○ off' }) : ''),
    el('p', { textContent: m.kind === 'ssh' ? `over ssh · ${m.host}` : 'this machine' }),
    m.path ? el('div', { className: 'where', textContent: m.path }) : null,
    el('p', { className: 'dim', textContent: `${m.provision ? m.provision.length : 0} setup step${(m.provision || []).length === 1 ? '' : 's'}${m.vm ? ` · virtual machine "${m.vm.name}"` : ''}` }),
    row)
}

const vmCard = v => el('div', { className: 'card' },
  el('h4', {}, v.name, el('span', { className: v.running ? 'on-dot' : 'off-dot', textContent: v.running ? ' ● running' : ' ○ off' })),
  el('p', { className: 'dim', textContent: v.uuid }),
  el('div', { className: 'row' },
    el('button', {
      textContent: v.running ? 'Shut it down' : 'Start it',
      onclick: () => { showTab('log'); api(v.running ? 'vmStop' : 'vmStart', { name: v.name }).then(draw).catch(oops) }
    }),
    v.running
      ? el('button', {
          className: 'quiet',
          textContent: 'Power off',
          onclick: () => ask({
            title: `Pull the power on ${v.name}?`,
            plain: ['This is the plug, not the button.', 'Anything it was part-way through writing may be left unfinished.'],
            confirm: 'Power off',
            onYes: () => api('vmStop', { name: v.name, force: true })
          })
        })
      : null,
    el('button', {
      className: 'quiet',
      textContent: 'Delete',
      onclick: () => ask({
        title: `Delete ${v.name}?`,
        plain: [
          'This deletes the virtual machine and its disks.',
          'It cannot be undone from here.',
          'Nothing in your repositories is affected.'
        ],
        confirm: 'Delete it',
        onYes: () => api('vmRemove', { name: v.name })
      })
    })))

$('m-kind').onchange = e => { $('m-host-wrap').hidden = e.target.value !== 'ssh' }

$('m-add').onclick = () => api('machineAdd', {
  machine: {
    name: val('m-name'),
    kind: $('m-kind').value,
    host: val('m-host'),
    path: val('m-path'),
    editor: val('m-editor'),
    vm: val('m-vm') ? { name: val('m-vm') } : null
  }
}).then(() => { $('add-machine').open = false; return draw() }).catch(oops)

$('vm-add').onclick = () => {
  showTab('log')
  api('vmCreate', {
    vm: {
      name: val('vm-name'),
      memory: Number(val('vm-memory')) || 4096,
      cpus: Number(val('vm-cpus')) || 2,
      diskGb: Number(val('vm-disk')) || 30,
      sshPort: Number(val('vm-ssh')) || 2222,
      iso: val('vm-iso')
    }
  }).then(() => { $('add-vm').open = false; return draw() }).catch(oops)
}

const showTab = name => document.querySelector(`#tabs button[data-tab="${name}"]`).click()

// ---- the live log -----------------------------------------------------
//
// One stream you narrow, rather than several you correlate. The filters are built
// from the tags actually present, so a new tag anywhere shows up here without
// being registered.

const lines = []
const off = new Set()
let follow = true
let find = ''

const shown = e =>
  !e.tags.some(t => off.has(t)) &&
  (!find || e.text.toLowerCase().includes(find) || e.tags.some(t => t.includes(find)))

const lineNode = e => el('div', { className: `line ${e.level}` },
  el('span', { className: 't', textContent: e.at.slice(11, 19) }),
  el('span', { className: 'g', textContent: e.tags.join(' ') }),
  el('span', { className: 'm', textContent: e.text }))

function paintLog () {
  const box = $('log')
  const keep = lines.filter(shown)
  box.replaceChildren(...keep.slice(-600).map(lineNode))
  $('log-count').textContent = `${keep.length} of ${lines.length} lines`
  if (follow) box.scrollTop = box.scrollHeight

  const counts = new Map()
  for (const e of lines) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)
  $('log-tags').replaceChildren(...[...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => el('button', {
      className: 'chip' + (off.has(tag) ? '' : ' on'),
      onclick: () => { off.has(tag) ? off.delete(tag) : off.add(tag); paintLog() }
    }, tag, el('b', { textContent: String(n) }))))
}

$('log-follow').onchange = e => { follow = e.target.checked; paintLog() }
$('log-find').oninput = e => { find = e.target.value.trim().toLowerCase(); paintLog() }
$('log-clear').onclick = () => api('logClear').then(() => { lines.length = 0; paintLog() }).catch(oops)

const stream = new EventSource('/api/log/stream')
stream.onmessage = m => {
  lines.push(JSON.parse(m.data))
  if (lines.length > 2000) lines.splice(0, lines.length - 2000)
  paintLog()
}

// ---- draw -------------------------------------------------------------

async function draw () {
  const [data, kit] = await Promise.all([api('overview'), api('machines')])

  $('where').textContent =
    `${data.ecosystem.name} · ${data.repos.length} repositories · one branch, nothing committed until you accept`

  const missing = data.repos.filter(r => !r.present)
  $('trouble').hidden = !missing.length
  $('trouble').replaceChildren(...missing.map(r => el('div', { className: 'note' },
    el('b', { textContent: `${r.name} is not where this project says it is` }),
    el('div', { className: 'where', textContent: r.dir }),
    el('div', { textContent: 'Tasks that need it will not start.' }))))

  const doing = data.work.filter(w => w.status === 'working' || w.status === 'offered')
  $('doing-list').replaceChildren(doing.length
    ? doing.map(doingCard)
    : el('p', { className: 'empty', textContent: 'Nothing in flight. Pick something below.' }))

  $('task-list').replaceChildren(data.tasks.length
    ? data.tasks.map(taskCard)
    : el('p', { className: 'empty', textContent: 'This project lists no tasks yet.' }))

  const done = data.work.filter(w => w.status === 'accepted' || w.status === 'thrown away')
  $('past-list').replaceChildren(done.length
    ? done.map(pastCard)
    : el('p', { className: 'empty', textContent: 'Nothing finished yet.' }))

  $('machine-list').replaceChildren(...kit.machines.map(m => machineCard(m, kit.vbox)))

  $('vm-list').replaceChildren(kit.vbox.available
    ? (kit.vbox.vms.length
        ? kit.vbox.vms.map(vmCard)
        : el('p', { className: 'empty', textContent: 'VirtualBox is here, but there are no virtual machines yet.' }))
    : el('div', { className: 'note' },
        el('b', { textContent: 'VirtualBox was not found' }),
        el('div', { textContent: 'Everything else works without it. Install it if you want virtual machines managed from here.' })))
}

draw().catch(e => { $('where').textContent = e.message })
