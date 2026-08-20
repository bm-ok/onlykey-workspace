var React = require('react');
var { useState, useEffect } = React;
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//Add task: writing down what a worker is told, and the branch it delivers on.
//
//THE BRANCH IS THE ARTIFACT. It is what comes back and what gets judged, so it
//is not an afterthought on this form — a task without one has nowhere to put
//what it makes. Nothing is given out by writing a task: it touches no machine.
//
//THE FORM GETS THE WIDTH AND THE PREVIEW SITS NARROW BESIDE IT, which is the
//other way round from how this was first built. The form is six dropdowns and a
//brief eight rows tall; squeezed into 260px its labels truncate to
//"none — set the machine up and leav..." — an option nobody can read is an
//option nobody chooses. The preview is a summary and reads fine narrow.
//
//A PANE RATHER THAN A DIALOG, and that is the shape the old window arrived at.
//A dialog is for one decision; this is six of them that fill each other in, and
//a preview beside it saying what the worker will actually receive. The preview
//is the point — a brief is read once, by something that cannot ask a question.
//
//WHAT MAY BE OFFERED IS NARROWER THAN WHAT EXISTS, in three places, and each one
//moves a refusal from after the press to before it:
//
//  BRANCH CUTS, NOT BRANCHES. A workspace holds branches cut here with a
//  reason, the repositories' own defaults, and whatever somebody made by hand.
//  Offering all three put `master` and `version2` on a form about work. And a
//  cut that has since been made a line is a LINE — it keeps its cut record
//  because that records an act that happened, not what the branch is now.
//
//  WORK PROMPTS AND WORK JOBS ONLY. A judge cannot be given a task; the
//  libraries are apart and offering one here would be a refusal after the fact.
//
//  APPROVED CONTRACTS ONLY, because an unapproved one cannot govern a run.
//
//AND THE TAGS COME FROM THE MACHINES THEMSELVES, so there is no second list to
//keep in step and a tag stops existing when the last machine carrying it does.
//---------------------------------------------------------------------------

module.exports = function add(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, CardTitle, CardSub, Badge, Button,
        Skeleton, Empty, Note, Mono, Form, Field, Notice, Code
    } = theme;

    return function AddTask() {
        //EVERYTHING THIS FORM MAY OFFER, ASKED FOR TOGETHER. Each of these
        //narrows the list to what could actually be chosen, which is the whole
        //argument of the pane.
        var board = useAsk(okc, 'branchBoard', {}, 0);
        var prompts = useAsk(okc, 'prompts', { kind: 'task' }, 0);
        var jobs = useAsk(okc, 'jobs', { kind: 'task' }, 0);
        var contracts = useAsk(okc, 'contracts', { kind: 'task' }, 0);
        var machines = useAsk(okc, 'vmList', {}, 0);

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

        //PICKING A PROMPT FILLS THE BRIEF, and the contract with it. That is
        //what a prompt IS — text plus the rules it is given under — and making
        //somebody choose both separately is how the two drift apart.
        useEffect(function () {
            var id = val('promptId');
            if (!id || !prompts.state) return;
            var p = (prompts.state.prompts || []).filter(function (x) { return x.id == id; })[0];
            if (!p) return;
            setDraft(function (was) {
                var next = Object.assign({}, was);
                if (!next.brief || next.filledFrom !== id) {
                    next.brief = p.text || next.brief || '';
                    if (p.contractId) next.contractId = p.contractId;
                    next.filledFrom = id;
                }
                return next;
            });
        }, [draft && draft.promptId, prompts.state]);

        if (!board.state) return <Pane><Skeleton rows={4} /></Pane>;

        //A CUT, AND NOT A LINE. `protected` wins over `cut`: making a branch a
        //line is exactly the act that says work does not go on it directly.
        var cuts = (board.state.branches || [])
            .filter(function (b) { return b.cut && !b.protected; })
            .map(function (b) { return b.name; });

        var promptList = (prompts.state && prompts.state.prompts) || [];
        var jobList = (jobs.state && jobs.state.jobs) || [];
        var contractList = ((contracts.state && contracts.state.contracts) || [])
            .filter(function (c) { return c.approved; });

        //THE TAGS THAT EXIST ARE THE TAGS ON THE MACHINES, with who carries
        //each — so the dropdown says what choosing one would MEAN rather than
        //offering a bare word.
        var byTag = {};
        ((machines.state && machines.state.vms) || []).forEach(function (v) {
            (v.tags || []).forEach(function (t) { (byTag[t] = byTag[t] || []).push(v.name); });
        });
        var tags = Object.keys(byTag).sort();

        function write(andQueue) {
            var t = {
                title: val('title'),
                branch: val('branch'),
                brief: val('brief'),
                promptId: val('promptId') || undefined,
                job: val('job') || undefined,
                contractId: val('contractId') || undefined,
                folder: val('folder') || undefined,
                tag: val('tag') || undefined
            };
            if (!t.title) { setSaid({ bad: true, text: 'It needs a title — short enough to read in a list.' }); return; }
            if (!t.branch) { setSaid({ bad: true, text: 'It needs a branch cut. That branch is what comes back and what gets judged.' }); return; }
            if (!t.brief) { setSaid({ bad: true, text: 'It needs a brief. That is what the worker is actually told.' }); return; }

            setBusy(true);
            okc.call('taskCreate', { task: t }).then(function (r) {
                setSaid({ text: r.note || ('Written' + (r.number ? ' as #' + r.number : '') + '.') });
                setDraft({});
                setBusy(false);
                if (andQueue && r.id) {
                    return okc.call('taskQueue', { id: r.id }).then(
                        function (q) { setSaid({ text: q.note || 'Queued.' }); },
                        function (e) { setSaid({ bad: true, text: 'Written, but not queued: ' + e.message }); }
                    );
                }
            }, function (e) {
                setSaid({ bad: true, text: e.message });
                setBusy(false);
            });
        }

        var chosenJob = jobList.filter(function (j) { return j.id == val('job'); })[0];
        var chosenContract = contractList.filter(function (c) { return c.id == val('contractId'); })[0];

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
                            <CardTitle>{val('title') || <span className="muted">no title yet</span>}</CardTitle>
                            <CardSub>
                                {val('branch')
                                    ? <span>{'delivers on '}<Mono>{val('branch')}</Mono></span>
                                    : <span className="muted">no branch yet — there is nowhere for it to deliver</span>}
                                {val('tag') ? <span>{' · '}<Badge kind="muted">{val('tag')}</Badge></span> : null}
                            </CardSub>

                            {val('brief')
                                ? <Code text={val('brief')} tall />
                                : <Empty>the brief is empty — that is what the worker is actually told</Empty>}
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
                                    : <span className="muted">no job — the machine is set up and left running for you</span>}
                            </CardSub>
                            <CardSub>
                                {chosenContract
                                    ? <span>{'the contract '}<Mono>{chosenContract.name}</Mono></span>
                                    : <span className="muted">no contract — the worker gets no rules</span>}
                            </CardSub>
                            {chosenContract && chosenContract.text
                                ? <Code text={chosenContract.text} />
                                : null}
                        </Panel>
                    </Col>

                    <Col wide>
                        <h2>The task</h2>
                        <Panel>
                            {/* NOTHING IS GIVEN OUT BY WRITING ONE, said before
                                the form rather than discovered after it. */}
                            <Note>
                                A task is what a worker is told, and the branch it delivers on. That branch
                                is the artifact: it is what comes back, and what gets judged. Nothing is
                                given out yet — writing a task touches no machine.
                            </Note>
                            <Form>
                                <Field f={{ name: 'title', label: 'Title', placeholder: 'Short enough to read in a list' }}
                                    value={val('title')} onChange={function (v) { set('title', v); }} />

                                <Field f={{
                                    name: 'branch', label: 'Work in this Branch Cut',
                                    hint: 'a cut is a branch made here with a reason. A line is not offered: making one is what says work does not go on it directly',
                                    options: [{ value: '', label: cuts.length ? 'pick the cut this work belongs to' : 'there are no cuts yet — make one on Repositories → Branches Cut' }]
                                        .concat(cuts.map(function (b) { return { value: b, label: b }; }))
                                }} value={val('branch')} onChange={function (v) { set('branch', v); }} />

                                <Field f={{
                                    name: 'promptId', label: 'Fill the brief from a prompt (optional)',
                                    hint: 'a prompt brings its contract with it',
                                    options: [{ value: '', label: 'none — write it below' }]
                                        .concat(promptList.map(function (x) {
                                            return { value: x.id, label: x.name + (x.approved ? '' : ' — not approved') };
                                        }))
                                }} value={val('promptId')} onChange={function (v) { set('promptId', v); }} />

                                <Field f={{
                                    name: 'brief', label: 'The brief — what the worker is actually told',
                                    multiline: true, rows: 8,
                                    placeholder: 'Write it as instructions to somebody who cannot ask you a question.'
                                }} value={val('brief')} onChange={function (v) { set('brief', v); }} />

                                <Field f={{
                                    name: 'job', label: 'Which job runs it (optional)',
                                    options: [{ value: '', label: 'none — set the machine up and leave it running for me' }]
                                        .concat(jobList.map(function (x) {
                                            return { value: x.id, label: x.name + (x.runnable ? '' : ' — ' + (x.whyNot || 'not runnable')) };
                                        }))
                                }} value={val('job')} onChange={function (v) { set('job', v); }} />

                                <Field f={{
                                    name: 'contractId', label: 'Under which contract (optional)',
                                    hint: 'only approved contracts are offered — an unapproved one cannot govern a run',
                                    options: [{ value: '', label: 'none — the worker gets no rules' }]
                                        .concat(contractList.map(function (c) { return { value: c.id, label: c.name }; }))
                                }} value={val('contractId')} onChange={function (v) { set('contractId', v); }} />

                                {/* SHOWN DISABLED RATHER THAN HIDDEN when no
                                    machine is tagged: a field that appears the
                                    day somebody tags a machine is a feature
                                    nobody knew they had. */}
                                <Field f={{
                                    name: 'tag',
                                    label: tags.length ? 'On which kind of machine (optional)' : 'On which kind of machine — no machine is tagged yet',
                                    disabled: !tags.length,
                                    options: [{ value: '', label: tags.length ? 'any free machine' : 'any free machine — tag one with vmTags to group them' }]
                                        .concat(tags.map(function (t) { return { value: t, label: t + ' — ' + byTag[t].join(', ') }; }))
                                }} value={val('tag')} onChange={function (v) { set('tag', v); }} />

                                <Field f={{ name: 'folder', label: 'Folder on the machine (optional)', placeholder: 'defaults to its workspace' }}
                                    value={val('folder')} onChange={function (v) { set('folder', v); }} />
                            </Form>

                            <div className="row">
                                <Button kind="ok" disabled={busy} onClick={function () { write(false); }}>
                                    {busy ? 'writing…' : 'Write it'}
                                </Button>
                                {/* WRITING AND QUEUEING ARE TWO ACTS. A task
                                    written is a task nobody has spent a machine
                                    on; queueing is the moment that changes, so
                                    it is its own press. */}
                                <Button disabled={busy} onClick={function () { write(true); }}>Write it and queue it</Button>
                                <Button disabled={busy} onClick={function () { setDraft({}); }}>Clear</Button>
                            </div>
                        </Panel>
                    </Col>
                </Cols>
            </Pane>
        );
    };
};
