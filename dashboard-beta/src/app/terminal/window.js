var React = require('react');
var useAsk = require('../okc/ask');

//---------------------------------------------------------------------------
//Terminal: shells that were started from a task, arriving here.
//
//NOT A PLACE WORK STARTS. Nothing on this tab opens a shell — a terminal
//arrives because somebody took a task and chose "in a terminal", which is the
//same act as choosing VS Code and lands the same way: the branch checked out,
//the machine signed in, one machine claimed. A button here that opened a shell
//would be a second way to claim a machine, beside the queue, with its own idea
//of the rules.
//
//THE SAME WAY IN AS EVERYTHING ELSE. Over ssh, with this app's own key — the
//same key `okc.js vmShell` prints and the same one VS Code connects with. So if
//one of the three works they all do, and if one fails it is the key rather than
//this tab.
//
//A MACHINE RUNNING WITH NO CONSOLE CAPTURED SAYS SO HERE, and that is the one
//piece of this pane that has caught a real problem. A console is captured for a
//machine that is running AND has its serial port on; a machine with the port off
//is running INVISIBLY, and showing the ordinary "no terminals are open" for it
//reads as nothing happening rather than as something happening unwatched. It was
//found exactly that way — an install running, and nothing here for it.
//
//THE LIVE HALF IS NOT BUILT, AND THIS PANE SAYS SO RATHER THAN LOOKING BROKEN.
//See the note below.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;
    var { Pane, Panel, TitleRow, Grow, Button, Skeleton, Empty, Note, Mono } = theme;

    function Terminal() {
        var q = useAsk(okc, 'vmList', {}, 8000);

        //RUNNING AND UNWATCHABLE. Only while one is actually running, so this is
        //silent on a quiet host.
        var dark = (((q.state && q.state.vms) || [])
            .filter(function (v) { return v.running && !v.serial; })
            .map(function (v) { return v.name; }));

        return (
            <Pane>
                <TitleRow>
                    <span>Terminal</span>
                    <Grow />
                    {/* THERE AND REFUSED, NOT ABSENT. Somebody who knows this
                        tab looks for this button; a missing one reads as a
                        different app, and a present one that says why reads as
                        this one with nothing open. */}
                    <Button disabled title="nothing is open to close">Close it</Button>
                </TitleRow>
                <Note>
                    Started from a task, and they arrive here. Over ssh, with this app&rsquo;s own key
                    &mdash; the same way in as <Mono>okc.js vmShell</Mono> and the same way VS Code
                    connects, so if one works they all do.
                </Note>

                <Panel>
                    <Empty>No terminals are open.</Empty>
                    <Empty>
                        They start from a task, the same way VS Code does &mdash; take a task and choose
                        &ldquo;in a terminal&rdquo;, and the shell lands here with the branch checked out and
                        the machine signed in. Then type <Mono>claude</Mono>, or anything else.
                    </Empty>

                    {!q.state ? <Skeleton rows={1} /> : null}
                    {dark.length ? (
                        <Note kind="warn">
                            {dark.join(', ') + (dark.length === 1 ? ' is' : ' are')
                                + ' running with no console being captured, so there is nothing to show for '
                                + (dark.length === 1 ? 'it' : 'them')
                                + '. The serial port is what makes a boot watchable, and VirtualBox will only'
                                + ' add one to a machine that is switched off — so this cannot be turned on'
                                + ' mid-install. An install turns it on by itself from now on.'}
                        </Note>
                    ) : null}

                    <Button onClick={function () { shell.go('Tasks', 'Board'); }}>Go to the tasks</Button>
                </Panel>

                {/* NOT BUILT, AND THE REASON IS NOT "IT WAS FIDDLY".
                    //
                    A live shell is not an action. Everything else on this tab —
                    and in this whole app — arrives over the one action socket
                    this half relays; a terminal is a separate websocket carrying
                    bytes both ways, and relaying it is a piece of plumbing
                    rather than a pane. Until that exists, an xterm here would be
                    a black square that never fills, which is worse than a
                    sentence.

                    What IS here is real: the tab is in its right place, the
                    empty state is the old one word for word, and the warning
                    about a machine running unwatched works — that is the part of
                    this pane that has ever caught anything. */}
                <Note kind="warn">
                    A terminal that is actually open cannot be shown here yet. Bytes to and from a shell
                    travel on their own websocket rather than through the action socket this half relays,
                    and that relay is not built &mdash; so a shell started from a task runs, and lands, and
                    is reachable with <Mono>okc.js vmShell</Mono>, but there is no window on it here.
                </Note>
            </Pane>
        );
    }

    //ITS PLACE IN THE ROW IS THE OLD WINDOW'S: Live, Terminal, Keys, Test, API.
    shell.tab({ name: 'Terminal', order: 90, Component: Terminal });

    await register(null, {});
}
module.exports = plugin;
