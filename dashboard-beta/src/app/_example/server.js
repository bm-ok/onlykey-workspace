//the node half of the example plugin. delete this folder and build your own.

plugin.consumes = ['app', 'appPackage', 'tray'];
plugin.provides = [];
async function plugin(imports, register) {
    var { app, appPackage, tray } = imports;

    //host.router, not the express app: the router is replaced on every reload,
    //so routes come and go with it rather than stacking up
    app.host.router.get('/api/hello', function (req, res) {
        res.json({ hello: appPackage.title, pid: process.pid, tray: tray ? tray.labels() : [] });
    });

    //tray is undefined under `npm run dev`, where there is no nw.js
    var item = tray && tray.add({
        label: 'Say hello in the log',
        click: function () { console.log('hello from the tray, pid ' + process.pid); }
    });

    await register(null, {
        //the item comes back off the menu when this half reloads
        onDestroy: function () { if (item) item.remove(); }
    });
}
module.exports = plugin;
