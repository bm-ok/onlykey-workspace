var https = require('node:https');
var Many = require('./many');

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

//---- asking again for something that has not changed -----------------------
//
//THE PR CUTS TAB TOOK TWENTY-THREE SECONDS TO SAY NOTHING HAD HAPPENED. Twenty-
//six pull requests, asked for one at a time, every one of them already merged
//and every one of them downloaded in full to be told so again.
//
//AN ETAG IS GITHUB'S OWN FINGERPRINT FOR THE ANSWER. Send the last one back in
//`If-None-Match` and a resource that has not moved answers `304 Not Modified`
//with no body at all — and, the part that matters most for something a pane
//polls, GitHub does not charge a 304 against the hourly quota. So the cost of
//being up to date drops from the size of the answer to the size of a header.
//
//THE 304 IS TURNED BACK INTO A 200 HERE, and that is deliberate: every caller in
//this app tests `status === 200`, and a cache that requires forty call sites to
//learn a new status code is a cache that breaks thirty-nine of them. What comes
//back is the answer, with `notModified` on it for anything that wants to know.
//
//`fresh` IS THE WAY OUT and `githubCheck` takes it. That action's entire worth is
//that it asked GitHub JUST NOW — an answer served against a fingerprint is an
//answer from the last time it was asked, and the two are indistinguishable to
//whoever is reading the pane.
//
//NOTHING IS INVALIDATED ON A WRITE, and that is a property rather than an
//oversight. Merging a pull request changes the resource, GitHub issues a new
//fingerprint, and the very next read comes back 200 with the new answer. A cache
//that has to be invalidated by hand is stale exactly where somebody forgot; this
//one cannot be, because it never answers without asking.
//---------------------------------------------------------------------------

var REDIRECTS = { 301: 1, 302: 1, 307: 1, 308: 1 };
var SAFE = { GET: 1, HEAD: 1 };

//HOW MANY READS ARE IN FLIGHT AT ONCE, chosen for latency and not for the rate
//limit. Five thousand an hour is nowhere near the constraint; the constraint is
//that reads were serialised behind each other for no reason. Eight turns
//twenty-six round trips into four waves. Higher buys little and starts to look
//like something worth rate-limiting from the other end.
//
//IT IS A NUMBER ABOUT GITHUB, so it lives with the plugin that owns the
//connection rather than being guessed at again in every pane that wants a list.
//What a pool IS lives in ./many.js, so a test can use the real one.
var AT_ONCE = 8;

//WHAT IS KEPT OF A RESPONSE, BY NAME. The answer and a few headers that describe
//it — never the whole header block, which is written to disk and grows whatever
//GitHub decides to send next. The request headers, which are the ones carrying
//the token, are not part of this and never were.
var KEEP_HEADERS = ['etag', 'link', 'last-modified', 'content-type'];

function headersWorthKeeping(from) {
    var out = {};
    for (var i = 0; i < KEEP_HEADERS.length; i++) {
        var h = KEEP_HEADERS[i];
        if (from && from[h] != null) out[h] = from[h];
    }
    return out;
}

plugin.consumes = ['app', 'log', 'keys', 'cached'];
plugin.provides = ['github'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('github');
    var keys = imports.keys;

    //ONE DRAWER FOR EVERY GITHUB READ THERE WILL EVER BE, keyed on the host and
    //path together — a fingerprint from github.com means nothing to an
    //enterprise host and the key has to say which one it came from.
    var tags = imports.cached.byEtag('github');

    async function call(method, at, body, opts) {
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

        //---- and where it actually answers ------------------------------------
        //
        //A REPOSITORY THAT MOVED ACCOUNT ANSWERS 301 FOR EVER, and following one
        //costs a whole round trip to be told an address we were told last time.
        //Eleven of the twenty-six pull requests behind the PR Cuts tab are on
        //repositories that have moved, so a tab that made twenty-six requests was
        //making thirty-seven.
        //
        //`301` AND `308` ONLY. Those two are GitHub saying the thing lives
        //somewhere else now; `302` and `307` are "just this once" and remembering
        //one would pin a resource to a temporary address.
        //
        //REMEMBERED ON THE ORIGINAL KEY, so the next caller asking the old
        //address goes straight to the new one. It is still REPORTED as moved —
        //see the header: a read that quietly succeeds at a new address leaves
        //the record still naming the old one.
        //
        //AND IT CORRECTS ITSELF if the thing moves again: we go to the address we
        //remembered, GitHub answers 301 to the newest one, and that is followed
        //and remembered like any other.
        var mayKeep = !!SAFE[String(method).toUpperCase()] && o.fresh !== true && !o.from;
        var key = api + at;
        var send = at;
        var went = o.from || null;

        if (mayKeep) {
            var known = await tags.entry(key);
            if (known) {
                if (known.value && known.value.at && known.value.at !== at) {
                    send = known.value.at;
                    went = send;
                }
                if (known.etag) headers['if-none-match'] = known.etag;
            }
        }

        return new Promise(function (resolve, reject) {
            var req = https.request({
                host: api, path: send, method: method, headers: headers, timeout: 30000
            }, function (res) {
                var chunks = [];
                res.on('data', function (c) { chunks.push(c); });
                res.on('end', function () {
                    var text = Buffer.concat(chunks).toString('utf8');
                    var json = null;
                    //GitHub answers HTML for some errors.
                    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
                    var answer = { status: res.statusCode, headers: res.headers, body: json, text: text, movedTo: went };

                    //---- NOTHING HAS CHANGED, so the answer is the one we have -
                    if (mayKeep && res.statusCode === 304) {
                        var held = tags.still(key);
                        if (held !== undefined) {
                            return resolve({
                                status: 200,
                                //THE HEADERS THAT WERE KEPT, not the 304's own. A
                                //304 carries no `link` and no `content-type`, so
                                //handing its headers back would make a cached
                                //page look like the last page of a list.
                                headers: held.headers || {},
                                body: held.body,
                                text: held.text,
                                movedTo: went,
                                notModified: true
                            });
                        }

                        //A 304 FOR SOMETHING WE NO LONGER HAVE. The drawer wiped
                        //between sending the fingerprint and this arriving — it
                        //empties wholesale when it fills, so this is rare and
                        //real. Asked again without the fingerprint, because the
                        //alternative is handing back an empty answer that looks
                        //exactly like a pull request that vanished.
                        log.info('GitHub says ' + at + ' is unchanged, but what it was is no longer held — asking again in full');
                        return resolve(call(method, at, body,
                            Object.assign({}, o, { fresh: true })));
                    }

                    //A FINGERPRINT TO ASK WITH NEXT TIME. Only a 200: an error
                    //body is not an answer to keep, and a redirect is answered
                    //at its new address below.
                    if (mayKeep && res.statusCode === 200) {
                        tags.got(key, res.headers && res.headers.etag, {
                            body: json, text: text, headers: headersWorthKeeping(res.headers),
                            //WHERE IT ANSWERED, when that is not where we asked.
                            //Only kept when it differs, so an ordinary answer
                            //carries no field claiming it moved to itself.
                            at: send !== at ? send : null
                        });
                    }

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
                            var followed = call(method, next, body, { host: o.host, hops: hops + 1, from: next });

                            //---- AND THE MOVE IS REMEMBERED ON THE ADDRESS WE ASKED
                            //
                            //PERMANENT ONLY. `301` and `308` are GitHub saying the
                            //thing lives somewhere else now. `302` and `307` are
                            //"just this once", and writing one down would pin a
                            //resource to an address it was never promised at.
                            //
                            //ON THE OUTER KEY, WITH THE INNER ANSWER'S FINGERPRINT,
                            //so the next read goes straight to the new address AND
                            //carries the etag for it — one request instead of the
                            //two this hop costs. The follow itself does not keep
                            //anything (`o.from` turns that off), so the answer is
                            //held once and not twice.
                            var permanent = res.statusCode === 301 || res.statusCode === 308;
                            if (!mayKeep || !permanent) return resolve(followed);

                            return resolve(followed.then(function (r) {
                                if (r && r.status === 200) {
                                    tags.got(key, r.headers && r.headers.etag, {
                                        body: r.body, text: r.text,
                                        headers: headersWorthKeeping(r.headers),
                                        at: next
                                    });
                                }
                                return r;
                            }));
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

    //---- and not one at a time ---------------------------------------------
    //
    //THE FINGERPRINTS SAVED THE PAYLOAD AND THE TAB WAS STILL SLOW, which is the
    //failure ../core/cached/drawers.js warns about in its own header: the hit
    //rate was perfect and the timing did not move. Twenty-six pull requests read
    //one after another cost twenty-six round trips end to end, and a 304 crosses
    //the Atlantic exactly as slowly as a 200 does.
    //
    //SO THE BOUND LIVES HERE, WHERE THE RATE LIMIT IS KNOWN. A caller that wants
    //forty things from GitHub should not each invent a number, and the plugin
    //whose whole job is "the one place that talks to GitHub" is the one place
    //that can change it once.
    //
    //EIGHT, CHOSEN FOR LATENCY AND NOT FOR THE LIMIT. Five thousand an hour is
    //nowhere near the constraint; the constraint is that reads are serialised
    //behind each other for no reason. Eight turns twenty-six round trips into
    //four waves. Higher buys little and starts to look like something worth
    //rate-limiting from the other end.
    //
    //ORDER IS KEPT, because callers build lists people read and a board that
    //reshuffles itself by which request came back first is a board nobody can
    //follow.
    //
    //AND A FAILURE BEHAVES AS IT DID WHEN THIS WAS A LOOP: the first error is
    //raised. It is raised AFTER everything has settled rather than the moment it
    //happens, so the requests still in flight are not left as rejections nobody
    //is waiting on — which is the one way a `for` loop turned into a pool changes
    //behaviour without anybody asking for it.
    //THE MECHANISM IS ./many.js, so a test can use the real one — see its
    //header. The NUMBER is here, because how many at once is a judgement about
    //GitHub and belongs with the plugin that owns the connection.
    var many = Many(AT_ONCE);

    //---- is it any good ----------------------------------------------------
    //
    //THE ONLY PROOF IS ASKING GITHUB. A token is an opaque string; nothing about
    //its shape says whether it works, what it can do, or whether somebody
    //revoked it this morning. A file on disk is not a working credential.
    async function check() {
        //ASKED LIVE, ALWAYS. A revoked token still matches the fingerprint of
        //the answer it gave yesterday, so a cached `/user` would report a dead
        //credential as working — and this is the one call whose entire worth is
        //that it went and asked. The drill beside it says so in the log it
        //writes: "asked of GitHub just now, not read from the last time it was
        //checked."
        var r = await call('GET', '/user', null, { fresh: true });

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
            //ASKING FOR MANY THINGS AT ONCE, with the bound decided here rather
            //than by each caller. See above.
            many: many,
            check: check,
            apiHost: function () { return keys.github.apiHost(); }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
