var React = require('react');

//---------------------------------------------------------------------------
//Pull requests: what is waiting to go in, per repository.
//
//THE SAME OBJECTS THE CHANGES TAB HOLDS AS ONE LANDING, LISTED SEPARATELY ON
//PURPOSE. "What is open against this repository" and "is my change in" are
//different questions, and the second one cannot be answered from this list —
//a change spans repositories and lands as a set, which is what Changes is for.
//Folding the two together makes one of them unanswerable.
//
//A PULL REQUEST LIVES IN THE REPOSITORY IT MERGES INTO, not in the one the
//branch is on. For a fork that is somewhere else entirely, which is why a fork's
//own list is empty while its work is plainly in flight — and why these are read
//from a SET of places named on Repos rather than from here.
//
//SO EVERY ROW HAS TO SAY FOUR THINGS: which repository it is open on, whose fork
//the branch came from, who opened it, and which branch it wants to go into. Any
//one of them missing and the list is ambiguous the moment more than one fork is
//read — `local-repo-b/pull/1` on its own does not say what it is against.
//
//AND A PLACE CAN BE SILENT WITHOUT BEING EMPTY, the same as issues: unreadable
//by this token, or answering nothing. `pullsFrom` carries what each one said.
//
//CLOSED ONES ARE STILL HERE, and the empty sentence says so: "Nothing open, and
//nothing closed recently." A list that quietly dropped closed pull requests
//would answer "did mine land" with silence.
//---------------------------------------------------------------------------

module.exports = function pulls(theme) {
    var {
        Panel, Stack, Head, Card, CardTitle, CardSub, Badge, Button,
        Empty, Note, ago, openOut
    } = theme;

    return function Pulls({ r }) {
        var list = r.pulls || null;
        var from = ((r.reads && r.reads.pulls) || []).filter(Boolean);
        var said = r.pullsFrom || [];
        var mine = (r.target && r.target.self) || null;
        var sendTo = (r.target && r.target.on) || null;

        //WHAT TO CALL A PLACE IN ONE WORD, beside the full name rather than
        //instead of it. Which link in the chain something is on is the question
        //this pane exists to answer, and `bm-sandbox-b/local-repo-a` does not
        //answer it on its own.
        function whatItIs(on) {
            if (on === mine) return 'yours';
            if (r.source && on === r.source) return 'the project';
            if (r.parent && on === r.parent) return 'one above yours';
            return null;
        }

        return (
            <Panel>
                <Head>
                    <span>Pull requests</span>
                    {/* EVERY PLACE READ, not the parent. The parent is one
                        possible answer to a question this app now lets somebody
                        answer for themselves, and naming it here contradicted
                        the setting whenever they answered it differently. */}
                    <span className="muted">{from.length ? 'on ' + from.join(', ') : r.repo}</span>
                    <span className="muted">{r.gathered ? ago(r.gathered) : ''}</span>
                </Head>

                {/* READING AND SENDING ARE TWO DECISIONS and this is the one
                    pane where both are visible at once — worth a sentence,
                    because a list of what is open somewhere nothing is sent to
                    is otherwise quietly confusing. */}
                {sendTo
                    ? <Note>{'Work from this repository opens on ' + sendTo
                        + (from.length && from.join(',') !== sendTo
                            ? ', and what is listed here is read from ' + from.join(', ') + '.'
                            : '.')}</Note>
                    : null}

                {/* WHAT EACH PLACE ANSWERED, because a place that could not be
                    read contributes no row to say so in. */}
                {said.length
                    ? <Note>
                        {said.map(function (x) {
                            var what = whatItIs(x.on);
                            return (x.on + (what ? ' (' + what + ')' : '') + ': '
                                + (x.why ? x.why
                                    : x.count === 1 ? '1 open pull request' : x.count + ' open pull requests'));
                        }).join(' · ')}
                    </Note>
                    : null}

                {list == null
                    ? <Empty>Not asked yet — this reads pull requests from the places chosen under Repos.</Empty>
                    : list.length
                        ? <Stack>
                            {list.map(function (p) {
                                return (
                                    <Card key={(p.on || '') + '#' + p.number}>
                                        <CardTitle>
                                            {/* WHERE IT IS OPEN, always spelled
                                                out. Two forks read at once both
                                                have a #1. */}
                                            <span className="mono muted">{(p.on || r.repo) + '#' + p.number}</span>
                                            <span>{p.title}</span>
                                            {whatItIs(p.on)
                                                ? <Badge kind="muted">{whatItIs(p.on)}</Badge>
                                                : null}
                                            {/* MERGED IS NOT CLOSED, and GitHub
                                                reports a merged pull request as
                                                closed. Reading the state alone
                                                would colour every landed change
                                                as a rejection. */}
                                            <Badge kind={p.merged ? 'ok' : p.state == 'closed' ? 'bad' : 'run'}>
                                                {p.merged ? 'merged' : p.state}
                                            </Badge>
                                            {p.draft ? <Badge kind="muted">draft</Badge> : null}
                                        </CardTitle>
                                        {/* WHOSE BRANCH, AND INTO WHAT. The head
                                            repository is dropped only when it is
                                            the same repository the pull request
                                            is open on — otherwise this is the
                                            line that says a change came from
                                            somebody else's fork, which is the
                                            whole reason to be careful with it
                                            before anything runs it. */}
                                        <CardSub>
                                            <span className="mono">
                                                {(p.headRepo && p.headRepo !== p.on ? p.headRepo + ':' : '')
                                                    + p.head + ' → ' + (p.on ? p.on + ':' : '') + p.base}
                                            </span>
                                        </CardSub>
                                        <CardSub>
                                            <span className="muted">
                                                {'opened by ' + (p.by || 'somebody')
                                                    + (p.association && p.association !== 'NONE'
                                                        ? ' (' + p.association.toLowerCase() + ')' : '')
                                                    + (p.at ? ', ' + ago(p.at) : '')}
                                            </span>
                                        </CardSub>
                                        <div className="row" style={{ marginTop: '6px' }}>
                                            <Button onClick={function () { openOut(p.url); }}>Read it on GitHub</Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>
                        : <Empty>Nothing open, and nothing closed recently.</Empty>}
            </Panel>
        );
    };
};
