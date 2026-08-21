//what ../../test/vms/vbox-network.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/vbox/network.js',
    test: 'test/vms/vbox-network.test.js',
    breaks: [
        ['a field before any name is attached to the interface after it',
            'if (!current) return;',
            'if (!current) current = {};'],

        ['an iso that has been moved away is still offered',
            "return l && /\\.iso$/i.test(l) && there(l);",
            "return l && /\\.iso$/i.test(l);"],

        ['anything VirtualBox lists is offered as an iso',
            "return l && /\\.iso$/i.test(l) && there(l);",
            'return !!l;'],

        ['a host with no VirtualBox is asked anyway',
            'if (!available()) return [];\n        var out = await run([\'list\', \'dvds\'], { quiet: true });',
            "var out = await run(['list', 'dvds'], { quiet: true });"],

        ['a new adapter is left with no address and no DHCP',
            "await run(['hostonlyif', 'ipconfig', name, '--ip', HOST_ONLY.host, '--netmask', HOST_ONLY.mask]);",
            ''],

        ['an adapter whose configuration failed is reported as a failure',
            "} catch (e) { /* said by the adapter having no address */ }",
            '} catch (e) { throw e; }'],

        ['an adapter VirtualBox would not name is invented',
            'if (!named) {',
            'if (false) {'],

        //Asking the guest requires the guest to be able to answer, and the
        //moments somebody most wants to know are the moments it cannot.
        ['a lease is looked for on a network that is not there',
            'if (!network) return null;',
            ''],

        ['a machine with no lease is reported as having one',
            "return (/IP Address:\\s*([0-9.]+)/i.exec(String(out)) || [])[1] || null;",
            "return (/IP Address:\\s*([0-9.]+)/i.exec(String(out)) || [])[1] || '0.0.0.0';"],

        ['an interface that is down is offered to a guest',
            "return b.status === 'Up' && usable(b.ip);",
            'return !!b.ip;'],

        ['a link-local address is offered to a guest',
            "return !!ip && ip.indexOf('169.254') !== 0;",
            'return !!ip;'],

        ['a loopback is offered to a guest',
            "if (e.family === 'IPv4' && !e.internal && usable(e.address)) return e.address;",
            "if (e.family === 'IPv4' && usable(e.address)) return e.address;"],

        ['nowhere to be reached is answered with a guess',
            "throw new Error('Could not work out this machine\\'s address on the network, so a guest would have '",
            "return '127.0.0.1'; throw new Error('Could not work out this machine\\'s address on the network, so a guest would have '"]
    ]
};
