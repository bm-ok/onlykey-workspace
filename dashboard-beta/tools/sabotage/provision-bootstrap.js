//what ../../test/vms/provision-bootstrap.test.js has to be able to catch.
//
//TWO KINDS OF BREAK HERE, and both matter. Some damage the LINE that goes to a
//machine; the rest damage the CHECKS that examine it before it goes. The second
//kind is the point of that file existing — every one of those rules was a
//comment first, and a comment is not a check.
module.exports = {
    file: 'src/app/vms/provision/bootstrap.js',
    test: 'test/vms/provision-bootstrap.test.js',
    breaks: [
        //---- the order, which is the whole design ---------------------------

        //THE SETUP SCRIPT CARRIES THE MACHINE'S TOKEN. Fetching it before the
        //authority has been checked makes the check decoration.
        ['the token-carrying script is fetched before the authority is checked',
            "    if (secret < checked) {",
            "    if (false) {"],

        //---- no $ survives ---------------------------------------------------

        //THE OUTER SHELL EXPANDS IT FIRST. The version that got this wrong
        //compared an empty string to an empty string, PASSED, and would have
        //accepted any authority at all.
        ['a substitution can be smuggled into the line',
            "    ['$', 'the outer shell expands it before bash -c sees it, so it arrives empty'],",
            ''],

        ['the fingerprint is compared through a variable the outer shell eats',
            "        \"if ! openssl x509 -in /etc/okc/ca.pem -noout -fingerprint -sha256 | tr -d ':' | tr 'A-Z' 'a-z' | grep -q '\"\n            + print + \"'; then\",",
            "        'got=$(openssl x509 -in /etc/okc/ca.pem -noout -fingerprint -sha256);',\n        \"if [ \\\"$got\\\" != '\" + print + \"' ]; then\","],

        //---- a fingerprint at all --------------------------------------------

        //AN EMPTY PATTERN MATCHES EVERYTHING. This is the exact shape of the bug
        //this file exists to make impossible.
        ['a line is built with no fingerprint, so grep matches anything',
            '    if (!print) {',
            '    if (false) {'],

        ['a fingerprint of nothing but colons counts as one',
            "    return String(f == null ? '' : f).replace(/:/g, '').toLowerCase().trim();",
            "    return String(f == null ? '' : f).toLowerCase().trim();"],

        //openssl PRINTS UPPER CASE WITH COLONS and the pipeline strips and
        //lowercases, so a fingerprint compared in its stored form matches
        //nothing — and the install refuses a certificate that was correct.
        ['the fingerprint is compared in a form the pipeline never produces',
            "    return String(f == null ? '' : f).replace(/:/g, '').toLowerCase().trim();",
            "    return String(f == null ? '' : f).trim();"],

        //---- both tools, for both fetches ------------------------------------

        //curl IS NOT IN THE INSTALLER'S TARGET on Ubuntu desktop. Dropping the
        //wget fallback from the SECOND fetch cost a twenty-five minute install
        //that reported a network problem while describing a missing program.
        ['only curl fetches the setup script, so a machine without it cannot install',
            "        \"wget -q --ca-certificate=/etc/okc/ca.pem -O /root/okc-bootstrap.sh '\" + scriptUrl + \"' && break;\",",
            ''],

        ['only wget fetches the setup script',
            "        \"curl -fsSL --cacert /etc/okc/ca.pem '\" + scriptUrl + \"' -o /root/okc-bootstrap.sh && break;\",",
            ''],

        ['only curl fetches the authority',
            "        \"wget -qO /etc/okc/ca.pem '\" + caUrl + \"' && break;\",",
            ''],

        //---- and neither skips verification ----------------------------------

        //--cacert AND --ca-certificate ARE THE SAME INSTRUCTION SPELLED TWICE,
        //which is the whole difference between this and the version that failed.
        ['curl fetches the secret without checking it against the authority',
            "        \"curl -fsSL --cacert /etc/okc/ca.pem '\" + scriptUrl + \"' -o /root/okc-bootstrap.sh && break;\",",
            "        \"curl -fsSL '\" + scriptUrl + \"' -o /root/okc-bootstrap.sh && break;\","],

        ['wget fetches the secret without checking it against the authority',
            "        \"wget -q --ca-certificate=/etc/okc/ca.pem -O /root/okc-bootstrap.sh '\" + scriptUrl + \"' && break;\",",
            "        \"wget -q -O /root/okc-bootstrap.sh '\" + scriptUrl + \"' && break;\","],

        ['a url that turns verification off is built into the line',
            "    ['--insecure', 'it turns off the verification this whole line exists to do'],",
            ''],

        //---- telling the two failures apart -----------------------------------

        //A FILE THAT WAS NEVER FETCHED reaching the fingerprint check is
        //reported as substitution — an accusation, for a machine that simply had
        //no way to download anything.
        ['a machine that could not download anything is accused of substitution',
            "        'if [ ! -s /etc/okc/ca.pem ]; then',\n        \"echo 'okc: could not fetch the certificate authority at all -- neither curl nor wget worked here';\",\n        'exit 1;',\n        'fi;',",
            ''],

        ['a missing setup script does not say what state the machine is in',
            "        'if [ ! -s /root/okc-bootstrap.sh ]; then',\n        \"echo 'okc: could not fetch the setup script -- the operating system is installed but nothing has been set up on it';\",\n        'exit 1;',\n        'fi;',",
            ''],

        //---- and a refusal is the end of it ------------------------------------

        //A FALLBACK IS A WAY TO BE PUSHED ONTO THE UNPROTECTED PATH by whoever
        //is doing the pushing.
        ['a refused authority falls back to fetching the secret anyway',
            "        \"echo 'okc: REFUSED the certificate authority -- it is not the one this machine was told to expect';\",\n        'exit 1;',",
            "        \"echo 'okc: REFUSED the certificate authority -- carrying on';\","],

        //---- the checks themselves ---------------------------------------------

        ['nothing examines the line before it goes to a machine',
            '    check(line, caUrl, scriptUrl, print);',
            ''],

        ['a broken line is warned about rather than refused',
            "        throw new Error('refusing to build an install command line: ' + why",
            "        return; throw new Error('refusing to build an install command line: ' + why"]
    ]
};
