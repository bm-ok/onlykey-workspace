var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//the GitHub token, and only that.
//
//IT WAS ONE PANE HOLDING THREE CREDENTIALS, and two of them were not GitHub.
//The ssh key reaches the machines and the certificate is how a machine knows it
//is talking to this host — neither has anything to do with github.com, and a
//pane called GitHub containing them is how somebody replaces a working ssh key
//while looking for a GitHub problem. That sentence was literally in the old
//pane, as a warning, one panel down: "nothing to do with GitHub". A warning that
//a heading is misleading is an argument for a different heading.
//
//THIS ONE GOES OUT AND THE OTHER TWO DO NOT, which is the division the app being
//ported from draws as well: "GitHub" and "This app's own keys" are two headings
//there for the same reason they are two panes here.
//
//NONE OF THEM IS EVER SHOWN, and that is a rule this pane is built to rather
//than a side effect of the actions happening not to return one. You can see THAT
//a token is held, whose it is, what it may do and when it expires — never the
//token. The one place a secret is typed is a password field in a dialog, because
//this window gets photographed several times a day, by this app, on purpose.
//---------------------------------------------------------------------------

module.exports = function github(theme, okc) {
    var { Pane, Panel, Badge, Button, Empty, Note, Notice, ask } = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };
    function Row({ label, children }) {
        return <tr><th>{label}</th><td>{children}</td></tr>;
    }

    return function GitHub() {
        var token = okc.use('githubHeld', {}, 30000);
        //WHERE WORK GOES AND WHETHER THIS ACCOUNT MAY SEND IT THERE. Read from
        //the last sweep -- this pane asks GitHub nothing of its own.
        var where = okc.use('repositories', {}, 30000);
        var [said, setSaid] = useState(null);

        if (!token.state && token.error) return <Pane><Note kind="bad">{token.error}</Note></Pane>;
        if (!token.state) return <Pane><Note>reading…</Note></Pane>;

        var t = token.state;
        function ok(text) { setSaid({ text: text }); }
        function bad(e) { setSaid({ bad: true, text: e.message }); throw e; }

        //ASKING GITHUB WHO THIS IS, which is the only way to know. A token that
        //is held is not a token that works: it can be revoked, expired or scoped
        //wrongly, and every one of those looks identical from here until
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
                    <div className="card-sub">this host pushes branches onward and opens pull requests with it — no machine is ever handed it</div>

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
                            {/* WHAT THAT ACCOUNT CAN ACTUALLY DO WITH THE WORK,
                                from what the sweep PROBED rather than from what
                                GitHub says the account's permissions are — see
                                the header of ../repositories/repos/server.js for
                                why those are different answers. A token swapped
                                for one that cannot open a pull request where
                                work goes is the failure this line exists to
                                bring forward from an hour later. */}
                            {(where.state && (where.state.repos || []).length) ? (
                                <Row label="may send work">
                                    {(where.state.repos || []).map(function (r) {
                                        var into = r.intoTarget || null;
                                        var to = (r.target && r.target.on) || r.repo;
                                        var mine = r.asWho && t.login && r.asWho !== t.login;
                                        var kind = mine ? 'warn' : into && into.mayOpen === false ? 'bad' : into && into.mayOpen ? 'ok' : 'muted';
                                        var word = mine ? 'read as ' + r.asWho
                                            : !into ? 'not asked yet'
                                                : into.mayOpen ? 'to ' + to : 'NOT to ' + to;
                                        return <span key={r.repo}><Badge kind={kind}>{r.repo + ': ' + word}</Badge>{' '}</span>;
                                    })}
                                </Row>
                            ) : null}
                        </tbody></table>
                    ) : (
                        <div>
                            <Empty>no GitHub token, so nothing here can push a branch onward or open a pull request</Empty>
                            {/* EMPTY WOULD READ AS BROKEN, so it says which of
                                the two it is. This app keeps its credentials in
                                its OWN directory — that is the whole reason
                                nothing here can damage the one the dashboard is
                                using — and until this action was ported, this
                                pane was showing the dashboard's answer down a
                                relay. It stopped, and the pane went blank, and
                                a blank pane looks exactly like a fault. */}
                            <Note kind="warn">
                                This app holds its own credentials, separately from the dashboard it is
                                being ported from — so its token is not visible here and cannot be
                                changed from here. That is deliberate: nothing in this app can damage the
                                credential the other one is working with. Add a token to use this app for
                                real; both will then hold one, and they are different tokens.
                            </Note>
                        </div>
                    )}

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
                            ? <Button kind="danger" onClick={forgetToken}>Throw it away</Button>
                            : null}
                    </div>
                </Panel>

                <Note>no token is shown here, and none is returned by the action that fills this page</Note>
            </Pane>
        );
    };
};
