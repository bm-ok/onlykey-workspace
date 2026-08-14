'use strict'

// The repositories themselves, and everything open across them.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- everything waiting, in one list -----------------------------------
//
// What is open across the whole workspace, read as one list rather than as a
// tour of three sub-tabs times four repositories. "What is waiting on me" is not
// a per-repository question — it only became one because GitHub's pages are.
//
// A CUT IS ONE ROW, with its pull requests underneath. Reading three of them as
// three separate things is the exact mistake this app exists to stop: they are
// approved separately and they are not done separately, and a list showing three
// ticks for one change invites somebody to act on a third of it.
//
// SORTED AND FILTERED IN THE WINDOW, not by the server. Everything here was
// already gathered by the last "Ask GitHub", so narrowing it costs nothing and
// happens as fast as a click. Sorting server-side would put a network round trip
// behind a dropdown, and a dropdown that pauses is one people stop touching.
let todoSort = been.get('todo-sort', 'newest')
let todoKinds = been.get('todo-kinds', ['cut', 'pull', 'issue'])
let todoOpenOnly = been.get('todo-open', true)
let todoFind = ''

const TODO_SORTS = [
  ['newest', 'newest first'],
  ['oldest', 'oldest first'],
  ['kind', 'by kind'],
  ['repo', 'by repository'],
  ['state', 'by state']
]

const TODO_KINDS = [['cut', 'PR cuts', 'cuts'], ['pull', 'pull requests', 'pulls'], ['issue', 'issues', 'issues']]

function paintTodo () {
  if (view !== 'repos' || repoPane !== 'todo') return
  waiting('todo', { cards: 3 })
  paintTodoNow()
}

async function paintTodoNow () {
  await settle()
  if (view !== 'repos' || repoPane !== 'todo') return
  api('repoOverview').then(v => {
    const shown = todoRows(v.items)

    if (changed('todo-chrome', [v.counts, todoKinds, todoOpenOnly, todoSort])) {
      // A FILTER SAYS WHAT IT WOULD SHOW, not only what it is. A chip reading
      // "issues" beside an empty list is a chip nobody can tell is switched off,
      // and the count is the difference between "there are none" and "you are
      // not looking at them".
      fill($('todo-filters'),
        ...TODO_KINDS.map(([id, label, count]) => el('button', {
          className: `chip linky-chip${todoKinds.includes(id) ? ' on' : ''}`,
          textContent: `${label} ${v.counts[count]}`,
          onclick: () => {
            todoKinds = todoKinds.includes(id) ? todoKinds.filter(x => x !== id) : [...todoKinds, id]
            been.set('todo-kinds', todoKinds)
            redrawTodo()
          }
        })),
        el('button', {
          className: `chip linky-chip${todoOpenOnly ? ' on' : ''}`,
          textContent: todoOpenOnly ? `open only — ${v.counts.open}` : `open or not — ${v.counts.all}`,
          onclick: () => { todoOpenOnly = !todoOpenOnly; been.set('todo-open', todoOpenOnly); redrawTodo() }
        }))

      fill($('todo-sort'), ...TODO_SORTS.map(([id, label]) =>
        el('option', { value: id, textContent: label, selected: id === todoSort })))
      $('todo-sort').onchange = () => { todoSort = $('todo-sort').value; been.set('todo-sort', todoSort); redrawTodo() }
      $('todo-find').oninput = () => { todoFind = $('todo-find').value; redrawTodo() }
    }

    if (!changed('todo-list', [shown, todoFind])) return
    fill($('todo'), shown.length
      ? shown.map(todoCard)
      : el('p', {
          className: 'empty',
          textContent: v.items.length
            ? 'Nothing matches. Widen the filters above.'
            : 'Nothing here yet. This is as old as the last time GitHub was asked — "Ask GitHub" reads it again.'
        }))
  }).catch(() => { /* the board says when the dashboard itself is unreachable */ })
}

const redrawTodo = () => { forget('todo-chrome'); forget('todo-list'); paintTodo() }

function todoRows (items) {
  const want = String(todoFind || '').trim().toLowerCase()
  const rows = items.filter(x =>
    todoKinds.includes(x.kind) &&
    (!todoOpenOnly || x.state === 'open') &&
    (!want || `${x.title} ${x.repos.join(' ')} #${x.number || ''} ${(x.labels || []).join(' ')}`.toLowerCase().includes(want)))

  const when = x => (x.at ? Date.parse(x.at) : 0)
  const kindAt = x => ['cut', 'pull', 'issue'].indexOf(x.kind)
  const order = {
    newest: (a, b) => when(b) - when(a),
    oldest: (a, b) => when(a) - when(b),
    // A cut above a loose pull request above an issue, because that is the order
    // of how much of the workspace each one is holding.
    kind: (a, b) => kindAt(a) - kindAt(b) || when(b) - when(a),
    repo: (a, b) => (a.repos[0] || '').localeCompare(b.repos[0] || '') || when(b) - when(a),
    state: (a, b) => String(a.state).localeCompare(String(b.state)) || when(b) - when(a)
  }
  return rows.slice().sort(order[todoSort] || order.newest)
}

function todoCard (x) {
  const badge = x.state === 'merged' ? 'ok' : x.state === 'closed' ? 'bad' : x.kind === 'issue' ? 'warn' : 'run'
  const where = x.kind === 'cut' ? `${x.repos.length} repositories — ${x.repos.join(', ')}` : x.on || x.repo
  const sub = [where, x.at ? ago(x.at) : null, x.by || null].filter(Boolean).join(' · ')

  return el('div', { className: 'card' },
    el('div', { className: 'card-title' },
      el('span', { className: 'badge muted', textContent: x.kind === 'cut' ? 'PR cut' : x.kind === 'pull' ? 'pull' : 'issue' }),
      x.number ? el('span', { className: 'mono muted', textContent: `#${x.number}` }) : null,
      el('span', { className: 'grow', textContent: x.title }),
      x.draft ? el('span', { className: 'badge muted', textContent: 'draft' }) : null,
      el('span', { className: `badge ${badge}`, textContent: x.summary || x.state })),

    el('div', { className: 'card-sub muted', textContent: sub }),

    ...((x.labels || []).length
      ? [el('div', { className: 'badges' }, ...x.labels.slice(0, 6).map(l => el('span', { className: 'badge muted', textContent: l })))]
      : []),

    // A CUT SHOWS ITS PARTS. The row is the change; these are where it actually
    // got to, and one of them merged while another is not is precisely the state
    // this list exists to make visible — it is invisible on GitHub.
    ...(x.parts
      ? [el('div', { className: 'carries', style: 'margin-top:8px' }, ...x.parts.map(part => el('div', { className: 'group-part' },
          el('span', { className: 'mono', textContent: `${part.repo} #${part.number}` }),
          el('span', {},
            el('span', { className: part.state === 'merged' ? 'ok' : part.state === 'closed' ? 'gone' : 'muted', textContent: part.state }),
            el('button', { className: 'linky', style: 'margin-left:10px', textContent: 'read it', onclick: () => host.openExternal(part.url) })))))]
      : []),

    el('div', { className: 'row', style: 'margin-top:8px' },
      x.url ? el('button', { className: 'btn small', textContent: 'Read it on GitHub', onclick: () => host.openExternal(x.url) }) : null,
      // AN ISSUE IS THE ONE THING HERE THAT COMES IN, so it is the one row with
      // somewhere to go next: work that arrived, turned into work this app runs.
      x.kind === 'issue'
        ? el('button', {
            className: 'btn small ok',
            textContent: 'Write a task from it',
            title: 'Opens the task dialog with this issue as the brief',
            onclick: () => newTaskFromIssue(x)
          })
        : null,
      x.kind === 'cut'
        ? el('button', {
            className: 'btn small',
            textContent: 'Open the cut',
            onclick: () => {
              pickedCut = x.id
              been.set('prcut', pickedCut)
              forget('prcuts'); forget('prcut-detail')
              const t = document.querySelector('#view-prcuts .subtab[data-pane="cuts"]')
              if (t) t.click()
              showTab('prcuts')
            }
          })
        : null))
}

// ---- the repositories --------------------------------------------------
//
// What everything else is made of, asked three ways: what is here and can it be
// reached, what is being asked of it, and what is waiting to go into it.
//
// ONE SELECTION ACROSS ALL THREE. The narrow column is a repository picker and
// it lives outside the panes, because "which repository" is the same question on
// every sub-tab — three independent selections would mean picking one here and
// finding another there.
//
// LOCAL FACTS ARE DRAWN EVERY TIME; REMOTE ONES CARRY A DATE. The path, default
// branch, remote and head are read from disk and are true now. Issues, pull
// requests and reachability were asked for on purpose and are only as true as
// the moment they were asked, so they say when. A row that quietly mixed the two
// would be a row nobody could trust either half of.
let pickedRepo = been.get('repo', null)
let repoPane = been.get('repo-pane', 'repos')

document.querySelectorAll('#view-repos .subtab[data-pane]').forEach(t => {
  t.onclick = () => {
    repoPane = t.dataset.pane
    been.set('repo-pane', repoPane)
    document.querySelectorAll('#view-repos .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
    document.querySelectorAll('#view-repos .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${repoPane}`))
    forget('repo-detail')
    $('repos-cols').classList.toggle('hidden', repoPane === 'todo')
    paintRepos()
    paintTodo()
  }
})
;(() => {
  const t = document.querySelector(`#view-repos .subtab[data-pane="${repoPane}"]`)
  if (!t) { repoPane = 'repos'; return }
  document.querySelectorAll('#view-repos .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
  document.querySelectorAll('#view-repos .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${repoPane}`))
  $('repos-cols').classList.toggle('hidden', repoPane === 'todo')
})()

function paintRepos () {
  if (view !== 'repos') return
  waiting('repos', { cards: 3 })
  waiting('repo-detail', { lines: 6 })
  paintReposNow()
}

async function paintReposNow () {
  await settle()
  if (view !== 'repos') return
  api('repositories').then(({ dir, repos, note }) => {
    // Reconciled against what exists, like every other selection here.
    if (!repos.some(r => r.repo === pickedRepo)) {
      pickedRepo = repos.length ? repos[0].repo : null
      been.set('repo', pickedRepo)
    }
    setText($('repos-context'), repos.length ? `— ${repos.length} in ${dir}` : '— none')
    setText($('repos-note'), note)

    if (changed('repos', [repos, pickedRepo])) {
      fill($('repos'), repos.length
        ? repos.map(r => el('div', {
            className: `card pick${r.repo === pickedRepo ? ' on' : ''}${r.reachable === false ? ' warn' : ''}`,
            onclick: () => { pickedRepo = r.repo; been.set('repo', pickedRepo); forget('repos'); forget('repo-detail'); paintRepos() }
          },
          el('div', { className: 'card-title' },
            el('span', { className: 'mono', textContent: r.repo }),
            r.reachable === false ? el('span', { className: 'badge bad', textContent: 'unreachable' }) : null,
            r.reachable === true && r.why ? el('span', { className: 'badge warn', textContent: 'limited' }) : null),
          el('div', { className: 'card-sub mono', textContent: r.default || '(no default branch)' }),
          el('div', { className: 'badges' },
            el('span', { className: 'muted', textContent: `${r.branches} branch(es)` }),
            r.openIssues != null ? el('span', { className: 'muted', textContent: `${r.openIssues} issue(s)` }) : null,
            r.openPulls != null ? el('span', { className: 'muted', textContent: `${r.openPulls} pull(s)` }) : null)))
        : el('p', { className: 'empty', textContent: 'No repositories in this workspace folder.' }))
    }

    const one = repos.find(r => r.repo === pickedRepo) || null
    if (!changed('repo-detail', [repoPane, one])) return
    if (repoPane === 'todo') return
    if (repoPane === 'repos') return paintRepoDetail(one)
    if (repoPane === 'issues') return paintRepoIssues(one)
    return paintRepoPulls(one)
  }).catch(() => { /* the board says when the dashboard is unreachable */ })
}

function paintRepoDetail (r) {
  if (!r) return fill($('repo-detail'), el('p', { className: 'empty', textContent: 'Pick a repository on the left.' }))
  const rem = r.remote
  const asked = !!r.checked

  fill($('repo-detail'),
    el('div', { className: 'card-title' },
      el('span', { className: 'mono', textContent: r.repo }),
      r.privateRepo ? el('span', { className: 'badge muted', textContent: 'private' }) : null,
      r.fork ? el('span', { className: 'badge muted', textContent: r.chained ? `fork of ${r.parent} of ${r.source}` : (r.parent ? `fork of ${r.parent}` : 'fork') }) : null,
      !asked
        ? el('span', { className: 'badge', textContent: 'not asked about yet' })
        : r.reachable === false
          ? el('span', { className: 'badge bad', textContent: 'cannot be reached' })
          : r.why
            ? el('span', { className: 'badge warn', textContent: 'reachable, not usable' })
            : el('span', { className: 'badge ok', textContent: 'reachable' })),

    el('table', { className: 'kv', style: 'margin-top:8px' },
      el('tr', {}, el('th', { textContent: 'here' }), el('td', { className: 'mono', style: 'user-select:text', textContent: r.path })),
      el('tr', {}, el('th', { textContent: 'default branch' }),
        el('td', {}, el('span', { className: 'mono', textContent: r.default || '(none)' }),
          el('span', { className: 'muted', textContent: r.head ? `  at ${String(r.head).slice(0, 8)}` : '' }))),
      el('tr', {}, el('th', { textContent: 'origin' }),
        el('td', {}, rem
          ? el('span', { className: 'mono', style: 'user-select:text', textContent: rem.url })
          : el('span', { className: 'bad', textContent: 'no remote called origin — nothing here can be pushed onward' }))),
      asked && r.may
        ? el('tr', {}, el('th', { textContent: 'this token may' }),
            el('td', {},
              el('span', { className: r.may.code ? 'ok' : 'bad', textContent: r.may.code ? 'read code' : 'NOT read code' }),
              el('span', { textContent: ' · ' }),
              el('span', { className: r.may.pulls ? 'ok' : 'bad', textContent: r.may.pulls ? 'use pull requests' : 'NOT use pull requests' })))
        : null,
      asked && r.accountMay
        ? el('tr', {}, el('th', { textContent: 'your account may' }),
            el('td', { className: 'muted', textContent: `${Object.entries(r.accountMay).filter(([, v]) => v).map(([k]) => k).join(', ')} — which is not the same as what the token may do` }))
        : null,
      asked && r.upstreamDefault
        ? el('tr', {}, el('th', { textContent: 'there' }),
            el('td', {}, el('span', { className: 'mono', textContent: r.upstreamDefault }),
              r.upstreamHead
                ? el('span', { className: r.inStep ? 'ok' : '', textContent: r.inStep ? '  same commit as here' : `  at ${String(r.upstreamHead).slice(0, 8)} — different from here` })
                : el('span', { className: 'muted', textContent: '  its head could not be read' })))
        : null,
      asked && r.intoParent
        ? el('tr', {}, el('th', { textContent: 'a pull request goes to' }),
            el('td', {},
              el('span', { className: 'mono', textContent: r.intoParent.repo }),
              el('span', { textContent: '  ' }),
              el('span', { className: r.intoParent.mayOpen ? 'ok' : 'bad', textContent: r.intoParent.mayOpen ? 'this token may open one there' : 'this token may NOT open one there' }),
              r.intoParent.why ? el('div', { className: 'muted', textContent: r.intoParent.why }) : null,
              r.chained
                ? el('div', { className: 'note', style: 'margin-top:4px' },
                    el('strong', { textContent: 'This is a fork of a fork. ' }),
                    el('span', { textContent: `One level up is ${r.parent}; the root of the network is ${r.source}. Work goes one step up by default, which is how a chain is normally worked — sending it to the root instead is a choice, not a correction.` }))
                : null))
        : null,
      el('tr', {}, el('th', { textContent: 'asked GitHub' }),
        el('td', { className: 'muted', textContent: asked ? ago(r.checked) : 'never' }))),

    r.why ? el('p', { className: 'note' }, el('strong', { className: r.reachable === false ? 'bad' : '', textContent: r.reachable === false ? 'Cannot be reached. ' : 'Reachable, but not usable yet. ' }), el('span', { textContent: r.why })) : null,

    el('div', { className: 'row', style: 'margin-top:8px' },
      el('button', {
        className: 'btn small',
        textContent: 'Ask GitHub about this one',
        onclick: () => api('repositoriesCheck', { repo: r.repo }).then(x => { forget('repos'); forget('repo-detail'); say(x.note); return draw() }).catch(oops)
      }),
      rem && rem.kind === 'github'
        ? el('button', { className: 'btn small', textContent: 'Open it on GitHub', onclick: () => host.openExternal(`https://${rem.host}/${rem.owner}/${rem.repo}`) })
        : null))
}

// WORK THAT ARRIVED, as opposed to work somebody wrote down here. This is the
// only thing in this app that comes IN, and the reason it is worth a tab: every
// other chain starts with a task, and an issue is the step before that.
function paintRepoIssues (r) {
  if (!r) return fill($('issue-detail'), el('p', { className: 'empty', textContent: 'Pick a repository on the left.' }))
  const list = r.issues || null

  fill($('issue-detail'),
    el('div', { className: 'carries' },
      el('div', { className: 'carries-head' },
        el('span', { textContent: 'Issues' }),
        el('span', { className: 'muted', textContent: r.issuesOn ? `on ${r.issuesOn}` : r.repo }),
        r.gathered ? el('span', { className: 'muted', textContent: ago(r.gathered) }) : null),
      // A FORK'S OWN TRACKER IS USUALLY EMPTY. These are read from the
      // repository a pull request would go to, because that is where a
      // conversation about the project happens.
      r.parent ? el('p', { className: 'note', textContent: `Read from ${r.parent}, which is where a pull request from this fork would go.` }) : null),

    list == null
      ? el('p', { className: 'empty', textContent: 'Not asked yet. "Ask GitHub" reads issues and pull requests for every repository here.' })
      : list.length
        ? el('div', { className: 'stack' }, ...list.map(i => el('div', { className: 'card' },
            el('div', { className: 'card-title' },
              el('span', { className: 'mono muted', textContent: `#${i.number}` }),
              el('span', { textContent: i.title }),
              ...(i.labels || []).slice(0, 4).map(l => el('span', { className: 'badge muted', textContent: l }))),
            el('div', { className: 'card-sub muted', textContent: `${i.by || 'somebody'}, ${ago(i.at)}${i.comments ? ` · ${i.comments} comment(s)` : ''}` }),
            el('div', { className: 'row', style: 'margin-top:6px' },
              el('button', {
                className: 'btn small ok',
                textContent: 'Write a task from it',
                title: 'Opens the task dialog with this issue as the brief',
                onclick: () => newTaskFromIssue(i)
              }),
              el('button', { className: 'btn small', textContent: 'Read it on GitHub', onclick: () => host.openExternal(i.url) })))))
        : el('p', { className: 'empty', textContent: 'Nothing open.' }))
}

// WHAT IS WAITING TO GO IN. The same objects the Changes tab holds as one
// landing, listed per repository — because "what is open against this
// repository" and "is my change in" are different questions and the second one
// cannot be answered from this list.
function paintRepoPulls (r) {
  if (!r) return fill($('pull-detail'), el('p', { className: 'empty', textContent: 'Pick a repository on the left.' }))
  const list = r.pulls || null

  fill($('pull-detail'),
    el('div', { className: 'carries' },
      el('div', { className: 'carries-head' },
        el('span', { textContent: 'Pull requests' }),
        el('span', { className: 'muted', textContent: r.parent ? `on ${r.parent}` : r.repo }),
        r.gathered ? el('span', { className: 'muted', textContent: ago(r.gathered) }) : null),
      r.parent ? el('p', { className: 'note', textContent: `Opened into ${r.parent}, because this is a fork. A pull request from a fork is created in the repository it is merged into.` }) : null),

    list == null
      ? el('p', { className: 'empty', textContent: 'Not asked yet. "Ask GitHub" reads issues and pull requests for every repository here.' })
      : list.length
        ? el('div', { className: 'stack' }, ...list.map(p => el('div', { className: 'card' },
            el('div', { className: 'card-title' },
              el('span', { className: 'mono muted', textContent: `#${p.number}` }),
              el('span', { textContent: p.title }),
              el('span', {
                className: `badge ${p.merged ? 'ok' : p.state === 'closed' ? 'bad' : 'run'}`,
                textContent: p.merged ? 'merged' : p.state
              }),
              p.draft ? el('span', { className: 'badge muted', textContent: 'draft' }) : null),
            el('div', { className: 'card-sub mono', textContent: `${p.head} → ${p.base}` }),
            el('div', { className: 'row', style: 'margin-top:6px' },
              el('button', { className: 'btn small', textContent: 'Read it on GitHub', onclick: () => host.openExternal(p.url) })))))
        : el('p', { className: 'empty', textContent: 'Nothing open, and nothing closed recently.' }))
}

// An issue, turned into the thing this app actually runs on. The brief is what
// the issue says, because that is what somebody asked for — and a task written
// from an issue should be answerable by reading the task alone.
function newTaskFromIssue (i) {
  newTask({
    title: i.title,
    brief: `${i.body ? i.body.trim() + '\n\n' : ''}From ${i.on} issue #${i.number} — ${i.url}`
  })
}
