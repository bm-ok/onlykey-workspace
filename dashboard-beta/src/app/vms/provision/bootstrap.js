//---------------------------------------------------------------------------
//THE ONE COMMAND LINE AN INSTALL IS TRUSTED WITH.
//
//A machine being installed holds NOTHING: no certificate, no authority, no
//token, nothing to check anything against. This is the single line that gets it
//from that state to one where it has all of them, and every detail below is
//load-bearing. Each of them cost a failed twenty-five minute install to find.
//
//---- what it does, in the order it has to do it ---------------------------
//
//  1. fetch the certificate authority, over the ONE unencrypted port
//  2. check it against a fingerprint that travelled by another route
//  3. and only then fetch anything carrying a secret
//
//THE ORDER IS THE WHOLE DESIGN. The script fetched in step 3 carries the
//machine's token, so fetching it in the clear — or with verification off — is
//exactly what all of this exists to stop. And there is no fallback to plain
//HTTP if the check fails, because a fallback is a way to be pushed onto the
//unprotected path by whoever is doing the pushing.
//
//---- the rules that are not obvious ---------------------------------------
//
//NO `$` ANYWHERE. VirtualBox pastes this inside a double-quoted argument, so the
//OUTER shell expands `$(...)` and `$var` before `bash -c` ever sees them — a
//loop counter arrives empty, and a substitution runs on the wrong side.
//
//That is why the fingerprint is compared with a PIPELINE INTO grep rather than
//with a variable. `got=$(...)` would be expanded by the outer shell and arrive
//empty, so the comparison would be between two empty strings — which PASSES.
//That version looked like it checked and would have accepted any authority at
//all.
//
//IT MUST BE A PLAIN ARGUMENT LIST. VirtualBox pastes it into its own template as
//an unquoted argument to a helper, so a leading parenthesis is a bash syntax
//error and the install dies at the very end with nothing saying why.
//
//BOTH curl AND wget, FOR BOTH FETCHES. curl is NOT in the installer's target on
//Ubuntu desktop. The original had a wget fallback for exactly that reason; when
//this was rewritten for TLS the fallback survived on the first fetch and was
//dropped from the second, because wget spells its authority flag differently and
//translating it was one step more than copying it. What that cost is the shape
//worth remembering: the install ran for twenty-five minutes, the first fetch
//succeeded through wget, the fingerprint checked out, and then the second loop
//said "the dashboard is not reachable yet" ten times — a sentence about the
//network, describing a missing program.
//
//---- and the rules are CHECKED here, not just written down ----------------
//
//Every paragraph above was a comment in the version this comes from, and a
//comment is not a check. Two of these mistakes have already been made once; the
//`$` one produced a fingerprint test that passed against any authority. So the
//line is examined before it is handed back, and a build that breaks one of these
//rules refuses rather than going to a machine.
//---------------------------------------------------------------------------

//A LOWERCASE, COLONLESS FINGERPRINT is what the pipeline below produces, so it
//is what it has to be compared against. openssl prints upper case with colons.
function normalFingerprint(f) {
    return String(f == null ? '' : f).replace(/:/g, '').toLowerCase().trim();
}

//WHAT MUST NEVER BE IN IT. Each of these is a way to make the whole exchange
//pointless while looking like it works.
var NEVER = [
    ['$', 'the outer shell expands it before bash -c sees it, so it arrives empty'],
    ['--insecure', 'it turns off the verification this whole line exists to do'],
    [' -k ', 'it turns off the verification this whole line exists to do'],
    ['--no-check-certificate', 'it turns off the verification this whole line exists to do']
];

function bootstrapLine(input) {
    var it = input || {};
    var caUrl = String(it.caUrl || '');
    var scriptUrl = String(it.scriptUrl || '');
    var print = normalFingerprint(it.fingerprint);

    if (!caUrl) throw new Error('an install needs somewhere to fetch the certificate authority from.');
    if (!scriptUrl) throw new Error('an install needs somewhere to fetch its setup script from.');

    //A FINGERPRINT IS NOT OPTIONAL. Without one the grep below would match
    //nothing — or, with an empty pattern, EVERYTHING. That is the failure this
    //file exists to make impossible, so it is refused here rather than built.
    if (!print) {
        throw new Error('an install needs the fingerprint of the certificate authority. '
            + 'Without one the machine has no way to tell this host from anything else answering on that port.');
    }

    var line = [
        'mkdir -p /etc/okc;',

        //---- 1. the authority, over the one unencrypted port ---------------
        //
        //RETRIED, because this fetch is the single moment the whole install
        //depends on this app being reachable. A restart or a slow network would
        //otherwise waste the entire install.
        'for i in 1 2 3 4 5 6 7 8 9 10; do',
        "curl -fsSL '" + caUrl + "' -o /etc/okc/ca.pem && break;",
        "wget -qO /etc/okc/ca.pem '" + caUrl + "' && break;",
        "echo 'okc: could not fetch the certificate authority yet, retrying in 10s';",
        'sleep 10;',
        'done;',

        //TOLD APART FROM A FINGERPRINT THAT DOES NOT MATCH, which is a different
        //fault with a different cause. Without this, a file that was never
        //fetched reaches the check below and is reported as an authority that
        //"is not the one this machine was told to expect" — an accusation about
        //substitution, for a machine that simply had no way to download
        //anything.
        'if [ ! -s /etc/okc/ca.pem ]; then',
        "echo 'okc: could not fetch the certificate authority at all -- neither curl nor wget worked here';",
        'exit 1;',
        'fi;',

        //---- 2. and it is the right one ------------------------------------
        //
        //A PIPELINE INTO grep -q, NOT A VARIABLE. See the header: `got=$(...)`
        //is expanded by the outer shell, arrives empty, and compares empty to
        //empty — which passes, accepting any authority at all.
        "if ! openssl x509 -in /etc/okc/ca.pem -noout -fingerprint -sha256 | tr -d ':' | tr 'A-Z' 'a-z' | grep -q '"
            + print + "'; then",
        "echo 'okc: REFUSED the certificate authority -- it is not the one this machine was told to expect';",
        'exit 1;',
        'fi;',

        //---- 3. only now, the thing carrying a secret ----------------------
        //
        //NEITHER IS TOLD TO SKIP VERIFICATION. `--cacert` and `--ca-certificate`
        //are the same instruction spelled twice, and that is the whole
        //difference between this and the version that failed.
        'for i in 1 2 3 4 5 6 7 8 9 10; do',
        "curl -fsSL --cacert /etc/okc/ca.pem '" + scriptUrl + "' -o /root/okc-bootstrap.sh && break;",
        "wget -q --ca-certificate=/etc/okc/ca.pem -O /root/okc-bootstrap.sh '" + scriptUrl + "' && break;",
        "echo 'okc: could not fetch the setup script yet, retrying in 10s';",
        'sleep 10;',
        'done;',

        //SAID HERE RATHER THAN LEFT TO BASH. Without it the script simply runs a
        //file that is not there, and the last words of a twenty-five minute
        //install are "No such file or directory" and "exit code: 127" — which
        //describe the symptom and name neither the cause nor what state the
        //machine is now in.
        'if [ ! -s /root/okc-bootstrap.sh ]; then',
        "echo 'okc: could not fetch the setup script -- the operating system is installed but nothing has been set up on it';",
        'exit 1;',
        'fi;',
        'bash /root/okc-bootstrap.sh'
    ].join(' ');

    check(line, caUrl, scriptUrl, print);
    return line;
}

//---- the line is examined before it goes anywhere near a machine -----------
//
//A REFUSAL, NOT A WARNING. Every one of these means the install would either
//fail twenty-five minutes in or — worse — succeed while having checked nothing.
function check(line, caUrl, scriptUrl, print) {
    function no(why) {
        throw new Error('refusing to build an install command line: ' + why
            + '. See src/app/vms/provision/bootstrap.js — this is checked because the comment saying it was not enough.');
    }

    for (var i = 0; i < NEVER.length; i++) {
        if (line.indexOf(NEVER[i][0]) >= 0) {
            no('it contains "' + NEVER[i][0].trim() + '", and ' + NEVER[i][1]);
        }
    }

    //A LEADING PARENTHESIS IS A BASH SYNTAX ERROR here, and the install dies at
    //the very end with nothing saying why.
    if (/^\s*\(/.test(line)) no('it starts with a parenthesis, which VirtualBox pastes unquoted into a bash syntax error');

    //THE ORDER IS THE DESIGN. The secret-carrying URL must not be reachable
    //before the authority has been checked — if it is, the check is decoration.
    var checked = line.indexOf(print);
    var secret = line.indexOf(scriptUrl);
    if (checked < 0) no('the fingerprint is not in it, so nothing is compared');
    if (secret < 0) no('the setup script is never fetched');
    if (secret < checked) {
        no('it fetches the setup script before checking the authority, so the check is decoration '
            + 'and the token in that script goes to whoever answered');
    }

    //BOTH TOOLS, FOR BOTH FETCHES. curl is not in the installer's target on
    //Ubuntu desktop, and a single-tool fetch is the failure that reads as a
    //network problem.
    [['curl', caUrl], ['wget', caUrl], ['curl', scriptUrl], ['wget', scriptUrl]].forEach(function (pair) {
        var re = new RegExp(pair[0] + '[^;]*' + pair[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!re.test(line)) no(pair[0] + ' is never used to fetch ' + pair[1] + ', so a machine without it cannot install');
    });

    //AND THE SECOND FETCH NAMES THE AUTHORITY IT CHECKS AGAINST. Fetching the
    //token-carrying script without it is the unprotected path by another name.
    if (line.indexOf('--cacert /etc/okc/ca.pem') < 0) no('curl does not check the setup script against the authority');
    if (line.indexOf('--ca-certificate=/etc/okc/ca.pem') < 0) no('wget does not check the setup script against the authority');
}

module.exports = { bootstrapLine: bootstrapLine, normalFingerprint: normalFingerprint };
