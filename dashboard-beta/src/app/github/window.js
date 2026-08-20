var React = require('react');
var makeGithub = require('./github');

//the GitHub pane: the three keys this host holds, and what each one is for.
//
//THE SAME RULE THE KEYS TAB IS BUILT ON, and it is the operator's: you should
//only know that something was done in here, not what. None of the three secrets
//is shown, none is returned by the actions that fill this page, and none could
//be — a fingerprint, a login, an expiry and a scope list say everything a person
//needs to answer "is this working and whose is it" without any of them being the
//thing itself.
//
//THREE DIFFERENT KEYS, THREE DIFFERENT JOBS, and they get confused constantly:
//
//  the GitHub token   reaches GitHub. Opens pull requests, reads issues. Its
//                     scopes are the whole of what this host may do out there.
//  the ssh key        reaches the MACHINES. Not GitHub at all.
//  the TLS pair       is how a machine knows it is talking to THIS host when it
//                     fetches its scripts. It expires, and nothing works after.
//
//AN EXPIRY IS A DATE UNTIL IT IS CLOSE, and then it is a problem. All three of
//these keep working perfectly right up until they stop, so the number of days
//left is the only part anybody acts on.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    //THIS PANE'S OWN LOOK, which the theme does not promise. See ./github.scss.
    require('./github.scss');
    var { shell, theme, okc } = imports;


    //ui/github.js paints into `app-keys` over there — the GitHub token sits
    //on the KEYS screen beside the ssh key and the certificate, not among the
    //repositories. It shares one screen with them there and is a pane here,
    //which is a divergence worth knowing about rather than a decision.
    shell.pane({ tab: 'Keys', name: 'GitHub', order: 20, Component: makeGithub(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
