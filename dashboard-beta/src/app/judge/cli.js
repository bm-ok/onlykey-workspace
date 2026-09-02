//---------------------------------------------------------------------------
//judgements, at a command line.
//
//WHAT IT READ AND WHAT IT DECIDED, in that order, because a verdict with no
//subject beside it is an opinion about nothing. A judgement's subject is a
//CHANGE — a branch cut, a PR cut, or somebody else's pull request — and which
//of those it is changes what the verdict means.
//
//AND `crashed` IS PRINTED WHEREVER IT IS TRUE, because a run that died and a
//judge that read the change and found nothing are the same row without it. That
//distinction was worth building into the answer; leaving it out of the printing
//would put it back where it was.
//
//`--json` STILL GIVES THE BRACES, and nothing here is computed or asked for.
//---------------------------------------------------------------------------

function fit(s, n) {
    var t = String(s == null ? '' : s);
    return (t.length > n ? t.slice(0, n - 2) + '…' : t).padEnd(n);
}

module.exports = {
    print: {
        judging: function (said) {
            //ONE IN FULL is a different answer from the list, and it arrives
            //under a different key.
            if (said.judgement) {
                var j = said.judgement;
                var one = [
                    '  ' + j.ref + '  ' + j.subject.name + '   (' + j.subject.kind + ')',
                    '  ' + j.state + (j.verdict ? ' — ' + j.verdict : '')
                        + (j.by === 'person' ? '   read by a person' : '')
                ];
                if (j.question) one.push('  asked: ' + j.question);
                if (j.contractName) one.push('  under: ' + j.contractName);
                if (j.note) { one.push(''); one.push(j.note); }
                one.push('');
                one.push('  ' + said.note);
                return one.join('\n');
            }

            var all = said.judgements || [];
            if (!all.length) return '  ' + said.note;

            var out = [];
            all.forEach(function (x) {
                var state = x.verdict ? x.state + ', ' + x.verdict : x.state;
                //A CRASHED RUN IS NOT A VERDICT, and it outranks the state on
                //the row: nothing it says about the code is a finding.
                if (x.crashed) state = 'THE RUN FAILED';
                out.push('  ' + fit(x.ref, 6) + fit(state, 20) + x.subject.name);
                if (x.question) out.push('      asked: ' + fit(x.question, 90).trim());
                if (x.note) out.push('      ' + fit(x.note, 90).trim());
            });

            out.push('');
            //AND THE ONES THAT ENDED WITHOUT DECIDING ANYTHING, but only when
            //there are some. A standing "0 gave up" on every line trains the eye
            //past the word, and this is a line read at a glance.
            out.push('  ' + said.waiting + ' waiting, ' + said.running + ' being read, '
                + said.decided + ' decided'
                + (said.gaveUp ? ', ' + said.gaveUp + ' ended without a verdict' : ''));
            return out.join('\n');
        },

        //WHAT IT HANDED BACK, AND ONLY THAT.
        //
        //THIS PRINTED `J4 undefined undefined` FOR ONE COMMIT. It read `reads`,
        //`state` and `verdict` off the answer, and those left when the action
        //stopped folding the judgement's own facts in beside the files — they are
        //`judging`'s to answer now.
        //
        //NOTHING FAILED AND NOTHING WAS LOGGED. Reading a missing field off an
        //object is `undefined`, and `'  ' + undefined` is a string; the only sign
        //was the word on the line. It is the shape of quiet failure this app's
        //notes keep returning to, one layer out from a misspelt CSS class.
        judgementFindings: function (said) {
            //ONE FILE IN FULL — which is what a supervisor came for, since this
            //is its only window onto the code.
            if (said.text !== undefined) {
                return [
                    '  ' + said.ref + '   ' + said.file
                        + (said.bytes ? '   ' + Math.round(said.bytes / 1024) + ' KB' : ''),
                    ''
                ].join('\n') + said.text;
            }

            var files = said.files || [];
            var out = ['  ' + said.ref + '   ' + files.length + ' file(s)'];
            out.push('');

            if (!files.length) out.push('  ' + said.note);
            else {
                files.forEach(function (f) {
                    //THE NAME THE JOB WAS TOLD TO WRITE, not the one on disk.
                    //
                    //A file is kept as `<run>--<name>` so two runs cannot
                    //overwrite each other, and this column fits forty characters.
                    //The run prefix is thirty-four of them, so printing the
                    //on-disk name gave `job-check-a-claim-20260902211533--CLAI…`
                    //— everything except the part somebody needs in order to ask
                    //for it. `judgementFindings --file CLAIM.md` is what the read
                    //door already accepts.
                    out.push('  ' + fit(f.name || f.file, 40)
                        + Math.round((f.bytes || 0) / 1024) + ' KB');
                });
                out.push('');
                out.push('  ' + said.note);
            }
            return out.join('\n');
        }
    }
};
