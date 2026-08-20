var React = require('react');
var useAsk = require('../okc/ask');

//the GitHub pane: the three keys this host holds, and what each one is for.
//
//THE SAME RULE THE KEYS TAB IS BUILT ON, and it is the operator's: you should
//only know that something was done in here, not what. None of the three secrets
//is shown, none is returned by the actions that fill this page, and none could
//be — a fingerprint, a login, an expiry and a scope list say everything a person
//needs to answer "is this working and whose is it" without any of them being the
//thing itself.
//
//THREE DIFFERENT KEYS, THREE DIFFERENT JOBS, and they get confused constantly:
//
//  the GitHub token   reaches GitHub. Opens pull requests, reads issues. Its
//                     scopes are the whole of what this host may do out there.
//  the ssh key        reaches the MACHINES. Not GitHub at all.
//  the TLS pair       is how a machine knows it is talking to THIS host when it
//                     fetches its scripts. It expires, and nothing works after.
//
//AN EXPIRY IS A DATE UNTIL IT IS CLOSE, and then it is a problem. All three of
//these keep working perfectly right up until they stop, so the number of days
//left is the only part anybody acts on.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./github.scss.
    require('./github.scss');
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };

    function Row({ label, children }) {
        return <tr><th>{label}</th><td>{children}</td></tr>;
    }

    function GitHub() {
        var token = useAsk(okc, 'githubHeld', {}, 30000);
        var ssh = useAsk(okc, 'sshKey', {}, 30000);
        var tls = useAsk(okc, 'tlsKey', {}, 30000);

        if (!token.state && token.error) return <Pane><Note kind="bad">{token.error}</Note></Pane>;
        if (!token.state) return <Pane><Empty>asking…</Empty></Pane>;

        var t = token.state;
        var s = ssh.state || {};
        var x = tls.state || {};

        return (
            <Pane>
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
                    ) : <Empty>no GitHub token — add one in the old window, and nothing here is ever shown it</Empty>}
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
                    </tbody></table>
                    {x.why ? <Note kind="warn">{x.why}</Note> : null}
                </Panel>

                <Note>no key, token or certificate is shown here, and none is returned by the actions that fill this page</Note>
            </Pane>
        );
    }

    //ui/github.js paints into `app-keys` over there — the GitHub token sits
    //on the KEYS screen beside the ssh key and the certificate, not among the
    //repositories. It shares one screen with them there and is a pane here,
    //which is a divergence worth knowing about rather than a decision.
    shell.pane({ tab: 'Keys', name: 'GitHub', order: 20, Component: GitHub });

    await register(null, {});
}
module.exports = plugin;
