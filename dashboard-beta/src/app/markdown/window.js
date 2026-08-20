var React = require('react');

var marked = require('./vendor/marked/marked.js');

//---------------------------------------------------------------------------
//markdown, rendered where it cannot do anything.
//
//A PLUGIN WITH ITS OWN VENDOR FOLDER, like ../editor. `marked` belongs to one
//concern and nothing else in the app should be able to reach it by accident —
//it does not sanitise, and the safety of every use of it depends on the frame
//built here rather than on the caller remembering.
//
//IT PROVIDES THE FRAME AND NOTHING ELSE. The Rendered/Source toggle that sits
//around it is the theme's, because the buttons are; this owns the one part that
//must not be got wrong. Panes see neither — they ask the theme for <Markdown>
//and get something that is safe by construction.
//---------------------------------------------------------------------------

plugin.consumes = ['react'];
plugin.provides = ['markdown'];
async function plugin(imports, register) {
    //---- markdown, rendered where it cannot do anything -----------------------
    //
    //A PULL REQUEST BODY IS MARKDOWN THAT GITHUB WILL RENDER, so a preview of it
    //that is not rendered is a preview of the wrong thing. As source it is a wall
    //of pipes and hashes, and the one thing it was formatted for is the thing that
    //does not happen.
    //
    //IN AN IFRAME, AND THAT IS THE WHOLE DESIGN rather than a convenience for
    //styling. This text came off a machine running a script somebody wrote, so it
    //is exactly as trustworthy as that script — and markdown carries raw HTML
    //through BY DESIGN, which `marked` does not sanitise and has never claimed to.
    //Put in this document it would be running inside a page that has node behind it.
    //
    //So it renders into a frame that can do nothing:
    //
    //  no allow-scripts   a <script> or an onerror in the markdown never runs. This
    //                     is the load-bearing one, and both halves are measured in
    //                     the Kit pane rather than assumed.
    //  a CSP too          default-src 'none', so a remote <img> cannot phone home —
    //                     which would otherwise turn "somebody opened this" into a
    //                     request to a host of the author's choosing.
    //  srcdoc             no file is written anywhere to show it.
    //
    //What it does NOT have is an opaque origin — see the note on the sandbox
    //attribute below for why, and why that is survivable here and would not be if
    //scripts could run.
    //
    //THE COST OF A REAL SANDBOX is that this side cannot measure the frame to size
    //it, because reading contentDocument needs allow-same-origin. So it takes a
    //height and scrolls inside, which is what these panels do anyway.
    var MD_STYLE = [
        ':root { color-scheme: dark }',
        'body { margin: 0; padding: 14px 16px; background: #0a0d12; color: #d7dee8;',
        '       font: 13px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }',
        'h1, h2, h3, h4 { color: #fff; line-height: 1.25; margin: 1.2em 0 .5em; }',
        'h1 { font-size: 1.5em; border-bottom: 1px solid #2a323d; padding-bottom: .3em }',
        'h2 { font-size: 1.25em; border-bottom: 1px solid #2a323d; padding-bottom: .3em }',
        'h1:first-child, h2:first-child, h3:first-child { margin-top: 0 }',
        'a { color: #4aa3ff }',
        'code { font-family: ui-monospace, Consolas, monospace; font-size: 12px;',
        '       background: #161b22; padding: .15em .4em; border-radius: 4px }',
        'pre { background: #161b22; border: 1px solid #2a323d; border-radius: 8px;',
        '      padding: 12px; overflow-x: auto }',
        'pre code { background: none; padding: 0 }',
        'blockquote { margin: 0 0 1em; padding: .2em 0 .2em 14px; border-left: 3px solid #2a323d; color: #9aa6b5 }',
        'table { border-collapse: collapse; margin: 0 0 1em; display: block; overflow-x: auto }',
        'th, td { border: 1px solid #2a323d; padding: 6px 10px; text-align: left }',
        'th { background: #161b22 }',
        'hr { border: 0; border-top: 1px solid #2a323d; margin: 1.5em 0 }',
        'img { max-width: 100% }',
        'ul, ol { padding-left: 22px }',
        'li { margin: .2em 0 }'
    ].join('\n');

    function escapeBits(s) {
        return String(s).replace(/[<&]/g, function (c) { return c == '<' ? '&lt;' : '&amp;'; });
    }

    function MarkdownFrame({ text, height }) {
        var body;
        try {
            body = marked.parse(String(text == null ? '' : text));
        } catch (e) {
            //SAID IN THE FRAME RATHER THAN THROWN, because the source view beside
            //it still works and is what somebody would fall back to anyway.
            body = '<p>This could not be rendered as markdown: ' + escapeBits(e.message) + '</p>';
        }
        //A TEMPLATE LITERAL BECAUSE THE CSP CONTAINS BOTH KINDS OF QUOTE, and a
        //policy that fails to parse fails OPEN in the sense that matters here: the
        //browser drops a malformed CSP and renders the frame with no policy at all,
        //which looks identical to a working one until the day the markdown contains
        //a remote image.
        var doc = `<!doctype html><html><head><meta charset="utf-8">`
            + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`
            + `<style>${MD_STYLE}</style></head><body>${body}</body></html>`;
        //NO SANDBOX. THE CSP IS WHAT HOLDS, AND IT HOLDS BY ITSELF.
        //
        //`default-src 'none'` is not only about images. Every fetch directive falls
        //back to it, `script-src` included — so a <script> in the markdown has no
        //source it is allowed to execute from, and an inline `onerror=` needs
        //`script-src 'unsafe-inline'`, which is not granted either. The policy
        //refuses the code; the sandbox was refusing it a second time.
        //
        //WHICH IS WHY THE SANDBOX COULD GO. It was not free: `sandbox=""` renders
        //NOTHING in this NW.js build, silently — an empty box the size you asked
        //for, which reads as "there was nothing to show". Measured in the Kit pane,
        //five ways: plain srcdoc renders; adding sandbox="" blanks it; adding the
        //CSP as well blanks it; a data: URL instead blanks it; only
        //sandbox="allow-same-origin" rendered. So the choice was never
        //"sandbox or not" — it was which single restriction to keep.
        //
        //STILL AN IFRAME, AND THAT PART IS NOT NEGOTIABLE. This text came off a
        //machine running a script somebody wrote, and markdown carries raw HTML
        //through BY DESIGN — `marked` does not sanitise and has never claimed to.
        //In this document it would be inside a page that has node behind it. In a
        //frame with its own policy it is inert.
        //
        //AND IT IS ASSERTED RATHER THAN ASSUMED. The Markdown exhibit in the Kit
        //pane contains a real <script> and a real onerror in its markdown, with the
        //text they would overwrite written beside them. If the policy ever stops
        //holding, that exhibit says so on sight instead of a comment here claiming
        //it still does.
        return <iframe className="md" srcDoc={doc} style={{ height: height || '60vh' }} />;
    }

    //ONLY THE FRAME. The Rendered/Source toggle beside it needs a Button, and
    //Button belongs to the theme — which consumes this. Composing the pair here
    //would make the cycle. So this owns the one thing that must not be got
    //wrong, and the theme owns the two buttons around it.
    await register(null, { markdown: { Frame: MarkdownFrame } });
}
module.exports = plugin;
