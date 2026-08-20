var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//how this host reaches the machines. NOTHING TO DO WITH GITHUB.
//
//That sentence used to be a warning printed inside a pane called GitHub, which
//is the whole reason this is its own pane now: a caption apologising for the
//heading above it is a heading in the wrong place. Somebody chasing a GitHub
//problem should never be one panel away from replacing the key that gets this
//host into every machine it has built.
//
//REPLACING IT IS THE MOST EXPENSIVE PRESS ON THIS TAB. Every machine already
//built has the OLD public key in its authorized_keys, and nothing here can reach
//in to change that — the only thing that could is the key being replaced. So it
//is a person's press, gated, with the cost written out before rather than
//discovered after.
//---------------------------------------------------------------------------

module.exports = function ssh(theme, okc) {
    var { Pane, Panel, Badge, Button, Note, Notice, Mono, ask } = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };
    function Row({ label, children }) {
        return <tr><th>{label}</th><td>{children}</td></tr>;
    }

    return function Ssh() {
        var ssh = okc.use('sshKey', {}, 30000);
        var [said, setSaid] = useState(null);

        if (!ssh.state && ssh.error) return <Pane><Note kind="bad">{ssh.error}</Note></Pane>;
        if (!ssh.state) return <Pane><Note>reading…</Note></Pane>;

        var s = ssh.state || {};
        function ok(text) { setSaid({ text: text }); }
        function bad(e) { setSaid({ bad: true, text: e.message }); throw e; }

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

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Panel>
                    <div className="card-title">
                        {'ssh key '}
                        {s.ok ? <Badge kind="ok">held</Badge> : <Badge kind="warn">{s.missing ? 'none' : 'unknown'}</Badge>}
                    </div>
                    <div className="card-sub">how this host reaches the machines — kept in the app's own directory, never in anybody's home</div>

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

                <Note>no key is shown here, and none is returned by the action that fills this page</Note>
            </Pane>
        );
    };
};
