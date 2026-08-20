var React = require('react');
var useAsk = require('../okc/ask');

//the Judge tab: what has been read, what is being read, and what it concluded.
//
//TWO FIELDS THAT ARE NOT THE SAME QUESTION, and the port inherits the
//distinction rather than flattening it:
//
//  concluded   what the JUDGE recommends. Parsed from the line its own prompt
//              asks it to end on — accept/reject for a change this host made,
//              true/false/unclear for a claim somebody made about the code,
//              yes/no for a pull request that arrived.
//
//  verdict     accepted or rejected. Whether the change is fit to go out.
//
//They came apart badly once: a check-a-claim confirmed a reviewer's request —
//CLAIM: true, meaning "yes, that is worth doing" — and it was filed as
//`rejected`, which then read to the cut gate as a failed review of the branch.
//A confirmed, worth-doing improvement registering as a reason the change could
//not go out. So a check-a-claim writes no verdict now, and this shows both
//columns rather than picking one and hoping.
//
//AND "DONE" DOES NOT MEAN IT SAID ANYTHING. A judgement that ran and concluded
//nothing is a real and useful state — it is the difference between "nobody has
//looked" and "somebody looked and would not say" — and half of the ones on this
//host that said nothing said nothing because they CRASHED.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, Badge, Empty, Note, Mono } = theme;

    //A CRASH AND A SILENCE ARE NOT ONE THING, and this tab could not tell them
    //apart at first. Both look identical here — done, no verdict, nothing
    //concluded — and the difference is the run's exit code, which lives on
    //`attempts`, which the list leaves out on purpose: carrying it made that
    //action 77,000 characters and a list a supervisor could not read.
    //
    //Computing it here anyway ran `(j.attempts || [])` over a field that is not
    //present, found nothing, and reported a confident FALSE standing in for "I
    //was not told" — a zero that looked like good news.
    //
    //FIXED ON THE OTHER SIDE, which is where it belonged: the list carries
    //`crashed` now, derived where the attempts actually are. Same shape as the
    //tasks board carrying `reads` rather than the commits it worked that out
    //from — the raw material stays out and the answer it was wanted for comes
    //along.
    //
    //THREE VALUES. `null` means no exit code was ever recorded, which is every
    //judgement from before the queue kept them. It is not evidence of a clean
    //run, and this shows it as its own thing rather than folding it into either.

    function Judgement({ j }) {
        var said = j.concluded;
        return (
            <div className="card">
                <div className="card-title">
                    <Mono>{j.ref || ('J' + j.number)}</Mono>{' '}
                    <Badge kind={j.state == 'done' ? '' : 'run'}>{j.state}</Badge>{' '}
                    {j.verdict
                        ? <Badge kind={j.verdict == 'accepted' ? 'ok' : 'bad'}>{j.verdict}</Badge>
                        : null}
                    {' '}
                    {said ? <Badge kind={said == 'accept' ? 'ok' : said == 'reject' ? 'bad' : ''}>{'it said: ' + said}</Badge> : null}
                    {j.state == 'done' && !said && !j.verdict
                        ? <Badge kind={j.crashed === true ? 'bad' : 'warn'}>
                            {j.crashed === true ? 'crashed, said nothing'
                                : j.crashed === false ? 'ran, said nothing'
                                    : 'said nothing, and no exit was recorded'}
                        </Badge>
                        : null}
                </div>
                <div className="card-sub">
                    {j.subject ? <Mono>{j.subject.name || j.subject.branch}</Mono> : null}
                    {j.job ? <span>{' · ' + j.job}</span> : null}
                    {j.machine ? <span>{' · '}<Mono>{j.machine}</Mono></span> : null}
                    {j.by ? <span>{' · asked by ' + j.by}</span> : null}
                </div>
                {j.question ? <div className="note muted">{j.question}</div> : null}
            </div>
        );
    }

    function Judge() {
        var { state, error, reads } = useAsk(okc, 'judging', {}, 5000);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Empty>asking…</Empty></Pane>;

        var rows = (state.judgements || []).slice().reverse();
        var live = rows.filter(function (j) { return j.state == 'queued' || j.state == 'given'; });
        var done = rows.filter(function (j) { return live.indexOf(j) < 0; });

        //COUNTED APART, because they are different situations: one is a fault
        //to go looking at and the other is a survey answering the way surveys
        //do. Folding them together puts a phantom chore on somebody's list and
        //hides a real failure inside it.
        var mute = done.filter(function (j) { return !j.verdict && !j.concluded; });
        var broke = mute.filter(function (j) { return j.crashed === true; });
        var quiet = mute.filter(function (j) { return j.crashed !== true; });

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                {broke.length
                    ? <Note kind="bad">{broke.length + ' crashed without saying anything — a fault to look at, not a decision to make'}</Note>
                    : null}
                {quiet.length
                    ? <Note kind="warn">{quiet.length + ' ended without saying anything, which for a survey is the ordinary answer'}</Note>
                    : null}

                <Panel>
                    <div className="card-title">{'Reading now (' + live.length + ')'}</div>
                    {live.length
                        ? live.map(function (j) { return <Judgement key={j.id} j={j} />; })
                        : <Empty>nothing is being read</Empty>}
                </Panel>

                <Panel>
                    <div className="card-title">{'Read (' + done.length + ')'}</div>
                    {done.length
                        ? done.slice(0, 12).map(function (j) { return <Judgement key={j.id} j={j} />; })
                        : <Empty>nothing has been read yet</Empty>}
                    {done.length > 12 ? <Note>{'showing the newest 12 of ' + done.length}</Note> : null}
                </Panel>

                <Note>{'read ' + reads + ' time(s), every 5s · ' + (state.note || '')}</Note>
            </Pane>
        );
    }

    shell.tab({ name: 'Judge', order: 40, Component: Judge });

    await register(null, {});
}
module.exports = plugin;
