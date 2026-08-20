var fs = require('node:fs');
var looksLike = require('./looks-like');
var { execFileSync } = require('node:child_process');

//---------------------------------------------------------------------------
//something worth keeping, kept so that having the file is not enough — and one
//account of what a secret LOOKS like, for everything that writes text down.
//
//---- what the sealing protects against, and what it does not ---------------
//
//It does NOT protect against somebody running as you on this machine. Nothing on
//a single-user desktop can, and pretending otherwise is how a false sense of
//protection gets built. It protects against the file being READ SOMEWHERE ELSE:
//copied to a backup, synced to a cloud folder, pulled off the disk, handed over
//in a support bundle, or picked up by a process running as another account or as
//an administrator. That is the realistic threat for a credential on a
//workstation, and a plain file loses to all of it.
//
//ON WINDOWS: DPAPI, through PowerShell, which is always there. The key is
//derived from the logged-in account by the operating system, so there is no key
//of ours to store — and a key stored next to the thing it encrypts is not
//encryption, it is filing.
//
//ELSEWHERE: the file's own permissions, which are real on those systems. Nothing
//is pretended: `sealed` says which of the two happened, so a reader can tell
//protected-at-rest from merely-not-readable-by-others rather than assuming the
//stronger one.
//
//---- and what a secret LOOKS like ------------------------------------------
//
//That is ./looks-like.js, a plain module rather than part of this service — see
//its header for why, and for the three disagreeing copies it replaced.
//---------------------------------------------------------------------------

var WINDOWS = process.platform === 'win32';

//MARKS A FILE AS DPAPI CIPHERTEXT. Without it, a file written before this
//existed — or on another platform — would be fed to the decryptor and fail as
//corruption rather than as "this one is not sealed".
var MARK = 'okc-dpapi-v1:';

var powershell = function (script) {
    return execFileSync(
        process.env.SystemRoot ? process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : 'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
};

//WRITTEN AND READ AS BASE64 THROUGH THE COMMAND LINE rather than through files,
//so the cleartext never exists anywhere but in memory. A temporary file would
//defeat the whole exercise: it is the copy that gets left behind.
//
//SYNCHRONOUS, AND THIS WINDOW IS ONE NODE CONTEXT — so this blocks the page for
//as long as PowerShell takes, about a fifth of a second. That is acceptable for
//SEALING, which happens when somebody presses a button they are watching. It is
//not acceptable on a read path, which is why ../../keys caches what it opens
//rather than opening per use.
function seal(buffer) {
    if (!WINDOWS) return { data: Buffer.from(buffer), sealed: false };
    var b64 = Buffer.from(buffer).toString('base64');
    var out = powershell(
        'Add-Type -AssemblyName System.Security; ' +
        '$b=[Convert]::FromBase64String(\'' + b64 + '\'); ' +
        '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))'
    );
    return { data: Buffer.from(MARK + out, 'utf8'), sealed: true };
}

function open(buffer) {
    var text = Buffer.from(buffer).toString('utf8');
    //written before this existed, or not on Windows
    if (text.indexOf(MARK) !== 0) return Buffer.from(buffer);
    if (!WINDOWS) throw new Error('This credential was sealed on Windows and can only be opened there, by the account that sealed it.');

    var b64 = text.slice(MARK.length).trim();
    var out = powershell(
        'Add-Type -AssemblyName System.Security; ' +
        '$b=[Convert]::FromBase64String(\'' + b64 + '\'); ' +
        '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))'
    );
    return Buffer.from(out, 'base64');
}

//WHETHER WHAT IS ON DISK IS CIPHERTEXT, without opening it. Used to report the
//truth in the window rather than a claim — and to notice a file that predates
//this and should be sealed on the next write.
function isSealed(file) {
    try { return fs.readFileSync(file).toString('utf8').indexOf(MARK) === 0; }
    catch (e) { return false; }
}

function write(file, buffer) {
    var s = seal(buffer);
    fs.writeFileSync(file, s.data);
    //STILL SET, AND STILL WORTH SETTING: on anything but Windows it is the whole
    //protection, and on Windows it costs nothing to ask. `chmod 0600` on Windows
    //is theatre — it toggles the read-only bit — which is why the sealing exists.
    try { fs.chmodSync(file, 0o600); } catch (e) { /* windows ignores this */ }
    return s.sealed;
}

function read(file) { return open(fs.readFileSync(file)); }

//---------------------------------------------------------------------------
//CONSUMES NOTHING, ON PURPOSE. ../log and ../events both want `redact`, and
//everything in this app wants ../log — so anything this asked for would be a
//cycle through the one service nothing can do without.
//---------------------------------------------------------------------------
plugin.consumes = [];
plugin.provides = ['secret'];
async function plugin(imports, register) {
    await register(null, {
        secret: {
            seal: seal, open: open, write: write, read: read, isSealed: isSealed,
            //PASSED THROUGH so a caller that already has this service does not
            //need a second require for the other half of the same subject.
            redact: looksLike.redact,
            WINDOWS: WINDOWS,
            MARK: MARK
        }
    });
}
module.exports = plugin;

//ALSO A PLAIN MODULE, because `main.js` is loaded by rectify as a plugin and its
//own test has no graph to load it from.
module.exports.seal = seal;
module.exports.open = open;
module.exports.write = write;
module.exports.read = read;
module.exports.isSealed = isSealed;
module.exports.redact = looksLike.redact;
module.exports.WINDOWS = WINDOWS;
module.exports.MARK = MARK;
