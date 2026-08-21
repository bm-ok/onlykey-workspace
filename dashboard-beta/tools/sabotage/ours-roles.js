//what ../../test/vms/ours-roles.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/ours/roles.js',
    test: 'test/vms/ours-roles.test.js',
    breaks: [
        //SILENCE IS NOT AN ANSWER. The thing this decides is which credential to
        //hand the machine.
        ['an unlabelled machine is guessed to be an ordinary runner',
            "    var out = [];\n    if (tagged(vm, WORKER)) out.push('worker');",
            "    var out = [];\n    if (!vm || !(vm.tags || []).length) return ['worker'];\n    if (tagged(vm, WORKER)) out.push('worker');"],

        ['a supervisor is also offered as a worker',
            "if (tagged(vm, SUPERVISOR)) return ['supervisor'];",
            ''],

        ['a supervisor is given queued work',
            "function takesQueuedWork(vm) { return canBe(vm, 'worker') || canBe(vm, 'judge'); }",
            "function takesQueuedWork(vm) { return true; }"],

        ['a judge is not offered queued work at all',
            "return canBe(vm, 'worker') || canBe(vm, 'judge');",
            "return canBe(vm, 'worker');"],

        //MEMBERSHIP RATHER THAN EQUALITY: this answered no for a machine that
        //judges perfectly well.
        ['a machine that is both is asked about as though it were one thing',
            'function canBe(vm, role) { return kindsOf(vm).indexOf(role) >= 0; }',
            'function canBe(vm, role) { return kindsOf(vm)[0] === role; }'],

        ['a machine that is both is given a single winning kind',
            'return kinds.length === 1 ? kinds[0] : null;',
            'return kinds[0] || null;'],

        ['a tag typed in capitals is not recognised',
            'return String(t).toLowerCase() === want;',
            'return t === want;'],

        ['a machine with no role reads as though it were fine',
            "return kindsOf(vm).join('+') || 'no role yet';",
            "return kindsOf(vm).join('+');"],

        //And the copy the queue is still carrying, which is on its way out. Until
        //it goes, the two must not be able to drift apart quietly.
        ['the queue and the registry stop agreeing about a role tag',
            "var JUDGE = 'judge';",
            "var JUDGE = 'judging';"],

        ['the queue and the registry stop agreeing about who a supervisor is',
            "if (tagged(vm, SUPERVISOR)) return ['supervisor'];",
            "if (tagged(vm, SUPERVISOR)) return ['supervisor', 'worker'];"]
    ]
};
