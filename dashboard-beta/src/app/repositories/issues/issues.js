var React = require('react');

//---------------------------------------------------------------------------
//Issues: work that arrived, rather than work written here.
//
//THE ONE THING IN THIS APP THAT COMES IN. Everything else on the Repositories
//tab is about work this host made and is sending out — branches, cuts, pull
//requests. An issue is somebody else asking for something, and turning one into
//a task is the far end of a chain that otherwise starts midway.
//
//READ FROM WHERE A PULL REQUEST WOULD GO, NOT FROM HERE. A fork's own tracker is
//almost always empty — the conversation about a project happens on the
//repository the work merges into. Listing this fork's issues would be a panel
//that is permanently, misleadingly empty, and the sentence saying where they
//came from is what stops "nothing open" being read as "nobody has filed
//anything".
//
//NOT ASKED YET IS NOT NOTHING OPEN, and the two are one button apart. `issues`
//is null until somebody presses Ask GitHub; showing "Nothing open." for that is
//a confident answer to a question nobody has asked yet.
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
        shell.go('Tasks', 'Add task');
    }

    return function Issues({ r }) {
        var list = r.issues || null;

        return (
            <Panel>
                <Head>
                    <span>Issues</span>
                    <span className="muted">{r.issuesOn ? 'on ' + r.issuesOn : r.repo}</span>
                    <span className="muted">{r.gathered ? ago(r.gathered) : ''}</span>
                </Head>
                {r.parent
                    ? <Note>{'Read from ' + r.parent + ', which is where a pull request from this fork would go.'}</Note>
                    : null}

                {list == null
                    ? <Empty>Not asked yet. &ldquo;Ask GitHub&rdquo; reads issues and pull requests for every repository here.</Empty>
                    : list.length
                        ? <Stack>
                            {list.map(function (i) {
                                return (
                                    <Card key={i.number}>
                                        <CardTitle>
                                            <span className="mono muted">{'#' + i.number}</span>
                                            <span>{i.title}</span>
                                            {/* FOUR LABELS AND NO MORE. A card
                                                headed by eleven badges is a card
                                                whose title cannot be read. */}
                                            {(i.labels || []).slice(0, 4).map(function (l) {
                                                return <Badge key={l} kind="muted">{l}</Badge>;
                                            })}
                                        </CardTitle>
                                        <CardSub>
                                            <span className="muted">
                                                {(i.by || 'somebody') + ', ' + ago(i.at)
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
