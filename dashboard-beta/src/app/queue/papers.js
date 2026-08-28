//---------------------------------------------------------------------------
//WHAT A JUDGE SAID, PUT WHERE THE WORKER WILL FIND IT.
//
//A worker's job is to SATISFY THE JUDGE, and it cannot do that if it has never
//seen what the judge said. The supervisor quotes the finding in the brief, which
//is necessary and is not enough: a finding is usually a page, with file names
//and quoted lines in it, and a brief is a paragraph.
//
//ONLY THE JUDGEMENT THIS TASK CAME FROM. Every judgement ever made would be a
//filing cabinet; the one that established this work is real is the one the work
//has to answer.
//
//---- beside the repositories, and never inside one -------------------------
//
//The working folder's ROOT is not a git repository, so a report left there
//cannot be committed by accident — and `ls` shows it immediately. Written into a
//repository it would be a file the worker is liable to commit while doing
//exactly what it was asked, and a judge's report landing in the branch under
//review is the change reviewing itself.
//
//---- and it travels as base64 ----------------------------------------------
//
//A report is arbitrary text somebody's model wrote: quotes, backticks, dollar
//signs, newlines, and whatever else ended up in it. Interpolating that into a
//shell command is the bug — not a risk of one, the bug — so the bytes go over as
//base64 and are decoded on the far side, where nothing parses them.
//
//THE NAME IS SANITISED FOR THE SAME REASON. It becomes a filename on the guest,
//and what a model called its own file is not something to hand to a shell.
//---------------------------------------------------------------------------

module.exports = function papers(deps) {
    var d = deps || {};

    var judging = d.judging;      //get — which judgement, and its uid
    var handedBack = d.handedBack; //(uid) -> [{file}]
    var readHanded = d.readHanded; //(uid, file) -> { text }
    var run = d.run;               //(machine, command, opts)

    //ANYTHING THAT IS NOT A LETTER, DIGIT, DOT, DASH OR UNDERSCORE. Not an
    //escape and not a rejection: this is a name for somebody to see in a
    //directory listing, and a report whose title had a slash in it should still
    //arrive.
    function called(ref, file) {
        return String(ref + '-' + file).replace(/[^A-Za-z0-9._-]/g, '-');
    }

    async function deliver(judgementId, machine, to) {
        //AWAITED. The store's `get` is async, and read without the await it
        //is a Promise: truthy, with no `uid` on it -- so `handedBack(undefined)`
        //answered nothing and NO WORKER EVER RECEIVED A JUDGE'S REPORT. Every
        //task raised because of a judgement was logged "the judgement handed
        //nothing back" and worked from its brief alone, while the report sat in
        //the drawer. Four tasks in a row said it before anybody read the line.
        var from = await judging.get(judgementId);
        if (!from) return [];

        var all = (await handedBack(from.uid)) || [];
        var landed = [];

        for (var i = 0; i < all.length; i++) {
            var body = await readHanded(from.uid, all[i].file);
            //A FILE THAT IS NOT TEXT IS SKIPPED, not fatal. What is being read is
            //whatever a model chose to write to disk, and one unreadable file
            //must not stop the rest arriving.
            if (!body || typeof body.text !== 'string') continue;

            var name = called(from.ref, all[i].file);
            var b64 = Buffer.from(body.text, 'utf8').toString('base64');

            //`cd ~/workspace 2>/dev/null || cd ~` — the working folder if there
            //is one, and the home directory if the machine was set up
            //differently. Landing a report nowhere is worse than landing it
            //somewhere a person can find.
            await run(machine,
                'cd ~/workspace 2>/dev/null || cd ~; printf %s \'' + b64 + '\' | base64 -d > '
                    + JSON.stringify(name),
                { what: 'putting ' + from.ref + '\'s report where the worker will find it', timeout: 60000 });

            to.info(from.ref + ' said ' + all[i].file + ' — left on ' + machine + ' as ' + name);
            landed.push(name);
        }

        return landed;
    }

    return { deliver: deliver, called: called };
};
