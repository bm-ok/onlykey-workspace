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
