var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//Add task: the same form the supervisor fills in, with a person at it.
//
//THE BRANCH IS THE ARTIFACT. It is what comes back and what gets judged, so it
//is not an afterthought on this form — a task without one has nowhere to put
//what it makes. Nothing is given out by writing a task: it touches no machine.
//
//---- what this form IS, and it is not a design decision -------------------
//
//IT IS WHATEVER THE SUPERVISOR HAS TO PROVIDE, field for field. That is the
//whole rule, and everything below follows from it rather than from anybody's
//taste about forms.
//
//The supervisor is the other thing that writes tasks here, and it is held to
//`taskCreate` over the wire — see ../vms/provision/scripts/supervisor-skill.md
//and ./doors.js. So the person at the window is asked for exactly what a model
//is asked for, and the two cannot drift: a field that appears here and not
//there is a field the supervisor would be refused for omitting, and a field
//there and not here is a rule a person can walk past.
//
//    branch      the cut it delivers on
//    becauseOf   the FINISHED judgement that established the work is real
//    job         a script a person approved
//    contract    the rules a person approved
//    tag         which KIND of machine, never which machine
//    title       so the board is readable at a glance
//    brief       what the worker is actually told
//
//`becauseOf` IS THE ONE THIS FORM DID NOT HAVE, and it is the app's central
//rule: nothing becomes work until a judge has said it is real. The supervisor
//is refused outright without it — "you were handed a rumour" — and a person at
//the window was never asked at all. That asymmetry made the strictest rule in
//the app look like a quirk of the API.
//
//AND THE PROMPT SELECT IS GONE, which is the other half of the same argument. A
//supervisor does not fill a brief from the library: it WRITES one, quoting what
//the judge found and naming the file it pointed at, because the worker cannot
//see the judgement. That is why `do-the-work` names no prompt on purpose — see
//../library/chains.js: "the brief IS the prompt, written per task rather than
//kept in the library." A prompt picker here offered a shortcut the thing this
//form mirrors does not have.
//
//SO IS THE FOLDER FIELD. The supervisor cannot say where on a machine work
//happens — it does not see machines at all beyond what KIND there are — and a
//field only a person can reach is a way for two callers of one action to mean
//different things.
//
//---- one form, two kinds of work ------------------------------------------
//
//A JUDGE CANNOT BE GIVEN A TASK. The libraries are separated by `kind` and the
//two creating actions are different — `taskCreate` writes work, `judgementCreate`
//asks for a reading — so the first choice on the form is which of the two this
//is, and everything under it changes with it.
//
//WHICH IS ALSO THE SUPERVISOR'S SHAPE. Its flow starts with a judgement of a
//claim and only reaches a task if that judgement comes back true; both halves
//are things it commissions, from two libraries it may not mix.
//
//A JUDGEMENT IS ASKED A QUESTION, NOT GIVEN A BRIEF, and it needs no
//`becauseOf` — it is the thing that establishes what is real, so requiring one
//would be asking what established the thing that establishes things.
//
//THE FORM GETS THE WIDTH AND THE PREVIEW SITS NARROW BESIDE IT. The preview is
//the point — a brief is read once, by something that cannot ask a question.
//---------------------------------------------------------------------------

//THE TWO KINDS, AND THE WORDS EACH USES. Keyed by the `kind` value the
//libraries are keyed by on the server, so this file invents no third spelling —
//the same rule ../library/chains.js keeps for the same reason.
var WORK = {
    task: {
        who: 'a worker',
        job: 'Which job runs it',
        //NOT "none — set the machine up and leave it running for me", which is
        //what this offered and then refused. That is a person-only convenience
        //and the supervisor has no such option: it is told to read `jobs` and
        //pick one a person approved. Offering it here put a refusal after the
        //press, which is the one fault this pane's whole design is against.
        none: 'pick the job that runs it',
        words: 'The brief — what the worker is actually told',
        hint: 'Write it as instructions to somebody who cannot ask you a question.'
    },
    judge: {
        who: 'a judge',
        job: 'Which job reads it',
        none: 'pick the judging chain that reads this',
        words: 'The question — what it is being asked to find out',
        hint: 'Say what would settle it. A judgement answers CLAIM: true, false or unclear.'
    }
};

module.exports = function add(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, CardTitle, CardSub, Badge, Button,
        Skeleton, Empty, Note, Mono, Form, Field, Notice, Code
    } = theme;

    return function AddTask() {
        //EVERYTHING THIS FORM MAY OFFER, ASKED FOR TOGETHER. Each of these
        //narrows the list to what could actually be chosen, which is the whole
        //argument of the pane.
        //
        //THE LIBRARIES ARE ASKED FOR WHOLE AND SPLIT HERE. Every row carries its
        //own `kind`, so one read covers both halves of the form and switching
        //between them costs nothing — see ../library/chain.js, which says a
        //plain listing never hides half of what exists.
        var board = okc.use('branchBoard', {}, 0);
        var jobs = okc.use('jobs', {}, 0);
        var contracts = okc.use('contracts', {}, 0);
        var machines = okc.use('vmList', {}, 0);
        var judging = okc.use('judging', {}, 0);
        //THE LINES, BECAUSE A CUT IS MADE FROM ONE. Picking a line here means
        //"cut a new branch from it and put the work on that" — the step the
        //supervisor takes before it writes a task at all, and `taskCreate` does
        //both in one call for exactly this reason. See ../queue/doors.js.
        var lineRows = okc.use('lines', {}, 0);

        //WHAT IS TYPED IS KEPT. Writing a brief is not something somebody
        //finishes in one sitting, and this window restarts constantly — see
        //../remember, and the rule about what may be kept there. A brief is
        //what a worker is told, which is already going to a machine; it is not
        //a secret.
        var [draft, setDraft] = remember.use('addtask', 'draft', {});
        var [said, setSaid] = useState(null);
        var [busy, setBusy] = useState(false);

        var set = function (k, v) {
            setDraft(function (was) {
                var next = Object.assign({}, was);
                next[k] = v;
                return next;
            });
        };
        var val = function (k) { return draft && draft[k] != null ? draft[k] : ''; };

        //A DRAFT WRITTEN BY THE ISSUES PANE SAYS `brief`; THIS FORM READS
        //`words`. Nothing mapped one to the other, so "Write a task from it"
        //carried the title and lost the whole brief -- the quotation, the URL,
        //the sentence saying a person decided. Moved across once, here, and the
        //old key dropped so it cannot come back on the next save and overwrite
        //what somebody has since typed.
        useEffect(function () {
            if (!draft || draft.brief == null || draft.words) return;
            setDraft(function (was) {
                var next = Object.assign({}, was, { words: was.brief });
                delete next.brief;
                return next;
            });
        }, [draft && draft.brief]);

        //AN ERROR BEFORE THE SPINNER, or a call that failed is indistinguishable
        //from one still on its way and the pane sits on a skeleton for ever.
        //`okc.use` hands back both; reading only `state` throws half of it away.
        if (!board.state && board.error) return <Pane><Note kind="bad">{board.error}</Note></Pane>;
        if (!board.state) return <Pane><Skeleton rows={4} /></Pane>;

        //WORKER UNLESS SOMEBODY SAYS OTHERWISE, because it is the ordinary case
        //— but it is a CHOICE on the form rather than an assumption, since the
        //two go to different actions and are held to different libraries.
        var kind = val('kind') === 'judge' ? 'judge' : 'task';
        var words = WORK[kind];

        //---- EVERY BRANCH CUT, AND WHAT IS TRUE OF EACH -------------------
        //
        //A CUT, WHICH IS NOT THE SAME AS A BRANCH. A workspace holds branches
        //cut here with a reason, the repositories' own defaults, and whatever
        //somebody made by hand. `cut` is the record of the act, written when
        //branchCreate made it — so `master`, `version2` and a pull request
        //fetched from somebody else are not offered, and that has not changed.
        //
        //---- WHAT DID CHANGE: A LINE IS STILL A CUT -----------------------
        //
        //THIS READ `b.cut && !b.protected`, ported from the app being ported
        //from, where the same line sits in ui/tasks.js. It is not drift and it
        //was not wrong there. It is narrower than the rule, and the difference
        //had become the whole list: four lines had landed weeks earlier without
        //anything retiring them, and every one had eaten a branch cut on its way
        //past. This dropdown was down to two options out of eleven branches and
        //read as broken.
        //
        //AND THE FORM WAS NEVER WHAT PREVENTED ANYTHING. The old app says so
        //itself, in the comment right below the line this copied: "LINES ARE NOT
        //OFFERED HERE AT ALL, and the read-only machinery behind them stays
        //anyway. A machine set up on a line is refused its push by the host's
        //hook and told so by a pre-push hook in the guest — that is true however
        //the machine got there, and IT IS NOT THIS FORM'S BUSINESS to be the
        //only thing preventing it."
        //
        //Both halves are here and both were checked: `taskCreate` accepts any
        //branch that exists — proven on `master`, on a line and on an uncut
        //branch, all three written and then removed — and ../../repositories/
        //gitserve refuses the push. So hiding lines here bought nothing except a
        //shorter list.
        //
        //SO EVERY CUT IS OFFERED, WITH WHAT IT IS SAID ON IT. Which is what the
        //Branches Cut pane does, and it is the pane that owns the word: it lists
        //all of them and puts a state on each rather than deciding for you.
        //Choosing a line is a choice somebody can now make on purpose, and the
        //label is what makes it a choice rather than a trap.
        var claimOn = function (b) {
            if (b.heldBy) return b.heldRunning ? 'a machine is working on it' : 'held by ' + b.heldBy;
            if ((b.tasks || []).length) return (b.tasks || []).length + ' task(s) already on it';
            if (b.protected) return 'a line — the push is refused, so merge into it instead';
            if (b.orphaned) return 'carries work nobody claims';
            if (b.spare) return 'spare';
            return null;
        };

        var cuts = (board.state.branches || [])
            .filter(function (b) { return b.cut; })
            .map(function (b) {
                //`·` AND NOT `—`, because some of what `claimOn` says has a dash
                //of its own in it and "brads/testing2 — a line — the push is
                //refused" reads as three things rather than two.
                var says = claimOn(b);
                return { value: 'cut:' + b.name, label: b.name + (says ? ' · ' + says : '') };
            });

        //---- AND THE LINES, WHICH MEAN "CUT A NEW ONE FROM HERE" ----------
        //
        //THE SUPERVISOR'S FIRST TWO CALLS ARE ONE DECISION — `branchCreate` then
        //`taskCreate` — and nobody cuts a branch and then wonders what to put on
        //it. So a line is offered here and choosing one asks for the two things
        //`branchCreate` wants: what the branch is called, and what it is for.
        //
        //THE COMPOSING IS `taskCreate`'s, NOT THIS FORM'S, and that is the whole
        //point. A pane that called branchCreate and then taskCreate would be a
        //capability a person has and a model does not — which is the fault this
        //app has just been bitten by twice. `task.cutFrom` and `task.reason` go
        //down the same door the supervisor uses, and its refusals are the ones
        //that come back.
        //
        //PREFIXED, BECAUSE A LINE AND A CUT CAN SHARE A NAME. They did this
        //morning: `fix/escape-note-id-in-data-id` was a branch cut AND the line
        //made out of it, and a bare value would have made "work on the existing
        //branch" and "cut a new one from that line" the same string.
        //
        //NOT FOR A JUDGE. A judgement READS a cut; cutting a fresh branch to
        //read it would be asking a judge to look at nothing.
        var lineOpts = kind === 'judge' ? [] : ((lineRows.state && lineRows.state.lines) || [])
            .map(function (g) {
                return {
                    value: 'line:' + g.name,
                    label: g.name + ' · cut a new branch from this line'
                        + (g.ends === 'landed' ? ' (its own change has landed)' : '')
                };
            });

        //WHAT WAS PICKED, AND WHICH KIND IT IS. A value with no prefix is a cut
        //somebody chose before this field learned about lines — treated as one
        //rather than thrown away, so a draft left open across the change still
        //means what it meant.
        var picked = String(val('branch') || '');
        var fromLine = picked.indexOf('line:') === 0 ? picked.slice(5) : null;
        var onCut = picked.indexOf('cut:') === 0 ? picked.slice(4)
            : (fromLine ? null : (picked || null));

        var ofKind = function (rows) {
            return (rows || []).filter(function (r) { return String(r.kind || 'task') === kind; });
        };

        var jobList = ofKind((jobs.state && jobs.state.jobs) || []);
        var contractList = ofKind((contracts.state && contracts.state.contracts) || [])
            .filter(function (c) { return c.approved; });

        //---- WHAT MAY BE NAMED AS THE REASON THIS IS WORK -------------------
        //
        //ONLY THE ONES THAT HAVE FINISHED READING. ./doors.js refuses anything
        //else in as many words — a judgement still running "has established
        //nothing" — so offering one here would be a refusal moved from before
        //the press to after it, which is the fault this pane's whole design is
        //against.
        var reasons = ((judging.state && (judging.state.judgements || judging.state.judging)) || [])
            .filter(function (j) { return j.state === 'done'; });

        //THE TAGS THAT EXIST ARE THE TAGS ON THE MACHINES, with who carries
        //each — so the dropdown says what choosing one would MEAN rather than
        //offering a bare word.
        var byTag = {};
        ((machines.state && machines.state.vms) || []).forEach(function (v) {
            (v.tags || []).forEach(function (t) { (byTag[t] = byTag[t] || []).push(v.name); });
        });
        var tags = Object.keys(byTag).sort();

        //---- WHICH KIND OF MACHINE FOLLOWS FROM WHO DOES IT ----------------
        //
        //THIS WAS ASKED TWICE AND THE TWO COULD DISAGREE. "Who does it" already
        //says worker or judge, and then a second dropdown asked which kind of
        //machine — free to contradict the first. J24 was written that way: a
        //judging job, on a judge-tagged machine, recorded as done BY A WORKER,
        //because the form allowed every combination of the two.
        //
        //A judge reads somebody else's work and must never be the sign-in that
        //produced it. That rule is the whole reason the roles exist, and a form
        //that lets you file a judgement as a worker's is a form that can write
        //down the one thing the rule forbids.
        //
        //DERIVED, AND SAID RATHER THAN ASKED. It is still visible — the line
        //below states which kind will be wanted and why — because a machine
        //being chosen invisibly is how somebody ends up not knowing why their
        //task is waiting.
        //
        //A WORKER TAKES ANY FREE MACHINE unless machines are actually grouped
        //for work, because most workspaces tag nothing and "any free" is the
        //honest answer there.
        var wantTag = kind === 'judge' ? 'judge' : (byTag.worker ? 'worker' : '');

        function stop(text) { setSaid({ bad: true, text: text }); }

        function write(andQueue) {
            if (!val('branch')) {
                return stop('It needs somewhere to go — a branch cut, or a line to cut a new one from. '
                    + 'That branch is what comes back and what gets judged.');
            }
            //WHAT `branchCreate` ASKS FOR, ASKED HERE, so the refusal arrives
            //before the press rather than after it. The door refuses both of
            //these too — that is the backstop, not the substitute.
            if (fromLine && !String(val('newBranch') || '').trim()) {
                return stop('Name the branch cut. "Cut it from ' + fromLine + '" says where it starts, not what it is.');
            }
            if (fromLine && !String(val('newWhy') || '').trim()) {
                return stop('Say what it is for. A branch with no reason on it is one nobody can account for later.');
            }
            if (!val('job')) {
                return stop(kind === 'judge'
                    ? 'Say which judging chain reads it. A judgement without a chain is an opinion with nothing behind it.'
                    : 'Say which job runs it. The supervisor may only use a job a person approved, and so may you.');
            }
            if (!val('words')) {
                return stop(kind === 'judge'
                    ? 'Say what it is being asked to find out. A judge cannot see the issue unless you hand it over.'
                    : 'It needs a brief. That is what the worker is actually told, and it cannot ask you a question.');
            }

            setBusy(true);
            var done = function (r, queued) {
                setSaid({ text: (queued ? (r.note || 'Queued.') : (r.note || 'Written.')) });
                setBusy(false);
            };
            var failed = function (e) { stop(e.message); setBusy(false); };

            if (kind === 'judge') {
                //A BRANCH CUT IS THE ONLY SUBJECT THIS FORM OFFERS. The other
                //two — a PR cut, and a pull request that arrived — are asked for
                //where they are read, on Repositories and on the Judge tab, and
                //each carries a gate this form does not.
                return okc.call('judgementCreate', {
                    kind: 'branch',
                    //A JUDGE READS AN EXISTING CUT. Lines are not offered above
                    //for a judgement, so this is always one.
                    branch: onCut,
                    job: val('job'),
                    question: val('words'),
                    tag: wantTag || undefined
                }).then(function (r) {
                    setDraft({ kind: 'judge' });
                    if (!andQueue || !r.ref) return done(r, false);
                    return okc.call('judgementQueue', { ref: r.ref }).then(
                        function (q) { done(q, true); },
                        function (e) { stop('Asked for, but not queued: ' + e.message); setBusy(false); }
                    );
                }, failed);
            }

            if (!val('title')) { setBusy(false); return stop('It needs a title, so the board is readable at a glance.'); }
            if (!val('becauseOf')) {
                setBusy(false);
                return stop('Say which judgement established this work is real. The supervisor is refused without '
                    + 'one — read what a judgement handed back, and write the task from that.');
            }

            okc.call('taskCreate', {
                becauseOf: val('becauseOf'),
                task: {
                    title: val('title'),
                    //EITHER THE CUT THAT EXISTS, OR THE ONE ABOUT TO BE MADE.
                    //`cutFrom` and `reason` are what turn the second into the
                    //first, and ../doors.js does that — not this form. See the
                    //block where `lineOpts` is built.
                    branch: fromLine ? String(val('newBranch')).trim() : onCut,
                    cutFrom: fromLine || undefined,
                    reason: fromLine ? String(val('newWhy')).trim() : undefined,
                    brief: val('words'),
                    job: val('job'),
                    contractId: val('contractId') || undefined,
                    tag: wantTag || undefined,
                    //WHICH ISSUE THIS IS FOR, if it came from one. Carried as
                    //data so the branch cut and the pull request can name it;
                    //see writeTaskFrom in ../repositories/issues/issues.js.
                    issue: val('issue') || undefined
                }
            }).then(function (r) {
                setDraft({});
                if (!andQueue || !r.id) return done(r, false);
                return okc.call('taskQueue', { id: r.id }).then(
                    function (q) { done(q, true); },
                    function (e) { stop('Written, but not queued: ' + e.message); setBusy(false); }
                );
            }, failed);
        }

        var chosenJob = jobList.filter(function (j) { return j.id == val('job'); })[0];
        var chosenContract = contractList.filter(function (c) { return c.id == val('contractId'); })[0];
        var chosenReason = reasons.filter(function (j) { return j.ref == val('becauseOf'); })[0];

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Cols>
                    <Col narrow>
                        <h2>It will carry</h2>
                        {/* THE PREVIEW IS THE POINT. A brief is read once, by
                            something that cannot ask a question, so seeing the
                            words in the shape they arrive in is the only check
                            there is before a machine spends two minutes on
                            them. */}
                        <Panel>
                            <CardTitle>
                                {kind === 'judge'
                                    ? (val('branch') ? <span>{'a reading of '}<Mono>{val('branch')}</Mono></span> : <span className="muted">nothing to read yet</span>)
                                    : (val('title') || <span className="muted">no title yet</span>)}
                            </CardTitle>
                            <CardSub>
                                {/* THE BRANCH, NOT THE VALUE OF THE FIELD. The
                                    options are prefixed `cut:` and `line:` so a
                                    line and a cut sharing a name cannot collide,
                                    and this drew that prefix — "delivers on
                                    line:default", which is an internal spelling
                                    on the one panel that exists to say what the
                                    worker actually gets. */}
                                {fromLine
                                    ? (String(val('newBranch') || '').trim()
                                        ? <span>{'delivers on '}<Mono>{String(val('newBranch')).trim()}</Mono>
                                            {', cut from '}<Mono>{fromLine}</Mono></span>
                                        : <span className="muted">{'cut from '}<Mono>{fromLine}</Mono>{' — name it above'}</span>)
                                    : onCut
                                        ? <span>{kind === 'judge' ? 'reads ' : 'delivers on '}<Mono>{onCut}</Mono></span>
                                        : <span className="muted">{kind === 'judge'
                                            ? 'no branch yet — there is nothing for it to read'
                                            : 'no branch yet — there is nowhere for it to deliver'}</span>}
                                {wantTag ? <span>{' · '}<Badge kind="muted">{wantTag}</Badge></span> : null}
                                {/* THE ISSUE IT IS FOR, on the card that says what
                                    the worker actually gets -- because the pull
                                    request will say "Closes" from this, and that
                                    is worth seeing before the task is written. */}
                                {val('issue') && val('issue').number
                                    ? <span>{' · for '}<Mono>{val('issue').on + '#' + val('issue').number}</Mono></span>
                                    : null}
                            </CardSub>

                            {val('words')
                                ? <Code text={val('words')} tall />
                                : <Empty>{kind === 'judge'
                                    ? 'no question yet — a judge cannot see the claim unless you hand it over'
                                    : 'the brief is empty — that is what the worker is actually told'}</Empty>}
                        </Panel>

                        <Panel>
                            <CardTitle>Under</CardTitle>
                            {/* WHO ALLOWED THIS, on the same screen it is being
                                written on. A job and a contract are things a
                                person approved, and a task carries a COPY of the
                                contract's rules rather than a reference — so
                                what is chosen here is what the worker is held
                                to, not what the contract says next week. */}
                            <CardSub>
                                {chosenJob
                                    ? <span>{'the job '}<Mono>{chosenJob.name}</Mono>{chosenJob.approved ? '' : ' — NOT APPROVED'}</span>
                                    : <span className="muted">no job chosen — nothing can run without one</span>}
                            </CardSub>
                            {kind === 'judge' ? null : (
                                <CardSub>
                                    {chosenContract
                                        ? <span>{'the contract '}<Mono>{chosenContract.name}</Mono></span>
                                        : <span className="muted">no contract — the worker gets no rules</span>}
                                </CardSub>
                            )}
                            {chosenContract && chosenContract.text
                                ? <Code text={chosenContract.text} />
                                : null}
                        </Panel>

                        {/* WHY THIS IS WORK AT ALL, kept beside what it will
                            carry rather than buried in the form. Six weeks
                            later "why was this done" is answerable by reading
                            the judgement it came from. */}
                        {kind === 'judge' ? null : (
                            <Panel>
                                <CardTitle>Because of</CardTitle>
                                <CardSub>
                                    {chosenReason
                                        ? <span><Mono>{chosenReason.ref}</Mono>{' — ' + (chosenReason.title || chosenReason.question || 'a finished judgement')}</span>
                                        : <span className="muted">nothing yet — a task is not written from a rumour</span>}
                                </CardSub>
                            </Panel>
                        )}
                    </Col>

                    <Col wide>
                        <h2>The task</h2>
                        <Panel>
                            {/* NOTHING IS GIVEN OUT BY WRITING ONE, said before
                                the form rather than discovered after it. */}
                            <Note>
                                This is what the supervisor is asked for, field for field — so a person at the
                                window and a model over the wire write the same thing under the same rules.
                                Nothing is given out yet: writing one touches no machine.
                            </Note>
                            <Form>
                                <Field f={{
                                    name: 'kind', label: 'Who does it',
                                    hint: 'the two libraries do not mix — a judge cannot be given a task, and a working job cannot read one',
                                    options: [
                                        { value: 'task', label: 'a worker — it writes the change' },
                                        { value: 'judge', label: 'a judge — it reads what is there and answers a question' }
                                    ]
                                }} value={kind} onChange={function (v) {
                                    //THE CHAIN GOES WITH THE KIND. A job picked
                                    //from the working library is refused by
                                    //`judgementCreate` and the other way round,
                                    //so keeping it across the switch would offer
                                    //a choice that cannot be pressed.
                                    setDraft(function (was) {
                                        return Object.assign({}, was, { kind: v, job: '', contractId: '' });
                                    });
                                }} />

                                <Field f={{
                                    name: 'branch', label: 'Work in this Branch Cut', needed: true,
                                    hint: 'a cut is a branch made here with a reason — a default branch and a pull request '
                                        + 'fetched from somebody else are not cuts and are not offered. A line is: work is '
                                        + 'normally merged into one rather than done on one, and its push is refused, so it '
                                        + 'says so beside the name rather than being hidden',
                                    //ALREADY {value, label} — see where `cuts` is
                                    //built. Each carries what is true of it, so
                                    //picking a line is a choice rather than a
                                    //trap.
                                    options: [{
                                        value: '', label: (cuts.length || lineOpts.length)
                                            ? 'pick where the work goes'
                                            : 'there are no cuts or lines yet — make one on Repositories → Branches'
                                    }].concat(cuts).concat(lineOpts)
                                }} value={val('branch')} onChange={function (v) { set('branch', v); }} />

                                {/* THE TWO THINGS `branchCreate` ASKS FOR, and
                                    they appear only when a line was chosen —
                                    because that is the only time there is a
                                    branch to make. Both go to `taskCreate` as
                                    `task.cutFrom` and `task.reason`; the cutting
                                    is that door's, not this form's. */}
                                {fromLine ? (
                                    <Field f={{
                                        name: 'newBranch', label: 'Name the branch cut', needed: true,
                                        placeholder: 'fix/the-thing',
                                        hint: 'it is cut from "' + fromLine + '" across every repository that line names'
                                    }} value={val('newBranch')} onChange={function (v) { set('newBranch', v); }} />
                                ) : null}

                                {fromLine ? (
                                    <Field f={{
                                        name: 'newWhy', label: 'Why it exists', needed: true,
                                        placeholder: 'what this branch is for',
                                        hint: 'a branch with no reason on it is one nobody can account for later — branchCreate asks for this too'
                                    }} value={val('newWhy')} onChange={function (v) { set('newWhy', v); }} />
                                ) : null}

                                {kind === 'judge' ? null : (
                                    <Field f={{
                                        name: 'becauseOf', label: 'Because of — the judgement that established this is real', needed: true,
                                        hint: 'only judgements that have finished reading are offered. The supervisor is refused without one, and so is this',
                                        options: [{
                                            value: '', label: reasons.length
                                                ? 'pick the judgement this work comes from'
                                                : 'nothing has finished reading yet — ask for a judgement first'
                                        }].concat(reasons.map(function (j) {
                                            return {
                                                value: j.ref,
                                                label: j.ref + ' — ' + (j.title || j.question || 'a judgement')
                                                    + (j.verdict ? ' [' + j.verdict + ']' : '')
                                            };
                                        }))
                                    }} value={val('becauseOf')} onChange={function (v) { set('becauseOf', v); }} />
                                )}

                                <Field f={{
                                    name: 'job', label: words.job, needed: true,
                                    hint: 'you may only use a job a person approved — the same rule the supervisor is held to',
                                    options: [{ value: '', label: jobList.length ? words.none : 'nothing approved in this library yet — see the Library' }]
                                        .concat(jobList.map(function (x) {
                                            return { value: x.id, label: x.name + (x.runnable ? '' : ' — ' + (x.whyNot || 'not runnable')) };
                                        }))
                                }} value={val('job')} onChange={function (v) { set('job', v); }} />

                                {kind === 'judge' ? null : (
                                    <Field f={{
                                        name: 'contractId', label: 'Under which contract',
                                        hint: 'only approved contracts are offered — an unapproved one cannot govern a run',
                                        options: [{ value: '', label: 'none — the worker gets no rules' }]
                                            .concat(contractList.map(function (c) { return { value: c.id, label: c.name }; }))
                                    }} value={val('contractId')} onChange={function (v) { set('contractId', v); }} />
                                )}

                                {/* SAID, NOT ASKED — see `wantTag` above. And
                                    said in the same place the question used to
                                    be, because "which machine" is a thing
                                    somebody looks for here. */}
                                <Note kind={wantTag && !byTag[wantTag] ? 'warn' : undefined}>
                                    {wantTag
                                        ? (byTag[wantTag]
                                            ? 'It runs on a machine tagged "' + wantTag + '" — '
                                                + byTag[wantTag].join(', ') + '. The queue picks which one.'
                                            : 'It wants a machine tagged "' + wantTag + '" and none carries that tag, '
                                                + 'so it will wait rather than run somewhere else. Tag one on Runners.')
                                        : (tags.length
                                            ? 'It runs on any free machine. Tag machines "worker" on Runners to keep work to a group of them.'
                                            : 'It runs on any free machine. No machine is tagged yet.')}
                                </Note>

                                {kind === 'judge' ? null : (
                                    <Field f={{ name: 'title', label: 'Title', needed: true, placeholder: 'Short enough to read in a list' }}
                                        value={val('title')} onChange={function (v) { set('title', v); }} />
                                )}

                                <Field f={{
                                    name: 'words', label: words.words, needed: true,
                                    multiline: true, rows: 8,
                                    placeholder: words.hint
                                }} value={val('words')} onChange={function (v) { set('words', v); }} />
                            </Form>

                            <div className="row">
                                <Button kind="ok" disabled={busy} onClick={function () { write(false); }}>
                                    {busy ? 'writing…' : (kind === 'judge' ? 'Ask for it' : 'Write it')}
                                </Button>
                                {/* WRITING AND QUEUEING ARE TWO ACTS. A task
                                    written is a task nobody has spent a machine
                                    on; queueing is the moment that changes, so
                                    it is its own press. */}
                                <Button disabled={busy} onClick={function () { write(true); }}>
                                    {kind === 'judge' ? 'Ask for it and queue it' : 'Write it and queue it'}
                                </Button>
                                <Button disabled={busy} onClick={function () { setDraft({ kind: kind }); }}>Clear</Button>
                            </div>
                        </Panel>
                    </Col>
                </Cols>
            </Pane>
        );
    };
};
