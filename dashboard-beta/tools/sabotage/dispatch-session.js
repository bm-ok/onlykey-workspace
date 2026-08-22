//what ../../test/vms/dispatch-session.test.js has to be able to catch.
//
//Only the HOST half is broken here. The reader itself is ../../src/app/vms/
//dispatch/guest/session.js, which runs in a guest — it gets its own plan when
//there is one, and the test already runs it for real against a transcript.
module.exports = {
    file: 'src/app/vms/dispatch/session.js',
    test: 'test/vms/dispatch-session.test.js',
    breaks: [
        //---- how it is asked --------------------------------------------------

        //THROUGH STDIN so no quoting has to survive both this file and the
        //guest's login shell, and so nothing is installed and nothing left
        //behind.
        ['the program is put on the command line rather than fed through stdin',
            "        return into('node - ' + argv.map(q).join(' '), payloads.session(), 'OKC_SESSION_EOF');",
            "        return 'node -e ' + q(payloads.session()) + ' ' + argv.map(q).join(' ');"],

        //THE SAME GUARD AS EVERY OTHER HEREDOC IN THIS GROUP. The version this
        //comes from wrote this one by hand, so the marker check applied
        //everywhere except here.
        ['the heredoc is written by hand, without the marker check',
            "        return into('node - ' + argv.map(q).join(' '), payloads.session(), 'OKC_SESSION_EOF');",
            "        return 'node - ' + argv.map(q).join(' ') + \" <<'OKC_SESSION_EOF'\\n\" + payloads.session() + '\\nOKC_SESSION_EOF';"],

        //A SESSION ID ARRIVES FROM A CALLER. The only byte that can end the
        //quoting is a single quote, and an unquoted one puts the rest of it in
        //the command.
        ['the arguments are not quoted',
            '            .concat([CLIP]);',
            "            .concat([CLIP]).map(String);"],

        ['the arguments are pasted in rather than quoted',
            "        return into('node - ' + argv.map(q).join(' '), payloads.session(), 'OKC_SESSION_EOF');",
            "        return into('node - ' + argv.join(' '), payloads.session(), 'OKC_SESSION_EOF');"],

        //THE CLIP LENGTH IS THE HOST'S. The guest carries only a default, for
        //somebody running it by hand.
        ['the clip length is never sent, so the guest uses its own',
            '            .concat([CLIP]);',
            '            .concat([]);'],

        //---- how the answer is taken -------------------------------------------

        //THE LOGIN SHELL MAY PRINT ANYTHING FIRST — a motd, an nvm notice — and
        //a watcher that took the FIRST line would break on a machine somebody
        //had customised.
        ['the first line that parses is taken rather than the last',
            '    for (var i = lines.length - 1; i >= 0; i--) {',
            '    for (var i = 0; i < lines.length; i++) {'],

        ['anything readable at all is taken as the answer',
            "        if (lines[i].charAt(0) !== '{') continue;",
            ''],

        ['nothing readable is thrown rather than said',
            "    return { ok: false, error: 'the machine did not answer with anything readable' };",
            "    throw new Error('unreadable');"],

        //A TRANSCRIPT IS PULLED TO THE HOST AND KEPT. That makes a credential
        //reaching it not a moment of exposure but a FILING, permanently —
        //cleaned on the way in is the only place it can be stopped.
        ['the output is kept without being redacted',
            "    var clean = typeof redact === 'function' ? redact(String(output == null ? '' : output))\n        : String(output == null ? '' : output);",
            "    var clean = String(output == null ? '' : output);"],

        ['the redactor is called and its answer thrown away',
            "    var clean = typeof redact === 'function' ? redact(String(output == null ? '' : output))\n        : String(output == null ? '' : output);",
            "    if (typeof redact === 'function') redact(String(output == null ? '' : output));\n    var clean = String(output == null ? '' : output);"]
    ]
};
