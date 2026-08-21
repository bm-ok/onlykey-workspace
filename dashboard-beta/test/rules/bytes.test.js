const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//---------------------------------------------------------------------------
//no control characters in source.
//
//WHY THIS EXISTS, AND IT HAS ALREADY EARNED ITSELF TWICE.
//
//A NUL byte reached two files here through an editing tool, in place of an
//ordinary space. Neither announced itself:
//
//  tools/walk.js       the sentinel used to make the app list its own tabs
//                      became '\0no such tab'. What came back was node
//                      complaining about the argument rather than the app's
//                      list, so the walk reported "could not find out what tabs
//                      there are" while every tab was fine.
//
//  src/app/guards/main.js   a key builder read `(where || '*') + '\0' + label`.
//                      It BUILT AND RAN. Worse, a later edit meant to replace
//                      that line searched for the version with a space, found
//                      nothing, and changed nothing — silently — so the two
//                      halves of the guards store went on keying their entries
//                      differently while a commit message said they had been
//                      brought into line.
//
//THAT SECOND ONE IS THE ARGUMENT. A stray byte that only breaks behaviour is a
//bug you chase. A stray byte that also makes string edits miss is a bug that
//makes you believe you fixed something you did not, and it is invisible in a
//diff, in a review, and in a passing test run. `grep` gives it away by calling
//the file binary, which nobody reads as a warning.
//
//TABS AND NEWLINES ARE FINE. Everything else below 0x20, and 0x7f, is not.
//
//AND VENDORED CODE IS NOT SOURCE, which this learned from xterm. Its bundle
//carries a real 0x1b — an escape, written into a string, by a terminal emulator
//that exists to interpret escapes. That is not a stray byte, it is the subject
//matter. The argument above is about files somebody EDITS: a byte that makes a
//later string edit silently miss. Nobody edits a vendored bundle; the whole
//point of vendoring is that what is here is what they published, and a rule that
//forbade it would be a rule to suppress rather than one to keep.
//---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const LOOK = ['src', 'test', 'tools'];

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || name === 'node_modules' || name === 'vendor') continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (/\.(jsx?|json|scss|css|md)$/.test(name)) out.push(full);
    }
    return out;
}

test('no source file carries a stray control character', () => {
    const found = [];
    for (const where of LOOK) {
        const dir = path.join(ROOT, where);
        if (!fs.existsSync(dir)) continue;
        for (const file of walk(dir)) {
            const bytes = fs.readFileSync(file);
            for (let i = 0; i < bytes.length; i++) {
                const b = bytes[i];
                if (b === 9 || b === 10 || b === 13) continue;//tab, newline, carriage return
                if (b >= 32 && b !== 127) continue;
                //Enough of the line to recognise, with the byte named.
                const from = Math.max(0, i - 40);
                const near = bytes.slice(from, i + 20).toString('utf8').replace(/[\u0000-\u001f\u007f]/g, '?');
                found.push(`${path.relative(ROOT, file)} at byte ${i}: 0x${b.toString(16).padStart(2, '0')} in "…${near}…"`);
                break;//one per file is enough to go and look
            }
        }
    }

    assert.deepStrictEqual(found, [],
        'these carry a control character that is not a tab or a newline:\n  '
        + found.join('\n  ')
        + '\n\nIt will build, it will run, and it will make string edits to that line silently miss.');
});
