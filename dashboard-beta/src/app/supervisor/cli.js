//---------------------------------------------------------------------------
//what the supervisor knows, at a command line.
//
//THE SAME ANSWER, READ RATHER THAN PARSED. `memory` returns the rows the pane
//draws; this is what they look like to somebody who typed the question. Nothing
//is computed here and nothing is asked for — a printer that called an action
//would be a second way to fetch the same thing, and the two would drift.
//
//THE NAME FIRST, BECAUSE THE NAME IS WHAT YOU TYPE NEXT. `memorySet` and
//`memoryForget` both take it, so a listing that made you hunt for it would be a
//listing you read twice.
//
//AND WHAT THE STORES SAY, UNDER WHAT THE SUPERVISOR BELIEVES. Each row is
//resolved against the real records — see `whereIsIt` in ./server.js — so a note
//saying "waiting on J7" beside a J7 that finished an hour ago is visible here
//rather than something somebody has to go and check. The note is the belief; the
//line under it is the truth, and where they disagree the second one is right.
//
//`--json` STILL GIVES THE BRACES, and this changes nothing about what a script
//sees. That is the deal that lets this be readable: the shape is the contract,
//and this is a view of it.
//---------------------------------------------------------------------------

module.exports = {
    print: {
        memory: function (said) {
            var rows = said.memory || [];
            if (!rows.length) return said.note || 'Nothing remembered yet.';

            var out = [];

            //WHAT FINISHED WHILE IT WAS AWAY, FIRST AND ONLY WHEN THERE IS ANY.
            //It is the reason to resolve the rows at all, and it is the one
            //thing on this answer that is news rather than a record.
            if ((said.ready || []).length) {
                out.push('  ' + said.ready.length + ' finished since it wrote them down:');
                said.ready.forEach(function (r) {
                    out.push('    ' + r.name + '  —  ' + r.now);
                });
                out.push('');
            }

            rows.forEach(function (r) {
                out.push('  ' + r.name + (r.state ? '   [' + r.state + ']' : ''));

                //WHAT IS ACTUALLY TRUE OF IT, where the name resolves to
                //something this host has a record of.
                if (r.now && r.now.how) out.push('      ' + r.now.how);

                //THE NOTE INDENTED UNDER IT AND NOT TRUNCATED. It is the reason
                //the name is worth keeping, and a list that hides it is a list
                //of names somebody has to ask about one at a time.
                String(r.note || '').split('\n').forEach(function (l) {
                    out.push('      ' + l);
                });
                out.push('');
            });

            out.push('  ' + rows.length + ' remembered');
            return out.join('\n');
        }
    }
};
