var React = require('react');
var { useState, useEffect, useCallback } = React;

module.exports = function cuts(theme, okc, remember, shell) {
    var StoryList = require('../story-list')(theme).StoryList;
    //THE PAIR OF SIDES, drawn the same way New PR Cut draws it — see
    //./where-rows.js. Both panes ask the same question of the same answer.
    var WhereRows = require('./where-rows')(theme).WhereRows;
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Link, openOut,
        Kv, KvRow, Notice, Markdown, ask
    } = theme;

    var idOf = function (c) { return c.source + ' -> ' + c.target; };
    var day = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };

    //WHERE EACH HALF IS GOING, as a table rather than a sentence.
    //
    //Written as prose this was mangled three times running: a destination ran
    //together as one word, the repository name repeated on every line, and the
    //order read backwards. It is a grid however it is worded, so it is a grid —
    //and the dialog uses this same component rather than describing it again,
    //because the last thing read before publishing should not be a second
    //telling.
    function Where({ pulls }) {
        if (!pulls || !pulls.length) return null;
        return (
            <table className="kv where"><tbody>
                {pulls.map(function (p) {
                    return (
                        <tr key={p.repo}>
                            <th>{p.repo}</th>
                            {/*---- THE FORK AND THE BRANCH ARE TWO FACTS -----

                                `p.into || p.base` SHOWED WHICHEVER CAME FIRST,
                                so wherever a destination fork was known the
                                BRANCH it lands on was dropped — "into
                                bm-ok/node-onlykey-emulator" and not a word
                                about `master`.

                                THAT IS THE HALF THAT CANNOT BE UNDONE. This
                                table is read in the merge dialog, above a
                                button whose own text says it is "a commit on a
                                real default branch" — and which branch was the
                                one thing it would not say. */}
                            <td>
                                <div><Mono>{p.head || p.on || '?'}</Mono></div>
                                <div className="sub muted">
                                    {'into '}
                                    <Mono>{p.into || p.base || '?'}</Mono>
                                    {p.into && p.base ? <span>{' '}<Mono>{p.base}</Mono></span> : null}
                                </div>
                            </td>
                        </tr>
                    );
                })}
            </tbody></table>
        );
    }

    //---- the left column ---------------------------------------------------

    //WHERE A CUT STANDS, IN ONE WORD, AND OFF FIELDS THIS APP ACTUALLY ANSWERS
    //WITH. This read `c.summary`, which is what the app being ported from called
    //it and nothing here has ever set — so every cut with nothing open fell
    //through to the literal "sent", including one whose three pull requests had
    //all been CLOSED WITHOUT MERGING. "Sent" is true of that and says nothing:
    //it was sent, it was refused, and the badge read the same as a cut still
    //waiting for a reviewer.
    //
    //NOTHING OPEN AND NOT LANDED IS THE CASE WORTH SPELLING OUT, so it says how
    //many of how many merged rather than a single word — "0 of 3 merged" is the
    //whole story, and "1 of 3 merged" is a cut that half landed, which is the
    //shape this app exists to make visible.
    function state(c) {
        if (c.draft) return { kind: 'warn', word: 'written, not sent' };
        if (c.landed) return { kind: 'ok', word: 'landed' };
        if (c.open) return { kind: '', word: c.open + ' open' };
        if (c.of) return { kind: c.merged ? 'warn' : 'bad', word: c.merged + ' of ' + c.of + ' merged' };
        return { kind: 'muted', word: 'nothing was opened' };
    }

    function Row({ c, on, onPick }) {
        var s = state(c);
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle><Mono>{c.source}</Mono> <Badge kind={s.kind}>{s.word}</Badge></CardTitle>
                {/* WHERE IT IS GOING IS HALF THE NAME. A cut is a pair of lines,
                    and a list of sources alone cannot tell two cuts of the same
                    branch into different targets apart. */}
                <CardSub>{'into '}<Mono>{c.target}</Mono></CardSub>
                {/* `c.mergedCount` WAS THE OTHER APP'S NAME FOR IT, so the
                    ", N merged" half of this line has never once rendered. */}
                {(c.pulls || []).length
                    ? <CardSub>{c.pulls.length + ' pull request' + (c.pulls.length == 1 ? '' : 's')
                        + (c.merged ? ', ' + c.merged + ' merged' : '')}</CardSub>
                    : null}
            </Card>
        );
    }

    //---- the right column --------------------------------------------------

    function Pull({ p }) {
        var kind = p.merged ? 'ok' : p.state == 'closed' ? 'bad' : p.draft ? 'warn' : '';
        var word = p.merged ? 'merged' : p.state == 'closed' ? 'closed without merging' : p.draft ? 'draft on GitHub' : 'open';
        return (
            <Card>
                <CardTitle>
                    <Mono>{p.repo}</Mono>
                    {p.number ? <Mono>{'#' + p.number}</Mono> : null}
                    <Badge kind={kind}>{word}</Badge>
                    {/* GITHUB'S ANSWER TO "IS IT REVIEWED", read off the pull
                        request rather than remembered here. Silent when GitHub
                        would not say, which is not the same as nobody having
                        reviewed it. */}
                    {p.reviews && p.reviews.changesRequested
                        ? <Badge kind="bad">{p.reviews.changesRequested + ' asked for changes'}</Badge>
                        : null}
                    {p.reviews && p.reviews.approved
                        ? <Badge kind="ok">{p.reviews.approved + ' approved'}</Badge>
                        : null}
                    {p.reviews && !p.reviews.approved && !p.reviews.changesRequested && p.reviews.commented
                        ? <Badge kind="muted">{p.reviews.commented + ' commented'}</Badge>
                        : null}
                    {p.reviews && p.reviews.latestByThisHost
                        ? <Badge kind="muted" title={'this host reviewed it at ' + String(p.reviews.latestByThisHost.sha || '').slice(0, 7)}>
                            {'you: ' + String(p.reviews.latestByThisHost.event || '').toLowerCase().replace('_', ' ')}
                        </Badge>
                        : null}
                </CardTitle>
                {p.title ? <CardSub>{p.title}</CardSub> : null}
                <Kv>
                    <KvRow label="from"><Mono>{p.head || '?'}</Mono></KvRow>
                    <KvRow label="into"><Mono>{p.base || p.into || '?'}</Mono></KvRow>
                    {p.by ? <KvRow label="opened by">{p.by}</KvRow> : null}
                    {p.updated ? <KvRow label="last touched">{day(p.updated)}</KvRow> : null}
                </Kv>
                {/* THE LINK OPENS IN THE PERSON'S REAL BROWSER. Reviewing is done
                    over there; this pane is for knowing whether the three halves
                    agree, which is the part over there cannot answer. */}
                {p.url ? <Link href={p.url}>{p.url}</Link> : null}
            </Card>
        );
    }

    //---- the pane ----------------------------------------------------------

    function Cuts() {
        var [got, setGot] = useState(null);
        var [drafts, setDrafts] = useState(null);
        var [err, setErr] = useState(null);
        var [said, setSaid] = useState(null);
        var [busy, setBusy] = useState(false);
        var [find, setFind] = useState('');
        var [only, setOnly] = remember.use('cuts', 'only', null);
        //READING A CUT IS NOT DONE IN ONE SITTING. It is a pull request per
        //repository and the point of the pane is deciding whether to send or
        //merge it, so coming back to a blank panel is starting the read again
        //from the top.
        var [picked, setPicked] = remember.use('cuts', 'picked', null);
        //THE STORY OF THE PICKED CUT, newest first. A hook, so it sits here with
        //the others and above every early return -- below one it is "Rendered
        //more hooks than during the previous render", which the walk catches.
        //Keyed by the pick rather than by `on`, which is computed further down.
        var storyOf = (picked || '').split(' -> ');
        var story = okc.use('prCutStory', storyOf.length === 2 ? { source: storyOf[0], target: storyOf[1] } : {}, 15000);


        //DRAFTS ARE LOCAL AND ANSWER INSTANTLY; cuts are a network call. Asked
        //separately so the one row on the screen that wants a person is not
        //waiting behind GitHub being asked about seventeen things that do not.
        var readDrafts = useCallback(function () {
            return okc.call('prDrafts', {}).then(function (d) { setDrafts(d.drafts || []); },
                function () { setDrafts([]); });
        }, []);

        var read = useCallback(function () {
            setBusy(true);
            return okc.call('prCuts', {}).then(function (d) {
                setGot(d); setErr(null); setBusy(false);
            }, function (e) {
                setErr(e.message); setBusy(false);
            });
        }, []);

        useEffect(function () { readDrafts(); read(); }, [readDrafts, read]);

        //---- WHAT A DRAFT WOULD ACTUALLY SAY --------------------------------
        //
        //DECIDING WHETHER TO SEND SOMETHING IS DONE BY READING IT. A draft was
        //a title and a state word here, and the button beside it publishes to
        //somebody else's repository — so the one thing needed to make that
        //decision was the one thing not on the screen. The app being ported from
        //composed it here for exactly this reason.
        //
        //COMPOSED, NOT QUOTED. What goes out is what somebody typed PLUS every
        //template block that is on, and the blocks are most of it. Showing only
        //the typed half would be a preview of the smaller part.
        //
        //ONLY FOR A DRAFT. A cut that is out has real pull requests below, and
        //what they say is on GitHub rather than in a composer.
        var [composed, setComposed] = useState(null);
        var wants = picked && (drafts || []).filter(function (w) {
            return w.source + ' -> ' + w.target == picked;
        })[0];
        var forSource = wants && wants.source;
        var forTarget = wants && wants.target;

        //---- AND THE TYPED HALF HAS TO BE HANDED OVER ---------------------
        //
        //THE NOTE ABOVE SAYS "typed PLUS every block" AND THIS ASKED FOR
        //NEITHER-PLUS-BLOCKS. `prTemplatePreview` composes from `body`, and
        //this call left it out — so the preview showed the blocks and dropped
        //the paragraph somebody wrote, which is the mirror image of the fault
        //the note was written against and just as wrong.
        //
        //IT IS INVISIBLE UNLESS YOU KNOW WHAT YOU TYPED. What is drawn is a
        //complete, plausible pull request; the only sign is that it opens with
        //a heading the app wrote instead of the sentence you did. And this is
        //the screen where the decision to publish is made.
        //
        //New PR Cut NEVER HIT IT because it joins the typed half in the window
        //as you type, so its preview never lags a keystroke — see `text` there.
        //Only the pane that reads a KEPT draft has to send it.
        var forBody = wants && wants.body;

        useEffect(function () {
            if (!forSource || !forTarget) { setComposed(null); return; }
            var gone = false;
            setComposed({ asking: true });
            okc.call('prTemplatePreview', { source: forSource, target: forTarget, body: forBody || undefined })
                .then(function (v) { if (!gone) setComposed(v); },
                    function (e) { if (!gone) setComposed({ why: e.message }); });
            return function () { gone = true; };
        }, [forSource, forTarget, forBody]);

        if (!got && !drafts && !err) return <Pane><Skeleton rows={4} /></Pane>;

        //A DRAFT IS A CUT THAT HAS NOT LEFT, so it belongs in the same list. It
        //is the row somebody is most likely to be looking for, so it sorts
        //first rather than being a separate panel somewhere else.
        var waiting = (drafts || []).map(function (w) {
            return { source: w.source, target: w.target, draft: true, landed: false, pulls: [], summary: 'written, not sent', said: w };
        });
        var all = waiting.concat((got && got.cuts) || []);

        var counts = {
            drafts: waiting.length,
            open: all.filter(function (c) { return !c.draft && !c.landed; }).length,
            landed: all.filter(function (c) { return c.landed; }).length
        };

        var rows = all.filter(function (c) {
            if (find && (c.source + ' ' + c.target).toLowerCase().indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'drafts') return !!c.draft;
            if (only == 'open') return !c.draft && !c.landed;
            if (only == 'landed') return !!c.landed;
            return true;
        });

        var on = all.filter(function (c) { return idOf(c) == picked; })[0] || null;
        var openPulls = on ? (on.pulls || []).filter(function (p) { return p.number && !p.merged && p.state == 'open'; }) : [];

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Done.' }); return read().then(readDrafts); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        function send(c) {
            var t = (c.said && c.said.title) || null;
            ask({
                title: 'Send "' + c.source + '" into "' + c.target + '"?',
                plain: [
                    'One pull request in each repository that carries something, tracked together as one cut.',
                    t ? 'Titled "' + t + '"' : 'It has no title of its own, so the template supplies one.',
                    //WHERE THE TOKEN LIVES IS PART OF THE ANSWER. Somebody
                    //reading this is entitled to know that no machine is being
                    //handed a credential to do it.
                    'Nothing is pushed from a machine. This host holds the token and does both steps itself.'
                ],
                //GITHUB'S KIND OF DRAFT IS NOT THIS APP'S KIND. This app's draft
                //has not been sent. GitHub's has been opened and is marked not
                //ready for review — so the option belongs with the act of
                //opening, which is here, and not with the writing.
                fields: [{
                    name: 'asDraft', type: 'checkbox', label: 'Open them as drafts on GitHub',
                    hint: 'They are opened and visible either way. A GitHub draft says "not ready for review" and cannot be merged until somebody marks it ready.'
                }],
                cost: 'This pushes branches to GitHub and opens pull requests. Both are visible to anyone who can see those repositories.',
                confirm: 'Push and open them',
                protect: true,
                onYes: function (f) {
                    return tell(okc.call('prCutMake', {
                        source: c.source, target: c.target,
                        title: t || undefined,
                        body: (c.said && c.said.body) || undefined,
                        draft: f.asDraft === true
                    })).then(function () { setPicked(idOf(c)); });
                }
            });
        }

        function land(c) {
            var open = (c.pulls || []).filter(function (p) { return p.number && !p.merged && p.state == 'open'; });
            ask({
                title: open.length > 1 ? 'Merge all ' + open.length + ' pull requests in this cut?' : 'Merge this pull request?',
                plain: [
                    open.map(function (p) { return p.repo + ' #' + p.number; }).join(', ') + ' — merged into ' + c.target + ', on GitHub, now.',
                    'This is the one thing here that cannot be undone from this window: it is a commit on a real default branch. Reverting it afterwards is a change of its own.',
                    'Afterwards your forks and this host may be behind — Repositories → Sync says where every repository stands and catches them up, in that order.',
                    //The same table the panel draws. Somebody who scrolled past
                    //the destinations should not have to trust their memory of
                    //them at the moment of pressing.
                    <Where key="where" pulls={open} />
                ],
                cost: 'A commit on a real default branch, in ' + open.length + ' repositor' + (open.length == 1 ? 'y' : 'ies') + '.',
                confirm: open.length > 1 ? 'Merge all of them' : 'Merge it',
                protect: true,
                onYes: function () { return tell(okc.call('prCutLand', { source: c.source, target: c.target })); }
            });
        }

        function forget(c) {
            ask({
                title: 'Stop tracking "' + c.source + '"?',
                plain: [
                    'It comes off this list. The pull requests on GitHub are untouched — they stay open, or stay merged, exactly as they are.',
                    'What is lost is the fact that they are ONE change, which is the part GitHub does not hold.'
                ],
                confirm: 'Stop tracking it',
                danger: true,
                onYes: function () {
                    return tell(okc.call('prCutForget', { source: c.source, target: c.target }))
                        .then(function () { setPicked(null); });
                }
            });
        }

        //---- WHAT THE APP BEING PORTED FROM CAN DO TO A CUT -----------------
        //
        //THE LIST CAME ACROSS AND THE ACTS DID NOT. This pane could send, merge
        //and stop tracking; everything else a person does to a cut once it is
        //out was on the other app's panel and nowhere here — including the one
        //that matters most when something goes wrong.

        //CLOSING IS THE UNDO FOR SENDING, and its absence was the sharpest edge
        //in this pane: a cut could be opened from here and there was no way to
        //take it back. A drill opened three pull requests that should never have
        //gone out and they had to be closed by hand on GitHub.
        //
        //ALL OF THEM, NEVER ONE. The point of a cut is that the pull requests
        //are one change; closing half of it leaves a landing nothing can finish
        //and nothing is tracking as broken.
        function setState(c, want) {
            var open = (c.pulls || []).filter(function (p) { return p.number && p.state == 'open'; });
            var shut = (c.pulls || []).filter(function (p) { return p.number && p.state == 'closed'; });
            var many = want == 'closed' ? open.length : shut.length;
            ask({
                title: (want == 'closed' ? 'Close all ' : 'Reopen all ') + many + ' pull request(s) in "' + c.source + '"?',
                plain: want == 'closed'
                    ? ['They stay on GitHub and can be reopened. The branches are untouched, and so is this record.',
                       'Anybody watching those repositories sees them close.']
                    : ['They go back to open, as they were. GitHub refuses this for one that has been merged.'],
                cost: 'This changes what other people see on GitHub.',
                confirm: want == 'closed' ? 'Close all of them' : 'Reopen all of them',
                protect: true,
                onYes: function () {
                    return tell(okc.call('prCutUpdate', { source: c.source, target: c.target, state: want }));
                }
            });
        }

        //ONE TITLE AND ONE DESCRIPTION ACROSS THE WHOLE CUT, which is the reason
        //a cut is a thing at all: GitHub has no idea the three pull requests are
        //one change, so keeping their text in step is this app's job. Editing
        //them one at a time on GitHub is how they drift.
        function edit(c) {
            var t = (c.pulls || [])[0] || {};
            ask({
                title: 'Write it to all ' + (c.pulls || []).length + ' pull request(s)?',
                plain: ['The title and description of every pull request in this cut are set to what is below.',
                    'Left blank, that half is left as it is.'],
                fields: [
                    { name: 'title', label: 'Title', value: t.title || '' },
                    { name: 'body', label: 'What it says', multiline: true, rows: 6,
                      hint: 'The template blocks are not re-applied here — this is the text as it will stand.' }
                ],
                confirm: 'Write it to all of them',
                protect: true,
                onYes: function (f) {
                    if (!(f.title || '').trim() && !(f.body || '').trim()) {
                        throw new Error('Nothing to change. Give a title, a description, or both.');
                    }
                    return tell(okc.call('prCutUpdate', {
                        source: c.source, target: c.target,
                        title: (f.title || '').trim() || undefined,
                        body: (f.body || '').trim() || undefined
                    }));
                }
            });
        }

        //AFTER A CUT LANDS, THE SYNCING IS SOMEBODY ELSE'S JOB. This pane
        //used to measure the three drifts and run the fork sync itself, from a
        //dialog of its own -- a second place that asked GitHub the same
        //question and a second place that acted on the answer.
        //
        //Repositories -> Sync IS THAT PLACE, and it is the whole subject: every
        //repository, all three standings, the dry run, and the presses. So this
        //hands over rather than competing -- what a landed cut has to say is
        //THAT there is catching up to do, and where it is done.
        function syncForks() { shell.go('Repositories', 'Sync'); }

        //A DRAFT IS THE ONE THING HERE THAT CAN BE UNDONE COMPLETELY, and until
        //now it could only be sent. A draft written for a branch that no longer
        //carries anything sat on this list as outstanding work with no way off
        //it except doing the thing it was asking for.
        function throwAway(c) {
            ask({
                title: 'Throw away what was written for "' + c.source + '"?',
                plain: ['The text goes. Nothing is on GitHub for this pair, so nothing there changes.',
                    'It cannot be got back.'],
                confirm: 'Throw it away',
                onYes: function () {
                    return tell(okc.call('prDraftForget', { source: c.source, target: c.target }))
                        .then(function () { setPicked(null); });
                }
            });
        }

        //EDITING IT HAPPENS WHERE IT WAS WRITTEN. New PR Cut is the pane with
        //the preview beside the text, and a second smaller copy of that editor
        //in a dialog here would be the same job done twice and worse.
        function editDraft(c) {
            remember.write('prwrite', 'from', c.source);
            remember.write('prwrite', 'into', c.target);
            shell.go('Repositories', 'New PR Cut');
        }

        var chip = function (key, word) {
            return <Chip on={only == key} count={counts[key]}
                onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
        };

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {err ? <Note kind="bad">{err}</Note> : null}

                <Cols>
                    <Col narrow>
                        <TitleRow>PR cuts<Grow /><span className="muted">{all.length}</span></TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a source or target" />
                        <Chips>
                            {chip('drafts', 'not sent')}
                            {/* NOT LANDED, WHICH IS WHAT IT COUNTS. "Out" says
                                a change is still in flight, and a cut whose pull
                                requests were all closed unmerged is counted here
                                and is not in flight at all. */}
                            {chip('open', 'not landed')}
                            {chip('landed', 'landed')}
                        </Chips>
                        <Stack>
                            {/* A SKELETON WHILE THE FIRST READ IS OUT, because
                                the alternative is a confident lie. This read
                                takes about sixteen seconds — twenty cuts, each
                                one a question put to GitHub — and for all of
                                that the column said "nothing has been written or
                                sent", which is a true-sounding sentence about a
                                question that had not been answered yet.

                                "Not read yet" and "there is nothing" are
                                different, and only one of them is worth acting
                                on. Photographs of this pane during that window
                                are how it was caught. */}
                            {busy && !got
                                ? <Skeleton rows={4} />
                                : rows.length
                                    ? rows.map(function (c) {
                                        return <Row key={idOf(c)} c={c} on={idOf(c) == picked}
                                            onPick={function () { setPicked(idOf(c)); }} />;
                                    })
                                    : <Empty>{all.length ? 'nothing matches' : 'nothing has been written or sent'}</Empty>}
                        </Stack>
                    </Col>

                    <Col>
                        <h2>Actions <span className="muted">{on ? '— ' + on.source : '— nothing selected'}</span></h2>
                        <Panel>
                            {/* NO "Read them from GitHub" BUTTON. This pane
                                already reads on the way in — see the effect
                                above — and every call carries an etag, so the
                                repeat the button offered is the same conditional
                                request the mount just made.

                                IT SAYS WHEN IT IS WORKING, which is what the
                                button was really for: one question per cut, put
                                to somebody else's service, and that takes a
                                moment. Opening the pane again re-reads, which is
                                what somebody wants after merging something over
                                there. */}
                            {busy ? <Note>asking GitHub…</Note> : null}

                            {!on ? <Empty>pick a cut on the left</Empty> : (
                                <div className="row" style={{ marginTop: '8px' }}>
                                    {/* DISABLED WHEN THERE IS NOTHING TO SEND,
                                        which the app being ported from does and
                                        this did not. A draft can outlive the work
                                        it was written for, and this is the one
                                        button on the row that reaches GitHub —
                                        pressing it then spends a push and a
                                        refusal to be told what the panel beside
                                        it already knows.

                                        `undefined` WHILE IT IS STILL COMPOSING.
                                        "Cannot" and "not known yet" are different
                                        and only one of them is a dead end. */}
                                    {on.draft
                                        ? <Button kind="ok" protect
                                            disabled={!!(composed && !composed.asking && !composed.text)}
                                            title={composed && !composed.asking && !composed.text
                                                ? (composed.why || composed.note || 'nothing would be opened for this pair')
                                                : 'Pushes the branches and opens the pull requests. This is the step that reaches GitHub'}
                                            onClick={function () { send(on); }}>Send it</Button>
                                        : null}
                                    {/* AND NOT WHEN THE PAIR IS NOT TWO LINES ANY
                                        MORE. New PR Cut works in LINE names and
                                        reconciles a remembered pair against the
                                        list every time it draws — so a draft
                                        naming something that has stopped being a
                                        line took you there, quietly showed a
                                        DIFFERENT pair, and overwrote where you
                                        were standing on the way. Nothing said
                                        so. The preview beside this already knows
                                        the pair is dead; that is the reason on
                                        the button. */}
                                    {on.draft
                                        ? <Button
                                            disabled={!!(composed && !composed.asking && !composed.text)}
                                            onClick={function () { editDraft(on); }}
                                            title={composed && !composed.asking && !composed.text
                                                ? (composed.why || composed.note || 'this pair carries nothing')
                                                    + ' — New PR Cut works in lines, so there is nothing there to edit'
                                                : 'Open it on New PR Cut, where it was written'}>Edit it</Button>
                                        : null}
                                    {on.draft
                                        ? <Button kind="danger" onClick={function () { throwAway(on); }}
                                            title="Nothing is on GitHub for this pair">Throw it away</Button>
                                        : null}

                                    <Button protect
                                        disabled={!openPulls.length}
                                        title={openPulls.length
                                            ? 'Merge ' + openPulls.length + ' pull request(s) into ' + on.target
                                            : on.landed ? 'it has landed already' : 'nothing in it is open'}
                                        onClick={function () { land(on); }}>
                                        {openPulls.length > 1 ? 'Merge all of them' : 'Merge it'}
                                    </Button>

                                    {/* EVERY ONE OF THESE IS DISABLED WITH A
                                        REASON RATHER THAN HIDDEN. A button that
                                        comes and goes teaches nobody what the
                                        rule is; one that is greyed and says why
                                        answers the question being asked. */}
                                    {!on.draft
                                        ? <Button
                                            disabled={!(on.pulls || []).filter(function (p) { return p.number; }).length}
                                            title="Set the title and description of every pull request in this cut at once"
                                            onClick={function () { edit(on); }}>Edit all of them</Button>
                                        : null}

                                    {!on.draft
                                        ? (function () {
                                            var open = (on.pulls || []).filter(function (p) { return p.number && p.state == 'open'; });
                                            var shut = (on.pulls || []).filter(function (p) { return p.number && p.state == 'closed'; });
                                            var closing = open.length > 0;
                                            return (
                                                <Button kind="danger" protect
                                                    disabled={!closing && !shut.length}
                                                    title={closing
                                                        ? 'Close all ' + open.length + ' of them on GitHub. They can be reopened'
                                                        : shut.length
                                                            ? 'Put all ' + shut.length + ' of them back to open'
                                                            : 'every one of them has merged, and GitHub will not reopen a merged pull request'}
                                                    onClick={function () { setState(on, closing ? 'closed' : 'open'); }}>
                                                    {closing
                                                        ? (open.length > 1 ? 'Close all of them' : 'Close it')
                                                        : (shut.length > 1 ? 'Reopen all of them' : 'Reopen it')}
                                                </Button>
                                            );
                                        })()
                                        : null}

                                    {!on.draft
                                        ? <Button kind="danger" onClick={function () { forget(on); }}>Stop tracking it</Button>
                                        : null}
                                </div>
                            )}

                            {/*---- IT SAYS THERE IS CATCHING UP, NOT WHAT IT IS

                                THIS ASSERTED "Each fork is now behind its
                                parent" because a cut had landed — a claim about
                                GitHub inferred from a local record, and wrong
                                here in both directions at once: the two forks
                                this cut merged INTO came out AHEAD of their
                                parents, and four unrelated ones had been
                                trailing for weeks with nothing anywhere saying
                                so.

                                MEASURING IT HERE WOULD BE THE SECOND PLACE
                                DOING IT. Sync asks GitHub for all three
                                standings and holds the presses; this says a
                                landing leaves work to do and opens that pane. */}
                            {on && on.landed
                                ? <React.Fragment>
                                    <Note kind="warn">
                                        It has landed. Your forks and this host may now be behind — Sync says
                                        where every repository stands and catches them up, in that order,
                                        before anything new is cut from them.
                                    </Note>
                                    <div className="row" style={{ marginTop: '8px' }}>
                                        <Button kind="ok" onClick={syncForks}
                                            title="Repositories → Sync: all three standings per repository, and the presses that close them">
                                            Sync the forks
                                        </Button>
                                    </div>
                                </React.Fragment>
                                : null}
                        </Panel>

                        {/*---- WHAT IS ABOUT TO GO WHERE ------------------

                            THE SAME ROWS New PR Cut DRAWS, and this is the
                            pane where they matter more: there, somebody is
                            composing; here, the button above this reads
                            "Send it" and publishes to GitHub.

                            IT WAS TWO NAMES AND A STATE WORD. Which
                            repositories, at which commits, onto whose forks —
                            none of it was on the screen where the decision is
                            made, and all of it is on the answer this pane
                            already asks for to compose the preview. */}
                        {composed && !composed.asking && (composed.where || []).length
                            ? <WhereRows where={composed.where} />
                            : null}

                        <h2>The story <span className="muted">{on ? '— newest first' : ''}</span></h2>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <Panel>
                                {/* A VERTICAL TIMELINE: what came IN from GitHub (a
                                    tag, a maintainer's comment), what went OUT in the
                                    person's name (a reply, the pull request, a push),
                                    what the supervisor said at each waking, and the
                                    tasks and judgements between. Newest at the top --
                                    where it stands now -- and the initiator at the
                                    bottom. The composer is beside the server, in the pr plugin. */}
                                <StoryList story={story} empty="Nothing is recorded about this cut yet." />
                            </Panel>
                        )}
                        {got && got.note ? <Note>{got.note}</Note> : null}
                    </Col>

                    <Col wide>
                        <h2>What it is</h2>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <div>
                                <Panel>
                                    <Kv>
                                        <KvRow label="from"><Mono>{on.source}</Mono></KvRow>
                                        <KvRow label="into"><Mono>{on.target}</Mono></KvRow>
                                        <KvRow label="state">{state(on).word}</KvRow>
                                        {on.opened ? <KvRow label="opened">{day(on.opened) + (on.by ? ' by ' + on.by : '')}</KvRow> : null}
                                        {on.summary ? <KvRow label="summary">{on.summary}</KvRow> : null}
                                    </Kv>
                                    {on.draft && on.said && on.said.title
                                        ? <Note>{'Titled "' + on.said.title + '"'}</Note>
                                        : null}
                                </Panel>

                                {(on.pulls || []).length
                                    ? <Stack>{on.pulls.map(function (p) { return <Pull key={p.repo} p={p} />; })}</Stack>
                                    : (
                                        <Panel>
                                            {/* NOT SENT IS NOT THE SAME AS NOTHING
                                                THERE, and the difference is the
                                                whole state of this row. */}
                                            <Empty>
                                                Nothing is on GitHub for this one yet — it has been written and not sent.
                                            </Empty>

                                            {on.draft && composed && composed.asking
                                                ? <Note>Composing what it would say…</Note>
                                                : null}

                                            {/* A DRAFT OUTLIVES THE WORK IT WAS
                                                WRITTEN FOR. The pair it names can
                                                stop carrying anything — the branch
                                                landed some other way, or was
                                                rebuilt — and then Send it can only
                                                fail. Saying so here, next to
                                                "Throw it away", is the difference
                                                between a dead row and a dead row
                                                somebody can clear. */}
                                            {on.draft && composed && !composed.asking && !composed.text
                                                ? <Note kind="bad">
                                                    {(composed.why || composed.note || 'Nothing would be opened for this pair.')
                                                        + ' Throw it away, or point it at a line that carries something.'}
                                                </Note>
                                                : null}

                                            {on.draft && composed && composed.text
                                                ? <React.Fragment>
                                                    <Note>
                                                        What a pull request would say — what was written, and everything
                                                        the blocks on New PR Cut add to it.
                                                    </Note>
                                                    <Card>
                                                        <CardTitle>
                                                            <span>{(on.said && on.said.title) || composed.title}</span>
                                                        </CardTitle>
                                                        <Markdown text={composed.text} />
                                                    </Card>
                                                </React.Fragment>
                                                : null}
                                        </Panel>
                                    )}
                            </div>
                        )}
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Cuts;
};
