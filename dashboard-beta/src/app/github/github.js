var React = require('react');

module.exports = function github(theme, okc) {
    var { Pane, Panel, Badge, Empty, Note, Mono, Skeleton} = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };

    function Row({ label, children }) {
        return <tr><th>{label}</th><td>{children}</td></tr>;
    }

    function GitHub() {
        var token = okc.use('githubHeld', {}, 30000);
        var ssh = okc.use('sshKey', {}, 30000);
        var tls = okc.use('tlsKey', {}, 30000);

        if (!token.state && token.error) return <Pane><Note kind="bad">{token.error}</Note></Pane>;
        if (!token.state) return <Pane><Skeleton rows={4} /></Pane>;

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

    return GitHub;
};
