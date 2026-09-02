var React = require('react');

//---------------------------------------------------------------------------
//What it may do — one pane, drawn per KIND of run.
//
//THE SAME SHAPE AS Supervisor → What it may do, on purpose. That one reads
//../supervisor/allowed.js; this reads what each plugin declared at its own
//door. Both answer the same question about a different kind of machine, and a
//person moving between the tabs should not have to learn two layouts.
//
//IT IS NOT A DESCRIPTION OF THE RULES. It is the rules: `permissions` hands
//back what the doors refuse by, so a sentence here cannot be out of date
//without the refusal being out of date with it. That is the whole reason the
//doors ask rather than deciding for themselves.
//
//READ ONLY, AND SAYING SO. A permission list anything reaching this app could
//edit is not a permission list — the same sentence Supervisor's carries, and
//for the same reason. These change in a checkout, in a commit, with a message.
//---------------------------------------------------------------------------

module.exports = function mayDo(theme, okc) {
    var { Pane, Panel, Note, Notice, Mono, Badge, Skeleton, Empty, Part, PartWhy } = theme;

    //`kind` IS WHAT THE RUN IS, NOT WHAT THE MACHINE IS TAGGED. A worker and a
    //judge are the same disk; what decides a push is the run it is on now. See
    //`whatIsOn` in ../runners/onmachine.
    return function forKind(kind, said) {
        return function WhatItMayDo() {
            var { state, error } = okc.use('permissions', { kind: kind }, 15000);

            if (error && !state) return <Pane><Note kind="bad">{error}</Note></Pane>;
            if (!state) return <Pane><Skeleton rows={4} /></Pane>;

            var rules = state.rules || [];
            var may = rules.filter(function (r) { return r.may; });
            var not = rules.filter(function (r) { return !r.may; });

            return (
                <Pane>
                    <Notice kind="warn">
                        <b>Read only.</b> A permission list that anything reaching this app could edit is
                        not a permission list — these change in a checkout, in a commit, with a message.
                        Each one is declared by the plugin that refuses by it, so what is written here is
                        what a machine is actually told.
                    </Notice>

                    <Note>{said}</Note>

                    {!rules.length
                        ? <Empty>Nothing has declared a rule for a {kind}. A door with no rule refuses,
                            so this is not the same as being allowed everything.</Empty>
                        : null}

                    {may.length ? (
                        <Panel>
                            {may.map(function (r) {
                                return (
                                    <div key={r.door}>
                                        <Part right={<Badge kind="ok">may</Badge>}>
                                            <Mono>{r.door}</Mono>
                                        </Part>
                                        <PartWhy><span className="muted">{r.why}</span></PartWhy>
                                        {r.at ? <PartWhy><span className="muted">{'refused at ' + r.at}</span></PartWhy> : null}
                                    </div>
                                );
                            })}
                        </Panel>
                    ) : null}

                    {not.length ? (
                        <Panel>
                            {/* WHAT IT MAY NOT DO IS THE HALF WORTH READING. The
                                allowed list is what somebody expects; the
                                refusals are the ones that cost a turn when they
                                are met without warning. */}
                            {not.map(function (r) {
                                return (
                                    <div key={r.door}>
                                        <Part right={<Badge kind="bad">may not</Badge>}>
                                            <Mono>{r.door}</Mono>
                                        </Part>
                                        <PartWhy><span className="muted">{r.why}</span></PartWhy>
                                        {r.at ? <PartWhy><span className="muted">{'refused at ' + r.at}</span></PartWhy> : null}
                                    </div>
                                );
                            })}
                        </Panel>
                    ) : null}

                    <Note>{state.note}</Note>
                </Pane>
            );
        };
    };
};
