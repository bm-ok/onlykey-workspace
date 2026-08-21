var fs = require('fs');
var os = require('os');
var path = require('path');

//---------------------------------------------------------------------------
//WHERE A MACHINE CAN BE REACHED, AND WHERE IT CAN REACH THIS HOST.
//
//TWO NETWORKS, AND THE DIFFERENCE DECIDES WHAT CAN BE ASKED.
//
//A machine here has a BRIDGED adapter — it sits on the same network as
//everything else, and its address comes from the router. That is what makes it
//reachable, and it is also why nothing here can ask what address it got: the
//router leased it and VirtualBox never saw it happen.
//
//AND IT HAS A HOST-ONLY ADAPTER, which is the one network VirtualBox itself
//serves DHCP on — which makes it the only one it can be ASKED questions about.
//That is the whole reason the second adapter exists.
//
//A GUEST CANNOT USE 127.0.0.1 TO REACH THE HOST, which is the fact under all of
//this: the dashboard has to tell a machine an address that means something from
//where the machine is standing.
//---------------------------------------------------------------------------

//`Name:` / `IPAddress:` / `Status:` IN BLOCKS, one per interface, and the same
//shape for bridged and host-only — so one parser rather than two that drift.
function blocks(text) {
    var found = [];
    var current = null;

    String(text == null ? '' : text).split('\n').forEach(function (raw) {
        var m = /^([A-Za-z]+):\s*(.*)$/.exec(raw.trim());
        if (!m) return;

        if (m[1] === 'Name') {
            if (current) found.push(current);
            current = { name: m[2].trim() };
            return;
        }
        if (!current) return;
        if (m[1] === 'IPAddress') current.ip = m[2].trim();
        if (m[1] === 'Status') current.status = m[2].trim();
    });

    if (current) found.push(current);
    return found;
}

//169.254 IS WHAT AN INTERFACE HAS WHEN IT HAS NO ADDRESS. Telling a guest to
//dial one is telling it to dial nowhere.
function usable(ip) {
    return !!ip && ip.indexOf('169.254') !== 0;
}

//THE HOST-ONLY NETWORK THIS APP MAKES, if it has to make one.
var HOST_ONLY = {
    host: '192.168.56.1',
    mask: '255.255.255.0',
    server: '192.168.56.100',
    from: '192.168.56.101',
    to: '192.168.56.254'
};

module.exports = function network(run, opts) {
    var o = opts || {};
    var available = o.available || function () { return true; };
    var there = o.there || function (p) {
        try { return fs.existsSync(p); } catch (e) { return false; }
    };
    var interfaces = o.interfaces || function () { return os.networkInterfaces(); };

    //ISOs VirtualBox ALREADY KNOWS ABOUT, so a person picks one instead of
    //typing a path.
    //
    //AND ONLY THE ONES THAT ARE STILL THERE. VirtualBox remembers media that has
    //been moved or deleted, and offering one of those is offering an install
    //that fails twenty minutes in.
    async function isos() {
        if (!available()) return [];
        var out = await run(['list', 'dvds'], { quiet: true });

        return String(out).split('\n')
            .map(function (l) { return (/^Location:\s*(.+)$/.exec(l.trim()) || [])[1]; })
            .filter(function (l) { return l && /\.iso$/i.test(l) && there(l); })
            .map(function (location) { return { location: location, name: path.basename(location) }; });
    }

    //WHICH HOST ADAPTERS CAN BE BRIDGED, and what address a guest would reach us
    //on.
    async function bridges() {
        if (!available()) return [];
        return blocks(await run(['list', 'bridgedifs'], { quiet: true }));
    }

    async function hostOnlyIfs() {
        if (!available()) return [];
        return blocks(await run(['list', 'hostonlyifs'], { quiet: true }));
    }

    //MAKING ONE, for a host that has never had a machine on it.
    //
    //ON WINDOWS THIS INSTALLS A VIRTUAL ADAPTER, which is the one operation here
    //that can ask for elevation — so the failure is passed back plainly rather
    //than swallowed.
    async function makeHostOnlyIf() {
        var out = await run(['hostonlyif', 'create']);

        var named = /Interface '([^']+)' was successfully created/.exec(String(out));
        if (!named) {
            throw new Error('VirtualBox did not say which host-only adapter it made: '
                + String(out).trim().split('\n').pop());
        }
        var name = named[1];

        //AN ADDRESS ON THE HOST'S SIDE, AND A DHCP SERVER, or a machine attached
        //to it gets nothing and the whole point is lost.
        //
        //NEITHER FAILURE STOPS THE ADAPTER BEING USED: it exists either way, and
        //an adapter with no DHCP is a fault somebody can see and fix rather than
        //a create that half happened and reported nothing.
        try {
            await run(['hostonlyif', 'ipconfig', name, '--ip', HOST_ONLY.host, '--netmask', HOST_ONLY.mask]);
        } catch (e) { /* said by the adapter having no address */ }

        try {
            await run(['dhcpserver', 'add', '--interface', name,
                '--server-ip', HOST_ONLY.server, '--netmask', HOST_ONLY.mask,
                '--lower-ip', HOST_ONLY.from, '--upper-ip', HOST_ONLY.to, '--enable']);
        } catch (e) { /* as above */ }

        return name;
    }

    //---- what address a machine has ---------------------------------------
    //
    //ASKED OF THE DHCP SERVER RATHER THAN OF THE GUEST.
    //
    //THIS WORKS WITH THE MACHINE MID-INSTALL, WEDGED, OR WITH NO GUEST
    //ADDITIONS — which is exactly when nothing else can answer. Asking the guest
    //requires the guest to be able to answer, and the moments somebody most
    //wants to know where a machine is are the moments it cannot.
    //
    //BY THE MAC OF THE SECOND ADAPTER, which is the host-only one. The bridged
    //one's lease came from the router and VirtualBox never saw it.
    async function leaseFor(name, mac) {
        var nets = await run(['list', 'dhcpservers'], { quiet: true });
        var network = (/NetworkName:\s*(HostInterfaceNetworking-.*)/.exec(String(nets)) || [])[1];
        if (!network) return null;

        //THE MAC AS VirtualBox PRINTS IT in showvminfo: twelve hex digits.
        //
        //BUILT BEFORE THE `try`, ON PURPOSE. That catch is there to swallow ONE
        //thing — VBoxManage treating "no lease yet" as an error, which is the
        //ordinary answer while a machine boots. Building the arguments inside it
        //would mean a mistake in this file was swallowed by the same line, and
        //the only sign would be a machine that never seems to get an address.
        var args = ['dhcpserver', 'findlease', '--network', network.trim(), '--mac-address', mac];

        var out = '';
        try { out = await run(args, { quiet: true }); }
        catch (e) { /* no lease yet is the ordinary answer while one boots */ }

        return (/IP Address:\s*([0-9.]+)/i.exec(String(out)) || [])[1] || null;
    }

    //---- the address a guest must use to reach this dashboard --------------
    //
    //THE BRIDGED ONE FIRST, because that is the network the guest is on. Falling
    //back to this host's own interfaces covers a host with no bridged adapter
    //listed, which VirtualBox does on some machines.
    //
    //AND IT THROWS RATHER THAN GUESSING. A guest handed an address that means
    //nothing fails twenty minutes later, fetching its scripts, with an error
    //about a network rather than about this.
    async function hostAddress() {
        var up = (await bridges()).filter(function (b) {
            return b.status === 'Up' && usable(b.ip);
        });
        if (up.length) return up[0].ip;

        var all = interfaces();
        var names = Object.keys(all);
        for (var i = 0; i < names.length; i++) {
            var entries = all[names[i]] || [];
            for (var j = 0; j < entries.length; j++) {
                var e = entries[j];
                if (e.family === 'IPv4' && !e.internal && usable(e.address)) return e.address;
            }
        }

        throw new Error('Could not work out this machine\'s address on the network, so a guest would have '
            + 'no way to reach it.');
    }

    return {
        isos: isos,
        bridges: bridges,
        hostOnlyIfs: hostOnlyIfs,
        makeHostOnlyIf: makeHostOnlyIf,
        leaseFor: leaseFor,
        hostAddress: hostAddress,
        HOST_ONLY: HOST_ONLY
    };
};

module.exports.blocks = blocks;
module.exports.HOST_ONLY = HOST_ONLY;
