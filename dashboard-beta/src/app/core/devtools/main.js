var fs = require('fs');
var path = require('path');
var http = require('http');

//devtools for either half, on the tray, and neither opens by itself.

plugin.consumes = ['app', 'window', 'tray'];
plugin.provides = [];
async function plugin(imports, register) {
    var { app, window: win, tray } = imports;

    if (!app.isNw || !tray) return register(null, {});

    //the window is a normal nw window and can be told to show its own devtools
    function inspectWindow() {
        if (!win.isOpen) return win.show();//it opens, ask again once it is up
        try { win.current.showDevTools(); }
        catch (e) { console.error('showDevTools failed: ' + (e && e.message)); }
    }

    //main.js cannot do the same. it runs in _generated_background_page.html,
    //which nw does not treat as a window: nw.Window.get() throws "No current
    //window" there, with or without a window object passed to it. so this goes
    //through chromium's debugger instead. tools/nw.js starts nw with
    //--remote-debugging-port=0, chromium writes the port it chose into
    //DevToolsActivePort, and /json lists a frontend url per target. the node
    //context is the background_page one.
    function inspectMain() {
        //nw.App.dataPath is <user data>/Default and the port file is one level
        //up in <user data>. both are checked, layouts differ by platform.
        var dirs = [path.dirname(nw.App.dataPath), nw.App.dataPath];
        var port = null;
        for (var i = 0; i < dirs.length && !port; i++) {
            try {
                port = String(fs.readFileSync(path.join(dirs[i], 'DevToolsActivePort'), 'utf8'))
                    .split(String.fromCharCode(10))[0].trim();
            } catch (e) { /* try the next one */ }
        }
        if (!port) return console.error('no debugger port. start with --remote-debugging-port=0');

        http.get('http://127.0.0.1:' + port + '/json', function (res) {
            var body = '';
            res.on('data', function (c) { body += c; });
            res.on('end', function () {
                var target;
                try {
                    target = JSON.parse(body).find(function (t) { return t.type == 'background_page'; });
                } catch (e) { /* handled below */ }

                if (!target || !target.devtoolsFrontendUrl)
                    return console.error('the node context is not in the debugger target list');

                nw.Window.open('http://127.0.0.1:' + port + target.devtoolsFrontendUrl,
                    { width: 1200, height: 800 });
            });
        }).on('error', function (e) {
            console.error('could not reach the debugger on ' + port + ': ' + (e && e.message));
        });
    }

    var added = [
        tray.add({ label: 'Inspect window', click: inspectWindow }),
        tray.add({ label: 'Inspect main.js', click: inspectMain })
    ];

    await register(null, {
        onDestroy: function () { while (added.length) added.pop().remove(); }
    });
}
module.exports = plugin;
