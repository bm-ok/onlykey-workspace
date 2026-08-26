var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//What Repos, Issues and Pull requests all are: pick a repository on the left,
//read something about it on the right.
//
//THREE PANES, ONE CHASSIS, AND IT IS THE SAME CHASSIS OVER THERE. The old window
//paints the repository list and the "REPOSITORIES — n in <dir>" heading once and
//swaps only the right-hand half; `paintReposNow` ends by dispatching to
//`paintRepoDetail`, `paintRepoIssues` or `paintRepoPulls`. Copying that list into
//three panes here would be three places to fix when a card grows a badge, and
//three chances for them to stop agreeing about which repository is selected.
//
//THE SELECTION IS REMEMBERED ONCE, FOR ALL THREE. Picking local-repo-b under
//Repos and then opening Issues has to show local-repo-b's issues — anything else
//is a pane silently answering about a different repository than the one on the
//screen a moment ago. One `remember` key, shared, is what makes that true.
//
//NOTHING HERE ASKS GITHUB ON A TIMER. `repositories` returns what was last
//learnt; the "Ask GitHub" button is what reaches out. All three panes inherit
//that from sharing this.
//---------------------------------------------------------------------------

module.exports = function chassis(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Badges, Button, Skeleton, Empty, Note, Mono, Notice
    } = theme;

    //THE HEAD IS ITS OWN PIECE, because one pane on this tab does not ride the
    //chassis and still has to carry it. Overview is full width and has no
    //repository picker — it is the one pane that is not about a repository you
    //chose — but it is still a reading of what was last gathered, and "how old
    //is this and how do I ask again" is the same question there. The old window
    //had this as one block of markup ABOVE all of them with the picker hidden
    //underneath; this is that, as a component.
    function Head({ lead, dir, count, note, said, setSaid, askGitHub }) {
        return (
            <>
                <Note>{lead}</Note>
                <TitleRow>
                    <span>Repositories</span>
                    <span className="muted">{count ? '— ' + count + ' in ' + dir : '— none'}</span>
                    <Grow />
                    <Button onClick={function () { askGitHub(null); }}>Ask GitHub</Button>
                </TitleRow>
                <Note>{note}</Note>
                {said ? <Notice kind={said.kind} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
            </>
        );
    }

    //`lead` is the sentence the pane opens with — it differs per pane and is the
    //one thing that says what this half is for. `Right` is given the selected
    //repository, a way to say something, and a way to ask again.
    function paneOf(lead, Right) {
        return function ReposPane() {
            var q = okc.use('repositories', {}, 8000);
            var [picked, setPicked] = remember.use('repos', 'repo', null);
            var [said, setSaid] = useState(null);

            if (q.error && !q.state) return <Pane><Note kind="bad">{q.error}</Note></Pane>;
            if (!q.state) return <Pane><Skeleton rows={4} /></Pane>;

            var repos = q.state.repos || [];
            //Reconciled against what exists. A remembered name for a repository
            //that has since been removed would leave the right-hand half empty
            //with nothing on screen to say why.
            var one = repos.filter(function (r) { return r.repo == picked; })[0]
                || (repos.length ? repos[0] : null);

            function say(note, kind) { setSaid({ text: note, kind: kind || null }); }

            function askGitHub(repo) {
                okc.call('repositoriesCheck', repo ? { repo: repo } : {}).then(
                    function (x) { say(x.note); q.again(); },
                    function (e) { say(e.message, 'bad'); }
                );
            }

            return (
                <Pane>
                    <Head lead={lead} dir={q.state.dir} count={repos.length} note={q.state.note}
                        said={said} setSaid={setSaid} askGitHub={askGitHub} />

                    <Cols>
                        <Col narrow>
                            <Stack>
                                {repos.length ? repos.map(function (r) {
                                    return (
                                        <Card key={r.repo} pick on={one && r.repo == one.repo}
                                            warn={r.reachable === false}
                                            onClick={function () { setPicked(r.repo); }}>
                                            <CardTitle>
                                                <Mono>{r.repo}</Mono>
                                                {r.reachable === false ? <Badge kind="bad">unreachable</Badge> : null}
                                                {r.reachable === true && r.why ? <Badge kind="warn">limited</Badge> : null}
                                            </CardTitle>
                                            <CardSub><span className="mono">{r.default || '(no default branch)'}</span></CardSub>
                                            <Badges>
                                                <span className="muted">{r.branches + ' branch(es)'}</span>
                                                {r.openIssues != null ? <span className="muted">{r.openIssues + ' issue(s)'}</span> : null}
                                                {r.openPulls != null ? <span className="muted">{r.openPulls + ' pull(s)'}</span> : null}
                                            </Badges>
                                        </Card>
                                    );
                                }) : <Empty>No repositories in this workspace folder.</Empty>}
                            </Stack>
                        </Col>
                        <Col wide>
                            {one
                                ? <Right r={one} say={say} again={q.again} askGitHub={askGitHub} />
                                : <Panel><Empty>Pick a repository on the left.</Empty></Panel>}
                        </Col>
                    </Cols>
                </Pane>
            );
        };
    };

    //TWO WAYS IN: the whole chassis for a pane that picks a repository, and the
    //head on its own for one that does not.
    paneOf.Head = Head;
    return paneOf;
};
