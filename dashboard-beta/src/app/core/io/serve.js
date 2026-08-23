//the server side of the conversation, in one function so both halves can run
//it: the node half against the real socket.io, and the window half against an
//in-memory pair when there is nothing on the wire. see ./mock.js

module.exports = function serve(io, appPackage) {
    //NAMED, AND HANDED BACK, so it can be taken off again BY ITSELF.
    //
    //./server.js used to unhook with `removeAllListeners('connection')`, which
    //is a blunt instrument on an object it does not own: the socket.io server
    //is made in ./main.js and lives across every reload, so anything else that
    //had hooked `connection` was silently unhooked too — on the first save.
    //
    //../build/main.js is that anything else. It holds "the server half is down"
    //and repeats it to pages connecting afterwards, because the emit at the
    //moment of failure races the disconnect that same failure causes. That hook
    //was torn off by the first reload that worked, so the check for a broken app
    //worked exactly once per restart — which reads as intermittent, and an
    //intermittent check is one nobody believes.
    var onConnection = function (socket) {

        //the window has no node, so it asks for this rather than reading it
        socket.emit('app', appPackage);

        //example call, delete it
        socket.on('ping', function (data, ack) {
            if (ack) ack({ pong: true, pid: (typeof process == 'undefined' ? 'mock' : process.pid) });
        });
    };

    io.on('connection', onConnection);
    return onConnection;
};
