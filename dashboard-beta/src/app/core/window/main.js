//the nw.js window. it is a view onto a server that outlives it.

plugin.consumes = ['actions', 'app', 'http', 'lifecycle'];
plugin.provides = ['window'];
async function plugin(imports, register, config) {
    var { app, http, lifecycle } = imports;
    var actions = imports.actions;

    //this same list runs under plain node too, where there is no
    //window to open and nothing to open it with
    if (!app.isNw) return register(null, { window: void 0 });

    var size = config.window || {};
    var win = null;
    var keepAlive = null;

    //'quit' until something says otherwise. the tray switches it to 'hide' if
    //it manages to create an icon, since without one there would be no way back
    //to a hidden window.
    var onClose = 'quit';

    //nw quits when the last window closes. intercepting close and hiding is the
    //tidy way around that, but the listener does not survive a page reload --
    //and the window half full-reloads on any change it cannot hot swap, so the
    //tidy way stops working the first time you edit anything. this window is
    //never shown and never closed, so the count never reaches zero and the app
    //survives either way: hidden if the interception held, closed and reopened
    //fresh if it did not.
    nw.Window.open('about:blank', { id: 'keepalive', show: false }, function (w) {
        keepAlive = w;
    });

    function open() {
        if (!http.url) return console.error('nothing is listening yet');

        nw.Window.open(http.url, {
            id: 'main',
            width: size.width || 1640,
            height: size.height || 1040
        }, function (w) {
            if (!w) return lifecycle.shutdown('the window failed to open');
            win = w;

            //listening to `close` at all suppresses nw's default close, which is
            //why the other two paths have to close(true) by hand
            function attach() {
                try { win.removeAllListeners('close'); win.removeAllListeners('closed'); }
                catch (e) { /* nothing attached yet */ }

                win.on('close', function () {
                    if (lifecycle.isShuttingDown || onClose != 'hide') return this.close(true);
                    this.hide();
                    console.log('window hidden, still running. reopen it from the tray.');
                });

                win.on('closed', function () {
                    win = null;
                    if (onClose != 'hide') lifecycle.shutdown('the window was closed');
                });
            }

            attach();
            win.on('loaded', attach);//best effort after a reload, see above
        });
    }

    //---- AND THE PAGE HAS TO ASK FOR IT -----------------------------------
    //
    //DEFINED IN MAIN, WHERE `nw` IS. The window is served over http and is a
    //REMOTE page as far as nw is concerned, so it has no `nw`, no node, and no
    //way to reach the operating system — see ../shot/main.js, which calls that a
    //property worth keeping. This is the one door through it, and it opens onto
    //exactly one thing.
    //
    //IT IS NOT ON THE SUPERVISOR'S LIST and must not go on it. Opening a browser
    //on somebody's desk at an address a model chose is a way to put a page in
    //front of a person under this app's name.
    var stopOpening = actions.define('openExternally', {
        about: "Open an http address in the person's own browser, outside this app",
        takes: ['url'],
        run: function (args) {
            return { opened: theWindow.openExternally((args || {}).url) };
        }
    });

    //NAMED SO THE ACTION ABOVE CAN REACH IT before `register` has handed it out.
    var theWindow = {
            get isOpen() { return !!win; },
            get current() { return win; },

            open: open,

            show: function () {
                if (win) {
                    try { win.show(); win.focus(); return; }
                    catch (e) { win = null; }//gone out from under us
                }
                open();
            },

            hide: function () { if (win) win.hide(); },

            //---- AND AN ADDRESS THAT LEAVES THIS APP ENTIRELY --------------
            //
            //THE PAGE CANNOT DO THIS AND NEVER WILL. This app serves its window
            //over http, and nw only injects node into pages loaded from the
            //package — an http page is REMOTE and gets none. ../shot/main.js
            //says so about screenshots and calls it "a property worth keeping
            //rather than a defect to route around": it is exactly why the same
            //page runs in an ordinary browser tab.
            //
            //SO THE PAGE ASKS, and this half — which is nw — does it. The
            //window's own attempt was `nw.Shell` in the pane, which is
            //undefined there, falling back to a plain `<a target="_blank">`;
            //under nw that opens ANOTHER NW WINDOW rather than the person's
            //browser, and a sign-in page opened inside this app is the one
            //place it must not be.
            //
            //`http:` AND `https:` ONLY. Everything else a shell would hand to
            //the operating system — `file:`, and on Windows anything it has an
            //association for — is a way to start a program from a string, and
            //the strings here arrive from GitHub and from a machine.
            openExternally: function (href) {
                var url = String(href == null ? '' : href).trim();
                if (!/^https?:\/\//i.test(url)) {
                    throw new Error('only http and https addresses are opened, and that is "' + url + '"');
                }
                nw.Shell.openExternal(url);
                return url;
            },

            //the tray calls this once there is somewhere to reopen from
            closeShouldHide: function (yes) { onClose = yes ? 'hide' : 'quit'; }
    };

    await register(null, {
        window: theWindow,
        onDestroy: function () {
            stopOpening();
            try { if (keepAlive) keepAlive.close(true); } catch (e) { /* already gone */ }
            keepAlive = null;
        }
    });
}
module.exports = plugin;
