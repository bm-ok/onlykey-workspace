var makeGithub = require('./github');
var makeSsh = require('./ssh');
var makeHttps = require('./https');

//---------------------------------------------------------------------------
//KEYS: everything this host holds so that a machine does not have to.
//
//ONE TAB, SIX PANES, TWO KINDS OF CREDENTIAL:
//
//    Claude Worker  ]  identities that are LENT OUT. Kept here under a name,
//    Claude Judge   ]  handed to a machine for one task, taken back after —
//    Claude sup...  ]  registered by ../runners/guests, which still owns them
//
//    GitHub         ]  the token this host spends ITSELF. It never leaves.
//    SSH            ]  how this host gets INTO a machine
//    HTTPS          ]  how a machine knows it is talking to this host
//
//WHAT CHANGED AND WHY.
//
//`This host` is gone. It read `guests` every ten seconds and drew the same list
//../runners/guests already draws three times, split by role, with strictly more
//on it — fingerprint, whose account, when the secret was last refreshed, who has
//it now, and what the last machine that tried it said. A second view of one list
//is a second answer to one question, and the smaller one wins by being first.
//
//The three sign-in panes MOVED HERE FROM RUNNERS. A sign-in is a credential
//before it is anything to do with a machine: it is kept whether or not a machine
//exists, it outlives every machine it is lent to, and what is asked of it is
//what is asked of the GitHub token beside it. Under Runners they sat in the tab
//named after the thing they are lent TO. There is a signpost where they were —
//see ../runners/guests/moved.js, and note that it asks nothing.
//
//`GitHub` BECAME THREE PANES. It was one pane holding three credentials and two
//of them were not GitHub — with a caption inside it apologising for the heading:
//"nothing to do with GitHub". A warning that a title is misleading is an
//argument for a different title. The app being ported from draws the same line,
//as two headings: "GitHub" and "This app's own keys".
//
//AND THE FOLDER `github/` IS GONE WITH IT. It held the ssh and certificate panes
//too, so the name was wrong in the tree as well as on screen, and its stylesheet
//turned out to define only `.sync-*` classes that nothing anywhere uses — a
//sheet inherited by a plugin that never drew a sync button.
//---------------------------------------------------------------------------

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;

    shell.tab({ name: 'Keys', order: 100 });

    //40, 50, 60 — AFTER THE SIGN-INS, which take 10, 20 and 30 from
    //../runners/guests. The lent-out identities come first because they are what
    //somebody comes to this tab to do something ABOUT; these three are set up
    //once and then read.
    shell.pane({ tab: 'Keys', name: 'GitHub', order: 40, Component: makeGithub(theme, okc) });
    shell.pane({ tab: 'Keys', name: 'SSH', order: 50, Component: makeSsh(theme, okc) });
    shell.pane({ tab: 'Keys', name: 'HTTPS', order: 60, Component: makeHttps(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
