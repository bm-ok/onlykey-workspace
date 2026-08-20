var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//what a judgement handed back.
//
//A JUDGEMENT CHANGES NOTHING — it may not even push to what it reads — so
//everything it has to say is in what it handed back. That is why this column
//exists and why it is the wide one: there is no diff to look at afterwards, no
//commit, no branch that moved. The files ARE the output.
//
//AND THE ONE-ARGUMENT FORM IS A TRAP, which this app has already been caught by
//once. `judgementFindings --id J63` returns a `note` that is TRUNCATED — J63's
//stopped mid-sentence at "const stats = summariseAll({ columns, record" — and
//the line that carries the answer is at the very END of the file. So the
//truncation hides exactly the part that matters, and a reader skimming the note
//records the opposite of what the judge found.
//
//The action says so itself: "Ask again with a file name to read one in full."
//This pane always asks with the file name.
//
//THE LAST LINE IS THE ANSWER FOR A CHECK-A-CLAIM. `CLAIM: true` at the end of
//the findings is the verdict for that kind of judgement — not the `verdict`
//field, which for a claim-check means something else entirely and has read
//"rejected" over a finding whose whole body argued the claim was correct. So
//the tail is lifted out and shown, rather than left for somebody to scroll to.
//---------------------------------------------------------------------------

module.exports = function findings(theme, okc) {
    var { Panel, Stack, Card, CardTitle, CardSub, Badge, Button, Skeleton, Empty, Note, Mono, Code } = theme;

    //The line a judge is asked to end on. Three vocabularies, one shape: the
    //last line that looks like a verdict.
    var ENDS = /^(RECOMMENDATION|CLAIM|RECOMMEND|VERDICT)\s*:\s*(.+)$/i;
    function lastWord(text) {
        var lines = String(text || '').split('\n');
        for (var i = lines.length - 1; i >= 0; i--) {
            var m = lines[i].trim().match(ENDS);
            if (m) return { field: m[1].toUpperCase(), said: m[2].trim() };
        }
        return null;
    }

    return function Findings({ id }) {
        var [list, setList] = useState(null);
        var [pick, setPick] = useState(null);
        var [body, setBody] = useState(null);
        var [err, setErr] = useState(null);

        useEffect(function () {
            setList(null); setPick(null); setBody(null); setErr(null);
            if (!id) return;
            var alive = true;
            okc.call('judgementFindings', { id: id }).then(function (d) {
                if (!alive) return;
                setList(d);
                //NOT OPENED ON SIGHT. The old pane offers "Read it" per file
                //rather than loading one — these run to twelve kilobytes and
                //reading one is a decision, not a side effect of clicking a
                //judgement in a list.
            }, function (e) { if (alive) setErr(e.message); });
            return function () { alive = false; };
        }, [id]);

        useEffect(function () {
            if (!id || !pick) { setBody(null); return; }
            var alive = true;
            //ALWAYS WITH THE FILE NAME. See the header: the form without one
            //returns a truncated note, and the truncation removes the end,
            //which is where the answer is.
            okc.call('judgementFindings', { id: id, file: pick }).then(function (d) {
                if (alive) setBody(d);
            }, function (e) { if (alive) setErr(e.message); });
            return function () { alive = false; };
        }, [id, pick]);

        if (!id) return <Panel><Empty>nothing picked</Empty></Panel>;
        if (err) return <Panel><Note kind="bad">{err}</Note></Panel>;
        if (!list) return <Panel><Skeleton rows={2} /></Panel>;

        var files = list.files || [];
        var text = body && (body.text || body.content || body.body || body.file || '');
        var end = lastWord(text);

        return (
            <div>
                <Panel>
                    <CardTitle>
                        {'Handed back — ' + files.length + ' file(s)'}
                        {list.verdict ? <Badge kind={list.verdict == 'accepted' ? 'ok' : 'bad'}>{list.verdict}</Badge> : null}
                    </CardTitle>
                    <CardSub>
                        {'read ' + (list.reads || '?') + (list.contractName ? ' · under "' + list.contractName + '"' : '')}
                    </CardSub>
                    {files.length ? (
                        //ONE CARD PER FILE, each with its own "Read it". A row of
                        //identical buttons under a list of names makes somebody
                        //match the third button to the third name; a card puts the
                        //press next to the thing it presses.
                        <Stack>
                            {files.map(function (f) {
                                return (
                                    <Card key={f.name}>
                                        <CardTitle>
                                            <Mono>{f.name}</Mono>
                                            <Badge kind="muted">{Math.round(f.bytes / 1024) + ' KB'}</Badge>
                                        </CardTitle>
                                        <div className="row" style={{ marginTop: '6px' }}>
                                            <Button kind={f.name == pick ? 'ok' : undefined}
                                                onClick={function () { setPick(f.name); }}>
                                                {f.name == pick ? 'Reading it' : 'Read it'}
                                            </Button>
                                        </div>
                                    </Card>
                                );
                            })}
                        </Stack>
                    ) : (
                        //NOTHING HANDED BACK IS THE ONE ANSWER WORTH ALARM. A
                        //judgement that changes nothing and hands nothing back
                        //has said nothing at all, however cleanly it exited.
                        <Note kind="warn">
                            It handed nothing back. A judgement changes nothing, so a run with no files
                            is a run that said nothing &mdash; whatever its state says.
                        </Note>
                    )}
                </Panel>

                {/* THE LAST LINE, LIFTED OUT. For a check-a-claim this IS the
                    answer, and it sits at the bottom of a file thousands of
                    bytes long — which is how it gets missed and how the
                    `verdict` field gets read instead. */}
                {end ? (
                    <Panel>
                        <CardTitle>
                            {'It ended on ' + end.field}
                            <Badge kind={/^(true|yes|accept)/i.test(end.said) ? 'ok'
                                : /^(false|no|reject)/i.test(end.said) ? 'bad' : 'warn'}>{end.said}</Badge>
                        </CardTitle>
                        <CardSub>
                            This is the judge&apos;s own recommendation, in the words its prompt asked it to
                            end on. For a check-a-claim it is the answer — the verdict field means something
                            else and has pointed the other way.
                        </CardSub>
                    </Panel>
                ) : null}

                {/* ONLY WHEN SOMETHING IS BEING READ. An empty "nothing to
                    read" panel under a list of files somebody has not pressed yet
                    is a panel reporting on a question nobody asked. */}
                {pick ? (
                    <Panel>
                        <CardTitle><Mono>{pick}</Mono></CardTitle>
                        {body === null
                            ? <Skeleton rows={3} />
                            : text
                                ? <Code text={text} tall />
                                : <Empty>the file came back empty</Empty>}
                    </Panel>
                ) : null}
            </div>
        );
    };
};
