var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//Overview: everything outstanding, across every repository.
//
//ONE LIST INSTEAD OF FOUR PANES. One list of everything outstanding across every
//repository: issues somebody filed, pull requests that arrived, and cuts this
//host sent out. The point is that "is there anything to do" should not require
//opening four panes and adding up — and that GitHub cannot answer it, because
//each repository only sees its own.
//
//AND IT IS A READING, NOT A LIVE VIEW. Every row is as fresh as the last time
//GitHub was asked, which the app says out loud rather than implying currency it
//does not have. Nothing here polls GitHub on a timer; that is deliberate over
//there and carried across.
//
//THE ONE ROW WITH A DECISION ON IT is an arrived pull request. Everything else
//is something to read; that one is somebody else's code, and whether a judge
//may fetch it onto a machine holding a credential is a person's answer. The
//badge says where it stands and the purple button is how it is given — and the
//action behind that button refuses the command line, which is what makes the
//colour honest.
//---------------------------------------------------------------------------

var makeChassis = require('../chassis');

module.exports = function overview(theme, okc, remember) {
    //THE SAME HEAD THE OTHER THREE HAVE, from the same place. This pane does not
    //ride the chassis — it has no repository picker, because it is the one pane
    //that is not about a repository you chose — but "as of when, and how do I ask
    //again" is the same sentence and the same button, and a second copy of it is
    //a second thing to keep in step.
    var chassis = makeChassis(theme, okc, remember);
    var Head = chassis.Head;
    var {
        Pane, Panel, Card, CardTitle, CardSub, Badge, Badges, Empty, Note, Mono, Muted, Skeleton, Row, Grow,
        Chips, Chip, Finder, Sorter, HeadRow, Controls, Button, Link,
        Group, Part, ask
    } = theme;

    var KINDS = ['cut', 'pull', 'issue'];
    var SORTS = [
        ['newest', 'newest first'],
        ['oldest', 'oldest first'],
        ['kind', 'by kind'],
        ['repo', 'by repository'],
        ['state', 'by state']
    ];

    var when = function (x) { return x.at ? Date.parse(x.at) : 0; };
    var short = function (s) { return s ? String(s).slice(0, 7) : null; };

    var ORDER = {
        newest: function (a, b) { return when(b) - when(a); },
        oldest: function (a, b) { return when(a) - when(b); },
        //A cut above a loose pull request above an issue, because that is the
        //order of how much of the workspace each one is holding.
        kind: function (a, b) { return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || when(b) - when(a); },
        repo: function (a, b) {
            return String((a.repos || [])[0] || '').localeCompare(String((b.repos || [])[0] || '')) || when(b) - when(a);
        },
        state: function (a, b) { return String(a.state).localeCompare(String(b.state)) || when(b) - when(a); }
    };

    //WHAT A JUDGE MADE OF IT, in the row's own words. `concluded` is what the
    //judge recommended and `verdict` is what was recorded; they are kept apart
    //everywhere else in this app and there is no reason to merge them here.
    function Judged({ j }) {
        if (!j) return null;
        var look = j.state !== 'done' ? 'run'
            : !j.current ? undefined
                : j.concluded === 'reject' ? 'bad'
                    : j.concluded === 'accept' ? 'ok' : 'warn';
        var says = j.state !== 'done' ? j.ref + ' reading'
            : !j.current ? j.ref + ' — of an older commit'
                : j.concluded === 'reject' ? 'recommend pulling: NO'
                    : j.concluded === 'accept' ? 'recommend pulling: YES' : j.ref + ' read it';
        var why = [
            j.ref + ' — ' + j.state,
            j.sha ? 'read at ' + short(j.sha) : null,
            j.current ? null : 'they have pushed since, so this reads an older commit',
            j.said ? 'said on GitHub at ' + j.said.at : null
        ].filter(Boolean).join('\n');
        return <span>{' '}<Badge kind={look} title={why}>{says}</Badge></span>;
    }

    //WHETHER A JUDGE MAY READ IT, on the one kind of row where that is a
    //question. Nothing is said on a row where there is nothing to decide.
    function Allowance({ x }) {
        if (!(x.kind === 'pull' && x.state === 'open' && !x.ours)) return null;
        var says = x.mayBeJudged ? 'may be judged'
            : x.staleAllowance ? 'pushed since you allowed it' : 'waiting on you';
        return (
            <span>{' '}
                <Badge kind={x.mayBeJudged ? 'ok' : x.staleAllowance ? 'bad' : 'warn'}
                    title={x.whyNot || (x.allowedBy ? 'allowed by ' + x.allowedBy.by : '')}>{says}</Badge>
            </span>
        );
    }

    function Item({ it, onDone }) {
        var where = it.kind === 'cut'
            ? it.repos.length + ' repositories — ' + it.repos.join(', ')
            : (it.on || it.repo);
        var badge = it.state === 'merged' ? 'ok' : it.state === 'closed' ? 'bad' : it.kind === 'issue' ? 'warn' : 'run';

        return (
            <Card>
                <CardTitle>
                    <Badge>{it.kind === 'cut' ? 'PR cut' : it.kind}</Badge>{' '}
                    {it.number ? <Mono>{'#' + it.number}</Mono> : null}{' '}
                    {it.title}
                    <Grow />
                    {it.draft ? <span><Badge>draft</Badge>{' '}</span> : null}
                    <Judged j={it.kind === 'pull' ? it.judged : null} />
                    <Allowance x={it} />{' '}
                    <Badge kind={badge}>{it.summary || it.state}</Badge>
                </CardTitle>

                <CardSub>
                    <Muted>{[where, it.by || null].filter(Boolean).join(' · ')}</Muted>
                </CardSub>

                {(it.labels || []).length
                    ? <Badges>
                        {it.labels.slice(0, 6).map(function (l) { return <Badge key={l}>{l}</Badge>; })}
                    </Badges>
                    : null}

                {/* A CUT SHOWS ITS PARTS. The row is the change; these are where
                    it actually got to, and one of them merged while another is
                    not is precisely the state this list exists to make visible —
                    it is invisible on GitHub. */}
                {it.parts
                    ? <Group>
                        {it.parts.map(function (p) {
                            return (
                                <Part key={p.repo + '#' + p.number}
                                    right={<span>
                                        <Muted>{p.state}</Muted>{' '}
                                        {p.url ? <Link href={p.url}>read it</Link> : null}
                                    </span>}>
                                    <Mono>{p.repo + ' #' + p.number}</Mono>
                                </Part>
                            );
                        })}
                    </Group>
                    : null}

                <Row>
                    {it.url ? <Link href={it.url} chip>Read it on GitHub</Link> : null}

                    {/* ARRIVED FROM OUTSIDE, SO IT WAITS HERE.
                        This is the only control on this pane that cannot be
                        pressed by anything but a person: `prAllowJudging` refuses
                        the command line, because the whole point of it is that
                        somebody LOOKED at a stranger's code before a judge
                        fetched it onto a machine holding a credential.

                        AND IT NAMES THE COMMIT. Allowing is not a standing
                        permission for the pull request — it is a yes to what is
                        there now, and a push by the author ends it. That is why
                        the badge above can read "pushed since you allowed it"
                        and why this button comes back when it does. */}
                    {it.kind === 'pull' && it.state === 'open' && !it.ours
                        ? <Button kind={it.mayBeJudged ? undefined : 'ok'} protect
                            onClick={function () { (it.mayBeJudged ? forbid : allow)(it, onDone); }}>
                            {it.mayBeJudged ? 'Take the allowance back' : 'Allow it to be judged'}
                        </Button>
                        : null}
                </Row>
            </Card>
        );
    }

    //SAYING YES TO SOMEBODY ELSE'S CODE, which is a short dialog on purpose.
    //
    //What it has to make clear is the two things people get wrong about it: that
    //this is not a merge, and that it is about ONE COMMIT rather than about the
    //pull request. Everything else is on GitHub, one press away, and the card
    //this was pressed from already carries "Read it on GitHub".
    function allow(x, onDone) {
        ask({
            title: 'Allow #' + x.number + ' to be judged?',
            plain: [
                (x.by ? x.by + ' opened it' : 'It was opened') + ' on ' + x.on
                    + (x.association ? ' — GitHub calls them ' + x.association : '')
                    + ', from ' + (x.headRepo || 'a repository this host does not own') + '.',
                'It lets a judge FETCH and READ this change on a machine here. Nothing is merged, nothing is pushed, and no task is created.',
                x.headSha
                    ? 'It applies to commit ' + short(x.headSha) + ' only. If they push again it stops applying and you will be asked once more.'
                    : null,
                x.staleAllowance ? 'You allowed an earlier commit on this one. That allowance no longer applies.' : null
            ].filter(Boolean),
            fields: [{ name: 'note', label: 'Why (optional)', placeholder: 'read it and it looks like what it says' }],
            confirm: 'Allow it',
            onYes: function (f) {
                return okc.call('prAllowJudging', { repo: x.repo, number: x.number, note: f.note || null })
                    .then(function (r) { onDone(r.note); });
            }
        });
    }

    function forbid(x, onDone) {
        ask({
            title: 'Stop #' + x.number + ' being judged?',
            danger: true,
            plain: [
                x.on + '#' + x.number + ' would go back to waiting on somebody.',
                'A judgement already running is not stopped by this — it stops the next one being asked for.'
            ],
            confirm: 'Take it back',
            onYes: function () {
                return okc.call('prForbidJudging', { repo: x.repo, number: x.number })
                    .then(function (r) { onDone(r.note); });
            }
        });
    }

    function Overview() {
        var { state, error, reads, again } = okc.use('repoOverview', {}, 10000);
        var here = okc.use('repositories', {}, 8000);
        var [kinds, setKinds] = useState(KINDS);
        var [openOnly, setOpenOnly] = useState(true);
        var [find, setFind] = useState('');
        var [sort, setSort] = useState('newest');
        var [said, setSaid] = useState(null);
        var [asked, setAsked] = useState(null);

        //NO BUTTON, AND IT KEEPS ITSELF CURRENT. This pane is every open thing
        //across every repository, so it is the one most obviously wrong when the
        //stored answers are a week old — and it read them without ever asking.
        //`keptFresh` is the chassis's, so the rule about when to ask lives in
        //one place for all four panes that share these answers.
        function askGitHub(_repo, quietly) {
            okc.call('repositoriesCheck', {}).then(
                function (x) { if (!quietly) setAsked({ text: x.note }); again(); here.again(); },
                function (e) { if (!quietly) setAsked({ text: e.message, kind: 'bad' }); }
            );
        }
        chassis.keptFresh((here.state && here.state.repos) || [], askGitHub);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        var counts = state.counts || {};
        var items = state.items || [];
        var want = String(find || '').trim().toLowerCase();

        var shown = items.filter(function (x) {
            if (kinds.indexOf(x.kind) < 0) return false;
            if (openOnly && x.state !== 'open') return false;
            if (!want) return true;
            var hay = [x.title, (x.repos || []).join(' '), '#' + (x.number || ''), (x.labels || []).join(' ')]
                .join(' ').toLowerCase();
            return hay.indexOf(want) >= 0;
        }).sort(ORDER[sort] || ORDER.newest);

        function toggle(k) {
            setKinds(kinds.indexOf(k) < 0 ? kinds.concat([k]) : kinds.filter(function (x) { return x != k; }));
        }

        function done(note) { setSaid(note); again(); }

        return (
            <Pane>
                <Head
                    lead={'Everything open across every repository, in one list. This is the question GitHub cannot '
                        + 'answer from its own pages, because each of them is about a single repository — and a PR '
                        + 'cut is one row here rather than three.'}
                    dir={here.state && here.state.dir}
                    count={here.state ? (here.state.repos || []).length : 0}
                    note={here.state && here.state.note}
                    said={asked} setSaid={setAsked} />

                {error ? <Note kind="bad">{error}</Note> : null}
                {said ? <Note kind="ok">{said}</Note> : null}

                <Panel>
                    <HeadRow>
                        <Chips>
                            <Chip count={counts.cuts || 0} on={kinds.indexOf('cut') >= 0}
                                onClick={function () { toggle('cut'); }}>PR cuts</Chip>
                            <Chip count={counts.pulls || 0} on={kinds.indexOf('pull') >= 0}
                                onClick={function () { toggle('pull'); }}>pull requests</Chip>
                            <Chip count={counts.issues || 0} on={kinds.indexOf('issue') >= 0}
                                onClick={function () { toggle('issue'); }}>issues</Chip>
                            {/* NOT A KIND, so it is not one of the three above:
                                those say WHAT to show and this says HOW MUCH of
                                it. It carries the count it would leave, which is
                                the thing somebody is deciding between. */}
                            <Chip count={openOnly ? counts.open || 0 : counts.all || 0} on={openOnly}
                                onClick={function () { setOpenOnly(!openOnly); }}>
                                {openOnly ? 'open only' : 'open or not'}
                            </Chip>
                            {counts.toAllow
                                ? <Chip kind="warn" count={counts.toAllow} title="arrived from outside, open, and nobody has said it may be read">waiting on you</Chip>
                                : null}
                        </Chips>
                        <Controls>
                            <Finder value={find} onChange={setFind} placeholder="find a title, a repository, a number" />
                            <Sorter value={sort} onChange={setSort} options={SORTS} />
                        </Controls>
                    </HeadRow>

                    {shown.length
                        ? shown.map(function (it, i) { return <Item key={it.id || i} it={it} onDone={done} />; })
                        : <Empty>{items.length
                            ? 'Nothing matches. Widen the filters above.'
                            : 'Nothing here yet. This is as old as the last time GitHub was asked — the Repos pane reads it again.'}</Empty>}
                </Panel>

                {/* THE AGE OF THE ANSWER, said rather than implied. Everything
                    above is as fresh as the last time GitHub was asked, and a
                    list with no age is one somebody treats as current for ever. */}
                <Note>{(state.note || '') + ' · read ' + reads + ' time(s) from this host'}</Note>
            </Pane>
        );
    }

    return Overview;
};
