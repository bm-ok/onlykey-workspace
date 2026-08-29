var React = require('react');

//---------------------------------------------------------------------------
//A TIMELINE, DRAWN ONE WAY EVERYWHERE IT IS DRAWN.
//
//PR cuts tells the story of a cut; Issues tells the story of an issue; both
//are the same composer's entries (pr/story.js) and the same list -- newest at
//the top, the initiator at the bottom, `in` and `out` on every exchange with
//GitHub or the supervisor. Lifted here so the two panes cannot drift.
//
//Takes the theme, because a pane never names a class and this is drawn with
//the kit like anything else.
//---------------------------------------------------------------------------

module.exports = function storyList(theme) {
    var { Stack, Card, CardTitle, CardSub, Badge, Empty, Note, Skeleton, Mono, Link, openOut } = theme;

    //THE DAY AND THE MINUTE, LOCAL: a story is read as a sequence, and a
    //relative "3 hours ago" hides the order two entries an hour apart happened in.
    function moment(at) {
        if (!at) return '';
        var d = new Date(at);
        if (isNaN(d.getTime())) return String(at);
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
    }

    //`story` IS WHAT okc.use HANDS BACK: { state, error }, with state carrying
    //`entries` and a `note`.
    function StoryList({ story, empty }) {
        if (story.error) return <Note kind="bad">{story.error}</Note>;
        if (!story.state) return <Skeleton rows={5} />;
        var entries = story.state.entries || [];
        if (!entries.length) return <Empty>{story.state.note || empty || 'Nothing is recorded yet.'}</Empty>;
        return (
            <React.Fragment>
                <Stack>
                    {entries.map(function (e, i) {
                        var tone = e.dir === 'in' ? 'warn' : e.dir === 'out' ? 'ok' : 'muted';
                        var word = e.dir === 'in' ? 'in' : e.dir === 'out' ? 'out' : e.kind;
                        return (
                            <Card key={i}>
                                <CardTitle>
                                    <Badge kind={tone}>{word}</Badge>
                                    <span className="muted">{moment(e.at)}</span>
                                    {e.who ? <Mono>{e.who}</Mono> : null}
                                    {e.ref ? <span className="muted">{e.ref}</span> : null}
                                </CardTitle>
                                <CardSub>
                                    {e.url
                                        ? <Link onClick={function () { openOut(e.url); }}>{e.text}</Link>
                                        : <span>{e.text}</span>}
                                </CardSub>
                            </Card>
                        );
                    })}
                </Stack>
                {story.state.note ? <Note>{story.state.note}</Note> : null}
            </React.Fragment>
        );
    }

    return { StoryList: StoryList, moment: moment };
};
