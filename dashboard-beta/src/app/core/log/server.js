//the same log, seen from the app's node half.
//
//the lines are owned by ./main.js because they outlive this bundle — a save
//rebuilds everything here and the log is what tells you what happened before it.
//what arrives here is that same object, handed over on the host.
//
//WHATEVER ELSE HAPPENS, `log.on(...)` ANSWERS. Every action module ported into a
//plugin logs, and the test suite builds this half against a bare host with no
//main behind it. Handing back `undefined` there — which is what ../tray does,
//correctly, because a menu that is not there is a real answer — would turn every
//one of those call sites into a null check, and the first one somebody forgot
//would be a crash in an error path. So a log with nowhere to go quietly keeps
//the shape and drops the line.

plugin.consumes = ['app'];
plugin.provides = ['log'];
async function plugin(imports, register) {
    var log = imports.app.host && imports.app.host.log;

    if (!log) {
        var nowhere = {
            info: function () {}, good: function () {}, warn: function () {},
            bad: function () {}, out: function () {},
            on: function () { return nowhere; }
        };
        return register(null, {
            log: {
                add: function () {},
                on: function () { return nowhere; },
                since: function () { return []; },
                tags: function () { return []; },
                subscribe: function () { return function () {}; },
                clear: function () {},
                all: function () { return []; },
                keeper: function () { return function () {}; }
            }
        });
    }

    await register(null, { log: log });
}
module.exports = plugin;
