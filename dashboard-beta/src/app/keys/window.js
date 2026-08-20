var React = require('react');
var useAsk = require('../okc/ask');

//the Keys tab: the Claude sign-ins this host holds.
//
//THE RULE THIS TAB IS BUILT AROUND, and it is the operator's own words: you
//should only know that something was done in here, not what. A credential is
//never shown, never logged, never returned by an action, and never put on a
//screen — so this tab is deliberately a page about credentials that contains
//none.
//
//WHAT IT SHOWS INSTEAD IS THE SHAPE OF ONE. A fingerprint, which is a hash and
//says only "the same one" or "a different one". Two dates, because the age of
//the SECRET and the age of the RECORD are different questions — `refreshed`
//moves only when the fingerprint actually changes, so a sign-in added weeks ago
//and refreshed this morning is a healthy one and looks it. Whether the last
//machine that tried it could authenticate. And who is holding it right now,
//because a sign-in that is out cannot be given to anything else.
//
//THE ACCOUNT IS SHOWN AND THE TOKEN IS NOT, which is not a contradiction: the
//email answers "whose bill is this" and is the thing somebody actually needs
//when two accounts are in play. It is not a secret; the token is.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    var day = function (s) { return s ? String(s).slice(0, 10) : null; };

    function Key({ g }) {
        //THREE STATES, NOT TWO. "Nobody has tried it" is not "it works", and
        //reporting the first as the second is how a dead sign-in sits looking
        //healthy until something spends a machine finding out.
        var check = g.lastCheck || null;
        var ready = check ? check.ready !== false : null;

        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{g.name}</Mono>{' '}
                    <Badge>{g.role}</Badge>{' '}
                    {ready === true ? <Badge kind="ok">signs in</Badge> : null}
                    {ready === false ? <Badge kind="bad">cannot sign in</Badge> : null}
                    {ready === null ? <Badge>never tried</Badge> : null}
                    {' '}
                    {g.holder ? <Badge kind="warn">{'out on ' + g.holder}</Badge> : null}
                    {!g.has ? <Badge kind="bad">no token behind it</Badge> : null}
                </div>

                <div className="card-sub">
                    {g.account ? <span>{(g.account.email || g.account) + ' '}</span> : null}
                    {g.plan ? <Badge>{g.plan}</Badge> : null}
                </div>

                <table className="kv">
                    <tbody>
                        <tr>
                            <th>added</th>
                            <td>{day(g.added) || 'unknown'}{g.from ? ' — ' + g.from : ''}</td>
                        </tr>
                        <tr>
                            {/* THE AGE OF THE SECRET, beside the age of the
                                record. It moves only when the fingerprint
                                differs, so "never" here means the token this
                                host holds is the one it was given. */}
                            <th>refreshed</th>
                            <td>{day(g.refreshed) || 'never — still the token it was given'}</td>
                        </tr>
                        <tr>
                            <th>fingerprint</th>
                            <td><Mono>{g.fingerprint || 'unknown'}</Mono></td>
                        </tr>
                        {g.lastGivenTo ? (
                            <tr>
                                <th>last given to</th>
                                <td><Mono>{g.lastGivenTo}</Mono>{g.lastGiven ? ' on ' + day(g.lastGiven) : ''}</td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>

                {check && check.ready === false && check.why
                    ? <Note kind="bad">{check.why}</Note>
                    : null}
            </div>
        );
    }

    function Keys() {
        var { state, error, reads } = useAsk(okc, 'guests', {}, 10000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

        var rows = state.guests || [];
        var dead = rows.filter(function (g) { return g.lastCheck && g.lastCheck.ready === false; });

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                {/* WORTH SAYING AT THE TOP, because it is the one fact that
                    stops everything: with no sign-in a machine can authenticate
                    with, work waits and no machine is spent on it. */}
                {dead.length
                    ? <Note kind="bad">{dead.length + ' of ' + rows.length + ' cannot sign in. Work that needs one of those waits, and no machine is spent on it.'}</Note>
                    : null}

                <Panel>
                    <div className="card-title">{rows.length + ' sign-in' + (rows.length == 1 ? '' : 's')}</div>
                    {rows.length
                        ? rows.map(function (g) { return <Key key={g.name} g={g} />; })
                        : <Empty>this host holds no Claude sign-in — nothing can be given work</Empty>}
                </Panel>

                <Note>{'read ' + reads + ' time(s), every 10s. No credential is shown here, and none is returned by the action that fills this page.'}</Note>
            </Pane>
        );
    }

    shell.tab({ name: 'Keys', order: 100 });
    shell.pane({ tab: 'Keys', name: 'This host', order: 10, Component: Keys });

    await register(null, {});
}
module.exports = plugin;
