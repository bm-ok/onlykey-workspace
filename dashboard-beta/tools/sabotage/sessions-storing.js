//what ../../test/runners/sessions-storing.test.js has to be able to catch.
//
//THE FIRST GROUP IS THE ONE THAT MATTERS. An unsealed credential written into a
//folder whose whole purpose is to be kept for a long time is not a bug that
//announces itself — it is a file sitting quietly in a drawer, and the only
//moment anything can stop it is before the write.
module.exports = {
    file: 'src/app/runners/sessions/storing.js',
    test: 'test/runners/sessions-storing.test.js',
    breaks: [
        //---- what may never be kept ----------------------------------------

        ['an archive with a credential in it is kept anyway',
            '        if (seen.refuse && seen.refuse.length) {',
            '        if (false) {'],

        ['and the check is there but nothing is asked of it',
            '        var seen = inspect(bytes);',
            '        var seen = { inside: null, refuse: [] };'],

        //THE ORDER. Writing first and checking after leaves the thing being
        //refused on disk — recoverable, and simply present for a window.
        ['the archive is written first and the refusal only deletes it afterwards',
            '        var seen = inspect(bytes);\n        if (seen.refuse && seen.refuse.length) {',
            '        var seen = inspect(bytes);\n        io.mkdirSync(await dirFor(uid), { recursive: true });\n        io.writeFileSync(path.join(await dirFor(uid), \'claude.tgz\'), bytes);\n        if (seen.refuse && seen.refuse.length) {'],

        ['and the refusal does not say what was found',
            "            throw new Error('that archive has ' + seen.refuse.join(', ') + ' in it, and a credential is '",
            "            throw new Error('that archive was refused. '"],

        //---- the other refusals ---------------------------------------------

        ['an archive of any size at all is taken',
            '        if (bytes.length > most) {',
            '        if (false) {'],

        ['an empty upload is kept as though it were a conversation',
            '        if (!bytes || !bytes.length) throw new Error(\'there was nothing in it\');',
            ''],

        ['a session id that is a path is written into the record',
            "        if (!okId(meta.id)) throw new Error('that is not a session id');",
            ''],

        ['and any id at all is a session id',
            "var ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;",
            "var ID = /^.*$/;"],

        //NOWHERE TO KEEP IT IS NOT THE SAME AS KEEPING IT. This is a record of
        //something on a machine that is about to be rolled back.
        ['with no workspace open it reports success and keeps nothing',
            "        if (!dir) {\n            throw new Error('no workspace is open, so there is nowhere to keep what this remembers. '",
            "        if (false) {\n            throw new Error('no workspace is open, so there is nowhere to keep what this remembers. '"],

        //---- a key is a folder name -----------------------------------------

        ['a key is written into a path as it arrives',
            '        return at ? path.join(at, keying.safe(uid)) : null;',
            '        return at ? path.join(at, String(uid)) : null;'],

        //---- replaced, not added to ------------------------------------------

        ['a conversation is kept beside its own earlier copy',
            "        io.writeFileSync(path.join(dir, 'claude.tgz'), bytes);",
            "        io.writeFileSync(path.join(dir, 'claude-' + Date.now() + '.tgz'), bytes);"],

        //---- what is carried forward, and what is not -------------------------

        ['a resumed conversation forgets it was ever resumed',
            "            runs: ((was && was.runs) || 0) + 1,",
            "            runs: 1,"],

        ['and forgets when it was first kept',
            "            first: (was && was.first) || new Date().toISOString()",
            "            first: new Date().toISOString()"],

        //BUILT FROM WHAT IS ON DISK, which is the point of writing it here at
        //all rather than asking the sign-in list.
        ['only the latest sign-in is remembered, so one thrown away is unnamed',
            '        var already = (was && was.guests) || [];',
            '        var already = [];'],

        //A RUN WITH NO SIGN-IN NAMED is signed by whatever this host used to
        //keep. Inheriting says something untrue about who paid for it.
        ['this run inherits the previous run\'s sign-in',
            '            guest: meta.guest || null,',
            '            guest: meta.guest || (was && was.guest) || null,'],

        ['what the conversation is about is dropped when a later run does not say',
            '            lane: meta.lane || (was && was.lane) || null,\n            about: meta.about || (was && was.about) || null,',
            '            lane: meta.lane || null,\n            about: meta.about || null,'],

        //THE MACHINE AND THE RUN ARE THIS RUN'S. Carrying them forward files a
        //conversation against a machine that did not have it.
        ['the machine that had it last is reported as having it now',
            '            machine: meta.machine || null,',
            '            machine: meta.machine || (was && was.machine) || null,'],

        //---- reading it back --------------------------------------------------

        ['a record written before lane and subject were kept cannot say what it is',
            "        var named = /^(worker|judge)--(?:cut|pull)--(.+)$/.exec(String(uid));",
            "        var named = null;"],

        ['a uid from before subject keying is given a made-up subject',
            "            about: about.about || (named ? named[2] : null)",
            "            about: about.about || String(uid)"],

        //WHAT WAS PRODUCED OUTLIVES THE NOTE ABOUT IT.
        ['an archive whose record will not parse is reported as not being there',
            "        catch (e) { /* an interrupted keep, and the archive still counts */ }",
            "        catch (e) { return null; }"],

        //---- the list and forgetting ------------------------------------------

        ['the list comes back oldest first',
            "            return String(b.kept || '').localeCompare(String(a.kept || ''));",
            "            return String(a.kept || '').localeCompare(String(b.kept || ''));"],

        ['forgetting something that was never kept is reported as done',
            "        if (!found) throw new Error('there is no session kept under that name');",
            ''],

        ['forgetting leaves the record behind, so the list still shows it',
            "        try { io.unlinkSync(path.join(dir, 'claude.tgz')); } catch (e) { /* already gone */ }",
            '']
    ]
};
