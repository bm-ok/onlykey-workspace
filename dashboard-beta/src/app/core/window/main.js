//the nw.js window. it is a view onto a server that outlives it.

plugin.consumes = ['app', 'http', 'lifecycle'];
plugin.provides = ['window'];
async function plugin(imports, register, config) {
    var { app, http, lifecycle } = imports;

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

    await register(null, {
        window: {
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

            //the tray calls this once there is somewhere to reopen from
            closeShouldHide: function (yes) { onClose = yes ? 'hide' : 'quit'; }
        },
        onDestroy: function () {
            try { if (keepAlive) keepAlive.close(true); } catch (e) { /* already gone */ }
            keepAlive = null;
        }
    });
}
module.exports = plugin;
