//what ../../test/vms/provision-spec.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/spec.js',
    test: 'test/vms/provision-spec.test.js',
    breaks: [
        //A name is an address: VirtualBox knows the machine by it, and it ends up
        //in a hostname and a folder path.
        ['a machine may be called anything',
            '        if (!NAME.test(name)) {',
            '        if (false) {'],

        ['a name may contain a path',
            'var NAME = /^[\\w.-]+$/;',
            'var NAME = /^.+$/;'],

        //THE FLAG, THE TAG AND THE SECRET CANNOT DISAGREE, because there is only
        //one moment at which any of them is set.
        ['a supervisor is built without its tag',
            '        if (supervisor) asked.push(SUPERVISOR);',
            ''],

        ['a supervisor is put in the pool work is drawn from',
            "        if (!out.length) return [POOL];\n        return out;",
            '        return out.concat(out.length ? [] : [POOL]).concat([POOL]);'],

        ['a machine given no kind is left with no pool to be in',
            '        if (!out.length) return [POOL];',
            ''],

        //Decided here or never.
        ['a desktop is on by default',
            '        var desktop = yes(it.desktop);',
            '        var desktop = it.desktop !== false;'],

        ['any truthy value at all makes it a supervisor',
            "function yes(v) { return v === true || v === 'true'; }",
            'function yes(v) { return !!v; }'],

        ['being a supervisor is never recorded',
            '            supervisor: supervisor,',
            '            supervisor: false,'],

        //A machine can only ever dial in as itself.
        ['every machine is built with the same token',
            '            token: it.token || newToken(),',
            "            token: it.token || 'shared',"],

        ['a rebuild issues a new token and locks out the running machine',
            'token: it.token || newToken(),',
            'token: newToken(),'],

        //A share needs the mount helper.
        ['shared folders no longer force the additions on',
            "                : (desktop || (Array.isArray(it.shares) && it.shares.length > 0)),",
            '                : desktop,'],

        ['the additions are installed on every machine',
            "            installAdditions: typeof it.installAdditions === 'boolean'\n                ? it.installAdditions\n                : (desktop || (Array.isArray(it.shares) && it.shares.length > 0)),",
            '            installAdditions: true,'],

        //Declared, never assumed.
        ['something that is not a list is carried as one',
            '            usb: Array.isArray(it.usb) ? it.usb : [],',
            '            usb: it.usb || [],'],

        //Tags.
        ['tags typed as one line are not split',
            "        var asked = (Array.isArray(it.tags) ? it.tags : String(it.tags == null ? '' : it.tags).split(','))",
            "        var asked = (Array.isArray(it.tags) ? it.tags : [it.tags])"],

        ['tags keep whatever case they were typed in',
            '            .map(function (t) { return String(t).trim().toLowerCase(); })',
            '            .map(function (t) { return String(t).trim(); })'],

        ['a tag typed twice is carried twice',
            '        var out = [];\n        asked.forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });',
            '        var out = asked;'],

        //The defaults were arrived at by running the thing.
        ['a machine is built with whatever number was typed, including none',
            '            cpus: Number(it.cpus) || 4,',
            '            cpus: Number(it.cpus),'],

        ['every machine is built on NAT, where it cannot see this host',
            "            network: it.network === 'nat' ? 'nat' : 'bridged',",
            "            network: 'nat',"],

        ['a hostname is not made from the name',
            "            hostname: it.hostname || (name.replace(/[^a-z0-9-]/gi, '-') + '.local'),",
            "            hostname: it.hostname || 'localhost',"]
    ]
};
