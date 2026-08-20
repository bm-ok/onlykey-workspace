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
//---- TWO PERMISSIONS EXIST RIGHT NOW, AND THIS SAYS SO ---------------------
//
//../../settings/server.js has been ported and `suites` has not. So `settings`
//is answered HERE and `suites` is still relayed to the app being ported from —
//two settings files, two answers, and they can disagree.
//
//THE RELAY IS THE ONE THAT DECIDES, and that is why it is still what raises this
//banner. `suiteRun` is relayed too: press Run in the Test tab and the OTHER
//app's gate is what is consulted, whatever this one says. Switching this banner
//over to the local answer would have made the screen agree with itself by
//deleting a warning that is true — the drills would still run, and nothing on
//screen would say so.
//
//SO IT SHOWS WHEN EITHER SAYS YES, and names which when they differ. A banner
//that is right and confusing beats one that is wrong and tidy; this stops being
//necessary the moment `suites` and `suiteRun` move, and the whole block goes
//with them.
//---------------------------------------------------------------------------

module.exports = function testing(theme, okc, shell) {
    var { Banner, Linky } = theme;

    return function Testing() {
        var q = okc.use('suites', {}, 8000);
        //THE FOLDER'S NAME IS THE POINT, so it comes from the answer that knows
        //which folder the permission is FOR rather than from whatever happens to
        //be open. `settings` carries both, and they can differ.
        var where = okc.use('settings', {}, 30000);

        var t = (where.state && where.state.tests) || {};
        //THE RELAYED GATE IS UNDEFINED UNTIL THAT READ LANDS, and undefined is
        //not "no". Only a settled `false` counts as the other app saying no.
        var relayed = q.state ? !!q.state.allowed : null;
        var local = where.state ? !!t.allowed : null;
        if (!relayed && !local) return null;

        var dir = t.forDir || t.openDir || '';
        var name = dir ? dir.split(/[\\/]/).filter(Boolean).pop() : 'this workspace';

        //WHICH ONE IS SAYING YES, said only when they disagree. With both
        //agreeing this is the line it has always been; the extra sentence is the
        //answer to "the card says off, so why is this here".
        var split = null;
        if (relayed && local === false) {
            split = ' That is the dashboard’s own permission — Run in the Test tab is still relayed to it. Settings → General here says off, and this app’s answer does not govern that press yet.';
        } else if (local && relayed === false) {
            split = ' That is this app’s permission. Run in the Test tab is still relayed to the dashboard, which says no — so nothing runs until that one is turned on too.';
        }

        return (
            <Banner kind="testing">
                <strong>Testing mode</strong>
                <span>
                    {' — ' + name + '. The drills may write a task and take a credential off a machine here.'}
                    {split}
                </span>
                <Linky onClick={function () { shell.go('Settings', 'General'); }}>Switch it off</Linky>
            </Banner>
        );
    };
};
