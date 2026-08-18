'use strict'

// THE TWO PICTURES, AS DATA.
//
// The window draws them; this decides what is in them. That split is on purpose
// and it is the same one the rest of this app keeps: an action answers a
// question, and drawing is somebody else's job. It also means both pictures can
// be read from the command line, which is how they were checked before either
// canvas existed.
//
// NEITHER OF THESE KNOWS ANYTHING NEW. Every fact here is already recorded
// somewhere — the board, the judgements, the event stream — and a picture that
// needed its own bookkeeping would be a second version of the truth that goes
// stale in its own way. What these do is JOIN what is already written down, and
// the join is the whole value: five tables show a branch, a task, a machine, a
// judgement and a pull request, and not one of them shows that they are the same
// thing at different points.

const actions = require('./table')
const s = require('./shared')
const { judging, events, vms, supervisor } = s

// A picture is nodes and wires. Columns are left-to-right in the order things
// happen; rows keep separate stories apart.
const node = (id, kind, title, lines, column, row) => ({
  id,
  kind,
  title,
  lines: (lines || []).filter(Boolean),
  column,
  row
})

// HOW MANY STORIES AT ONCE. A picture of everything that ever happened is not a
// picture, it is an archive with no index -- and a canvas with two hundred cards
// on it is slower to read than the table it was meant to improve on.
const MOST = 8

module.exports = {
  workGraph: {
    about: 'The picture behind Repositories -> Graph: a branch, the task cut from it, the machine, the judgement, the pull request',
    needs: 'workspace',
    takes: ['branch', 'most'],
    run: async ({ branch = null, most = MOST }) => {
      const board = (await actions.tasks.run({})).tasks || []
      const judged = judging.read() || []
      const machines = vms.read() || []
      const onMachine = new Map(machines.map(v => [v.name, v]))

      // ---- what counts as a story, and in what order --------------------
      //
      // BY BRANCH, because that is what all of this is about: a task is work on
      // one, a judgement is a reading of one, a pull request is one leaving.
      //
      // IN FLIGHT FIRST. A picture of what is happening has to lead with what is
      // happening; what finished last week is context, and context goes below.
      // AND A STORY IS NOT ALWAYS A BRANCH. A judgement can be about an
      // ARRIVED PULL REQUEST -- `{ kind: 'pull', on, number, sha }` -- which
      // has no branch here at all, because the change is on somebody else's
      // fork. Drawn as a branch it read as one:
      //
      //     col0 [branch] bmatusiak/local-repo-a#13@8e0e268
      //
      // which is not a branch, is not in this workspace, and is the one kind
      // of subject where that distinction decides what may happen to it.
      const stories = new Map()
      const touch = (name, when, live, kind) => {
        if (!name) return null
        const had = stories.get(name) || { branch: name, when: null, live: false, kind: kind || 'branch' }
        if (kind && kind !== 'branch') had.kind = kind
        if (!had.when || String(when || '') > had.when) had.when = when || had.when
        had.live = had.live || !!live
        stories.set(name, had)
        return had
      }

      const busy = t => t.state === 'given' || t.state === 'queued'
      for (const t of board) touch(t.branch, t.updated || t.created, busy(t))
      for (const j of judged) {
        const on = j.subject && (j.subject.branch || j.subject.name)
        touch(on, j.touched || j.written, j.state === 'given' || j.state === 'queued', j.subject && j.subject.kind)
      }

      let wanted = [...stories.values()]
      if (branch) wanted = wanted.filter(x => x.branch === String(branch))
      wanted.sort((a, b) => (b.live - a.live) || String(b.when || '').localeCompare(String(a.when || '')))
      const showing = wanted.slice(0, Number(most) || MOST)

      if (!showing.length) {
        return { nodes: [], links: [], why: 'no branch here has a task or a judgement on it', note: null }
      }

      const nodes = []
      const links = []
      const wire = (from, to) => { if (from && to) links.push({ from, to }) }

      showing.forEach((story, row) => {
        const name = story.branch
        const id = k => `${name}::${k}`

        // ---- what the story is about ------------------------------------
        const arrived = story.kind === 'pull'
        nodes.push(node(id('branch'), arrived ? 'pull' : 'branch', name, [
          { text: story.live ? 'in flight' : 'at rest', tone: story.live ? '#3fb950' : '#7d8998' },
          // SAID ON THE CARD, because everything about what may be done to it
          // follows from this: an arrived change is somebody else's, waits on
          // a person before it is read at all, and has no branch here.
          arrived ? { text: "somebody else's, from outside", tone: '#f778ba' } : null
        ], 0, row))

        // ---- the task cut from it ---------------------------------------
        //
        // The most recent one. A branch worked twice is two tasks, and the older
        // one is history rather than a picture of now -- said in the line rather
        // than drawn, so the shape of the picture does not change with it.
        const mine = board
          .filter(t => t.branch === name)
          .sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')))
        const task = mine[0]
        if (task) {
          nodes.push(node(id('task'), 'task', `#${task.number} ${task.title || ''}`.trim(), [
            { text: task.state, tone: task.state === 'done' ? '#3fb950' : '#d29922' },
            { text: `${task.worker || 'somebody'} · ${task.jobName || task.job || 'no job'}` },
            mine.length > 1 ? { text: `${mine.length - 1} earlier on this branch` } : null
          ], 1, row))
          wire(id('branch'), id('task'))

          // ---- the machine it was given to ------------------------------
          if (task.machine) {
            const v = onMachine.get(task.machine)
            // `stage`, NOT `state`. The registry knows what this app has done
            // to a machine -- made, installed, dialled in -- and nothing about
            // whether VirtualBox has it running this second, which is a
            // question only VBoxManage answers and costs a process to ask.
            // Written as `v.state` first, it drew an empty line on every
            // machine card: undefined renders as nothing, so the fault looked
            // like missing data rather than a wrong field name.
            nodes.push(node(id('machine'), 'machine', task.machine, [
              { text: v ? v.stage || 'made' : 'no longer here', tone: v ? '#3fb950' : '#f85149' },
              // A MACHINE IS PUT BACK WHEN ITS WORK ENDS, so an empty claim here
              // is the ordinary end state and not a fault. Said, because a blank
              // line reads as missing data.
              { text: v && v.branch ? `claims ${v.branch}` : 'claiming nothing' },
              v && v.borrowed ? { text: 'borrowed', tone: '#d29922' } : null
            ], 2, row))
            wire(id('task'), id('machine'))
          }
        }

        // ---- what was made of it ----------------------------------------
        const readings = judged
          .filter(j => (j.subject && (j.subject.branch || j.subject.name)) === name)
          .sort((a, b) => String(b.touched || b.written || '').localeCompare(String(a.touched || a.written || '')))
        const reading = readings[0]
        if (reading) {
          nodes.push(node(id('judge'), 'judgement', `${reading.ref || ''} ${reading.title || ''}`.trim(), [
            { text: reading.state, tone: reading.state === 'done' ? '#3fb950' : '#d29922' },
            // NO VERDICT IS NOT A BAD VERDICT. A judgement still being read has
            // none, and showing that as a blank beside "accepted" invites the
            // wrong reading.
            {
              text: reading.verdict ? `verdict: ${reading.verdict}` : 'not decided',
              tone: reading.verdict === 'accepted' ? '#3fb950' : reading.verdict ? '#f85149' : '#7d8998'
            },
            { text: `by ${reading.by || 'somebody'}` }
          ], 3, row))
          wire(task ? id('task') : id('branch'), id('judge'))
        }
      })

      const live = showing.filter(x => x.live).length
      return {
        nodes,
        links,
        note: `${showing.length} branch${showing.length === 1 ? '' : 'es'}${live ? `, ${live} in flight` : ', none in flight'}${wanted.length > showing.length ? ` — ${wanted.length - showing.length} older not drawn` : ''}`,
        why: null
      }
    }
  },

  turnGraph: {
    about: 'The picture behind Supervisor -> Graph: what a supervisor did in one turn, from what was already recorded',
    takes: ['most'],
    run: async ({ most = 40 }) => {
      // EVERY CALL A SUPERVISOR MAKES IS ALREADY WRITTEN DOWN, in the event
      // stream, by the endpoint it comes through -- see /supervisor/do in
      // server.js. So this reads rather than records: nothing new is kept, and
      // the picture cannot disagree with the log because it IS the log.
      //
      // WHAT IT CAN AND CANNOT SHOW. Not what the model thought -- nothing here
      // has that, and a picture that implied otherwise would be worse than none.
      // What it shows is what it reached for, in what order, and what it was
      // told no about. The refusals are the interesting half: they are the
      // moments a model tried something it may not do.
      // TAGGED, not named. An event carries `tags` -- the subject and, where
      // there is one, the machine -- so a supervisor line is one tagged
      // `supervisor`, whichever machine it happened on. Matching on a machine
      // name instead would stop working the day a second supervisor exists.
      const all = events.all() || []
      const mine = all.filter(e => (e.tags || []).includes('supervisor'))

      // ---- where this turn begins ---------------------------------------
      //
      // At the last waking. A turn is bounded by being woken, which is the one
      // event that says "everything after this is one occasion".
      let from = -1
      for (let i = mine.length - 1; i >= 0; i--) {
        if (/^waking it/.test(String(mine[i].text || ''))) { from = i; break }
      }
      if (from < 0) {
        return { nodes: [], links: [], why: 'it has not been woken since this log begins', note: null }
      }

      const turn = mine.slice(from).slice(0, Number(most) || 40)
      const nodes = []
      const links = []
      let column = 0
      let last = null

      // WRAPPED, BECAUSE A TURN IS LONGER THAN A SCREEN. Laid out as one row
      // per five calls rather than one row of everything: a fourteen-call turn
      // drew fourteen columns wide, which is a ribbon somebody scrolls along
      // rather than a picture they can see at once, and forty would be worse.
      //
      // The wire still runs in order through the wrap, so the sequence is not
      // lost -- it just turns the corner.
      // FOUR, NOT FIVE. Five columns of 290 is 1450 pixels and the holder is
      // about 1240, so the fifth was cut in half by the right edge -- which
      // reads as a broken canvas rather than as a picture that is too wide.
      const ACROSS = 4
      const add = (kind, title, lines) => {
        const id = `n${nodes.length}`
        nodes.push(node(id, kind, title, lines, column % ACROSS, Math.floor(column / ACROSS)))
        column++
        if (last) links.push({ from: last, to: id })
        last = id
        return id
      }

      const woke = turn[0]
      add('woke', 'woken', [{ text: String(woke.text || '').replace(/^waking it\s*—?\s*/, '').slice(0, 30) || 'no reason given' },
        { text: String(woke.at || '').slice(11, 19) }])

      for (const e of turn.slice(1)) {
        const text = String(e.text || '')

        // `<machine> asked for "<what>" and it was done` -- the line the
        // endpoint writes for every call that got through.
        const did = text.match(/asked for "([^"]+)" and it was done/)
        if (did) {
          // WHAT THE CALL IS, IN THE APP'S OWN WORDS.
          //
          // This first tried to sort calls into "read" and "wrote", guessed
          // from the name. It was wrong in the first turn it was pointed at:
          // `todos` and `prCuts` are both listings and both came out as
          // "changed something". A picture that states something false about
          // what a model did is worse than one that says less -- and it is
          // worse in the direction that matters, because the whole reason to
          // look at this is to find out what it touched.
          //
          // The allowlist groups reading from writing IN COMMENTS, not in data,
          // so there is nothing here to consult. Rather than keep a second copy
          // of that grouping -- which would go stale the first time an action
          // was added and say so to nobody -- each node carries the one-line
          // description the allowlist already holds. That is authoritative by
          // construction: it is the same string a supervisor is handed when it
          // asks what it may do.
          const what = did[1]
          const why = (supervisor.MAY || {})[what] || null
          add('read', what, [{ text: why ? String(why).slice(0, 30) : 'not on its list — see the log' }])
          continue
        }

        const no = text.match(/asked for "([^"]+)" and was refused: (.*)$/)
        if (no) {
          add('refused', no[1], [
            { text: 'refused', tone: '#f85149' },
            { text: no[2].slice(0, 30) }
          ])
          continue
        }

        const said = text.match(/^it said: (.*)$/)
        if (said) {
          add('said', 'it answered', [{ text: said[1].slice(0, 30) }])
          continue
        }
      }

      const asked = nodes.filter(n => n.kind === 'read').length
      const refused = nodes.filter(n => n.kind === 'refused').length
      return {
        nodes,
        links,
        // A TURN THAT ASKED FOR NOTHING IS A TURN THAT DID NOTHING, however
        // normally it ended -- the same thing supervisorWake counts, said here
        // as a picture with one node in it.
        note: `${asked} call${asked === 1 ? '' : 's'}${refused ? `, ${refused} refused` : ''} since it was woken at ${String(woke.at || '').slice(11, 19)}`,
        why: null
      }
    }
  }
}
