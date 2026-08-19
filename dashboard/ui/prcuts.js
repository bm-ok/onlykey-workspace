'use strict'

// A change once it has left: one act, one pull request per repository.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- PR cuts -----------------------------------------------------------
//
// A change once it has left: one act, one pull request per repository, held
// together and edited as one thing.
//
// GITHUB CANNOT DO THIS PART. It has no idea the three are one change — each
// repository sees its own, each is approved on its own, and "is it in" cannot be
// answered by looking at any single one of them. Nor can three descriptions of
// one change stay in step by hand: the second repository ends up with last
// week's title, and a reviewer reads a different story depending on which one
// they happened to open.
//
// READ FROM GITHUB ON PURPOSE, never on the draw. Every state here is somebody
// else's fact and a network call to learn — the same rule as the Repositories
// tab, and the reason both have a button rather than a timer.
let pickedCut = been.get('prcut', null)
let cutsSeen = null

let cutsAsking = false

// ---- WHAT A DRAFT WOULD SAY, ASKED ONCE ----------------------------------
//
// `prTemplatePreview` composes the real body, and composing it reads git for
// every repository in the pair. THE WINDOW SHARES ONE NODE CONTEXT, so that read
// happens on the thread that is drawing -- see CLAUDE.md, and see the two
// panels that already put `spawn` at 70% of this window's samples.
//
// Asked from a paint path with no memory, it ran on every draw and the window
// stopped responding: not an exception, a block, several git processes deep,
// three seconds apart, for as long as a draft was selected. Which is the failure
// that rule was written about, walked into again.
//
// SO IT IS ASKED ONCE PER PAIR AND KEPT. `asking` is separate from `previewOf`
// because "not asked yet" and "asked, and the answer was nothing" are different
// and only one of them should ask again.
const previewOf = new Map()
const asking = new Set()

// WHAT WAS DRAWN BEFORE GITHUB WAS ASKED. Kept so a draft stays picked across a
// redraw — the loop runs every few seconds and would otherwise throw the panel
// away between one look and the next.
let draftsSeen = null

function paintCuts () {
  // THE PANE, NOT THE VIEW. This guarded on the view when PR cuts was a tab of
  // its own, where the two were the same question. It is one of eleven panes
  // now, so `view === 'repos'` is true on Branches Lines, on Conflicts, on
  // Repos — and the first look below is a network call to GitHub. Opening the
  // Repositories tab at all was firing it.
  if (view !== 'repos' || repoPane !== 'cuts') return
  // READ ONCE WHEN THE TAB IS OPENED, and not again until asked. Never on the
  // draw: every line here is a network call to somebody else's service, and the
  // window redraws every three seconds.
  //
  // Arriving at a tab that says "not read yet" and does nothing is a tab that
  // looks broken — so the first look pays for itself, and every look after that
  // is a button. The same trade as the Repositories tab, made once here rather
  // than left to the person to notice.
  if (cutsSeen === null && !cutsAsking) {
    cutsAsking = true
    refreshCuts().finally(() => { cutsAsking = false })
    return
  }

  // `if (repoPane !== 'cuts') return paintTemplates()` stood here, and was right
  // while this tab had exactly two panes: not-cuts meant templates. With eleven
  // it meant "paint the template editor whenever you are anywhere else", and the
  // switcher and the draw loop both call paintTemplates on their own anyway.
  const rows = cutsSeen ? cutsSeen.cuts : null
  setText($('prcuts-context'), rows ? `— ${rows.length}` : '')
  setText($('prcuts-note'), rows ? cutsSeen.note : 'Not read yet. "Read them from GitHub" asks what became of each one.')

  if (!rows) {
    // NOT READ YET IS ABOUT GITHUB, AND A DRAFT IS NOT ON GITHUB. The whole
    // screen used to wait on the network before showing anything — including
    // the one row that wants a person, which has never left this host and could
    // have been drawn instantly.
    api('prDrafts').then(async d => {
      const listed = (d && d.drafts) || []
      if (view !== 'repos' || repoPane !== 'cuts' || cutsSeen) return

      // THE WHOLE TEXT, NOT ONLY THE TITLE, because a draft is picked in order
      // to READ it — deciding whether to send something is done by reading what
      // it says. `prDrafts` is a list and deliberately light; this asks for the
      // body of each, which is still local and still costs no network.
      const waiting = []
      for (const w of listed) {
        const one = await api('prDraft', { source: w.source, target: w.target }).catch(() => null)
        const kept = (one && one.draft) || {}
        waiting.push({
          source: w.source,
          target: w.target,
          draft: true,
          landed: false,
          pulls: [],
          summary: 'written, not sent',
          said: { title: kept.title || w.title || null, body: kept.body || null }
        })
      }
      draftsSeen = waiting
      if (view !== 'repos' || repoPane !== 'cuts' || cutsSeen) return
      if (!changed('prcuts', ['unread', waiting, pickedCut])) return

      fill($('prcuts'),
        // PICKABLE BEFORE THE NETWORK ANSWERS. They were drawn and not
        // clickable, so the one row on the screen that wants a person could be
        // seen and not opened until GitHub had been asked about seventeen other
        // things that did not.
        ...waiting.map(w => el('div', {
          className: `card pick${key(w) === pickedCut ? ' on' : ''}`,
          onclick: () => { pickedCut = key(w); been.set('prcut', pickedCut); forget('prcuts'); forget('prcut-detail'); paintCuts() }
        },
          el('div', { className: 'card-title' },
            el('span', { className: 'grow', textContent: w.source }),
            el('span', { className: 'badge warn', textContent: 'not sent' })),
          el('div', { className: 'card-sub muted', textContent: `into ${w.target}` }),
          el('div', { className: 'card-sub muted', textContent: (w.said && w.said.title) || 'written and waiting to be sent' }))),
        el('p', { className: 'empty', textContent: waiting.length
          ? 'What has been sent is not read yet — "Read them from GitHub" asks what became of each one.'
          : 'Not read yet.' }))

      const one = waiting.find(w => key(w) === pickedCut) || null
      if (one) paintCutDetail(one)
    }).catch(() => { /* the line below still says what to press */ })

    // A DRAFT ALREADY PICKED KEEPS ITS PANEL through a redraw, rather than
    // reverting to "read them from GitHub" every three seconds.
    const already = (draftsSeen || []).find(w => key(w) === pickedCut) || null
    if (already) { if (changed('prcut-detail', already)) paintCutDetail(already); return }

    if (changed('prcut-detail', 'unread')) {
      fill($('prcut-detail'), el('p', { className: 'empty', textContent: 'Read them from GitHub to see what became of each cut.' }))
    }
    return
  }

  if (!rows.some(r => key(r) === pickedCut)) {
    pickedCut = rows.length ? key(rows[0]) : null
    been.set('prcut', pickedCut)
  }

  if (changed('prcuts', [rows, pickedCut])) {
    fill($('prcuts'), rows.length
      ? rows.map(r => el('div', {
          className: `card pick${key(r) === pickedCut ? ' on' : ''}`,
          onclick: () => { pickedCut = key(r); been.set('prcut', pickedCut); forget('prcuts'); forget('prcut-detail'); paintCuts() }
        },
        el('div', { className: 'card-title' },
          el('span', { className: 'grow', textContent: r.source }),
          // A DRAFT IS THE ONE ROW HERE THAT WANTS SOMETHING. Everything else on
          // this screen has already happened; this has not been sent, and it is
          // badged so it cannot be read as another green.
          el('span', {
            className: `badge ${r.draft ? 'warn' : r.landed ? 'ok' : 'run'}`,
            textContent: r.draft ? 'not sent' : r.landed ? 'landed' : r.summary
          })),
        el('div', { className: 'card-sub muted', textContent: `into ${r.target}` }),
        el('div', { className: 'card-sub muted', textContent: r.draft
          ? 'written and waiting to be sent'
          : ago(r.opened) })))
      : el('p', { className: 'empty', textContent: 'Nothing has been cut yet. Propose a line on the Lines tab, read it on Changes, then cut it with +.' }))
  }

  const one = rows.find(r => key(r) === pickedCut) || null
  if (!changed('prcut-detail', one)) return
  paintCutDetail(one)
}

const key = r => `${r.source} -> ${r.target}`

function paintCutDetail (c) {
  if (!c) return fill($('prcut-detail'), el('p', { className: 'empty', textContent: 'Pick a cut on the left.' }))

  // ---- A DRAFT IS NOT A CUT, AND THE PANEL BELOW IS ABOUT CUTS -------------
  //
  // Everything under this line reads pull requests: which are merged, which
  // repository each is in, whether to sync the forks or reopen them. A draft has
  // none of that — it has never been sent — so it was drawn as a cut with an
  // empty list of pull requests and five buttons that could not do anything to
  // it.
  //
  // WHAT IT NEEDS INSTEAD IS THE TEXT AND ONE BUTTON. Somebody looking at a
  // draft is deciding whether to send it, and that decision is made by reading
  // what it says.
  if (c.draft) {
    const said = c.said || {}
    const at = key(c)

    // WHAT WOULD ACTUALLY BE POSTED, not what was typed. The saved body is only
    // somebody's half; a pull request carries that plus everything the blocks on
    // "New PR Cut" add — why the branch was cut, what it was cut from, the
    // commit each repository ends at, the links between the cut's own pull
    // requests. Showing the typed half and calling it a preview shows the
    // smaller and less surprising part.
    //
    // COMPOSED BY THE SAME THING THAT COMPOSES THE REAL ONE, so it cannot drift
    // from what goes out. Asked once — see previewOf above for why that matters
    // more than it looks.
    if (!previewOf.has(at) && !asking.has(at)) {
      asking.add(at)
      api('prTemplatePreview', { source: c.source, target: c.target, title: said.title || undefined, body: said.body || undefined })
        .then(v => { previewOf.set(at, (v && v.text) || (v && v.note) || '') })
        .catch(e => { previewOf.set(at, `Could not compose it: ${e.message}`) })
        .finally(() => {
          asking.delete(at)
          if (pickedCut === at) { forget('prcut-detail'); paintCuts() }
        })
    }

    const composed = previewOf.get(at)

    return fill($('prcut-detail'),
      el('div', { className: 'card-title' },
        el('span', { className: 'grow', textContent: said.title || c.source }),
        el('span', { className: 'badge warn', textContent: 'not sent' })),
      el('p', { className: 'note', textContent: `"${c.source}" into "${c.target}", written here and not sent. Nothing is on GitHub yet — this text lives in this workspace only, and sending it is one act: a branch pushed and a pull request opened for every repository that carries something.` }),
      el('p', { className: 'note muted', textContent: 'What a pull request would say — what was written, and everything the blocks on "New PR Cut" add to it.' }),
      composed === undefined
        ? el('p', { className: 'empty', textContent: 'Composing what it would say…' })
        : composed
          ? codeBlock(composed, 'markdown', { max: 30 })
          : el('p', { className: 'empty', textContent: 'Nothing would be opened for this pair — the source carries nothing the target does not already have.' }),
      // ---- WHAT THE BUTTON DOES, BESIDE THE BUTTON --------------------
      //
      // "Send it" is the only thing on this screen that reaches outside this
      // host, and its name says the intent rather than the acts. Four things
      // happen and they are not reversible in the same way: a branch is pushed
      // to a fork, pull requests are opened under somebody's account, and they
      // are then rewritten to link to each other. A dialog says this too, and a
      // dialog is read once and clicked through afterwards -- so it is on the
      // screen as well, where somebody deciding can read it without committing
      // to a press first.
      el('p', { className: 'note muted', textContent: `Send it pushes ${c.source} to the fork in every repository that carries something, opens one pull request each, and then writes them again with links to one another — those numbers do not exist until all of them are open. They are tracked here as one cut. Merging them is a separate act, and also yours.` }),

      el('div', { className: 'row' },
        // THE ONE ACT THIS SCREEN CAN DO ABOUT A DRAFT, and it is deliberately a
        // person's press. See the supervisor: it may write the text and make the
        // line, and sending it outward is not on its list at all.
        //
        // `btn ok` RATHER THAN `good`, which is what every other action row on
        // this tab uses. Written as `good` these two rendered unstyled -- a
        // class that matches no rule is the quietest failure in CSS, and it made
        // the one outward-facing button on the screen look like plain text.
        el('button', {
          className: 'btn ok',
          textContent: 'Send it',
          title: 'Pushes the branches and opens the pull requests. This is the step that reaches GitHub',
          onclick: () => sendDraft(c)
        }),
        el('button', {
          className: 'btn',
          textContent: 'Edit it',
          title: 'Opens this text in the writer on "New PR Cut", with these two lines already chosen',
          onclick: () => {
            // The writer is where this text was composed, so editing means going
            // back to it with the same pair selected rather than a second dialog
            // asking for the same two sentences.
            tmplFrom = c.source
            tmplInto = c.target
            been.set('tmpl-from', tmplFrom)
            been.set('tmpl-into', tmplInto)
            tmplSeen = null
            repoPane = 'templates'
            been.set('repo-pane', repoPane)
            paintTemplates()
          }
        })))
  }

  const said = c.said || {}
  fill($('prcut-detail'),
    el('div', { className: 'card-title' },
      el('span', { textContent: said.title || c.source }),
      el('span', { className: `badge ${c.landed ? 'ok' : 'run'}`, textContent: c.summary })),
    el('p', { className: 'note', textContent: `"${c.source}" into "${c.target}", cut ${ago(c.opened)}${c.by ? ` from ${c.by}` : ''}. It is landed when every one of these is merged — not before, and not because one of them is.` }),

    el('div', { className: 'stack' }, ...c.pulls.map(p => el('div', { className: 'card' },
      el('div', { className: 'card-title' },
        el('span', { className: 'mono', textContent: p.repo }),
        p.number ? el('span', { className: 'mono muted', textContent: `#${p.number}` }) : null,
        el('span', {
          className: `badge ${p.merged ? 'ok' : p.state === 'closed' ? 'bad' : p.number ? 'run' : 'warn'}`,
          textContent: p.merged ? 'merged' : (p.state || 'never opened')
        })),
      p.head ? el('div', { className: 'card-sub mono', textContent: `${p.head} → ${p.base}` }) : null,
      p.why ? el('div', { className: 'card-sub bad', textContent: p.why }) : null,
      p.url
        ? el('div', { className: 'row', style: 'margin-top:6px' },
            el('button', { className: 'btn small', textContent: 'Read it on GitHub', onclick: () => host.openExternal(p.url) }))
        : null))),

    el('div', { className: 'row', style: 'margin-top:12px' },
      // LANDING IT, which used to mean three browser tabs and a green button in
      // each. Merged together for the same reason they were opened together: a
      // change half-merged is the state nobody notices until the repository that
      // was left behind stops building.
      //
      // Gone once it has landed rather than disabled, because a landed cut has
      // nothing left to do and a permanently greyed button is furniture.
      c.landed ? null : el('button', {
        className: 'btn ok',
        textContent: c.pulls.filter(p => p.number && !p.merged && p.state === 'open').length > 1 ? 'Merge all of them' : 'Merge it',
        title: 'Merges every pull request in this cut on GitHub',
        disabled: !c.pulls.some(p => p.number && !p.merged && p.state === 'open'),
        onclick: () => landCut(c)
      }),
      // AND THE STEP AFTER IT, next to it rather than on another tab. The parent
      // has moved and the fork has not, which is the state that reads as "my
      // branch and master are off" a day later when somebody cuts from it.
      c.landed ? el('button', {
        className: 'btn ok',
        textContent: 'Sync the forks',
        title: "Pulls each fork's default branch up from its parent, then fetches here",
        onclick: () => syncForks()
      }) : null,
      el('button', {
        className: 'btn',
        textContent: 'Edit all of them',
        title: 'Opens it in Write one, where the whole description can be seen while it is written',
        onclick: () => editCut(c)
      }),
      el('button', {
        className: 'btn',
        textContent: 'Read them again',
        onclick: () => refreshCuts()
      }),
      el('button', {
        className: 'btn danger',
        textContent: c.pulls.some(p => p.state === 'open') ? 'Close all of them' : 'Reopen all of them',
        onclick: () => setCutState(c, c.pulls.some(p => p.state === 'open') ? 'closed' : 'open')
      }),
      el('button', {
        className: 'btn danger',
        textContent: 'Stop tracking it',
        title: 'Forgets the cut here. Nothing on GitHub is closed or changed',
        onclick: () => ask({
          title: `Stop tracking "${c.source}" into "${c.target}"?`,
          plain: [
            'The pull requests are untouched — none is closed, none is changed, and each carries on being read on GitHub.',
            'What is lost is holding them together: nothing here will say "2 of 3 merged" about them again, and editing all of them at once stops being possible.'
          ],
          confirm: 'Stop tracking it',
          danger: true,
          onYes: async () => {
            const r = await api('prCutForget', { source: c.source, target: c.target })
            pickedCut = null
            cutsSeen = null
            forget('prcuts')
            say(r.note)
            return refreshCuts()
          }
        })
      })))
}

// ONE TITLE AND ONE DESCRIPTION, WRITTEN TO ALL OF THEM. This is what "one pull
// request in the dashboard updates all three" means, and it is the only reliable
// way three descriptions of one change stay the same sentence.
// EDITING GOES TO THE ONE EDITOR, rather than being a second one.
//
// This was a dialog with a title and a description in it, and it had two faults
// that were really the same fault. It could not show a preview -- a dialog here
// is 560px and a composed description is not -- so somebody edited a pull
// request without seeing what it would say. And it wrote the typed text RAW,
// with none of the blocks: editing a cut from here would have quietly stripped
// the cross-links, the reason, the commits, everything the template adds.
//
// Two editors that disagree is the fault this window keeps turning up. So there
// is one, and this takes you to it with the cut already loaded.
function editCut (c) {
  tmplFrom = c.source
  tmplInto = c.target
  been.set('tmpl-from', tmplFrom)
  been.set('tmpl-into', tmplInto)
  tmplSeen = null
  forget('prwrite-fields')
  forget('prtemplate')
  showPane('templates', 'repos')
}

// MERGING THEM, asked for once and confirmed once.
//
// The confirmation is not ceremony: this is the one act in this window that
// reaches somebody else's repository and cannot be undone from here. It says
// which pull requests, into what, and what happens to the forks afterwards —
// because "what do I do now" is the question this app kept leaving people with
// at exactly this point.
function landCut (c) {
  const open = c.pulls.filter(p => p.number && !p.merged && p.state === 'open')
  ask({
    title: open.length > 1 ? `Merge all ${open.length} pull requests in this cut?` : 'Merge this pull request?',
    plain: [
      `${open.map(p => `${p.repo} #${p.number}`).join(', ')} — merged into ${c.target}, on GitHub, now.`,
      'This is the one thing here that cannot be undone from this window: it is a commit on a real default branch. Reverting it afterwards is a change of its own.',
      'Afterwards each fork is behind its parent. Sync the forks, then this host, before cutting anything new from them.'
    ],
    confirm: open.length > 1 ? 'Merge all of them' : 'Merge it',
    onYes: async () => {
      const r = await api('prCutLand', { source: c.source, target: c.target })
      say(r.note, r.merged.some(m => !m.merged) ? 'bad' : 'ok')
      return refreshCuts()
    }
  })
}

// The two syncs that follow a landing, in the order they have to happen: the
// fork on GitHub cannot be pulled up by fetching here, and fetching here before
// the fork has moved brings back exactly what was already there.
async function syncForks () {
  try {
    const up = await api('repoForkSync', {})
    say(up.note, 'ok')
    const here = await api('repoSync', {})
    say(here.note, 'ok')
    return refreshCuts()
  } catch (e) { oops(e) }
}

function setCutState (c, state) {
  const open = state === 'open'
  ask({
    title: open ? 'Reopen every pull request in this cut?' : 'Close every pull request in this cut?',
    plain: [
      open
        ? 'Each one is reopened on GitHub. Nothing is merged and no branch moves.'
        : 'Each one is closed on GitHub. Nothing is merged, no branch moves, and the work stays on its branch.',
      // CLOSING TWO OF THREE IS THE STATE WORTH AVOIDING: a change that is
      // neither in nor withdrawn, with one still open for somebody to merge by
      // accident a month later.
      'All of them together, because a change half-closed is neither in nor withdrawn — and the one still open is the one somebody merges by accident later.'
    ],
    confirm: open ? 'Reopen all' : 'Close all',
    danger: !open,
    onYes: async () => {
      const r = await api('prCutUpdate', { source: c.source, target: c.target, state })
      say(r.note, r.changed.some(x => !x.ok) ? 'bad' : undefined)
      return refreshCuts()
    }
  })
}

// `newPrCut` was here: a dialog asking for a source line, a target, a title and
// a description. It sat next to a pane built for writing exactly those, with a
// preview the dialog could not show — so it was the second editor, and the one
// that could not show its work. Both + and Edit open the real one now.

function refreshCuts () {
  return api('prCuts').then(r => {
    cutsSeen = r
    forget('prcuts')
    forget('prcut-detail')
    paintCuts()
  }).catch(oops)
}


// ---- what a pull request says ------------------------------------------
//
// The blocks that are on, and what a real pull request would say with them.
//
// THE PREVIEW IS MADE OF REAL FACTS, not placeholders. A preview of a layout
// tells you whether it looks tidy; a preview of the actual sentences tells you
// whether they are worth saying — which is the only question a template raises.
// The one thing it cannot know is the pull request numbers, because those do not
// exist until the cut is made, so it shows them as ? and says so.
let tmplFrom = been.get('tmpl-from', null)
let tmplInto = been.get('tmpl-into', null)
let tmplAs = null
// The last preview, and what it was of. See paintTemplates.
let tmplSeen = null
// The pending write of what is being typed. See paintTemplates.
let draftTimer = null


function paintTemplates () {
  if (view !== 'repos' || repoPane !== 'templates') return
  waiting('prtemplate', { lines: 6 })
  paintTemplatesNow()
}

async function paintTemplatesNow () {
  await settle()
  if (view !== 'repos' || repoPane !== 'templates') return
  Promise.all([api('prTemplate'), api('lines').catch(() => ({ groups: [] }))]).then(([t, { groups }]) => {
    const usable = (groups || []).filter(g => !g.broken.length)

    if (changed('prtemplate', [t.blocks, usable.map(g => g.name), tmplFrom, tmplInto])) {
      fill($('prtemplate'), el('div', {},
        el('p', { className: 'note', textContent: t.note }),
        ...t.blocks.map(b => el('div', { className: `card pick${b.on ? ' on' : ''}` },
          el('label', { className: 'inline', style: 'align-items:flex-start;gap:8px' },
            el('input', {
              type: 'checkbox',
              checked: b.on,
              onchange: e => api('prTemplateSet', { id: b.id, on: e.target.checked })
                .then(() => { tmplSeen = null; forget('prtemplate'); forget('prtemplate-preview'); paintTemplates() })
                .catch(oops)
            }),
            el('span', {},
              el('div', { className: 'card-title' },
                el('span', { textContent: b.label }),
                b.manyOnly ? el('span', { className: 'badge muted', textContent: 'only when several repositories' }) : null),
              el('div', { className: 'card-sub muted', textContent: b.about })))))))

      // Which pair is being previewed. Defaulted to a proposed line going into
      // one that is not, because that is the pair somebody is about to cut.
      if (!usable.some(g => g.name === tmplFrom)) tmplFrom = (usable.find(g => g.marked) || usable[0] || {}).name || null
      if (!usable.some(g => g.name === tmplInto) || tmplInto === tmplFrom) {
        // A LINE THAT IS NOT THE SOURCE, and preferably one nobody has proposed.
        // Work is proposed FROM a marked line INTO a settled one, so the default
        // target is the first unmarked line that is not already the source; any
        // other line will do rather than leaving this empty.
        //
        // This called `pickTargetFor`, which has never existed anywhere in this
        // window. It threw every time the remembered target went stale or
        // matched the source — inside a `.then`, so it surfaced as the Write one
        // pane simply not painting. Found by test/declared-test.js on its first
        // run, not by reading.
        const other = usable.filter(g => g.name !== tmplFrom)
        tmplInto = ((other.find(g => !g.marked) || other[0] || {}).name) || null
      }
      been.set('tmpl-from', tmplFrom)
      been.set('tmpl-into', tmplInto)

      const pick = (box, value, onPick) => {
        fill($(box), ...usable.map(g => el('option', { value: g.name, textContent: g.name, selected: g.name === value })))
        $(box).onchange = () => { onPick($(box).value); tmplSeen = null; forget('prtemplate'); forget('prtemplate-preview'); paintTemplates() }
      }
      pick('prtemplate-source', tmplFrom, v => { tmplFrom = v; been.set('tmpl-from', v) })
      pick('prtemplate-target', tmplInto, v => { tmplInto = v; been.set('tmpl-into', v) })
    }

    if (!tmplFrom || !tmplInto || tmplFrom === tmplInto) {
      setText($('prtemplate-context'), '')
      return fill($('prtemplate-preview'), el('p', { className: 'empty', textContent: 'Two different lines are needed to preview what a pull request between them would say.' }))
    }

    // ASKED WHEN THE QUESTION CHANGES, not every three seconds. Composing a
    // preview reads git twice per repository, and the answer only moves when the
    // pair of lines, the chosen copy, or the blocks that are on do.
    const key = JSON.stringify([tmplFrom, tmplInto, tmplAs, t.blocks.filter(b => b.on).map(b => b.id)])
    const asked = tmplSeen && tmplSeen.key === key
      ? Promise.resolve(tmplSeen.value)
      : api('prTemplatePreview', { source: tmplFrom, target: tmplInto, repo: tmplAs || undefined })
          .then(value => { tmplSeen = { key, value }; return value })

    asked
      .then(v => {
        setText($('prtemplate-context'), v.note || '')

        // WHICH REPOSITORY'S COPY. They differ exactly where a block is about
        // the others — the cross-links — and being able to read one rather than
        // an average of them is the point of the selector.
        if (changed('prtemplate-as', [v.repos, v.showing])) {
          fill($('prtemplate-as'), ...(v.repos || []).map(r => el('option', { value: r, textContent: `as ${r}`, selected: r === v.showing })))
          $('prtemplate-as').onchange = () => { tmplAs = $('prtemplate-as').value; tmplSeen = null; forget('prtemplate-preview'); paintTemplates() }
        }

        if (!v.text && !v.additions) {
          fill($('prwrite-actions'), null)
          return fill($('prtemplate-preview'), el('p', { className: 'empty', textContent: v.note }))
        }

        // THE FIELDS ARE FILLED FROM WHAT THE CUT ALREADY SAYS, once, and then
        // left alone. Rewriting them on every draw would take the cursor out of
        // somebody's hands mid-sentence — which is the same fault as repainting
        // a list while it is being read, and worse, because it eats typing.
        if (changed('prwrite-fields', [tmplFrom, tmplInto])) {
          // THE DRAFT WINS. It is what somebody was in the middle of writing,
          // and the cut is what was sent last time — offering the older of the
          // two back would quietly discard a paragraph.
          api('prDraft', { source: tmplFrom, target: tmplInto }).then(({ draft }) => {
            $('prwrite-title').value = (draft && draft.title) || (v.said && v.said.title) || ''
            $('prwrite-body').value = (draft && draft.body) || (v.said && v.said.body) || ''
            setText($('prwrite-state'), draft ? `draft kept ${ago(draft.at)}` : '')
            show()
          }).catch(() => { /* an unreadable draft is not worth a banner */ })
        }

        // COMPOSED HERE AS IT IS TYPED, not asked for again. What the blocks add
        // does not depend on what is typed — only on the pair of lines and which
        // copy — so the sentence in front is joined on locally and every
        // keystroke costs nothing.
        const show = () => {
          const typed = $('prwrite-body').value.trim()
          const text = [typed, v.additions].filter(Boolean).join('\n\n---\n\n')
          fill($('prtemplate-preview'),
            el('div', {},
              el('div', { className: 'card', style: 'margin-bottom:8px' },
                el('div', { className: 'card-title' }, el('span', { textContent: $('prwrite-title').value.trim() || v.title })),
                el('div', { className: 'card-sub muted', textContent: v.guessing
                  ? 'Nothing is cut yet, so the links below show ? until it is.'
                  : 'The links below are the real pull request numbers.' })),
              // A pull request body is markdown that GitHub will render, so a
              // preview of it that is not rendered is a preview of the wrong
              // thing. The source view is one click away for checking a link.
              markdownBlock(text)))
        }

        // Repainted on input rather than on the draw, because the draw is three
        // seconds away and a preview that lags a sentence behind is one nobody
        // trusts.
        // KEPT A MOMENT AFTER TYPING STOPS. What somebody writes here lived
        // only in a DOM node: one click on another tab and a paragraph was gone,
        // and writing the description is the slowest part of cutting a pull
        // request. Debounced rather than per keystroke, because this is a file
        // write and a paragraph is a hundred of them.
        const keep = () => {
          clearTimeout(draftTimer)
          draftTimer = setTimeout(() => {
            api('prDraftSave', {
              source: tmplFrom,
              target: tmplInto,
              title: $('prwrite-title').value,
              body: $('prwrite-body').value
            }).then(({ draft }) => setText($('prwrite-state'), draft ? `draft kept ${ago(draft.at)}` : ''))
              .catch(() => { /* it is still on the screen; failing to keep it is not worth a banner */ })
          }, 800)
        }

        $('prwrite-title').oninput = () => { show(); keep() }
        $('prwrite-body').oninput = () => { show(); keep() }
        show()

        // ---- THIS TAB WRITES. THE OTHER ONE SENDS. ------------------------
        //
        // Its only button used to be "Cut it", which pushed every branch and
        // opened every pull request on the spot -- so the screen for composing
        // text was also the screen that published, and there was no way to write
        // something and keep it. A person could preview and publish; nothing
        // else. Meanwhile the supervisor drafted through `prDraftSave` and never
        // touched this at all, so the two ends of the same job had different
        // shapes and only one of them could stop halfway.
        //
        // Now: compose here, save it, and it appears on PR cuts as "not sent",
        // where sending is one press and merging is a person's after that. The
        // draft is the handover between the two screens and is the same object
        // whichever end wrote it.
        //
        // SENDING IS NOT OFFERED HERE ANY MORE, and that is the point rather
        // than an omission. One screen that both writes and publishes is a
        // screen where the difference between thinking and doing is a button
        // you have already moved the mouse to.
        const existing = v.existing && v.existing.count
        fill($('prwrite-actions'),
          el('button', {
            className: 'btn ok',
            textContent: existing ? `Write it to all ${v.existing.count}` : 'Save it as a draft',
            title: existing
              ? 'Changes the title and description of every pull request in this cut'
              : 'Keeps this text against these two lines. It appears on PR cuts as "not sent", and that is where it goes out',
            onclick: () => existing ? writeToCut(v) : saveDraftFromWriter(v)
          }),
          existing
            ? el('span', { className: 'muted', style: 'align-self:center', textContent: `cut ${ago(v.existing.opened)} — ${v.repos.length} repositor${v.repos.length === 1 ? 'y' : 'ies'} carry work` })
            : el('span', { className: 'muted', style: 'align-self:center', textContent: `${tmplFrom} into ${tmplInto} — ${v.repos.length} repositor${v.repos.length === 1 ? 'y carries' : 'ies carry'} work. Sending it is on the PR cuts tab` }))
      })
      .catch(e => fill($('prtemplate-preview'), el('p', { className: 'empty bad', textContent: e.message })))
  }).catch(() => { /* the tab beside it says when the dashboard is unreachable */ })
}


// WRITING A NEW ONE. The same act as + on the Overview pane, from the surface
// where it was composed — so what was previewed is what is opened, rather than
// a second dialog asking for the same two sentences again.
// SENDING WHAT WAS ALREADY WRITTEN. The same act as the writer's, from the list
// rather than from the editor — a draft on this screen is a thing somebody came
// here to send, and making them open another tab to press it is the reason this
// was not noticeable in the first place.
function sendDraft (c) {
  const said = c.said || {}
  ask({
    title: `Send "${c.source}" into "${c.target}"?`,
    plain: [
      'One pull request in each repository that carries something, tracked together as one cut.',
      'Each branch is pushed onward from this host first. No machine is ever handed the token.',
      said.title ? `It goes out as: "${said.title}"` : 'It has no title of its own, so the template supplies one.'
    ],
    // GITHUB'S KIND OF DRAFT, WHICH IS NOT THIS APP'S KIND. This app's draft has
    // not been sent; GitHub's has been opened and is marked not ready for
    // review. The option lived on the writer, which was also the thing that
    // published — it belongs with the act of opening, which is here.
    fields: [{
      name: 'asDraft',
      type: 'checkbox',
      label: 'Open them as drafts on GitHub',
      value: false,
      hint: 'They are opened and visible either way. A GitHub draft says "not ready for review" and cannot be merged until somebody marks it ready.'
    }],
    cost: 'This pushes branches to GitHub and opens pull requests. Both are visible to anyone who can see those repositories.',
    confirm: 'Push and open them',
    onYes: async f => {
      const r = await api('prCutMake', {
        source: c.source,
        target: c.target,
        title: said.title || undefined,
        body: said.body || undefined,
        draft: f && (f.asDraft === true || f.asDraft === 'on')
      })
      pickedCut = `${c.source} -> ${c.target}`
      been.set('prcut', pickedCut)
      say(r.note, (r.pulls || []).some(x => !x.opened) ? 'bad' : undefined)
      return refreshCuts()
    }
  })
}

// KEEPING WHAT WAS WRITTEN, which is what this screen is for. No confirmation
// and no cost line: nothing leaves this host, and asking somebody to confirm
// saving their own text teaches them to click through the dialogs that matter.
async function saveDraftFromWriter (v) {
  const title = $('prwrite-title').value.trim()
  const body = $('prwrite-body').value.trim()
  const r = await api('prDraftSave', { source: tmplFrom, target: tmplInto, title, body }).catch(e => ({ error: e.message }))
  if (r && r.error) return say(r.error, 'bad')

  // PICKED ON THE OTHER TAB, so the next thing somebody wants to look at is
  // already selected when they go there.
  pickedCut = `${tmplFrom} -> ${tmplInto}`
  been.set('prcut', pickedCut)
  cutsSeen = null
  draftsSeen = null
  // The composition is of the OLD text until it is asked again.
  previewOf.delete(`${tmplFrom} -> ${tmplInto}`)
  forget('prcuts')
  forget('prcut-detail')
  say(`Kept. "${tmplFrom}" into "${tmplInto}" is on PR cuts as not sent — that is where it goes out.`)
}

// `cutFromWriter` STOOD HERE and published straight from the writer. It is gone
// rather than left unused: the whole point of the split is that the screen for
// composing text cannot also be the screen that pushes branches to GitHub, and a
// function that still could is an invitation to wire a button back to it.
// Sending lives in `sendDraft`, on the PR cuts tab, against a saved draft.

// CHANGING ONE THAT EXISTS. Every pull request in the cut gets the same title
// and the same description, which is the only way three of them keep saying the
// same thing.
function writeToCut (v) {
  ask({
    title: `Write this to all ${v.existing.count} pull request(s)?`,
    plain: [
      `${v.repos.join(', ')} — each one gets this title and this description.`,
      'Whether each is open or merged is GitHub\'s and is not touched here.',
      'The blocks are written again too, so anything turned on since it was cut appears now.'
    ],
    confirm: 'Write it to all of them',
    onYes: async () => {
      const typed = $('prwrite-body').value.trim()
      const r = await api('prCutUpdate', {
        source: tmplFrom,
        target: tmplInto,
        title: $('prwrite-title').value.trim(),
        body: [typed, v.additions].filter(Boolean).join('\n\n---\n\n')
      })
      tmplSeen = null
      say(r.note, r.changed.some(x => !x.ok) ? 'bad' : undefined)
      return refreshCuts()
    }
  })
}
