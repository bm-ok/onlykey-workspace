//---------------------------------------------------------------------------
//NOTHING LEAVES THIS HOST CARRYING A SECRET.
//
//vmList carried every machine's bootstrap token and login out in its spec --
//into --json answers, captures and logs -- and was found by accident.
//Stripping it in that one action was a fix; this is the rule. Every answer
//that crosses the wire (the window, okc.js, a capture) passes through here,
//and any field whose NAME says it is a secret is replaced by the word
//`[held]`. The value is still on the host, where the thing that needs it
//reads it in process; what a person or a script sees is that one is held.
//
//BY NAME, NOT BY VALUE, on purpose. A value-shaped rule ("looks like a
//token") misses the ones that do not and flags fingerprints; a name is what
//the author called it, and the names this app uses for a secret are few.
//Names that DESCRIBE a secret without being one stay: `holdsCredential`,
//`fingerprint`, `tokenName`, `hasToken`.
//---------------------------------------------------------------------------

var SECRET = /^(token|password|secret|passphrase|privateKey|credential|apiKey|accessToken|refreshToken)$/i;
var ENDS = /(Token|Password|Secret|Passphrase)$/;
var NOT = /^(holds|has|is|tokenName|fingerprint)/i;

function secretName(key) {
    var k = String(key);
    if (NOT.test(k)) return false;
    return SECRET.test(k) || ENDS.test(k);
}

function scrub(value, depth, seen) {
    depth = depth || 0;
    seen = seen || [];
    if (value === null || typeof value !== 'object') return value;
    if (depth > 12) return value;
    if (seen.indexOf(value) >= 0) return value;
    seen.push(value);

    if (Array.isArray(value)) {
        var arr = value.map(function (v) { return scrub(v, depth + 1, seen); });
        seen.pop();
        return arr;
    }
    //A BUFFER OR A DATE IS A LEAF, not a bag of fields to walk.
    if (value instanceof Date || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
        seen.pop();
        return value;
    }
    var out = {};
    Object.keys(value).forEach(function (k) {
        var v = value[k];
        if (secretName(k) && v != null && v !== '' && v !== false) out[k] = '[held]';
        else out[k] = scrub(v, depth + 1, seen);
    });
    seen.pop();
    return out;
}

module.exports = { scrub: scrub, secretName: secretName };
