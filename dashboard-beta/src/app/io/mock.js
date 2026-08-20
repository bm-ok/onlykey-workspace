//a socket.io shaped pair of endpoints, in memory. because both halves of a
//plugin are in the client bundle too, the browser can run the server half
//against this when nothing answers on the wire — a live mock made of the real
//server code rather than a second implementation of it.

function endpoint() {
    var handlers = {};
    return {
        peer: null,
        id: 'mock',
        on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); return this; },
        once: function (name, fn) {
            var self = this;
            var wrap = function () { self.off(name, wrap); fn.apply(null, arguments); };
            return self.on(name, wrap);
        },
        off: function (name, fn) {
            if (!handlers[name]) return this;
            handlers[name] = handlers[name].filter(function (h) { return h != fn; });
            return this;
        },
        emit: function (name) {
            var args = Array.prototype.slice.call(arguments, 1);
            var peer = this.peer;
            setTimeout(function () {
                (peer.$handlers[name] || []).slice().forEach(function (fn) { fn.apply(null, args); });
            }, 0);
            return this;
        },
        get $handlers() { return handlers; }
    };
}

//returns { io, socket }: `io` looks like the socket.io server (io.on('connection')),
//`socket` looks like the client's connected socket.
module.exports = function mockPair() {
    var serverSide = endpoint();
    var clientSide = endpoint();
    serverSide.peer = clientSide;
    clientSide.peer = serverSide;

    var io = {
        on: function (name, fn) {
            if (name == 'connection') setTimeout(function () { fn(serverSide); }, 0);
            return io;
        },
        emit: function () { serverSide.emit.apply(serverSide, arguments); return io; }
    };

    return { io, socket: clientSide };
};
