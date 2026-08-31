const { test } = require('node:test');
const assert = require('node:assert');

const { resolve } = require('../../src/app/docs/links');

//A LINK IN A PAGE IS A FILE LINK, and the pane follows it the way a text
//editor would: relative to the page it is on.

test('a sibling, a child and a parent folder resolve against the page', () => {
    assert.equal(resolve('howto/README.md', 'build-a-machine.md'), 'howto/build-a-machine.md');
    assert.equal(resolve('howto/README.md', '../workflow/github-flow.md'), 'workflow/github-flow.md');
    assert.equal(resolve('README.md', 'howto/README.md'), 'howto/README.md');
    assert.equal(resolve('workflow/README.md', './github-flow.md'), 'workflow/github-flow.md');
});

test('an anchor or a query on the end is dropped', () => {
    assert.equal(resolve('howto/README.md', 'build-a-machine.md#steps'), 'howto/build-a-machine.md');
});

test('what is not a page comes back null', () => {
    assert.equal(resolve('howto/README.md', 'https://github.com/x'), null);
    assert.equal(resolve('howto/README.md', '#steps'), null);
    assert.equal(resolve('howto/README.md', '/etc/passwd'), null);
    assert.equal(resolve('howto/README.md', '../../outside.md'), null);
    assert.equal(resolve('howto/README.md', 'picture.png'), null);
    assert.equal(resolve('howto/README.md', ''), null);
});

//---------------------------------------------------------------------------
//AND THAT THE LINKS IN THE PAGES GO SOMEWHERE.
//
//THE RESOLVER WAS TESTED AND THE PAGES WERE NOT, which are different claims:
//every case above is about a string, and none of them would notice a page
//renamed, moved between suites, or linked to before it was written. A wiki
//whose cross-references rot is one people stop following.
//
//IT WALKS THE REAL FOLDER on purpose. A fixture would be a second list of
//pages to keep in step with the first.
//---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');

const DOCS = path.join(__dirname, '..', '..', 'docs');

function pagesUnder(dir, into) {
    fs.readdirSync(dir).forEach((f) => {
        const at = path.join(dir, f);
        if (fs.statSync(at).isDirectory()) return pagesUnder(at, into);
        if (f.endsWith('.md')) into.push(path.relative(DOCS, at).split(path.sep).join('/'));
    });
    return into;
}

test('every link between pages points at a page that exists', () => {
    const pages = pagesUnder(DOCS, []);
    assert.ok(pages.length > 20, 'the docs folder was not found, so this proves nothing: ' + pages.length);

    const broken = [];
    let checked = 0;

    pages.forEach((page) => {
        const text = fs.readFileSync(path.join(DOCS, page), 'utf8');
        const re = /\]\(([^)]+)\)/g;
        let m;
        while ((m = re.exec(text))) {
            //`resolve` ANSWERS NULL FOR WHAT IS NOT A PAGE — an http link, a
            //bare anchor, an image, anything outside the folder. Those are not
            //this test's business and it says so by skipping them.
            const to = resolve(page, m[1]);
            if (to === null) continue;
            checked++;
            if (!fs.existsSync(path.join(DOCS, to))) broken.push(page + ' -> ' + m[1]);
        }
    });

    assert.ok(checked > 20, 'no page links were checked at all, so this passes by finding nothing');
    assert.deepEqual(broken, [], 'links to pages that are not there:\n  ' + broken.join('\n  '));
});
