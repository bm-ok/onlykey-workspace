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
              showPane('cuts', 'repos')
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

// ELEVEN PANES, ONE BAR, ONE VARIABLE.
//
// The repositories, the branches cut across them, and what leaves them. Those
// were three tabs, which put "the repositories" and "the branches in the
// repositories" in different parts of the window — and a branch cut is a
// statement about these repositories, not a subject of its own.
//
// Three files paint into this one bar now, so the paints are listed here rather
// than each file wiring its own switcher into the same markup. Every one of them
// guards on `repoPane` itself, so calling all of them costs nothing but the
// call: the one whose pane is open does the work.
//
// THE PICKER IS ONLY FOR THE PANES THAT PICK A REPOSITORY. It is a narrow column
// shared by Repos, Issues and Pull requests; over a branch pane it would be a
// list of repositories beside something that is not about one.
const REPO_PICKING = new Set(['repos', 'issues', 'pulls'])

// WHAT EACH PANE IS, in one place, said in the same voice as the rest of the
// window: what the thing is, and the one fact about it that is easy to get
// wrong. Eleven panes under one bar is a lot to arrive at cold.
//
// Here rather than in the markup because four of these panes live inside the
// shared repository picker, and a note written inside one of those renders in a
// column beside the list instead of under the tab that named it — which is
// exactly why those four read as having no note at all.
//
// STATIC, AND ONLY WHAT THE PANE IS. Anything about its current state — how many
// cuts, how old the last read is, whether a remote answered — stays in the pane
// and is written by whatever knows it.
const PANE_IS = {
  todo: "Everything open across every repository, in one list. This is the question GitHub's own pages cannot answer, because each of them is about a single repository — and a PR cut is one row here rather than three.",
  repos: 'What this workspace is made of, and whether the far end of each one can still be reached. Everything above is local and instant; anything about GitHub was asked for on purpose and carries when it was asked.',
  issues: 'Work that arrived, rather than work written here — the one thing in this app that comes IN. An issue becomes a task from the button on its card, which is the far end of a chain that otherwise starts midway.',
  pulls: 'Pull requests open on the repository picked on the left, one repository at a time. A change cut across several repositories is one thing, and is read on the PR cuts pane instead.',
  conflicts: 'What cannot be caught up by fast-forwarding, because both sides have moved. Everything else about a branch is computable and has a button; this is the part somebody has to decide, and from here it becomes a task.',
  branchcuts: 'A cut is a branch this app made across the repositories a line touches, with a reason and a starting point recorded on it. Work is done on a cut. A line is the same thing protected, and is next door.',
  baselines: 'A line names one branch per repository, so work can be cut from a point rather than from a branch at a time. A line is protected: work is merged into one and never done on one, which is what keeps it clean enough to open pull requests from.',
  changes: 'What a proposed line would land, read before anything leaves this computer: the commits, and the diff per repository. Nothing here changes anything — it is the last look.',
  protected: 'What may not be built on, and whether you could change that. A repository\'s own default is a fact about git and cannot be unmade here; a link in a line is a decision somebody made by naming it.',
  cuts: 'A change once it has left: one act, one pull request per repository, tracked together. This is the part GitHub cannot do — each repository sees only its own, and "is it in" cannot be answered by looking at any single one.',
  templates: 'What every pull request in a cut says beyond what somebody typed. The preview is the editor, and it is composed from real facts about the two lines chosen — including the links between the cut\'s own pull requests, which nothing else can write.'
}

// The three things a pane switch changes about the chrome around it, in one
// function rather than three lines repeated at load and on every click.
const repoChrome = () => {
  setText($('repos-pane-note'), PANE_IS[repoPane] || '')
  $('repos-cols').classList.toggle('hidden', !REPO_PICKING.has(repoPane))
  // The repository header is about the repositories, so it belongs to the panes
  // that are. Over a branch pane it is a heading for one thing above another.
  $('repos-head').classList.toggle('hidden', !REPO_PICKING.has(repoPane) && repoPane !== 'todo')
}

paneSwitcher('view-repos', () => repoPane, p => { repoPane = p; been.set('repo-pane', p) }, () => {
  forget('repo-detail')
  repoChrome()
  paintRepos()
  paintTodo()
  paintConflicts()
  paintBranches()
  paintCuts()
  paintTemplates()
})
// Applied before the first draw rather than only on a click, or the window
// opens on whichever pane was remembered with the chrome of whichever pane the
// markup happens to mark active.
repoChrome()

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
    // BEFORE the guard below, and with a guard of its own. This reads git for
    // one repository, so it must not run on the draw timer — but it must also
    // still run after a sync, when the repository row itself has not changed and
    // the check below would return early. Its own `changed` key is what makes
    // both true, and `forget('repo-branches')` is what a sync presses on.
    if (repoPane === 'repos') paintRepoBranches(one)
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

// ---- what has to be decided -------------------------------------------
//
// Everything else about a branch is computable and has a button. A conflict is
// two people having meant different things, and no amount of code resolves that
// — somebody decides. So it gets its own pane rather than a red button on
// whichever repository happened to be selected, and from here it becomes a TASK:
// a machine, a branch, a brief, an artifact, a verdict. Run by a worker or by a
// person, which is the same task with one step different.
//
// DIVERGED IS NOT CONFLICTING, and the difference is most of the value here. Two
// people editing different files both move their side and merge cleanly; a panel
// that demands a decision about that is crying wolf. `git merge-tree` is asked,
// so the rows say "these two files" rather than "there may be trouble" — and it
// answers without a checkout, so asking costs nothing and undoes nothing.
function paintConflicts () {
  if (view !== 'repos' || repoPane !== 'conflicts') return
  waiting('conflicts', { cards: 2 })
  paintConflictsNow()
}

async function paintConflictsNow () {
  await settle()
  if (view !== 'repos' || repoPane !== 'conflicts') return

  api('conflicts').then(({ conflicts, stuck, note }) => {
    if (view !== 'repos' || repoPane !== 'conflicts') return
    setText($('conflicts-note'), note)
    if (!changed('conflicts', conflicts)) return

    fill($('conflicts'), conflicts.length
      ? conflicts.map(c => el('div', { className: `card${c.clean === false ? ' warn' : ''}` },
          el('div', { className: 'card-title' },
            el('span', { className: 'mono', textContent: `${c.repo} · ${c.branch}` }),
            c.clean === false
              ? el('span', { className: 'badge bad', textContent: `${c.files.length} file(s) conflict` })
              : c.clean === true
                ? el('span', { className: 'badge warn', textContent: 'merges cleanly' })
                : el('span', { className: 'badge muted', textContent: 'could not be read' }),
            ...(c.lines || []).map(l => el('span', { className: 'badge muted', textContent: l }))),

          el('div', { className: 'card-sub muted', textContent:
            `${c.ahead} commit(s) here that origin has not, ${c.behind} there that this has not. A fast-forward cannot help either way.` }),

          c.clean === false
            ? el('div', { className: 'carries', style: 'margin-top:8px' },
                ...c.files.map(f => el('div', { className: 'group-part' },
                  el('span', { className: 'mono', textContent: f }))))
            : null,

          c.why ? el('p', { className: 'note', textContent: c.why }) : null,

          el('div', { className: 'row', style: 'margin-top:8px' },
            // THE WAY OUT IS A TASK, which is the whole reason this pane is
            // worth having rather than being a warning. The brief is written
            // from what is actually known — which two commits, which files —
            // because a worker sent to resolve a conflict with "there is a
            // conflict" has to go and find out what this already knows.
            //
            // Whether a job runs it or a person opens VS Code is chosen on the
            // task, not here: they are the same task with one step different.
            el('button', {
              className: 'btn small ok',
              textContent: 'Write a task to resolve it',
              title: 'Opens the task pane with the conflict as the brief. Pick a job to have a worker do it, or none to do it yourself.',
              onclick: () => newTask({
                title: `resolve ${c.branch} in ${c.repo}`,
                branch: c.branch,
                brief: [
                  `The branch "${c.branch}" in ${c.repo} has moved on both sides and cannot be fast-forwarded.`,
                  '',
                  `Here it is at ${c.local}, with ${c.ahead} commit(s) origin does not have.`,
                  `Origin has it at ${c.remote}, with ${c.behind} commit(s) this side does not have.`,
                  '',
                  c.clean === false
                    ? `Merging origin/${c.branch} into ${c.branch} conflicts in:\n${c.files.map(f => `  - ${f}`).join('\n')}`
                    : `Merging origin/${c.branch} into ${c.branch} does NOT conflict — git can reconcile it, but it is not a fast-forward, so it needs doing deliberately.`,
                  '',
                  'Reconcile the two sides. Change no behaviour that neither side changed:',
                  'the job is to keep both intentions, not to improve on either.',
                  '',
                  'If the two sides disagree about what the code should DO — not merely',
                  'about text — stop and say so plainly rather than choosing one. A',
                  'conflict resolved by guessing leaves a diff that looks clean and is wrong.',
                  '',
                  'Commit the result on this branch.'
                ].join('\n')
              })
            }),
            el('button', {
              className: 'btn small',
              textContent: 'Read the branch',
              title: 'The Branches tab, on this branch',
              onclick: () => {
                pickedBranch = c.branch
                been.set('branch', pickedBranch)
                forget('branches'); forget('branch-detail')
                showPane('branchcuts', 'repos')
              }
            }))))
      : el('p', { className: 'empty', textContent: 'Nothing is stuck. Everything that is behind origin can be caught up with a sync — the ⟳ buttons on Repos and on Branches.' }))

    // Said on the tab as well, because this is a pane nobody thinks to open:
    // the whole point is that it is empty almost always, and the one time it is
    // not, somebody should not have to go looking.
    const badge = $('conflicts-badge')
    if (badge && changed('conflicts-badge', stuck)) {
      badge.textContent = String(stuck || '')
      badge.classList.toggle('hidden', !stuck)
    }
  }).catch(e => { if (changed('conflicts-bad', String(e.message))) oops(e) })
}

// WHERE EVERY BRANCH STANDS AGAINST ORIGIN, and a way to catch each one up.
//
// The repository card above says what the repository IS. This says what is true
// about it right now, which is a different kind of fact and the one that goes
// stale — so it is the one with buttons on it.
//
// THE REMOTE COLUMN IS AS OLD AS THE LAST FETCH. `refs/remotes/origin/*` is a
// local cache of what origin had when somebody last asked, so a panel that shows
// it without saying so reports "in step" about a repository nobody has checked
// for a week. The note says it, and the sync button is what makes it true.
const syncState = {
  same: null,
  behind: { className: 'badge warn', textContent: 'behind' },
  ahead: { className: 'badge muted', textContent: 'ahead' },
  diverged: { className: 'badge bad', textContent: 'diverged' },
  different: { className: 'badge warn', textContent: 'out of step' },
  'only here': { className: 'badge muted', textContent: 'only here' },
  'only on origin': { className: 'badge muted', textContent: 'only on origin' }
}

// Which of them a fast-forward can actually help. `ahead` and `only here` are
// not problems to be fixed — they are work that has not gone anywhere yet — and
// `diverged` is a decision this app does not make.
const canCatchUp = b => b.state === 'behind' || b.state === 'different'

// THE COLOUR OF THE BUTTON, from the state it is about.
//
//   green   the same commit as origin — nothing to do
//   amber   the button will move it
//   red     both sides moved, so a fast-forward cannot help and somebody has to
//           decide rather than compute. That is the shape a conflict arrives in
//
// A branch that exists on only one side gets no colour at all: it is neither in
// step nor out of step with anything, and painting it green would say "done"
// about work that has never been pushed.
const syncTint = state =>
  state === 'same' ? ' sync-ok'
    : state === 'diverged' ? ' sync-bad'
      : state === 'behind' || state === 'different' || state === 'ahead' ? ' sync-off'
        : ''

// The worst of them, for a button that stands for all of them. Red beats amber
// beats green, because the point of an aggregate is to be honest about the worst
// case rather than average it away.
const worstTint = rows =>
  rows.some(b => b.state === 'diverged') ? ' sync-bad'
    : rows.some(b => canCatchUp(b)) ? ' sync-off'
      : rows.some(b => b.local && b.remote) ? ' sync-ok'
        : ''

// WHAT THIS BRANCH IS, AND WHAT TO DO ABOUT IT — in words, not in git's.
//
// Written for somebody who does not want to think about patch ids. The three
// cases are the three that actually come up, and the middle one is the whole
// reason this exists: work that landed through a squashed pull request reads as
// unmerged everywhere that compares by sha, which is everywhere.
function saysAbout (b) {
  const a = b.against
  const behind = a.behind ? `${a.behind} commit(s) behind ${a.base}` : null

  if (a.state === 'landed') {
    return [
      el('span', { className: 'ok', textContent: `Everything on this branch is already in ${a.base}` }),
      el('span', { className: 'muted', textContent: ' — the commits look different because the pull request was squashed when it merged. Nothing here is unsaved. It can be deleted on the Branches tab.' })
    ]
  }
  if (a.state === 'live') {
    return [
      el('span', { textContent: `${a.unlanded} commit(s) not in ${a.base} yet` }),
      behind ? el('span', { className: 'muted', textContent: ` · ${behind}, so it was cut before the latest work landed` }) : null
    ]
  }
  // Nothing unique and nothing behind is the ordinary resting state of a branch
  // that is simply level, and it needs no sentence at all.
  return behind ? [el('span', { className: 'muted', textContent: `Nothing of its own · ${behind}` })] : []
}

// ASKED EVERY DRAW, DRAWN ONLY WHEN IT MOVED.
//
// The first version guarded the FETCH on the repository name, so it read git
// once per selection — and then sat there stale against anything it had not done
// itself. Syncing a branch from the command line, or from the Branches tab, left
// this panel confidently showing the commit that branch used to be at, which is
// worse than showing nothing: it is the panel whose entire job is saying whether
// two things match.
//
// Two processes for a repository, memoised a second inside repos/branches.js,
// against a draw every few seconds — the same order as the `repositories` call
// this pane already makes on every draw, and far less than the board does. What
// is guarded is the FILL, which is the thing that would flicker and eat a
// selection.
function paintRepoBranches (r) {
  if (!r) {
    if (changed('repo-branches', null)) fill($('repo-branches'), el('p', { className: 'empty', textContent: 'Pick a repository on the left.' }))
    return
  }

  api('repoBranches', { repo: r.repo }).then(({ branches, outOfStep, onlyHere, note }) => {
    // Still the same repository. A slow answer for one somebody has clicked away
    // from would paint the wrong repository's branches under the right title.
    if (pickedRepo !== r.repo) return
    if (!changed('repo-branches', [r.repo, branches])) return

    const sync = (branch, b) => {
      b.disabled = true
      const was = b.textContent
      b.textContent = '…'
      return api('repoSyncBranch', { repo: r.repo, ...(branch ? { branch } : {}) })
        .then(x => {
          say(x.note, x.moved ? 'ok' : 'warn')
          // Everything measured against these moves with them.
          forget('repo-branches'); forget('repos'); forget('repo-detail')
          return draw()
        })
        .catch(oops)
        .finally(() => { b.disabled = false; b.textContent = was })
    }

    fill($('repo-branches'),
      el('div', { className: 'card-title' },
        el('span', { textContent: 'Branches' }),
        // The badge is about what is WRONG. A branch that exists only here is
        // not wrong — it is unpushed work — so it gets a plain count beside the
        // warning rather than being folded into it.
        el('span', { className: outOfStep ? 'badge warn' : 'badge ok', textContent: outOfStep ? `${outOfStep} out of step` : 'in step with origin' }),
        onlyHere ? el('span', { className: 'badge muted', textContent: `${onlyHere} only here` }) : null,
        el('button', {
          className: `plus${worstTint(branches)}`,
          textContent: '⟳',
          title: 'Fetch from origin and fast-forward every branch here that has one. Only fast-forwards.',
          onclick: e => sync(null, e.currentTarget)
        })),

      el('p', { className: 'note', textContent: note }),

      branches.length
        ? branches.map(b => [el('div', { className: 'group-part' },
            el('span', { className: 'mono', textContent: b.branch }),
            el('span', { className: 'where' },
              // HERE, THEN THERE, in that order, because the question is "is
              // mine current" and the answer is read left to right. A dash for
              // the side that has nothing, rather than a blank that reads as a
              // rendering fault.
              el('span', { className: 'mono', textContent: b.local || '—' }),
              el('span', { className: 'muted', textContent: '→' }),
              el('span', { className: 'mono muted', textContent: b.remote || '—' }),
              b.ahead != null || b.behind != null
                ? el('span', { className: 'muted', textContent: `${b.ahead ? `+${b.ahead}` : ''}${b.behind ? ` −${b.behind}` : ''}` })
                : null,
              syncState[b.state] ? el('span', syncState[b.state]) : null,
              el('button', {
                className: `btn small${syncTint(b.state)}`,
                textContent: '⟳',
                disabled: !canCatchUp(b),
                // The reason a row cannot be caught up is the useful part, and
                // it differs per row — which is why this is a title rather than
                // a hidden button.
                title: canCatchUp(b)
                  ? `Fast-forward ${b.branch} to origin`
                  : b.state === 'same' ? 'Already the same commit as origin'
                    : b.state === 'ahead' ? 'It is ahead of origin — there is nothing here to catch up to'
                      : b.state === 'diverged' ? 'It and origin have both moved. This only fast-forwards, so it will not touch it'
                        : b.state === 'only here' ? 'Origin has no branch by this name'
                          : 'There is nothing here to fast-forward',
                onclick: e => sync(b.branch, e.currentTarget)
              }))),
          // WHAT TO DO ABOUT IT, in a sentence, under the row.
          //
          // The shas above answer "is my copy current". This answers the
          // question somebody actually has — am I done with this branch — and
          // it is the one that is genuinely hard to see, because a squashed
          // pull request leaves work that has landed and looks unmerged. See
          // unlandedIn in repos/branches.js.
          b.against ? el('div', { className: 'group-why' }, ...saysAbout(b)) : null]).flat()
        : el('p', { className: 'empty', textContent: 'This repository has no branches.' }))
  }).catch(e => {
    // Said once. This runs on the draw loop now, so reporting a failing repository
    // every three seconds would fill the notice bar with one sentence.
    if (changed('repo-branches-bad', String(e.message))) oops(e)
  })
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
