//the same plugin, seen from the app's node half.
//
//the window itself is owned by ./main.js, because it has to outlive the bundle
//this half lives in. what arrives here is a controller, handed over on the host.

plugin.consumes = ['app'];
plugin.provides = ['window'];
async function plugin(imports, register) {
    var control = imports.app.host.window;

    //no nw at all under plain node
    if (!control) return register(null, { window: void 0 });

    await register(null, {
        window: {
            get url() { return control.url; },
            get isOpen() { return control.isOpen; },
            open: function () { control.open(); },
            show: function () { control.show(); },
            hide: function () { control.hide(); },
            openInBrowser: function () { control.openInBrowser(); },
            quit: function (reason) { control.quit(reason); }
        }
    });
}
module.exports = plugin;
