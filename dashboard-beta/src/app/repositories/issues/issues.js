var React = require('react');

//---------------------------------------------------------------------------
//Issues: work that arrived, rather than work written here.
//
//THE ONE THING IN THIS APP THAT COMES IN. Everything else on the Repositories
//tab is about work this host made and is sending out — branches, cuts, pull
//requests. An issue is somebody else asking for something, and turning one into
//a task is the far end of a chain that otherwise starts midway.
//
//READ FROM A SET OF PLACES, WHICH SOMEBODY CHOSE. A fork's own tracker is often
//empty — the conversation about a project happens on the repository the work
//merges into — but "the parent" was never the whole answer either: in a fork of
//a fork, issues worth reading sit on more than one link at once. Repos names
//them, this lists what they said, and EVERY ROW SAYS WHICH ONE IT CAME FROM.
//Without that, two repositories' issues merge into one list where #1 means two
//different things.
//
//AND A PLACE CAN BE SILENT FOR THREE DIFFERENT REASONS. Nothing open, issues
//switched off on that repository (GitHub answers 410, and several of these forks
//are set that way), or the token cannot see it. All three arrive as a shorter
//list, so the reason is carried per place in `issuesFrom` and printed — a count
//cannot tell them apart and neither can anybody reading one.
//
//NOT ASKED YET IS NOT NOTHING OPEN, and they used to be one button apart. The
//button is gone: reading is verified against the cache on the way in. `issues`
//is null until the first check, and showing "Nothing open." for that is a
//confident answer to a question nobody has asked yet.
//---------------------------------------------------------------------------

module.exports = function issues(theme, okc, remember, shell) {
    var {
        Panel, Stack, Head, Card, CardTitle, CardSub, Badge, Button,
        Empty, Note, Mono, ago, openOut
    } = theme;

    //AN ISSUE, TURNED INTO THE THING THIS APP ACTUALLY RUNS ON. The brief is
    //what the issue SAYS, because that is what somebody asked for — a task
    //written from an issue has to be answerable by reading the task alone, and a
    //brief that just links to the issue makes the worker go and fetch it.
    //
    //IT FILLS THE FORM RATHER THAN CREATING ANYTHING. Add task is where a task
    //is written, and it is a pane with a preview beside it precisely because a
    //brief is read once by something that cannot ask a question. Handing off to
    //it beats a second, smaller copy of that form in a dialog here.
    function writeTaskFrom(i) {
        remember.write('addtask', 'draft', {
            title: i.title,
            brief: (i.body ? i.body.trim() + '\n\n' : '')
                + 'From ' + (i.on || '') + ' issue #' + i.number + ' — ' + i.url
        });
        shell.go('Queue', 'Add task');
    }

    return function Issues({ r }) {
        var list = r.issues || null;
        var from = ((r.reads && r.reads.issues) || []).filter(Boolean);
        var said = r.issuesFrom || [];
        var mine = (r.target && r.target.self) || null;

        //WHAT TO CALL A PLACE IN ONE WORD. The full name is what GitHub knows it
        //by and is never dropped; this is the extra word that says WHY it is in
        //the list — the fork you work in, or the project everything ends up in.
        function whatItIs(on) {
            if (on === mine) return 'yours';
            if (r.source && on === r.source) return 'the project';
            if (r.parent && on === r.parent) return 'one above yours';
            return null;
        }

        return (
            <Panel>
                <Head>
                    <span>Issues</span>
                    {/* EVERY PLACE THEY WERE READ FROM, because it is a set now
                        and was one value. Issues arrive where people file them,
                        which for a fork of a fork can be two repositories at
                        once — and a heading naming one of them made the other
                        one's issues look like they came from somewhere they did
                        not. Picked on Repos → Repositories → read from. */}
                    <span className="muted">{from.length ? 'on ' + from.join(', ') : r.repo}</span>
                    <span className="muted">{r.gathered ? ago(r.gathered) : ''}</span>
                </Head>
                {/* AND THE OLD SENTENCE IS GONE. "Read from <parent>, which is
                    where a pull request from this fork would go" said two things
                    and both could be false: it named the PARENT when reading
                    follows a chosen set, and it tied reading to sending, which
                    are now separate decisions on purpose. */}

                {/* WHAT EACH PLACE ANSWERED, before the list rather than
                    instead of it. A place with issues switched off contributes
                    nothing and has no row to say so in, which is exactly the
                    case that reads as "nobody has filed anything". */}
                {said.length
                    ? <Note>
                        {said.map(function (x) {
                            var what = whatItIs(x.on);
                            return (x.on + (what ? ' (' + what + ')' : '') + ': '
                                + (x.why ? x.why
                                    : x.count === 1 ? '1 open issue' : x.count + ' open issues'));
                        }).join(' · ')}
                    </Note>
                    : null}

                {list == null
                    ? <Empty>Not asked yet — this reads issues from the places chosen under Repos.</Empty>
                    : list.length
                        ? <Stack>
                            {list.map(function (i) {
                                return (
                                    <Card key={(i.on || '') + '#' + i.number}>
                                        <CardTitle>
                                            {/* WHICH REPOSITORY IT IS ON, on the
                                                row rather than only in the
                                                heading. With more than one place
                                                read, "#1" alone names nothing —
                                                two repositories both have one. */}
                                            {/* THE WHOLE NAME, ALWAYS. Not only
                                                when more than one place is read:
                                                which fork an issue is on is the
                                                first thing somebody wants and it
                                                should not appear and disappear
                                                depending on a setting two panes
                                                away. */}
                                            <span className="mono muted">
                                                {(i.on || r.repo) + '#' + i.number}
                                            </span>
                                            <span>{i.title}</span>
                                            {whatItIs(i.on)
                                                ? <Badge kind="muted">{whatItIs(i.on)}</Badge>
                                                : null}
                                            {/* FOUR LABELS AND NO MORE. A card
                                                headed by eleven badges is a card
                                                whose title cannot be read. */}
                                            {(i.labels || []).slice(0, 4).map(function (l) {
                                                return <Badge key={l} kind="muted">{l}</Badge>;
                                            })}
                                        </CardTitle>
                                        <CardSub>
                                            {/* WHO ASKED, AND WHERE. "opened by
                                                X on owner/name" is the sentence
                                                somebody says out loud about an
                                                issue, and the second half was
                                                missing while the pane assumed
                                                every row came from one place. */}
                                            <span className="muted">
                                                {'opened by ' + (i.by || 'somebody')
                                                    + ' on ' + (i.on || r.repo)
                                                    + ', ' + ago(i.at)
                                                    + (i.comments ? ' · ' + i.comments + ' comment(s)' : '')}
                                            </span>
                                        </CardSub>
                                        <div className="row" style={{ marginTop: '6px' }}>
                                            <Button kind="ok" onClick={function () { writeTaskFrom(i); }}
                                                title="Opens Add task with this issue as the brief">
                                                Write a task from it
                                            </Button>
                                            <Button onClick={function () { openOut(i.url); }}>Read it on GitHub</Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>
                        : <Empty>Nothing open.</Empty>}
            </Panel>
        );
    };
};
