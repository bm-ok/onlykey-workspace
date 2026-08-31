var React = require('react');

//---------------------------------------------------------------------------
//WHAT A CUT IS, DRAWN: one row per pull request, repo to repo.
//
//A CUT IS A PAIR OF NAMES AND NEITHER OF THEM SAYS ANYTHING. "dashboard/setup
//into default branches" is two things somebody typed once, and the press beside
//them opens pull requests on GitHub. What is this? Where is it? Where is it
//going? None of it was on either screen, and all of it was in the answer.
//
//SO THE TWO SIDES ARE DRAWN — the address, the branch, and the commit each is
//at. A line is one branch per repository; this is that sentence drawn rather
//than asserted.
//
//ONE ROW PER REPOSITORY, BECAUSE EACH ROW IS A PULL REQUEST. Built as two
//columns with one arrow beside them, the arrow pointed at the pair rather than
//at a pair, and the two sides were the nth item of two independent stacks —
//level only by luck. As rows they are siblings, so they cannot drift.
//
//---- WHY IT IS ITS OWN FILE ----------------------------------------------
//
//BOTH PANES ASK THE SAME QUESTION. New PR Cut asks it while composing; PR cuts
//asks it with a finger over Send it, which is the moment it matters most. Two
//copies of a thing this shape is two things to keep in step, and the one that
//drifts is the one nobody is looking at.
//
//IT TAKES `where` AND NOTHING ELSE. Everything on a row — including both
//commits — is on `prTemplatePreview`'s own answer, so no pane needs to have
//loaded anything to draw it. The first version looked the commits up in
//`lines`, which meant only a pane that had loaded that could show them.
//---------------------------------------------------------------------------

module.exports = function whereRows(theme) {
    var { Cols, Col, Stack, Head, Card, CardTitle, CardSub, Badge, Mono, Muted } = theme;

    function Side({ w, side }) {
        var addr = side === 'from' ? w.from : w.into;
        var branch = side === 'from' ? w.branch : w.base;
        var at = side === 'from' ? w.at : w.baseAt;

        return (
            <Card>
                <CardTitle>
                    {addr
                        ? <Mono>{addr}</Mono>
                        //NOTHING PICKED IS NOT AN EMPTY CARD. A repository with
                        //no destination cannot open a pull request at all, and
                        //that is the one thing on this row worth interrupting
                        //for — see `intoWhy`, which says where it is chosen.
                        : <Badge kind="warn">nothing picked</Badge>}
                </CardTitle>
                <CardSub>
                    <Mono>{branch}</Mono>
                    {at ? <span>{' '}<Muted>{at}</Muted></span> : null}
                    {side === 'into' && !addr && w.intoWhy
                        ? <span>{' '}<Muted>{w.intoWhy}</Muted></span>
                        : null}
                </CardSub>
            </Card>
        );
    }

    //`from` AND `into` ARE OVERRIDABLE because the two panes are at different
    //moments. Composing, it is what is being sent and where it lands; with a
    //cut already written, the same two columns are what was written down.
    function WhereRows({ where, from, into }) {
        var rows = where || [];
        if (!rows.length) return null;

        return (
            <React.Fragment>
                <Cols>
                    <Col><Head><span>{from || 'What is being sent'}</span></Head></Col>
                    {/* AN EMPTY ONE, so the headings stay in step with the rows
                        they name — `.col.thin` is a fixed width for exactly
                        this reason. */}
                    <Col thin />
                    <Col><Head><span>{into || 'Where each one lands'}</span></Head></Col>
                </Cols>

                <Stack>
                    {rows.map(function (w) {
                        return (
                            <Cols key={w.repo}>
                                <Col><Side w={w} side="from" /></Col>
                                <Col thin><Muted>→</Muted></Col>
                                <Col><Side w={w} side="into" /></Col>
                            </Cols>
                        );
                    })}
                </Stack>
            </React.Fragment>
        );
    }

    return { WhereRows: WhereRows };
};
