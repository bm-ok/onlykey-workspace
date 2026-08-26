var React = require('react');
var { useState, useEffect, useRef } = React;

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

            //THE SELECTION IS WORKED OUT ABOVE THE EARLY RETURNS, and so is
            //every hook, because the effect below needs it. Hooks after a
            //`return` run on some draws and not others, and React counts them:
            //"Rendered more hooks than during the previous render", and the pane
            //draws its own error instead. This file has two early returns and
            //the first version of that effect sat under both of them.
            var repos = (q.state && q.state.repos) || [];
            //Reconciled against what exists. A remembered name for a repository
            //that has since been removed would leave the right-hand half empty
            //with nothing on screen to say why.
            var one = repos.filter(function (r) { return r.repo == picked; })[0]
                || (repos.length ? repos[0] : null);

            function say(note, kind) { setSaid({ text: note, kind: kind || null }); }

            function askGitHub(repo, quietly) {
                okc.call('repositoriesCheck', repo ? { repo: repo } : {}).then(
                    function (x) { if (!quietly) say(x.note); q.again(); },
                    //A REFRESH NOBODY ASKED FOR SAYS NOTHING WHEN IT FAILS
                    //EITHER. What it could not learn is already on the panel —
                    //"asked GitHub: never", and the reason under the repository
                    //— and a red banner for something nobody pressed is a banner
                    //about the app's own housekeeping.
                    function (e) { if (!quietly) say(e.message, 'bad'); }
                );
            }

            //---- AND IT ASKS ON ITS OWN WHEN WHAT IT HOLDS IS OLD -----------
            //
            //THIS PANEL SAID "asked GitHub: 6 days ago" AND WAITED TO BE
            //PRESSED. That was right when a check cost requests: a pane that
            //asks GitHub every few seconds spends somebody's rate limit on being
            //looked at, so it was made a deliberate act with a button.
            //
            //IT DOES NOT COST THAT ANY MORE. Every call carries an etag and
            //comes back 304 when nothing changed, and GitHub does not charge a
            //304 against the hourly limit. Measured on this workspace: one
            //repository is three conditional requests, all served from the etag
            //drawer, no misses. So the reason it was manual has gone, and what
            //is left is a panel showing week-old facts about somebody else's
            //repository until a person remembers to ask.
            //
            //ONE REPOSITORY, THE ONE BEING LOOKED AT, ONCE PER SELECTION. Not a
            //timer and not all of them: what is on screen is what is worth
            //spending a round trip on, and a timer would go on asking about a
            //tab nobody has open.
            //
            //AND ONLY WHEN WHAT IS HELD IS OLD. Five minutes, so moving between
            //repositories does not re-ask about one that was just read — the
            //cheap request is still a request, and three of them is two seconds
            //of a pane looking busy for nothing.
            //
            //THE BUTTON STAYS. "Ask GitHub" is now "ask again, now", which is
            //what somebody wants when they have just changed something over
            //there and do not want to wait out the five minutes.
            var STALE = 5 * 60 * 1000;
            var asked = useRef({});
            useEffect(function () {
                if (!one || !one.repo) return;
                if (asked.current[one.repo]) return;

                var when = one.checked ? Date.parse(one.checked) : 0;
                if (when && Date.now() - when < STALE) return;

                //MARKED BEFORE THE CALL, NOT AFTER. Two draws can land before an
                //answer comes back, and marking it afterwards would send the
                //second one out alongside the first.
                asked.current[one.repo] = true;
                askGitHub(one.repo, true);
            }, [one && one.repo, one && one.checked]);

            if (q.error && !q.state) return <Pane><Note kind="bad">{q.error}</Note></Pane>;
            if (!q.state) return <Pane><Skeleton rows={4} /></Pane>;

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
