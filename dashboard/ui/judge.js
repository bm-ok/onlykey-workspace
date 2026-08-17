'use strict'

// THE JUDGE TAB — reading what came back, and saying whether it holds.
//
// It had nowhere to happen. "Judge it" was a button on the task's own card, so
// the screen that asked for a decision showed the ANSWER and not the question,
// and it was removed rather than moved. This is where it went.
//
// TWO SUB-TABS, because they answer two questions that look alike and are not:
//
//   Judgement   what has been asked for, what is being read, what was decided —
//               and beside it the changes that are waiting to be read at all.
//               This is what makes judging something you can be BEHIND ON.
//   Judges      the chains that can do the judging: this job, giving these
//               words, under these rules. The library lists the three one at a
//               time because that is how each is written and approved; picking
//               one from three lists asks somebody to recombine in their head
//               what this app already knows.
//
// A CUT ASKS AND DOES NOT ACT. An open cut appears on the right as something
// waiting; nothing runs because it exists. An automatic queue of judgements
// would be work running unattended against somebody's repository, reporting
// outward, with nobody having chosen this cut or this chain — the same thing
// this app already refuses about approving a job down a pipe. Asking is free;
// acting is a decision, and the decision is a button.

let judgePane = been.get('judge-pane', 'judgements')

const JUDGE_BADGE = { queued: 'warn', given: 'run', done: 'muted', draft: 'muted' }
const VERDICT_BADGE = { accepted: 'ok', rejected: 'bad' }

// Wired once, at load, like every other sub-tab bar. `paneSwitcher` is declared
// in ui/tasks.js, which loads before this — see the order in ui/load.js, which
// is not a preference.
paneSwitcher('view-judge', () => judgePane, p => { judgePane = p; been.set('judge-pane', p) }, () => paintJudge())

function paintJudge () {
  // THE VIEW GUARD FIRST. The loop runs every few seconds whatever tab is open,
  // and this asks two actions, one of which walks every cut and reads git.
  if (view !== 'judge') return
  if (judgePane === 'judges') return paintJudges()
  return paintJudgements()
}

function paintJudgements () {
  if (view !== 'judge' || judgePane !== 'judgements') return

  Promise.all([
    api('judging').catch(() => ({ judgements: [] })),
    api('judgements').catch(() => ({ cuts: [] }))
  ]).then(([mine, cuts]) => {
    if (view !== 'judge' || judgePane !== 'judgements') return
    if (!changed('judge-judgements', [mine, cuts])) return

    const list = mine.judgements || []

    // ASKED FOR, newest first — a judgement is read about while it is recent,
    // unlike a task board where the oldest waiting is what matters.
    fill($('judge-list'), list.length
      ? el('div', {}, ...[...list].reverse().map(j => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: `${j.ref} ${j.title}` }),
          el('span', { className: `badge ${JUDGE_BADGE[j.state] || 'muted'}`, textContent: j.state })),
        el('div', { className: 'card-sub mono', textContent: j.subject ? j.subject.name : '' }),
        // WHAT IT WAS READ UNDER, because a verdict means nothing without it.
        j.job
          ? el('div', { className: 'card-sub muted', textContent: `${j.job}${j.contractName ? ` under "${j.contractName}"` : ''}` })
          : el('div', { className: 'card-sub muted', textContent: 'no job — nothing can run it' }),
        j.verdict
          ? el('div', { className: 'card-sub' },
            el('span', { className: `badge ${VERDICT_BADGE[j.verdict] || 'muted'}`, textContent: j.verdict }),
            el('span', { className: 'muted', style: 'margin-left:6px', textContent: j.note || '' }))
          : null,
        j.machine && j.state === 'given'
          ? el('div', { className: 'card-sub muted', textContent: `reading on ${j.machine}` })
          : null)))
      : el('p', { className: 'empty', textContent: 'Nothing has been asked for. A judgement reads a branch cut or a PR cut — start one from a change on the right.' }))

    // WHAT IS WAITING TO BE READ. Every cut, with what is known about it: none,
    // one that describes what is there, or one that predates the last push —
    // which is exactly as unjudged as none, and says so.
    const rows = cuts.cuts || []
    fill($('judge-subjects'), rows.length
      ? el('div', {}, ...rows.map(c => el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: c.title || c.source }),
          el('span', {
            className: `badge ${c.current ? 'ok' : c.stale ? 'warn' : 'muted'}`,
            textContent: c.reads
          })),
        el('div', { className: 'card-sub mono', textContent: `${c.source} -> ${c.target}` }),
        el('div', { className: 'card-sub muted', textContent: (c.repos || []).join(', ') || 'nothing behind it any more' }),
        // THE BUTTON IS THE DECISION. A cut asks; a person presses.
        el('button', {
          className: 'btn',
          style: 'margin-top:8px',
          textContent: 'Ask for a judgement',
          onclick: () => askFor(c)
        }))))
      : el('p', { className: 'empty', textContent: 'Nothing has been sent out yet, so there is no cut waiting to be read.' }))

    const waiting = list.filter(j => j.state === 'queued').length
    const running = list.filter(j => j.state === 'given').length
    setText($('judge-context'), list.length ? `— ${waiting} waiting, ${running} being read, ${list.filter(j => j.state === 'done').length} decided` : '')
  }).catch(() => { /* the chrome says when the dashboard is unreachable */ })
}

// Asking for one is a dialog rather than a straight call, because a judgement
// needs a chain and picking it is the decision. The list offered is the runnable
// ones only — a chain with an unapproved rung cannot judge anything, and
// offering it would mean a refusal after the press instead of before.
function askFor (cut) {
  api('jobs').then(({ jobs }) => {
    const usable = (jobs || []).filter(j => j.runnable)
    if (!usable.length) {
      return say('No job can run yet. A judge is a job, a prompt and a contract, and each has to be read and approved — see the Judges tab for which rung is missing.')
    }
    ask({
      title: `Judge ${cut.source} -> ${cut.target}`,
      plain: [
        'A judgement reads the change and says whether it holds — whether it followed the rules, whether it is secure, and whether it hides a bug nobody caught.',
        'It may not push to what it reads. Whatever it finds it hands back as files, filed under the judgement.',
        'It goes ahead of any task waiting, because it reads work that is already waiting to land.'
      ],
      fields: [
        {
          name: 'job',
          label: 'The judge',
          value: usable[0].id,
          options: usable.map(j => ({ value: j.id, label: `${j.name} — ${j.prompt ? j.prompt.name : 'no prompt'}` }))
        },
        {
          name: 'tag',
          label: 'On a machine tagged',
          hint: 'Leave it empty and it takes any free machine. A tag makes it wait for that kind rather than take another.'
        }
      ],
      confirm: 'Ask for it',
      onYes: async f => {
        const made = await api('judgementCreate', {
          kind: 'cut', source: cut.source, target: cut.target, job: f.job, tag: f.tag || undefined
        })
        await api('judgementQueue', { id: made.id })
        say(`${made.ref} is queued — it goes ahead of any task waiting.`)
        paintJudge()
      }
    })
  }).catch(e => say(e.message))
}

function paintJudges () {
  if (view !== 'judge' || judgePane !== 'judges') return

  // BOTH LIBRARIES, because the chain spans them. `jobs` says which prompt a job
  // runs and whether it is approved; the CONTRACT hangs off the prompt, and only
  // the prompt library reports it. Reading `j.prompt.contract` off the jobs
  // answer drew "contract: none" for every chain — including one whose contract
  // is right there and named on every judgement written from it. A screen whose
  // whole subject is approvals cannot be wrong about a rung.
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

    // ---- one column per rung ------------------------------------------------
    //
    // READ AND APPROVED IS THE WHOLE JOB HERE. A judge decides whether somebody
    // else's work holds, so what it is told and what it may not do are read by a
    // person before it runs — and a model may write one and may not ratify its
    // own. That rule is enforced in the actions; these are where it happens.
    rungs('judge-jobs', jobs || [], j => ({
      title: j.name || j.id,
      approved: j.approved,
      lines: [j.about, j.promptId ? `runs "${j.promptId}"` : 'no prompt — it would say nothing to a worker'],
      read: () => readIt(`Job — ${j.name}`, j.code || '', 'javascript', j, 'jobApprove'),
      of: 'job'
    }))

    rungs('judge-prompts', prompts || [], p => ({
      title: p.name || p.id,
      approved: p.approved,
      lines: [p.about, p.contractId ? `under "${p.contractId}"` : 'no contract — nothing says what it may not do'],
      read: () => readIt(`Prompt — ${p.name}`, p.text || '', 'markdown', p, 'promptApprove'),
      of: 'prompt'
    }))

    rungs('judge-contracts', contracts || [], c => ({
      title: c.name || c.id,
      approved: c.approved,
      lines: [c.about, `${c.lines || 0} lines`],
      read: () => readIt(`Contract — ${c.name}`, c.text || '', 'markdown', c, 'contractApprove'),
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
        // ONE COLUMN PER RUNG, in the order the chain reads: the job runs the
        // prompt, the prompt is held to the contract.
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
        // WHICH RUNG IS MISSING, in the app's own words. `whyNot` names the one
        // that is wrong rather than saying "not approved" about the whole chain.
        j.runnable ? null : el('div', { className: 'card-sub warn', textContent: j.whyNot || 'something in its chain is not approved' }))))
      : el('p', { className: 'empty', textContent: 'No judge yet. A judge is its own job, prompt and contract — written for reading a change rather than making one, and kept apart from the library work runs under.' }))

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
      return el('div', {
        className: 'card',
        onclick: row.read,
        style: 'cursor:pointer'
      },
      el('div', { className: 'card-title' },
        el('span', { textContent: row.title }),
        el('span', { className: `badge ${row.approved ? 'ok' : 'warn'}`, textContent: row.approved ? 'approved' : 'to read' })),
      ...row.lines.filter(Boolean).map(t => el('div', { className: 'card-sub muted', textContent: t })))
    }))
    // NOT AN ERROR, AND SAID AS SUCH. An empty judging library is the ordinary
    // state of a host that has not started judging yet.
    : el('p', { className: 'empty', textContent: 'None yet.' }))
}

// READ IT, THEN DECIDE. Approving happens at the window and nowhere else — the
// actions refuse it over the wire — so this is the one place a judging chain
// becomes runnable, and it puts the text in front of somebody first.
function readIt (title, text, mode, it, approveWith) {
  ask({
    title,
    plain: [
      it.about || '',
      it.approved
        ? 'Approved. Withdrawing it stops anything using it until it is read again.'
        : 'Not approved yet — nothing can run until it is. Read it, then approve it.'
    ].filter(Boolean),
    extra: codeBlock(text, mode, { max: 30 }),
    confirm: it.approved ? 'Withdraw it' : 'Approve it',
    danger: it.approved,
    onYes: async () => {
      const call = it.approved ? approveWith.replace('Approve', 'Withdraw') : approveWith
      await api(call, { id: it.id })
      say(it.approved ? `"${it.name}" is no longer approved.` : `"${it.name}" is approved.`)
      paintJudge()
    }
  })
}

// A rung, said the same way in every row: what it is called, and whether it has
// been read. Written once because three copies of it drifted within a minute.
const badgeFor = (name, approved) => el('span', {},
  el('span', { className: 'mono', textContent: String(name) }),
  el('span', { className: `badge ${approved ? 'ok' : 'warn'}`, style: 'margin-left:6px', textContent: approved ? 'approved' : 'not approved' }))
