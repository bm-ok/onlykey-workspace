var React = require('react');
var { useState, useRef } = React;

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

    function WhereWorkGoes({ r, chain, onWalk, onChanged }) {
        var now = r.target || { on: null, chosen: false };

        //FORGETTING A DECISION THAT MOVED NOTHING. Same call as `keepToItself`
        //— the target is cleared either way — and a different act to describe,
        //because the target is already home: what goes is the DECISION, and
        //what comes back is the question.
        function undecide() {
            ask({
                title: 'Stop saying where ' + r.repo + "'s work goes?",
                plain: [
                    'Work stays on ' + (now.on || 'your own remote') + ' either way. Nothing moves, nothing '
                        + 'already open is touched.',
                    'What changes is that it goes back to being undecided — so it asks again, and says so on '
                        + 'the list of what is waiting on you.'
                ],
                confirm: 'Back to undecided',
                onYes: function () {
                    return okc.call('repoTargetSet', { repo: r.repo, on: '' }).then(function (x) { onChanged(x && x.note, true); });
                }
            });
        }

        function keepToItself() {
            ask({
                title: 'Stop sending ' + r.repo + "'s work anywhere?",
                danger: true,
                plain: [
                    'It sends work to ' + now.on + ' now. Afterwards, issues and pull requests both stay on your own remote and nothing upstream is watched.',
                    'Nothing already open is closed or moved by this. It changes where the next one goes.'
                ],
                confirm: 'Keep to itself',
                onYes: function () {
                    return okc.call('repoTargetSet', { repo: r.repo, on: '' }).then(function (x) { onChanged(x && x.note, true); });
                }
            });
        }

        //---- AND SAYING "IT IS RIGHT AS IT IS" ----------------------------
        //
        //NOTHING PICKED AND KEEPING TO ITSELF ARE THE SAME PLACE AND NOT THE
        //SAME ANSWER. Unpicked means nobody has decided; `chosen` on your own
        //remote means somebody looked at the chain and said the work belongs
        //here. The stored shape already tells them apart — `chosen: true` with
        //`upstream: false` — and nothing could ever produce it.
        //
        //SO THE ERRAND COULD NOT BE ANSWERED. "It is a fork and nothing has been
        //picked" goes on the inbox until a target is chosen, and the one honest
        //answer for a fork that IS where its work belongs — this one, thanks —
        //had no button. An errand that cannot be settled is one that teaches
        //people to ignore the list, which is the whole failure a list of what is
        //waiting exists to avoid.
        //
        //THE APP BEING PORTED FROM HAS THE SAME HOLE: it raises the same errand
        //and hides the button on the row that is already the target, which the
        //self row is whenever nothing is picked. Its confirm text even describes
        //this act — "the same as picking nothing, except that it is recorded as
        //a decision" — for a press that could not be reached.
        //
        //NOTHING UPSTREAM IS WATCHED EITHER WAY. This records a decision; it
        //does not point anywhere new.
        function keepItHere(l) {
            ask({
                title: 'Keep ' + r.repo + "'s work on " + l.on + '?',
                plain: [
                    'It is already where work goes, because nothing has been picked. This records that as a '
                        + 'decision rather than a default.',
                    'Issues stay read from ' + l.on + ' and pull requests keep opening into it. Nothing '
                        + 'upstream is watched, which is the same as now.',
                    'It stops this repository asking to be pointed somewhere — and "Keep to itself" puts it '
                        + 'back to undecided if that turns out to be wrong.'
                ],
                fields: [{ name: 'why', label: 'Why (optional)', placeholder: 'this fork is where the work lives' }],
                confirm: 'Keep it here',
                onYes: function (v) {
                    return okc.call('repoTargetSet', { repo: r.repo, on: l.on, why: v.why || null })
                        .then(function (x) { onChanged(x && x.note); });
                }
            });
        }

        function sendWorkHere(l) {
            ask({
                title: 'Send ' + r.repo + "'s work to " + l.on + '?',
                plain: [
                    'Issues would be read from ' + l.on + ', and pull requests from this repository would open into it.',
                    'Nothing above it is watched after this — which is the point: if the project itself were the destination, you would have forked the project.',
                    l.immediate
                        ? 'It is the immediate parent, so syncing the fork stays one call to GitHub.'
                        : 'It is NOT the immediate parent, so syncing the fork cannot use GitHub’s one-call merge-upstream — that would need fetching and merging through this host, and is refused rather than substituted.',
                    l.self ? 'This is your own remote, which is the same as picking nothing — except that it is recorded as a decision.' : null
                ].filter(Boolean),
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
                {/* SAID IN A SENTENCE. A bare name cannot carry whether anybody
                    chose it, and that is the whole distinction this card makes. */}
                <Note>
                    {now.chosen
                        ? 'Issues are read from ' + now.on + ' and pull requests open into it. You picked that'
                            + (now.at ? ' on ' + String(now.at).slice(0, 10) : '') + ', and nothing above it is watched.'
                        : <span>
                            <strong>{'Nothing has been picked, so this keeps to itself. '}</strong>
                            {'Issues and pull requests both stay on ' + (now.on || 'this repository')
                                + ' — your own remote — and nothing upstream is watched. That is right if this IS the project. '
                                + 'If it is a fork and work belongs with whoever you forked from, walk the chain and say so.'}
                        </span>}
                </Note>
                <div className="row">
                    {/* THE WALK IS ON A BUTTON, NEVER ON THE DRAW LOOP. One
                        request per link, and the answer only changes when
                        somebody forks something — so a panel that walked it on
                        every paint would spend a handful of requests every few
                        seconds on a fact that is stable for months. */}
                    {/* NAMED FOR WHAT IT IS FOR, not for what it does. "Walk the
                        fork chain" describes the mechanism — one request per
                        link, following each parent — and the person pressing it
                        is choosing where work goes. The mechanism is still on the
                        hover, where the cost belongs. */}
                    <Button onClick={onWalk}
                        title="One request per link, following each parent until a repository that is not a fork">
                        {chain ? 'Select fork again' : 'Select fork'}
                    </Button>

                    {/* AND THE WAY BACK SAYS WHICH WAY BACK IT IS.
                        There are two chosen states, and "Keep to itself" is only
                        the right sentence for one of them:

                          pointed upstream   it MOVES the target home — the label
                                             names the destination and is right
                          chosen, but home   it moves nothing. Work already stays
                                             here; the only thing it changes is
                                             that the decision is forgotten

                        Offering "Keep to itself" in the second state describes
                        the state somebody is already in, and quietly puts the
                        repository back on the inbox for being undecided. That
                        arrived with "Keep it here": before it, a chosen target
                        was always somewhere else. */}
                    {now.chosen
                        ? (now.upstream
                            ? <Button onClick={keepToItself}
                                title="Bring work back to your own remote, and stop watching anything above it">
                                Keep to itself
                            </Button>
                            : <Button onClick={undecide}
                                title="Forget the decision. Work still stays here — what changes is that this asks again">
                                Back to undecided
                            </Button>)
                        : null}
                </div>

                {/* THE CHAIN, ONCE IT HAS BEEN WALKED. Each link is a place work
                    could go, with the two facts that decide whether it can: may
                    this host open a pull request there, and does syncing stay
                    cheap.

                    `mayOpen`, NOT `mayPush`. This read `l.mayPush` — the field
                    the app being ported from has — and this one does not have
                    it. Undefined is falsy, so every link rendered as "this token
                    cannot push here" and EVERY "Send work here" button was
                    hidden, on a card whose whole purpose is picking one. The
                    pane looked complete and offered nothing.

                    The rename was deliberate over here and is the better half of
                    the two: `mayPush` there is `permissions.push`, which is the
                    ACCOUNT's claim and not what the token may do — the mistake
                    this app's own notes warn about. `mayOpen` is a real probe of
                    `GET /pulls`, and `accountMayPush` is kept beside it,
                    labelled, so the two can be seen to differ rather than one
                    standing in for the other.

                    AND THE SENTENCE SAYS WHAT WAS ASKED. "cannot push here" is
                    not what was probed and not what picking a target needs —
                    pushing happens to your own fork; the target is where a pull
                    request is OPENED. */}
                {chain ? (
                    <div style={{ marginTop: '10px' }}>
                        {chain.stopped ? <Note kind="bad">{chain.stopped}</Note> : null}
                        {(chain.links || []).map(function (l) {
                            return (
                                <Part key={l.on} right={
                                    <React.Fragment>
                                        <span className={l.mayOpen ? 'muted' : 'bad'}>
                                            {l.mayOpen
                                                ? (l.openIssues == null ? '' : l.openIssues + ' open issue(s)')
                                                : 'this token cannot open a pull request here'}
                                        </span>
                                        {l.target && !now.chosen && l.self
                                            ? <Button onClick={function () { keepItHere(l); }}
                                                title="Record that this is where the work belongs, so it stops asking">
                                                Keep it here
                                            </Button>
                                            : l.target || !l.mayOpen
                                                ? null
                                                : <Button kind="ok" onClick={function () { sendWorkHere(l); }}>Send work here</Button>}
                                    </React.Fragment>
                                }>
                                    <Mono>{l.on}</Mono>
                                    {l.self ? <Badge kind="muted">yours</Badge> : null}
                                    {l.target ? <Badge kind="ok">work goes here</Badge> : null}
                                    {!l.fork ? <Badge kind="muted">the project</Badge> : null}
                                </Part>
                            );
                        })}
                    </div>
                ) : null}
            </Card>
        );
    }

    //---- the detail --------------------------------------------------------

    function Detail({ r, chain, onWalk, onChanged }) {
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
                    {asked && r.intoParent ? (
                        //WHAT IS ABOVE THIS ONE, WHICH IS NOT WHERE WORK GOES.
                        //
                        //This row said "a pull request goes to" and named the
                        //parent, which was true while the target was INFERRED
                        //from the parent and became false the moment it became a
                        //choice — leaving it two rows above "work goes to"
                        //saying something different about the same thing. Two
                        //places knowing one fact and disagreeing.
                        //
                        //Kept and renamed, because what it carries is still
                        //worth having: whether this token could push to the
                        //parent AT ALL. That is a fact about GitHub rather than
                        //a decision about where work goes.
                        <KvRow label="one level up">
                            <Mono>{r.intoParent.repo}</Mono>
                            <span>{'  '}</span>
                            <span className={r.intoParent.mayOpen ? 'ok' : 'bad'}>
                                {r.intoParent.mayOpen
                                    ? 'this token could open a pull request there'
                                    : 'this token could NOT open a pull request there'}
                            </span>
                            {r.intoParent.why ? <div className="muted">{r.intoParent.why}</div> : null}
                            {r.chained ? (
                                <Note>
                                    <strong>{'This is a fork of a fork. '}</strong>
                                    {'One level up is ' + r.parent + '; the root of the network is ' + r.source
                                        + '. GitHub reports those two and never the middle of a longer chain, so if work belongs somewhere between them, walk the chain below and say so.'}
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

                <WhereWorkGoes r={r} chain={chain} onWalk={onWalk} onChanged={onChanged} />

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

        //THE WALK BELONGS TO THE REPOSITORY IT WAS WALKED FOR. Carried across a
        //selection it would show one repository's fork chain under another's
        //name — and a fork chain is exactly the kind of thing nobody would
        //double-check before acting on.
        var walkedFor = useRef(null);
        if (walkedFor.current !== r.repo) { walkedFor.current = r.repo; if (chain) setChain(null); }

        function walk() {
            okc.call('repoChain', { repo: r.repo }).then(
                function (c) { setChain(c); say(c.note); },
                function (e) { say(e.message, 'bad'); }
            );
        }

        function changed(note, warn) {
            setChain(null);
            say(note, warn ? 'warn' : null);
            again();
        }

        return (
            <React.Fragment>
                <Detail r={r} chain={chain} onWalk={walk} onChanged={changed} />
                <Branches repo={r.repo} onMoved={function (note, kind) { say(note, kind); again(); }} />
            </React.Fragment>
        );
    };
};
