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
    function Head({ lead, dir, count, note, said, setSaid }) {
        return (
            <>
                <Note>{lead}</Note>
                <TitleRow>
                    <span>Repositories</span>
                    <span className="muted">{count ? '— ' + count + ' in ' + dir : '— none'}</span>
                    <Grow />
                    {/* NO "Ask GitHub" BUTTON. What it did now happens on its
                        own — see the effect below — and a button for it would be
                        asking somebody to do the app's housekeeping by hand.

                        The count and the dir stay: what is HERE is local and
                        instant, and that is a different fact from what GitHub
                        last said. */}
                </TitleRow>
                <Note>{note}</Note>
                {said ? <Notice kind={said.kind} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
            </>
        );
    }

    //`lead` is the sentence the pane opens with — it differs per pane and is the
    //one thing that says what this half is for. `Right` is given the selected
    //repository, a way to say something, and a way to ask again.
    //---- KEEPING WHAT IS SHOWN CURRENT, WITHOUT ASKING ANYBODY TO ---------
    //
    //THERE WAS A BUTTON FOR THIS AND THERE IS NOT ANY MORE. "Ask GitHub" was
    //right while a check cost requests — a pane that asks every few seconds
    //spends somebody's rate limit on being looked at. Every call now carries an
    //etag and comes back 304 when nothing changed, and GitHub does not charge a
    //304 against the hourly limit, so the cost that made it a decision is gone.
    //Measured here: eighteen conditional requests for three repositories, all
    //served from the drawer, no misses.
    //
    //EVERY REPOSITORY, NOT ONE. Repos, Issues, Pull requests and Overview all
    //read the same stored answers, and three of those four are lists of every
    //repository at once — checking only what is selected would leave them
    //showing whatever was last asked about something else.
    //
    //ONCE PER VISIT, AND ONLY WHEN THE OLDEST IS OLD. Two minutes: long enough
    //that moving between these tabs does not re-ask, short enough that nothing
    //on screen is meaningfully behind.
    //
    //QUIET BOTH WAYS. Nobody pressed it, so it says nothing when it works and
    //nothing when it fails — what could not be learnt is already on the panel,
    //as "asked GitHub: never" and the reason beside the repository.
    var STALE = 2 * 60 * 1000;

    function keptFresh(repos, askGitHub) {
        var asked = useRef(false);
        useEffect(function () {
            if (asked.current || !repos.length) return;

            //THE OLDEST DECIDES. One repository checked a moment ago does not
            //make the other two current.
            var oldest = repos.reduce(function (at, r) {
                var when = r.checked ? Date.parse(r.checked) : 0;
                return when && when < at ? when : at;
            }, Date.now());
            if (repos.every(function (r) { return r.checked; }) && Date.now() - oldest < STALE) return;

            //MARKED BEFORE THE CALL, NOT AFTER. Two draws can land before an
            //answer comes back, and marking it afterwards would send the second
            //one out alongside the first.
            asked.current = true;
            askGitHub(null, true);
        }, [repos.length]);
    }

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
            //EVERY REPOSITORY, NOT ONLY THE ONE SELECTED. This pane, Issues and
            //Pull requests all read the same stored answers, and the two lists
            //are of every repository at once — checking only what is selected
            //would leave those two showing whatever was last asked about
            //something else.
            //
            //ONCE PER VISIT, AND ONLY WHEN THE OLDEST IS OLD. Measured here:
            //eighteen conditional requests for three repositories, every one
            //served from the etag drawer, no misses, no quota. Two minutes is
            //enough that switching tabs does not re-ask and short enough that
            //nothing on screen is meaningfully behind.
            //
            //THERE IS NO BUTTON TO FALL BACK ON any more, which is the point:
            //asking is not a decision somebody should have to make about a fact
            //that verifies itself for nothing.
            keptFresh(repos, askGitHub);

            if (q.error && !q.state) return <Pane><Note kind="bad">{q.error}</Note></Pane>;
            if (!q.state) return <Pane><Skeleton rows={4} /></Pane>;

            return (
                <Pane>
                    <Head lead={lead} dir={q.state.dir} count={repos.length} note={q.state.note}
                        said={said} setSaid={setSaid} />

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
    //AND THE THIRD: keeping what is shown current. Overview uses the head
    //without the chassis, reads the same stored answers, and would otherwise be
    //the one pane left showing whatever was last asked for by somebody else.
    paneOf.keptFresh = keptFresh;
    return paneOf;
};
