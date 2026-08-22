//---------------------------------------------------------------------------
//GETTING SOMEBODY ELSE'S TEXT ONTO A MACHINE WITHOUT IT BECOMING A COMMAND.
//
//IN ITS OWN FOLDER BECAUSE MORE THAN ONE PLUGIN NEEDS IT. It began inside
//../dispatch, which was right while dispatch was the only thing building shell
//for a guest; ../auth builds it too, and a plugin reaching into another
//plugin's folder for a primitive is how ownership stops being answerable.
//
//THIS FOLDER IS NOT A PLUGIN AND HAS NO ENTRY FILE, deliberately. There is no
//service here and no lifetime — these are pure functions with no state and no
//dependencies, so a plugin wrapping them would add a graph edge and answer
//nothing. Every loader looks for window.js, server.js or main.js, so a folder
//with none is simply never selected.
//
//Everything this group sends crosses into a shell script, and almost none of it
//is written by this app. A task is written by a PERSON — or by another agent —
//so its shape is not this file's to assume, and "it will not contain that" is an
//assumption about somebody else's prose.
//
//TWO PRIMITIVES, AND EVERY OTHER FILE HERE IS BUILT ON THEM:
//
//  q(s)                     one shell word, whatever is in it
//  heredoc(path, body, tag) a whole file, whatever is in it
//
//THE FAILURE IS NOT AN ERROR. That is what makes this worth its own file: a
//quoting mistake here does not produce a broken command that fails loudly, it
//produces a DIFFERENT command that runs. The rest of the text becomes shell.
//---------------------------------------------------------------------------

//---- one shell word --------------------------------------------------------
//
//SINGLE QUOTES, because inside them a POSIX shell expands NOTHING — no $, no
//backtick, no backslash escape. The only byte that can end the quoting is a
//single quote itself, and the standard way out is to close, escape one, reopen:
//
//    it's  ->  'it'\''s'
//
//Which the shell reassembles into one word. There is no other character to
//worry about, and that is the whole reason single quotes are the choice here
//rather than double quotes plus a list of things to escape — a list is
//something that can be incomplete.
//BUILT RATHER THAN TYPED. A literal NUL in a source file is the quietest
//edit there is — it survives a build, and test/rules/bytes.test.js exists
//because it makes later string edits silently miss.
var NUL = String.fromCharCode(0);

function q(s) {
    var text = String(s == null ? '' : s);

    //A NUL CANNOT TRAVEL IN AN ARGUMENT AT ALL. A shell string is NUL-terminated,
    //so this would not be escaped wrongly — it would be TRUNCATED, silently, and
    //the command would run on the part before it.
    if (text.indexOf(NUL) >= 0) {
        throw new Error('That text contains a null byte, which cannot be sent to a machine — '
            + 'a shell would cut the command off at it and run what came before.');
    }

    return "'" + text.split("'").join("'\\''") + "'";
}

//---- a whole file ----------------------------------------------------------
//
//A HEREDOC ENDS AT ITS DELIMITER, WHEREVER THAT APPEARS. Text arriving here is
//written by a person or by another agent, so a body containing a line that reads
//exactly like the marker ends the file early — and everything after it is
//executed as shell.
//
//REFUSED RATHER THAN ESCAPED, and rather than a marker made unguessable. The
//caller is told which line to change, in those words, because the alternative is
//an app that silently rewrote somebody's task.
var TAG = /^[A-Z][A-Z0-9_]*$/;

//THE SAME DOCUMENT, HANDED TO SOMETHING OTHER THAN `cat`.
//
//`heredoc` writes a file, which is what almost every caller wants. One does not:
//../dispatch/session.js feeds a whole program to the guest's `node` through
//STDIN, so that nothing has to be installed and nothing is left behind.
//
//IT IS THE SAME DOCUMENT AND THEREFORE THE SAME GUARD. The version this comes
//from wrote that one by hand, which meant the marker check — the thing standing
//between somebody's text and the rest of it being executed as shell — applied to
//every heredoc in the app except the two that were written out longhand.
function into(prefix, body, tag) {
    var name = String(tag == null ? '' : tag);

    //THE MARKER IS THIS APP'S, NOT A CALLER'S, and holding it to a shape is what
    //lets the check below be exact. A tag with a space or a quote in it would not
    //survive `<<'TAG'` and would fail as a shell syntax error a long way from
    //here; one with a regex character in it would make the check itself wrong.
    if (!TAG.test(name)) {
        throw new Error('"' + name + '" is not usable as a heredoc marker. '
            + 'It must be capitals, digits and underscores, starting with a letter.');
    }

    var text = String(body == null ? '' : body);

    //COMPARED LINE BY LINE, NOT BY A REGEX BUILT FROM THE TAG. Building a
    //pattern out of a value is how a check comes to depend on that value having
    //no regex characters in it — which is true of every tag here today and is
    //not a property anything enforces at the call site.
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
        //`\r` TRIMMED BEFORE COMPARING. A body that arrived with Windows line
        //endings has "TAG\r" where the shell — reading the file it lands in —
        //will still see the marker. A check that missed that would pass here and
        //end the heredoc early on the machine.
        if (lines[i].replace(/\r+$/, '') === name) {
            throw new Error('That text contains a line reading exactly "' + name
                + '", which is the marker used to send it to the machine. Change that line.');
        }
    }

    //THE MARKER IS QUOTED — `<<'TAG'` and not `<<TAG` — which is what stops the
    //shell expanding $, backticks and backslashes inside the body. Without the
    //quotes every one of those in somebody's task would be evaluated on the way
    //in, and a task mentioning a variable would arrive as its value.
    return prefix + " <<'" + name + "'\n" + text + '\n' + name;
}

//AND THE ONE ALMOST EVERY CALLER WANTS: the document written to a file.
function heredoc(path, body, tag) {
    return into('cat > ' + path, body, tag);
}

module.exports = { q: q, heredoc: heredoc, into: into, TAG: TAG };
