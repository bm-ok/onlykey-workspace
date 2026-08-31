var React = require('react');
var { useState, useEffect, useRef } = React;

//---------------------------------------------------------------------------
//New PR Cut: what every pull request in a cut says beyond what somebody typed.
//
//THE PREVIEW IS MADE OF REAL FACTS, NOT PLACEHOLDERS. A preview of a layout
//tells you whether it looks tidy; a preview of the actual sentences tells you
//whether they are worth saying, which is the only question a template raises.
//The one thing it cannot know is the pull request numbers, because those do not
//exist until the cut is made — so it shows them as ? and says so rather than
//inventing plausible ones.
//
//THIS PANE WRITES. THE PR CUTS PANE SENDS. Its only button used to be "Cut it",
//which pushed every branch and opened every pull request on the spot — so the
//screen for composing text was also the screen that published, and there was no
//way to write something and keep it. One screen that both writes and publishes
//is a screen where the difference between thinking and doing is a button you
//have already moved the mouse to. Sending is deliberately not offered here.
//
//EVERY BLOCK IS OFF UNTIL IT IS TURNED ON. A description that adds things
//nobody asked for is one people stop reading, so the app's own additions are
//opt-in one at a time rather than a house style somebody has to trim back.
//
//THE PREVIEW IS ASKED FOR WHEN THE QUESTION CHANGES, never on a cadence.
//Composing one reads git twice per repository, and the answer only moves when
//the pair of lines, the chosen copy, or the blocks that are on do. What is
//TYPED is joined on locally, so a keystroke costs nothing and the preview never
//lags a sentence behind.
//---------------------------------------------------------------------------

module.exports = function writer(theme, okc, remember) {
    //THE SAME ROWS THE PR CUTS PANE DRAWS — see ./where-rows.js.
    var WhereRows = require('./where-rows')(theme).WhereRows;
    var {
        Pane, Panel, Cols, Col, Stack, Head, Card, CardTitle, CardSub,
        Badge, Button, Skeleton, Empty, Note, Markdown, Form, Field, Notice, Views, Mono, Muted, ask, ago
    } = theme;

    return function NewPRCut() {
        var blocks = okc.use('prTemplate', {}, 0);
        var lines = okc.use('lines', {}, 0);

        //WHICH PAIR IS BEING PREVIEWED, kept across restarts like every other
        //place somebody was standing. Two line NAMES — not what they carry.
        var [from, setFrom] = remember.use('prwrite', 'from', null);
        var [into, setInto] = remember.use('prwrite', 'into', null);
        //WHICH REPOSITORY'S COPY. They differ exactly where a block is about the
        //others — the cross-links — and being able to read one rather than an
        //average of them is the point of the selector.
        var [as, setAs] = useState(null);

        var [preview, setPreview] = useState(null);
        var [failed, setFailed] = useState(null);
        var [title, setTitle] = useState('');
        var [body, setBody] = useState('');
        var [kept, setKept] = useState('');
        var [said, setSaid] = useState(null);
        var [busy, setBusy] = useState(false);

        var usable = ((lines.state && lines.state.groups) || []).filter(function (g) { return !g.broken.length; });
        var names = usable.map(function (g) { return g.name; });

        //DEFAULTED TO A PROPOSED LINE GOING INTO ONE THAT IS NOT, because that
        //is the pair somebody is about to cut. Reconciled every time the list
        //moves: a remembered name that has gone stale, or that has come to match
        //the source, would leave this asking for a preview of nothing.
        var pickFrom = names.indexOf(from) >= 0 ? from : null;
        if (!pickFrom && usable.length) {
            pickFrom = (usable.filter(function (g) { return g.marked; })[0] || usable[0]).name;
        }
        var pickInto = (names.indexOf(into) >= 0 && into != pickFrom) ? into : null;
        if (!pickInto && usable.length) {
            var other = usable.filter(function (g) { return g.name != pickFrom; });
            pickInto = ((other.filter(function (g) { return !g.marked; })[0] || other[0] || {}).name) || null;
        }

        useEffect(function () {
            if (pickFrom && pickFrom != from) setFrom(pickFrom);
            if (pickInto && pickInto != into) setInto(pickInto);
        }, [pickFrom, pickInto]);

        var onIds = blocks.state
            ? (blocks.state.blocks || []).filter(function (b) { return b.on; }).map(function (b) { return b.id; }).join(',')
            : null;

        //ASKED WHEN THE QUESTION CHANGES. The key is the whole question: which
        //two lines, whose copy, and which blocks are on.
        var want = JSON.stringify([pickFrom, pickInto, as, onIds]);
        var asked = useRef(null);
        useEffect(function () {
            if (!pickFrom || !pickInto || pickFrom == pickInto || onIds == null) return;
            if (asked.current === want) return;
            asked.current = want;
            var mine = want;
            setFailed(null);
            okc.call('prTemplatePreview', { source: pickFrom, target: pickInto, repo: as || undefined }).then(
                function (v) { if (asked.current === mine) { setPreview(v); setFailed(null); } },
                function (e) { if (asked.current === mine) { setPreview(null); setFailed(e.message); } }
            );
        }, [want]);

        //FILLED FROM WHAT THE CUT ALREADY SAYS, ONCE, AND THEN LEFT ALONE.
        //Rewriting these on every draw takes the cursor out of somebody's hands
        //mid-sentence — the same fault as repainting a list while it is being
        //read, and worse, because it eats typing.
        //
        //THE DRAFT WINS over what the cut says. It is what somebody was in the
        //middle of writing; the cut is what was sent last time, and offering the
        //older of the two back would quietly discard a paragraph.
        var filled = useRef(null);
        useEffect(function () {
            if (!pickFrom || !pickInto) return;
            var pair = pickFrom + ' ' + pickInto;
            if (filled.current === pair) return;
            filled.current = pair;
            okc.call('prDraft', { source: pickFrom, target: pickInto }).then(function (d) {
                var draft = d && d.draft;
                var said = preview && preview.said;
                setTitle((draft && draft.title) || (said && said.title) || '');
                setBody((draft && draft.body) || (said && said.body) || '');
                setKept(draft ? 'draft kept ' + ago(draft.at) : '');
            }, function () { /* an unreadable draft is not worth a banner */ });
        }, [pickFrom, pickInto]);

        //KEPT A MOMENT AFTER TYPING STOPS. What somebody writes here used to
        //live only in a DOM node: one click on another tab and a paragraph was
        //gone, and writing the description is the slowest part of cutting a pull
        //request. Debounced rather than per keystroke, because this is a file
        //write and a paragraph is a hundred of them.
        var timer = useRef(null);
        function keep(nextTitle, nextBody) {
            clearTimeout(timer.current);
            timer.current = setTimeout(function () {
                okc.call('prDraftSave', {
                    source: pickFrom, target: pickInto, title: nextTitle, body: nextBody
                }).then(
                    function (d) { setKept(d && d.draft ? 'draft kept ' + ago(d.draft.at) : ''); },
                    function () { /* it is still on the screen; failing to keep it is not worth a banner */ }
                );
            }, 800);
        }
        useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);

        function toggle(b, on) {
            okc.call('prTemplateSet', { id: b.id, on: on }).then(
                function () { asked.current = null; blocks.again(); },
                function (e) { setSaid({ kind: 'bad', text: e.message }); }
            );
        }

        //KEEPING IT AND PUBLISHING IT ARE TWO DIFFERENT ACTS, and the button
        //that does each is in the same place on the screen — which is exactly
        //why they must not share a handler. Saving a draft touches this host and
        //nothing else. Writing to a cut edits text that is ALREADY PUBLISHED on
        //somebody else's repository, so it asks first and is a person's press.
        function save() {
            setBusy(true);
            okc.call('prDraftSave', { source: pickFrom, target: pickInto, title: title, body: body }).then(
                function (d) {
                    setBusy(false);
                    setKept(d && d.draft ? 'draft kept ' + ago(d.draft.at) : '');
                    setSaid({ text: 'Kept against ' + pickFrom + ' into ' + pickInto + '. It appears on PR cuts as "not sent".' });
                },
                function (e) { setBusy(false); setSaid({ kind: 'bad', text: e.message }); }
            );
        }

        function writeToCut(v) {
            ask({
                title: 'Write this to all ' + v.existing.count + ' pull request(s)?',
                plain: [
                    v.repos.join(', ') + ' — each one gets this title and this description.',
                    'Whether each is open or merged is GitHub’s and is not touched here.',
                    'The blocks are written again too, so anything turned on since it was cut appears now.'
                ],
                confirm: 'Write it to all of them',
                onYes: function () {
                    return okc.call('prCutUpdate', {
                        source: pickFrom,
                        target: pickInto,
                        title: String(title).trim(),
                        body: [String(body).trim(), v.additions].filter(Boolean).join('\n\n---\n\n')
                    }).then(function (r) {
                        asked.current = null;
                        setSaid({
                            text: r.note,
                            kind: (r.changed || []).some(function (x) { return !x.ok; }) ? 'bad' : null
                        });
                    }, function (e) {
                        setSaid({ kind: 'bad', text: e.message });
                        throw e;
                    });
                }
            });
        }

        if (!blocks.state || !lines.state) return <Pane><Skeleton rows={6} /></Pane>;

        var v = preview;
        //COMPOSED HERE AS IT IS TYPED. What the blocks add does not depend on
        //what is typed — only on the pair of lines and which copy — so the
        //sentence in front is joined on locally.
        var typed = String(body || '').trim();
        var text = [typed, v && v.additions].filter(Boolean).join('\n\n---\n\n');
        var existing = v && v.existing && v.existing.count;

        //THE TWO SIDES OF THE CUT, DRAWN, live in ./where-rows.js — the pane
        //that composes a cut and the pane that sends one both need it, and of
        //two copies the one that drifts is the one nobody is looking at.


        //---- WHERE THE PULL REQUEST BEING READ WILL OPEN --------------------
        //
        //TWO FACTS, AND THE PANE SHOWED NEITHER. `into <line>` names the BRANCH
        //it lands on; the REMOTE it opens against is chosen per repository and
        //lived only on another tab. Somebody about to open pull requests on
        //somebody else's GitHub could not see whose.
        //
        //A REPOSITORY WITH NOTHING PICKED IS THE ONE THAT MATTERS. `where`
        //answers `into: null` and says where it is chosen, and a cut carrying
        //one of those cannot fully land — which is worth knowing before the
        //press rather than from GitHub afterwards.
        function whereThisOpens(v) {
            var shown = as || v.showing;
            var w = (v.where || []).filter(function (r) { return r.repo === shown; })[0];
            if (!w) return null;

            if (!w.into) {
                return (
                    <Note>
                        <Badge kind="warn">no remote picked</Badge>{' '}
                        This one has nowhere to open: {w.intoWhy || 'nothing is chosen for it'}.
                    </Note>
                );
            }

            //CROSSING IS WORTH ITS OWN WORD. Opening against somebody else's
            //fork is a different act from opening against your own, and the
            //answer already knows which this is.
            return (
                <Note>
                    Opens on <Mono>{w.into}</Mono>, into <Mono>{w.base}</Mono>
                    {w.crossing ? <span>{' '}<Badge kind="warn">not your own fork</Badge></span> : null}.
                </Note>
            );
        }

        //---- THE PRESS THAT GETS PAST AN EMPTY PANE -------------------------
        //
        //SAYING WHAT IS MISSING IS NOT THE SAME AS OFFERING IT. This pane knew
        //perfectly well that it needed a line and told somebody to go to
        //another tab and make one — which is the pane stopping them at the
        //exact moment it could have helped.
        //
        //IT IS THE SAME `lineSave` THE LINES PANE OFFERS, with nothing to go on,
        //which takes what each repository is on now. That is almost always the
        //thing missing here: work is cut FROM the heads and lands back INTO
        //them, so the target line is the one nobody thought to name.
        //
        //IT ASKS FOR A NAME AND CANNOT DEFAULT ONE. The repositories are on
        //`master`, `main` and `heroku-deploy` here — there is no single branch
        //name to call it after, which is exactly why a line needs a name of its
        //own. The Branches Lines pane says the same thing at its own door.
        //
        //NAMED IN WORDS RATHER THAN AS A PATH. That file's name ends with the
        //same word as the `lines` hook in this one, so writing the path here put
        //`<hook>.<something>` into a comment — and
        //../../../test/rules/ask-hook-shape.test.js reads it as a property on
        //the hook, which hands back only state, error, reads and again. A rule
        //that scans text cannot tell a filename from a call, and of the two the
        //comment is the cheaper half to change.
        function nameTheHeads() {
            var heads = (lines.state && lines.state.repos) || [];
            if (!heads.length) return null;

            return (
                <Button kind="ok" onClick={function () {
                    ask({
                        title: 'Name what each repository is on now',
                        plain: [
                            'This makes a line out of the branch each repository is currently on — '
                                + heads.map(function (r) { return r.repo + ' on ' + r.on; }).join(', ') + '.',
                            'That is where work lands, so it is what a pull request goes INTO. Nothing '
                                + 'moves and nothing is pushed.'
                        ],
                        fields: [
                            { name: 'name', label: 'Call it', needed: true,
                                hint: 'They are not all on the same branch name, so this needs one of its own.' },
                            { name: 'why', label: 'What it is for', hint: 'Optional.' }
                        ],
                        confirm: 'Name it',
                        onYes: function (f) {
                            return okc.call('lineSave', { name: f.name, why: f.why || undefined }).then(
                                function () {
                                    setSaid({ text: '“' + f.name + '” is a line now. Pick it on the right to '
                                        + 'send a change into it.' });
                                    lines.again();
                                },
                                function (e) { setSaid({ kind: 'bad', text: e.message }); throw e; }
                            );
                        }
                    });
                }}>Name what each repository is on now</Button>
            );
        }

        //A SELECT WITH NOTHING IN IT IS A CONTROL THAT LOOKS BROKEN. An empty
        //dropdown gives a person nothing to read and nothing to press, and no
        //way to tell it apart from one that failed to load — which is how this
        //pane came to be reported as broken when it was merely empty. One
        //unselectable line saying so costs nothing and answers the question.
        function lineOptions() {
            if (!names.length) return [{ value: '', label: 'no lines named yet' }];
            return names.map(function (n) { return { value: n, label: n }; });
        }

        return (
            <Pane>
                <Note>
                    What every pull request in a cut says beyond what somebody typed. The preview is the editor,
                    and it is composed from real facts about the two lines chosen &mdash; including the links between
                    the cut&rsquo;s own pull requests, which nothing else can write.
                </Note>
                {said ? <Notice kind={said.kind} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                {/*---- WHICH TWO LINES, ABOVE BOTH COLUMNS ------------------

                    IT LIVED IN THE RIGHT-HAND COLUMN'S HEADING, pushed to the
                    far end of it by a `grow`. So the one decision this pane is
                    about — what is being sent, and where — was two unlabelled
                    dropdowns in a corner, while six cards of template
                    configuration held the whole left side.

                    IT IS NOT PART OF EITHER COLUMN. The left column is what
                    every pull request says; the right is the one being
                    written. The PAIR is what both of them are about, so it
                    belongs above them rather than inside one. */}
                <Head>
                    <span>From</span>
                    <select value={pickFrom || ''} onChange={function (e) { setFrom(e.target.value); asked.current = null; filled.current = null; }}>
                        {lineOptions().map(function (o) { return <option key={o.value} value={o.value}>{o.label}</option>; })}
                    </select>
                    <span className="muted">into</span>
                    <select value={pickInto || ''} onChange={function (e) { setInto(e.target.value); asked.current = null; filled.current = null; }}>
                        {lineOptions().map(function (o) { return <option key={o.value} value={o.value}>{o.label}</option>; })}
                    </select>
                    <span className="grow" />
                </Head>

                {/*---- AND WHAT THOSE TWO NAMES ARE, SIDE BY SIDE -----------

                    THE PAIR OF DROPDOWNS IS AN ABSTRACTION over eighteen real
                    things: nine branches on one side and nine on the other.
                    Picking between two names and pressing publish is a decision
                    made without seeing any of them.

                    SO THE TWO SIDES ARE DRAWN. Left is what is being sent,
                    right is where each one lands — the address, the branch, and
                    the commit each is at, which is the whole of what a line is.
                    A repository with no destination shows that here rather than
                    only in the tab below. */}
                {v ? <WhereRows where={v.where} /> : null}

                <Cols>
                    <Col narrow>
                        <Head><span>What every pull request says</span></Head>
                        <Note>{blocks.state.note}</Note>
                        <Stack>
                            {(blocks.state.blocks || []).map(function (b) {
                                return (
                                    <Card key={b.id} pick on={b.on}>
                                        <label className="inline" style={{ alignItems: 'flex-start', gap: '8px' }}>
                                            <input type="checkbox" checked={!!b.on}
                                                onChange={function (e) { toggle(b, e.target.checked); }} />
                                            <span>
                                                <CardTitle>
                                                    <span>{b.label}</span>
                                                    {/* WHEN IT APPLIES AT ALL. A block
                                                        that only means something across
                                                        several repositories would
                                                        otherwise read as one that did
                                                        nothing. */}
                                                    {b.manyOnly ? <Badge kind="muted">only when several repositories</Badge> : null}
                                                </CardTitle>
                                                <CardSub><span className="muted">{b.about}</span></CardSub>
                                            </span>
                                        </label>
                                    </Card>
                                );
                            })}
                        </Stack>
                    </Col>

                    <Col wide>
                        <Head><span>The pull request</span></Head>

                        {/*---- WHAT IS THE SAME ON ALL OF THEM, ABOVE THE TABS

                            ONE TITLE GOES ON EVERY PULL REQUEST IN THE CUT, so
                            it does not belong inside a tab. Under one it reads
                            as that repository's title, and typing it while
                            looking at `node-onlykey-emulator` gives no sign it
                            is also about to be the title on `onlykey-testing`.

                            SO THE LINE IS WHERE THE TAB IS. Above it, shared;
                            below it, that repository's own. */}
                        {v ? (
                            <Form>
                                <Field f={{ label: 'Title — one sentence on every pull request in the cut', placeholder: 'what this change is' }}
                                    value={title}
                                    onChange={function (x) { setTitle(x); keep(x, body); }} />
                            </Form>
                        ) : null}

                        {/*---- THREE WAYS TO HAVE NO PAIR, AND THEY ARE NOT THE
                            SAME ---------------------------------------------

                            THIS SAID "Two different lines are needed" WHATEVER
                            THE REASON, including the one where there are none
                            at all. A workspace that has never named a line
                            showed two empty dropdowns and a sentence telling
                            somebody to pick from them — so the pane read as
                            broken, which is exactly how it was reported.

                            IT IS NOT BROKEN AND IT IS NOT USABLE, and the only
                            thing standing between those two readings is saying
                            which. Every other refusal in this app names what is
                            missing and where it is fixed; this one did not. */}
                        {!names.length ? (
                            <Empty>
                                <p>
                                    No lines have been named in this workspace yet, so there is nothing to
                                    compare. A line is one branch per repository, held together under a name.
                                </p>
                                <p>{nameTheHeads()}</p>
                            </Empty>
                        ) : names.length < 2 ? (
                            <Empty>
                                <p>
                                    Only one line is named here — “{names[0]}”. A pull request goes from one
                                    line into another, so there is nowhere to send it yet.
                                </p>
                                <p>{nameTheHeads()}</p>
                            </Empty>
                        ) : !pickFrom || !pickInto || pickFrom == pickInto ? (
                            <Empty>Two different lines are needed to preview what a pull request between them would say.</Empty>
                        ) : failed ? (
                            <Empty bad>{failed}</Empty>
                        ) : !v ? (
                            <Skeleton rows={4} />
                        ) : (
                            <React.Fragment>
                                {/* INSIDE A Form, WHICH IS NOT DECORATION. `Field`
                                    draws a bare <label> and a bare <input>; every
                                    rule that stacks them, sizes them and colours
                                    them hangs off `.form` (or `.dlg`, for the
                                    dialog it was written for). Without the
                                    wrapper both fields render inline, unstyled
                                    and white -- which is exactly what the first
                                    photograph of this pane showed. */}
                                <Form>
                                    <Field f={{ label: 'What you want to say — everything below is added by the blocks on the left', multiline: true, rows: 8, placeholder: 'Left blank, the blocks speak for themselves.' }}
                                        value={body}
                                        onChange={function (x) { setBody(x); keep(title, x); }} />
                                </Form>
                                {kept ? <Note>{kept}</Note> : null}

                                {/*---- AND BELOW WHAT YOU TYPE, ONE TAB PER
                                    PULL REQUEST BEING MADE ------------------

                                    IT WAS A DROPDOWN SAYING "as node-onlykey-
                                    emulator", which reads as a setting rather
                                    than as what it is: this cut opens ONE PULL
                                    REQUEST PER REPOSITORY, and that control
                                    picks which of them is being read. A
                                    dropdown hides the others, so how many were
                                    about to be opened was behind a menu.

                                    AND IT SITS UNDER THE WRITING, not over it,
                                    because everything above is the SAME on all
                                    of them — one title, one body — and the tab
                                    changes only what is shown beneath it. Above
                                    the tabs, shared; below them, that
                                    repository's own reading of it.

                                    ONLY WHEN THERE IS MORE THAN ONE. A lone tab
                                    is a label pretending to be a control. */}
                                {(v.repos || []).length > 1 ? (
                                    <Views names={v.repos || []} on={as || v.showing || ''}
                                        onPick={function (rp) { setAs(rp); asked.current = null; }} />
                                ) : null}

                                {/*---- AND WHERE THIS ONE ACTUALLY OPENS -----

                                    THE PANE NEVER SAID WHOSE FORK IT LANDS ON.
                                    "into <line>" is the BRANCH side — master,
                                    main, heroku-deploy — and which REMOTE a
                                    pull request opens against is a different
                                    fact entirely, decided per repository on
                                    Repositories → Repos → Where work goes.
                                    Both were invisible here, so the one thing
                                    you cannot undo was the one thing the pane
                                    would not tell you.

                                    AND IT IS OFTEN NOT PICKED. `where` already
                                    answers `into: null` with a reason for any
                                    repository nobody chose one for — a cut with
                                    one of those in it is a cut that cannot
                                    fully land, and finding that out afterwards
                                    is finding it out from GitHub. */}
                                {whereThisOpens(v)}

                                <Note>{v.note}</Note>

                                {!v.text && !v.additions ? (
                                    <Empty>{v.note}</Empty>
                                ) : (
                                    <React.Fragment>
                                        <Card>
                                            <CardTitle><span>{String(title).trim() || v.title}</span></CardTitle>
                                            <CardSub>
                                                <span className="muted">
                                                    {v.guessing
                                                        ? 'Nothing is cut yet, so the links below show ? until it is.'
                                                        : 'The links below are the real pull request numbers.'}
                                                </span>
                                            </CardSub>
                                        </Card>
                                        <Markdown text={text} />

                                        <div className="row">
                                            {/* SENDING IS NOT OFFERED HERE. Writing to a
                                                cut that already exists changes text that
                                                is already published, which is why that
                                                one is a person's press. */}
                                            <Button kind="ok" disabled={busy}
                                                protect={!!existing}
                                                guard={existing ? 'Write it to all' : undefined}
                                                title={existing
                                                    ? 'Changes the title and description of every pull request in this cut'
                                                    : 'Keeps this text against these two lines. It appears on PR cuts as "not sent", and that is where it goes out'}
                                                onClick={function () { existing ? writeToCut(v) : save(); }}>
                                                {existing ? 'Write it to all ' + v.existing.count : 'Save it as a draft'}
                                            </Button>
                                            <span className="muted" style={{ alignSelf: 'center' }}>
                                                {existing
                                                    ? 'cut ' + ago(v.existing.opened) + ' — ' + v.repos.length
                                                        + ' repositor' + (v.repos.length === 1 ? 'y' : 'ies') + ' carry work'
                                                    : pickFrom + ' into ' + pickInto + ' — ' + v.repos.length
                                                        + ' repositor' + (v.repos.length === 1 ? 'y carries' : 'ies carry')
                                                        + ' work. Sending it is on the PR cuts tab'}
                                            </span>
                                        </div>
                                    </React.Fragment>
                                )}
                            </React.Fragment>
                        )}
                    </Col>
                </Cols>
            </Pane>
        );
    };
};
