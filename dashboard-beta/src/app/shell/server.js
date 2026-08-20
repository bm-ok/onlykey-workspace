//`show` — put a tab, or a pane inside it, on screen.
//
//WHY AN ACTION FOR SOMETHING A PERSON DOES WITH A CLICK. Because not everything
//looking at this app is a person. A photograph is only evidence of the pane that
//happened to be showing, so verifying eleven tabs meant asking somebody to click
//eleven times and take eleven pictures — which is exactly the kind of checking
//that does not get done.
//
//Two small actions rather than one big one: `show` puts something on screen and
//`windowShot` photographs what is there. Composed from a terminal that is
//    okc show --tab Repositories --pane Lines && okc windowShot
//and neither had to know about the other.
//
//IT DRIVES THE WINDOW, WHICH IS A REAL POWER. Worth saying plainly: this reaches
//into the page and changes what somebody is looking at. It is navigation and
//nothing else — it cannot press a button, fill a field or approve anything — but
//the line between "show me that" and "do that for me" is one to keep on purpose
//rather than by accident.

plugin.consumes = ['app'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var io = host.io;
    var actions = host.actions;

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../okc/server.js.
    if (!actions) return register(null, {});

    var undo = actions.define('show', {
        about: 'Put a tab on screen, or a pane inside it, so it can be looked at or photographed',
        takes: ['tab', 'pane'],
        run: async function (args) {
            var want = { tab: args && args.tab, pane: args && args.pane };
            if (!want.tab && !want.pane) throw new Error('say which: --tab, or --pane, or both');

            var pages = [...io.sockets.sockets.values()];
            if (!pages.length) throw new Error('no page is connected — the window may be closed, or still loading');

            //ASKED OF EVERY PAGE, and the answer comes back from each. A browser
            //tab and the window are both real clients here; showing something in
            //one and photographing the other would be a picture of the wrong
            //thing, so both are moved.
            var said = await Promise.all(pages.map(function (p) {
                return new Promise(function (resolve) {
                    p.timeout(5000).emit('shell:show', want, function (err, answer) {
                        resolve(err ? { ok: false, error: 'a page did not answer' } : answer);
                    });
                });
            }));

            var worked = said.filter(function (s) { return s && s.ok; });
            if (!worked.length) {
                throw new Error((said[0] && said[0].error) || 'no page could show that');
            }
            return worked[0];
        }
    });

    await register(null, {
        onDestroy: function () { undo(); }
    });
}
module.exports = plugin;
