var https = require('node:https');

//---------------------------------------------------------------------------
//THE ONE PLACE THAT TALKS TO GITHUB.
//
//One place that builds the request, one place that sets the headers GitHub
//requires, and — this is the point — one place that could ever leak the token.
//Everything else asks this: ../repositories asks for its pull requests here
//rather than fetching them, and does not know a token exists.
//
//AND IT DOES NOT HOLD THE TOKEN EITHER. It asks ../keys to sign what it has
//built. The credential is never a variable in this file, never in a closure
//here, never in an error raised here — ../keys hands back headers, and those
//headers are handed to node and nothing else. `keys.github.sign()` also refuses
//to sign a request bound anywhere but the API host the token was kept for, which
//is what stops the redirect-following below from becoming a way out.
//
//NOR DOES A RAW TOKEN PASS THROUGH ON ITS WAY IN. `githubKeySet` is defined by
//../keys, which writes the new token, then asks the action table for
//`githubCheck` — the action below — and rolls back if it says no. A LOOKUP
//RATHER THAN A GRAPH EDGE, which is what lets the check happen without ../keys
//consuming this and this consuming ../keys. So the pasted token goes from the
//dialog to the store and is read back from there; it never enters this file.
//
//---- a repository that moved -----------------------------------------------
//
//GitHub answers 301 with a `Location` when a repository has been renamed or
//transferred, and keeps doing so indefinitely. Nothing followed it once, so
//every caller saw "not 200" and reported the thing gone — which is how six pull
//requests read as `gone from GitHub` after three repositories moved from one
//account to another. They were never gone. Nobody was listening.
//
//FOLLOWED FOR READS AND NOT FOR WRITES, and that is not a detail. A GET that
//follows a redirect asks the same question at the address GitHub gave; a POST
//that follows one PUBLISHES SOMETHING INTO A REPOSITORY NOBODY NAMED. A write to
//a moved repository is reported, with the new name in the message, and somebody
//decides.
//
//WHERE IT WENT IS CARRIED BACK, because a read that quietly succeeds at a new
//address leaves the record still naming the old one — working today and wrong
//the moment anybody reads it.
//---------------------------------------------------------------------------

var REDIRECTS = { 301: 1, 302: 1, 307: 1, 308: 1 };
var SAFE = { GET: 1, HEAD: 1 };

plugin.consumes = ['app', 'log', 'keys'];
plugin.provides = ['github'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('github');
    var keys = imports.keys;

    function call(method, at, body, opts) {
        var o = opts || {};
        var api = o.host || keys.github.apiHost();
        var payload = body == null ? null : Buffer.from(JSON.stringify(body));
        var hops = o.hops || 0;

        //SIGNED BY ../keys, NOT HERE. If it refuses — no token, or a host this
        //token was not kept for — the refusal is the answer and it is raised
        //before anything is sent.
        var headers = keys.github.sign(api, Object.assign({
            //Required by GitHub, and refused without them.
            'user-agent': 'okc-dashboard',
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28'
        }, payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}));

        return new Promise(function (resolve, reject) {
            var req = https.request({
                host: api, path: at, method: method, headers: headers, timeout: 30000
            }, function (res) {
                var chunks = [];
                res.on('data', function (c) { chunks.push(c); });
                res.on('end', function () {
                    var text = Buffer.concat(chunks).toString('utf8');
                    var json = null;
                    //GitHub answers HTML for some errors.
                    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
                    var answer = { status: res.statusCode, headers: res.headers, body: json, text: text, movedTo: o.from || null };

                    var where = res.headers && res.headers.location;
                    //ONE HOP AT A TIME, AND NOT MANY. A chain of redirects is a
                    //misconfiguration rather than a rename, and following it for
                    //ever is how a client hangs on somebody else's mistake.
                    if (REDIRECTS[res.statusCode] && where && hops < 3) {
                        var next = where;
                        //THE PATH ONLY. `Location` is absolute and its host is
                        //the API host we already asked; taking the path keeps
                        //the request going to the one place ../keys will sign
                        //for. Belt and braces — sign() would refuse anyway.
                        try { next = new URL(where, 'https://' + api).pathname; } catch (e) { /* use it as given */ }

                        if (SAFE[String(method).toUpperCase()]) {
                            return resolve(call(method, next, body, { host: o.host, hops: hops + 1, from: next }));
                        }

                        //A WRITE. Not followed, and said plainly enough to act on.
                        return resolve(Object.assign({}, answer, {
                            movedTo: next,
                            movedRefused: at + ' has moved to ' + next + '. A read would follow that; a ' + method
                                + ' is not followed, because writing into a repository nobody named is not this app\'s decision to make.'
                        }));
                    }

                    resolve(answer);
                });
            });
            req.on('timeout', function () { req.destroy(new Error('GitHub did not answer within 30 seconds (' + api + ').')); });
            //THE MESSAGE MUST NOT CARRY THE REQUEST, because the request carries
            //the token in a header and an error message is a thing that gets
            //logged. Only the host goes in.
            req.on('error', function (e) { reject(new Error('Could not reach ' + api + ': ' + e.message)); });
            if (payload) req.write(payload);
            req.end();
        });
    }

    //---- is it any good ----------------------------------------------------
    //
    //THE ONLY PROOF IS ASKING GITHUB. A token is an opaque string; nothing about
    //its shape says whether it works, what it can do, or whether somebody
    //revoked it this morning. A file on disk is not a working credential.
    async function check() {
        var r = await call('GET', '/user');

        if (r.status === 401) {
            var gone = 'GitHub rejected it — it has been revoked, or it expired';
            keys.github.remember({ ok: false, checked: { at: new Date().toISOString(), ok: false, why: gone } });
            return { ok: false, status: r.status, why: gone };
        }
        if (r.status !== 200) {
            var why = (r.body && r.body.message) || ('GitHub answered ' + r.status);
            keys.github.remember({ ok: false, checked: { at: new Date().toISOString(), ok: false, why: why } });
            return { ok: false, status: r.status, why: why };
        }

        //CLASSIC TOKENS REPORT THEIR SCOPES IN A HEADER; fine-grained ones report
        //nothing there, and an empty string is not the same as "no permissions".
        //It is reported as unknown, because guessing here would be guessing about
        //what this app is allowed to do to somebody's repositories.
        var scopes = r.headers['x-oauth-scopes'];
        var found = {
            login: r.body && r.body.login,
            name: (r.body && r.body.name) || null,
            kind: scopes == null ? 'fine-grained' : 'classic',
            scopes: scopes == null ? null : String(scopes).split(',').map(function (s) { return s.trim(); }).filter(Boolean),
            expires: r.headers['github-authentication-token-expiration'] || null,
            api: keys.github.apiHost(),
            ok: true,
            checked: { at: new Date().toISOString(), ok: true, why: null }
        };
        keys.github.remember(found);
        return Object.assign({ ok: true, status: 200 }, found);
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('githubCheck', {
            about: 'Ask GitHub who this host\'s token is, and what it may do',
            run: async function () {
                var said = await check();
                //WHAT IS SAID IS WHETHER IT WORKED, never the credential.
                log[said.ok ? 'good' : 'warn']('the GitHub token was checked — ' + (said.ok ? 'it signs in as ' + said.login : said.why));
                return Object.assign({}, said, {
                    note: said.ok
                        ? 'GitHub knows it as ' + said.login + (said.expires ? ', expiring ' + said.expires : '') + '.'
                        : said.why
                });
            }
        }));
    }

    await register(null, {
        github: {
            //THE WHOLE SURFACE anything else gets. ../repositories will ask for
            //pull requests through `call`, and will never learn that a
            //credential is involved at all.
            call: call,
            check: check,
            apiHost: function () { return keys.github.apiHost(); }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
