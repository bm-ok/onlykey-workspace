//---------------------------------------------------------------------------
//THE DIFFERENCE BETWEEN TWO DOCUMENTS, IN LINES.
//
//WRITTEN HERE RATHER THAN INSTALLED. This app has no dependencies and does not
//intend to gain one for forty lines of arithmetic — see the rule in the skill
//this compares: node and git, nothing else.
//
//AND NOT `git diff --no-index` EITHER, which would work and would mean writing
//two temporary files, shelling out, and parsing the result, to compare two
//strings this process already has in memory.
//
//LINES, NOT WORDS. What is compared here is a skill, a contract, a prompt or a
//job — documents somebody reads a line at a time, where a changed line is the
//unit of meaning. A word-level diff of prose is prettier and answers a question
//nobody asked of these.
//---------------------------------------------------------------------------

//---- the longest common subsequence, by length only ------------------------
//
//THE TABLE IS THE WHOLE ALGORITHM and it is O(n*m). These are documents of a
//few hundred lines, so that is a table of a hundred thousand small integers —
//instant, and bounded below so a pathological input cannot be handed to it.
//
//A CAP, BECAUSE A DIFF IS A CONVENIENCE AND A HUNG WINDOW IS NOT. Beyond it the
//answer is honest about being a summary rather than pretending to be a diff.
var MOST_LINES = 4000;

function table(a, b) {
    var n = a.length;
    var m = b.length;
    var rows = new Array(n + 1);
    var i, j;

    for (i = 0; i <= n; i++) rows[i] = new Int32Array(m + 1);

    for (i = n - 1; i >= 0; i--) {
        for (j = m - 1; j >= 0; j--) {
            rows[i][j] = a[i] === b[j]
                ? rows[i + 1][j + 1] + 1
                : Math.max(rows[i + 1][j], rows[i][j + 1]);
        }
    }
    return rows;
}

//---- and the walk back through it ------------------------------------------
//
//`same`, `gone`, `added` — three kinds and no fourth. A "changed" line is a
//`gone` beside an `added`, which is what it actually is: two documents do not
//agree that a line was edited, only that one has it and the other does not.
function walk(a, b) {
    var rows = table(a, b);
    var out = [];
    var i = 0;
    var j = 0;

    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            out.push({ how: 'same', text: a[i] });
            i++; j++;
        } else if (rows[i + 1][j] >= rows[i][j + 1]) {
            out.push({ how: 'gone', text: a[i] });
            i++;
        } else {
            out.push({ how: 'added', text: b[j] });
            j++;
        }
    }
    while (i < a.length) { out.push({ how: 'gone', text: a[i] }); i++; }
    while (j < b.length) { out.push({ how: 'added', text: b[j] }); j++; }
    return out;
}

//---- what is worth showing -------------------------------------------------
//
//CONTEXT AROUND EACH CHANGE, and the unchanged middle dropped. A document of
//five hundred lines with one edited paragraph is not a five-hundred-line diff,
//and printing it as one is how nobody reads it.
function withContext(rows, around) {
    var keep = {};
    var i, k;

    for (i = 0; i < rows.length; i++) {
        if (rows[i].how === 'same') continue;
        for (k = Math.max(0, i - around); k <= Math.min(rows.length - 1, i + around); k++) keep[k] = true;
    }

    var out = [];
    var skipped = 0;
    for (i = 0; i < rows.length; i++) {
        if (keep[i]) {
            //SAID, NOT SILENTLY DROPPED. A gap with no mark is a diff that looks
            //complete and is not.
            if (skipped) { out.push({ how: 'skipped', lines: skipped }); skipped = 0; }
            out.push(rows[i]);
        } else {
            skipped++;
        }
    }
    if (skipped) out.push({ how: 'skipped', lines: skipped });
    return out;
}

//---- THE ANSWER ------------------------------------------------------------
//
//    { same, gone, added, rows, note, whole }
//
//THE COUNTS ARE THE HEADLINE. "+98 characters" says a document grew; "12 lines
//added, 3 gone" says what happened to it, and the two are answers to different
//questions.
function of(before, after, opts) {
    var o = opts || {};
    var around = o.around === undefined ? 3 : Math.max(0, Number(o.around) || 0);

    var a = String(before == null ? '' : before).split('\n');
    var b = String(after == null ? '' : after).split('\n');

    if (a.length > MOST_LINES || b.length > MOST_LINES) {
        return {
            same: 0, gone: 0, added: 0, rows: [], whole: false,
            note: 'These are ' + a.length + ' and ' + b.length + ' lines, and this compares up to '
                + MOST_LINES + '. Read them side by side rather than as a difference.'
        };
    }

    var rows = walk(a, b);
    var gone = rows.filter(function (r) { return r.how === 'gone'; }).length;
    var added = rows.filter(function (r) { return r.how === 'added'; }).length;
    var same = rows.length - gone - added;

    return {
        same: same,
        gone: gone,
        added: added,
        rows: withContext(rows, around),
        whole: true,
        note: (gone || added)
            ? added + ' line(s) added, ' + gone + ' gone.'
            //NOTHING CHANGED IS AN ANSWER, and a common one: a document saved
            //twice, or approved again after being read.
            : 'Nothing changed — the two are the same document.'
    };
}

//---- and the same thing as text, for a log or a command line ---------------
function asText(d, most) {
    var cap = most || 200;
    var out = [];
    (d.rows || []).slice(0, cap).forEach(function (r) {
        if (r.how === 'skipped') out.push('  … ' + r.lines + ' unchanged line(s)');
        else if (r.how === 'gone') out.push('- ' + r.text);
        else if (r.how === 'added') out.push('+ ' + r.text);
        else out.push('  ' + r.text);
    });
    if ((d.rows || []).length > cap) out.push('  … ' + ((d.rows.length - cap)) + ' more');
    return out.join('\n');
}

module.exports = { of: of, asText: asText, MOST_LINES: MOST_LINES };
