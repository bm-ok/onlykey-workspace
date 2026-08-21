//what ../../test/vms/ours-store.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/ours/store.js',
    test: 'test/vms/ours-store.test.js',
    breaks: [
        //THE SAFETY BOUNDARY. Membership comes from the file, never from
        //VirtualBox — the app can DELETE what this lists.
        ['membership is taken from what VirtualBox knows about',
            'var mine = read();\n        var available = vbox ? vbox.available() : false;',
            'var available = vbox ? vbox.available() : false;\n        var mine = available ? (await vbox.listAll()).map(function (v) { return { name: v.name, tags: [] }; }) : read();'],

        ['a machine this app did not make can be looked up',
            "throw new Error('\"' + name + '\" is not a virtual machine this app made, '\n                + 'so it will not touch it.');",
            'return { name: name, tags: [] };'],

        ['and asking whether it is ours says yes to anything',
            "return read().some(function (v) { return v.name === name; });",
            'return true;'],

        ['a machine this app did not make can be forgotten',
            'var vm = get(name);\n        write(read().filter(function (v) { return v.name !== name; }));',
            "var vm = { name: name };\n        write(read().filter(function (v) { return v.name !== name; }));"],

        //AN UNREADABLE REGISTER IS NOT AN EMPTY ONE.
        ['a register that cannot be read is answered as an empty one',
            "            if (there) {\n                say('vm').bad(doc.path + ' could not be read. Fix or delete it; '\n                    + 'no machine is listed until then.');\n            }",
            ''],

        ['a file somebody edited by hand into one object reads as none',
            'var list = Array.isArray(kept) ? kept : [kept];',
            'var list = Array.isArray(kept) ? kept : [];'],

        //Adding.
        ['the same machine can be added twice',
            "if (list.some(function (v) { return v.name === s.name; })) {",
            'if (false) {'],

        ['a machine with no name is written down anyway',
            "if (!s.name) throw new Error('A virtual machine needs a name.');",
            ''],

        ['nothing is actually written to disk',
            'write(list.concat([vm]));',
            ''],

        //Changing.
        ['a patch can rename the machine in the register',
            'vm.name = name;',
            ''],

        ['patching a machine that is not ours creates one',
            'if (!vm) return null;',
            'if (!vm) { vm = { name: name }; list.push(vm); }'],

        //Forgetting is not deleting, and only one of them can be undone.
        ['forgetting does not say that nothing was deleted',
            "say('vm', name).info('Removed \"' + name + '\" from this app\\'s list. '\n            + 'The virtual machine itself was not deleted.');",
            ''],

        //The list somebody looks at.
        ['a host with no VirtualBox appears to have lost every machine',
            "                vms: mine.map(function (vm) {\n                    return Object.assign({}, vm, { live: false, state: 'unknown', stage: 'defined' });\n                })",
            '                vms: []'],

        ['a machine VirtualBox has lost is still asked about',
            "state: live ? await vbox.state(vm.name) : 'missing',",
            'state: await vbox.state(vm.name),'],

        ['a machine VirtualBox has lost reads as though it were there',
            "stage: records.stageOf(vm, { live: live, connected: talking }),",
            'stage: records.stageOf(vm, { live: true, connected: talking }),'],

        ['being powered on is reported as the agent talking to us',
            'connected: talking,',
            'connected: !!up[vm.name],'],

        ['the agent talking is reported as somebody having a desktop',
            "desktop: !!((agent || {}).facts || {}).desktop,",
            'desktop: talking,'],

        ['a machine built without a desktop is said to have wanted one',
            "desktopWanted: (vm.spec || {}).desktop !== false,",
            'desktopWanted: true,'],

        ['a machine that is both a worker and a judge is given one winning kind',
            'kind: roles.kindOf(vm),',
            'kind: roles.kindsOf(vm)[0] || null,'],

        ['a supervisor is read from the spec flag rather than the tag',
            "supervisor: roles.canBe(vm, 'supervisor'),",
            'supervisor: !!(vm.spec || {}).supervisor,'],

        //ONE ROUND TRIP EACH, rather than a spawn per machine per draw. This is
        //the shape that once put 94% of a window inside spawn.
        ['the whole list is fetched again for every machine on it',
            'var live = defined.some(function (v) { return v.name === vm.name; });',
            'var live = (await vbox.listAll()).some(function (v) { return v.name === vm.name; });'],

        ['and so is the running list',
            "running: !!up[vm.name],",
            'running: (await vbox.runningAll()).some(function (v) { return v.name === vm.name; }),']
    ]
};
