//the window half of the okc plugin: one way to ask the running dashboard
//something. its node half, in ./server.js, holds the socket.
//
//NO UI HERE ON PURPOSE. This is the transport and nothing else, so a tab that
//wants data consumes `okc` and knows nothing about sockets, and this file can
//change how it reaches the dashboard without touching a single tab.
//
//ONE CALL, BY NAME. The dashboard's whole surface is a table of named actions —
//its own window, its CLI and its drills all reach it the same way — so there is
//one function here rather than a method per action. A per-action wrapper would
//be a second list to keep in step with a table that already exists.

plugin.consumes = ['io'];
plugin.provides = ['okc'];
async function plugin(imports, register) {
    var io = imports.io;
    var up = false;
    var listeners = [];

    function announce(v) {
        up = !!v;
        listeners.forEach(function (fn) { fn(up); });
    }

    io.on('okc:up', announce);

    //ASKED ONCE, BECAUSE THE ANNOUNCEMENT MAY ALREADY HAVE HAPPENED. The server
    //emits on connection; this plugin attaches its listener when the graph
    //reaches it, which is afterwards. Waiting to be told left the dot red over
    //a panel that was plainly working.
    io.emit('okc:up?', {}, announce);

    function call(action, args) {
        return new Promise(function (resolve, reject) {
            io.emit('okc:call', { action: action, args: args || {} }, function (reply) {
                if (reply && reply.ok) resolve(reply.result);
                else reject(new Error((reply && reply.error) || 'no answer from the dashboard'));
            });
        });
    }

    await register(null, {
        okc: {
            //THE SOCKET ITSELF, for the one caller that needs more than
            //`call`: the shell listens for navigation pushed from outside. Not
            //handed out casually — a tab that reached for this instead of
            //`call` would be talking to the wire rather than to the table.
            io: io,
            call: call,
            get connected() { return up; },
            //WHETHER THE DASHBOARD IS THERE IS EVERY TAB'S BUSINESS, and it
            //changes often — it is restarted whenever its own code is worked
            //on. Subscribing beats each tab polling for it.
            onUp: function (fn) {
                listeners.push(fn);
                fn(up);
                return function () { listeners = listeners.filter(function (x) { return x != fn; }); };
            }
        }
    });
}
module.exports = plugin;
