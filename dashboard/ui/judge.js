'use strict'

// THE JUDGE TAB — reading what came back, and saying whether it holds.
//
// It had nowhere to happen. "Judge it" was a button on the task's own card, so
// the screen that asked for a decision showed the ANSWER and not the question,
// and it was removed rather than moved. This is where it went.
//
// TWO SUB-TABS, because they answer two questions that look alike and are not:
//
//   Judgement   what has been read, what it found, and what is still waiting to
//               be read at all. Built like the task board on purpose — the same
//               three columns in the same order, because it is the same shape of
//               question and somebody should not have to relearn a screen.
//   Judges      the judging library: its own jobs, prompts and contracts, one
//               column per rung. Kept apart from the ones work is done under.
//
// WHERE IT DIFFERS FROM THE BOARD, and it is one column: a task's third column
// is what arrived on its branch, and a judgement can push nothing anywhere. So
// the last column is what it HANDED BACK, which is the only way a judge can say
// anything at all.
//
// A CUT ASKS AND DOES NOT ACT. A change nothing has read appears at the top of
// the first column; nothing runs because it exists. An automatic queue of
// judgements would be work running unattended against somebody's repository with
// nobody having chosen this cut or this chain.

let judgePane = been.get('judge-pane', 'judgements')
let pickedJudgement = been.get('judgement', null)

// DO THE FILE AND THE RECORD AGREE? Two vocabularies for one answer: a judge's
// file ends "RECOMMENDATION: accept|reject" or "CLAIM: true|false|unclear", and
// what it SENDS is accept, reject or pending. Mapped in one place, because a
// screen that read "accept" and "accepted" as a disagreement would cry wolf on
// every row and be ignored on the one that mattered.
//
// A CLAIM IS THE INVERSE, and this is the trap: "CLAIM: true" means the reported
// fault is real, which is a REJECTION of the code as it stands. Getting that
// backwards would flag every honest claim-check as a contradiction.
// WHAT EACH KIND OF SUBJECT IS, in one place. A judgement reads one of exactly
// three things and they are not variations of each other: two are this host's
// own work at different stages, and the third belongs to somebody else.
const WHICH = {
  branch: 'branch cut — the work as it stands',
  cut: 'PR cut — a change proposed for landing',
  pull: 'pull request — somebody else\'s change, which arrived'
}

const SAME = {
  accept: 'accepted',
  reject: 'rejected',
  pending: 'pending',
  true: 'rejected',
  false: 'accepted',
  unclear: 'pending'
}
const sameAnswer = (fromFile, sent) => SAME[String(fromFile).toLowerCase()] === String(sent).toLowerCase()

const JUDGE_BADGE = { queued: 'warn', given: 'run', done: 'muted', draft: 'muted' }
const VERDICT_BADGE = { accepted: 'ok', rejected: 'bad' }
// What a judge concluded, which is not a verdict — see the note in the queue.
const CONCLUDED_BADGE = { accept: 'ok', reject: 'bad', true: 'bad', false: 'ok', unclear: 'warn' }

paneSwitcher('view-judge', () => judgePane, p => { judgePane = p; been.set('judge-pane', p) }, () => paintJudge())

// The three `+` buttons on the Judges pane, and the one on Judgement. Wired once
// at load like every other control here.
$('judge-new').onclick = () => askForOne()
$('judge-job-new').onclick = () => writeRung('job', null)
$('judge-prompt-new').onclick = () => writeRung('prompt', null)
$('judge-contract-new').onclick = () => writeRung('contract', null)

function paintJudge () {
  // THE VIEW GUARD FIRST. The loop runs every few seconds whatever tab is open,
  // and this asks actions that walk every cut and read git.
  if (view !== 'judge') return
  if (judgePane === 'judges') return paintJudges()
  return paintJudgements()
}

// ---- Judgement: the board ---------------------------------------------------

function paintJudgements () {
  if (view !== 'judge' || judgePane !== 'judgements') return

  Promise.all([
    api('judging').catch(() => ({ judgements: [] })),
    api('judgements').catch(() => ({ cuts: [] }))
  ]).then(([mine, cuts]) => {
    if (view !== 'judge' || judgePane !== 'judgements') return

    const list = mine.judgements || []

    // The selection reconciled against what exists, before anything that
    // depends on it is drawn — a judgement can be removed between two draws, and
    // coming back to a ref that is gone is the same stranded state as never
    // having chosen. Same rule as the machines panel.
    if (pickedJudgement && !list.some(j => j.ref === pickedJudgement)) pickedJudgement = null
    if (!pickedJudgement && list.length) pickedJudgement = list[list.length - 1].ref
    been.set('judgement', pickedJudgement)

    if (changed('judge-list', [list.map(j => `${j.ref}${j.state}${j.verdict || ''}${j.concluded || ''}`), pickedJudgement])) {
      // NEWEST FIRST, unlike the queue. A judgement is read about while it is
      // recent; the oldest waiting is what matters in a queue and not here.
      fill($('judge-list'), list.length
        ? el('div', {}, ...[...list].reverse().map(j => el('div', {
          className: `card pick ${j.ref === pickedJudgement ? 'on' : ''}`,
          onclick: () => { pickedJudgement = j.ref; been.set('judgement', j.ref); paintJudgements() }
        },
        el('div', { className: 'card-title' },
          el('span', { textContent: `${j.ref} ${j.title}` }),
          el('span', { className: `badge ${JUDGE_BADGE[j.state] || 'muted'}`, textContent: j.state })),
        el('div', { className: 'card-sub mono', textContent: j.subject ? j.subject.name : '' }),
        j.concluded
          ? el('div', { className: 'card-sub' },
            el('span', { className: `badge ${CONCLUDED_BADGE[j.concluded] || 'muted'}`, textContent: j.concluded }))
          : null,
        j.verdict
          ? el('div', { className: 'card-sub' },
            el('span', { className: `badge ${VERDICT_BADGE[j.verdict] || 'muted'}`, textContent: j.verdict }))
          : null)))
        : el('p', { className: 'empty', textContent: 'Nothing has been read yet. Ask for one with +.' }))
    }

    // ---- what is waiting to be read -------------------------------------
    //
    // WAITING MEANS SOMETHING COULD STILL COME OF IT. Two conditions, and the
    // second was missing on the day this was written:
    //
    //   nothing current has read it  — a cut with a live judgement is not
    //                                  waiting on anybody
    //   it still carries something    — `repos` lists where this line has
    //                                  anything the target does not already
    //                                  have. Empty means merged, reverted or
    //                                  gone: there is nothing left to read, and
    //                                  reading it would be history rather than
    //                                  work.
    //
    // THE SECOND ONE IS ASKED LOCALLY, on purpose. Whether GitHub has merged a
    // pull request is a question for GitHub, and this is drawn every few
    // seconds — so it is answered from the repositories on this host instead,
    // which know perfectly well whether that line still carries anything.
    //
    // The comment here already said this strip must not "say eight things need
    // attention on a host where none do", and then it said exactly that: eight
    // drill cuts, every one merged weeks ago, in a list headed "waiting". A
    // count that is never zero is a count nobody reads.
    const rows = (cuts.cuts || []).filter(c => !c.current && (c.repos || []).length > 0)
    const worth = rows.length > 0
    $('judge-waiting').classList.toggle('hidden', !worth)
    if (worth && changed('judge-waiting', rows.map(c => `${c.id}${c.reads}`))) {
      fill($('judge-waiting'), el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: 'Waiting to be read' }),
          el('span', { className: 'badge warn', textContent: String(rows.length) })),
        el('div', { className: 'card-sub muted', textContent: 'Still carrying something, and nothing current has read it.' }),
        // A ROW, NOT A LINK. These were anchors, which the browser drew in its
        // own blue-then-purple with an underline and wrapped mid-phrase — a
        // control that looks like nothing else in this window and reads as
        // "visited" once pressed. What is wanted is a name and a way to act on
        // it, which is the shape every other list here uses.
        ...rows.slice(0, 6).map(c => el('div', {
          className: 'card-sub',
          style: 'display:flex; align-items:center; gap:8px; justify-content:space-between'
        },
        el('span', { className: 'mono', style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap', title: `${c.source} -> ${c.target}`, textContent: c.source }),
        el('button', {
          className: 'btn',
          textContent: 'Judge it',
          onclick: () => askForOne({ kind: 'cut', source: c.source, target: c.target })
        }))),
        rows.length > 6 ? el('div', { className: 'card-sub muted', textContent: `and ${rows.length - 6} more` }) : null))
    }

    const one = list.find(j => j.ref === pickedJudgement) || null
    setText($('judge-context'), one ? `— ${one.ref}  ${one.subject ? one.subject.name : ''}` : '— nothing selected')
    paintJudgementDetail(one)
    paintHandedBack(one)
  }).catch(() => { /* the chrome says when the dashboard is unreachable */ })
}

function paintJudgementDetail (j) {
  // `run` is in here because a button depends on it. It arrives a tick after
  // `given` does, so a signature without it draws the panel once, correctly, at
  // the one moment there is nothing to watch yet — and then never again.
  if (!changed('judgement-detail', j && `${j.ref}${j.state}${j.verdict || ''}${j.concluded || ''}${j.machine || ''}${j.run || ''}`)) return
  if (!j) return fill($('judge-detail'), el('p', { className: 'empty', textContent: 'Select a judgement.' }))

  fill($('judge-detail'),
    el('table', { className: 'kv' },
      // WHAT IT READ, first, because a judgement is about a change and the
      // change is the thing somebody is holding in their head.
      el('tr', {}, el('th', { textContent: 'reads' }), el('td', { className: 'mono', style: 'user-select:text', textContent: j.subject ? j.subject.name : '' })),
      // THREE KINDS, AND THIS ASKED AN EITHER/OR.
      //
      // Written when there were two, so anything that was not a PR cut was
      // described as a branch cut — and the first judgement of an arrived pull
      // request read "branch cut — the work as it stands" about somebody
      // else's change fetched from GitHub. The row was not empty or obviously
      // broken, which is what makes an either/or over three things worse than
      // no row: it states the wrong one confidently.
      el('tr', {}, el('th', { textContent: 'which is a' }), el('td', {}, el('span', { className: 'muted', textContent: WHICH[(j.subject && j.subject.kind) || 'branch'] || 'something this window does not know about' }))),
      el('tr', {}, el('th', { textContent: 'state' }), el('td', {}, el('span', { className: `badge ${JUDGE_BADGE[j.state] || 'muted'}`, textContent: j.state }))),
      // THE VERDICT IS THE JUDGE'S OWN, and the row says so in whichever way is
      // true. "Nobody has decided yet" was the old model — a judge that
      // recommended and a person who decided — and on a finished worker
      // judgement it described a wait that is never going to end.
      //
      // A worker judge sends its verdict as the last act of its session. If it
      // finished and none arrived, that is a FAULT: the reading happened and the
      // conclusion did not, and nothing downstream can use it. Said as a fault.
      el('tr', {}, el('th', { textContent: 'verdict' }), el('td', {}, j.verdict
        ? el('span', { className: `badge ${VERDICT_BADGE[j.verdict] || 'muted'}`, textContent: j.verdict })
        : j.state !== 'done'
          ? el('span', { className: 'muted', textContent: j.by === 'person' ? 'yours to give, once you have read it' : 'not yet — it has not finished reading' })
          : j.by === 'person'
            ? el('span', { className: 'muted', textContent: 'you have not said yet' })
            : el('span', { className: 'warn', textContent: 'it finished without sending one — the reading happened and the conclusion did not' }))),

      // AND WHAT ITS OWN FILE SAID, shown only when it DISAGREES with what it
      // sent. Two accounts of one judgement agreeing is not worth a row; two
      // accounts disagreeing is the most interesting thing on this screen, and
      // it means the file a person will read says something the record does not.
      j.concluded && j.verdict && !sameAnswer(j.concluded, j.verdict)
        ? el('tr', {}, el('th', { textContent: 'but its file says' }), el('td', {},
          el('span', { className: 'badge warn', textContent: j.concluded }),
          el('span', { className: 'muted', style: 'margin-left:6px', textContent: 'read it — the record and the report do not agree' })))
        : null,
      // CAPPED, BECAUSE A VERDICT NOTE IS NOT ALWAYS A SENTENCE.
      //
      // A person writing one types a line. A JUDGE writing one can put its whole
      // review in here — twelve thousand characters on the first pull request
      // this read — and an uncapped cell then pushes every button in this panel
      // a hundred and fifty thousand characters of markup below the fold. The
      // buttons were all present, all enabled and all unreachable, which is
      // worse than missing: nothing looks broken, so nobody reports it.
      //
      // "console short" is the class this window already uses for text that gets
      // room without taking the panel over. The whole of it is one column to the
      // right, which is where what a judgement handed back is read.
      j.note ? el('tr', {}, el('th', { textContent: 'because' }), el('td', {}, el('div', { className: 'console short', style: 'user-select:text', textContent: j.note }))) : null,
      el('tr', {}, el('th', { textContent: 'judged by' }), el('td', {}, el('span', {
        className: j.by === 'person' ? 'badge warn' : 'badge muted',
        textContent: j.by === 'person' ? 'a person' : 'a worker'
      }))),
      el('tr', {}, el('th', { textContent: 'judge' }), el('td', { className: 'mono', textContent: j.job || (j.by === 'person' ? 'none — a person reads it themselves' : 'none — nothing can run it') })),
      j.contractName ? el('tr', {}, el('th', { textContent: 'under' }), el('td', { textContent: j.contractName })) : null,
      j.question ? el('tr', {}, el('th', { textContent: 'asked about' }), el('td', { style: 'user-select:text', textContent: j.question })) : null,
      j.machine ? el('tr', {}, el('th', { textContent: 'read on' }), el('td', { className: 'mono', textContent: j.machine })) : null,
      j.tag ? el('tr', {}, el('th', { textContent: 'wants a machine tagged' }), el('td', { className: 'mono', textContent: j.tag })) : null),

    // The buttons, under the facts. Queue it if it has not run; record a verdict
    // once it has — and recording one is a person's act, which is why it is here
    // and not in any list a machine can reach.
    el('div', { style: 'margin-top:10px; display:flex; gap:8px; flex-wrap:wrap' },
      j.state === 'draft' && j.job
        ? el('button', { className: 'btn', textContent: 'Queue it', onclick: () => thenSay(() => api('judgementQueue', { id: j.id }), `${j.ref} is queued — it goes ahead of any task waiting.`) })
        : null,
      j.state === 'queued'
        ? el('button', { className: 'btn', textContent: 'Take it back out', onclick: () => thenSay(() => api('judgementUnqueue', { id: j.id }), `${j.ref} is out of the queue.`) })
        : null,
      // ---- WHOEVER JUDGED SAYS ---------------------------------------
      //
      // A worker-judge sends its own verdict at the end of its session, through
      // the job API — the one that READ the change is the one that concludes,
      // and a person transcribing that afterwards would be a second opinion
      // wearing the first one's clothes.
      //
      // So these appear only when the judge is a PERSON. That is a judgement
      // with `by: person` on it: no machine, no run, somebody reading it
      // themselves — and then they are the judge and the verdict is theirs.
      j.by === 'person' && !j.verdict
        ? el('button', { className: 'btn ok', textContent: 'Accept', onclick: () => recordVerdict(j, 'accepted') })
        : null,
      j.by === 'person' && !j.verdict
        ? el('button', { className: 'btn danger', textContent: 'Reject', onclick: () => recordVerdict(j, 'rejected') })
        : null,
      j.by === 'person' && !j.verdict
        ? el('button', { className: 'btn', textContent: 'Could not settle it', onclick: () => recordVerdict(j, 'pending') })
        : null,

      // ---- AND A PERSON READS IT THE WAY THEY READ ANYTHING ELSE ------
      //
      // The same two ways a task's branch is opened: a machine taken, set up on
      // the line, and opened in VS Code or in a terminal here. A person judging
      // needs the code in front of them exactly as a worker-judge does, and
      // there is no reason for them to learn a second route to it.
      //
      // THROUGH branchWorkOn, which is the action that already does this — the
      // machine is borrowed, the queue leaves it alone, and giving it back is
      // vmReturn. A second path to a machine is a second set of rules.
      // NOT WHILE A MACHINE IS READING IT. Opening the change means borrowing a
      // machine and setting it up on the same branch — which the branch claim
      // refuses while a judge holds it, so this would be a button whose only
      // outcome is a refusal. Offered again the moment the reading ends.
      j.subject && j.state !== 'given'
        ? el('button', {
          className: 'btn',
          textContent: 'Open in VS Code',
          onclick: () => openToRead(j, 'editor')
        })
        : null,
      // NOT WHILE A MACHINE IS READING IT. Opening the change means borrowing a
      // machine and setting it up on the same branch — which the branch claim
      // refuses while a judge holds it, so this would be a button whose only
      // outcome is a refusal. Offered again the moment the reading ends.
      j.subject && j.state !== 'given'
        ? el('button', {
          className: 'btn',
          textContent: 'Open a terminal',
          onclick: () => openToRead(j, 'terminal')
        })
        : null,
      // WHILE IT IS READING, THE ONE THING THERE IS TO DO IS LOOK.
      //
      // Every other button here is refused during `given` and correctly so — the
      // machine has the branch and a second borrower would be told no. This one
      // touches nothing: it follows the run's own log, which is the only account
      // of a judge that exists before it hands anything back.
      j.state === 'given' && j.machine && j.run
        ? el('button', {
          className: 'btn',
          textContent: 'Watch it',
          title: `Follows ${j.run} in a terminal. Ctrl-C stops watching, not the reading.`,
          onclick: () => watchRun(j.machine, j.run, j.ref)
        })
        : null,
      // ONLY WHERE THERE IS SOMEBODY TO ANSWER. A judgement of this host's own
      // work is answered by landing it or not; a judgement of a pull request
      // that ARRIVED has an author waiting, and nothing this app does reaches
      // them until somebody presses this.
      j.subject && j.subject.kind === 'pull' && j.state === 'done'
        ? el('button', {
            className: `btn ${j.saidOn ? '' : 'ok'}`,
            textContent: j.saidOn ? 'Say it again' : 'Say it on GitHub',
            title: j.saidOn
              ? `Already said at ${j.saidOn.at} — recommend pulling: ${j.saidOn.recommend}`
              : 'Shows you exactly what would be posted before anything is',
            id: 'judge-say',
            disabled: true,
            onclick: () => askToSayIt(j)
          })
        : null,
      j.state !== 'given'
        ? el('button', { className: 'btn', textContent: 'Throw it away', onclick: () => thenSay(() => api('judgementRemove', { id: j.id }), `${j.ref} is gone. What it found stays on the cut.`) })
        : null))
}

// READ IT BEFORE IT IS PUBLIC, which is the entire reason this is a dialog and
// not a button that posts.
//
// A comment on somebody else's repository cannot be unsent: an edit leaves the
// original in the history and the notification has already gone. So the whole
// body is fetched first and shown in an editor, exactly as it will appear, and
// the confirm button says where it is going rather than "OK".
function askToSayIt (j) {
  api('judgementSay', { id: j.id, preview: true }).then(v => {
    ask({
      title: `Say ${j.ref} on ${v.on}#${v.number}?`,
      plain: [
        `It would appear under the account this host signs in as, in public, on somebody else's repository.`,
        `${v.characters.toLocaleString()} characters, from ${v.from}. Recommend pulling: ${v.recommend}.`,
        'Nothing is merged, changed or pushed by this. It is a comment.',
        j.saidOn ? `${j.ref} was already said at ${j.saidOn.at}. Saying it again adds a second comment; it does not replace the first.` : null
      ].filter(Boolean),
      cost: 'A comment cannot be unsent. Editing it later leaves the original in the history, and the author has already been notified.',
      confirm: `Say it on ${v.on}#${v.number}`,
      onYes: () => api('judgementSay', { id: j.id })
        .then(r => { forget('judge-detail'); paintJudge(); say(r.note) })
        .catch(oops)
    })

    // APPENDED AFTER THE DIALOG IS UP, the way every other dialog carrying text
    // does it: `ask` builds FIELDS, and the comment about to be posted is not a
    // field. The whole of it, with no lid on the height -- this is the one
    // thing in this window that MUST be read before the button under it is
    // pressed, so it is not something to scroll past three lines of.
    const box = document.querySelector('.dlg-body')
    if (box) box.append(codeBlock(v.body, 'markdown'))
  }).catch(oops)
}

// WHAT IT HANDED BACK. The third column, and the judging equivalent of the task
// board's artifact: a judge may not push, so nothing arrives on a branch and
// everything it has to say is a file it handed over.
function paintHandedBack (j) {
  if (!changed('judge-handed', j && `${j.ref}${j.state}`)) return
  if (!j) {
    setText($('judge-handed-context'), '')
    return fill($('judge-handed'), el('p', { className: 'empty', textContent: 'Select a judgement.' }))
  }

  api('judgementFindings', { id: j.id }).then(said => {
    if (pickedJudgement !== j.ref) return
    const files = said.files || []
    setText($('judge-handed-context'), files.length ? `— ${files.length} file(s)` : '')

    // AND THE BUTTON THAT NEEDS THIS ANSWER. It is drawn by the panel beside
    // this one, which has no way of knowing whether anything came back.
    const say = $('judge-say')
    if (say) {
      say.disabled = !files.length
      say.title = files.length
        ? 'Shows you exactly what would be posted before anything is'
        : 'It handed nothing back, so there is no review to post.'
    }
    fill($('judge-handed'), files.length
      ? el('div', {}, ...files.map(f => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: f.name }),
          el('span', { className: 'badge muted', textContent: `${Math.max(1, Math.round((f.bytes || 0) / 1024))} KB` })),
        el('button', {
          className: 'btn',
          style: 'margin-top:8px',
          textContent: 'Read it',
          onclick: () => api('judgementFindings', { id: j.id, file: f.name })
            .then(one => {
              ask({
                title: `${j.ref} — ${f.name}`,
                plain: [`What ${j.ref} found reading ${j.subject ? j.subject.name : 'this change'}.`],
                confirm: 'Close'
              })
              // APPENDED AFTER THE DIALOG IS UP, the way every other dialog
              // carrying text does it: `ask` builds FIELDS, and a page of
              // findings is not a field. `extra` is a second BUTTON — passing a
              // node to it drew a blank one and showed nothing.
              const body = document.querySelector('.dlg-body')
              if (body) body.append(codeBlock(one.text || '', 'markdown', { max: 40 }))
            })
            .catch(e => say(e.message, 'bad'))
        }))))
      // SAID PLAINLY, because it is an answer rather than an absence: a judge
      // that read a change and handed nothing back has told this host nothing,
      // and that is a fact about the judgement rather than a gap in the screen.
      : el('p', { className: 'empty', textContent: said.note || 'Nothing handed back.' }))
  }).catch(() => { /* said in the panel above */ })
}

// OPENING THE CHANGE TO READ IT YOURSELF.
//
// A judgement's subject is a branch cut or a PR cut; either way the code lives
// on a branch, and for a cut that is the line the pull requests were opened
// from. So both resolve to one branch to set a machine up on — the same one a
// worker-judge would be given.
//
// IT DOES NOT MARK THE JUDGEMENT AS RUNNING. Nothing is dispatched here: a
// person is borrowing a machine to look, and the judgement stays exactly where
// it was until they say what they think.
function openToRead (j, how) {
  const branch = j.subject.kind === 'cut' ? j.subject.source : j.subject.branch
  ask({
    title: how === 'terminal' ? 'Open a terminal on it' : 'Open it in VS Code',
    plain: [
      `A machine is taken, rolled back, and set up on "${branch}" — the change ${j.ref} is about.`,
      'It is yours until you give it back with vmReturn. The queue will not touch it while you have it.',
      'Nothing about the judgement changes: read it, then say what you think on its card.'
    ],
    confirm: how === 'terminal' ? 'Open a terminal' : 'Open VS Code',
    onYes: async () => {
      const said = await api('branchWorkOn', { branch, open: how })
      say(said.note || `${said.name || 'a machine'} is set up on ${branch}.`)
    }
  })
}

// A person's verdict, which is the one thing in this whole flow that is nobody
// else's. A rejection needs a reason — the action refuses one without.
function recordVerdict (j, verdict) {
  ask({
    title: `${verdict === 'accepted' ? 'Accept' : 'Reject'} ${j.ref}`,
    plain: [
      `${j.ref} read ${j.subject ? j.subject.name : 'this change'}${j.concluded ? ` and recommended "${j.concluded}"` : ''}.`,
      verdict === 'rejected'
        ? 'Say why. Nothing is automatically re-run — this note is the whole of what survives, and it is what somebody writes the next task from.'
        : 'A note is optional here.'
    ],
    fields: [{ name: 'note', label: verdict === 'rejected' ? 'Why' : 'Note (optional)' }],
    confirm: verdict === 'accepted' ? 'Accept it' : 'Reject it',
    danger: verdict === 'rejected',
    onYes: async f => {
      const said = await api('judgementVerdict', { id: j.id, verdict, note: f.note })
      say(said.note)
      paintJudgements()
    }
  })
}

// Named for what it is rather than `run`, which is a word every other file in
// this shared scope could reasonably want.
const thenSay = (fn, ok) => fn().then(() => { say(ok); paintJudgements() }).catch(e => say(e.message, 'bad'))

// ---- asking for one ---------------------------------------------------------

// WHAT IS READ IS A LINE OR A CUT, and the dialog asks in those words rather
// than making somebody know which internal shape they mean. Prefilled when it is
// started from a change that is waiting.
function askForOne (about = null) {
  Promise.all([
    api('jobs', { kind: 'judge' }).catch(() => ({ jobs: [] })),
    api('branchBoard').catch(() => ({ branches: [] })),
    api('judgements').catch(() => ({ cuts: [] })),
    api('pools').catch(() => ({ pools: [] }))
  ]).then(([{ jobs }, board, cuts, pools]) => {
    const usable = (jobs || []).filter(j => j.runnable)
    if (!usable.length) {
      return say('No judge can run yet. A judge is a job, a prompt and a contract, and each has to be read and approved — see the Judges tab for which rung is missing.', 'bad')
    }

    // Every branch that is cut, and every PR cut, in one list. The value carries
    // which kind it is so nothing has to be inferred from the shape of a name.
    const subjects = [
      ...(board.branches || []).filter(b => b.cut && !b.protected).map(b => ({ value: `branch:${b.name}`, label: `${b.name} — branch cut` })),
      // ENCODED AS JSON, not joined with a separator. A line name can contain a
      // space — "testing2 line" is one — so anything split on one loses half of
      // it and files the judgement against a cut that does not exist.
      ...(cuts.cuts || []).map(c => ({ value: `cut:${JSON.stringify([c.source, c.target])}`, label: `${c.source} -> ${c.target} — PR cut` }))
    ]
    if (!subjects.length) return say('There is nothing to read: no branch has been cut and nothing has been sent out.', 'bad')

    const prefill = about && about.kind === 'cut'
      ? `cut:${JSON.stringify([about.source, about.target])}`
      : about && about.branch ? `branch:${about.branch}` : subjects[0].value
    const kinds = [...new Set((pools.pools || []).map(p => p.tag))]

    ask({
      title: 'Ask for a judgement',
      plain: [
        'A judgement reads a change and says whether it holds — whether it followed the rules, whether it is secure, and whether it hides a bug nobody caught.',
        'It changes nothing and may not push to what it reads. What it finds it hands back as a file.',
        'It goes ahead of any task waiting, because it reads work that is already waiting to land.'
      ],
      fields: [
        { name: 'subject', label: 'What it reads', value: prefill, options: subjects },
        { name: 'job', label: 'Which judge', value: usable[0].id, options: usable.map(j => ({ value: j.id, label: `${j.name} — ${j.prompt ? j.prompt.name : 'no prompt'}` })) },
        {
          name: 'question',
          label: 'What to ask it (optional)',
          hint: 'For a judge that checks a claim, paste the issue here in full. It sees nothing you do not hand it.'
        },
        {
          name: 'tag',
          label: 'On a machine tagged (optional)',
          value: '',
          options: [{ value: '', label: 'any free machine' }, ...kinds.map(t => ({ value: t, label: t }))]
        }
      ],
      confirm: 'Ask for it',
      onYes: async f => {
        // Split ONCE: a branch name contains colons often enough, and the
        // rest of the value is the payload whatever is in it.
        const chose = String(f.subject)
        const kind = chose.slice(0, chose.indexOf(':'))
        const rest = chose.slice(chose.indexOf(':') + 1)
        const args = kind === 'cut'
          ? (([source, target]) => ({ kind: 'cut', source, target }))(JSON.parse(rest))
          : { kind: 'branch', branch: rest }

        const mine = f.by === 'person'
        const made = await api('judgementCreate', {
          ...args,
          by: mine ? 'person' : 'worker',
          // A person's judgement takes no job: there is no machine, no run and
          // nothing to dispatch. A chain exists to tell a WORKER what to look
          // for, and somebody reading it themselves is not being instructed.
          job: mine ? undefined : f.job,
          question: f.question || undefined,
          tag: mine ? undefined : (f.tag || undefined)
        })
        // NOT QUEUED WHEN IT IS YOURS. The queue would give it to a machine and
        // run a worker over the change you said you would read — judgementQueue
        // refuses it for exactly that reason, and asking anyway would be this
        // window walking into a refusal it already knew about.
        if (!mine) await api('judgementQueue', { id: made.id })
        pickedJudgement = made.ref
        been.set('judgement', made.ref)
        say(mine
          ? `${made.ref} is yours to read. Open it in VS Code or a terminal from its card, then say what you think.`
          : `${made.ref} is queued — it goes ahead of any task waiting.`)
        paintJudgements()
      }
    })
  }).catch(e => say(e.message, 'bad'))
}

// ---- Judges: the library ----------------------------------------------------

function paintJudges () {
  if (view !== 'judge' || judgePane !== 'judges') return

  // THE JUDGING LIBRARY ONLY. A judge's job, prompt and contract are kept apart
  // from the ones work is done under — "did this follow the rules, is it secure,
  // what bug was missed" is a different question written under different rules,
  // and a list that mixed them would be a list somebody picks wrongly from once.
  Promise.all([
    api('jobs', { kind: 'judge' }).catch(() => ({ jobs: [] })),
    api('prompts', { kind: 'judge' }).catch(() => ({ prompts: [], contracts: [] }))
  ]).then(([{ jobs }, { prompts, contracts }]) => {
    if (view !== 'judge' || judgePane !== 'judges') return
    if (!changed('judge-chains', [jobs, prompts, contracts])) return

    const words = new Map((prompts || []).map(p => [p.id, p]))
    const list = (jobs || []).map(j => ({ ...j, words: j.promptId ? words.get(j.promptId) || null : null }))

    rungs('judge-jobs', jobs || [], j => ({
      title: j.name || j.id,
      approved: j.approved,
      lines: [j.about, j.promptId ? `runs "${j.promptId}"` : 'no prompt — it would say nothing to a worker'],
      open: () => writeRung('job', j),
      of: 'job'
    }))

    rungs('judge-prompts', prompts || [], p => ({
      title: p.name || p.id,
      approved: p.approved,
      lines: [p.about, p.contractId ? `under "${p.contractId}"` : 'no contract — nothing says what it may not do'],
      open: () => writeRung('prompt', p),
      of: 'prompt'
    }))

    rungs('judge-contracts', contracts || [], c => ({
      title: c.name || c.id,
      approved: c.approved,
      lines: [c.about, `${c.lines || 0} lines`],
      open: () => writeRung('contract', c),
      of: 'contract'
    }))

    for (const [where, what] of [['judge-jobs', jobs || []], ['judge-prompts', prompts || []], ['judge-contracts', contracts || []]]) {
      const waiting = what.filter(x => !x.approved).length
      setText($(`${where}-context`), what.length ? (waiting ? `— ${waiting} to read` : '— all approved') : '')
    }

    fill($('judge-chains'), list.length
      ? el('div', {}, ...list.map(j => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: j.name || j.id }),
          el('span', { className: `badge ${j.runnable ? 'ok' : 'warn'}`, textContent: j.runnable ? 'can judge' : 'cannot run' })),
        el('table', { className: 'kv' },
          el('tr', {}, el('th', { textContent: 'job' }), el('td', {}, badgeFor(j.id, j.approved))),
          el('tr', {}, el('th', { textContent: 'prompt' }), el('td', {}, j.prompt
            ? badgeFor(j.prompt.name || j.prompt.id, j.prompt.approved)
            : el('span', { className: 'muted', textContent: 'none — a job with no prompt says nothing to a worker' }))),
          // FROM THE PROMPT LIBRARY. A contract belongs to the prompt, not the
          // job — the chain runs job <- prompt <- contract in one direction, and
          // this row is the last rung of it.
          el('tr', {}, el('th', { textContent: 'contract' }), el('td', {}, j.words && j.words.contract
            ? badgeFor(j.words.contract.name || j.words.contract.id, j.words.contract.approved)
            : j.words && j.words.missingContract
              ? el('span', { className: 'warn', textContent: `names "${j.words.contractId}", which is not in the library` })
              : el('span', { className: 'muted', textContent: 'none — nothing says what it may not do' })))),
        j.runnable ? null : el('div', { className: 'card-sub warn', textContent: j.whyNot || 'something in its chain is not approved' }))))
      : el('p', { className: 'empty', textContent: 'No judge yet. A judge is its own job, prompt and contract — written for reading a change rather than making one.' }))

    const can = list.filter(j => j.runnable).length
    setText($('judges-note'), list.length
      ? `${can} of ${list.length} can judge. A judge is the whole chain — this job, giving these words, under these rules — and every rung is read and approved by a person before anything runs.`
      : 'A judge reads a change and says whether it holds: did it follow the rules, is it secure, is there a bug nobody caught. Its chain is its own — a job written for work cannot judge, and a judge cannot be given work.')
  }).catch(() => { /* the chrome says when the dashboard is unreachable */ })
}

// ONE COLUMN OF RUNGS, drawn the same way for all three. Three copies of this
// drifted within a minute of being written, which is the argument for the shape
// rather than for the saving.
function rungs (where, list, describe) {
  fill($(where), list.length
    ? el('div', {}, ...list.map(x => {
      const row = describe(x)
      return el('div', { className: 'card pick', onclick: row.open },
        el('div', { className: 'card-title' },
          el('span', { textContent: row.title }),
          el('span', { className: `badge ${row.approved ? 'ok' : 'warn'}`, textContent: row.approved ? 'approved' : 'to read' })),
        ...row.lines.filter(Boolean).map(t => el('div', { className: 'card-sub muted', textContent: t })))
    }))
    // NOT AN ERROR, AND SAID AS SUCH. An empty judging library is the ordinary
    // state of a host that has not started judging yet.
    : el('p', { className: 'empty', textContent: 'None yet — write one with +.' }))
}

// ---- writing a rung ---------------------------------------------------------

const RUNG = {
  job: { save: 'jobSave', forget: 'jobForget', approve: 'jobApprove', withdraw: 'jobWithdraw', body: 'code', mode: 'javascript', what: 'Job' },
  prompt: { save: 'promptSave', forget: 'promptForget', approve: 'promptApprove', withdraw: 'promptWithdraw', body: 'text', mode: 'markdown', what: 'Prompt' },
  contract: { save: 'contractSave', forget: 'contractForget', approve: 'contractApprove', withdraw: 'contractWithdraw', body: 'text', mode: 'markdown', what: 'Contract' }
}

// WRITE ONE, READ ONE, OR THROW ONE AWAY — one dialog, because they are the same
// three fields and a name, and three dialogs would drift.
//
// SAVED AT THE WINDOW IS APPROVED BY WHOEVER WROTE IT: writing it here IS the
// reading. That rule lives in the actions and is not restated here; what this
// must not do is offer any way to approve something that arrived down a pipe,
// which is why there is no approve button for anything except what is on screen
// in front of somebody.
function writeRung (kind, it) {
  const K = RUNG[kind]

  Promise.all([
    kind === 'job' ? api('prompts', { kind: 'judge' }).catch(() => ({ prompts: [] })) : Promise.resolve({ prompts: [] }),
    kind === 'prompt' ? api('contracts', { kind: 'judge' }).catch(() => ({ contracts: [] })) : Promise.resolve({ contracts: [] }),
    it && kind === 'job' ? api('job', { id: it.id }).catch(() => null) : Promise.resolve(null)
  ]).then(([p, c, full]) => {
    const body = full ? (full.job || full).code : (it ? it[K.body] : '')
    let editor = null

    const fields = [{ name: 'name', label: 'Name', value: it ? it.name : '' }]
    fields.push({ name: 'about', label: 'What it is for', value: it ? (it.about || '') : '' })
    if (kind === 'job') {
      fields.push({
        name: 'promptId',
        label: 'The prompt it runs',
        value: it ? (it.promptId || '') : '',
        options: [{ value: '', label: 'none' }, ...(p.prompts || []).map(x => ({ value: x.id, label: x.name }))]
      })
    }
    if (kind === 'prompt') {
      fields.push({
        name: 'contractId',
        label: 'The contract it runs under',
        value: it ? (it.contractId || '') : '',
        options: [{ value: '', label: 'none' }, ...(c.contracts || []).map(x => ({ value: x.id, label: x.name }))]
      })
    }

    ask({
      title: it ? `${K.what} — ${it.name}` : `Write a judging ${kind}`,
      plain: it
        ? [
            it.approved
              ? 'Approved. Editing it takes that back — what a judge is told is read before it runs, every time it changes.'
              : 'Not approved yet, so nothing can run it. Saving it here approves it: writing it at the window IS the reading.'
          ]
        : [`This is the judging library, kept apart from the one work is done under. A ${kind} written here cannot be given to a task.`],
      fields,
      // THROWING ONE AWAY IS THE OTHER THING YOU MIGHT HAVE COME TO DO, which
      // is exactly what `extra` is for: one more button beside the confirm, for
      // the case that is not a variation of it but its opposite. It closes this
      // dialog and asks on its own screen.
      extra: it
        ? {
            label: 'Throw it away',
            danger: true,
            onClick: () => ask({
              title: `Throw away "${it.name}"?`,
              plain: [
                'Nothing that already ran is touched — a judgement carries its own copy of what it was read under.',
                'Anything still pointing at this stops being runnable and says so.'
              ],
              confirm: 'Throw it away',
              danger: true,
              onYes: async () => {
                await api(K.forget, { id: it.id })
                say(`"${it.name}" is gone.`)
                paintJudges()
              }
            })
          }
        : null,
      confirm: it ? 'Save it' : 'Write it',
      onYes: async f => {
        const payload = { id: it ? it.id : undefined, name: f.name, about: f.about, kind: 'judge' }
        payload[K.body] = editor ? editor.getValue() : body
        if (kind === 'job') payload.promptId = f.promptId || ''
        if (kind === 'prompt') payload.contractId = f.contractId || ''
        const saved = await api(K.save, payload)
        say(`"${saved.name}" is ${saved.approved ? 'saved and approved' : 'saved, and waiting to be read'}.`)
        paintJudges()
      }
    })

    // APPENDED AFTER THE DIALOG IS UP, the way every other dialog carrying code
    // does it — `ask` builds fields, and an editor is not a field.
    const at = document.querySelector('.dlg-body')
    if (at) {
      at.append(el('label', { textContent: kind === 'job' ? 'The script' : 'The words' }))
      at.append(editorBlock(body || '', K.mode, { edit: true, min: 8, max: 30, onReady: ed => { editor = ed } }))
      // WITHDRAWING IS NOT THROWING AWAY, and it belongs beside what is being
      // read rather than in the row of ways out: it changes what this thing IS
      // — unapproved, unrunnable — and leaves it exactly where it was.
      if (it && it.approved) {
        at.append(el('button', {
          className: 'btn',
          style: 'margin-top:8px',
          textContent: 'Withdraw approval',
          onclick: async () => {
            document.querySelectorAll('.dlg-overlay').forEach(o => o.remove())
            try {
              await api(K.withdraw, { id: it.id })
              say(`"${it.name}" is no longer approved — nothing can run it until it is read again.`)
              paintJudges()
            } catch (e) { say(e.message, 'bad') }
          }
        }))
      }
    }
  }).catch(e => say(e.message, 'bad'))
}

// A rung, said the same way in every row: what it is called, and whether it has
// been read. Written once because three copies of it drifted within a minute.
const badgeFor = (name, approved) => el('span', {},
  el('span', { className: 'mono', textContent: String(name) }),
  el('span', { className: `badge ${approved ? 'ok' : 'warn'}`, style: 'margin-left:6px', textContent: approved ? 'approved' : 'not approved' }))
