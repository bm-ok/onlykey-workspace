var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//how a machine knows it is talking to THIS host.
//
//CALLED HTTPS RATHER THAN TLS, because that is the question it answers. "TLS
//certificate" names the mechanism; what somebody wants to know standing here is
//whether a machine can still fetch its scripts from this host over https, and
//for how much longer.
//
//THE AUTHORITY FINGERPRINT IS ON SCREEN, AND IT IS NOT A SECRET. That is worth
//saying out loud on a tab where everything else is: a brand-new machine checks
//this host's authority against this value over a connection that is not yet
//protected, and that check is what makes the very first fetch possible at all.
//Published, not held.
//
//COVERS AND MATCHES ARE DIFFERENT QUESTIONS, and the pane asks both. A
//certificate can be perfectly valid and name an address this host no longer has
//— which fails at the far end, on a machine, twenty-five minutes into an
//install.
//---------------------------------------------------------------------------

module.exports = function https(theme, okc) {
    var { Pane, Panel, Badge, Button, Note, Notice, Mono, ask } = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };
    function Row({ label, children }) {
        return <tr><th>{label}</th><td>{children}</td></tr>;
    }

    return function Https() {
        var tls = okc.use('tlsKey', {}, 30000);
        var [said, setSaid] = useState(null);

        if (!tls.state && tls.error) return <Pane><Note kind="bad">{tls.error}</Note></Pane>;
        if (!tls.state) return <Pane><Note>reading…</Note></Pane>;

        var x = tls.state || {};
        function ok(text) { setSaid({ text: text }); }
        function bad(e) { setSaid({ bad: true, text: e.message }); throw e; }

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

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Panel>
                    <div className="card-title">
                        {'certificate '}
                        {x.expired ? <Badge kind="bad">expired</Badge>
                            : x.expiringSoon ? <Badge kind="warn">{x.daysLeft + ' days left'}</Badge>
                                : x.ok ? <Badge kind="ok">{x.daysLeft + ' days left'}</Badge>
                                    : <Badge kind="warn">unknown</Badge>}
                    </div>
                    <div className="card-sub">how a machine knows it is talking to this host when it fetches its scripts</div>

                    <table className="kv"><tbody>
                        <Row label="covers">{(x.covers || []).join(', ') || 'nothing'}</Row>
                        {/* COVERS AND MATCHES ARE DIFFERENT QUESTIONS. See the
                            header: valid and pointing at the wrong address fails
                            on a machine, deep into an install. */}
                        <Row label="this host is">
                            {x.address || 'unknown'}
                            {x.matches === false ? <span>{' '}<Badge kind="bad">not covered</Badge></span> : null}
                        </Row>
                        <Row label="good until">{day(x.validTo) || 'unknown'}</Row>
                        {/* PUBLISHED RATHER THAN SECRET, which is why it may be on
                            screen at all — see the header. */}
                        <Row label="authority"><Mono>{x.fingerprint || '—'}</Mono></Row>
                    </tbody></table>
                    {x.why ? <Note kind="warn">{x.why}</Note> : null}

                    <div className="row">
                        <Button kind="danger" protect onClick={newCertificate}>Make a new certificate</Button>
                    </div>
                </Panel>

                <Note>the authority fingerprint above is published on purpose; the private half is never shown and never leaves this host</Note>
            </Pane>
        );
    };
};
