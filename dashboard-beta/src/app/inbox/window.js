var React = require('react');
var makeInbox = require('./inbox');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//the Inbox: everything waiting on you, and where to go for it.
//
//BEHIND THE BRAND, NOT IN THE ROW OF TABS. Over there it sits at the far left
//with a count on it, and that placement is the argument: this is not a tab you
//browse to, it is where the app tells you something needs you. Putting it in the
//row beside Repositories would make it one more place to check.
//
//WHY IT EXISTS AT ALL. Every pane in this app is mounted only while it is
//showing, so a tab nobody is looking at asks nothing — which is right for a
//panel and useless for "is something blocked on me". A job sat unapproved and a
//pull request sat drafted and unsent, and the only way to find either was to be
//told. One action counts the lot, in one pass, from anywhere.
//
//EVERY ITEM KNOWS WHERE IT LIVES. `where` is a view, a pane and a thing to pick,
//so the answer to "and where do I do that" is a button rather than a hunt. That
//is the difference between a list of complaints and a list of work.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc', 'remember'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc, remember } = imports;


    //`chrome: true` KEEPS IT OUT OF THE ROW. It is reached from the brand, which
    //is where it is over there and is the right place for it: somewhere you are
    //sent, not somewhere you browse to.
    //`strong` because it is the app's own name, and `label` because the tab is
    //called Inbox while what it reads is "Dashboard" — the title IS the way in.
    shell.tab({ name: 'Inbox', order: 0, chrome: true, strong: true, label: 'Dashboard', Component: makeInbox(theme, okc, remember) });

    //---- the count, asked for OUTSIDE the pane ------------------------------
    //
    //THIS IS THE WHOLE POINT AND THE FIRST VERSION GOT IT BACKWARDS. The badge
    //existed only while the Inbox was open — which is precisely when nobody
    //needs it. A count whose job is to be seen from another tab cannot be
    //produced by a pane that only runs while you are looking at it.
    //
    //So it is asked for here, at plugin scope, for as long as the app is up. It
    //is one small action and the only thing in this app polling while its own
    //tab is shut, which is the exception that proves the rule rather than a
    //crack in it.
    var stop = null;
    function count() {
        okc.call('inbox', {}).then(
            function (d) { shell.badge('Inbox', (d && d.count) || 0); },
            function () { /* the pipe may be down; the badge simply does not move */ }
        );
    }
    count();
    stop = setInterval(count, 20000);

    await register(null, {
        onDestroy: function () { if (stop) clearInterval(stop); }
    });
}
module.exports = plugin;
