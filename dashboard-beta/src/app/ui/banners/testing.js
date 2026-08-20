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
//---------------------------------------------------------------------------

module.exports = function testing(theme, okc, shell) {
    var { Banner, Linky } = theme;

    return function Testing() {
        var q = okc.use('suites', {}, 8000);
        //THE FOLDER'S NAME IS THE POINT, so it comes from the answer that knows
        //which folder the permission is FOR rather than from whatever happens to
        //be open. `settings` carries both, and they can differ.
        var where = okc.use('settings', {}, 30000);

        if (!q.state || !q.state.allowed) return null;

        var t = (where.state && where.state.tests) || {};
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
