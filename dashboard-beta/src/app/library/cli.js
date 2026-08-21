//---------------------------------------------------------------------------
//the library, at a command line.
//
//WHETHER IT COULD RUN IS THE WHOLE QUESTION, so that is the column. A list of
//names with four flags beside each — approved, lapsed, set aside, its prompt's
//state — is a table somebody has to combine in their head to answer the one
//thing they came for, and combining it is exactly what ./chain.js already did.
//
//SO A ROW IS EITHER `runnable` OR THE REASON IT IS NOT, said in full. "Its
//prompt is not usable" would send somebody to the prompt to find it fine, so the
//sentence names both halves and the fault two links down comes with it.
//
//THE KIND IS A COLUMN AND NOT A FILTER, because a plain listing that hid half of
//what exists is how a judging chain gets picked for work — and asking for one
//kind is what `--kind` is for.
//
//`--json` STILL GIVES THE BRACES, and nothing here is computed or asked for.
//---------------------------------------------------------------------------

//WIDE ENOUGH FOR THE IDS THIS APP ACTUALLY HAS and cut rather than wrapped: a
//table that wraps stops being a table, and the id is a handle rather than a
//sentence — the name beside it is the readable half.
//CUT TWO SHORT OF THE COLUMN, not one. Cutting to exactly the width fills the
//field, so the pad adds nothing and the next column runs straight into the
//ellipsis — `…judge` — which reads as a word rather than as two columns.
function fit(s, n) {
    var t = String(s == null ? '' : s);
    return (t.length > n ? t.slice(0, n - 2) + '…' : t).padEnd(n);
}

function rows(list, say) {
    var out = [];
    list.forEach(function (e) {
        //SET ASIDE IS SAID FIRST, because it outranks everything else about a
        //row: nothing is offered it whatever else is true.
        var state = e.setAside ? 'set aside' : say(e);
        out.push('  ' + fit(e.id, 34) + fit(e.kind, 7) + state);
    });
    return out;
}

module.exports = {
    print: {
        jobs: function (said) {
            var all = said.jobs || [];
            if (!all.length) return said.note;

            var out = [];
            all.forEach(function (j) {
                var state = j.setAside ? 'set aside' : (j.runnable ? 'runnable' : (j.whyNot || 'cannot run'));
                out.push('  ' + fit(j.id, 34) + fit(j.kind, 7) + state);

                //THE PROMPT EACH ONE RUNS, under the row rather than in a column
                //of its own: it is the other half of what a job IS, and a column
                //wide enough for a prompt name leaves no room for the reason.
                if (j.prompt) out.push('      says: ' + j.prompt.name);
                else if (j.promptId) out.push('      says: ' + j.promptId + ' — which is not here');
            });

            out.push('');
            out.push('  ' + said.note);
            if (said.tags && said.tags.length) out.push('  tags: ' + said.tags.join(', '));
            return out.join('\n');
        },

        prompts: function (said) {
            var all = said.prompts || [];
            if (!all.length) return said.note;

            var out = [];
            all.forEach(function (p) {
                var state = p.setAside ? 'set aside' : (p.usable ? 'usable' : (p.whyNot || 'not usable'));
                out.push('  ' + fit(p.id, 34) + fit(p.kind, 7) + state);
                //THE RULES IT RUNS UNDER. A prompt is what a worker is told and a
                //contract is what it may not do, and the two are only ever read
                //together — so the listing shows both or it shows half a chain.
                if (p.contract) out.push('      under: ' + p.contract.name);
                else if (p.contractId) out.push('      under: ' + p.contractId + ' — which is not here');
            });

            out.push('');
            out.push('  ' + said.note);
            return out.join('\n');
        },

        contracts: function (said) {
            var all = said.contracts || [];
            if (!all.length) return said.note;

            var out = rows(all, function (c) {
                return c.approved ? 'approved' : (c.lapsed ? 'edited since it was approved' : 'waiting to be read');
            });
            out.push('');
            out.push('  ' + said.note);
            return out.join('\n');
        },

        //---- one of them, in full ------------------------------------------
        //
        //THE TEXT IS THE POINT HERE, and it is why the listings leave it out. A
        //job's script is a hundred and thirty lines and a contract is the rules
        //somebody is about to be held to; both are read, not scanned.
        job: function (said) {
            var out = [
                '  ' + said.name + '  (' + said.id + ', ' + said.kind + ')',
                '  ' + (said.runnable ? 'runnable' : (said.whyNot || 'cannot run'))
            ];
            if (said.prompt) out.push('  says: ' + said.prompt.name);
            if (said.about) out.push('  ' + said.about);
            out.push('');
            out.push(said.code || '');
            return out.join('\n');
        },

        contract: function (said) {
            var out = [
                '  ' + said.name + '  (' + said.id + ', ' + said.kind + ')',
                '  ' + (said.approved ? 'approved' : (said.lapsed ? 'edited since it was approved' : 'waiting to be read'))
            ];
            if (said.about) out.push('  ' + said.about);
            out.push('');
            out.push(said.text || '');
            return out.join('\n');
        }
    }
};
