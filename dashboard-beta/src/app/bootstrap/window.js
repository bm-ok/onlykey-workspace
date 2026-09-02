var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//BACKING UP EVERYTHING THIS PROJECT HAS BEEN TAUGHT, AND PUTTING IT BACK.
//
//WHY THIS IS A PANE AND NOT TWO COMMANDS. Restoring is refused from the command
//line — see ./server.js, which says why — so without a control here it could not
//be done at all. Which it could not, for a while: the doors existed, the
//refusal was right, and there was no window in front of it.
//
//NOT IN Settings → General, WHICH SAYS OF ITSELF "this app, not this
//workspace". A bundle is exactly the other thing: the contracts, prompts, jobs
//and skills that belong to the folder of repositories that is open, and that
//diverge into that project's own as somebody edits them.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;

    //UNDER Settings, AND LAST. It is an occasional administrative act — the
    //kind of thing you go to Settings to do once and come back from — and it
    //sits after Guards and Cron because it is the rarest of the three.
    shell.pane({ tab: 'Settings', name: 'Bootstrap', order: 40, Component: makeBootstrap(theme, okc) });

    await register(null, {});
}
module.exports = plugin;

function makeBootstrap(theme, okc) {
    var {
        Pane, Panel, CardTitle, CardSub, Badge, Button, Note, Mono, Empty,
        Kv, KvRow, Notice, Skeleton, ask
    } = theme;

    var WORDS = { contract: 'contract', prompt: 'prompt', job: 'job', skill: 'skill' };

    function Bootstrap() {
        var { state, error, again } = okc.use('bootstrap', {}, 0);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={3} /></Pane>;

        var here = state.here || {};
        var total = Object.keys(here).reduce(function (n, k) { return n + (here[k] || 0); }, 0);

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: (r && r.note) || 'Done.' }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        //---- HANDING SOMEBODY A FILE -------------------------------------
        //
        //A FOLDER OF TWENTY-FIVE FILES IS THE RIGHT SHAPE ON DISK AND THE WRONG
        //ONE TO HAND A PERSON. Asking where to write it means knowing a path
        //before you have decided anything; a download is the question everybody
        //already knows how to answer, and it lands wherever they keep things.
        //
        //THE BYTES COME BACK BASE64 ON THE ACTION and become a Blob here. An
        //object URL is revoked after the click: one left behind holds the whole
        //bundle in memory for as long as the page lives.
        function download() {
            return okc.call('bootstrapFile', {}).then(function (r) {
                var raw = atob(r.bytes);
                var bytes = new Uint8Array(raw.length);
                for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

                var url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-tar' }));
                var a = document.createElement('a');
                a.href = url;
                a.download = r.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

                setSaid({ text: r.name + ' — ' + r.files + ' file(s), ' + Math.round(r.size / 1024) + 'KB. '
                    + r.note });
            }, function (e) { setSaid({ bad: true, text: e.message }); });
        }

        //---- AND TAKING ONE BACK -----------------------------------------
        //
        //THE FILE IS READ HERE AND THE BYTES ARE SENT, rather than the path: a
        //file chosen through a picker has no path this process can rely on, and
        //asking somebody to type one after they have just picked the file is
        //asking the same question twice.
        function pickAndRestore() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.tar';
            input.onchange = function () {
                var file = input.files && input.files[0];
                if (!file) return;

                var reader = new FileReader();
                reader.onload = function () {
                    var bytes = new Uint8Array(reader.result);
                    var chunk = 8192;
                    var parts = [];
                    for (var i = 0; i < bytes.length; i += chunk) {
                        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
                    }
                    fromFile(btoa(parts.join('')), file.name);
                };
                reader.onerror = function () { setSaid({ bad: true, text: 'That file could not be read.' }); };
                reader.readAsArrayBuffer(file);
            };
            input.click();
        }

        function fromFile(bytes, name) {
            ask({
                title: 'Restore from ' + name + '?',
                plain: [
                    'Everything in it that is not already here is written in, waiting to be read. Nothing can '
                        + 'run until somebody approves it.',
                    'Anything already here is LEFT ALONE unless you tick the box — an id that exists is not '
                        + 'overwritten by something that happens to share its name.',
                    'The three skills are written to this workspace’s own copy, so nothing the app ships is '
                        + 'touched.'
                ],
                fields: [
                    { name: 'over', label: 'Write over anything already here', kind: 'tick' }
                ],
                cost: 'It changes what a supervisor, a worker and a judge are each told they are.',
                confirm: 'Restore it',
                onYes: function (f) {
                    return tell(okc.call('bootstrapFromFile', { bytes: bytes, over: !!f.over }));
                }
            });
        }

        //---- THE ONE THAT SHIPPED, WHOSE PATH NOBODY HAS TO KNOW ---------
        //
        //THE OTHER TWO CONTROLS ASKED SOMEBODY TO TYPE A FOLDER, and typing a
        //path is guessing until you get it right — with no help, no completion,
        //and a refusal that only tells you it was wrong. A file picker and a
        //download are the two questions everybody already knows how to answer,
        //so those are the two this pane asks.
        //
        //THIS ONE KEEPS THE FOLDER DOOR because there is nothing to guess: the
        //path is the app's own, it comes down with the read, and it is on screen
        //above the button.
        function restoreShipped() {
            ask({
                title: 'Restore the set that shipped with this app?',
                plain: [
                    'Everything in it that is not already here is written in, waiting to be read. Nothing can '
                        + 'run until somebody approves it.',
                    //THE DEFAULT IS THE SAFE ONE AND THE DIALOG SAYS SO, because
                    //the dangerous half of restoring is landing on top of work
                    //somebody has been doing rather than on an empty drawer.
                    'Anything already here is LEFT ALONE unless you tick the box — an id that exists is not '
                        + 'overwritten by something that happens to share its name.',
                    'The three skills are written to this workspace’s own copy, so nothing the app ships '
                        + 'is touched.'
                ],
                fields: [
                    { name: 'over', label: 'Write over anything already here', kind: 'tick' }
                ],
                cost: 'It changes what a supervisor, a worker and a judge are each told they are.',
                confirm: 'Restore it',
                onYes: function (f) {
                    return tell(okc.call('bootstrapImport', { from: state.shipped, over: !!f.over }));
                }
            });
        }

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Panel>
                    <div className="head-row">
                        <CardTitle>What this workspace has been taught</CardTitle>
                        <div className="head-controls">
                            <Button kind="ok" onClick={download}>Save it as a file</Button>
                            <Button kind="ok" onClick={pickAndRestore}>Restore from a file</Button>
                        </div>
                    </div>
                    <CardSub>
                        The contracts, prompts, jobs and skills that belong to the folder of repositories that
                        is open. Delete the app’s data and every one of them goes with it.
                    </CardSub>

                    {total ? (
                        <Kv>
                            {Object.keys(WORDS).map(function (k) {
                                return (
                                    <KvRow key={k} label={WORDS[k] + 's'}>
                                        {(here[k] || 0) + ''}
                                    </KvRow>
                                );
                            })}
                        </Kv>
                    ) : (
                        <Empty>
                            Nothing here yet. If this is a fresh install, restore from the set that shipped
                            with the app below.
                        </Empty>
                    )}

                    <Note>
                        A bundle is one readable file per document and a manifest of the links between them —
                        a job names a prompt and a prompt names a contract, and that is the part you cannot
                        reconstruct by reading three folders.
                    </Note>
                </Panel>

                {/*---- AND THE ONE THAT SHIPPED ------------------------------

                    THE ANSWER TO "restore from what?" WHEN THERE IS NOTHING.
                    Somebody whose data directory has gone has no export of their
                    own to point at, and telling them to find a folder inside an
                    app they have just reinstalled is telling them to already
                    know the answer. */}
                <Panel>
                    <CardTitle>
                        {'The set that shipped with this app'}{' '}
                        {state.shipped ? <Badge kind="muted">there</Badge> : <Badge kind="bad">not there</Badge>}
                    </CardTitle>
                    <CardSub>
                        Enough of each to get a supervisor running and improving itself again. It is a seed,
                        not a copy of yours — what a project runs on diverges from this the moment somebody
                        edits one.
                    </CardSub>

                    {state.shipped ? (
                        <div>
                            <Kv>
                                <KvRow label="read from"><Mono>{state.shipped}</Mono></KvRow>
                            </Kv>
                            <Button kind="ok" protect
                                onClick={restoreShipped}>
                                Restore from it
                            </Button>
                        </div>
                    ) : (
                        <Empty>{state.note}</Empty>
                    )}
                </Panel>
            </Pane>
        );
    }

    return Bootstrap;
};
