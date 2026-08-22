var makeSignin = require('./signin');

//---------------------------------------------------------------------------
//SIGNING A MACHINE'S WORKER IN, FROM HERE.
//
//THE SIGN-IN IS A CONVERSATION — the worker prints a URL, a person visits it and
//authorises, and a code comes back — so it is two exchanges with one process
//that a single command cannot do. See ./signin.js.
//
//---- what this plugin does NOT do -----------------------------------------
//
//IT NEVER TOUCHES THE CREDENTIAL. Everything here builds shell and reads what
//came back; the file a sign-in writes stays in the desk's home on the machine,
//and what to do with it afterwards belongs to ../../keys, which is the plugin
//that holds credentials and knows how to seal one.
//
//That split is the reason this is its own plugin rather than part of keys: what
//is here is a MACHINE operation — a pty, a fifo, a process group, a second unix
//user — and none of it is about what a credential is.
//
//AND NO ACTIONS YET, for the reason ../dispatch has none: what these build has
//to be RUN on a machine, and the half that holds a connection to one is
//../channel, which has not moved. An action here would compose a perfect
//conversation and have nowhere to hold it.
//---------------------------------------------------------------------------

plugin.consumes = ['app'];
plugin.provides = ['signin'];
async function plugin(imports, register) {
    await register(null, { signin: makeSignin() });
}
module.exports = plugin;
