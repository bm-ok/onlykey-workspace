//---------------------------------------------------------------------------
//what this app is set to, at a command line.
//
//THE DRILLS FIRST AND EVERYTHING ELSE AFTER, because they are the only setting
//here with a blast radius. The other three are yes-or-no questions about this
//host; `testsEnabled` is a yes-or-no question about SOMEBODY'S FOLDER, and the
//whole design of ./server.js is that "on" is not a state it has — it is on FOR
//somewhere. A listing that printed `testsEnabled: true` beside the rest would
//flatten the one distinction the setting exists to carry.
//
//SO THE FOLDER IS ON THE LINE. "On, for a folder that is not the one open" is
//the state a person came to the command line to discover, and it reads as ON in
//every shorter phrasing of it.
//
//`--json` STILL GIVES THE BRACES. Nothing here is computed and nothing is asked
//for — every field printed comes off the answer, so this cannot drift from what
//a script sees.
//---------------------------------------------------------------------------

function yesno(v) {
    if (v === true) return 'on';
    if (v === false) return 'off';
    if (v === null || v === undefined) return '—';
    return String(v);
}

function settings(said) {
    var s = said.settings || {};
    var t = said.tests || {};
    var out = [];

    //---- the drills -------------------------------------------------------
    //
    //THREE STATES, NOT TWO, and the third is the interesting one. `allowed` is
    //taken from the answer rather than recomputed here: it is the same string
    //comparison either way, and computing it twice is how a listing comes to
    //disagree with the refusal a drill was given.
    if (t.allowed) {
        out.push('  drills   ON for ' + t.openDir);
    } else if (t.enabled) {
        out.push('  drills   on for ' + (t.forDir || 'nowhere') + ' — NOT the folder open now');
        out.push('           open:  ' + (t.openDir || 'nothing is open'));
    } else {
        out.push('  drills   off');
    }
    //THE SENTENCE SAYING WHY, because it is the thing somebody is looking for
    //when a drill has just been refused and they came here to find out what to
    //do about it. Wrapped under the line rather than truncated onto it.
    if (t.why) {
        out.push(t.why.replace(/(.{1,68})(\s|$)/g, '           $1\n').replace(/\n$/, ''));
    }

    //A STANDING REQUEST IS THE ONE THING HERE WAITING ON A PERSON, so it is not
    //buried among the settings that are merely true.
    if (said.askedToTest) {
        out.push('');
        out.push('  asked    ' + said.askedToTest.why);
        out.push('           for ' + said.askedToTest.forDir);
        out.push('           answered in the window — testsAnswer is refused down this pipe');
    }

    //---- the rest ---------------------------------------------------------
    out.push('');
    Object.keys(s).forEach(function (k) {
        if (k === 'testsEnabled' || k === 'testsFor' || k === 'testsAsked') return;
        out.push('  ' + k.padEnd(16) + yesno(s[k]));
    });

    out.push('');
    out.push('  ' + said.where);
    return out.join('\n');
}

module.exports = {
    print: {
        settings: settings,
        //THE SAME VIEW AFTER A CHANGE, so a `settingSet` answers with what the
        //app is now set to rather than with the word "Saved." and a shrug. It
        //carries `settings` but not the derived block, so the note stands in.
        settingSet: function (said) {
            return said.note || 'Saved.';
        },
        testsAsk: function (said) {
            if (!said.asked) return said.note;
            return said.note + '\n  for ' + said.request.forDir + '\n  ' + said.request.why;
        }
    }
};
