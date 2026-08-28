var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//DOCS: A WIKI MADE OF FILES.
//
//WHAT THIS IS FOR. Two people write this app's documentation: the person at
//the window, and the model at the command line. Neither has a place the other
//can see. A wiki inside the app that keeps every page as a markdown file in the
//repository gives them the same page -- edited here in a pane, edited there
//with a text editor, and versioned by git like everything else.
//
//FILES, NOT A DOCUMENT IN THE DATA DIRECTORY, on purpose. The data directory
//is per install and goes when the install does; the repository is the thing
//that lasts and the thing the command line can already read. It is the same
//call ../tests made for its drills and ../vms/provision made for its scripts:
//what a person is expected to READ lives where a person can open it.
//
//WHERE THE FOLDER IS. In development the server bundle runs from dist/ and the
//repository is one level up, so `../docs` is the one that is true and the one
//git sees. A packaged app has no repository above it; webpack copies the
//folder beside the bundle and that is what it reads. OKC_DOCS_DIR overrides
//both, which is how the tests hand it a folder of their own.
//
//WHAT IS GUARDED. Reading and writing are open -- the command line is the
//pipe, and the model writing a page is the whole point. Deleting is a person's
//press: a page gone is a page gone, and a wrong name over the wire should
//cost a refusal rather than a file.
//---------------------------------------------------------------------------

function whereDocs() {
    if (process.env.OKC_DOCS_DIR) return path.resolve(process.env.OKC_DOCS_DIR);
    var dev = process.env.NODE_ENV !== 'production';
    return dev ? path.join(__dirname, '..', 'docs') : path.join(__dirname, 'docs');
}

//A NAME IS A PATH INSIDE THE FOLDER AND NOTHING ELSE. Forward slashes, no
//climbing out, no drive letters, and it ends in .md -- added when it was left
//off, because "readme" is what somebody types and "readme.md" is what they
//mean. Refused rather than repaired for anything stranger: a name this could
//not have produced itself is a name to say no to.
function nameOf(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
    if (!s) throw new Error('Say which page, by name — a path inside the docs folder, like "guide/setup.md".');
    if (s[0] === '/' || /^[A-Za-z]:/.test(s)) throw new Error('A page is named inside the docs folder, not by an absolute path.');
    if (!/\.md$/i.test(s)) s = s + '.md';
    var parts = s.split('/').filter(function (p) { return p !== '' && p !== '.'; });
    if (parts.some(function (p) { return p === '..'; })) throw new Error('A page name cannot climb out of the docs folder.');
    if (parts.some(function (p) { return !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(p); })) {
        throw new Error('"' + raw + '" is not a page name here: letters, digits, spaces, dots, dashes and underscores, in folders.');
    }
    return parts.join('/');
}

function titleOf(text, name) {
    var m = /^\s*#\s+(.+?)\s*$/m.exec(String(text || ''));
    return m ? m[1] : path.basename(name, '.md');
}

function walk(dir, under) {
    var out = [];
    var names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    names.sort(function (a, b) { return a.name.localeCompare(b.name); });
    names.forEach(function (d) {
        if (d.name[0] === '.' || d.name === 'node_modules') return;
        var rel = under ? under + '/' + d.name : d.name;
        if (d.isDirectory()) out = out.concat(walk(path.join(dir, d.name), rel));
        else if (/\.md$/i.test(d.name)) out.push(rel);
    });
    return out;
}

plugin.consumes = ['app', 'log'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('docs');

    var dir = whereDocs();

    function fullOf(name) { return path.join(dir, name.split('/').join(path.sep)); }

    function statOf(name) {
        var full = fullOf(name);
        var st = fs.statSync(full);
        return { bytes: st.size, modified: st.mtime.toISOString() };
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('docs', {
            about: 'Every page in the docs folder: its name, its title, its size and when it last changed. '
                + 'With `q`, only the pages whose title or text contain it, each with the lines that do',
            takes: ['q'],
            run: async function (args) {
                var a = args || {};
                var q = String(a.q == null ? '' : a.q).trim().toLowerCase();
                var names = walk(dir, '');
                var pages = [];
                names.forEach(function (name) {
                    var text = '';
                    try { text = fs.readFileSync(fullOf(name), 'utf8'); } catch (e) { text = ''; }
                    var st = statOf(name);
                    var row = { name: name, title: titleOf(text, name), bytes: st.bytes, modified: st.modified };
                    if (q) {
                        //TITLES AND BODIES, plainly: the words, case aside, on
                        //any line. The lines that match come back so a list can
                        //show WHERE without opening the page -- three of them,
                        //since a page that says the word forty times is one hit
                        //to a person.
                        var inTitle = row.title.toLowerCase().indexOf(q) >= 0;
                        var hits = [];
                        var n = 0;
                        text.split('\n').forEach(function (line, i) {
                            if (line.toLowerCase().indexOf(q) < 0) return;
                            n++;
                            if (hits.length < 3) hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
                        });
                        if (!inTitle && !n) return;
                        row.inTitle = inTitle;
                        row.matches = n + (inTitle ? 1 : 0);
                        row.hits = hits;
                    }
                    pages.push(row);
                });
                if (q) pages.sort(function (p1, p2) { return (p2.matches || 0) - (p1.matches || 0); });
                return {
                    dir: dir,
                    q: q || null,
                    docs: pages,
                    note: q
                        ? pages.length + ' page(s) say "' + q + '"' + (pages.length ? '. docRead reads one.' : '.')
                        : pages.length
                            ? pages.length + ' page(s) in ' + dir + '. docRead reads one; docWrite writes one.'
                            : 'No pages yet in ' + dir + '. docWrite with a name and text makes the first.'
                };
            }
        }));

        undo.push(actions.define('docRead', {
            about: 'One page, whole: its text as written, and when it last changed — pass that back to docWrite so nobody writes over somebody else',
            takes: ['name'],
            run: async function (args) {
                var a = args || {};
                //NO NAME IS NO PAGE, NOT AN ERROR: a pane asks this with nothing
                //picked yet, and a skeleton is the right answer to that.
                if (a.name == null || String(a.name).trim() === '') return { name: null, text: null, title: null, modified: null };
                var name = nameOf(a.name);
                var full = fullOf(name);
                if (!fs.existsSync(full)) throw new Error('There is no page called "' + name + '". docs lists what there is.');
                var text = fs.readFileSync(full, 'utf8');
                var st = statOf(name);
                return { name: name, title: titleOf(text, name), text: text, bytes: st.bytes, modified: st.modified };
            }
        }));

        undo.push(actions.define('docWrite', {
            about: 'Write a page: the whole text, under its name. New pages and folders are made; pass `was` '
                + '(the modified stamp from docRead) and a page somebody else changed since is refused rather than overwritten',
            takes: ['name', 'text', 'was'],
            run: async function (args) {
                var a = args || {};
                var name = nameOf(a.name);
                if (a.text == null) throw new Error('Say what the page says — `text` is the whole of it.');
                var full = fullOf(name);
                var exists = fs.existsSync(full);

                //TWO WRITERS, ONE PAGE. The person at the window and the model
                //at the command line can both be editing; whoever saves second
                //must not silently drop the first. `was` is what docRead said
                //the page was; a different stamp means somebody wrote since.
                if (a.was && exists) {
                    var now = statOf(name).modified;
                    if (String(a.was) !== now) {
                        throw new Error('"' + name + '" changed since you read it (' + now + ', you had ' + a.was
                            + '). Read it again and carry your change over — writing now would drop theirs.');
                    }
                }

                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, String(a.text));
                var st = statOf(name);
                log.good((exists ? 'rewrote ' : 'wrote ') + name + ' — ' + st.bytes + ' bytes');
                return {
                    name: name, wrote: true, made: !exists, bytes: st.bytes, modified: st.modified,
                    note: (exists ? 'Rewrote ' : 'Made ') + name + '. It is a file in ' + dir + ' — commit it like anything else.'
                };
            }
        }));

        undo.push(actions.define('docRemove', {
            about: 'Delete a page. Done in the window, by a person: a page gone is a page gone',
            takes: ['name'],
            run: async function (args) {
                var a = args || {};
                if (a._overTheWire || a._driven) {
                    throw new Error('Deleting a page is done in the window, by a person. A wrong name down the pipe '
                        + 'should cost a refusal, not a file — and the file is in the repository, where `git rm` is the honest way.');
                }
                var name = nameOf(a.name);
                var full = fullOf(name);
                if (!fs.existsSync(full)) throw new Error('There is no page called "' + name + '".');
                fs.unlinkSync(full);
                log.warn('deleted ' + name);
                return { name: name, removed: true, note: 'Deleted ' + name + '. git still has it until that is committed.' };
            }
        }));
    }

    await register(null, {});
    return function () { undo.forEach(function (u) { u(); }); };
}
plugin.nameOf = nameOf;
plugin.titleOf = titleOf;
module.exports = plugin;
