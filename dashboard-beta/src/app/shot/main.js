var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

//photograph the window.
//
//WHY AN APP SHOULD BE ABLE TO PHOTOGRAPH ITSELF. Ten tabs were built here
//without anybody looking at the screen: they compiled, they typechecked, the
//data arrived over the socket, and every one of them was invisible, because the
//container they sit in is hidden until it is also marked active. Every check
//that passed was answering a question other than "can you see it". A photograph
//answers that one, and having it as an ACTION means a terminal or a script can
//ask for it rather than only a person sitting in front of the window.
//
//---- why not capturePage, which is the obvious way -------------------------
//
//The app this is ported from does exactly that, from inside its own page:
//
//    nw.Window.get().capturePage(cb, { format: 'png', datatype: 'buffer' })
//
//Neither half of that is available here, and both for the same reason.
//
//IN THE PAGE: there is no `nw`. This app serves its window over http, and nw
//only injects node into pages loaded from the package itself — an http page is
//REMOTE and gets none. That is a property worth keeping rather than a defect to
//route around: it is exactly why the same page also runs in an ordinary browser
//tab. `node-remote` in package.json would hand it node, and a screenshot is not
//worth giving a web page the filesystem.
//
//FROM THE NODE SIDE: capturePage on the Window handle never calls back. Not
//slow — measured at ten seconds and again at thirty, with the window open and
//painting. The background page has no more rights over a remote page's content
//than the remote page has over node.
//
//---- so: the debugger, which is already switched on ------------------------
//
//tools/nw.js passes --remote-debugging-port=0 on every launch, so chromium picks
//a free port, writes it to DevToolsActivePort in the user data dir, and listens
//on loopback. It is there for "Inspect main.js" on the tray. The same protocol
//takes a screenshot of a page, remote or not, without the page needing any
//privilege at all — which is the whole point of it being a debugger.

plugin.consumes = ['actions', 'app', 'http', 'dataDir'];
plugin.provides = [];
async function plugin(imports, register) {
    var actions = imports.actions;
    var app = imports.app;
    var httpService = imports.http;

    var shots = path.join(app.root, 'shots');

    //chromium writes the port on its first line and the browser's own websocket
    //path on the second. The directory is nw's user data, named after the app.
    function debuggerPort() {
        //Same directory the rest of this app's data lives in, and worked out
        //in one place — ../datadir, which says why it moves if the package is
        //renamed and what stops working when it does.
        var file = imports.dataDir.at('User Data', 'DevToolsActivePort');
        var said = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
        if (!said) throw new Error('DevToolsActivePort is empty');
        return Number(said);
    }

    function get(port, route) {
        return new Promise(function (resolve, reject) {
            http.get({ host: '127.0.0.1', port: port, path: route }, function (res) {
                var body = '';
                res.on('data', function (c) { body += c; });
                res.on('end', function () {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('the debugger answered with something that was not JSON')); }
                });
            }).on('error', reject);
        });
    }

    function screenshot(wsUrl) {
        var WebSocket = require('ws');
        return new Promise(function (resolve, reject) {
            var ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
            var settled = false;
            var done = function (fn, v) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) { /* already closing */ }
                fn(v);
            };
            var timer = setTimeout(function () {
                done(reject, new Error('the debugger did not answer within 20s'));
            }, 20000);

            ws.on('error', function (e) { done(reject, e); });
            ws.on('open', function () {
                ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
            });
            ws.on('message', function (raw) {
                var msg;
                try { msg = JSON.parse(raw); } catch (e) { return; }
                if (msg.id !== 1) return;//events and other replies share this socket
                if (msg.error) return done(reject, new Error(msg.error.message || 'the debugger refused'));
                done(resolve, msg.result && msg.result.data);
            });
        });
    }

    var undo = actions.define('windowShot', {
        about: 'Photograph the window and save it, so what is on screen can be looked at from outside',
        takes: ['name'],
        run: async function (args) {
            var win = app.services.window;
            if (!app.isNw) throw new Error('there is no window to photograph — this app is running without nw');
            if (!win || !win.isOpen) throw new Error('the window is closed — open it from the tray, or restart the app');

            var port = debuggerPort();
            var targets = await get(port, '/json/list');

            //THE PAGE, NOT THE BACKGROUND PAGE. Both are targets and only one of
            //them is what anybody means by "the window": main.js runs in a page
            //too, and photographing it would return a blank one, which is the
            //kind of evidence that is worse than none.
            var url = httpService.url || '';
            var page = targets.filter(function (t) { return t.type == 'page'; })
                .find(function (t) { return url && t.url && t.url.indexOf(url) === 0; })
                || targets.find(function (t) { return t.type == 'page' && t.url && t.url.indexOf('http') === 0; });

            if (!page) {
                throw new Error('the debugger lists no page at ' + (url || 'this app\'s url') +
                    ' — it has ' + targets.map(function (t) { return t.type; }).join(', '));
            }

            var b64 = await screenshot(page.webSocketDebuggerUrl);
            if (!b64) throw new Error('the debugger answered with no image');

            fs.mkdirSync(shots, { recursive: true });
            var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            var name = args && args.name ? String(args.name).replace(/[^\w-]/g, '-') + '-' : '';
            var file = path.join(shots, name + stamp + '.png');
            var bytes = Buffer.from(b64, 'base64');
            fs.writeFileSync(file, bytes);
            return { file: file, bytes: bytes.length, of: page.url };
        }
    });

    await register(null, {
        onDestroy: function () { undo(); }
    });
}
module.exports = plugin;
