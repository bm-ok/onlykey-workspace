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
//OPENED INTO THE PARENT, BECAUSE THIS IS A FORK. A pull request from a fork is
//created in the repository it merges INTO, not in the one the branch lives in —
//so these are read from there, and the row says so rather than leaving somebody
//to wonder why their own repository lists none.
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

        return (
            <Panel>
                <Head>
                    <span>Pull requests</span>
                    <span className="muted">{r.parent ? 'on ' + r.parent : r.repo}</span>
                    <span className="muted">{r.gathered ? ago(r.gathered) : ''}</span>
                </Head>
                {r.parent
                    ? <Note>{'Opened into ' + r.parent + ', because this is a fork. A pull request from a fork is created in the repository it is merged into.'}</Note>
                    : null}

                {list == null
                    ? <Empty>Not asked yet. &ldquo;Ask GitHub&rdquo; reads issues and pull requests for every repository here.</Empty>
                    : list.length
                        ? <Stack>
                            {list.map(function (p) {
                                return (
                                    <Card key={p.number}>
                                        <CardTitle>
                                            <span className="mono muted">{'#' + p.number}</span>
                                            <span>{p.title}</span>
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
                                        <CardSub><span className="mono">{p.head + ' → ' + p.base}</span></CardSub>
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
