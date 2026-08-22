//what ../../test/vms/provision-repairs.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/repairs.js',
    test: 'test/vms/provision-repairs.test.js',
    breaks: [
        //---- every machine writes its console somewhere ---------------------

        ['a machine built before the port was attached is left without a console',
            '            if (vm.serial) continue;',
            '            continue;'],

        //CHEAP WHEN THERE IS NOTHING TO DO is what makes running this every five
        //minutes reasonable at all.
        ['a machine that already has one is asked about anyway',
            '            if (vm.serial) continue;',
            ''],

        //VirtualBox WILL NOT ADD A SERIAL PORT TO A RUNNING MACHINE — and that
        //is the machine that most needs one.
        ['a running machine is reconfigured underneath itself',
            '            if (!off) { later.push(vm.name); continue; }',
            ''],

        ['a running machine is skipped silently, so nothing knows to come back',
            '            if (!off) { later.push(vm.name); continue; }',
            '            if (!off) { continue; }'],

        //A MACHINE THAT IS NOT BUILT YET is not a fault; the build will attach
        //one.
        ['a machine VirtualBox does not have yet is treated as a failure',
            '            try { off = await vbox.isOff(vm.name); } catch (e) { continue; }',
            '            off = await vbox.isOff(vm.name);'],

        //THE SAME FILE ./building.js WOULD HAVE CHOSEN. Two opinions about where
        //a console goes is a record naming a file nothing writes to.
        ['it invents its own path rather than asking where a console goes',
            '                var file = serialFor(vm.name);',
            "                var file = 'C:/somewhere/' + vm.name + '.log';"],

        //WHAT WAS ATTACHED IS WHAT IS WRITTEN DOWN.
        ['the console is attached and not written down',
            '                ours.update(vm.name, { serial: file });',
            ''],

        ['a console that VirtualBox refused is written down as attached',
            '                await vbox.setSerial(vm.name, file);\n                ours.update(vm.name, { serial: file });',
            '                ours.update(vm.name, { serial: file });\n                await vbox.setSerial(vm.name, file);'],

        //ONE MACHINE MUST NOT STOP THE OTHERS. A sweep that gives up on the
        //first failure leaves every machine after it unrepaired, forever.
        ['one machine that cannot be given a console stops the sweep',
            "            } catch (e) {\n                to.warn('could not capture its console: ' + e.message);\n            }",
            '            } catch (e) {\n                throw e;\n            }'],

        ['a console that could not be attached is not mentioned',
            "                to.warn('could not capture its console: ' + e.message);",
            ''],

        //NOT AN ERROR ON A HOST WITHOUT VirtualBox.
        ['a host with no VirtualBox is swept anyway',
            '        if (!vbox.available()) return null;',
            ''],

        //NULL WHEN NOTHING HAPPENED, so the cron board shows a job doing
        //something rather than only that it ran.
        ['a sweep that did nothing reports that it did something',
            '        if (!given.length && !later.length) return null;',
            ''],

        //---- and every machine is in a pool ---------------------------------

        ['a machine that carries no tag is left out of every pool',
            '            if ((vm.tags || []).length) return;',
            '            return;'],

        //A SUPERVISOR TAKES NO WORK, so the pool work is drawn from is not a
        //thing it can be in.
        ['a supervisor is put in the pool work is drawn from',
            '            if ((vm.tags || []).length) return;',
            ''],

        ['a machine already in another pool is moved into the ordinary one',
            '            if ((vm.tags || []).length) return;',
            "            if ((vm.tags || []).indexOf(ours.POOL) >= 0) return;"],

        ['the pool it is put in is not the one everything else means by it',
            '            ours.update(vm.name, { tags: [ours.POOL] });',
            "            ours.update(vm.name, { tags: ['pool'] });"],

        ['nothing to do is reported as a sweep that did something',
            '        return given.length ? { given: given } : null;',
            '        return { given: given };']
    ]
};
