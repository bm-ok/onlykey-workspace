var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//WHAT A RUN HANDED BACK — the files, and one of them read.
//
//ONE COMPONENT FOR BOTH KINDS OF WORK. The Judge had this and the Worker had
//nothing like it, and the Worker half was about to be written a second time:
//same list, same per-file press, same reader, same skeleton. It was lifted here
//instead, out of ../judge/judgements.js.
//
//WHAT MADE THE JUDGE'S LOOK SPECIAL WAS NOT THIS. `judgementFindings` folded the
//judgement's own facts — its verdict, what it read, the contract it was held to
//— into the same answer as the files, and the card rendered them as a badge and
//a subtitle. Those are facts about a JUDGEMENT wearing a file card's clothes.
//Split them out and the two callers are the same component with different words
//for "nothing here".
//
//---- what the caller supplies, and why it is functions ---------------------
//
//    list(id)         -> { files: [{name, bytes}], note }
//    read(id, name)   -> { text }
//    empty            what to say when a run handed nothing back
//
//FUNCTIONS RATHER THAN ACTION NAMES, because the two callers do not agree on the
//shape. A judgement reads both from `judgementFindings` — with a file name and
//without — and a task reads from `taskFiles` and `taskFileRead`, which are two.
//Taking names would have meant this file knowing which of those spellings each
//caller uses, which is the caller's business and changes when an action does.
//
//`empty` IS OPTIONAL, AND MOST CALLERS SHOULD NOT PASS ONE. Both actions already
//answer with a `note` that says what nothing-handed-back MEANS for their kind of
//work, and each says something this file could not: `taskFiles` names the helper
//a run would have called, and `judgementFindings` tells a judge that read and
//found nothing apart from a run that CRASHED before reading a line.
//
//SO THE NOTE IS THE EMPTY STATE, and `empty` is for a caller that needs it in a
//different VOICE. The Judge passes one because "it handed nothing back, so it
//said nothing at all" has to be a warning there — a judgement changes nothing and
//may not push, so files are the only way it can speak. The same sentence is
//simply false of a task, which delivers on its branch.
//---------------------------------------------------------------------------

module.exports = function handedBack(theme) {
    var { Panel, Stack, Card, CardTitle, CardSub, Badge, Button, Skeleton,
        Empty, Note, Mono, Code } = theme;

    //THE LINE A RUN IS ASKED TO END ON. Three vocabularies, one shape: the last
    //line that looks like a verdict.
    //
    //IT IS NOT JUDGE-ONLY, though only a judge is asked for one today. On a
    //task's file it matches nothing and nothing is drawn — so it costs a caller
    //that will never use it exactly nothing, and a task whose brief did ask for
    //a closing line gets the same lift without anybody wiring it up.
    var ENDS = /^(RECOMMENDATION|CLAIM|RECOMMEND|VERDICT)\s*:\s*(.+)$/i;
    function lastWord(text) {
        var lines = String(text || '').split('\n');
        for (var i = lines.length - 1; i >= 0; i--) {
            var m = lines[i].trim().match(ENDS);
            if (m) return { field: m[1].toUpperCase(), said: m[2].trim() };
        }
        return null;
    }

    return function forThese(how) {
        var listFiles = how.list;
        var readOne = how.read;
        var empty = how.empty;
        var title = how.title || 'Handed back';

        return function HandedBack({ id }) {
            var [list, setList] = useState(null);
            var [pick, setPick] = useState(null);
            var [body, setBody] = useState(null);
            var [err, setErr] = useState(null);

            useEffect(function () {
                setList(null); setPick(null); setBody(null); setErr(null);
                if (!id) return;
                var alive = true;

                //NOT OPENED ON SIGHT. Each file offers "Read it" rather than one
                //being loaded — these run to twelve kilobytes and reading one is
                //a decision, not a side effect of clicking a row in a list.
                listFiles(id).then(function (d) {
                    if (alive) setList(d);
                }, function (e) { if (alive) setErr(e.message); });

                return function () { alive = false; };
            }, [id]);

            useEffect(function () {
                if (!id || !pick) { setBody(null); return; }
                var alive = true;
                readOne(id, pick).then(function (d) {
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
                        <CardTitle>{title + ' — ' + files.length + ' file(s)'}</CardTitle>

                        {/* THE NOTE IS A SUBTITLE ONLY WHEN THERE ARE FILES, and
                            it is the EMPTY STATE when there are none.

                            BOTH AT ONCE IS WHAT THE FIRST VERSION DREW, and it
                            put two sentences saying the same thing one above the
                            other: the action's own "nothing was handed over, a
                            run hands one over by calling okc-artifact" and the
                            caller's "nothing was handed back". Each was right and
                            together they read as a stutter.

                            THE ACTIONS ALREADY DIFFER WELL, which is the part
                            worth keeping. `taskFiles` names the helper a run
                            would have called; `judgementFindings` distinguishes a
                            judge that read and found nothing from a run that
                            CRASHED before reading a line. Neither could be
                            written here. */}
                        {files.length && list.note ? <CardSub>{list.note}</CardSub> : null}

                        {files.length ? (
                            //ONE CARD PER FILE, each with its own "Read it". A row
                            //of identical buttons under a list of names makes
                            //somebody match the third button to the third name; a
                            //card puts the press next to the thing it presses.
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
                        ) : (empty || <Empty>{list.note || 'Nothing was handed back.'}</Empty>)}
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
                                This is the run&apos;s own recommendation, in the words its prompt asked it to
                                end on. It is what the run SAID rather than what anybody decided.
                            </CardSub>
                        </Panel>
                    ) : null}

                    {/* ONLY WHEN SOMETHING IS BEING READ. An empty "nothing to
                        read" panel under a list of files somebody has not pressed
                        yet is a panel reporting on a question nobody asked. */}
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
};
