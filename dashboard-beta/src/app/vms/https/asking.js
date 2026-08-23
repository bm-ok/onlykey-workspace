//---------------------------------------------------------------------------
//WHICH MACHINE IS ASKING, AND WHETHER IT PROVED IT.
//
//NOTHING HERE TOUCHES A SOCKET. It takes the two things a request carries — an
//authorization header and a query — and answers with a machine or null, which is
//what makes it testable without opening a port.
//
//---- a machine's life has two halves, and only the second has a secret ------
//
//ONCE BUILT IT HOLDS ITS TOKEN, and that is the answer. HTTP Basic, because it
//is the one scheme git speaks with nothing installed in the guest: the
//credentials sit in the clone URL and git replays them on each request. The
//machine's NAME is the username, so a push is attributable to a machine rather
//than to whoever could reach the port.
//
//BEFORE THAT IT HOLDS NOTHING AT ALL. The script it is fetching is where its
//token comes from, which is the whole chicken-and-egg — so an install carries a
//TICKET, made when the install starts and put on the installer's command line.
//That is the one channel that reaches a machine with nothing on it.
//
//THIS HALF WAS NOT PORTED AND IT COST TWO INSTALLS. Every installing guest got
//401 from `/provision/first-boot.sh`, ten times over its retry loop, and the
//post-install command exited 1 — which subiquity reports as the whole install
//failing, with the cause ten scrollbacks above the part anybody reads.
//
//---- and a ticket is not a second token ------------------------------------
//
//IT OPENS ONE MACHINE'S SETUP AND NOTHING ELSE, it is checked against the name
//in the query, and it DIES the moment that machine dials in — see
//../provision/server.js, which clears it in `onHello`.
//
//That last part is not tidiness. The command line OUTLIVES the install:
//VirtualBox writes it into `vboxpostinstall.sh` in the machine's folder, where
//it sits for as long as the machine exists. A token there would be a live secret
//in a plain file; a spent ticket is a string that opens nothing.
//---------------------------------------------------------------------------

//CONSTANT TIME, because a comparison that returns early tells whoever is asking
//how much of the secret they got right — and for a machine being built, the
//ticket is the whole of what it has. ../channel/session.js compares its own the
//same way.
function same(a, b) {
    var x = String(a == null ? '' : a);
    var y = String(b == null ? '' : b);
    if (x.length !== y.length) return false;
    var out = 0;
    for (var i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return out === 0;
}

module.exports = function asking(deps) {
    var d = deps || {};
    var ours = d.ours;   //has, get

    //---- THE TOKEN HOLDER, OR NULL ---------------------------------------
    function byToken(headers) {
        var said = String((headers || {}).authorization || '');
        if (said.slice(0, 6).toLowerCase() !== 'basic ') return null;

        var pair = Buffer.from(said.slice(6), 'base64').toString('utf8');
        var at = pair.indexOf(':');
        if (at < 0) return null;

        var name = pair.slice(0, at);
        var token = pair.slice(at + 1);
        if (!name || !token) return null;

        //FROM THE REGISTER, so a machine this app did not make has no token that
        //works — the same boundary every other action is drawn on.
        if (!ours.has(name)) return null;
        var vm = ours.get(name);
        var mine = (vm.spec || {}).token;
        if (!mine || !same(mine, token)) return null;

        return vm;
    }

    //---- AND WHOEVER IS ASKING FOR A NAMED MACHINE'S THINGS ---------------
    //
    //NOT EVERY ROUTE NAMES ONE. `/git/*` and `/supervisor` are reached with a
    //token and nothing else — the machine is whoever the token belongs to.
    //`/provision/*` and `/session` DO name one, and there the name is part of
    //the question rather than decoration.
    //
    //NAMED FOR A MACHINE, ALWAYS, when a name is given. "Is this a machine we
    //know" is not the question; "is this THAT machine" is, and answering the
    //looser one is how a machine could read another's token.
    function whoIsAsking(headers, params) {
        var who = byToken(headers);
        var name = String((params && params.get('vm')) || '');

        if (!name) return who;
        if (!ours.has(name)) return null;

        var vm = ours.get(name);
        if (who) return who.name === name ? vm : null;

        var ticket = String((params && params.get('ticket')) || '');
        if (ticket && vm.installTicket && same(vm.installTicket, ticket)) return vm;

        return null;
    }

    return { byToken: byToken, whoIsAsking: whoIsAsking };
};

module.exports.same = same;
