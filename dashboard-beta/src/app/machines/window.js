var React = require('react');
var useAsk = require('../okc/ask');

//the Machines tab.
//
//THE SECOND TAB, AND ITS JOB IS TO PROVE THE FIRST ONE WAS NOT A ONE-OFF. It
//shares nothing with Queue but the two services it declares — `shell` to put
//itself on the bar and `okc` to ask the dashboard something. No import between
//tabs, no shared mutable state, and neither knows the other exists.
//
//WHAT IT SHOWS IS WHAT DECIDES SOMETHING. A machine list that prints every
//field is a list nobody reads: this answers the questions the old window's own
//cards answer — is it up, can it be reached, what may it be given, is it
//holding a credential, is it claiming a branch, and is anything allowed to give
//it work.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    function state(v) {
        if (v.running) return { kind: 'ok', word: v.connected ? 'running' : 'running, not dialled in' };
        if (v.installing) return { kind: 'run', word: 'installing' + (v.stage ? ' — ' + v.stage : '') };
        return { kind: '', word: v.state || 'off' };
    }

    function Machine({ v }) {
        var s = state(v);
        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{v.name}</Mono>{' '}
                    <Badge kind={s.kind}>{s.word}</Badge>
                </div>
                <div className="card-sub">
                    {/* WHAT IT MAY BE GIVEN, and "nothing" is a real answer
                        rather than a missing one. A machine with no role tag
                        gets no automatic work at all, because the queue picks
                        which sign-in to hand over from the role — so an
                        unlabelled machine means guessing whose identity to
                        send, and it does not guess. */}
                    {(v.kinds || []).length
                        ? (v.kinds || []).map(function (k) { return <span key={k}><Badge>{k}</Badge>{' '}</span>; })
                        : <span><Badge kind="warn">no role — the queue leaves it alone</Badge>{' '}</span>}

                    {v.forTasks === false ? <span><Badge kind="warn">kept back from tasks</Badge>{' '}</span> : null}
                    {v.holdsCredential ? <span><Badge kind="warn">holding a sign-in</Badge>{' '}</span> : null}
                    {v.borrowed ? <span><Badge kind="run">borrowed</Badge>{' '}</span> : null}
                </div>
                {v.branch ? <div className="card-sub">claims <Mono>{v.branch}</Mono></div> : null}
                {v.borrowed && v.borrowed.why ? <div className="note muted">{v.borrowed.why}</div> : null}
            </div>
        );
    }

    function Machines() {
        var { state: got, error, reads } = useAsk(okc, 'vmList', {}, 5000);

        if (!got && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!got) return <Pane><Empty>asking…</Empty></Pane>;

        var rows = got.vms || [];
        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}
                <Panel>
                    <div className="card-title">{rows.length + ' machine' + (rows.length == 1 ? '' : 's')}</div>
                    {rows.length
                        ? rows.map(function (v) { return <Machine key={v.name} v={v} />; })
                        : <Empty>this host has no machines yet</Empty>}
                </Panel>
                <Note>{'read ' + reads + ' time(s), every 5s'}</Note>
            </Pane>
        );
    }

    shell.tab({ name: 'Machines', order: 10, Component: Machines });

    await register(null, {});
}
module.exports = plugin;
