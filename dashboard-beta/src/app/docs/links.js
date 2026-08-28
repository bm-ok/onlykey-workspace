//---------------------------------------------------------------------------
//A LINK IN A PAGE, RESOLVED TO A PAGE NAME.
//
//Pages link to each other the way files do -- `[x](other.md)`,
//`../howto/run-the-drills.md` -- because they ARE files and a text editor
//shows the same link working. This turns that href, relative to the page it
//is on, into the name the pane picks. Pure, so a test can hand it any pair.
//
//Anything that is not a page comes back null: an absolute url, an anchor, a
//path that climbs out of the folder, a file that is not markdown.
//---------------------------------------------------------------------------

function resolve(from, href) {
    var h = String(href == null ? '' : href).trim();
    if (!h || h[0] === '#' || /^[a-z]+:/i.test(h) || h[0] === '/') return null;
    h = h.split('#')[0].split('?')[0];
    if (!/\.md$/i.test(h)) return null;

    var base = String(from || '').split('/');
    base.pop();
    var parts = base.concat(h.split('/'));
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p === '' || p === '.') continue;
        if (p === '..') { if (!out.length) return null; out.pop(); continue; }
        out.push(p);
    }
    return out.length ? out.join('/') : null;
}

module.exports = { resolve: resolve };
