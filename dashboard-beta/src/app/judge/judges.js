var React = require('react');

//---------------------------------------------------------------------------
//the Judges: what may read work, and what each of them was told.
//
//A JUDGE IS THE WHOLE CHAIN — this job, giving these words, under these rules —
//and every rung is read and approved by a person before anything runs. That is
//the sentence this pane exists to make true rather than claim: the three
//libraries are shown side by side, and then the chains they assemble into, with
//the approval on every rung visible at once.
//
//WHICH IS WHY "can judge" IS A PROPERTY OF THE CHAIN AND NOT OF THE JOB. A job
//approved by a person, pointing at a prompt approved by a person, under a
//contract approved by a person — break any one of those and the chain cannot
//run, however green the other two look. A pane that showed only the jobs would
//report a judge as ready while the words it gives were withdrawn an hour ago.
//
//THE SAME THREE LIBRARIES AS THE ACTIONS TAB, AND DELIBERATELY APART. A judge
//cannot be given a task and a worker cannot be given a judging chain; the
//libraries are separated by `kind` on the other side, and keeping them on
//separate tabs is what stops somebody picking one from the wrong pile.
//---------------------------------------------------------------------------

module.exports = function judges(theme, okc) {
    var {
        Pane, Panel, Cols3, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Skeleton, Empty, Note, Mono, Kv, KvRow
    } = theme;

    //APPROVED, WITHDRAWN, OR EDITED SINCE — three states. "Edited since it was
    //read" is the one that reads as approved if it is folded in, and it is the
    //one that matters: an approval that survived an edit is an approval of
    //something nobody has seen.
    function stand(x) {
        if (!x) return { kind: 'bad', word: 'not here' };
        if (x.lapsed) return { kind: 'warn', word: 'edited since' };
        if (x.approved) return { kind: 'ok', word: 'approved' };
        return { kind: 'bad', word: 'waiting to be read' };
    }

    function Lib({ title, items, sub }) {
        var all = items.length;
        var ok = items.filter(function (x) { return x.approved && !x.lapsed; }).length;
        return (
            <Col>
                <TitleRow>
                    {title}
                    {/* THE HEADING SAYS WHETHER THE WHOLE PILE IS FIT, because
                        "all approved" is the state somebody wants to confirm at
                        a glance and "3 of 5" is the one they must not miss. */}
                    <span className="muted">{ok == all ? '— all approved' : '— ' + ok + ' of ' + all + ' approved'}</span>
                    <Grow />
                </TitleRow>
                <Stack>
                    {items.length ? items.map(function (x) {
                        var s = stand(x);
                        return (
                            <Card key={x.id}>
                                <CardTitle>
                                    <span>{x.name || x.id}</span>
                                    <Badge kind={s.kind}>{s.word}</Badge>
                                </CardTitle>
                                {x.about ? <CardSub>{x.about}</CardSub> : null}
                                <CardSub>{sub(x)}</CardSub>
                            </Card>
                        );
                    }) : <Empty>{'nothing in this library yet'}</Empty>}
                </Stack>
            </Col>
        );
    }

    return function Judges() {
        var jobs = okc.use('jobs', { kind: 'judge' }, 0);
        var prompts = okc.use('prompts', { kind: 'judge' }, 0);
        var contracts = okc.use('contracts', { kind: 'judge' }, 0);

        var err = jobs.error || prompts.error || contracts.error;
        if (err && !jobs.state) return <Pane><Note kind="bad">{err}</Note></Pane>;
        if (!jobs.state || !prompts.state || !contracts.state) return <Pane><Skeleton rows={4} /></Pane>;

        var jobList = jobs.state.jobs || [];
        var promptList = prompts.state.prompts || [];
        var contractList = contracts.state.contracts || [];

        var promptById = {}; promptList.forEach(function (p) { promptById[p.id] = p; });
        var contractById = {}; contractList.forEach(function (c) { contractById[c.id] = c; });

        //THE CHAIN, ASSEMBLED. A job names a prompt; a prompt names a contract.
        //Following it here rather than trusting a `runnable` flag means the
        //three approvals are shown rather than summarised — and if the flag and
        //the rungs ever disagree, the rungs are on the screen to be read.
        var chains = jobList.map(function (j) {
            var p = j.promptId ? promptById[j.promptId] : null;
            var c = p && p.contractId ? contractById[p.contractId] : null;
            var rungs = [j, p, c];
            var can = rungs.every(function (x) { return x && x.approved && !x.lapsed; });
            return { job: j, prompt: p, contract: c, can: can };
        });
        var canJudge = chains.filter(function (x) { return x.can; }).length;

        return (
            <Pane>
                <Note>
                    <strong>{canJudge + ' of ' + chains.length + ' can judge. '}</strong>
                    A judge is the whole chain &mdash; this job, giving these words, under these rules
                    &mdash; and every rung is read and approved by a person before anything runs.
                </Note>

                <Cols3>
                    <Lib title="Jobs" items={jobList} sub={function (x) {
                        return x.promptId
                            ? <span>{'runs '}<Mono>{'"' + x.promptId + '"'}</Mono></span>
                            : <span className="muted">names no prompt &mdash; it can read nothing</span>;
                    }} />
                    <Lib title="Prompts" items={promptList} sub={function (x) {
                        return x.contractId
                            ? <span>{'under '}<Mono>{'"' + x.contractId + '"'}</Mono></span>
                            : <span className="muted">under no contract &mdash; the judge gets no rules</span>;
                    }} />
                    <Lib title="Contracts" items={contractList} sub={function (x) {
                        return x.lines ? x.lines + ' lines' : <span className="muted">empty</span>;
                    }} />
                </Cols3>

                <h2>Whole chains</h2>
                <Stack>
                    {chains.length ? chains.map(function (ch) {
                        return (
                            <Card key={ch.job.id}>
                                <CardTitle>
                                    <span>{ch.job.name || ch.job.id}</span>
                                    {/* CAN JUDGE IS ABOUT THE CHAIN. Any rung
                                        withdrawn and the answer is no, whatever
                                        the other two say. */}
                                    <Badge kind={ch.can ? 'ok' : 'bad'}>{ch.can ? 'can judge' : 'cannot judge'}</Badge>
                                </CardTitle>
                                <Kv>
                                    <KvRow label="job">
                                        <Mono>{ch.job.id}</Mono>{' '}
                                        <Badge kind={stand(ch.job).kind}>{stand(ch.job).word}</Badge>
                                    </KvRow>
                                    <KvRow label="prompt">
                                        {ch.prompt
                                            ? <span><Mono>{ch.prompt.name || ch.prompt.id}</Mono>{' '}
                                                <Badge kind={stand(ch.prompt).kind}>{stand(ch.prompt).word}</Badge></span>
                                            : <span className="muted">{ch.job.promptId ? 'names "' + ch.job.promptId + '", which is not here' : 'none'}</span>}
                                    </KvRow>
                                    <KvRow label="contract">
                                        {ch.contract
                                            ? <span><Mono>{ch.contract.name || ch.contract.id}</Mono>{' '}
                                                <Badge kind={stand(ch.contract).kind}>{stand(ch.contract).word}</Badge></span>
                                            : <span className="muted">
                                                {ch.prompt && ch.prompt.contractId
                                                    ? 'names "' + ch.prompt.contractId + '", which is not here'
                                                    : 'none — a judge with no rules'}
                                            </span>}
                                    </KvRow>
                                </Kv>
                                {/* WHY NOT, WHERE IT IS KNOWN. The action works
                                    this out too, and where it disagrees with the
                                    rungs above, both are on the screen. */}
                                {ch.job.whyNot ? <Note kind="warn">{ch.job.whyNot}</Note> : null}
                            </Card>
                        );
                    }) : <Empty>no judging chain is assembled yet</Empty>}
                </Stack>

                {/* WRITING ONE IS NOT BUILT HERE, and the `+` on each column
                    over there is what does it. Same gap as the Actions tab. */}
                <Note>
                    Writing a job, prompt or contract is not built here yet &mdash; use `jobSave`,
                    `promptSave` and `contractSave`, and anything written that way waits to be read.
                </Note>
            </Pane>
        );
    };
};
