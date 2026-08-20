var React = require('react');

//---------------------------------------------------------------------------
//trouble: the shared list, and the only thing in the window that cannot be
//missed.
//
//A LIST, WHICH IS WHY THE OTHER TWO ARE NOT IN IT. Anything worth saying joins
//this; that is exactly why testing mode and a running drill have elements of
//their own, where nothing can take their place.
//
//IT LEAVES THE MOMENT IT IS FIXED, so it cannot become wallpaper. Nothing here
//is dismissible and nothing here is remembered: every line is computed from what
//is true right now, and the way to make one go away is to deal with it.
//
//A THIRD ELEMENT, OPTIONAL: WHERE TO GO ABOUT IT. Every line describes something
//somebody has to do something about, and a line that does not say where leaves
//them to read the sentence, agree with it, and then go hunting.
//---------------------------------------------------------------------------

module.exports = function trouble(theme, okc, shell) {
    var { Banner, Linky } = theme;

    return function Trouble() {
        var q = okc.use('waiting', {}, 10000);
        var s = q.state;
        if (!s) return null;

        var lines = [];

        //SOMETHING IS WAITING FOR A PERSON TO READ IT, and a badge alone was not
        //enough over there.
        //
        //A badge is on a tab somebody is not looking at. That is fine for a
        //count and wrong for a STOP: a job written over the wire sits
        //unapproved, nothing runs it, the supervisor goes on waiting, and the
        //only sign is a number on a tab three along from wherever you are.
        //
        //NOT A FAULT, and the wording says so. Everything else in this list is
        //something that went wrong; this is the machinery working exactly as
        //designed — a model may write one of these and may not ratify it — and
        //reading it as an alarm would teach somebody to dismiss the banner.
        var approvals = s.approvals || [];
        if (approvals.length) {
            var named = approvals.map(function (a) {
                return a.kind + ' "' + (a.name || a.id) + '"';
            }).join(', ');
            lines.push({
                key: 'approvals',
                bold: approvals.length + (approvals.length === 1 ? ' thing is' : ' things are')
                    + ' waiting for you to approve. ',
                rest: 'Nothing runs them until you have read them: ' + named
                    + '. A model may write a job, a prompt or a contract and may not approve its own.',
                //WHERE THE THING ACTUALLY IS. Over there this went to Actions
                //always, and a judging job, prompt or contract is under Judge →
                //Judges — so pressing it opened a pane with nothing in it, which
                //reads as a button that does not switch tabs.
                go: {
                    label: 'Read them',
                    at: function () {
                        var first = approvals[0];
                        if (first && first.of === 'judge') return shell.go('Judge', 'Judges');
                        if (first && first.kind) return shell.go('Actions', first.kind[0].toUpperCase() + first.kind.slice(1) + 's');
                        return shell.go('Actions');
                    }
                }
            });
        }

        //NOT PORTED YET, AND SAID HERE RATHER THAN LEFT TO BE NOTICED.
        //
        //The old window's list carries several more rules — VirtualBox missing
        //or not answering, a machine in the list that VirtualBox does not have,
        //a repository left on a branch with uncommitted changes, a machine idle
        //and still holding a credential, a supervisor up and unable to think.
        //
        //Every one of them reads the DASHBOARD's `status` and `vmList`.
        //
        //THE THING THAT BLOCKED THEM IS GONE. This app defined a `status` of its
        //own — what it is and whether its window is up — and a local name beats a
        //relayed one, so `okc.call('status')` never reached the half that knows
        //whether VirtualBox is there. That one is called `info` now and `status`
        //means what it means everywhere else: the workspace, VirtualBox, whether
        //the drills are on and whether one is running.
        //
        //So these are ordinary unwritten rules now rather than blocked ones, and
        //they are written next. Kept as a note in the meantime because a banner
        //that silently checks four things out of nine is worse than one that says
        //which four.
        if (!lines.length) return null;

        return (
            <Banner kind="stale">
                {lines.map(function (l) {
                    return (
                        <div key={l.key}>
                            <strong>{l.bold}</strong>
                            <span>{l.rest}</span>
                            {l.go ? <Linky onClick={l.go.at}>{l.go.label}</Linky> : null}
                        </div>
                    );
                })}
            </Banner>
        );
    };
};
