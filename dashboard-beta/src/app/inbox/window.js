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
    //---- AND IT IS EVERY TAB'S BADGE, NOT ONLY THIS ONE --------------------
    //
    //ONE POLLER FOR THE WHOLE ROW. A badge's job is to be seen from a tab you
    //are NOT on, and every pane in this app is mounted only while it is showing
    //— so a pane can never produce its own. ../ui/shell says exactly this over
    //`setBadge` and then had two callers who disagreed about it: this one, at
    //plugin scope, and ../tests, from a `useEffect` inside its pane. The second
    //only moved while somebody was looking at the Test tab, which is precisely
    //when nobody needs it.
    //
    //SO THE COUNT IS COMPOSED ON THE SERVER AND SPLIT BY TAB THERE — see
    //./server.js `byTab`. Every plugin that can block a person registers a
    //source; the totals fall out of the items, because each one already says
    //which tab it is on in order to say where to GO. There is no second list of
    //what belongs where to keep in step.
    //
    //CLEARING IS THE HALF THAT ROTS. A tab whose last errand was dealt with must
    //drop to nothing, and a badge that only ever counts up is one people stop
    //believing. `byTab` is the WHOLE answer for every tab that has anything, so
    //anything this pushed last time and is not in it now is set to null.
    var stop = null;
    var lit = [];

    function count() {
        okc.call('inbox', {}).then(
            function (d) {
                var by = (d && d.byTab) || {};

                shell.badge('Inbox', (d && d.count) || 0);

                Object.keys(by).forEach(function (tab) { shell.badge(tab, by[tab]); });
                lit.forEach(function (tab) {
                    if (by[tab] === undefined) shell.badge(tab, null);
                });
                lit = Object.keys(by);
            },
            //THE PIPE MAY BE DOWN, and then no badge moves at all. Deliberately
            //not zeroed: "nothing is waiting" and "I could not ask" are the two
            //sentences this whole plugin exists to keep apart, and clearing the
            //row on a failed read would say the first while meaning the second.
            function () { /* the badges simply do not move */ }
        );
    }
    count();
    stop = setInterval(count, 20000);

    await register(null, {
        onDestroy: function () { if (stop) clearInterval(stop); }
    });
}
module.exports = plugin;
