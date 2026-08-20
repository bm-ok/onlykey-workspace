//the server side of the conversation, in one function so both halves can run
//it: the node half against the real socket.io, and the window half against an
//in-memory pair when there is nothing on the wire. see ./mock.js

module.exports = function serve(io, appPackage) {
    io.on('connection', function (socket) {

        //the window has no node, so it asks for this rather than reading it
        socket.emit('app', appPackage);

        //example call, delete it
        socket.on('ping', function (data, ack) {
            if (ack) ack({ pong: true, pid: (typeof process == 'undefined' ? 'mock' : process.pid) });
        });
    });
};
