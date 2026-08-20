var React = require('react');
var useAsk = require('../okc/ask');

//the Repositories tab, and its first pane.
//
//THE TAB IS A CONTAINER AND OWNS ALMOST NOTHING. It registers itself so there is
//something for panes to land in, and registers the one pane that belongs to it.
//Every other pane — branches, changes, PR cuts, GitHub — is its own folder
//naming this tab, and this file does not list them or know they exist. That is
//what lets the five biggest files left be ported one at a time, in any order,
//by anyone.
//
//WHAT THE OVERVIEW IS FOR. One list of everything outstanding across every
//repository: issues somebody filed, pull requests that arrived, and cuts this
//host sent out. The point is that "is there anything to do" should not require
//opening four panes and adding up — and that GitHub cannot answer it, because
//each repository only sees its own.
//
//AND IT IS A READING, NOT A LIVE VIEW. Every row is as fresh as the last time
//GitHub was asked, which the app says out loud rather than implying currency it
//does not have. Nothing here polls GitHub on a timer; that is deliberate over
//there and carried across.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./repos.scss.
    require('./repos.scss');
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    var LOOK = {
        merged: 'ok',
        open: '',
        closed: 'warn',
        landed: 'ok'
    };

    function Item({ it }) {
        var where = it.repos && it.repos.length ? it.repos.join(', ') : (it.repo || it.on || '');
        return (
            <div className="card">
                <div className="card-title">
                    <Badge kind={it.kind == 'cut' ? '' : 'run'}>{it.kind}</Badge>{' '}
                    {it.number ? <Mono>{'#' + it.number + ' '}</Mono> : null}
                    {it.title}
                    {it.state ? <span>{' '}<Badge kind={LOOK[it.state] === undefined ? '' : LOOK[it.state]}>{it.state}</Badge></span> : null}
                </div>
                <div className="card-sub">
                    {where ? <Mono>{where}</Mono> : null}
                    {it.source && it.target ? <span>{' · '}<Mono>{it.source + ' → ' + it.target}</Mono></span> : null}
                </div>
            </div>
        );
    }

    function Overview() {
        var { state, error, reads } = useAsk(okc, 'repoOverview', {}, 10000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

        var counts = state.counts || {};
        var items = state.items || [];

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <div className="card-title">
                        {'Outstanding — '}
                        <Badge>{(counts.issues || 0) + ' issue' + (counts.issues == 1 ? '' : 's')}</Badge>{' '}
                        <Badge>{(counts.pulls || 0) + ' pull request' + (counts.pulls == 1 ? '' : 's')}</Badge>{' '}
                        <Badge>{(counts.cuts || 0) + ' cut' + (counts.cuts == 1 ? '' : 's')}</Badge>
                        {counts.toAllow ? <span>{' '}<Badge kind="warn">{counts.toAllow + ' to allow'}</Badge></span> : null}
                    </div>

                    {items.length
                        ? items.slice(0, 20).map(function (it, i) { return <Item key={it.id || i} it={it} />; })
                        : <Empty>nothing is outstanding — no issue, no arrived pull request, and nothing cut and unlanded</Empty>}

                    {items.length > 20 ? <Note>{'showing the newest 20 of ' + items.length}</Note> : null}
                </Panel>

                {/* THE AGE OF THE ANSWER, said rather than implied. Everything
                    above is as fresh as the last time GitHub was asked, and a
                    list with no age is one somebody treats as current for ever. */}
                <Note>{(state.note || '') + ' · read ' + reads + ' time(s) from this host'}</Note>
            </Pane>
        );
    }

    shell.tab({ name: 'Repositories', order: 5 });
    shell.pane({ tab: 'Repositories', name: 'Overview', order: 10, Component: Overview });

    await register(null, {});
}
module.exports = plugin;
