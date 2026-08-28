//---------------------------------------------------------------------------
//reading a whole list from GitHub, rather than the first hundred of it.
//
//NOTHING IN THIS APP FOLLOWED THE `link` HEADER. Every call was `per_page=100`
//and took what came back, so a tracker with five hundred open issues answered
//with a hundred and the app reported a hundred — not as a truncation, as the
//list. A repository with a hundred and one branches had one hundred. There was
//no error, no warning and no field saying otherwise, because from inside a
//single request a full page and a last page look identical.
//
//THAT IS THE FAILURE THIS FILE EXISTS FOR, and it is worth being exact about
//which one it is. It is not that reading is expensive. It is that a list which
//is quietly incomplete is worse than one that fails: somebody points at an
//issue, it is not on the list, and the answer they get is that it does not
//exist.
//
//---- and the bound, because "all of it" is not always finishable ----------
//
//A PAGE CAP RATHER THAN A LOOP THAT STOPS WHEN GITHUB DOES. Ten thousand issues
//is a hundred requests, and a caller sweeping several repositories should not be
//able to spend the whole hourly budget on one of them without anybody deciding
//that. The cap is a number the plugin picks, like the concurrency in ./many.js —
//how much is too much is a judgement about GitHub.
//
//AND HITTING IT IS SAID OUT LOUD. `more` and `why` come back on the answer, so a
//pane can print "showing 2000 of them, and there are more" instead of doing
//exactly what this file was written to stop. A silent cap is the same defect
//with a nicer implementation.
//
//---- why this is its own file --------------------------------------------
//
//THE SAME REASON AS ./many.js: a test has to be able to use the real one. A
//stand-in GitHub that carried its own paging would be a stub easier to satisfy
//than the thing it stands for — a version that reads one page passes every
//check a paging one does, and the app has already shipped one of those.
//---------------------------------------------------------------------------

//---- `link: <url>; rel="next", <url>; rel="last"` -------------------------
//
//PARSED RATHER THAN GUESSED AT. Adding `&page=n+1` until an empty page comes
//back is the version everybody writes first, and it is wrong in two ways that
//do not show up in testing: it assumes every endpoint paginates by page number
//(some are cursor-based), and it always costs one extra request to discover the
//end. The header says whether there is a next page and where it is.
function nextFrom(headers) {
    var line = (headers && (headers.link || headers.Link)) || '';
    if (!line) return null;

    var parts = String(line).split(',');
    for (var i = 0; i < parts.length; i++) {
        //`<https://api.github.com/…?page=2>; rel="next"`
        var m = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(parts[i]);
        if (m) return m[1];
    }
    return null;
}

//THE PATH, BECAUSE `call` TAKES ONE. GitHub answers with an absolute URL and the
//caller works in paths — and the host is already decided by the credential, so
//taking the whole URL would let a `link` header point this app's token at
//another server. Keeping only the path and the query makes that impossible
//rather than unlikely.
function pathOf(url) {
    var m = /^https?:\/\/[^/]+(\/[^\s]*)$/.exec(String(url || ''));
    return m ? m[1] : null;
}

//A HUNDRED AT A TIME UNLESS THE CALLER SAID OTHERWISE. It is the largest GitHub
//allows and it is the difference between five requests and fifty for the same
//five hundred rows — the cheapest single thing available here.
function withSize(at) {
    if (/[?&]per_page=/.test(at)) return at;
    return at + (at.indexOf('?') === -1 ? '?' : '&') + 'per_page=100';
}

module.exports = function Paged(call, cap) {
    var most = cap > 0 ? cap : 10;

    return async function all(at, opts) {
        var o = opts || {};
        //THE CALLER MAY WANT LESS THAN THE PLUGIN ALLOWS. A pane showing the
        //ten most recent things has no use for page four, and asking for it
        //spends somebody's budget on rows nobody will read.
        var limit = o.pages > 0 ? Math.min(o.pages, most) : most;

        var where = withSize(at);
        var items = [];
        var pages = 0;
        var last = null;

        while (where && pages < limit) {
            var got = await call('GET', where, null, o);
            last = got;
            pages++;

            //A FAILURE ON PAGE ONE IS A FAILURE. A failure on page four is a
            //PARTIAL ANSWER, and the difference matters: throwing away three
            //good pages because the fourth timed out turns a small problem into
            //an empty list, and an empty list is the thing this file is about.
            if (got.status !== 200 || !Array.isArray(got.body)) {
                if (pages === 1) {
                    return {
                        ok: false, status: got.status, items: null, pages: 0, more: false,
                        why: (got.body && got.body.message) || ('GitHub answered ' + got.status)
                    };
                }
                return {
                    ok: true, status: 200, items: items, pages: pages - 1, more: true,
                    why: 'read ' + items.length + ' of them and then GitHub answered ' + got.status
                        + ' — there are more, and this is not all of them'
                };
            }

            items = items.concat(got.body);

            var next = nextFrom(got.headers);
            where = next ? pathOf(next) : null;
            //A `next` THIS CANNOT FOLLOW IS NOT NOTHING. It means another page
            //exists and points somewhere off this host, which should not happen
            //and must not read as "that was the last one".
            if (next && !where) {
                return {
                    ok: true, status: 200, items: items, pages: pages, more: true,
                    why: 'GitHub pointed at another page on a different host, which was not followed'
                };
            }
        }

        //STOPPED BY THE CAP RATHER THAN BY RUNNING OUT. The whole point of
        //carrying this is that somebody is told.
        var capped = !!where;

        return {
            ok: true,
            status: (last && last.status) || 200,
            items: items,
            pages: pages,
            more: capped,
            why: capped
                ? 'read ' + items.length + ' of them in ' + pages + ' pages and stopped there — '
                    + 'there are more, and this is not all of them'
                : null
        };
    };
};

module.exports.nextFrom = nextFrom;
module.exports.pathOf = pathOf;
