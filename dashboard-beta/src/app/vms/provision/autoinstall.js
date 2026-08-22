var fs = require('fs');
var os = require('os');
var path = require('path');

//---------------------------------------------------------------------------
//A WAY TO WATCH AN INSTALL, which is the only thing this adds.
//
//OUR TEMPLATE IS VIRTUALBOX'S PLUS ONE BLOCK. What that block adds is evidence:
//the installer's own journal streamed to the serial port, and ssh into the
//INSTALLER environment with the same key the finished machine gets. Between
//"installing" and "it dialled in" this app had no evidence of any kind, and a
//machine that hangs in that window looks exactly like one that is working.
//
//OUR PLACEHOLDER IS FILLED IN FIRST, and VirtualBox reads the file afterwards
//and fills in every `@@VBOX_...@@` of its own. That is what lets this be a COPY
//of theirs rather than a reimplementation of it — the two substitutions do not
//meet.
//
//---- and it is optional, on purpose ---------------------------------------
//
//IF THE TEMPLATE IS MISSING OR CANNOT BE WRITTEN, THE INSTALL GOES AHEAD
//WITHOUT IT. Being unable to watch is worse than not installing, but only
//slightly — and a machine that will not build because of a logging convenience
//is the wrong trade. The caller is told what it lost, in those words, because
//"it installed but you cannot see it" is a thing somebody has to know before
//they spend twenty-five minutes waiting.
//---------------------------------------------------------------------------

var KEY = '@@OKC_SSH_KEY@@';

module.exports = function autoinstall(deps) {
    var d = deps || {};

    //WHERE THE FILLED-IN COPY GOES. VirtualBox reads it once, as it starts the
    //install, so it does not need to outlive that — and it must not go beside
    //the template, which is a file this app SHIPS.
    var tmpDir = d.tmpDir || function () { return os.tmpdir(); };
    var write = d.write || function (p, text) { fs.writeFileSync(p, text); };

    //THE TEMPLATE ITSELF comes from ./scripts.js, so the project's copy wins
    //over the app's exactly as it does for every other provisioning file.
    var find = d.find;
    var read = d.read || function (p) { return fs.readFileSync(p, 'utf8'); };

    //RETURNS A PATH, OR NULL AND A REASON. Never throws: see the header — the
    //install is worth more than the watching.
    function fill(name, sshKey) {
        try {
            var key = String(sshKey == null ? '' : sshKey).trim();
            var from = find('autoinstall');
            var text = read(from).split(KEY).join(key);

            //A KEY THAT WAS NEVER SUBSTITUTED IS WORSE THAN NO TEMPLATE.
            //
            //The placeholder left in place is not a syntax error and not a
            //missing file — it is a valid autoinstall that authorises the
            //literal string "@@OKC_SSH_KEY@@" as a login. The install succeeds,
            //the machine comes up, and the one way into the installer this
            //block exists to provide is the one thing that does not work.
            if (text.indexOf(KEY) >= 0) {
                return {
                    file: null, lost: null,
                    why: 'the template still has its ssh key placeholder in it, so there would be no way in'
                };
            }

            var to = path.join(tmpDir(), 'okc-autoinstall-' + name + '.yaml');
            write(to, text);

            //AN EMPTY KEY IS THE SAME FAULT ONE STEP QUIETER: no placeholder is
            //left, nothing fails, and `authorized_keys` is an empty file. It is
            //a WARNING rather than a refusal because the template buys two
            //things and only one of them needs a key — the installer's journal
            //still reaches the serial port, and that is the half that has
            //actually caught hangs.
            return {
                file: to,
                why: null,
                lost: key ? null : 'this machine has no ssh key, so the installer environment cannot be logged into — the serial console still works'
            };
        } catch (e) {
            return { file: null, why: e.message, lost: null };
        }
    }

    return { fill: fill, KEY: KEY };
};
