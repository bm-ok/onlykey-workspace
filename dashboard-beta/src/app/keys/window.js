var React = require('react');
var makeKeys = require('./keys');

//the Keys tab: the Claude sign-ins this host holds.
//
//THE RULE THIS TAB IS BUILT AROUND, and it is the operator's own words: you
//should only know that something was done in here, not what. A credential is
//never shown, never logged, never returned by an action, and never put on a
//screen — so this tab is deliberately a page about credentials that contains
//none.
//
//WHAT IT SHOWS INSTEAD IS THE SHAPE OF ONE. A fingerprint, which is a hash and
//says only "the same one" or "a different one". Two dates, because the age of
//the SECRET and the age of the RECORD are different questions — `refreshed`
//moves only when the fingerprint actually changes, so a sign-in added weeks ago
//and refreshed this morning is a healthy one and looks it. Whether the last
//machine that tried it could authenticate. And who is holding it right now,
//because a sign-in that is out cannot be given to anything else.
//
//THE ACCOUNT IS SHOWN AND THE TOKEN IS NOT, which is not a contradiction: the
//email answers "whose bill is this" and is the thing somebody actually needs
//when two accounts are in play. It is not a secret; the token is.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    shell.tab({ name: 'Keys', order: 100 });
    shell.pane({ tab: 'Keys', name: 'This host', order: 10, Component: makeKeys(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
