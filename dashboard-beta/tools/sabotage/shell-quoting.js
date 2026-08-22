//what ../../test/vms/shell-quoting.test.js has to be able to catch.
//
//THE FAILURE HERE IS NOT AN ERROR. Every break below produces shell that RUNS —
//just not the shell that was meant. That is the whole reason these checks go
//through a real `sh` rather than asserting that a string looks right.
module.exports = {
    file: 'src/app/vms/shell/quoting.js',
    test: 'test/vms/shell-quoting.test.js',
    breaks: [
        //---- one shell word --------------------------------------------------

        //THE ONLY BYTE THAT CAN END THE QUOTING is a single quote, and this is
        //the whole of the escaping. Without it, a task with an apostrophe in it
        //closes the quote and the rest becomes shell.
        ['a single quote in somebody\'s text ends the quoting',
            '    return "\'" + text.split("\'").join("\'\\\\\'\'") + "\'";',
            '    return "\'" + text + "\'";'],

        ['the escape is not the close-escape-reopen a shell reassembles',
            '"\'\\\\\'\'"',
            '"\\\\\'"'],

        //DOUBLE QUOTES ARE NOT THE SAME THING. Inside them $ and backticks still
        //expand, and a list of characters to escape is something that can be
        //incomplete.
        ['it quotes with double quotes, where substitutions still run',
            '    return "\'" + text.split("\'").join("\'\\\\\'\'") + "\'";',
            '    return \'"\' + text + \'"\';'],

        ['nothing is quoted at all',
            '    return "\'" + text.split("\'").join("\'\\\\\'\'") + "\'";',
            '    return text;'],

        //A SHELL STRING IS NUL-TERMINATED: this is not a wrong escape, it is the
        //command being cut off and the part before it running.
        ['a null byte silently truncates the command',
            '    if (text.indexOf(NUL) >= 0) {',
            '    if (false) {'],

        //---- a whole file ----------------------------------------------------

        //A HEREDOC ENDS AT ITS DELIMITER, WHEREVER IT APPEARS. Everything after
        //it is executed as shell.
        ['a body containing the marker ends the file early and runs the rest',
            "        if (lines[i].replace(/\\r+$/, '') === name) {",
            '        if (false) {'],

        //A BODY THAT ARRIVED WITH CRLF has "TAG\r", which the shell reading the
        //landed file still sees as the marker. This one got through the version
        //this comes from.
        ['a marker line with a carriage return on it is not recognised',
            "        if (lines[i].replace(/\\r+$/, '') === name) {",
            '        if (lines[i] === name) {'],

        //THE MARKER IS QUOTED — `<<'TAG'` — which is what stops the shell
        //expanding $, backticks and backslashes in somebody's task on the way in.
        ['the marker is unquoted, so the body is expanded on the way in',
            '    return prefix + " <<\'" + name + "\'\\n" + text + \'\\n\' + name;',
            "    return prefix + ' <<' + name + '\\n' + text + '\\n' + name;"],

        //`heredoc` IS `into` WITH A `cat >` IN FRONT OF IT, and the whole point
        //of that is one guard rather than two implementations. Writing the file
        //case out again is how the app came to have heredocs the marker check
        //did not apply to.
        ['writing a file goes round the guard instead of through it',
            "    return into('cat > ' + path, body, tag);",
            "    return 'cat > ' + path + \" <<'\" + String(tag) + \"'\\n\" + String(body) + '\\n' + String(tag);"],

        //A TAG THAT COULD NOT SURVIVE BEING QUOTED fails as a shell syntax error
        //a long way from here.
        ['a marker with a space or a quote in it is accepted',
            '    if (!TAG.test(name)) {',
            '    if (false) {'],

        ['any shape of marker is allowed',
            'var TAG = /^[A-Z][A-Z0-9_]*$/;',
            'var TAG = /.*/;'],

        //THE REFUSAL HAS TO NAME THE LINE, or somebody is told their task is
        //wrong without being told which part.
        ['the refusal does not say which line to change',
            "            throw new Error('That text contains a line reading exactly \"' + name\n                + '\", which is the marker used to send it to the machine. Change that line.');",
            "            throw new Error('bad text');"],

        //A WHOLE-LINE MATCH, NOT A SUBSTRING. A heredoc marker only ends the
        //document on a line of its own, so refusing a mention of it inside a
        //sentence would reject perfectly good tasks.
        ['the marker mentioned inside a sentence is refused too',
            "        if (lines[i].replace(/\\r+$/, '') === name) {",
            '        if (lines[i].indexOf(name) >= 0) {']
    ]
};
