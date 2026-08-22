//what ../../test/vms/busy.test.js has to be able to catch, per machine.
module.exports = {
    file: 'src/app/vms/busy/doing.js',
    test: 'test/vms/busy.test.js',
    breaks: [
        //A SECOND VBoxManage COMMAND DURING THE WINDOW gets a wall of COM text
        //about a session lock. Refused here, where the refusal can say which
        //machine and which job.
        ['a second long thing is allowed on a machine already half-way through one',
            '        if (already) {',
            '        if (false) {'],

        ['the refusal does not say which machine, so it is not actionable',
            '            throw new Error(\'"\' + name + \'" is already \' + already + \'. Wait for that to finish — \'',
            "            throw new Error('It is busy. '"],

        ['the refusal does not say what it is doing',
            "'\" is already ' + already + '. Wait for that to finish — '",
            "'\" is busy. Wait for that to finish — '"],

        //WAITING WOULD MEAN A COMMAND THAT APPEARS TO HANG FOR TWENTY-FIVE
        //MINUTES. The honest answer is no, not later.
        ['a machine is never actually marked as busy',
            '        busy[name] = job;',
            ''],

        //ONE FAILURE MUST NOT LEAVE A MACHINE PERMANENTLY UNUSABLE, refused in
        //the name of a job that finished long ago.
        ['a job that threw keeps the machine for ever',
            '        try {\n            return await fn();\n        } finally {\n            release(name);\n        }',
            '        var out = await fn();\n        release(name);\n        return out;'],

        ['nothing is ever released',
            '        delete busy[name];',
            ''],

        //A MACHINE CALLED "constructor" IS STILL A FREE MACHINE. `map.get(name)
        //|| null` over a plain object answers with a function, and every claim
        //on it is refused in the name of a job nobody started.
        ['a machine named after something on Object.prototype reads as busy',
            "        return Object.prototype.hasOwnProperty.call(busy, name) ? busy[name] : null;",
            '        return busy[name] || null;'],

        ['releasing something never claimed is reported as having released it',
            "        if (!Object.prototype.hasOwnProperty.call(busy, name)) return false;",
            ''],

        //A PANE THAT SAYS WHAT IS GOING ON needs both halves of each entry.
        ['what is in flight is listed without saying what each one is doing',
            '            return { name: name, job: busy[name] };',
            '            return { name: name };'],

        ['a machine that is busy is left out of the list',
            '        return Object.keys(busy).map(function (name) {',
            '        return [].map(function (name) {']
    ]
};
