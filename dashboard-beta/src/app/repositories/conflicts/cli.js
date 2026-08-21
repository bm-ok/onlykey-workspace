//---------------------------------------------------------------------------
//conflicts, at a command line.
//
//THE FILES ARE THE ANSWER, so they are on the page rather than a count. "3
//conflicting files" is a number somebody has to go and expand; the three names
//are usually enough to know whether this is ten minutes or an afternoon.
//
//AND THE CLEAN ONES ARE COUNTED, NOT LISTED. Most diverged branches merge fine,
//and printing twelve of those above the one that does not is how the one that
//does not gets missed.
//
//`--json` STILL GIVES THE BRACES, and nothing here is computed or asked for.
//---------------------------------------------------------------------------

module.exports = {
    print: {
        conflicts: function (said) {
            var bad = said.conflicts || [];
            var all = said.diverged || [];
            var unknown = said.unknown || [];

            if (!all.length) return said.note;

            var out = [];
            bad.forEach(function (c) {
                out.push('  ' + c.repo + '  ' + c.branch);
                //AHEAD AND BEHIND IN THAT ORDER, matching what git says and what
                //the pane shows.
                out.push('      ' + (c.ahead == null ? '?' : c.ahead) + ' here, '
                    + (c.behind == null ? '?' : c.behind) + ' on origin'
                    + (c.lines.length ? '   in ' + c.lines.join(', ') : ''));
                (c.files || []).forEach(function (f) { out.push('      ~ ' + f); });
                out.push('');
            });

            //COULD NOT TELL IS ITS OWN SECTION, because it is neither good news
            //nor bad and reading it as either is the mistake.
            if (unknown.length) {
                out.push('  could not tell:');
                unknown.forEach(function (c) {
                    out.push('    ' + c.repo + '  ' + c.branch + ' — ' + (c.why || 'git would not say'));
                });
                out.push('');
            }

            var fine = all.length - bad.length - unknown.length;
            if (fine > 0) {
                out.push('  ' + fine + ' other diverged branch' + (fine === 1 ? '' : 'es') + ' would merge cleanly.');
            }
            out.push('  ' + said.note);
            return out.join('\n');
        }
    }
};
