var React = require('react');
var useAsk = require('../okc/ask');
var makeChassis = require('./chassis');
var makeReposRight = require('./list');
var makeIssues = require('./issues');
var makePulls = require('./pulls');

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

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./repos.scss.
    require('./repos.scss');
    var { shell, theme, okc, remember } = imports;
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

    //---- where this lives, and it is not a choice -------------------------
    //
    //THE TAB NAMES ARE THE STRUCTURE. This port had been inventing its own —
    //top-level tabs for Machines, Sessions, Sign-ins and Graph, none of which
    //exist in the app being ported from, and renamed panes elsewhere. An
    //information architecture that drifts is one that has to be re-learned by
    //anybody who knows the old window, which is everybody who would use this.
    //
    //The real map is in ui/index.html over there: twelve panes under
    //Repositories, six under Runners, and the tab names as written.
    shell.tab({ name: 'Repositories', order: 10 });
    shell.pane({ tab: 'Repositories', name: 'Overview', order: 10, Component: Overview });
    //THE THREE THAT SHARE A CHASSIS. Same repository list, same heading, same
    //remembered selection; a different sentence and a different right-hand half.
    //See ./chassis.js for why that is one file rather than three.
    var paneOf = makeChassis(theme, okc, remember);

    shell.pane({
        tab: 'Repositories', name: 'Repos', order: 20,
        Component: paneOf(
            'What this workspace is made of, and whether the far end of each one can still be reached. '
            + 'Everything above is local and instant; anything about GitHub was asked for on purpose and carries when it was asked.',
            makeReposRight(theme, okc))
    });
    shell.pane({
        tab: 'Repositories', name: 'Issues', order: 30,
        Component: paneOf(
            'Work that arrived, rather than work written here — the one thing in this app that comes IN. '
            + 'An issue becomes a task from the button on its card, which is the far end of a chain that otherwise starts midway.',
            makeIssues(theme, okc, remember, shell))
    });
    shell.pane({
        tab: 'Repositories', name: 'Pull requests', order: 40,
        Component: paneOf(
            'What is waiting to go in, per repository. The Changes tab holds the same pull requests as one landing, '
            + 'because "what is open against this repository" and "is my change in" are different questions.',
            makePulls(theme))
    });

    await register(null, {});
}
module.exports = plugin;
