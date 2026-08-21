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
            out.push('  ' + said.waiting + ' waiting, ' + said.running + ' being read, '
                + said.decided + ' decided');
            return out.join('\n');
        },

        judgementFindings: function (said) {
            //ONE FILE IN FULL — which is what a supervisor came for, since this
            //is its only window onto the code.
            if (said.text !== undefined) {
                return [
                    '  ' + said.ref + '  ' + said.reads + '   ' + said.file,
                    ''
                ].join('\n') + said.text;
            }

            var files = said.files || [];
            var out = ['  ' + said.ref + '  ' + said.reads
                + '   ' + said.state + (said.verdict ? ', ' + said.verdict : '')];
            out.push('');

            if (!files.length) out.push('  ' + said.note);
            else {
                files.forEach(function (f) {
                    out.push('  ' + fit(f.name, 40) + Math.round((f.bytes || 0) / 1024) + ' KB');
                });
                out.push('');
                out.push('  ' + said.note);
            }
            return out.join('\n');
        }
    }
};
