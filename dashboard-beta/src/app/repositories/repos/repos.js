var React = require('react');
var { useState, useRef, useEffect } = React;

//---------------------------------------------------------------------------
//Repos: what this workspace is made of, and whether the far end of each one can
//still be reached.
//
//TWO KINDS OF FACT ON ONE PANEL, AND THE DIFFERENCE IS THE POINT. Everything
//local — the path, the default branch, the branches and their commits — is read
//from git here and is instant and current. Everything about GitHub was asked for
//ON PURPOSE, at a moment, and carries when it was asked. Mixing them without
//saying which is which is how "unreachable" gets read as "gone" when it means
//"nobody has asked since Tuesday".
//
//WHICH IS WHY NOTHING HERE ASKS GITHUB ON A TIMER. `repositories` returns what
//was last learnt; `repositoriesCheck` is a button. A panel that refreshed the
//remote every few seconds would spend a rate limit on a fact that changes when
//somebody forks something — months apart — and would make "asked GitHub: 11
//hours ago" impossible to ever see.
//
//WHERE WORK GOES IS THE ONE THING ON THIS PANE THAT REACHES SOMEBODY ELSE'S
//REPOSITORY.
//
//      my fork  <->  somebody else's fork  <->  the project
//
//A change belongs in the fork you forked FROM: if the project itself were the
//destination you would have forked the project. So picking a link is picking who
//you are working with, and everything above them stops being this app's business
//— not watched, not counted, not shown. It is stated in a sentence rather than
//as a bare name, because a name cannot carry whether anybody chose it, and that
//is the whole distinction.
//---------------------------------------------------------------------------

module.exports = function repos(theme, okc) {
    var {
        Panel, Grow, Card, CardTitle, Badge, Button, Plus, Skeleton, Empty,
        Note, Mono, Kv, KvRow, Part, PartWhy, ask, ago, openOut
    } = theme;

    //Which of them a fast-forward can actually help. `ahead` and `only here` are
    //not problems to be fixed — they are work that has not gone anywhere yet —
    //and `diverged` is a decision this app does not make.
    function canCatchUp(b) { return b.state == 'behind' || b.state == 'different'; }

    var STATE = {
        same: null,
        behind: { kind: 'warn', word: 'behind' },
        ahead: { kind: 'muted', word: 'ahead' },
        diverged: { kind: 'bad', word: 'diverged' },
        different: { kind: 'warn', word: 'out of step' },
        'only here': { kind: 'muted', word: 'only here' },
        'only on origin': { kind: 'muted', word: 'only on origin' }
    };

    function whyNotCatchUp(b) {
        if (canCatchUp(b)) return 'Fast-forward ' + b.branch + ' to origin';
        if (b.state == 'same') return 'Already the same commit as origin';
        if (b.state == 'ahead') return 'It is ahead of origin — there is nothing here to catch up to';
        if (b.state == 'diverged') return 'It and origin have both moved. This only fast-forwards, so it will not touch it';
        if (b.state == 'only here') return 'Origin has no branch by this name';
        return 'There is nothing here to fast-forward';
    }

    //WHAT THE ROW MEANS, AS OPPOSED TO WHAT IT SAYS. The shas answer "is my copy
    //current"; this answers "am I done with this branch" — the question somebody
    //actually has, and the one that is hard to see, because a squashed pull
    //request leaves work that HAS landed looking unmerged.
    function saysAbout(b) {
        var a = b.against;
        if (!a) return null;
        var behind = a.behind ? a.behind + ' commit(s) behind ' + a.base : null;
        if (a.state == 'landed') {
            return (
                <PartWhy>
                    <span className="ok">{'Everything on this branch is already in ' + a.base}</span>
                    <span className="muted">{' — the commits look different because the pull request was squashed when it merged. Nothing here is unsaved. It can be deleted on the Branches tab.'}</span>
                </PartWhy>
            );
        }
        if (a.state == 'live') {
            return (
                <PartWhy>
                    <span>{a.unlanded + ' commit(s) not in ' + a.base + ' yet'}</span>
                    {behind ? <span className="muted">{' · ' + behind + ', so it was cut before the latest work landed'}</span> : null}
                </PartWhy>
            );
        }
        //Nothing unique and nothing behind is the ordinary resting state of a
        //branch that is simply level, and it needs no sentence at all.
        return behind ? <PartWhy><span className="muted">{'Nothing of its own · ' + behind}</span></PartWhy> : null;
    }

    //---- the branches of the selected repository ---------------------------

    function Branches({ repo, onMoved }) {
        //ASKED EVERY EIGHT SECONDS BECAUSE IT IS LOCAL AND IT MOVES. This reads
        //git, not GitHub — a sync from the Branches tab or the command line
        //moves it, and a panel whose whole job is saying whether two things
        //match is worse than useless when it is stale.
        var q = okc.use('repoBranches', { repo: repo }, 8000);
        var [busy, setBusy] = useState(null);

        function sync(branch) {
            setBusy(branch || '*');
            okc.call('repoSyncBranch', branch ? { repo: repo, branch: branch } : { repo: repo }).then(
                function (x) { setBusy(null); q.again(); onMoved(x && x.note, x && x.moved ? null : 'warn'); },
                function (e) { setBusy(null); onMoved(e.message, 'bad'); }
            );
        }

        if (q.error && !q.state) return <Panel><Note kind="bad">{q.error}</Note></Panel>;
        if (!q.state) return <Panel><Skeleton rows={4} /></Panel>;

        var s = q.state;
        var branches = s.branches || [];

        return (
            <Panel>
                <CardTitle>
                    <span>Branches</span>
                    {/* THE BADGE IS ABOUT WHAT IS WRONG. A branch that exists
                        only here is not wrong — it is unpushed work — so it gets
                        a plain count beside the warning rather than being folded
                        into it, where it would read as a fault. */}
                    <Badge kind={s.outOfStep ? 'warn' : 'ok'}>
                        {s.outOfStep ? s.outOfStep + ' out of step' : 'in step with origin'}
                    </Badge>
                    {s.onlyHere ? <Badge kind="muted">{s.onlyHere + ' only here'}</Badge> : null}
                    <Grow />
                    <Plus disabled={busy == '*'} onClick={function () { sync(null); }}
                        title="Fetch from origin and fast-forward every branch here that has one. Only fast-forwards.">
                        {busy == '*' ? '…' : '⟳'}
                    </Plus>
                </CardTitle>
                <Note>{s.note}</Note>
                {branches.length ? branches.map(function (b) {
                    var st = STATE[b.state];
                    return (
                        <div key={b.branch}>
                            <Part right={
                                <React.Fragment>
                                    {/* HERE, THEN THERE, in that order, because
                                        the question is "is mine current" and the
                                        answer is read left to right. A dash for
                                        the side that has nothing, rather than a
                                        blank that reads as a rendering fault. */}
                                    <Mono>{b.local || '—'}</Mono>
                                    <span className="muted">{'→'}</span>
                                    <span className="mono muted">{b.remote || '—'}</span>
                                    {b.ahead != null || b.behind != null
                                        ? <span className="muted">{(b.ahead ? '+' + b.ahead : '') + (b.behind ? ' −' + b.behind : '')}</span>
                                        : null}
                                    {st ? <Badge kind={st.kind}>{st.word}</Badge> : null}
                                    {/* THE REASON A ROW CANNOT BE CAUGHT UP IS
                                        THE USEFUL PART, and it differs per row —
                                        which is why the button stays and says
                                        why rather than going quiet. */}
                                    <Button kind="small" disabled={!canCatchUp(b) || busy == b.branch}
                                        title={whyNotCatchUp(b)}
                                        onClick={function () { sync(b.branch); }}>
                                        {busy == b.branch ? '…' : '⟳'}
                                    </Button>
                                </React.Fragment>
                            }>
                                <Mono>{b.branch}</Mono>
                            </Part>
                            {saysAbout(b)}
                        </div>
                    );
                }) : <Empty>This repository has no branches.</Empty>}
            </Panel>
        );
    }

    //---- where work goes ---------------------------------------------------

    //---- WHERE WORK GOES, WHICH THE REST OF THE APP TRUSTS ----------------
    //
    //ONE SETTING, AND IT IS NOT ONLY THIS PANE'S. The target decides where
    //issues are read from, where pull requests are opened, and what `prCutMake`
    //pushes into — so choosing it has to be plain, and what is chosen has to be
    //legible at a glance afterwards. It was neither: press "Select fork", wait
    //for a walk, then find the right button among three rows.
    //
    //A CHOOSER, NOT A HUNT. The chain is walked on its own — one conditional
    //request per link, and etags make a repeat free — so by the time anybody
    //looks, the places work could go are simply listed. Choosing one is picking
    //it from a list, which is what it always was underneath.
    //
    //STILL A CONFIRM. It decides what happens to somebody else's repository,
    //and that is the one kind of press this app does not do silently.
    function WhereWorkGoes({ r, chain, onChanged }) {
        var now = r.target || { on: null, chosen: false };
        var links = (chain && chain.links) || [];

        //WHAT EACH PLACE IS, in one phrase, so the list reads without the badges
        //a table would have carried.
        function whatIs(l) {
            if (l.self) return 'yours — work stays here';
            if (!l.fork) return 'the project';
            return 'a fork above yours';
        }

        function choose(on) {
            var l = links.filter(function (x) { return x.on === on; })[0];
            if (!l || l.on === now.on) return;

            ask({
                title: 'Send ' + r.repo + "'s work to " + l.on + '?',
                plain: [
                    l.self
                        ? 'Issues stay read from your own remote and pull requests keep opening into it. '
                            + 'Nothing upstream is watched.'
                        : 'Issues would be read from ' + l.on + ', and pull requests from this repository '
                            + 'would open into it.',
                    l.self
                        ? 'Recorded as a decision, so this stops asking to be pointed somewhere.'
                        : 'Nothing above it is watched after this — if the project itself were the '
                            + 'destination, you would have forked the project.',
                    l.self || l.immediate
                        ? 'Syncing the fork stays one call to GitHub.'
                        : 'It is NOT the immediate parent, so syncing the fork cannot use the one-call '
                            + 'merge-upstream that GitHub offers.'
                ],
                fields: [{ name: 'why', label: 'Why (optional)', placeholder: 'the fork I am collaborating through' }],
                confirm: 'Send work to ' + l.on,
                onYes: function (v) {
                    return okc.call('repoTargetSet', { repo: r.repo, on: l.on, why: v.why || null })
                        .then(function (x) { onChanged(x && x.note); });
                }
            });
        }

        return (
            <Card>
                <CardTitle>
                    <span>Where work goes</span>
                    <Grow />
                    <Badge kind={now.chosen ? 'ok' : 'warn'}>{now.chosen ? 'picked' : 'not picked'}</Badge>
                </CardTitle>

                {/* WHAT IS SET, IN A SENTENCE. A bare name cannot carry whether
                    anybody chose it, and that is the distinction this card
                    exists to make: the same remote means two different things
                    depending on whether somebody decided it. */}
                <Note>
                    {now.chosen
                        ? <span>{'Issues are read from ' + now.on + ' and pull requests open into it.'
                            + (now.at ? ' You picked that on ' + String(now.at).slice(0, 10) + '.' : '')}</span>
                        : <span>
                            <strong>{'Nothing has been picked, so this keeps to itself. '}</strong>
                            {'Issues and pull requests both stay on ' + (now.on || 'this repository')
                                + '. That is right if this IS the project — say so below and it stops asking.'}
                        </span>}
                </Note>

                {chain && chain.stopped ? <Note kind="bad">{chain.stopped}</Note> : null}

                {links.length ? (
                    <KvRow label="send work to">
                        <select value={now.on || ''} aria-label="send work to"
                            onChange={function (e) { choose(e.target.value); }}>
                            {links.map(function (l) {
                                return (
                                    <option key={l.on} value={l.on} disabled={!l.self && !l.mayOpen}>
                                        {l.on + ' — ' + whatIs(l)
                                            + (!l.self && !l.mayOpen ? ' (this token cannot open one there)' : '')}
                                    </option>
                                );
                            })}
                        </select>
                    </KvRow>
                ) : <Note>Reading the fork chain…</Note>}
            </Card>
        );
    }

    //---- the detail --------------------------------------------------------

    function Detail({ r, chain, onChanged }) {
        if (!r) return <Panel><Empty>Pick a repository on the left.</Empty></Panel>;
        var rem = r.remote;
        var asked = !!r.checked;

        function standing() {
            if (!asked) return <Badge>not asked about yet</Badge>;
            if (r.reachable === false) return <Badge kind="bad">cannot be reached</Badge>;
            if (r.why) return <Badge kind="warn">reachable, not usable</Badge>;
            return <Badge kind="ok">reachable</Badge>;
        }

        return (
            <Panel>
                <CardTitle>
                    <Mono>{r.repo}</Mono>
                    {r.privateRepo ? <Badge kind="muted">private</Badge> : null}
                    {r.fork ? <Badge kind="muted">
                        {r.chained ? 'fork of ' + r.parent + ' of ' + r.source : (r.parent ? 'fork of ' + r.parent : 'fork')}
                    </Badge> : null}
                    {standing()}
                </CardTitle>

                <Kv>
                    {/* THE PATH AND THE URL ARE THERE TO BE COPIED. The old window had to
                        say so with user-select:text on each; here the stylesheet
                        makes body selectable and only chrome opts out, so a second
                        override would be a class that changes nothing. */}
                    <KvRow label="here"><Mono>{r.path}</Mono></KvRow>
                    <KvRow label="default branch">
                        <Mono>{r.default || '(none)'}</Mono>
                        <span className="muted">{r.head ? '  at ' + String(r.head).slice(0, 8) : ''}</span>
                    </KvRow>
                    {/* THE HOST AND THE NAME, NOT THE URL, and that is a rule
                        rather than a shortening. A remote can carry a
                        credential — `https://someone:ghp_…@github.com/o/r` is a
                        perfectly ordinary origin — and this window is
                        photographed several times a day, by this app, on
                        purpose. ../../git's `origin()` does not return the URL
                        at all for that reason, so there is nothing here to
                        leak; this row said nothing until it stopped asking for
                        one.

                        Nothing is lost: the host answers "is this GitHub", the
                        owner and name answer "which repository", and the URL
                        only ever added a way for a token to end up in a
                        screenshot. */}
                    <KvRow label="origin">
                        {rem && rem.owner
                            ? <span>
                                <Mono>{rem.owner + '/' + rem.repo}</Mono>
                                <span className="muted">{'  on ' + (rem.host || 'somewhere')}</span>
                            </span>
                            : rem
                                ? <span className="bad">{'origin is ' + (rem.host || 'somewhere') + ', and this cannot tell which repository — nothing here can be pushed onward'}</span>
                                : <span className="bad">no remote called origin — nothing here can be pushed onward</span>}
                    </KvRow>
                    {asked && r.may ? (
                        <KvRow label="this token may">
                            <span className={r.may.code ? 'ok' : 'bad'}>{r.may.code ? 'read code' : 'NOT read code'}</span>
                            <span>{' · '}</span>
                            <span className={r.may.pulls ? 'ok' : 'bad'}>{r.may.pulls ? 'use pull requests' : 'NOT use pull requests'}</span>
                        </KvRow>
                    ) : null}
                    {asked && r.accountMay ? (
                        //WHAT THE ACCOUNT MAY DO IS NOT WHAT THE TOKEN MAY DO,
                        //and reading the first as the second is how somebody
                        //concludes a refusal is a bug in this app.
                        <KvRow label="your account may">
                            <span className="muted">
                                {Object.keys(r.accountMay).filter(function (k) { return r.accountMay[k]; }).join(', ')
                                    + ' — which is not the same as what the token may do'}
                            </span>
                        </KvRow>
                    ) : null}
                    {asked && r.upstreamDefault ? (
                        <KvRow label="there">
                            <Mono>{r.upstreamDefault}</Mono>
                            {r.upstreamHead
                                ? <span className={r.inStep ? 'ok' : ''}>
                                    {r.inStep ? '  same commit as here' : '  at ' + String(r.upstreamHead).slice(0, 8) + ' — different from here'}
                                </span>
                                : <span className="muted">{'  its head could not be read'}</span>}
                        </KvRow>
                    ) : null}
                    {/* NO FALLING BACK TO THE PARENT. This read
                            `intoTarget || intoParent`, so a repository whose
                            record predates the target probe — or one where the
                            probe could not be made — showed the PARENT's answer
                            under a row labelled "target fork". A verdict about
                            the wrong repository, presented as being about the
                            right one, which is the shape of every fault this
                            panel has produced today.

                            NOT KNOWING IS ITS OWN ANSWER and is said plainly.
                            The target is named either way, because that part is
                            never in doubt — it is a decision this app holds, not
                            something GitHub was asked. */}
                    {asked ? (
                        //THE TARGET, WHICH IS WHERE A CHANGE WILL ACTUALLY LAND.
                        //
                        //This row said "one level up" and named the immediate
                        //parent, with whether the token could open a pull
                        //request THERE. That is the right question only while
                        //the target is inferred from the parent — and this app
                        //lets somebody pick any link in the chain, or their own
                        //remote. So a target three links up, or one that is your
                        //own fork, was never checked: the row reported the
                        //parent as usable and the change went somewhere else.
                        //
                        //It was already renamed once, from "a pull request goes
                        //to", for saying something true of an inferred target
                        //and false of a chosen one. This is the same fault a
                        //second time, and the fix this time is to ASK ABOUT THE
                        //TARGET rather than to rename the row again.
                        <KvRow label={r.target && r.target.upstream ? 'target fork' : 'work goes to'}>
                            <Mono>{(r.target && r.target.on) || '(nowhere — no remote)'}</Mono>
                            <span>{'  '}</span>
                            {/* YOUR OWN REMOTE IS NOT A TARGET FORK, and asking
                                whether this token can open a pull request on it
                                is a question with one answer. Said that way it
                                read as a checked destination — "target fork:
                                your own repository, and yes it can be opened
                                there" — which is three sentences of nothing
                                where one fact belongs: work stays here.

                                The label goes with it. "target fork" promises a
                                fork work is sent TO. */}
                            {r.target && !r.target.upstream
                                ? <span className="muted">work stays here — nothing is sent upstream</span>
                                : !r.intoTarget
                                    ? <span className="muted">not asked yet</span>
                                    : <span className={r.intoTarget.mayOpen ? 'ok' : 'bad'}>
                                        {r.intoTarget.mayOpen
                                            ? 'this token can open a pull request there'
                                            : 'this token can NOT open a pull request there'}
                                    </span>}
                            {r.target && r.target.upstream && r.intoTarget && r.intoTarget.why
                                ? <div className="muted">{r.intoTarget.why}</div>
                                : null}
                            {/* AND THE GUIDANCE ONLY WHILE IT IS A QUESTION.
                                "if work belongs somewhere between them, select
                                the fork below and say so" under a row saying the
                                target is settled is the panel arguing with
                                itself. */}
                            {r.chained && !(r.target && r.target.chosen) ? (
                                <Note>
                                    <strong>This is a fork of a fork. </strong>
                                    <span>{'One level up is ' + r.parent + '; the root of the network is '
                                        + r.source + '. GitHub reports those two and never the middle of a '
                                        + 'longer chain, so if work belongs somewhere between them, select the '
                                        + 'fork below and say so.'}</span>
                                </Note>
                            ) : null}
                        </KvRow>
                    ) : null}
                    {/* NO "work goes to" ROW. It named the target and carried a
                        badge saying whether anybody had picked it — and the card
                        immediately below says the same thing in a sentence, with
                        the badge, the date it was picked, and the buttons that
                        change it. After picking, the two sat inches apart saying
                        one fact twice.

                        THAT IS THE FAULT THE ROW ABOVE THIS ONE WAS ALREADY
                        RENAMED FOR: "two places knowing one fact and
                        disagreeing". The app being ported from has both and this
                        is a deliberate difference from it — the row is the one
                        with nothing of its own, so the row goes.

                        WHAT IS ABOVE IT STAYS, because "one level up" is a fact
                        about GitHub rather than a decision about where work
                        goes, and nothing else carries it. */}
                    <KvRow label="asked GitHub">
                        <span className="muted">{asked ? ago(r.checked) : 'never'}</span>
                    </KvRow>
                </Kv>

                {r.why ? (
                    <Note>
                        <strong className={r.reachable === false ? 'bad' : ''}>
                            {r.reachable === false ? 'Cannot be reached. ' : 'Reachable, but not usable yet. '}
                        </strong>
                        <span>{r.why}</span>
                    </Note>
                ) : null}

                <WhereWorkGoes r={r} chain={chain} onChanged={onChanged} />

                {/* NO "Ask GitHub about this one". Everything here verifies
                    itself when the pane is opened, through the etag drawer, and
                    a button asking for what already happened is a button that
                    teaches people the panel cannot be trusted without it. */}
                <div className="row" style={{ marginTop: '8px' }}>
                    {rem && rem.kind == 'github'
                        ? <Button onClick={function () { openOut('https://' + rem.host + '/' + rem.owner + '/' + rem.repo); }}>
                            Open it on GitHub
                        </Button>
                        : null}
                </div>
            </Panel>
        );
    }

    //---- the Repos pane's own half -----------------------------------------
    //
    //The repository list, the heading and "Ask GitHub" are the chassis all three
    //of these panes share — see ./chassis.js. This file is what Repos puts
    //beside it, which is why it is named for the pane and not for the side of
    //the screen it happens to occupy.
    return function Repos({ r, say, again, askGitHub }) {
        var [chain, setChain] = useState(null);

        //THE WALK BELONGS TO THE REPOSITORY IT WAS WALKED FOR, and it says which
        //one on itself — `repoChain` answers with `repo`. Shown only when that
        //matches what is selected.
        //
        //THIS WAS A GUARD IN THE RENDER BODY: if the selection had changed since
        //the last draw, clear the chain. It cleared what was already there and
        //could not touch what had not arrived yet — and the walk is a request
        //per link. Press "Select fork" on one repository, switch to another
        //before the answer lands, and `setChain` filed one repository's fork
        //chain under the other's name. A fork chain is exactly the kind of thing
        //nobody would double-check before acting on.
        //
        //TAGGED RATHER THAN TIMED. A late answer is still filed — it cost the
        //requests, and going back to that repository shows it without walking
        //again — it is simply not SHOWN under a name it is not about. That also
        //takes a setState out of the render body, which React tolerates and
        //nothing should rely on.
        var mine = chain && chain.repo === r.repo ? chain : null;

        //WHAT IS SELECTED RIGHT NOW, not what was selected when the walk was
        //asked for. A ref rather than the closure's `r`, which is whatever it
        //was at the moment of the press.
        var showing = useRef(r.repo);
        showing.current = r.repo;

        //WALKED WITHOUT BEING ASKED, so the places work could go are simply
        //listed by the time anybody looks. It is one conditional request per
        //link and etags make a repeat free — the same reason "Ask GitHub" went.
        //
        //ONCE PER REPOSITORY, AND AGAIN WHEN THE TARGET MOVES.
        //
        //KEYED ON BOTH, because the chain carries which link is the target — so
        //after choosing one it is stale in exactly the flag the list is read
        //for. Keyed on the repository alone, `changed` cleared the chain, the
        //latch said "already walked", and the chooser DISAPPEARED: the card sat
        //on "Reading the fork chain…" for the rest of the visit, right after a
        //press that had worked.
        var asked = useRef({});
        useEffect(function () {
            if (!r || !r.repo) return;
            var key = r.repo + ' -> ' + ((r.target && r.target.on) || '');
            if (asked.current[key]) return;
            asked.current[key] = true;
            walk();
        }, [r && r.repo, r && r.target && r.target.on]);

        function walk() {
            var want = r.repo;
            okc.call('repoChain', { repo: want }).then(
                function (c) {
                    //FILED WHATEVER HAPPENS — it cost the requests, and coming
                    //back to that repository shows it without walking again. It
                    //is `mine` above that decides whether it is SHOWN.
                    setChain(c);
                    //BUT SAID ONLY IF IT IS STILL ABOUT WHAT IS ON SCREEN. The
                    //chain stopped appearing under the wrong repository and the
                    //SENTENCE still did: "3 repositories in the chain above
                    //local-repo-a" sitting on local-repo-c's panel, which is the
                    //same fault one layer up and reads exactly as convincingly.
                    //NOBODY PRESSED IT, so it says nothing when it works.
                    //The list appearing IS the answer.
                },
                function (e) { if (want === showing.current) say(e.message, 'bad'); }
            );
        }

        function changed(note, warn) {
            setChain(null);
            say(note, warn ? 'warn' : null);
            again();
        }

        return (
            <React.Fragment>
                <Detail r={r} chain={mine} onChanged={changed} />
                <Branches repo={r.repo} onMoved={function (note, kind) { say(note, kind); again(); }} />
            </React.Fragment>
        );
    };
};

