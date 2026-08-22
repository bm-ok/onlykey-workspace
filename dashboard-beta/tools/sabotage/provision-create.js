//what ../../test/vms/provision-create.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/server.js',
    test: 'test/vms/provision-create.test.js',
    breaks: [
        //THE COLLISION THAT MATTERS is with any machine on this host, especially
        //one this app must not touch.
        ['a name is checked against our own list rather than against VirtualBox',
            '        if (await vbox.exists(built.name)) {',
            '        if (ours.has(built.name)) {'],

        ['a name that VirtualBox already has is built over',
            "        if (await vbox.exists(built.name)) {\n            throw new Error('VirtualBox already has a machine called \"' + built.name + '\". '\n                + 'Pick another name — this app will not touch a machine it did not make.');\n        }",
            ''],

        //A refusal that has already run createvm is not a refusal.
        //A REFUSAL THAT HAS ALREADY RUN createvm IS NOT A REFUSAL. Moved rather
        //than duplicated: leaving the early check in place and adding a second
        //one after changes nothing, which is what the first attempt at this
        //sabotage did — it "survived" without having broken anything.
        ['the name is checked after the machine has been built',
            "        if (await vbox.exists(built.name)) {\n            throw new Error('VirtualBox already has a machine called \"' + built.name + '\". '\n                + 'Pick another name — this app will not touch a machine it did not make.');\n        }\n\n        var made = await build.buildInVbox(built, to);",
            "        var made = await build.buildInVbox(built, to);\n\n        if (await vbox.exists(built.name)) {\n            throw new Error('VirtualBox already has a machine called \"' + built.name + '\".');\n        }"],

        ['a host with no VirtualBox builds anyway',
            "        if (!vbox.available()) {\n            throw new Error('VirtualBox is not installed, or not where this expected to find it.');\n        }",
            ''],

        //What the build decided is what the register keeps.
        ['the register is written before the build, so it records what was asked for',
            '        var made = await build.buildInVbox(built, to);',
            '        var made = { iso: built.iso, bridge: built.bridgeAdapter, disk: null, serial: null };\n        await build.buildInVbox(built, to);'],

        ['the image the build resolved is not written down',
            '            iso: made.iso, bridge: made.bridge, disk: made.disk, serial: made.serial',
            '            bridge: made.bridge, disk: made.disk, serial: made.serial'],

        ['the console it attached is not written down, so nothing knows to read it',
            'iso: made.iso, bridge: made.bridge, disk: made.disk, serial: made.serial',
            'iso: made.iso, bridge: made.bridge, disk: made.disk'],

        ['the adapter it picked is not written down',
            'iso: made.iso, bridge: made.bridge,',
            'iso: made.iso,'],

        //Nothing is on the register unless it was actually made.
        ['the machine is not written down at all',
            '        var vm = ours.add(Object.assign({}, built, {',
            '        var vm = Object.assign({}, built, {'],

        //The next step is named.
        ['it reads as finished, over a machine that will not boot into anything',
            "        to.good(built.name + ' created. It has no operating system yet — install one next.');",
            "        to.good(built.name + ' created.');"],

        //The flag, the tag and the secret cannot disagree.
        ['what was typed is written down instead of what the spec settled',
            '        var vm = ours.add(Object.assign({}, built, {',
            '        var vm = ours.add(Object.assign({}, input, {'],

        ['every machine is issued the same token',
            '        newToken: imports.channel.newToken,',
            "        newToken: function () { return 'shared'; },"]
    ]
};
