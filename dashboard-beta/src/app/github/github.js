var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//the three credentials this host holds, and the six things that can be done to
//them.
//
//NONE OF THEM IS EVER SHOWN, and that is the rule this pane is built to rather
//than a side effect of the actions happening not to return them. You can see
//THAT a token is held, who it belongs to, what it may do and when it expires —
//and never the token. The one place a secret is typed is a password field in a
//dialog, because this window gets photographed several times a day, by this app,
//on purpose.
//
//EVERY DESTRUCTIVE ONE IS PURPLE AND GATED. Three of these six cannot be undone
//and two of them lock this host out of every machine it has already built — so
//they are a person's press, refused to the command line and to the driver, with
//the cost written out before the press rather than discovered after it.
//---------------------------------------------------------------------------

module.exports = function github(theme, okc) {
    var { Pane, Panel, Badge, Button, Empty, Note, Notice, Mono, Skeleton, ask } = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };

    function Row({ label, children }) {
        return <tr><th>{label}</th><td>{children}</td></tr>;
    }

    function GitHub() {
        var token = okc.use('githubHeld', {}, 30000);
        var ssh = okc.use('sshKey', {}, 30000);
        var tls = okc.use('tlsKey', {}, 30000);
        var [said, setSaid] = useState(null);

        if (!token.state && token.error) return <Pane><Note kind="bad">{token.error}</Note></Pane>;
        if (!token.state) return <Pane><Skeleton rows={4} /></Pane>;

        var t = token.state;
        var s = ssh.state || {};
        var x = tls.state || {};

        function ok(text) { setSaid({ text: text }); }
        function bad(e) { setSaid({ bad: true, text: e.message }); throw e; }

        //---- the GitHub token ----------------------------------------------

        //ASKING GITHUB WHO THIS IS, which is the only way to know. A token that
        //is held is not a token that works: it can be revoked, expired or
        //scoped wrongly, and every one of those looks identical from here until
        //somebody asks the far end.
        function check() {
            return okc.call('githubCheck').then(function (r) {
                setSaid({ bad: !r.ok, text: r.note });
                token.again();
            }, bad);
        }

        function setToken() {
            ask({
                title: t.held ? 'Replace the GitHub token' : 'Add a GitHub token',
                plain: [
                    'It is checked against GitHub before it is kept, so a token that does not work never replaces one that does.',
                    'Sealed for this Windows account, outside the repository. It is never shown again — not here, not in the log, not in an error — and never handed to a machine.',
                    //SAID BEFORE, NOT DIAGNOSED AFTER. This app knows exactly
                    //what it needs and used to say nothing, so the first real
                    //token arrived missing Contents — and reported "read, push,
                    //admin" while being refused, because that field describes
                    //the account rather than the token.
                    'FINE-GRAINED, if every repository here has the same owner. It is the smallest thing to lose. Give it exactly: Contents — Read and write, to push a branch onward. Pull requests — Read and write, to open one and follow it. Metadata — Read, which GitHub adds itself. Nothing else.',
                    //TWO KINDS, AND WHICH IS RIGHT DEPENDS ON THE REPOSITORIES.
                    //A fine-grained token is scoped to ONE resource owner, so a
                    //workspace whose forks live in an organisation and whose
                    //parents are personal repositories cannot be covered by one
                    //at all — no combination of permissions fixes that, and
                    //finding out costs an evening.
                    'CLASSIC, if they do not. A fine-grained token covers one owner only, so an organisation fork with a personal-account parent needs a classic one — tick `repo` and nothing else. Add `workflow` only if a branch will ever change files under .github/workflows, which git otherwise refuses to push.',
                    'Either way, give it an expiry. This app reads it and says how long is left; a token that never expires is the one still working long after anybody remembers it exists.'
                ],
                link: 'https://github.com/settings/personal-access-tokens',
                fields: [
                    //A PASSWORD FIELD AND A PROTECTED ONE, which are two
                    //different protections and both are wanted. The type keeps
                    //it off the screen this app photographs; the guard keeps it
                    //out of `windowFill`, so nothing driving this window can put
                    //a credential into it or read one back out.
                    { name: 'token', label: 'Token', type: 'password', protect: true, placeholder: 'github_pat_… or ghp_…' },
                    { name: 'api', label: 'API host, if not github.com', value: t.api || 'api.github.com', placeholder: 'api.github.com' }
                ],
                confirm: 'Check it and keep it',
                onYes: function (f) {
                    if (!f.token) throw new Error('Nothing was typed, so there is nothing to check.');
                    return okc.call('githubKeySet', { token: f.token, api: f.api }).then(function (r) {
                        ok(r.note);
                        token.again();
                    }, bad);
                }
            });
        }

        function forgetToken() {
            ask({
                title: 'Throw the GitHub token away?',
                danger: true,
                plain: [
                    'It is deleted from this host. Nothing else changes — no branch, no pull request, no repository.',
                    //DELETING A COPY IS NOT ENDING A CREDENTIAL, and this is the
                    //sentence that stops somebody thinking it is.
                    'It is NOT revoked on GitHub. If it may have been seen by anything, revoke it there as well; deleting a copy is not the same as ending a credential.'
                ],
                confirm: 'Throw it away',
                onYes: function () {
                    return okc.call('githubKeyForget').then(function (r) {
                        ok(r.note);
                        token.again();
                    }, bad);
                }
            });
        }

        //---- this app's own two keys ----------------------------------------

        function writeSshConfig() {
            return okc.call('sshConfig').then(function (r) {
                var n = (r.hosts || []).length;
                ok(n + ' machine' + (n === 1 ? '' : 's') + ' written to ' + r.file
                    + (r.include && r.include.added ? ', and included from ' + r.include.file : ''));
            }, bad);
        }

        function makeSshKey() {
            ask({
                title: s.ok ? 'Make a new ssh key?' : 'Make this app an ssh key?',
                danger: !!s.ok,
                plain: s.ok
                    ? [
                        'A new key is written, and this one is gone.',
                        'Every machine already built has the OLD public key in its authorized_keys, and nothing here can reach in to change that — the only thing that could is the key being replaced.',
                        'Machines built after this will accept the new one.'
                    ]
                    : [
                        'Makes a key belonging to this app, kept beside its certificate.',
                        'New machines are built with it; machines that already exist are not touched.'
                    ],
                cost: s.ok
                    ? 'This app loses its way into every existing machine. They have to be rebuilt, or given the new key by hand while the old one still works.'
                    : null,
                confirm: s.ok ? 'Replace it' : 'Make it',
                onYes: function () {
                    return okc.call('sshKeyMake', { force: true }).then(function (r) {
                        ok(r.fingerprint + ' — ' + r.note);
                        ssh.again();
                    }, bad);
                }
            });
        }

        function newCertificate() {
            ask({
                title: 'Make a new certificate?',
                danger: true,
                plain: [
                    'A new authority and a new certificate, naming this host’s addresses as they are now.',
                    'Every machine already built trusts the OLD authority, which was checked against a fingerprint when it was made. They will refuse the new one.',
                    'This is what to do when this host’s address has changed, or the certificate is close to expiring.'
                ],
                cost: 'Every existing machine has to be set up again before it can fetch scripts or push work.',
                confirm: 'Replace it',
                onYes: function () {
                    return okc.call('tlsRegenerate').then(function () {
                        ok('New certificate. Every machine has to be set up again.');
                        tls.again();
                    }, bad);
                }
            });
        }

        //A TOKEN THAT WAS CHECKED AND REFUSED reads differently from one that has
        //never been asked about, and the buttons swap emphasis accordingly: when
        //it is dead the useful press is "Replace it", not "Check it again".
        var dead = t.held && t.ok === false;

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Panel>
                    <div className="card-title">
                        {'GitHub token '}
                        {t.held
                            ? <Badge kind="ok">{'held' + (t.login ? ' — ' + t.login : '')}</Badge>
                            : <Badge kind="bad">none — nothing can reach GitHub</Badge>}
                    </div>
                    {t.held ? (
                        <table className="kv"><tbody>
                            <Row label="as">{(t.name || '') + (t.login ? ' (' + t.login + ')' : '')}</Row>
                            <Row label="kind">{t.kind || 'unknown'}</Row>
                            {/* THE SCOPES ARE THE WHOLE OF WHAT IT MAY DO. A token
                                with more than it needs is the one worth noticing,
                                and it is invisible unless the list is on screen. */}
                            <Row label="scopes">
                                {(t.scopes || []).length
                                    ? (t.scopes || []).map(function (sc) { return <span key={sc}><Badge>{sc}</Badge>{' '}</span>; })
                                    : <span className="muted">none — it can read public things and nothing else</span>}
                            </Row>
                            <Row label="expires">{t.expires || 'no expiry'}</Row>
                            <Row label="added">{day(t.added) || 'unknown'}</Row>
                        </tbody></table>
                    ) : <Empty>no GitHub token, so nothing here can push a branch onward or open a pull request</Empty>}

                    {/* WHAT A CLASSIC TOKEN COSTS, said where it is held rather
                        than left to be remembered. `repo` is not "the
                        repositories in this workspace" — it is every repository
                        the account can reach, in every organisation, for as long
                        as the token lives. That is a reasonable trade when the
                        owners are split and a fine-grained token cannot span
                        them, and it is only reasonable while somebody knows they
                        made it. */}
                    {t.held && t.kind === 'classic' ? (
                        <Note kind="warn">
                            <strong>This is a classic token. </strong>
                            {'Its scopes are not limited to this workspace — '
                                + ((t.scopes || []).indexOf('repo') >= 0
                                    ? '`repo` reaches every repository this account can, in every organisation'
                                    : 'they apply to everything this account can reach')
                                + '. That is the price of covering more than one owner with one credential'
                                + (t.expires ? '' : ', and it has no expiry, so nothing will ever make it stop') + '.'}
                        </Note>
                    ) : null}

                    <div className="row">
                        {t.held ? (
                            <Button kind={dead ? '' : 'ok'} onClick={check}
                                title="Asks GitHub who this token is">
                                {t.ok ? 'Check it again' : 'Check it'}
                            </Button>
                        ) : null}
                        {/* NOT GATED, AND THAT IS THE POINT OF THE GATE ELSEWHERE.
                            Adding a token is how this gets set up in the first
                            place, it replaces nothing that cannot be replaced
                            again, and the dialog's own field is where the
                            protection belongs. */}
                        <Button kind={t.held ? (dead ? 'ok' : '') : 'ok'} onClick={setToken}>
                            {t.held ? 'Replace it' : 'Add a token'}
                        </Button>
                        {t.held
                            ? <Button kind="danger" protect onClick={forgetToken}>Throw it away</Button>
                            : null}
                    </div>
                </Panel>

                <Panel>
                    <div className="card-title">
                        {'ssh key '}
                        {s.ok ? <Badge kind="ok">held</Badge> : <Badge kind="warn">{s.missing ? 'none' : 'unknown'}</Badge>}
                    </div>
                    {/* NOT GITHUB'S. This one reaches the machines, and mixing the
                        two up is how somebody replaces a working key looking for
                        a GitHub problem. */}
                    <div className="card-sub">how this host reaches the machines — nothing to do with GitHub</div>
                    <table className="kv"><tbody>
                        <Row label="fingerprint"><Mono>{s.fingerprint || 'none'}</Mono></Row>
                        <Row label="made">{day(s.made) || 'unknown'}</Row>
                        <Row label="machines with it">{(s.machines || []).length || 0}</Row>
                    </tbody></table>
                    {s.why ? <Note kind="warn">{s.why}</Note> : null}

                    {/* WHICH MACHINES WILL REFUSE IT, by name. "Some machines will
                        not accept it" is a sentence somebody has to go and
                        investigate; the names are the investigation. */}
                    {(s.strangers || []).length ? (
                        <div className="card-sub">
                            {(s.strangers || []).length + ' machine' + ((s.strangers || []).length === 1 ? '' : 's')
                                + ' will not accept it: ' + (s.strangers || []).map(function (m) { return m.name || m; }).join(', ')
                                + ' — built with a different key, and nothing here can change that from outside.'}
                        </div>
                    ) : null}

                    <div className="row">
                        <Button onClick={writeSshConfig}
                            title="So ssh and VS Code find these machines by name, using this key">
                            Write the ssh config
                        </Button>
                        <Button kind="danger" protect onClick={makeSshKey}>
                            {s.ok ? 'Make a new one' : 'Make one'}
                        </Button>
                    </div>
                </Panel>

                <Panel>
                    <div className="card-title">
                        {'TLS certificate '}
                        {x.expired ? <Badge kind="bad">expired</Badge>
                            : x.expiringSoon ? <Badge kind="warn">{x.daysLeft + ' days left'}</Badge>
                                : x.ok ? <Badge kind="ok">{x.daysLeft + ' days left'}</Badge>
                                    : <Badge kind="warn">unknown</Badge>}
                    </div>
                    <div className="card-sub">how a machine knows it is talking to this host when it fetches its scripts</div>
                    <table className="kv"><tbody>
                        <Row label="covers">{(x.covers || []).join(', ') || 'nothing'}</Row>
                        {/* COVERS AND MATCHES ARE DIFFERENT QUESTIONS. A
                            certificate can be perfectly valid and name an address
                            this host no longer has — which fails at the far end,
                            on a machine, twenty-five minutes into an install. */}
                        <Row label="this host is">
                            {x.address || 'unknown'}
                            {x.matches === false ? <span>{' '}<Badge kind="bad">not covered</Badge></span> : null}
                        </Row>
                        <Row label="good until">{day(x.validTo) || 'unknown'}</Row>
                        {/* PUBLISHED RATHER THAN SECRET, which is why it may be on
                            screen at all: a brand-new machine checks the authority
                            against this over a connection that is not yet
                            protected, and that is what makes the very first fetch
                            possible. */}
                        <Row label="authority"><Mono>{x.fingerprint || '—'}</Mono></Row>
                    </tbody></table>
                    {x.why ? <Note kind="warn">{x.why}</Note> : null}

                    <div className="row">
                        <Button kind="danger" protect onClick={newCertificate}>Make a new certificate</Button>
                    </div>
                </Panel>

                <Note>no key, token or certificate is shown here, and none is returned by the actions that fill this page</Note>
            </Pane>
        );
    }

    return GitHub;
};
