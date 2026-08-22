//what ../../test/runners/guests-shape.test.js has to be able to catch.
//
//TWO OF THESE BREAKS ARE THE BUGS THEMSELVES. `usable` and `mayOverturn` each
//exist because of one run that cost a credential, and reverting either puts the
//app back exactly where it was.
module.exports = {
    file: 'src/app/runners/guests/shape.js',
    test: 'test/runners/guests-shape.test.js',
    breaks: [
        //---- whether a credential is a credential at all ----------------------

        //THE ONE THAT COST A TOKEN. A machine that cleared its own sign-in hands
        //back the right shape with both tokens empty, and this is what tells
        //that apart from a rotation.
        ['the shape alone is read as a credential',
            "        return !!(String(c.accessToken || '').trim() || String(c.refreshToken || '').trim());",
            '        return true;'],

        ['whitespace counts as a token',
            "        return !!(String(c.accessToken || '').trim() || String(c.refreshToken || '').trim());",
            '        return !!(c.accessToken || c.refreshToken);'],

        //BOTH TOKENS ARE READ, because either one alone is still a credential —
        //requiring both would refuse a working sign-in.
        ['only the access token counts, so a refresh-only credential is thrown away',
            "        return !!(String(c.accessToken || '').trim() || String(c.refreshToken || '').trim());",
            "        return !!String(c.accessToken || '').trim();"],

        //A TRUNCATED READ LOOKS EXACTLY LIKE UNPARSEABLE, and "keep what we
        //have" is the right answer to both.
        ['unparseable is read as usable',
            '        return false;\n    }\n}',
            '        return true;\n    }\n}'],

        //---- what a token is, as a number ---------------------------------------

        ['the fingerprint is long enough to be worth something to somebody',
            "    return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);",
            "    return String(text).slice(0, 16);"],

        //---- a name ---------------------------------------------------------------

        //IT IS A FILENAME. A name that is a path is a file written somewhere
        //nobody looked.
        ['a name may be a path',
            "var NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;",
            'var NAME = /^.+$/;'],

        ['a name may lead with a dot, so a sign-in can be hidden',
            "var NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;",
            'var NAME = /^[a-zA-Z0-9._-]{1,64}$/;'],

        //---- three roles ------------------------------------------------------------

        //ANYTHING UNRECOGNISED IS A WORKER, which is the least-privileged. The
        //other way round, a record with a typo in it reaches a supervisor
        //machine.
        ['an unrecognised role is read as whatever it says',
            "    return said === 'supervisor' ? 'supervisor' : said === 'judge' ? 'judge' : 'worker';",
            "    return said || 'worker';"],

        //THE RETIRED WORD IS READ, NOT MIGRATED. An old record needs no
        //rewriting to be readable.
        ['the old word for a worker is not read as one',
            "    return said === 'supervisor' ? 'supervisor' : said === 'judge' ? 'judge' : 'worker';",
            "    return said === 'supervisor' ? 'supervisor' : said === 'judge' ? 'judge' : (said || 'worker');"],

        //AND SETTING A ROLE IS A DIFFERENT QUESTION FROM READING ONE. The
        //retired word must not be settable.
        ['the retired word can be set as a role',
            "function isRole(said) { return ROLES.indexOf(String(said || '').toLowerCase()) >= 0; }",
            "function isRole(said) { return true; }"],

        //---- and whether it is known bad ----------------------------------------------

        //NEVER CHECKED IS NOT THE SAME AS CHECKED AND DEAD, and only one of them
        //is a reason to sign in again.
        ['a sign-in nothing has tried is treated as failed',
            'function paused(g) { return !!(g && g.lastCheck && g.lastCheck.ready === false); }',
            'function paused(g) { return !(g && g.lastCheck && g.lastCheck.ready); }'],

        //---- two kinds of evidence ------------------------------------------------------

        //THE OTHER ONE THAT COST SOMETHING. A probe reported ready three times
        //about a dead sign-in because the file was on the disk, erasing a no a
        //real run had established, and the queue spent a machine each time.
        ['a probe may clear a failure a run established',
            '    return (STRENGTH[how] || 1) >= (STRENGTH[(had && had.how) || \'run\'] || 2);',
            '    return true;'],

        ['an older record with no kind on it is treated as a probe',
            "    return (STRENGTH[how] || 1) >= (STRENGTH[(had && had.how) || 'run'] || 2);",
            "    return (STRENGTH[how] || 1) >= (STRENGTH[(had && had.how) || 'probe'] || 1);"],

        //ONLY ABSOLVING IS RANKED. A probe that finds a credential missing is
        //worth recording however strong the last good news was.
        ['a weak report cannot record a FAILURE either',
            '    if (!had || had.ready !== false || ready !== true) return true;',
            '    if (!had) return true;'],

        ['a run cannot clear a failure a probe established',
            "    return (STRENGTH[how] || 1) >= (STRENGTH[(had && had.how) || 'run'] || 2);",
            '    return false;']
    ]
};
