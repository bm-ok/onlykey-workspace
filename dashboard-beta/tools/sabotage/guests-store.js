//what ../../test/runners/guests-store.test.js has to be able to catch.
//
//THIS FILE HOLDS THE CREDENTIALS. The first two breaks are the rule that makes
//every other pane in this app safe to photograph, and the ones under "taking it
//back" are a token that was actually destroyed.
module.exports = {
    file: 'src/app/runners/guests/store.js',
    test: 'test/runners/guests-store.test.js',
    breaks: [
        //---- what is here, and what is never in it ---------------------------

        //EVERY CALLER GETS THIS SHAPE — the window, the command line and a
        //drill. A token in it is a token in a log, a capture and a screenshot.
        ['the list every caller reads carries the token',
            '                name: g.name,',
            "                name: g.name,\n                token: (function () { try { return secret.read(fileFor(g.name)).toString('utf8'); } catch (e) { return null; } })(),"],

        //READ FROM THE FILE rather than trusted from the record, so one removed
        //by hand says so instead of claiming a token.
        ['a sign-in whose file is gone still claims to have one',
            '                has: fs.existsSync(fileFor(g.name)),',
            '                has: true,'],

        //---- one sealed file per identity ---------------------------------------

        //THE RECORD IS THE LIST EVERYTHING READS. A token in it defeats the
        //sealing entirely.
        ['the token is written into the record beside the fingerprint',
            '            fingerprint: shape.fingerprint(text),',
            '            fingerprint: shape.fingerprint(text),\n            token: text,'],

        //---- adding -------------------------------------------------------------

        //String(token) TURNS AN OBJECT INTO "[object Object]" — sealed,
        //fingerprinted, and reported as added. You find out weeks later.
        ['a credential that arrived as an object is kept as its shadow',
            "        var text = (token && typeof token === 'object' ? JSON.stringify(token) : String(token || '')).trim();",
            "        var text = String(token || '').trim();"],

        ['and the shadow is kept rather than refused by name',
            "        if (text === '[object Object]') {",
            '        if (false) {'],

        //A NAME IS A FILENAME. One that is a path is a file written somewhere
        //nobody looked.
        ['a name that is a path is written anyway',
            '        if (!shape.okName(name)) {',
            '        if (false) {'],

        //REPLACING ONE SILENTLY takes a credential away from whatever is using
        //it.
        ['a name already here is replaced without a word',
            '        if (get(name)) {',
            '        if (false) {'],

        ['nothing at all is sealed as an empty credential',
            '        if (!text) {',
            '        if (false) {'],

        //---- removing -------------------------------------------------------------

        //REMOVING IT HERE would leave a credential on a machine with nothing on
        //this host knowing it is there.
        ['one that is out on a machine is forgotten anyway',
            '        if (g.holder) {',
            '        if (false) {'],

        ['the record is cleared but the sealed file is left behind',
            '        try { fs.rmSync(fileFor(name), { force: true }); } catch (e) { /* already gone */ }',
            ''],

        //---- lending it out ---------------------------------------------------------

        //ENFORCED AT THE ONE POINT THAT RECORDS A HOLDER, rather than at each of
        //the several places that hand one over.
        ['the rule is not enforced where the holder is recorded',
            '        if (why) throw new Error(why);',
            ''],

        //---- and taking it back --------------------------------------------------------

        //THE ONE THAT DESTROYED A TOKEN. A machine that cleared its own sign-in
        //hands back a new fingerprint with nothing in it.
        ['an empty credential handed back overwrites the working one',
            '                if (!shape.usable(it.token) && holding && shape.usable(holding)) {',
            '                if (false) {'],

        //AND THE OTHER HALF: if what is held is already unusable there is
        //nothing to protect, and refusing would be a door that cannot be opened.
        ['a host recovering from that can never write a credential again',
            '                if (!shape.usable(it.token) && holding && shape.usable(holding)) {',
            '                if (!shape.usable(it.token)) {'],

        //THE CLI REFRESHES AS A WORKER RUNS, so what comes off a machine is
        //newer than what went on.
        ['a rotated token is thrown away rather than kept',
            '            if (print !== rows[i].fingerprint) {',
            '            if (false) {'],

        ['an unchanged token re-seals the file and moves the date it changed',
            '            if (print !== rows[i].fingerprint) {',
            '            if (true) {'],

        //THE MACHINE MUST STOP HOLDING IT whatever happened to the token.
        ['a refused handover leaves the machine holding the credential',
            '        rows[i] = Object.assign({}, rows[i], { holder: null });',
            ''],

        //---- what a machine found out about it ---------------------------------------------

        //A PROBE REPORTED READY THREE TIMES about a dead sign-in because the
        //file was on the disk, and the queue spent a machine each time.
        ['a probe clears a failure a run established',
            "        if (!shape.mayOverturn(rows[i].lastCheck || null, it.ready === true, it.how || 'probe')) {",
            '        if (false) {'],

        //"IT RAN FINE AND SAID NO" IS A REAL ANSWER and is not the same as "it
        //never ran".
        ['an exit code of zero is dropped as though there were none',
            '                code: it.code === null || it.code === undefined ? null : Number(it.code)',
            '                code: it.code ? Number(it.code) : null'],

        //THE SENTENCE IS THE DIAGNOSIS. An OAuth session that expired wants a
        //different thing done about it than a worker that could not read a file.
        ['what the machine said is not kept',
            '                why: it.why || null,',
            '                why: null,'],

        //---- what an identity is FOR ---------------------------------------------------------

        //IT WAS LENT UNDER THE RULE THAT THE ROLES MATCH; changing it underneath
        //leaves that machine holding the wrong one.
        ['a role changes while the sign-in is out on a machine',
            '        if (rows[i].holder) {',
            '        if (false) {'],

        //MOVING THE IDENTITY OUT FROM UNDER THE SUPERVISOR leaves it pointing at
        //a sign-in it may no longer hold, discovered the next time it is woken.
        ['the one the supervisor uses stops being a supervisor',
            "        if (was === 'supervisor' && chosen() === name) {",
            '        if (false) {'],

        ['a role nothing recognises is set anyway',
            '        if (!shape.isRole(to)) {',
            '        if (false) {'],

        //A LABEL CHANGE. Nothing is re-sealed and nothing is re-read, which is
        //how you can tell it was a relabelling and not a replacement.
        ['relabelling opens the sealed token',
            '        rows[i] = Object.assign({}, rows[i], { role: to });',
            "        try { secret.read(fileFor(name)); } catch (e) { /* gone */ }\n        rows[i] = Object.assign({}, rows[i], { role: to });"],

        //---- learning whose a sign-in is ---------------------------------------------------------

        //A MACHINE IS NOT THE AUTHORITY on whose credential this is. The sign-in
        //is the one that was watched by a person.
        ['a machine overwrites the account a person signed in as',
            '        if (rows[i].account && (rows[i].account.email || rows[i].account.uuid)) {',
            '        if (false) {'],

        //---- filling in what was not recorded --------------------------------------------------

        //THE CALLER IS REACHED FROM A PAINT FUNCTION. Nothing should be opened
        //on a host where every record already says what it is.
        ['every call opens every sealed token',
            '        if (!missing.length) return 0;',
            ''],

        ['a plan that could not be read is left blank, so it is retried for ever',
            '            g.plan = text ? shape.planOf(text) : null;',
            '            if (text) g.plan = shape.planOf(text);'],

        //---- which supervisor sign-in is being used ------------------------------------------------

        //"WHAT IS THERE TO HAND OVER" AND "WHAT IS IN USE" are different
        //questions, and reading one as the other made the pane show no identity
        //in use at the exact moment one was.
        ['one already out on a machine is offered as available',
            '            return sups[0].holder',
            '            return false'],

        ['and nothing reports what a supervisor is actually signed in as',
            '        var inUse = sups.filter(function (g) { return g.holder; })[0] || null;',
            '        var inUse = null;'],

        //THE SETTING NAMES AN IDENTITY SOMEBODY PICKED, and the honest answer
        //when it is gone is that it is gone.
        ['a chosen sign-in that was thrown away is silently replaced',
            '        if (!one) {',
            '        if (false) { } if (!one && false) {'],

        //ONE IS NOT AMBIGUOUS, and calling a default a decision would have the
        //pane say "in use" about something nobody chose.
        ['the only one is reported as though somebody chose it',
            '                : { key: sups[0], chosen: null, inUse: inUse, why: null };',
            '                : { key: sups[0], chosen: sups[0].name, inUse: inUse, why: null };'],

        ['two and no choice is decided by whichever was added first',
            '            if (sups.length > 1) {',
            '            if (false) {']
    ]
};
