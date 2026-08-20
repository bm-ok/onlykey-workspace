var React = require('react');

//---------------------------------------------------------------------------
//the Meter: what each sign-in has spent.
//
//WHAT WAS SPENT, NOT WHAT IT WOULD COST. A supervisor waking and a worker run
//each write ONE ROW when they finish, read off the machine before it is rolled
//back. So every number here came from the run that produced it rather than from
//multiplying a token count by a price somebody typed into this app — which is
//the difference between a meter and a guess dressed as one.
//
//READ OFF THE MACHINE BEFORE IT IS ROLLED BACK, and that clause is the whole
//reason this is durable. A machine is put back to its base snapshot after every
//task; anything not written down at the end is gone with it. There is no second
//place to go and ask later.
//
//THE TOTAL FIRST AND BIGGEST, because it is the question. Everything under it is
//the same number taken apart — first per sign-in, then per run — so somebody who
//wants "what has this cost me" reads one line and stops, and somebody who wants
//"which of them" keeps going.
//
//A SIGN-IN WITH NO RUNS IS STILL LISTED. "This one has spent nothing" and "this
//one does not appear" are different answers, and only the first is one somebody
//can act on.
//---------------------------------------------------------------------------

module.exports = function meter(theme, okc) {
    var {
        Pane, Stack, TitleRow, Card, CardTitle, CardSub, Badge, Grow,
        Skeleton, Empty, Note, Mono, ago
    } = theme;

    function num(n) { return n == null ? '—' : Number(n).toLocaleString(); }

    //FOUR DECIMALS UNDER A DOLLAR, TWO ABOVE. A run that cost $0.0002 shown as
    //"$0.00" is a run that reads as free, and a hundred of those are what the
    //total is made of.
    function cost(n) { return n == null ? '—' : '$' + Number(n).toFixed(n < 1 ? 4 : 2); }

    //FRESH INPUT, OUTPUT, READ FROM CACHE, WRITTEN TO CACHE — four numbers that
    //are priced differently and are not interchangeable. Summing them into
    //"tokens" would hide the one that actually moves the bill.
    var TOKENS = 'fresh input / output / read from cache / written to cache';
    function tokens(x, lead) {
        return (lead || '') + 'in ' + num(x.input) + ' · out ' + num(x.output)
            + ' · cache read ' + num(x.cacheRead) + ' · cache written ' + num(x.cacheWrite);
    }

    function joined(parts) { return parts.filter(Boolean).join(' · '); }

    return function Meter() {
        var q = okc.use('meter', {}, 8000);

        if (q.error && !q.state) return <Pane><Note kind="bad">{q.error}</Note></Pane>;
        if (!q.state) return <Pane><Skeleton rows={4} /></Pane>;

        var v = q.state;
        var t = v.total || {};
        var keys = v.keys || [];
        var rows = v.rows || [];
        var ran = keys.filter(function (k) { return k.runs; }).length;

        return (
            <Pane>
                {/* A TitleRow AND NOT A Head, matching the old window: over
                    there this is an h2 and the whole line reads in capitals,
                    where the section heads on Issues and Pull requests are
                    `carries-head` and keep their qualifiers in normal case. The
                    difference is not decoration -- one is the heading of a
                    SCREEN and the other of a section within one. */}
                <TitleRow>
                    <span>Meter</span>
                    <span className="muted">
                        {t.runs ? '— ' + t.runs + ' run(s) across ' + ran + ' sign-in(s)' : ''}
                    </span>
                </TitleRow>
                <Note>
                    What each sign-in has spent. A supervisor waking and a worker run each write one row
                    when they finish, read off the machine before it is rolled back &mdash; so what is here
                    is what was actually spent, not an estimate.
                </Note>

                <Card>
                    <CardTitle>
                        <span>Everything, all sign-ins</span>
                        <Grow />
                        <Badge kind="ok">{cost(t.cost)}</Badge>
                    </CardTitle>
                    <CardSub>
                        <span className="muted">{joined([
                            (t.runs || 0) + ' run(s)',
                            t.turns == null ? null : num(t.turns) + ' turns',
                            t.first ? 'since ' + ago(t.first) : null,
                            t.trouble ? t.trouble + ' ended badly' : null
                        ])}</span>
                    </CardSub>
                    <CardSub>
                        <span className="muted" title={TOKENS}>{tokens(t, 'tokens — ')}</span>
                    </CardSub>
                    {v.note ? <Note>{v.note}</Note> : null}
                </Card>

                <Stack>
                    {keys.map(function (k) {
                        return (
                            <Card key={k.key == null ? '(none)' : k.key}>
                                <CardTitle>
                                    <Mono>{k.key || 'not attributed'}</Mono>
                                    <Grow />
                                    <Badge kind={k.runs ? 'ok' : 'muted'}>{k.runs ? cost(k.cost) : 'nothing yet'}</Badge>
                                </CardTitle>
                                <CardSub>
                                    <span className="muted">{k.runs
                                        ? joined([
                                            k.runs + ' run(s)',
                                            k.turns == null ? null : num(k.turns) + ' turns',
                                            k.last ? 'last ' + ago(k.last) : null,
                                            k.trouble ? k.trouble + ' ended badly' : null
                                        ])
                                        : 'this sign-in has not run anything that was metered'}</span>
                                </CardSub>
                                {k.runs ? (
                                    <CardSub><span className="muted" title={TOKENS}>{tokens(k)}</span></CardSub>
                                ) : null}
                                {/* A KEY WITH NO NAME IS NOT A KEY. A run whose
                                    sign-in could not be worked out is recorded
                                    rather than dropped — losing the spend is
                                    worse than losing the attribution — and says
                                    so rather than being folded into somebody
                                    else's total. */}
                                {k.key === null && k.runs ? (
                                    <Note>
                                        These ran on a machine that was holding no recorded sign-in, or one that
                                        had already been taken back before this was written down.
                                    </Note>
                                ) : null}
                            </Card>
                        );
                    })}
                </Stack>

                <TitleRow>
                    <span>Runs</span>
                    <span className="muted">{rows.length ? '— newest ' + v.showing + ' of ' + v.of : ''}</span>
                </TitleRow>
                <Stack>
                    {rows.length ? rows.map(function (r) {
                        return (
                            <Card key={r.at + (r.ref || '')}>
                                <CardTitle>
                                    <Badge kind="muted">{r.kind}</Badge>
                                    <span className="mono muted">{r.ref || ''}</span>
                                    <span className="grow">{r.about || ''}</span>
                                    {r.trouble ? <Badge kind="bad">ended badly</Badge> : null}
                                    {/* THE COST IS PLAIN, NOT GREEN. Green on the
                                        totals means "this is the answer"; green
                                        on every row of a hundred means nothing
                                        at all. */}
                                    <Badge>{cost(r.cost)}</Badge>
                                </CardTitle>
                                <CardSub>
                                    <span className="muted">{joined([
                                        r.key || 'no sign-in recorded',
                                        r.machine || null,
                                        ago(r.at),
                                        r.turns == null ? null : r.turns + ' turn(s)',
                                        r.ms == null ? null : Math.round(Number(r.ms) / 1000) + 's'
                                    ])}</span>
                                </CardSub>
                                <CardSub><span className="muted" title={TOKENS}>{tokens(r)}</span></CardSub>
                            </Card>
                        );
                    }) : <Empty>{v.note || 'Nothing metered yet.'}</Empty>}
                </Stack>
            </Pane>
        );
    };
};
