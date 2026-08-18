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
// WHERE A CARD CAME FROM, so right-clicking it can go back there.
//
// The same shape the inbox uses for the same purpose -- `{ view, pane, pick }`
// -- rather than a second vocabulary for "which tab". See `at` in
// core/inbox.js: a picture and a to-do list both end in somebody wanting the
// thing itself, and they should not disagree about how to say where it is.
const at = (view, pane, pick) => ({ view, pane: pane || null, pick: pick || null })

const node = (id, kind, title, lines, column, row, where) => ({
  id,
  kind,
  title,
  lines: (lines || []).filter(Boolean),
  column,
  row,
  where: where || null
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

      // ---- A ROW IS A TIMELINE, NOT A SET OF COLUMNS ---------------------
      //
      // This first gave every KIND a fixed column: branch 0, task 1, machine 2,
      // judgement 3. It reads well when a story has all four and badly the
      // moment one is missing — a branch judged without a task here drew a card
      // at 0, nothing at 1 or 2, and a card at 3 with a wire running the whole
      // width of the window across two empty columns. The picture said "three
      // steps are missing" when what happened is that there were only two.
      //
      // So position means WHEN, not WHAT. Each step carries the moment it
      // happened, they are sorted, and they are laid down one after another.
      // The kind is still visible — it is the colour of the dot and the shape of
      // the words — and the axis is free to mean the one thing a reader already
      // assumes it means when they see a row of cards joined left to right.
      //
      // WIRES GET SHORT AS A CONSEQUENCE rather than as a goal. Adjacent in time
      // is adjacent on screen, so the long diagonals across empty space are not
      // routed better, they stop existing.
      showing.forEach((story, row) => {
        const name = story.branch
        const arrived = story.kind === 'pull'

        // WHEN, SHOWN, because a timeline whose axis cannot be read is just a
        // row. Time of day for something today, the date for anything older —
        // a full ISO stamp on every card is thirty characters of noise where
        // two facts were wanted.
        const today = new Date().toISOString().slice(0, 10)
        const when = at => {
          const s = String(at || '')
          if (!s) return null
          return s.slice(0, 10) === today ? s.slice(11, 16) : s.slice(0, 10)
        }

        // ---- everything that happened to it, with its moment --------------
        const steps = []

        // THE SUBJECT IS FIRST AND HAS NO TIME OF ITS OWN. When a branch was cut
        // is not recorded here — git knows, and asking git is a process per
        // branch on a pane that redraws. It is the origin of the row rather
        // than a moment in it, so it sorts first and says nothing about when.
        steps.push({
          at: null,
          first: true,
          kind: arrived ? 'pull' : 'branch',
          // An arrived change is read on Pull requests; a branch of this
          // workspace is on Branches Cut.
          where: arrived ? at('repos', 'pulls', name) : at('repos', 'branchcuts', name),
          title: name,
          lines: [
            { text: story.live ? 'in flight' : 'at rest', tone: story.live ? '#3fb950' : '#7d8998' },
            arrived ? { text: "somebody else's, from outside", tone: '#f778ba' } : null
          ]
        })

        const mine = board
          .filter(x => x.branch === name)
          .sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')))
        const task = mine[0]
        if (task) {
          steps.push({
            at: task.created || task.updated,
            kind: 'task',
            where: at('tasks', 'board', task.id),
            title: `#${task.number} ${task.title || ''}`.trim(),
            lines: [
              { text: task.state, tone: task.state === 'done' ? '#3fb950' : '#d29922' },
              { text: `${task.worker || 'somebody'} · ${task.jobName || task.job || 'no job'}` },
              mine.length > 1 ? { text: `${mine.length - 1} earlier on this branch` } : null
            ]
          })

          if (task.machine) {
            const v = onMachine.get(task.machine)
            steps.push({
              // WHEN IT WAS GIVEN TO A MACHINE, which is the closest moment
              // recorded on the task itself. `updated` moves with the task, so
              // this is "last touched" rather than "started" — near enough to
              // order by, and not claimed as more than that on the card.
              at: task.updated || task.created,
              kind: 'machine',
              where: at('runners', 'machines', task.machine),
              title: task.machine,
              lines: [
                { text: v ? v.stage || 'made' : 'no longer here', tone: v ? '#3fb950' : '#f85149' },
                { text: v && v.branch ? `claims ${v.branch}` : 'claiming nothing' },
                v && v.borrowed ? { text: 'borrowed', tone: '#d29922' } : null
              ]
            })
          }
        }

        const readings = judged
          .filter(j => (j.subject && (j.subject.branch || j.subject.name)) === name)
          .sort((a, b) => String(b.touched || b.written || '').localeCompare(String(a.touched || a.written || '')))
        const reading = readings[0]
        if (reading) {
          steps.push({
            at: reading.written || reading.touched,
            kind: 'judgement',
            where: at('judge', 'judgements', reading.id || reading.ref),
            title: `${reading.ref || ''} ${reading.title || ''}`.trim(),
            lines: [
              { text: reading.state, tone: reading.state === 'done' ? '#3fb950' : '#d29922' },
              {
                text: reading.verdict ? `verdict: ${reading.verdict}` : 'not decided',
                tone: reading.verdict === 'accepted' ? '#3fb950' : reading.verdict ? '#f85149' : '#7d8998'
              },
              { text: `by ${reading.by || 'somebody'}` }
            ]
          })
        }

        // ---- in the order they happened -----------------------------------
        //
        // Anything with no moment keeps its place rather than being dropped to
        // one end: a step this app did not write a time for is still a step, and
        // a picture that hides it is worse than one that puts it approximately.
        steps.sort((a, b) => {
          if (a.first) return -1
          if (b.first) return 1
          return String(a.at || '').localeCompare(String(b.at || ''))
        })

        let before = null
        steps.forEach((step, column) => {
          const id = `${name}::${column}`
          const stamp = when(step.at)
          nodes.push(node(id, step.kind, step.title, [
            ...step.lines,
            stamp ? { text: stamp, tone: '#7d8998' } : null
          ], column, row, step.where))
          wire(before, id)
          before = id
        })
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
      // WHERE A TURN GOES BACK TO. What it said is on the Chat tab; everything
      // else it did is a line in the log, which is where the sentence this was
      // built from actually lives.
      const add = (kind, title, lines, where) => {
        const id = `n${nodes.length}`
        nodes.push(node(id, kind, title, lines, column % ACROSS, Math.floor(column / ACROSS), where))
        column++
        if (last) links.push({ from: last, to: id })
        last = id
        return id
      }

      const woke = turn[0]
      add('woke', 'woken', [{ text: String(woke.text || '').replace(/^waking it\s*—?\s*/, '').slice(0, 30) || 'no reason given' },
        { text: String(woke.at || '').slice(11, 19) }], at('chat', 'chat', null))

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
          add('read', what, [{ text: why ? String(why).slice(0, 30) : 'not on its list — see the log' }], at('live', null, null))
          continue
        }

        const no = text.match(/asked for "([^"]+)" and was refused: (.*)$/)
        if (no) {
          add('refused', no[1], [
            { text: 'refused', tone: '#f85149' },
            { text: no[2].slice(0, 30) }
          ], at('live', null, null))
          continue
        }

        const said = text.match(/^it said: (.*)$/)
        if (said) {
          add('said', 'it answered', [{ text: said[1].slice(0, 30) }], at('chat', 'chat', null))
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
