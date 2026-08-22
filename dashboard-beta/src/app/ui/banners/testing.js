var React = require('react');

//---------------------------------------------------------------------------
//testing mode is on.
//
//IT IS NOT THE SAME KIND OF THING AS THE TROUBLE BANNER, and the colour says so.
//That one is trouble — something is wrong and somebody should look. This is a
//state somebody ASKED FOR, deliberately, and the only risk in it is forgetting.
//So it is amber rather than red: alarming it would train somebody to dismiss the
//colour, and the one thing this must not become is wallpaper.
//
//ONE SLIM LINE. It is permanent while testing is on, and a permanent thing that
//costs two lines and fifty pixels is a thing that gets resented and then ignored.
//What it has to do is be unmissable and say WHICH FOLDER. The paragraph about
//what the drills actually do lives on the Settings pane, where somebody is
//deciding, rather than repeated over every tab for as long as it is switched on.
//
//`allowed` AND NOT `enabled`, WHICH ARE DIFFERENT QUESTIONS. `enabled` is the
//switch; `allowed` is whether it is on FOR THE FOLDER OPEN NOW. Reading the
//switch would put this banner over a workspace the drills may not touch, which
//is the opposite of what it is for.
//
//---- THERE WAS ONCE A SECOND PERMISSION, AND THERE IS NOT NOW --------------
//
//`settings` was answered here while `suites` and `suiteRun` were relayed to the
//app being ported from: two settings files, two answers, and they could
//disagree. So this named which was saying yes, because the RELAY was the one
//that decided and a banner that is right and confusing beats one that is wrong
//and tidy. It said that block would go the moment those two moved.
//
//THEY HAVE MOVED — see ../../tests/server.js — so there is one permission again
//and this reads it.
//
//IT WAS STILL DRAWING THE OLD SENTENCE THIS MORNING, which is worth writing
//down because of HOW. It read `allowed` off the `suites` answer, and the ported
//`suites` does not carry that field: `!!undefined` is `false`, and `false` was
//exactly the value that meant "the other app says no". A missing field read as
//a settled refusal, and the screen said nothing would run while it ran fine.
//A boolean absent and a boolean false must never be the same answer.
//
//AND IT NO LONGER POLLS `suites` AT ALL. That answer is the whole board — every
//drill, every result — asked every eight seconds to read one flag off it.
//---------------------------------------------------------------------------

module.exports = function testing(theme, okc, shell) {
    var { Banner, Linky } = theme;

    return function Testing() {
        //THE FOLDER'S NAME IS THE POINT, so it comes from the answer that knows
        //which folder the permission is FOR rather than from whatever happens to
        //be open. `settings` carries both, and they can differ.
        var where = okc.use('settings', {}, 30000);

        var t = (where.state && where.state.tests) || {};

        //UNDEFINED IS NOT "no". Until the read lands there is no answer, and no
        //answer is not a permission — so nothing is drawn rather than a banner
        //that flickers on and off with the poll.
        if (!where.state || !t.allowed) return null;

        var dir = t.forDir || t.openDir || '';
        var name = dir ? dir.split(/[\\/]/).filter(Boolean).pop() : 'this workspace';

        return (
            <Banner kind="testing">
                <strong>Testing mode</strong>
                <span>
                    {' — ' + name + '. The drills may write a task and take a credential off a machine here.'}
                </span>
                <Linky onClick={function () { shell.go('Settings', 'General'); }}>Switch it off</Linky>
            </Banner>
        );
    };
};
