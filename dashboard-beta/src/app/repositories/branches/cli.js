//---------------------------------------------------------------------------
//lines, at a command line.
//
//THE STATE OF THE LINE FIRST, because it is the worst of its parts and that is
//the thing a list of lines is for. A column of `ok` is "nothing to do here"
//without reading a word of it.
//
//AND THE PART THAT IS DRAGGING IT DOWN IS NAMED. A line that reads `behind` with
//no indication of WHICH repository is a line somebody has to go and open. The
//parts that are fine are counted, not listed — three lines with three parts each
//is nine rows of mostly nothing.
//
//`--json` STILL GIVES THE BRACES.
//---------------------------------------------------------------------------

//`null` IS NOT AN UNKNOWN, IT IS A STATE. A line every part of which exists only
//here has nothing to be in step WITH — origin has never seen any of it. That is
//an ordinary thing for work that has not gone anywhere yet, and printing `?`
//beside it read as a fault.
var MARK = { ok: ' ', behind: '<', conflict: '!' };
var UNPUSHED = '+';

module.exports = {
    print: {
        lines: function (said) {
            var all = said.lines || [];
            if (!all.length) return said.note;

            var out = [];
            all.forEach(function (g) {
                var head = ' ' + (g.sync ? MARK[g.sync] : UNPUSHED) + '  ' + g.name;
                if (g.marked) head += '   [proposed]';
                out.push(head);

                if (g.why) out.push('       ' + g.why);

                //ONLY THE PARTS WITH SOMETHING TO SAY. `behind` already holds
                //exactly those, worked out where the rule lives rather than
                //re-derived here.
                (g.behind || []).forEach(function (p) {
                    out.push('       ' + p.repo + '  ' + p.branch + '  — ' + p.state);
                });
                (g.broken || []).forEach(function (b) { out.push('       ' + b); });

                //IN STEP WITH WHAT. A part origin has never seen is not in step
                //and is not out of step — it is work that has not gone anywhere,
                //and counting it as agreement was saying "3 of 3 in step" about
                //three branches origin has never heard of.
                var parts = g.on || [];
                var onlyHere = parts.filter(function (p) { return p.state === 'only here'; }).length;
                var fine = parts.length - (g.behind || []).length - onlyHere;

                if (fine > 0) out.push('       ' + fine + ' of ' + parts.length + ' in step with origin');
                if (onlyHere) {
                    out.push('       ' + onlyHere + (onlyHere === parts.length ? ' — all of it' : '')
                        + ' only here, never pushed');
                }
                if ((g.missing || []).length) {
                    //NOT A FAULT, and the wording says so — a line made when
                    //there were three repositories still describes those three.
                    out.push('       not named in: ' + g.missing.join(', '));
                }
                out.push('');
            });

            out.push('  ' + said.note);
            return out.join('\n');
        },

        lineWithdraw: function (said) { return said.note; }
    }
};
