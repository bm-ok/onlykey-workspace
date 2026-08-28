const { test } = require('node:test');
const assert = require('node:assert');

const Paged = require('../../src/app/github/paged');

//---------------------------------------------------------------------------
//A FULL PAGE AND A LAST PAGE LOOK IDENTICAL FROM INSIDE ONE REQUEST.
//
//That is the whole defect this covers: nothing in the app followed the `link`
//header, so a tracker with five hundred open issues answered with a hundred and
//was reported as a hundred — no error, no warning, no field saying otherwise.
//
//WHAT IS ASSERTED IS COMPLETENESS AND HONESTY ABOUT ITS LIMITS. Never that a
//particular number of requests was made: how many pages something takes is
//GitHub's business, and a test that pinned it would fail on the day a caller
//asked for a bigger page.
//---------------------------------------------------------------------------

//A GITHUB THAT ACTUALLY PAGINATES, which is the only kind worth testing
//against. It hands back a `link` header exactly as GitHub does and counts what
//was asked of it.
function aGitHub(rows, opts) {
    const o = opts || {};
    const asked = [];
    const call = async (method, at) => {
        asked.push(at);
        const size = Number((/[?&]per_page=(\d+)/.exec(at) || [])[1] || 30);
        const page = Number((/[?&]page=(\d+)/.exec(at) || [])[1] || 1);
        const from = (page - 1) * size;
        const body = rows.slice(from, from + size);

        if (o.failOn === page) return { status: o.failWith || 502, body: { message: 'no' }, headers: {} };

        const more = from + size < rows.length;
        const headers = more
            ? { link: '<https://api.github.com/things?per_page=' + size + '&page=' + (page + 1) + '>; rel="next", '
                + '<https://api.github.com/things?per_page=' + size + '&page=99>; rel="last"' }
            : {};
        return { status: 200, body, headers };
    };
    return { call, asked };
}

const many = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1 }));

//---- the defect itself ----------------------------------------------------

test('a list longer than one page comes back whole', () => {
    const gh = aGitHub(many(250));
    return Paged(gh.call, 10)('/things').then((got) => {
        assert.equal(got.items.length, 250, 'the tail of the list was dropped');
        assert.equal(got.more, false);
        assert.equal(got.why, null);
        //AND THE FIRST NUMBER AND THE LAST ARE BOTH THERE. A length alone would
        //pass if the same page were counted three times.
        assert.equal(got.items[0].number, 1);
        assert.equal(got.items[249].number, 250);
    });
});

test('a hundred at a time, because that is five requests instead of fifty', () => {
    const gh = aGitHub(many(250));
    return Paged(gh.call, 10)('/things').then(() => {
        assert.match(gh.asked[0], /per_page=100/);
        assert.equal(gh.asked.length, 3);
    });
});

test('a caller who already said how big keeps their answer', () => {
    const gh = aGitHub(many(10));
    return Paged(gh.call, 10)('/things?per_page=5').then((got) => {
        assert.equal(got.items.length, 10);
        assert.ok(!/per_page=100/.test(gh.asked[0]), 'the caller\'s page size was overwritten');
    });
});

test('a query already on the path is kept', () => {
    const gh = aGitHub(many(5));
    return Paged(gh.call, 10)('/things?state=open').then(() => {
        assert.match(gh.asked[0], /state=open/);
        assert.match(gh.asked[0], /per_page=100/);
    });
});

//---- and the bound, said out loud -----------------------------------------

test('stopping at the cap is reported, not silent', () => {
    //A SILENT CAP IS THE SAME DEFECT WITH A NICER IMPLEMENTATION. This is the
    //assertion that keeps the fix from becoming the bug.
    const gh = aGitHub(many(1000));
    return Paged(gh.call, 3)('/things').then((got) => {
        assert.equal(got.items.length, 300);
        assert.equal(got.more, true, 'a truncated list said it was complete');
        assert.match(got.why, /this is not all of them/);
    });
});

test('a caller may ask for less than the cap allows', () => {
    const gh = aGitHub(many(1000));
    return Paged(gh.call, 10)('/things', { pages: 2 }).then((got) => {
        assert.equal(got.items.length, 200);
        assert.equal(got.more, true);
    });
});

test('and may not ask for more', () => {
    const gh = aGitHub(many(1000));
    return Paged(gh.call, 2)('/things', { pages: 50 }).then((got) => {
        //THE CAP IS THE PLUGIN'S JUDGEMENT ABOUT GITHUB. A caller that could
        //raise it is a caller that decides how much of somebody's hourly budget
        //to spend, which is the decision the cap exists to hold.
        assert.equal(got.items.length, 200);
        assert.equal(got.more, true);
    });
});

//---- failing, which is two different things -------------------------------

test('failing on the first page is a failure', () => {
    const gh = aGitHub(many(500), { failOn: 1, failWith: 404 });
    return Paged(gh.call, 10)('/things').then((got) => {
        assert.equal(got.ok, false);
        assert.equal(got.status, 404);
        assert.equal(got.items, null);
    });
});

test('failing on a later page is a partial answer, and says so', () => {
    //THROWING AWAY THREE GOOD PAGES BECAUSE THE FOURTH TIMED OUT turns a small
    //problem into an empty list, and an empty list is the thing this file is
    //about.
    const gh = aGitHub(many(500), { failOn: 3 });
    return Paged(gh.call, 10)('/things').then((got) => {
        assert.equal(got.ok, true);
        assert.equal(got.items.length, 200, 'the pages that did arrive were thrown away');
        assert.equal(got.more, true);
        assert.match(got.why, /not all of them/);
    });
});

//---- and the header, read rather than guessed at --------------------------

test('the next link is taken from the header, not built by counting', () => {
    const head = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
    assert.equal(Paged.nextFrom({ link: head }), 'https://api.github.com/x?page=2');
    //`prev` AND `last` ARE NOT `next`. A substring match on "rel=" would take
    //whichever came first and walk backwards through the list for ever.
    assert.equal(Paged.nextFrom({ link: '<https://api.github.com/x?page=1>; rel="prev"' }), null);
    assert.equal(Paged.nextFrom({}), null);
});

test('only the path is followed, never the host', () => {
    //A `link` HEADER IS AN INSTRUCTION FROM THE FAR END ABOUT WHERE TO SEND THE
    //NEXT REQUEST — and the next request carries this host's credential. Taking
    //the whole URL would let an answer redirect a token at another server.
    assert.equal(Paged.pathOf('https://api.github.com/repos/a/b/issues?page=2'), '/repos/a/b/issues?page=2');
    assert.equal(Paged.pathOf('not a url'), null);
});

test('a next page that cannot be followed is not the end of the list', () => {
    const call = async () => ({
        status: 200, body: [{ number: 1 }],
        headers: { link: '<ftp://elsewhere/things>; rel="next"' }
    });
    return Paged(call, 10)('/things').then((got) => {
        assert.equal(got.more, true, 'an unfollowable page read as "that was the last one"');
        assert.match(got.why, /different host/);
    });
});
