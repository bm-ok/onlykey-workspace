var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//SOMEWHERE TO SEND THE PROMPT.
//
//THIS PANE EXISTS BECAUSE OF ONE SENTENCE: "it gave me a prompt with nowhere to
//send it." A session had laid a branch down on a machine, signed Claude in on
//it, and then written out thirty lines of briefing with the instruction to open
//a terminal and paste them — because it did not know there was a door.
//
//THERE IS ONE, AND IT IS NOT THE QUEUE'S. `vmDispatch` takes a machine by NAME
//— "give a machine a task to work on, and return without waiting for it". The
//tick calls it once it has decided which machine; nothing about it belongs to
//the tick. A prompt typed here and sent with it is the whole of "a worker lane
//with no queue in it".
//
//AND WATCHING IT IS THE OTHER HALF. `vmSessions` and `vmSessionTail` read the
//Claude session ON the machine — what it was asked, what it ran, what it wrote,
//and the lines of a result that carry a verdict. That pair was already being
//used by hand, from the command line, while somebody watched the same run
//through an editor window. It belongs under the box that started it.
//
//NOT QUEUED, NOT JUDGED, NOT SWEPT. Said on the pane, because everything else
//that looks like this pane IS those things, and a person who assumes the loop
//will pick this up is a person whose work sits there.
//---------------------------------------------------------------------------

//WHAT A LINE OF A SESSION IS, coloured by whether it is somebody talking, the
//model acting, or something coming back. The kinds are the guest's own words —
//see dist/guest/session.js, which decides them while reading the transcript.
var KIND = {
    'said-to-it': 'run',
    text: '',
    asked: 'warn',
    ran: '',
    wrote: 'ok',
    edited: 'ok',
    result: ''
};

module.exports = function work(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Skeleton, Empty, Note, Notice, Mono, Muted, Editor, ask
    } = theme;

    function isMine(v) {
        if ((v.tags || []).indexOf('supervisor') >= 0) return false;
        return !!v.borrowed || v.forTasks === false || !!v.branch;
    }

    function Line({ e }) {
        return (
            <Card>
                <CardTitle>
                    <Badge kind={KIND[e.kind] == null ? '' : KIND[e.kind]}>{e.kind}</Badge>{' '}
                    <Muted>{String(e.at || '').slice(11, 19)}</Muted>
                </CardTitle>
                <CardSub><Mono>{e.text}</Mono></CardSub>
            </Card>
        );
    }

    function Work() {
        var { state: got } = okc.use('vmList', {}, 5000);
        //THE SAME PICK THE OTHER PANE MADE. Two panes about one machine that
        //each remember their own selection is two machines as far as anybody
        //reading them is concerned.
        var [picked, setPicked] = remember.use('diy', 'machine', null);
        var [prompt, setPrompt] = useState('');
        var [sess, setSess] = useState(null);
        var [said, setSaid] = useState(null);
        var [sending, setSending] = useState(false);

        //---- WHAT IS ON THE MACHINE, ASKED SLOWLY --------------------------
        //
        //EVERY ONE OF THESE PUTS SHELL DOWN A CHANNEL and waits for a machine to
        //answer, which is not the five-second poll a register read is. Ten and
        //fifteen seconds rather than five, and nothing is asked at all until a
        //machine is picked — ../core/okc/ask.js takes a falsy action to mean
        //"not yet", which is how a pane with a selection avoids asking a
        //question that has no answer.
        var { state: list } = okc.use(picked ? 'vmSessions' : null, { name: picked }, 15000);

        var sessions = (list && list.sessions) || [];
        //NEWEST UNLESS SOMETHING WAS CHOSEN. The guest sorts them by when they
        //last moved, so the top one is the conversation that is happening.
        var which = sess || (sessions[0] && sessions[0].id) || null;

        var { state: tail, error: tailError } = okc.use(
            picked && which ? 'vmSessionTail' : null,
            { name: picked, session: which, since: 0, limit: 40 }, 10000);

        var all = (got && got.vms) || [];
        var rows = all.filter(isMine);
        var on = all.filter(function (v) { return v.name == picked; })[0] || null;

        function send() {
            var task = String(prompt || '').trim();
            if (!task) { setSaid({ bad: true, text: 'There is nothing to send.' }); return; }
            if (!on) { setSaid({ bad: true, text: 'Pick a machine first.' }); return; }

            ask({
                title: 'Send this to ' + on.name + '?',
                plain: [
                    'It starts Claude on the machine with this as its brief, in the workspace that is on it, and '
                        + 'returns without waiting.',
                    on.branch ? 'Anything it commits goes on ' + on.branch + '.' : 'The machine is claiming no branch.',
                    'Nothing queues this, nothing judges what comes back, and no pull request is cut from it.'
                ],
                //A CONTINUATION IS A DIFFERENT ACT FROM A NEW BRIEF, and the
                //difference is one field. `resume` is a session id, handed
                //straight to `claude --resume` on the machine — so the second
                //message carries on the conversation rather than meeting a model
                //that has never heard of the first.
                fields: which ? [{
                    name: 'carry', type: 'checkbox', label: 'Carry on the session below',
                    hint: 'Continues ' + String(which).slice(0, 8) + ' instead of starting a new conversation.'
                }] : [],
                confirm: 'Send it',
                onYes: function (f) {
                    setSending(true);
                    return okc.call('vmDispatch', {
                        name: on.name,
                        task: task,
                        resume: f && f.carry ? which : undefined
                    }).then(function (r) {
                        setSending(false);
                        setPrompt('');
                        setSaid({ text: (r && r.note) || ('Sent to ' + on.name + '. It runs there; what it does appears below.') });
                    }, function (e) {
                        setSending(false);
                        setSaid({ bad: true, text: e.message });
                        throw e;
                    });
                }
            });
        }

        if (!got) return <Pane><Skeleton rows={4} /></Pane>;

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>Mine<Grow /><span className="muted">{rows.length}</span></TitleRow>
                        <Stack>
                            {rows.length
                                ? rows.map(function (v) {
                                    return (
                                        <Card key={v.name} pick on={v.name == picked}
                                            onClick={function () { setPicked(v.name); setSess(null); }}>
                                            <CardTitle><Mono>{v.name}</Mono></CardTitle>
                                            <CardSub>
                                                {v.branch ? <Mono>{v.branch}</Mono> : <Muted>claims nothing</Muted>}
                                            </CardSub>
                                        </Card>
                                    );
                                })
                                : <Empty>No machine is yours yet. Take one on My machine.</Empty>}
                        </Stack>

                        {sessions.length ? <TitleRow>Sessions<Grow /><span className="muted">{sessions.length}</span></TitleRow> : null}
                        <Stack>
                            {sessions.map(function (s) {
                                return (
                                    <Card key={s.id} pick on={s.id == which} onClick={function () { setSess(s.id); }}>
                                        <CardTitle><Mono>{String(s.id).slice(0, 8)}</Mono></CardTitle>
                                        <CardSub>
                                            {s.title || <Muted>untitled</Muted>}
                                            {s.idle != null ? <span>{' '}<Muted>{'— quiet ' + s.idle + 's'}</Muted></span> : null}
                                        </CardSub>
                                    </Card>
                                );
                            })}
                        </Stack>
                    </Col>

                    <Col>
                        <TitleRow>
                            What to do<Grow />
                            <span className="muted">{on ? on.name : 'nothing selected'}</span>
                        </TitleRow>
                        {/* AN EDITOR RATHER THAN A ONE-LINE FIELD, because what
                            goes in here is a briefing. The one that had nowhere
                            to go was thirty lines: where the repositories are,
                            what not to touch, what the job is, and which branch
                            to commit on. ../ui/editor defaults to plain text and
                            says why — most of what this app puts up to be read is
                            prose. */}
                        <Editor text={prompt} editable min={14} onChange={setPrompt} />
                        <div className="row" style={{ marginTop: '8px' }}>
                            <Button kind="ok" disabled={!on || !prompt.trim() || sending}
                                title={!on ? 'pick a machine' : !prompt.trim() ? 'nothing to send' : 'start it on the machine'}
                                onClick={send}>{sending ? 'Sending...' : 'Send it'}</Button>
                            <Button disabled={!on}
                                title="stop whatever is running on it"
                                onClick={function () {
                                    ask({
                                        title: 'Stop what is running on ' + (on ? on.name : '') + '?',
                                        plain: ['Whatever it has already written stays. It is not asked to tidy up.'],
                                        confirm: 'Stop it',
                                        onYes: function () {
                                            return okc.call('vmRunStop', { name: on.name }).then(function (r) {
                                                setSaid({ text: (r && r.note) || 'Stopped.' });
                                            }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                                        }
                                    });
                                }}>Stop</Button>
                        </div>
                        <Note>This is your own lane. It is not queued, nothing judges what comes back, and no pull
                            request is cut from it — that is what the Queue and Judge tabs are for.</Note>
                    </Col>

                    <Col wide>
                        <TitleRow>
                            What it is doing<Grow />
                            {tail && tail.session
                                ? <Muted>{(tail.session.title || 'untitled') + ' — ' + tail.bookmark + ' lines'}</Muted>
                                : null}
                        </TitleRow>
                        {!picked ? <Empty>Pick a machine.</Empty> : null}
                        {picked && tailError ? <Note kind="bad">{tailError}</Note> : null}
                        {picked && !tailError && !which ? <Empty>No Claude session on this machine yet. Send it something.</Empty> : null}
                        {picked && tail && tail.entries
                            ? <Stack>
                                {tail.entries.length
                                    ? tail.entries.slice().reverse().map(function (e, i) {
                                        return <Line key={e.line + '-' + i} e={e} />;
                                    })
                                    : <Empty>the session has said nothing yet</Empty>}
                            </Stack>
                            : null}
                        {tail && tail.more ? <Note>{tail.more + ' earlier lines not shown'}</Note> : null}
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Work;
};
