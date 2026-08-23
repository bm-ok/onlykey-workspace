//---------------------------------------------------------------------------
//WHAT A WORKER IS HANDED, AND WHAT IT IS HELD TO.
//
//Two decisions, neither of which runs anything:
//
//  the rules       which contract this run is under, and refusing the two ways
//                  of saying it at once
//  the brief       what a continuation is told before the task itself
//
//BOTH ARE ABOUT WHAT CAN BE PROVEN LATER. A task carries the TEXT of its prompt
//and contract so that what a worker was held to can be shown six weeks
//afterwards — not a path that pointed at a file that has since changed, and not
//a name that meant something at the time.
//---------------------------------------------------------------------------

//---- TWO DOORS, NAMED FOR WHAT THEY ARE ------------------------------------
//
//    contract   a file on THIS HOST. What the command line and the drills point
//               at, read here and carried with the task.
//    rules      the text itself. What a task carries once it has been written
//               under a contract from the library — the copy, not the name.
//
//BOTH AT ONCE IS REFUSED. Preferring one silently would make "which rules was
//this run under" depend on which line of code read it first, and that is the
//exact question the whole arrangement exists to answer.
//
//AND EMPTY IS WORSE THAN NONE, which is why it is refused twice and separately.
//A contract that silently fails to load leaves a worker running with no rules
//while everything downstream reports that a contract was applied — so "there is
//no file there", "the file is empty" and "the rules you gave me are empty" are
//three different sentences, because they have three different fixes.
module.exports = function briefing(deps) {
    var d = deps || {};

    var readFile = d.readFile;    //(path) -> string, throws if it is not there
    var exists = d.exists;        //(path) -> boolean
    var resolve = d.resolve;      //(path) -> absolute path
    var basename = d.basename;    //(path) -> the last part

    function rulesFor(it) {
        var a = it || {};
        var given = a.rules == null ? null : String(a.rules);
        var file = a.contract == null || a.contract === '' ? null : String(a.contract);

        if (file && given) {
            throw new Error('Give it either a contract file or the rules themselves, not both.');
        }

        if (file) {
            var at = resolve(file);
            if (!exists(at)) {
                throw new Error('There is no contract at ' + at + '. It is read from this host, not '
                    + 'from the machine.');
            }
            var read = readFile(at);
            if (!read.trim()) {
                throw new Error('The contract at ' + at + ' is empty, and an empty contract is worse '
                    + 'than none: it reads as though rules were applied.');
            }
            return { rules: read, named: basename(at), at: at };
        }

        if (given !== null) {
            if (!given.trim()) {
                throw new Error('The rules are empty, and empty rules are worse than none: everything '
                    + 'downstream reports that a contract was applied.');
            }
            return { rules: given, named: a.contractName || 'the rules it was given', at: null };
        }

        //---- NO RULES IS ALLOWED, AND IS SAID PLAINLY ----------------------
        //
        //Because it is the dangerous one AND the silent one: a run without a
        //contract looks exactly like a run with one from everywhere except here.
        return { rules: null, named: null, at: null };
    }

    return { rulesFor: rulesFor };
};

//---- AND WHAT GOES IN FRONT OF THE TASK ------------------------------------
//
//The announcement is ../sessions/keying.js's — what it SAYS is a property of the
//memory keying and belongs with it. This is only where it goes: in front, with
//the task named as the task, so a worker cannot read the warning as part of the
//brief it is being given.
function briefWith(said, task) {
    var text = String(task == null ? '' : task);
    if (!said) return text;
    return [said, '--- the task ---', '', text].join('\n');
}

module.exports.briefWith = briefWith;
