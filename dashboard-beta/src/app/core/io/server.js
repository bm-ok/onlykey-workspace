var serve = require('./serve');

//the handlers. reloaded on every save, so they come off again in onDestroy —
//otherwise each reload would leave another copy listening.

plugin.consumes = ['app'];
plugin.provides = ['io', 'appPackage', 'pages'];
async function plugin(imports, register) {
    var host = imports.app.host;

    serve(host.io, host.appPackage);

    //=======================================================================
    //WHICH PAGE IS THE ONE SOMEBODY IS LOOKING AT.
    //
    //MORE THAN ONE PAGE IS ORDINARY. A browser tab left open at this address is
    //a client and stays one for as long as it is open — including a tab from a
    //previous run that has stopped reloading and is holding a DOM from an hour
    //ago. So "the page" is a question with a wrong answer available, and it was
    //answered wrongly in two places independently.
    //
    //THE NEWEST ONE, and it is not a coin toss: a page that reloaded a moment
    //ago connected a moment ago, and a page that has been sitting there since
    //before the last three edits connected first. Taking the FIRST socket picks
    //the most likely dead one — which is what both callers did.
    //
    //IT IS HERE BECAUSE TWO PLUGINS ASKED IT. ../../debug-snapshot photographs
    //a page and ../drive presses buttons in one, and each had its own answer;
    //`capture` was fixed and `windowControls` was not, so a change could land in
    //the window, be served, be visible on screen, and be invisible to every tool
    //used to check it. Every "44 panes, 0 crashed" in this port came through the
    //unfixed one.
    //
    //`show` IS DELIBERATELY DIFFERENT and asks every page: they should all be
    //looking at the same thing. PRESSING a button in every page is pressing it
    //several times, which for anything that is not idempotent is a different act
    //from the one that was asked for — so anything that acts picks one, here.
    function pages() { return [...host.io.sockets.sockets.values()]; }

    function livePage() {
        var all = pages();
        return all.length ? all[all.length - 1] : null;
    }

    await register(null, {
        io: host.io,

        //A SERVICE OF ITS OWN RATHER THAN TWO METHODS BOLTED ONTO `io`. `io` is
        //the socket server itself and half the app calls it directly; hanging
        //helpers off it would mean anything holding a reference to the raw
        //server sometimes has them and sometimes does not.
        pages: { all: pages, live: livePage },
        appPackage: host.appPackage,
        onDestroy: function () {
            host.io.removeAllListeners('connection');
            //DROPPED SO THEY LAND ON THE NEW HANDLERS — but they do NOT come
            //back by themselves, whatever this line used to claim.
            //socket.io-client treats a disconnect the server ASKED for as final;
            //only a connection that died under it is retried. So the recovery is
            //in ./window.js, which listens for the reason and reconnects.
            //
            //`disconnectSockets(true)` looks like the fix on this side and is not:
            //the client reports "io server disconnect" either way. Measured, both
            //ways, rather than reasoned about.
            host.io.disconnectSockets();
        }
    });
}
module.exports = plugin;
