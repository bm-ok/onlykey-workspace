//---------------------------------------------------------------------------
//the docs, at a command line.
//
//A PAGE IS PRINTED AS ITSELF. `docRead --name x` is somebody wanting to read
//the page, and markdown is already the readable form; the fields around it go
//on one line at the top. The list is a table: name, when, size, title.
//
//`--json` STILL GIVES THE BRACES.
//---------------------------------------------------------------------------

function fit(s, n) {
    var t = String(s == null ? '' : s);
    return (t.length > n ? t.slice(0, n - 2) + '…' : t).padEnd(n);
}

module.exports = {
    print: {
        docs: function (said) {
            var pages = (said && said.docs) || [];
            if (!pages.length) return (said && said.note) || 'No pages.';
            var out = ['pages in ' + said.dir, ''];
            pages.forEach(function (p) {
                out.push('  ' + fit(p.name, 36) + fit(String(p.modified || '').slice(0, 16).replace('T', ' '), 18)
                    + fit(p.bytes + ' b', 9) + p.title);
            });
            return out.join('\n');
        },
        docRead: function (said) {
            if (!said || !said.name) return 'Say which page: docRead --name <name>. docs lists them.';
            return said.name + ' — ' + (said.bytes || 0) + ' bytes, changed ' + said.modified + '\n\n' + said.text;
        },
        docWrite: function (said) { return (said && said.note) || 'Written.'; }
    }
};
