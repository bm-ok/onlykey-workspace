'use strict'

// The token, and what it may reach.
//
// Part of the window. See ui/load.js for the order these are read in and why
// the order matters.

// ---- the GitHub token --------------------------------------------------
//
// The same shape as the worker credential above, because the questions are the
// same: is one held, does it work, and what do I do about it. What differs is
// where it is spent — that one goes out to a machine per task, this one never
// leaves this host.
//
// THE TOKEN IS NEVER SHOWN, and never returned by anything the window can call.
// What is shown is who GitHub says it is, which is the fact somebody actually
// needs: "opened under the wrong account" is the mistake this prevents.
function paintGithub () {
  api('githubHeld').then(g => {
    if (!changed('github', g)) return

    const tried = g.checked || null
    const dead = tried && tried.ok === false
    const proven = tried && tried.ok === true

    fill($('github-key'), g.held
      ? el('div', { className: `card${dead ? ' warn' : ''}` },
          el('div', { className: 'card-title' },
            el('span', { textContent: g.login ? `@${g.login}` : 'GitHub token' }),
            el('span', {
              className: `badge ${dead ? 'bad' : proven ? 'ok' : 'warn'}`,
              textContent: dead ? 'will not work' : proven ? 'working' : 'not tried yet'
            }),
            g.kind ? el('span', { className: 'badge muted', textContent: g.kind }) : null),
          el('table', { className: 'kv', style: 'margin-top:8px' },
            g.name ? el('tr', {}, el('th', { textContent: 'account' }), el('td', { textContent: `${g.name} (@${g.login})` })) : null,
            el('tr', {}, el('th', { textContent: 'last tried' }),
              el('td', {}, tried
                ? el('span', { className: tried.ok ? 'ok' : 'bad', textContent: `${tried.ok ? 'worked' : 'refused'}, ${ago(tried.at)}${tried.why ? ` — ${tried.why}` : ''}` })
                : el('span', { className: 'muted', textContent: 'never — nothing has used it since it was added' }))),
            // A fine-grained token does not report its scopes, and an empty list
            // is not the same as none. Said as unknown rather than guessed at,
            // because the guess would be about what this app may do to somebody
            // else's repositories.
            el('tr', {}, el('th', { textContent: 'may do' }),
              el('td', {}, g.scopes && g.scopes.length
                ? el('span', { className: 'mono', textContent: g.scopes.join(', ') })
                : el('span', { className: 'muted', textContent: g.kind === 'fine-grained'
                    ? 'a fine-grained token does not say — GitHub reports its permissions nowhere this can read'
                    : 'it reported no scopes' }))),
            g.expires ? el('tr', {}, el('th', { textContent: 'expires' }), el('td', { className: 'mono', textContent: g.expires })) : null,
            el('tr', {}, el('th', { textContent: 'api' }), el('td', { className: 'mono', textContent: g.api })),
            el('tr', {}, el('th', { textContent: 'added' }), el('td', { className: 'mono', textContent: `${new Date(g.added).toLocaleString()} — ${ago(g.added)}` })),
            el('tr', {}, el('th', { textContent: 'kept in' }), el('td', { className: 'mono', style: 'user-select:text', textContent: g.dir })),
            el('tr', {}, el('th', { textContent: 'at rest' }),
              el('td', {}, el('span', { className: `badge ${g.sealed ? 'ok' : 'warn'}`, textContent: g.sealed ? 'sealed' : 'plain' }))),
            el('tr', {}, el('th', { textContent: '' }), el('td', { className: 'muted', textContent: g.protection || '' }))),

          el('p', { className: 'note', style: 'margin-top:10px', textContent: dead
            ? 'GitHub refused it. Replace it below — and revoke the old one on GitHub, since something that stopped working may have stopped for a reason.'
            : 'Never handed to a machine, and never shown here. Only this host spends it.' }),

          // WHAT A CLASSIC TOKEN COSTS, said where it is held rather than left to
          // be remembered. `repo` is not "the repositories in this workspace" —
          // it is every repository the account can reach, in every organisation,
          // for as long as the token lives. That is a reasonable trade when the
          // owners are split and a fine-grained token cannot span them, and it
          // is only reasonable while somebody knows they made it.
          g.kind === 'classic'
            ? el('p', { className: 'note' },
                el('strong', { className: 'bad', textContent: 'This is a classic token. ' }),
                el('span', { textContent: `Its scopes are not limited to this workspace — ${(g.scopes || []).includes('repo') ? '`repo` reaches every repository this account can, in every organisation' : 'they apply to everything this account can reach'}. That is the price of covering more than one owner with one credential${g.expires ? '' : ', and it has no expiry, so nothing will ever make it stop'}.` }))
            : null,

          el('div', { className: 'row' },
            el('button', {
              className: `btn ${dead ? '' : 'ok'}`,
              textContent: proven ? 'Check it again' : 'Check it',
              title: 'Asks GitHub who this token is',
              onclick: () => api('githubCheck').then(r => { changed('github', null); say(r.note, r.ok ? undefined : 'bad'); return draw() }).catch(oops)
            }),
            el('button', {
              className: `btn ${dead ? 'ok' : ''}`,
              textContent: 'Replace it',
              onclick: () => askForGithubToken(g)
            }),
            el('button', {
              className: 'btn danger',
              textContent: 'Throw it away',
              onclick: () => ask({
                title: 'Throw the GitHub token away?',
                plain: [
                  'It is deleted from this host. Nothing else changes — no branch, no pull request, no repository.',
                  'It is NOT revoked on GitHub. If it may have been seen by anything, revoke it there as well; deleting a copy is not the same as ending a credential.'
                ],
                confirm: 'Throw it away',
                danger: true,
                onYes: async () => {
                  const r = await api('githubKeyForget')
                  changed('github', null)
                  say(r.note)
                  return draw()
                }
              })
            })))
      : el('div', {},
          el('p', { className: 'empty', textContent: 'No GitHub token, so nothing here can push a branch onward or open a pull request.' }),
          el('button', { className: 'btn ok', textContent: 'Add a token', onclick: () => askForGithubToken(null) })))
  }).catch(() => { /* the panel beside it is the one worth an error */ })
}

function askForGithubToken (g) {
  ask({
    title: g && g.held ? 'Replace the GitHub token' : 'Add a GitHub token',
    plain: [
      'It is checked against GitHub before it is kept, so a token that does not work never replaces one that does.',
      'Sealed for this Windows account, beside the worker credential, outside the repository. It is never shown again — not here, not in the log, not in an error — and never handed to a machine.',
      // SAID BEFORE, NOT DIAGNOSED AFTER. This app knows exactly what it needs
      // and used to say nothing, so the first real token arrived missing
      // Contents — and reported "read, push, admin" while being refused, because
      // that field describes the account rather than the token. Naming the
      // permissions here is the difference between a two-minute setup and
      // finding out one repository at a time.
      //
      // TWO KINDS, AND WHICH ONE IS RIGHT DEPENDS ON THE REPOSITORIES. A
      // fine-grained token is scoped to ONE resource owner, so a workspace whose
      // forks live in an organisation and whose parents are personal
      // repositories cannot be covered by one of them at all — no combination of
      // permissions fixes that, and finding out costs an evening. The
      // Repositories tab says which owners are involved.
      'FINE-GRAINED, if every repository here has the same owner. It is the smallest thing to lose. Give it exactly: Contents — Read and write, to push a branch onward. Pull requests — Read and write, to open one and follow it. Metadata — Read, which GitHub adds itself. Nothing else.',
      'CLASSIC, if they do not. A fine-grained token covers one owner only, so an organisation fork with a personal-account parent needs a classic one — tick `repo` and nothing else. Add `workflow` only if a branch will ever change files under .github/workflows, which git otherwise refuses to push.',
      'Either way, give it an expiry. This app reads it and says how long is left; a token that never expires is the one still working long after anybody remembers it exists.'
    ],
    link: 'https://github.com/settings/personal-access-tokens',
    fields: [
      // A password field, because this is typed on a screen that gets
      // photographed — including by this app, on purpose, several times a day.
      { name: 'token', label: 'Token', type: 'password', placeholder: 'github_pat_… or ghp_…' },
      { name: 'api', label: 'API host, if not github.com', value: (g && g.api) || 'api.github.com', placeholder: 'api.github.com' }
    ],
    confirm: 'Check it and keep it',
    onYes: async f => {
      const r = await api('githubKeySet', { token: f.token, api: f.api })
      changed('github', null)
      say(r.note)
      return draw()
    }
  })
}

// The two keys this app needs in order to be itself.
//
// Together because they are the same kind of thing: a credential the app owns,
// kept in its own directory rather than in anybody's home, which nothing else
// should have to provide. One is how a machine knows it is talking to this host;
// the other is how this host gets back into a machine when the machine has
// stopped talking.
//
// NEITHER SHOWS A PRIVATE KEY. A fingerprint identifies a key without being one,
// and a window that displays a secret is a window that ends up in a screenshot.
function paintAppKeys () {
  Promise.all([api('sshKey'), api('tlsKey')]).then(([mine, tls]) => {
    if (!changed('app-keys', [mine, tls])) return

    const strangers = (mine.machines || []).filter(m => !m.authorised)

    fill($('app-keys'),
      // ---- ssh ----------------------------------------------------------
      el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: 'ssh — the way back into a machine' }),
          el('span', { className: `badge ${mine.ok ? 'ok' : 'warn'}`, textContent: mine.ok ? 'have one' : 'none yet' })),
        mine.ok
          ? el('table', { className: 'kv', style: 'margin-top:8px' },
              el('tr', {}, el('th', { textContent: 'fingerprint' }), el('td', { className: 'mono', style: 'user-select:text', textContent: mine.fingerprint || '—' })),
              el('tr', {}, el('th', { textContent: 'kept in' }), el('td', { className: 'mono', style: 'user-select:text', textContent: mine.file || '' })),
              el('tr', {}, el('th', { textContent: 'made' }), el('td', { className: 'muted', textContent: mine.made ? new Date(mine.made).toLocaleString() : '—' })))
          : el('p', { className: 'note', textContent: mine.why || '' }),

        // Which machines would actually let it in — a different question from
        // whether the key exists, and the one that matters when you cannot get
        // into something.
        strangers.length
          ? el('div', { className: 'card-sub muted', style: 'margin-top:8px' },
              `${strangers.length} machine${strangers.length === 1 ? '' : 's'} will not accept it: ` +
              `${strangers.map(m => m.name).join(', ')} — built with a different key, and nothing here can change that from outside.`)
          : el('div', { className: 'card-sub muted', style: 'margin-top:8px', textContent: 'Every machine here accepts it.' }),

        el('div', { className: 'row', style: 'margin-top:10px' },
          el('button', {
            className: 'btn',
            textContent: 'Write the ssh config',
            title: 'So ssh and VS Code find these machines by name, using this key',
            onclick: () => api('sshConfig').then(r => say(
              `${r.hosts.length} machine${r.hosts.length === 1 ? '' : 's'} written to ${r.file}${r.include.added ? `, and included from ${r.include.file}` : ''}`
            )).catch(oops)
          }),
          el('button', {
            className: 'btn danger',
            textContent: mine.ok ? 'Make a new one' : 'Make one',
            onclick: () => ask({
              title: mine.ok ? 'Make a new ssh key?' : 'Make this app an ssh key?',
              plain: mine.ok
                ? [
                    'A new key is written, and this one is gone.',
                    'Every machine already built has the OLD public key in its authorized_keys, and nothing here can reach in to change that — the only thing that could is the key being replaced.',
                    'Machines built after this will accept the new one.'
                  ]
                : [
                    'Makes a key belonging to this app, kept beside its certificate.',
                    'New machines are built with it; machines that already exist are not touched.'
                  ],
              cost: mine.ok ? 'This app loses its way into every existing machine. They have to be rebuilt, or given the new key by hand while the old one still works.' : null,
              confirm: mine.ok ? 'Replace it' : 'Make it',
              danger: !!mine.ok,
              onYes: async () => { const r = await api('sshKeyMake', { force: true }); say(`${r.fingerprint} — ${r.note}`) }
            })
          }))),

      // ---- tls ----------------------------------------------------------
      el('div', { className: 'card' },
        el('div', { className: 'card-title' },
          el('span', { textContent: 'https — how a machine knows it is this host' }),
          el('span', {
            className: `badge ${tls.ok ? 'ok' : tls.missing ? 'bad' : 'warn'}`,
            textContent: tls.missing ? 'none' : tls.expired ? 'expired' : !tls.matches ? 'wrong address' : tls.expiringSoon ? 'expiring' : 'good'
          })),
        el('table', { className: 'kv', style: 'margin-top:8px' },
          el('tr', {}, el('th', { textContent: 'names' }), el('td', { className: 'mono', style: 'user-select:text', textContent: (tls.covers || []).join(', ') || '—' })),
          el('tr', {}, el('th', { textContent: 'this host is' }), el('td', { className: 'mono', textContent: tls.address || 'unknown' })),
          el('tr', {}, el('th', { textContent: 'expires' }), el('td', { className: 'muted', textContent: tls.validTo ? `${new Date(tls.validTo).toDateString()} — ${tls.daysLeft} days` : '—' })),
          // Published rather than secret: a brand-new machine checks the
          // authority against this over a connection that is not yet protected,
          // which is what makes the very first fetch possible at all.
          el('tr', {}, el('th', { textContent: 'authority' }), el('td', { className: 'mono', style: 'user-select:text; word-break:break-all', textContent: tls.fingerprint || '—' }))),
        tls.why ? el('div', { className: 'card-sub bad', style: 'margin-top:8px', textContent: tls.why }) : null,

        el('div', { className: 'row', style: 'margin-top:10px' },
          el('button', {
            className: 'btn danger',
            textContent: 'Make a new certificate',
            onclick: () => ask({
              title: 'Make a new certificate?',
              plain: [
                'A new authority and a new certificate, naming this host\'s addresses as they are now.',
                'Every machine already built trusts the OLD authority, which was checked against a fingerprint when it was made. They will refuse the new one.',
                'This is what to do when this host\'s address has changed, or the certificate is close to expiring.'
              ],
              cost: 'Every existing machine has to be set up again before it can fetch scripts or push work.',
              confirm: 'Replace it',
              danger: true,
              onYes: async () => { await api('tlsRegenerate'); say('New certificate. Every machine has to be set up again.') }
            })
          }))))
  }).catch(() => { /* the tab above already says if the dashboard is unreachable */ })
}

// Ask which machine, sign in on it, then take what it got.
// One button, and the machine is clean before and gone afterwards.
//
// IT USED TO ASK WHICH RUNNING MACHINE SHOULD SIGN IN, which put the work in the
// wrong place. Somebody had to have started a machine, know which one was safe to
// use, and then remember three more steps afterwards -- take the credential,
// forget it, put the machine away -- with nothing reminding them. The ordinary
// outcome was a runner left on holding a live credential, which is exactly the
// state the banner nags about.
//
// Now: a free machine is borrowed, brought up at its base snapshot, signed in,
// emptied and put away. Nothing is chosen because there is nothing worth
// choosing, and no machine is left carrying anything.
// Settling it now, rather than a task finding out.
function testCredentials () {
  const free = (queueSays.size ? [...queueSays.values()] : []).filter(m => m.free)
  ask({
    title: 'Test the worker credential',
    plain: [
      'A free machine is borrowed and brought up clean, handed this host\'s credential, and asked whether its worker can actually authenticate.',
      'The credential is taken back off it and the machine is put away afterwards, whatever the answer — a test that leaves a credential on a disk has silently blocked that machine\'s next snapshot.',
      'The answer is kept here, so nothing has to ask again until the credential changes.',
      free.length
        ? `Free right now: ${free.map(m => m.name).join(', ')}.`
        : 'Nothing is free at the moment, so this will refuse and say why.'
    ],
    cost: 'It takes a minute or two to bring a machine up.',
    confirm: 'Test it',
    onYes: async () => {
      const r = await api('credentialsTest', {})
      changed('keys', null)
      say(r.note, r.ready === false ? 'bad' : undefined)
      return draw()
    }
  })
}

function getCredentials () {
  ask({
    title: 'Get Claude Code credentials',
    plain: [
      'A free machine is borrowed and brought up clean, it signs in, this host keeps what it gets, and the machine is put away with nothing left on it.',
      'You will get an address to visit; the machine holds the sign-in open until you bring the code back.',
      'The queue will not touch that machine while this is going on.'
    ],
    cost: 'It takes a minute or two to bring a machine up before there is anything to visit.',
    confirm: 'Start the sign-in',
    onYes: async () => {
      const started = await api('credentialsBegin', {})
      // A second dialog rather than a field on the first, because the address
      // does not exist until a machine has been brought up and asked -- and a
      // form that asks for a code before there is anything to get one from is a
      // form nobody can fill in.
      askForCode(started.name, started.url)
    }
  })
}

function askForCode (name, url) {
  ask({
    title: `Sign ${name} in`,
    plain: [
      'Open the sign-in page, approve it, and paste back what it gives you.',
      `${name} is holding the sign-in open until you do — it is waiting on that page, not on this window.`
    ],
    link: url,
    fields: [{ name: 'code', label: 'The code from that page', placeholder: 'paste it here' }],
    confirm: 'Finish signing in',
    // GIVING UP HAS TO HAND THE MACHINE BACK, or abandoning a sign-in leaves a
    // borrowed runner out of the pool with nobody using it — the exact failure
    // borrowing was meant to stop being possible.
    extra: {
      label: 'Give up',
      onClick: () => api('vmAuthCancel', { name })
        .catch(() => { /* it may never have started; the machine still goes back */ })
        .then(() => api('vmReturn', { name }))
        .then(() => say(`the sign-in on ${name} was abandoned, and ${name} is back in the pool`))
        .catch(oops)
    },
    onYes: async f => {
      if (!f.code) throw new Error('Paste the code from the sign-in page.')
      // One call: the code, the credential taken, and the machine put away
      // clean. Three steps somebody used to have to remember, in the order that
      // leaves nothing behind.
      const done = await api('credentialsFinish', { name, code: f.code })
      say(done.note)
      showTab('keys')
      paintKeys()
      return done
    }
  })
}
