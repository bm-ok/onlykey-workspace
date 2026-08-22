var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//THE GUEST'S HALF, WHICH RUNS ON A MACHINE RATHER THAN HERE.
//
//A REAL FILE, NOT A STRING IN A SOURCE FILE, for the reason ../dispatch/payloads
//gives about its three: it can then be linted, syntax-checked and read like the
//code it is. `node --check` on a string inside a template literal is not a thing
//anybody does, and what would arrive on a machine is what somebody wrote.
//
//IT LIVES BESIDE THE PROVISION SCRIPTS because that is where it is in the app
//being ported from and where the packaging already puts it — see PAYLOADS in
//webpack.config.js, which copies src/app/vms/provision/scripts to dist/provision.
//It is not a provisioning script: it is sent, per handover, and not installed.
//
//READ ONCE, AT LOAD, AND LOUDLY IF IT IS NOT THERE. A missing payload otherwise
//surfaces as a machine that publishes no key and a handover that reports "it
//would not make a key to receive a credential with" — which is true, and points
//at the guest rather than at this host, which is where the fault actually is.
//---------------------------------------------------------------------------

//BESIDE THE SERVER BUNDLE, because that is what survives being packaged — see
//`node: { __dirname: false }` in webpack.config.js, and ../provision/server.js,
//which finds the same folder the same way.
var DIR = process.env.OKC_APP_PROVISION_DIR || path.join(__dirname, 'provision');

var FILE = 'okc-credential.js';

module.exports = function payload(deps) {
    var d = deps || {};
    var dir = d.dir || DIR;
    var read = d.read || function (p) { return fs.readFileSync(p, 'utf8'); };

    var file = path.join(dir, FILE);
    var held;

    try {
        held = read(file);
    } catch (e) {
        throw new Error('The dashboard is missing ' + FILE + ', which runs on the machine to receive a '
            + 'credential. It should be at ' + file + ' — it is copied there from '
            + 'src/app/vms/provision/scripts by the PAYLOADS list in webpack.config.js.');
    }

    //AN EMPTY PAYLOAD IS WORSE THAN A MISSING ONE: it copies, it writes, and the
    //guest runs nothing while everything reports success — right up to the point
    //where no key comes back.
    if (!String(held).trim()) {
        throw new Error(FILE + ' is empty. A machine would be sent a file that does nothing and then '
            + 'asked for a key it cannot make.');
    }

    return { guestHalf: function () { return held; }, where: file };
};

module.exports.FILE = FILE;
