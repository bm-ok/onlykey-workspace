var React = require('react');

module.exports = function skill(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, Card, CardTitle, CardSub, Badge, Button,
        Chips, Chip, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow, Notice, Code, ask
    } = theme;

    function Skill() {
        var [which, setWhich] = remember.use('skill', 'which', 'supervisor');
        var { state, error, again } = okc.use('skills', { which: which }, 0);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var text = state.text || state.skill || '';

        return (
            <Pane>
                <Panel>
                    <div className="head-row">
                        <CardTitle>{'Skill — ' + String(text).split('\n').length + ' lines'}</CardTitle>
                        <div className="head-controls">
                            {/* THE KIT'S `Chip`, NOT A HAND-ROLLED ONE. Writing
                                the class here put the literals "supervisor" and
                                "worker" inside a className={...}, where the guard
                                reads every string as a class name and rightly
                                reported two that do not exist. The rule it is
                                enforcing is the one that stops this: a pane does
                                not name classes. */}
                            <Chip on={which == 'supervisor'}
                                onClick={function () { setWhich('supervisor'); }}>the supervisor&apos;s skill</Chip>
                            <Chip on={which == 'worker'}
                                onClick={function () { setWhich('worker'); }}>a worker&apos;s skill</Chip>
                        </div>
                    </div>
                    <CardSub>
                        How it works: the loop, what it may propose, what it may never do. Fetched fresh
                        at the head of every turn, so a change here takes effect on the next waking.
                    </CardSub>
                    {/* A SKILL IS A MARKDOWN FILE, so it is read as one. */}
                    <Code text={text} mode="markdown" tall />
                    {/* EDITING IT IS NOT PORTED, and this is one to be careful
                        about rather than quick with: `skillSave` is refused while
                        the window holds unsaved edits, which is a whole
                        arrangement (`skillHolding`) that exists so two editors do
                        not overwrite each other. Half of it would be worse than
                        none. */}
                    <Note kind="warn">
                        Read only here. Saving is refused while a window holds unsaved edits — that
                        handshake is not ported, and half of it would be worse than none of it.
                    </Note>
                </Panel>
            </Pane>
        );
    }

    return Skill;
};
