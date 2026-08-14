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

function paintCuts () {
  if (view !== 'prcuts') return
  // READ ONCE WHEN THE TAB IS OPENED, and not again until asked. Never on the
  // draw: every line here is a network call to somebody else's service, and the
  // window redraws every three seconds.
  //
  // Arriving at a tab that says "not read yet" and does nothing is a tab that
  // looks broken — so the first look pays for itself, and every look after that
  // is a button. The same trade as the Repositories tab, made once here rather
  // than left to the person to notice.
  if (view === 'prcuts' && cutsSeen === null && !cutsAsking) {
    cutsAsking = true
    refreshCuts().finally(() => { cutsAsking = false })
    return
  }

  const rows = cutsSeen ? cutsSeen.cuts : null
  if (cutPane !== 'cuts') return paintTemplates()
  setText($('prcuts-context'), rows ? `— ${rows.length}` : '')
  setText($('prcuts-note'), rows ? cutsSeen.note : 'Not read yet. "Read them from GitHub" asks what became of each one.')

  if (!rows) {
    if (changed('prcuts', 'unread')) {
      fill($('prcuts'), el('p', { className: 'empty', textContent: 'Not read yet.' }))
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
          onclick: () => { pickedCut = key(r); been.set('prcut', pickedCut); changed('prcuts', null); changed('prcut-detail', null); paintCuts() }
        },
        el('div', { className: 'card-title' },
          el('span', { textContent: r.source }),
          el('span', { className: `badge ${r.landed ? 'ok' : 'run'}`, textContent: r.landed ? 'landed' : r.summary })),
        el('div', { className: 'card-sub muted', textContent: `into ${r.target}` }),
        el('div', { className: 'card-sub muted', textContent: ago(r.opened) })))
      : el('p', { className: 'empty', textContent: 'Nothing has been cut yet. Propose a line on the Lines tab, read it on Changes, then cut it with +.' }))
  }

  const one = rows.find(r => key(r) === pickedCut) || null
  if (!changed('prcut-detail', one)) return
  paintCutDetail(one)
}

const key = r => `${r.source} -> ${r.target}`

function paintCutDetail (c) {
  if (!c) return fill($('prcut-detail'), el('p', { className: 'empty', textContent: 'Pick a cut on the left.' }))

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
      el('button', {
        className: 'btn ok',
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
            changed('prcuts', null)
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
  changed('prwrite-fields', null)
  changed('prtemplate', null)
  const tab = document.querySelector('#view-prcuts .subtab[data-pane="templates"]')
  if (tab) tab.click()
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
    changed('prcuts', null)
    changed('prcut-detail', null)
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
let cutPane = been.get('prcut-pane', 'cuts')
let tmplFrom = been.get('tmpl-from', null)
let tmplInto = been.get('tmpl-into', null)
let tmplAs = null
// The last preview, and what it was of. See paintTemplates.
let tmplSeen = null
// The pending write of what is being typed. See paintTemplates.
let draftTimer = null

document.querySelectorAll('#view-prcuts .subtab[data-pane]').forEach(t => {
  t.onclick = () => {
    cutPane = t.dataset.pane
    been.set('prcut-pane', cutPane)
    document.querySelectorAll('#view-prcuts .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
    document.querySelectorAll('#view-prcuts .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${cutPane}`))
    changed('prtemplate', null)
    paintTemplates()
  }
})
;(() => {
  const t = document.querySelector(`#view-prcuts .subtab[data-pane="${cutPane}"]`)
  if (!t) { cutPane = 'cuts'; return }
  document.querySelectorAll('#view-prcuts .subtab[data-pane]').forEach(x => x.classList.toggle('active', x === t))
  document.querySelectorAll('#view-prcuts .pane').forEach(x => x.classList.toggle('active', x.id === `pane-${cutPane}`))
})()

function paintTemplates () {
  if (view !== 'prcuts' || cutPane !== 'templates') return
  waiting('prtemplate', { lines: 6 })
  paintTemplatesNow()
}

async function paintTemplatesNow () {
  await settle()
  if (view !== 'prcuts' || cutPane !== 'templates') return
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
                .then(() => { tmplSeen = null; changed('prtemplate', null); changed('prtemplate-preview', null); paintTemplates() })
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
        tmplInto = (pickTargetFor(tmplFrom, usable) || {}).name || null
      }
      been.set('tmpl-from', tmplFrom)
      been.set('tmpl-into', tmplInto)

      const pick = (box, value, onPick) => {
        fill($(box), ...usable.map(g => el('option', { value: g.name, textContent: g.name, selected: g.name === value })))
        $(box).onchange = () => { onPick($(box).value); tmplSeen = null; changed('prtemplate', null); changed('prtemplate-preview', null); paintTemplates() }
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
          $('prtemplate-as').onchange = () => { tmplAs = $('prtemplate-as').value; tmplSeen = null; changed('prtemplate-preview', null); paintTemplates() }
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
              codeBlock(text, 'markdown', { lines: 26 })))
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

        const existing = v.existing && v.existing.count
        fill($('prwrite-actions'),
          existing
            ? null
            // GITHUB'S KIND OF DRAFT, which is not this app's kind: a pull
            // request that HAS been opened and is marked not ready for review.
            // Offered only when cutting, because it is a state a pull request is
            // opened in.
            : el('label', { className: 'inline', style: 'align-self:center' },
                el('input', { type: 'checkbox', id: 'prwrite-asdraft' }),
                el('span', { textContent: 'open them as drafts on GitHub' })),
          el('button', {
            className: 'btn ok',
            textContent: existing ? `Write it to all ${v.existing.count}` : `Cut it — ${v.repos.length} pull request(s)`,
            title: existing
              ? 'Changes the title and description of every pull request in this cut'
              : 'Pushes each branch onward and opens a pull request in every repository that carries work',
            onclick: () => existing ? writeToCut(v) : cutFromWriter(v)
          }),
          existing
            ? el('span', { className: 'muted', style: 'align-self:center', textContent: `cut ${ago(v.existing.opened)} — ${v.repos.length} repositor${v.repos.length === 1 ? 'y' : 'ies'} carry work` })
            : el('span', { className: 'muted', style: 'align-self:center', textContent: `${tmplFrom} into ${tmplInto}` }))
      })
      .catch(e => fill($('prtemplate-preview'), el('p', { className: 'empty bad', textContent: e.message })))
  }).catch(() => { /* the tab beside it says when the dashboard is unreachable */ })
}


// WRITING A NEW ONE. The same act as + on the Overview pane, from the surface
// where it was composed — so what was previewed is what is opened, rather than
// a second dialog asking for the same two sentences again.
function cutFromWriter (v) {
  ask({
    title: `Cut ${v.repos.length} pull request(s)?`,
    plain: [
      `One in each of: ${v.repos.join(', ')}. Only repositories that carry something get one.`,
      'Each branch is pushed onward from this host first. No machine is ever handed the token.',
      'They are opened, and then written again with links to each other — those numbers do not exist until all of them are open.'
    ],
    cost: 'This pushes branches to GitHub and opens pull requests. Both are visible to anyone who can see those repositories.',
    confirm: 'Push and open them',
    onYes: async () => {
      const asDraft = $('prwrite-asdraft') && $('prwrite-asdraft').checked
      const r = await api('prCutMake', {
        source: tmplFrom,
        target: tmplInto,
        title: $('prwrite-title').value.trim(),
        body: $('prwrite-body').value.trim(),
        draft: !!asDraft
      })
      pickedCut = `${tmplFrom} -> ${tmplInto}`
      been.set('prcut', pickedCut)
      tmplSeen = null
      changed('prwrite-fields', null)
      setText($('prwrite-state'), '')
      say(r.note, r.pulls.some(x => !x.opened) ? 'bad' : undefined)
      return refreshCuts()
    }
  })
}

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
