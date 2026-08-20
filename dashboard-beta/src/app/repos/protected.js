var React = require('react');
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//Protected: what may not be built on, and whether you could change that.
//
//TWO SECTIONS, NOT ONE LIST WITH A COLUMN. This was a flat list of cards all
//saying "protected", with the reasons as rows of a table — and reading it, the
//question a person actually has is not which branches are protected. It is
//whether a PARTICULAR one can be worked on, and if not, what would have to
//happen first. Those have completely different answers for the two kinds:
//
//  a default branch   a fact about the repository, read from git. Nothing here
//                     can unprotect it, and nothing should.
//  a link in a line   a decision somebody made by naming the line. Forgetting
//                     the line gives the branch back.
//
//So each section says what to do about it — including the one where the honest
//answer is "nothing". Collapsing them into one word is what let `master` claim
//to be a baseline for a repository that was counting from something else.
//
//A BRANCH CAN BE BOTH, and then the weaker reason is still worth saying: a
//default branch that is also named in a line stays protected if that line is
//forgotten. Somebody who forgets the line to free the branch and finds it still
//refused would conclude the refusal is a bug.
//
//NOTHING PROTECTED IS AN ALARM, not an empty list. It would mean no repository
//here has a default branch, which should not be possible — so it is said in red
//rather than drawn as a tidy "none".
//---------------------------------------------------------------------------

module.exports = function protectedPane(theme, okc) {
    var {
        Pane, Stack, Group, Head, Card, CardTitle, CardSub,
        Badge, Skeleton, Empty, Note, Mono
    } = theme;

    function once(list) {
        var seen = {};
        return (list || []).filter(function (x) {
            if (seen[x]) return false;
            seen[x] = true;
            return true;
        });
    }

    function One({ p, fact }) {
        return (
            <Card>
                <CardTitle>
                    <Mono>{p.branch}</Mono>
                    <Badge kind={fact ? 'muted' : 'warn'}>{fact ? 'always' : 'while it is a link'}</Badge>
                </CardTitle>
                <CardSub>
                    <span className="muted">
                        {fact
                            ? 'the default branch of ' + p.asDefault.join(', ')
                            : 'named in ' + once(p.asGroup).join(', ')}
                    </span>
                </CardSub>
                {/* THE WEAKER REASON, SAID ANYWAY. Forgetting the line will not
                    give this one back, and finding that out by trying is how a
                    refusal gets read as a fault. */}
                {fact && p.asGroup && p.asGroup.length ? (
                    <CardSub>
                        <span className="muted">
                            {'also a link in ' + once(p.asGroup).join(', ') + ' — forgetting that line would not unprotect it'}
                        </span>
                    </CardSub>
                ) : null}
            </Card>
        );
    }

    return function Protected() {
        var q = useAsk(okc, 'branchBoard', {}, 8000);

        if (q.error && !q.state) return <Pane><Note kind="bad">{q.error}</Note></Pane>;
        if (!q.state) return <Pane><Skeleton rows={4} /></Pane>;

        var all = q.state.protected || [];
        var facts = all.filter(function (p) { return p.asDefault.length; });
        var chosen = all.filter(function (p) { return !p.asDefault.length; });

        return (
            <Pane>
                <Note>
                    What may not be built on, and whether you could change that. A repository&rsquo;s own default is
                    a fact about git and cannot be unmade here; a link in a line is a decision somebody made by naming it.
                </Note>
                <Note>
                    Nothing is built on these and nothing pushes to them. Work is cut onto its own branch and merged
                    in afterwards &mdash; the rule the rest of this rests on.
                </Note>

                {!all.length ? (
                    <Empty bad>
                        Nothing is protected, which means no repository here has a default branch &mdash; worth looking at.
                    </Empty>
                ) : (
                    <React.Fragment>
                        <Group>
                            <Head>
                                <span>Facts about the repositories</span>
                                <span className="muted">{String(facts.length)}</span>
                            </Head>
                            <Note>
                                Where everything lands eventually. Read from git the first time each repository was seen,
                                and not changeable from here &mdash; a machine is refused this branch whatever else is configured.
                            </Note>
                            {facts.length
                                ? <Stack>{facts.map(function (p) { return <One key={p.branch} p={p} fact />; })}</Stack>
                                : <Empty bad>No repository here has a default branch, which should not be possible and is worth looking at.</Empty>}
                        </Group>

                        <Group>
                            <Head>
                                <span>Links in a line</span>
                                <span className="muted">{String(chosen.length)}</span>
                            </Head>
                            <Note>
                                Named in a line, so work is cut from them and merged back into them rather than built on
                                directly. That is a decision &mdash; forget the line on the Lines tab and the branch is ordinary again.
                            </Note>
                            {chosen.length
                                ? <Stack>{chosen.map(function (p) { return <One key={p.branch} p={p} />; })}</Stack>
                                : <Empty>No line names a branch that is not already a default. Nothing here is protected by a decision.</Empty>}
                        </Group>
                    </React.Fragment>
                )}
            </Pane>
        );
    };
};
