var React = require('react');

//---------------------------------------------------------------------------
//the Cron pane: everything this app does on a timer, and what happened.
//
//THE REASON THIS EXISTS IS THE LOOKING. A `setInterval` is one line; what is
//hard is a repeating job that can say what it did. Before this there were two
//timers in the node half and no way to ask either of them anything — not
//whether it was running, not when it last ran, not whether it had been failing
//since Tuesday.
//
//SO THE PANE LEADS WITH THE LAST RUN rather than with the configuration. "Every
//fifteen seconds" is what somebody typed; "last ran four minutes ago and threw"
//is what they need to know, and the second one is the one that goes wrong.
//---------------------------------------------------------------------------

module.exports = function cronPane(theme, okc) {
    var {
        Pane, Panel, Stack, TitleRow, Grow, Row, Card, CardTitle, CardSub,
        Badge, Badges, Button, Empty, Note, Mono, Muted, Skeleton, Kv, KvRow, ask
    } = theme;

    //---- saying a length of time --------------------------------------------
    //
    //ROUNDED, AND NEVER "0s". A job that runs every 250ms is not something this
    //app has, and a countdown that reads zero for a second before anything
    //happens looks stuck.
    function forHowLong(ms) {
        if (ms === null || ms === undefined) return '—';
        if (ms < 1000) return Math.max(1, Math.round(ms)) + 'ms';
        var s = Math.round(ms / 1000);
        if (s < 60) return s + 's';
        var m = Math.round(s / 60);
        if (m < 60) return m + 'm';
        return Math.round(m / 60) + 'h';
    }

    //HOW LONG AGO, from a stamp. Worked out here rather than sent, because the
    //answer changes while somebody is looking at it and the one on the wire
    //would be as old as the last poll.
    function ago(at) {
        if (!at) return 'never';
        var then = Date.parse(at);
        if (!then) return String(at);
        var ms = Date.now() - then;
        if (ms < 0) return 'just now';
        return forHowLong(ms) + ' ago';
    }

    //---- one job -------------------------------------------------------------

    function Job({ job, onChanged }) {
        var last = job.last;

        //THE TWO STATES, KEPT APART ON THE SCREEN TOO.
        //
        //RUNNING is whether the clock is turning. ARMED is whether anything is
        //registered to do the work — the bundle holding it is rebuilt on every
        //save, so there is a moment after each one where a job is running with
        //nothing behind it. A board that collapsed them would say "on" about a
        //job that has quietly done nothing since the last save.
        var badges = [];
        if (job.running) badges.push({ kind: 'ok', text: 'running' });
        else badges.push({ kind: undefined, text: 'stopped' });
        if (!job.armed) badges.push({ kind: 'warn', text: 'nothing behind it' });
        if (job.inFlight) badges.push({ kind: 'busy', text: 'in flight now' });
        if (job.failures) badges.push({ kind: 'bad', text: job.failures + ' failed' });

        async function press(action, args, why) {
            //PURPLE MEANS A PERSON, and the gate is asked for the jobs that
            //declared they need one — the queue's is the whole reason this
            //plugin has a gate at all.
            if (why && !(await ask({ title: why.title, body: why.body, confirm: why.confirm }))) return;
            try { await okc.call(action, args); } catch (e) { /* the banner below says it */ }
            onChanged();
        }

        return (
            <Card>
                <TitleRow>
                    <CardTitle>{job.name}</CardTitle>
                    <Grow />
                    <Badges>
                        {badges.map(function (b, i) {
                            return <Badge key={i} kind={b.kind}>{b.text}</Badge>;
                        })}
                    </Badges>
                </TitleRow>
                <CardSub>{job.about || 'no description'}</CardSub>

                <Kv>
                    <KvRow label="every">{forHowLong(job.every)}</KvRow>
                    <KvRow label="next">{job.running ? 'in ' + forHowLong(job.dueIn) : 'not scheduled'}</KvRow>
                    <KvRow label="last run">
                        {!last
                            ? <Muted>never</Muted>
                            : <span>
                                {ago(last.at)}
                                {', took ' + forHowLong(last.ms) + ' — '}
                                {last.ok ? 'fine' : <Mono>{last.said || 'it failed and said nothing'}</Mono>}
                            </span>}
                    </KvRow>
                    <KvRow label="runs">{job.runs} {job.failures ? '(' + job.failures + ' failed)' : ''}</KvRow>
                    {job.since
                        ? <KvRow label="started">{'by ' + job.since.by + ', ' + ago(job.since.at)}</KvRow>
                        : null}
                </Kv>

                {/*THE LAST FEW, because a job that fails every third time is the
                   interesting case and one entry cannot show it.*/}
                {job.history && job.history.length > 1
                    ? <Row>
                        <Muted>recent:</Muted>
                        {job.history.slice(0, 12).map(function (h, i) {
                            return <Badge key={i} kind={h.ok ? 'ok' : 'bad'}>{forHowLong(h.ms)}</Badge>;
                        })}
                    </Row>
                    : null}

                {/*NO PURPLE ON ANY OF THESE ANY MORE. One job — the queue —
                   declared `humanOnly`, and these three controls each asked it
                   whether to draw guarded and whether to confirm. A guard
                   belonging to one job, rendered by the pane for all of them.

                   THE GATE IS ON THE WORK, NOT ON THE CLOCK: nothing reaches a
                   machine that was not built from a job, a prompt and a contract
                   somebody approved, and approving is what refuses over the
                   wire. See ../core/cron/server.js. Purple is only honest while
                   it is spent on presses the command line is actually refused —
                   marking one it is not is worse than not marking it. */}
                <Row>
                    {job.running
                        ? <Button onClick={function () { press('cronStop', { name: job.name }); }}>Stop</Button>
                        : <Button kind="ok" onClick={function () { press('cronStart', { name: job.name }); }}>Start</Button>}

                    <Button disabled={job.inFlight || !job.armed}
                        onClick={function () { press('cronRun', { name: job.name }); }}>Run now</Button>
                </Row>

                {/*A DISABLED "Run now" WITH NO REASON reads as broken.*/}
                {!job.armed
                    ? <Note kind="warn">Nothing is registered to do this job. It is either not
                        finished being ported, or the node half has not put its work back since
                        the last save.</Note>
                    : null}
            </Card>
        );
    }

    //---- the pane ------------------------------------------------------------

    function Cron() {
        var { state, error, reads, again } = okc.use('crons', {}, 2000);

        if (error && !state) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={3} /></Pane>;

        var jobs = state.jobs || [];

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <TitleRow>
                        <CardTitle>What this app does on its own</CardTitle>
                        <Grow />
                        <Button onClick={again}>Refresh</Button>
                    </TitleRow>
                    <CardSub>
                        Everything here runs whether or not anybody is looking. One timer looks
                        every {forHowLong(state.beat)} and runs whatever is due.
                    </CardSub>
                </Panel>

                {!jobs.length
                    ? <Empty>Nothing is scheduled on this host.</Empty>
                    : <Stack>
                        {jobs.map(function (job) {
                            return <Job key={job.name} job={job} onChanged={again} />;
                        })}
                    </Stack>}

                {/*WINDOW-SIDE POLLING IS NOT HERE, and saying so is the point: a
                   board that claims to be everything, while four panes quietly
                   poll on their own, is worse than one that names its edge.*/}
                <Note>
                    This is the node half only — work the app does unwatched. A pane that
                    refreshes while you look at it is a different thing and is not listed here.
                </Note>
            </Pane>
        );
    }

    return Cron;
};
