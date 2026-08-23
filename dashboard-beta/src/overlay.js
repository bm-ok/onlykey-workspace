//a failure with no window to look at is the expensive kind. anything that goes
//wrong before or underneath the ui gets printed on top of the page.

module.exports = function showError(title, detail) {
    //AND SAID OUT LOUD, BECAUSE A PICTURE IS NOT A CHECK.
    //
    //This drew a red box on the window and did nothing else, so the only way to
    //find out the app had failed to start was to LOOK at it. `node --check`
    //passes on a free identifier, `npm run check` bundles one happily, and
    //`okc.js show` puts a pane up off the last good bundle — so the whole
    //toolchain reads green while the app is face down.
    //
    //It cost a session exactly that way: `makeFreeing is not defined`, thrown
    //at plugin setup, invisible to every command and plain in a screenshot.
    //
    //Two exits from here now, and neither needs anybody to look:
    //  console      into nw.log, which is greppable while the window is open
    //  the DOM      ../src/app/core/drive/window.js reports it as `failed` on
    //               `windowControls`, which is the poll CLAUDE.md already says
    //               to run after every edit
    if (typeof console != 'undefined' && console.error) {
        console.error('[app-error] ' + title, detail && detail.stack || detail || '');
    }

    if (typeof document == 'undefined') return;

    var id = 'app-error-overlay';
    var pre = document.getElementById(id);
    if (!pre) {
        pre = document.createElement('pre');
        pre.id = id;
        pre.style.cssText = 'position:relative;z-index:9999;margin:0;padding:1rem;' +
            'white-space:pre-wrap;font:12px/1.5 monospace;color:#fff;background:#b00';
        document.body.insertBefore(pre, document.body.firstChild);
    }
    pre.textContent = title + '\n\n' + (detail && detail.stack || detail || '');
};

//---- AND IT COMES DOWN AGAIN --------------------------------------------
//
//IT NEVER DID, AND THAT IS THE OTHER HALF OF THE SAME FAULT. Once drawn, this
//stayed drawn — so a reload that FIXED the problem left the red box in place,
//and everything now reading it (the dev console, `windowControls`, `npm run
//walk`) would go on reporting an app that was already back up.
//
//Which is worse than not reporting at all. A check that says "down" while the
//app is up gets ignored the second time it does it, and then it is not a check
//any more. ../src/app/core/build/main.js says `server:ok` on every reload that
//worked, and this is what that clears.
module.exports.clear = function () {
    if (typeof document == 'undefined') return;
    var pre = document.getElementById('app-error-overlay');
    if (pre && pre.parentNode) pre.parentNode.removeChild(pre);
};
