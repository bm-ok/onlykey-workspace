'use strict'

// The five actions and nothing else: pick, work, offer, review, accept.
//
// The rule this page is written against: an answer belongs where the person was
// already looking. Adding a record, a field or a screen for them to go consult
// usually fails that while appearing to pass it -- so a review shows the diff
// itself, and a refusal says what to do about it right where it happened.

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
  kids.flat().filter(Boolean).forEach(k => node.append(k))
  return node
}

// ---- the confirm-and-say-what-happens dialog --------------------------

const ask = ({ title, plain, confirm, needNote, onYes }) => {
  const dlg = document.getElementById('ask')
  document.getElementById('ask-title').textContent = title
  document.getElementById('ask-body').replaceChildren(
    el('ul', {}, ...plain.map(line => el('li', { textContent: line }))))

  const noteWrap = document.getElementById('ask-note-wrap')
  const note = document.getElementById('ask-note')
  const error = document.getElementById('ask-error')
  const yes = document.getElementById('ask-yes')

  noteWrap.hidden = !needNote
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
  document.getElementById('ask-no').onclick = () => dlg.close()
  dlg.showModal()
  if (needNote) note.focus()
}

// ---- what changed, shown rather than referenced -----------------------

const changeView = r => el('div', { className: 'what' },
  ...r.parts.map(p => [
    el('div', {},
      el('b', { textContent: p.repo }),
      el('span', { className: 'tag ' + (p.ready ? 'go' : 'warn'), textContent: p.ready ? `${p.commits.length} change${p.commits.length === 1 ? '' : 's'}` : 'nothing yet' })),
    p.ready ? el('pre', { textContent: [...p.commits, '', p.stat].join('\n').trim() }) : null
  ]),
  r.checksFailed.length
    ? el('div', { className: 'note' },
        el('b', { textContent: 'A check the project asked for did not pass' }),
        ...r.checksFailed.map(c => el('div', { textContent: `${c.name}${c.why ? ' — ' + c.why : ''}` })))
    : null)

// ---- cards ------------------------------------------------------------

function doingCard (w) {
  const card = el('div', { className: 'card' },
    el('h4', { textContent: w.title }),
    el('p', { textContent: `${w.repos.length} ${w.repos.length === 1 ? 'repository' : 'repositories'} · ${w.status}` }),
    ...w.where.map(p => el('div', { className: 'where', textContent: p.at })))

  const row = el('div', { className: 'row' })
  const body = el('div')

  const showReview = async () => {
    const r = await api('review', { id: w.id })
    body.replaceChildren(changeView(r))
    accept.disabled = !r.canAccept
    accept.title = r.canAccept ? '' : `Nothing to accept yet in ${r.missing.join(' or ')}`
  }

  const offer = el('button', { textContent: 'I am done — offer this', onclick: () =>
    api('offer', { id: w.id }).then(draw).catch(e => alert(e.message)) })

  const look = el('button', { className: 'quiet', textContent: 'Show me what changed', onclick: () =>
    showReview().catch(e => alert(e.message)) })

  const accept = el('button', { textContent: 'Accept it', onclick: async () => {
    const r = await api('review', { id: w.id })
    ask({
      title: 'Accept this work?',
      plain: [
        `The change lands on ${r.parts.map(p => p.repo).join(' and ')}, as one commit each.`,
        'Your working history stays on its own branch, untouched.',
        'Nothing goes to the internet.',
        'This is the step that makes it official.'
      ],
      confirm: 'Accept',
      needNote: true,
      onYes: note => api('accept', { id: w.id, note })
    })
  } })

  const bin = el('button', { className: 'quiet', textContent: 'Throw it away', onclick: () => ask({
    title: 'Throw this away?',
    plain: [
      'This decides the attempt did not happen.',
      'Nothing that was already accepted is affected.',
      'Your repositories go back to the branch you started from.'
    ],
    confirm: 'Throw away',
    onYes: () => api('discard', { id: w.id })
  }) })

  row.append(w.status === 'working' ? offer : accept, look, bin)
  card.append(row, body)
  if (w.status === 'offered') showReview().catch(() => {})
  return card
}

const taskCard = t => el('div', { className: 'card' },
  el('h4', { textContent: t.title }),
  t.detail ? el('p', { textContent: t.detail }) : null,
  el('p', { textContent: `${t.repos.length} ${t.repos.length === 1 ? 'repository' : 'repositories'}: ${t.repos.join(', ')}` }),
  el('div', { className: 'row' },
    el('button', {
      textContent: t.open.length ? 'Start another go at this' : 'Work on this',
      onclick: () => ask({
        title: t.title,
        plain: window.__plain.concat('You can throw the whole attempt away at any point.'),
        confirm: 'Start',
        onYes: () => api('start', { task: t.id })
      })
    }),
    ...t.open.map(o => el('span', { className: 'tag warn', textContent: `already ${o.status}` }))))

// ---- draw -------------------------------------------------------------

async function draw () {
  const data = await api('overview')

  // Said in plain words, because these are the sentences a person needs before
  // pressing anything. They come from the sandbox itself so they cannot drift
  // from what the code actually does.
  window.__plain = data.ecosystem.sandbox === 'ssh'
    ? ['Work happens on the other machine, not on this one.', 'Your copies here are only read until you accept.']
    : ['Work happens in your own copies, on a new branch.', 'Your main branch is not touched.', 'Nothing goes to the internet.']

  document.getElementById('where').textContent =
    `${data.ecosystem.name} · ${data.repos.length} repositories · work happens ${data.ecosystem.sandbox === 'ssh' ? 'on another machine' : 'here, on a branch'}`

  const missing = data.repos.filter(r => !r.present)
  const trouble = document.getElementById('trouble')
  trouble.hidden = !missing.length
  trouble.replaceChildren(...missing.map(r => el('div', { className: 'note' },
    el('b', { textContent: `${r.name} is not where the project says it is` }),
    el('div', { className: 'where', textContent: r.dir }),
    el('div', { textContent: 'Nothing can be done with this repository until it is there. Tasks that need it will not start.' }))))

  const doing = data.work.filter(w => w.status === 'working' || w.status === 'offered')
  document.getElementById('doing-list').replaceChildren(
    doing.length ? doing.map(doingCard) : el('p', { className: 'empty', textContent: 'Nothing in flight. Pick something below.' }))

  document.getElementById('task-list').replaceChildren(
    data.tasks.length ? data.tasks.map(taskCard) : el('p', { className: 'empty', textContent: 'This project lists no tasks yet.' }))

  const done = data.work.filter(w => w.status === 'accepted' || w.status === 'thrown away')
  document.getElementById('past-list').replaceChildren(
    done.length
      ? done.map(w => el('div', { className: 'card' },
          el('h4', { textContent: w.title }),
          el('p', { textContent: w.status === 'accepted' ? `Accepted — ${w.note}` : 'Thrown away' })))
      : el('p', { className: 'empty', textContent: 'Nothing finished yet.' }))
}

draw().catch(e => { document.getElementById('where').textContent = e.message })
