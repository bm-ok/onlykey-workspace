const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

//THE ONE THING THE MARKDOWN FRAME MUST NOT LOSE.
//
//`marked` does not sanitise and has never claimed to -- markdown carries raw
//HTML straight through by design. The text it renders came off a machine running
//a script somebody wrote, so the only thing between that and code running inside
//a page with node behind it is the policy on the frame.
//
//THIS USED TO BE PROVED IN THE KIT PANE, by an exhibit carrying a real <script>
//and a real remote image. It worked -- the browser refused all three -- and it
//logged three CSP violations every time anybody opened that pane. A guard that
//shouts on every render is one people learn to scroll past, so the exhibit went
//back to being an ordinary self-contained document and the proof came here.
//
//IT READS THE SOURCE rather than rendering, because the frame is JSX inside a
//plugin and there is no DOM in a test runner. That is weaker than executing it,
//and it still catches the thing worth catching: somebody loosening the policy.

const FRAME = path.join(__dirname, '..', '..', 'src', 'app', 'ui', 'markdown', 'window.js');

test('the markdown frame still refuses everything by default', () => {
    const src = fs.readFileSync(FRAME, 'utf8');
    assert.match(src, /default-src 'none'/,
        'the frame no longer declares default-src none, so a script in somebody else\'s markdown would run');
});

test('and allows only what a self-contained document needs', () => {
    const src = fs.readFileSync(FRAME, 'utf8');
    //A document that brings everything with it needs its own <style> and a
    //picture written into it. Anything else -- a remote image, a webfont, a
    //fetch -- is the frame reaching outside itself, which is the whole thing
    //this policy exists to stop.
    assert.match(src, /style-src 'unsafe-inline'/, 'its own <style> would not apply');
    assert.match(src, /img-src data:/, 'a picture written into the document would not render');

    const csp = src.match(/Content-Security-Policy" content="([^"]+)"/);
    assert.ok(csp, 'the CSP is no longer written where this can read it');
    const allowed = csp[1].split(';').map(s => s.trim()).filter(Boolean);
    assert.deepStrictEqual(allowed.sort(), [
        "default-src 'none'", "img-src data:", "style-src 'unsafe-inline'"
    ], 'the policy gained a directive — every addition is somewhere new the frame may reach');
});

test('and the frame is never given scripts', () => {
    //CODE, NOT COMMENTS. The first version of this matched the word anywhere and
    //failed on the paragraph in that file explaining why allow-scripts is
    //absent -- a guard that cannot tell an explanation from the thing it warns
    //about is one that gets deleted rather than believed.
    const src = fs.readFileSync(FRAME, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    //THE DOCUMENTED HOLE. allow-scripts together with allow-same-origin lets a
    //frame reach into this document and remove its own sandbox attribute. There
    //is no sandbox here at all now -- the CSP does the work -- so this asserts
    //the attribute never comes back carrying the dangerous half.
    assert.ok(!/allow-scripts/.test(src), 'allow-scripts is the one thing this frame may never be given');
});

test('and marked is the copy this plugin owns', () => {
    const src = fs.readFileSync(FRAME, 'utf8');
    assert.match(src, /require\('\.\/vendor\/marked\/marked\.js'\)/,
        'marked comes from somewhere other than this plugin\'s own vendor folder');
});
