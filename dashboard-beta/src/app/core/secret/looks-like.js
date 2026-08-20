//---------------------------------------------------------------------------
//WHAT A SECRET LOOKS LIKE. One vocabulary, two policies.
//
//A PLAIN MODULE AND NOT A PLUGIN, deliberately. ../log wants this and everything
//in this app wants ../log, so making it a service would put the one thing
//nothing can do without behind another edge in the graph. It is a pure function
//over a list of shapes; it needs nothing and it can be required from anywhere,
//including a test with no graph in it.
//
//IT WAS IN THREE PLACES AND NO TWO AGREED. ../log kept two patterns, ../events
//kept four, the app being ported from kept nine. The gap that found it: ../log
//DID NOT REDACT A GITHUB TOKEN AT ALL, and ../events caught one only by accident
//— its "any run of 24+ token-shaped characters" rule, aimed at something else,
//which would stop catching it the day that rule is narrowed for being annoying.
//
//The app being ported from added the GitHub shapes deliberately and says why: no
//machine is ever handed one, so a GitHub token in a machine's output means
//something has already gone wrong — "which is exactly when redaction has to
//already be here".
//
//TWO POLICIES, AND NEITHER IS A WEAKER COPY OF THE OTHER:
//
//    CREDENTIALS  shapes that cannot be anything but a secret. Safe against a
//                 guest's output, which is full of commit hashes and base64.
//    GREEDY       anything long and random, and the tail of every URL. Too blunt
//                 for a live log; right for a DURABLE record, where the trade is
//                 "hard to read" against "kept for ever".
//
//SECOND LINE OF DEFENCE, NOT FIRST. What must not be in a log must not be sent
//to one. This exists because "must not" is a rule somebody has to be right about
//every single time.
//---------------------------------------------------------------------------

//SHAPES THAT CANNOT BE ANYTHING ELSE.
var CREDENTIALS = [
    //Anthropic's own key and token shapes, which say what they are.
    [/\bsk-ant-[A-Za-z0-9_-]{6,}/g, 'sk-ant-<redacted>'],
    //The credential file's own fields, whether or not the value looks like a key.
    [/("(?:accessToken|refreshToken|apiKey|access_token|refresh_token)"\s*:\s*")[^"]+/gi, '$1<redacted>'],
    [/("(?:access|refresh)Token"\s*:\s*")[^"]+/gi, '$1<redacted>'],
    //Anything handed over as a bearer.
    [/(Authorization:\s*Bearer\s+)\S+/gi, '$1<redacted>'],
    [/(ANTHROPIC_API_KEY\s*[=:]\s*)\S+/g, '$1<redacted>'],

    //EVERY PREFIX GITHUB ISSUES: personal (ghp), oauth (gho), user-to-server
    //(ghu), server-to-server (ghs), refresh (ghr), and fine-grained (github_pat).
    //This is the group ../log was missing entirely.
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh<redacted>'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_<redacted>'],
    //A token in a remote URL, which is how one reaches a git error message.
    [/(https:\/\/)[^@/\s:]+(?::[^@/\s]+)?@github\.com/gi, '$1<redacted>@github.com'],
    [/\b(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT)(\s*[=:]\s*)\S+/g, '$1$2<redacted>'],

    //Anything that names itself, whatever shape the value is.
    [/\b(token|secret|password|api[-_ ]?key)\b(\s*[=:]\s*)\S+/gi, '$1$2<redacted>']
];

//TOO BLUNT FOR A LIVE LOG, RIGHT FOR A DURABLE ONE.
var GREEDY = [
    //user:pass@host, which is how a git remote carries a machine's token.
    [/\/\/[^\s/@]*:[^\s/@]*@/g, '//<credential>@'],
    //Any URL: keep the scheme and host, drop everything after it.
    [/\b(https?:\/\/[^\s/]+)\/\S*/gi, '$1/<redacted>'],
    //A long run of token-shaped characters standing on its own.
    [/\b[A-Za-z0-9_-]{24,}\b/g, '<redacted>']
];

function apply(list, text) {
    var out = String(text == null ? '' : text);
    list.forEach(function (pair) { out = out.replace(pair[0], pair[1]); });
    return out;
}

//`durable` IS OPT-IN, so the blunt rules cannot arrive somewhere by accident and
//quietly make a log of commit hashes unreadable.
function redact(text, how) {
    var out = apply(CREDENTIALS, text);
    return how === 'durable' ? apply(GREEDY, out) : out;
}

function apply(list, text) {
    var out = String(text == null ? '' : text);
    list.forEach(function (pair) { out = out.replace(pair[0], pair[1]); });
    return out;
}

//`durable` IS OPT-IN, so the blunt rules cannot arrive somewhere by accident and
//quietly turn a log of commit hashes into a column of <redacted>.
function redact(text, how) {
    var out = apply(CREDENTIALS, text);
    return how === 'durable' ? apply(GREEDY, out) : out;
}

module.exports = { redact: redact, CREDENTIALS: CREDENTIALS, GREEDY: GREEDY };
