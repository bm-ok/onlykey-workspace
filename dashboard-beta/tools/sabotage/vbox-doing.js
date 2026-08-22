//what ../../test/vms/vbox-doing.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/vbox/doing.js',
    test: 'test/vms/vbox-doing.test.js',
    breaks: [
        //THE CONSOLE IS THE ONLY WIRE OUT OF A BOOT THAT NEVER FINISHES.
        ['the console is put on a port the guest does not write to',
            "await run(['modifyvm', name, '--uart1', '0x3F8', '4', '--uartmode1', 'file', file],",
            "await run(['modifyvm', name, '--uart1', '0x2F8', '3', '--uartmode1', 'file', file],"],

        ['the console goes to a pipe, which nothing can read afterwards',
            "'--uartmode1', 'file', file],",
            "'--uartmode1', 'server', file],"],

        ['the folder is not made, so a machine will not start',
            "        try { fs.mkdirSync(path.dirname(file), { recursive: true }); }\n        catch (e) { /* it is there, or the write below says so */ }",
            ''],

        ['turning it off points it at a file called nothing instead',
            "        if (!file) {\n            await run(['modifyvm', name, '--uart1', 'off'], { tags: [name] });\n            return { name: name, on: false, file: null };\n        }",
            ''],

        //A machine that would not boot because a log could not be renamed would
        //be a debugging aid causing the fault it exists to explain.
        ['a boot log that cannot be rolled stops the machine starting',
            'catch (e) { return null; }\n    }\n\n    async function start',
            'catch (e) { throw e; }\n    }\n\n    async function start'],

        ['the previous boot is not kept at all',
            'await keepThePreviousBoot(name);', ''],

        ['an empty log is rolled, pushing the real record out',
            'if (!fs.existsSync(file) || fs.statSync(file).size === 0) return null;',
            'if (!fs.existsSync(file)) return null;'],

        ['stopping pulls the plug rather than pressing the button',
            "return run(['controlvm', name, force ? 'poweroff' : 'acpipowerbutton']);",
            "return run(['controlvm', name, 'poweroff']);"],

        ['a machine that is off is asked for a screenshot anyway',
            'if (await read.isOff(name)) {',
            'if (false) {'],

        ['snapshots come back flat rather than depth first',
            'list.filter(function (x) { return x.parent === parent; }).forEach(function (s) {\n            order.push(s);\n            walk(s.key);\n        });',
            'if (parent === null) list.forEach(function (s) { order.push(s); });'],

        ['a snapshot whose parent is missing is dropped',
            'list.forEach(function (s) { if (order.indexOf(s) < 0) order.push(s); });',
            ''],

        ['a snapshot delete uses the default timeout, abandoning a merge',
            "return run(['snapshot', name, 'delete', title], { timeout: 900000 });",
            "return run(['snapshot', name, 'delete', title]);"],

        ['no snapshots at all is reported as a failure',
            'return { snapshots: [], current: null, currentNode: null, deepest: 0 };\n        }',
            'throw e;\n        }'],

        //Afterwards there is nothing left to ask.
        ['where a machine lives is asked after it is unregistered',
            'var folder = await machineFolder(name);',
            'var folder = null;'],

        ['a running machine is unregistered without being stopped',
            'if (read.OFF.indexOf(s) < 0) {',
            'if (false) {'],

        ['the sweep deletes whatever it finds',
            'if (GENERATED.test(entry) && fs.statSync(full).isFile()) fs.unlinkSync(full);',
            'if (fs.statSync(full).isFile()) fs.unlinkSync(full);'],

        ['what it could not delete is left without being named',
            "say.warn(folder + ' still holds ' + left.join(', ')",
            "say.info('' + left.join(', ')"]
    ]
};
