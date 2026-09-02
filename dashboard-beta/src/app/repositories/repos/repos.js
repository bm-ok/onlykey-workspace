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

    //AND THE OTHER THING A ROW CAN NEED, which is not a fast-forward at all: a
    //branch that exists on origin and has never been fetched here. It cannot be
    //cut from, cannot be laid on a machine, and could only be looked at.
    function canTake(b) { return b.state == 'only on origin'; }

    //AND THE SAME DEAD END POINTING THE OTHER WAY: work that exists on this
    //host and nowhere else. `only here` has never been pushed; `ahead` was
    //pushed once and has moved since. Both are one act -- send it -- and it is
    //the one a DIY machine leaves you needing, because that lane pushes to THIS
    //host rather than to GitHub.
    //
    //THE THREE ARE MUTUALLY EXCLUSIVE, which is what lets one button carry all
    //of them: a branch cannot be behind origin and absent from it at once.
    function canPush(b) { return b.state == 'only here' || b.state == 'ahead'; }

    //---- AND BEING DONE WITH ONE ------------------------------------------
    //
    //A SEPARATE BUTTON, NOT A FOURTH ACT ON THE OTHER ONE. The three above are
    //mutually exclusive ways of moving a branch about, and none of them loses
    //anything. This one is the opposite weight, and a destructive act reached
    //by the same press as a fetch is one somebody arrives at by rhythm.
    //
    //`against` IS NULL FOR EXACTLY THE ROWS THIS MUST NOT OFFER -- see
    //`repoBranches`, which leaves it null for the repository's DEFAULT BRANCH
    //and for a branch with no local copy. Deleting either is not a thing to
    //ask about: one is what everything else here is measured against, and the
    //other is not on this computer to delete.
    //
    //EVERY OTHER REFUSAL IS THE SERVER'S. A branch a line is built on is
    //protected, and one carrying unmerged commits needs telling twice -- both
    //are decided in `branchDelete` and said in its own words. Repeating either
    //test here would be a second copy of a guard, which is how one comes to
    //disagree with the other.
    function canDelete(b) { return !!(b.local && b.against); }

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
        if (canPush(b)) {
            return b.state == 'ahead'
                ? 'Push ' + b.branch + ' to origin — it has moved since it was last pushed'
                : 'Push ' + b.branch + ' to origin — it is only on this computer';
        }
        if (canTake(b)) return 'Bring ' + b.branch + ' here from origin — nothing you have open moves';
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
                    <span className="muted">{' — the commits look different because the pull request was squashed when it merged. Nothing here is unsaved, and ✕ deletes it from this repository.'}</span>
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
        //git, not GitHub — a sync from the Sync tab or the command line
        //moves it, and a panel whose whole job is saying whether two things
        //match is worse than useless when it is stale.
        var q = okc.use('repoBranches', { repo: repo }, 8000);
        var [busy, setBusy] = useState(null);

        //ASKING, WHICH MOVES NOTHING. See `repoFetch`: it fetches, prunes and
        //reports what changed on origin -- including a branch that is no longer
        //there, which is the one thing no amount of reading this disk can find
        //out.
        function refresh() {
            setBusy('*');
            okc.call('repoFetch', { repo: repo }).then(
                function (x) {
                    setBusy(null); q.again();
                    onMoved(x && x.note, x && x.fetched ? null : 'bad');
                },
                function (e) { setBusy(null); onMoved(e.message, 'bad'); }
            );
        }

        function sync(branch) {
            setBusy(branch || '*');
            okc.call('repoSyncBranch', branch ? { repo: repo, branch: branch } : { repo: repo }).then(
                function (x) { setBusy(null); q.again(); onMoved(x && x.note, x && x.moved ? null : 'warn'); },
                function (e) { setBusy(null); onMoved(e.message, 'bad'); }
            );
        }

        //---- AND A BRANCH THIS HOST HAS NOT GOT AT ALL --------------------
        //
        //A DIFFERENT ACT, SO A DIFFERENT CALL. Fast-forwarding moves a branch
        //that is here; this makes one that is not. `repoSyncBranch` skips a
        //branch with no local copy on purpose -- see `catchUp` -- so the row
        //for a branch pushed from somewhere else had a disabled button saying
        //"there is nothing here to fast-forward", which is true and reads as
        //"there is nothing here", which is not.
        function take(branch) {
            setBusy(branch);
            okc.call('repoTakeBranch', { repo: repo, branch: branch }).then(
                function (x) { setBusy(null); q.again(); onMoved(x && x.note, x && x.made ? null : 'warn'); },
                function (e) { setBusy(null); onMoved(e.message, 'bad'); }
            );
        }

        //---- AND SENDING ONE UP, WHICH LEAVES THIS COMPUTER ------------------
        //
        //BEHIND THE GATE, because it publishes. A branch on origin is visible
        //to anybody who can see that repository, and no other act on this row
        //leaves the machine at all -- fast-forwarding and fetching both only
        //move what is here.
        //
        //NOT A PULL REQUEST, and the dialog says so twice. "Push it somewhere
        //safe" and "ask somebody to merge this" are different sizes of act, and
        //the second needs a judgement first.
        function push(b) {
            var was = b.state == 'ahead';
            ask({
                title: 'Push "' + b.branch + '" to origin?',
                plain: [
                    was
                        ? 'It is on origin already and has moved since — this brings origin up to what is here.'
                        : 'It exists on this computer and nowhere else. This puts a copy on your remote.',
                    'It goes to origin, which for a fork is your own remote. Nothing is opened and nobody is '
                        + 'asked to look at it: this is a branch being kept somewhere other than one disk.'
                ],
                cost: 'It becomes visible to anyone who can see ' + repo + ' on GitHub.',
                confirm: 'Push it',
                onYes: function () {
                    setBusy(b.branch);
                    return okc.call('repoPushBranch', { repo: repo, branch: b.branch }).then(
                        function (x) { setBusy(null); q.again(); onMoved(x && x.note, x && x.pushed ? null : 'warn'); },
                        function (e) { setBusy(null); onMoved(e.message, 'bad'); throw e; }
                    );
                }
            });
        }

        //---- AND DELETING ONE, FROM THIS REPOSITORY -------------------------
        //
        //THE PANE SAID IT COULD BE DONE AND POINTED AT NOWHERE. A branch whose
        //work has landed drew "It can be deleted on the Branches tab" -- and
        //there is no Branches tab: the row is Branches Cut and Branches Lines,
        //and the delete on the first takes a branch out of EVERY repository at
        //once. So a branch finished with in one repository and wanted in eight
        //others had no way to go, and the sentence naming the act made that
        //read as a bug rather than as a missing feature.
        //
        //FROM THIS REPOSITORY ONLY, which is what this pane is about
        //throughout: `repoSyncBranch`, `repoTakeBranch` and `repoPushBranch`
        //are all one repository. `branchDelete` takes `repo` for it, so the
        //protection check and the force path stay in one place.
        function remove(b) {
            var a = b.against || {};
            ask({
                title: 'Delete "' + b.branch + '" from ' + repo + '?',
                plain: [
                    'From this repository only. Any other repository with a branch of this name keeps it.',
                    //WHETHER THE WORK ON IT IS SAFE, WHICH IS THE QUESTION
                    //SOMEBODY ACTUALLY HAS. A squashed merge leaves work that
                    //HAS landed looking unmerged, so the row already works this
                    //out -- saying it again here means the answer is in front of
                    //them at the moment they decide rather than scrolled away.
                    a.state == 'landed'
                        ? 'Everything on it is already in ' + a.base + '. Nothing on it is unsaved.'
                        : a.state == 'live'
                            ? a.unlanded + ' commit(s) on it are not in ' + a.base + ' yet.'
                            : null,
                    //LOCAL IS NOT THE SAME AS GONE, and this is the sentence
                    //that stops somebody thinking it is. Nothing on this row
                    //touches GitHub; the branch on the fork is deleted from a
                    //merged pull request, which is a different act elsewhere.
                    b.remote
                        ? 'origin still has it. This deletes the copy on this computer and nothing on GitHub.'
                        : 'It is only on this computer, so this is the last copy of it.'
                ],
                cost: a.state == 'landed' && b.remote
                    ? 'A branch here goes. Its work is in ' + a.base + ' and origin still has the branch.'
                    : 'Anything on it that was never merged or pushed is gone.',
                confirm: 'Delete it',
                danger: true,
                onYes: function () {
                    //ASKED WITHOUT FORCE, ALWAYS -- the same order as the delete
                    //on Branches Cut. Offering it up front makes it a thing to
                    //tick past; asking once git has said it is needed makes it a
                    //decision about a branch that carries specific work.
                    setBusy(b.branch);
                    return okc.call('branchDelete', { repo: repo, branch: b.branch }).then(
                        function (x) {
                            setBusy(null); q.again();
                            onMoved(x && x.note, x && x.ok ? null : 'warn');
                            if (x && !x.ok && x.unmerged) forceRemove(b, x);
                        },
                        function (e) { setBusy(null); onMoved(e.message, 'bad'); throw e; }
                    );
                }
            });
        }

        //NOT A RETRY, A DIFFERENT QUESTION. The first press asked "delete this
        //branch"; git answered that it carries commits that are nowhere else,
        //so this asks "throw that work away" -- the only question left, and not
        //the one already answered.
        function forceRemove(b) {
            ask({
                title: 'Throw away what "' + b.branch + '" carries?',
                plain: [
                    'It carries commits that are not merged anywhere else, in ' + repo + '.',
                    'If the work is wanted, close this and land it first — merge it into a line, push it to origin, or send it out as a PR cut. Nothing here can get it back afterwards.'
                ],
                fields: [{
                    name: 'force',
                    type: 'checkbox',
                    label: 'Delete it anyway, and lose what it carries',
                    hint: 'This is what git refused to do without being told twice.'
                }],
                cost: 'The commits on it are gone from ' + repo + ' on this host.',
                confirm: 'Delete it anyway',
                danger: true,
                protect: true,
                onYes: function (f) {
                    //THE TICK IS THE CONSENT AND THE BUTTON IS NOT.
                    if (f.force !== true) {
                        throw new Error('Tick the box to say the work on it can go. Nothing was deleted.');
                    }
                    setBusy(b.branch);
                    return okc.call('branchDelete', { repo: repo, branch: b.branch, force: true }).then(
                        function (x) { setBusy(null); q.again(); onMoved(x && x.note, x && x.ok ? null : 'warn'); },
                        function (e) { setBusy(null); onMoved(e.message, 'bad'); throw e; }
                    );
                }
            });
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
                    {/* ⟳ ASKS, IT DOES NOT ANSWER. This ran a fetch AND a
                        fast-forward of every branch that could take one, under
                        a refresh glyph -- so the one control that looked like
                        "show me where things stand" moved refs in the
                        repository being looked at. Catching one up is the ↓ on
                        its own row; the whole workspace at once is the Sync
                        tab. */}
                    <Plus disabled={busy == '*'} onClick={function () { refresh(); }}
                        title="Ask origin what it has, and say what changed. Fetches and prunes; moves no branch here.">
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
                                    {/* ONE BUTTON, TWO ACTS, AND THE ARROW SAYS
                                        WHICH. `⟳` catches a branch up with
                                        origin; `↓` brings one down that is not
                                        here at all -- a row that showed a
                                        branch, its commit, and no way to get
                                        it. */}
                                    <Button kind="small"
                                        disabled={(!canCatchUp(b) && !canTake(b) && !canPush(b)) || busy == b.branch}
                                        title={whyNotCatchUp(b)}
                                        onClick={function () {
                                            if (canPush(b)) return push(b);
                                            if (canTake(b)) return take(b.branch);
                                            return sync(b.branch);
                                        }}>
                                        {/* ↓ FOR BOTH WAYS OF BRINGING IT
                                            HERE. Catching a branch up is the
                                            pull half -- local fast-forwarded to
                                            what origin has -- so it travels in
                                            the same direction as taking one
                                            down, and wearing ⟳ made it read as
                                            a refresh beside a ⟳ that was one.
                                            Which of the two it is, is on the
                                            title; the direction is the glyph. */}
                                        {busy == b.branch ? '…' : canPush(b) ? '↑' : '↓'}
                                    </Button>
                                    {/* THE GLYPH IS NOT ITS NAME, and nothing
                                        here gives it one. The driver matches a
                                        button by its words, and this one's
                                        words are a single character -- so it
                                        is reachable from the command line only
                                        as its glyph, which several buttons
                                        share. `title` says what it does for a
                                        person; an aria-label would say it to
                                        the driver and to a screen reader both,
                                        and is the fix if that day comes. */}
                                    <Button kind="small danger"
                                        disabled={!canDelete(b) || busy == b.branch}
                                        title={canDelete(b)
                                            ? 'Delete ' + b.branch + ' from ' + repo + ' — this repository only'
                                            : b.local
                                                ? 'This is the default branch of ' + repo
                                                : 'It is not on this computer to delete'}
                                        onClick={function () { remove(b); }}>
                                        {'✕'}
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
    function WhereWorkGoes({ r, chain, onChanged, stoppedFor }) {
        var now = r.target || { on: null, chosen: false };
        var links = (chain && chain.links) || [];
        var reads = r.reads || { issues: [], pulls: [] };

        //WHAT EACH PLACE IS, in one phrase, so the list reads without the badges
        //a table would have carried.
        function whatIs(l) {
            //NOT "work stays here" ANY MORE. That described a fallback that no
            //longer exists: picking your own remote is now a decision like any
            //other, and while nothing is picked the work goes nowhere at all.
            if (l.self) return 'yours';
            if (!l.fork) return 'the project';
            return 'a fork above yours';
        }

        //TOGGLING A READ IS NOT A CONFIRM. Nothing leaves this host and
        //nothing is written anywhere else: it changes which places this
        //workspace WATCHES, and getting it wrong is one more press to undo.
        //Sending is the one with the gate, because that is the one that reaches
        //somebody else.
        function toggle(which, on) {
            var was = reads[which] || [];
            var next = was.indexOf(on) >= 0
                ? was.filter(function (x) { return x !== on; })
                : was.concat([on]);
            okc.call('repoReadsSet', {
                repo: r.repo,
                issues: which === 'issues' ? next : reads.issues,
                pulls: which === 'pulls' ? next : reads.pulls
            }).then(function (x) { onChanged(x && x.note); },
                function (e) { onChanged(e.message, true); });
        }

        //SAYING "NOWHERE" IS A DECISION AND IS ASKED FOR LIKE ONE. It is the
        //answer for a repository this app should read and judge but never open a
        //pull request from, and until there was a row for it the only way to
        //express it was to leave the card amber for ever.
        function chooseNowhere() {
            if (now.off) return;
            ask({
                title: 'Send nothing from ' + r.repo + '?',
                plain: [
                    'No pull request is ever opened from this repository. Its issues and pull requests are '
                        + 'still read, and a judge can still be asked to read one.',
                    'Recorded as a decision, so this stops asking to be pointed somewhere.',
                    'Pick one of the places below instead, at any time, and it starts sending again.'
                ],
                fields: [{ name: 'why', label: 'Why (optional)', placeholder: 'I only read this one' }],
                confirm: 'Send nothing from here',
                onYes: function (v) {
                    return okc.call('repoTargetSet', { repo: r.repo, off: true, why: v.why || null })
                        .then(function (x) { onChanged(x && x.note); });
                }
            });
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
                {/* THREE STATES, AND TWO OF THEM USED TO READ THE SAME.
                    "Nothing picked" drew the repository's own row as a ticked
                    radio and then called itself not picked — so the one press
                    that would have settled it was the press that changed
                    nothing. Nothing picked now means nothing is sent, and
                    "nowhere" is something somebody can actually say. */}
                <Note>
                    {now.off
                        ? <span>{'This sends work nowhere. Issues and pull requests are still read; no pull request is opened from it.'
                            + (now.at ? ' Set on ' + String(now.at).slice(0, 10) + '.' : '')}</span>
                        : now.chosen
                            ? <span>{'Pull requests from here open into ' + now.on + '.'
                                + (now.at ? ' You picked that on ' + String(now.at).slice(0, 10) + '.' : '')}</span>
                            : <span>
                                <strong>{'Nothing has been picked, so nothing is sent. '}</strong>
                                {'A cut refuses until somewhere is chosen below — the fork you collaborate through, '
                                    + 'the project itself, or nowhere if this repository should never send work.'}
                            </span>}
                </Note>

                {chain && chain.stopped ? <Note kind="bad">{chain.stopped}</Note> : null}

                {links.length ? (
                    <div style={{ marginTop: '8px' }}>
                        {/* ONE ROW PER PLACE, THREE ANSWERS ACROSS IT.
                            Reading and sending are different questions and were
                            one value: issues are read where people FILE them,
                            pull requests where they ARRIVE, and a change is sent
                            to exactly one place. A fork you collaborate through
                            can be the destination while the issues worth reading
                            are still on the project above it — unsayable before,
                            so the app read from wherever it happened to send to.

                            CHECKBOXES FOR THE TWO READS, because more than one
                            place can be worth watching. A RADIO FOR SENDING,
                            because a change goes somewhere, once. */}
                        <Part right={
                            <React.Fragment>
                                <span className="muted">issues</span>
                                <span className="muted">PRs</span>
                                <span className="muted">send to</span>
                            </React.Fragment>
                        }><span className="muted">read from</span></Part>

                        {/* NOWHERE, AT THE TOP, AND IT IS A REAL ROW.
                            A radio group where the answer "none of these" cannot
                            be expressed has to fake it, and this one faked it by
                            ticking the repository's own row — which is why the
                            badge and the list contradicted each other. With this
                            row present, the selection is always somewhere true:
                            here while nothing is picked, and here again when
                            somebody says so on purpose.

                            IT IS NOT A READ QUESTION, so the two checkbox
                            columns are empty rather than disabled — there is
                            nothing being switched off, there is simply no such
                            question about a destination that does not exist. */}
                        <Part right={
                            <React.Fragment>
                                <span />
                                <span />
                                <label className="inline" title="Do not open pull requests from this repository at all">
                                    <input type="radio" name={'sendto-' + r.repo}
                                        checked={!now.on}
                                        aria-label={'send work nowhere from ' + r.repo}
                                        onChange={function () { chooseNowhere(); }} />
                                </label>
                            </React.Fragment>
                        }>
                            <Mono>nowhere</Mono>
                            {now.off
                                ? <Badge kind="ok">chosen</Badge>
                                : (!now.chosen ? <Badge kind="warn">nothing picked yet</Badge> : null)}
                        </Part>

                        {links.map(function (l) {
                            var canSend = l.self || l.mayOpen;
                            //ISSUES CAN BE SWITCHED OFF PER REPOSITORY on
                            //GitHub, and on these forks several are. A place
                            //with no issues tab can never answer, so offering it
                            //as somewhere to read from is offering a choice that
                            //produces an empty list and no reason for it.
                            var noIssues = (r.noIssuesAt || []).indexOf(l.on) >= 0;
                            return (
                                <Part key={l.on} right={
                                    <React.Fragment>
                                        <label className="inline"
                                            title={noIssues
                                                ? 'Issues are switched off on ' + l.on + ', so there is nothing to read there'
                                                : 'Read issues from ' + l.on}>
                                            {/* NAMED, because a bare checkbox in
                                                a row is nameless to everything
                                                that is not a pair of eyes: the
                                                driver cannot address it and a
                                                screen reader announces nothing.
                                                The words are the question plus
                                                the place, which is what somebody
                                                would say out loud. */}
                                            <input type="checkbox"
                                                checked={!noIssues && reads.issues.indexOf(l.on) >= 0}
                                                disabled={noIssues}
                                                aria-label={'read issues from ' + l.on}
                                                onChange={function () { toggle('issues', l.on); }} />
                                        </label>
                                        <label className="inline" title={'Read pull requests from ' + l.on}>
                                            <input type="checkbox" checked={reads.pulls.indexOf(l.on) >= 0}
                                                aria-label={'read pull requests from ' + l.on}
                                                onChange={function () { toggle('pulls', l.on); }} />
                                        </label>
                                        {/* DISABLED WHERE A PULL REQUEST CANNOT
                                            BE OPENED, and the row still says the
                                            place — it is somewhere issues can
                                            come from even when nothing can be
                                            sent there. */}
                                        <label className="inline"
                                            title={canSend
                                                ? 'Open pull requests on ' + l.on
                                                : 'This token cannot open a pull request on ' + l.on}>
                                            <input type="radio" name={'sendto-' + r.repo}
                                                checked={now.on === l.on} disabled={!canSend}
                                                aria-label={'send pull requests to ' + l.on}
                                                onChange={function () { choose(l.on); }} />
                                        </label>
                                    </React.Fragment>
                                }>
                                    <Mono>{l.on}</Mono>
                                    {l.self ? <Badge kind="muted">yours</Badge> : null}
                                    {!l.fork ? <Badge kind="muted">the project</Badge> : null}
                                    {/* SAID ON THE ROW as well as in the greyed
                                        box, because a disabled control on its
                                        own says "not now" and never says why. */}
                                    {noIssues ? <Badge kind="muted">no issues tab</Badge> : null}
                                </Part>
                            );
                        })}
                    </div>
                ) : <Note kind={stoppedFor ? 'bad' : undefined}>
                    {stoppedFor || 'Reading the fork chain…'}
                </Note>}
            </Card>
        );
    }

    //---- the detail --------------------------------------------------------

    //---- BEHIND WHERE ITS WORK GOES, AND THE TWO HALVES OF CATCHING UP ------
    //
    //THE SYNC BETWEEN THIS HOST AND ITS REMOTE HAD A BUTTON (the Branches card)
    //AND THE ONE BETWEEN THE REMOTE AND THE FORK ITS WORK GOES TO HAD NONE:
    //repoForkSync existed as a verb only. After a merge upstream that is the
    //half that matters first -- the fork is behind by the merge, and pulling
    //here before syncing the fork fast-forwards to a copy that is itself
    //behind. So: the fact from the sweep, then the two halves in order.
    function Behind({ r, onChanged }) {
        var [busy, setBusy] = useState(null);
        var bt = r.behindTarget || null;
        if (!bt) return null;

        function forkSync() {
            setBusy('fork');
            okc.call('repoForkSync', { repo: r.repo }).then(function (x) {
                //THE FACT IS RE-READ, not assumed: the sweep is what says how
                //far behind, and GitHub has just moved.
                return okc.call('repositoriesCheck', { repo: r.repo }).then(function () {
                    setBusy(null); onChanged((x && x.note) || 'Synced.', null);
                });
            }, function (e) { setBusy(null); onChanged(e.message, 'bad'); });
        }
        function pullHere() {
            setBusy('here');
            okc.call('repoSyncBranch', { repo: r.repo, branch: bt.head }).then(
                function (x) { setBusy(null); onChanged((x && x.note) || 'Pulled.', x && x.moved ? null : 'warn'); },
                function (e) { setBusy(null); onChanged(e.message, 'bad'); }
            );
        }

        var behind = bt.behind > 0;
        return (
            <Card>
                <CardTitle>
                    <span>Against where its work goes</span>
                    <Grow />
                    {bt.why
                        ? <Badge kind="warn">could not compare</Badge>
                        : behind
                            ? <Badge kind="warn">{bt.behind + ' behind'}</Badge>
                            : <Badge kind="ok">level</Badge>}
                </CardTitle>
                <Kv>
                    <KvRow label="your fork"><Mono>{bt.self + ' ' + bt.head}</Mono></KvRow>
                    <KvRow label="work goes to"><Mono>{bt.on + ' ' + bt.base}</Mono></KvRow>
                    <KvRow label="standing">
                        {bt.why
                            ? <span className="muted">{bt.why}</span>
                            : <span>{(bt.behind || 0) + ' commit(s) behind' + (bt.ahead ? ', ' + bt.ahead + ' ahead' : '')}</span>}
                    </KvRow>
                    <KvRow label="here">
                        <span className={r.inStep ? 'ok' : ''}>
                            {r.inStep === null ? 'not known' : r.inStep ? 'same commit as your fork' : 'behind your fork — pull it here'}
                        </span>
                    </KvRow>
                </Kv>
                <div className="row" style={{ marginTop: '8px' }}>
                    <Button kind="ok" disabled={!!busy || !behind} onClick={forkSync}
                        title={behind
                            ? 'One call to GitHub: merge ' + bt.on + ' ' + bt.base + ' into the fork’s ' + bt.head + ', the way the Sync fork button does'
                            : 'The fork is level with where its work goes'}>
                        {busy === 'fork' ? 'syncing the fork…' : 'Sync fork from ' + bt.on.split('/')[0]}
                    </Button>
                    <Button disabled={!!busy || r.inStep === true} onClick={pullHere}
                        title={r.inStep === true ? 'This host is at the same commit as your fork' : 'Fetch from your remote and fast-forward ' + bt.head + ' here'}>
                        {busy === 'here' ? 'pulling…' : 'Pull ' + bt.head + ' here'}
                    </Button>
                </div>
            </Card>
        );
    }

    function Detail({ r, chain, onChanged, stoppedFor }) {
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
                            {/* THREE REASONS THERE IS NO DESTINATION AND THEY
                                ARE NOT THE SAME. This said "(nowhere — no
                                remote)" for all of them, which was written when
                                the only way to have no target was to have no
                                origin — and once nothing-picked stopped falling
                                back to your own remote it started saying "no
                                remote" about repositories that plainly have
                                one, beside a line claiming work stays here. */}
                            <Mono>{(r.target && r.target.on)
                                || (r.target && r.target.off ? '(nowhere — chosen)'
                                    : (r.target && r.target.self ? '(nothing picked)' : '(no remote called origin)'))}</Mono>
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
                            {r.target && !r.target.on
                                ? <span className="muted">{r.target.off
                                    ? 'nothing is opened from here, by choice'
                                    : 'nothing is sent until somewhere is chosen below'}</span>
                                : r.target && !r.target.upstream
                                ? <span className="muted">work stays on your own remote — nothing is sent upstream</span>
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

                <WhereWorkGoes r={r} chain={chain} onChanged={onChanged} stoppedFor={stoppedFor} />

                <Behind r={r} onChanged={onChanged} />

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
        //WALKED WHENEVER THERE IS NO CHAIN TO SHOW, which is a condition rather
        //than a latch — and that difference is the whole of this.
        //
        //A LATCH WEDGES. Keyed on the repository, `changed` cleared the chain
        //and the latch said "already walked": the chooser disappeared for the
        //rest of the visit, right after a press that had worked. Keyed on the
        //repository AND the target, it still wedged whenever the target did not
        //move — picking your own remote when it was already the target changes
        //`chosen` and not `on`, so the key was identical and the card sat on
        //"Reading the fork chain…" for good. A third key would have had a fourth
        //hole.
        //
        //THE QUESTION IS NOT "HAVE WE WALKED" BUT "IS THERE A CHAIN". `mine` is
        //null whenever there is nothing to show — cleared, never fetched, or
        //belonging to another repository — and that is exactly when walking is
        //right. It cannot wedge, because what it tests is what the card needs.
        //
        //ONE AT A TIME, AND ONE FAILURE IS NOT A LOOP. `walking` stops a second
        //request going out beside the first; `stopped` remembers a walk that
        //FAILED, so a chain that cannot be read leaves the reason on screen
        //rather than asking again every draw.
        var walking = useRef(null);
        var stopped = useRef({});
        useEffect(function () {
            if (!r || !r.repo || mine) return;
            if (walking.current === r.repo || stopped.current[r.repo]) return;
            walking.current = r.repo;
            walk();
        }, [r && r.repo, mine]);

        function walk() {
            var want = r.repo;
            okc.call('repoChain', { repo: want }).then(
                function (c) {
                    walking.current = null;
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
                function (e) {
                    walking.current = null;
                    //REMEMBERED AS FAILED, so the next draw does not ask again
                    //and again. Said only if it is still about what is on
                    //screen — see `showing`.
                    stopped.current[want] = e.message;
                    if (want === showing.current) say(e.message, 'bad');
                }
            );
        }

        function changed(note, warn) {
            setChain(null);
            say(note, warn ? 'warn' : null);
            again();
        }

        return (
            <React.Fragment>
                <Detail r={r} chain={mine} onChanged={changed} stoppedFor={stopped.current[r.repo] || null} />
                <Branches repo={r.repo} onMoved={function (note, kind) { say(note, kind); again(); }} />
            </React.Fragment>
        );
    };
};

