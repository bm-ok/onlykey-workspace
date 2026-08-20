//the tray icon, and the menu other plugins add to.
//
//this is what makes closing the window survivable: without somewhere to reopen
//from, hiding a window would strand the app with no way back.

plugin.consumes = ['app', 'http', 'window', 'lifecycle'];
plugin.provides = ['tray'];
async function plugin(imports, register, config) {
    var { app, http, window: win, lifecycle } = imports;

    if (!app.isNw) return register(null, { tray: void 0 });

    var tray = null;//module scope on purpose: a collected Tray takes its icon with it
    var items = [];//what other plugins added, replayed on every rebuild

    //rebuilt whole rather than patched: plugins come and go on every reload, and
    //removing by index is how menus end up with the wrong item on them
    function rebuild() {
        if (!tray) return;//items added before the tray exists are applied when it does

        var menu = new nw.Menu();

        items.forEach(function (entry) { menu.append(new nw.MenuItem(entry.options)); });
        if (items.length) menu.append(new nw.MenuItem({ type: 'separator' }));

        menu.append(new nw.MenuItem({ label: 'Open window', click: function () { win.show(); } }));
        menu.append(new nw.MenuItem({
            label: 'Open in browser',
            click: function () { nw.Shell.openExternal(http.url); }
        }));
        menu.append(new nw.MenuItem({ type: 'separator' }));
        menu.append(new nw.MenuItem({
            label: 'Quit',
            click: function () { lifecycle.shutdown('quit from the tray'); }
        }));

        tray.menu = menu;
        console.log('tray menu: ' + menu.items.map(function (i) { return i.label || '--'; }).join(' | '));
    }

    await register(null, {
        tray: {
            get available() { return !!tray; },

            //options are nw.MenuItem's: label, click, type, checked, enabled,
            //tooltip, icon, submenu, key, modifiers. returns a handle, so
            //whoever added an item can take it back when they go
            add: function (options) {
                var entry = { options: options };
                items.push(entry);
                rebuild();
                return {
                    remove: function () {
                        var i = items.indexOf(entry);
                        if (i >= 0) { items.splice(i, 1); rebuild(); }
                    }
                };
            },

            labels: function () { return items.map(function (e) { return e.options.label; }); },

            //called once the server is up, when there is a url for the tooltip
            start: function () {
                try {
                    tray = new nw.Tray({
                        title: app.appPackage.title,
                        //relative on purpose: nw resolves it against the app,
                        //so the same value works from the source tree and from
                        //inside a package. an icon path that does not resolve
                        //is not an error — you get an invisible tray entry.
                        icon: (config.tray && config.tray.icon) || 'icon.png'
                    });
                    tray.tooltip = app.appPackage.title + ' — ' + http.url;//see nw.js issue 1903

                    //left click opens the window on windows and linux; on mac the
                    //menu is the only interaction, so the same actions live in it
                    tray.on('click', function () { win.show(); });

                    win.closeShouldHide(true);
                    rebuild();
                } catch (e) {
                    console.error('no tray available, closing the window will quit: ' + (e && e.message || e));
                }
            }
        },
        onDestroy: function () {
            try { if (tray) tray.remove(); } catch (e) { /* already gone */ }
            tray = null;
        }
    });
}
module.exports = plugin;
