var https = require('node:https');
var Many = require('./many');
var Paged = require('./paged');

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

//HOW MANY PAGES OF ONE LIST THIS WILL READ BEFORE STOPPING AND SAYING SO.
//
//TWENTY IS TWO THOUSAND ROWS at a hundred a page, which covers every tracker
//anybody here is likely to attach and still bounds what one repository can spend
//of an hourly budget shared by all of them. A sweep of ten places must not be
//able to disappear into the first one.
//
//THE NUMBER IS HERE AND THE MECHANISM IS IN ./paged.js, the same split as
//AT_ONCE above: how much is too much is a judgement about GitHub and belongs
//with the plugin that owns the connection.
//
//AND HITTING IT IS NOT SILENT -- see ./paged.js. A cap nobody is told about is
//the same defect as not paging at all, wearing better clothes.
var MOST_PAGES = 20;

//HOW MUCH OF THE HOURLY BUDGET IS NOT THE CRAWLER'S TO SPEND.
//
//THE BUDGET IS PER TOKEN AND SHARED BY EVERYTHING. A sweep of ten repositories
//and a person pressing a button go through the same five thousand an hour, and
//the sweep is the one that runs unattended -- so the sweep is the one that has
//to leave room. Without a floor the first interactive action after a big sweep
//is the one that gets refused, which reads as the app being broken rather than
//as the crawler having eaten everything.
//
//FIVE HUNDRED IS ROOM FOR A WORKING SESSION. Opening a pull request, reading a
//few branches, checking a token -- tens of requests, with margin. It is not
//tuned; it is chosen to be obviously enough, because the cost of it being too
//large is a sweep that finishes next tick instead of this one.
var KEEP_BACK = 500;

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

    //---- WHAT GITHUB LAST SAID ABOUT THE BUDGET --------------------------
    //
    //EVERY RESPONSE CARRIES IT, so knowing how much is left costs nothing --
    //which matters, because the obvious way to find out is to ask `/rate_limit`
    //and that is a request made to find out whether to make requests.
    //
    //TAKEN FROM THE LIVE RESPONSE AND NOT FROM THE DRAWER. A 304 is turned back
    //into a 200 below using the headers that were KEPT, and those are last
    //week's -- so reading the budget off the answer a caller gets would report a
    //number from whenever that page was first fetched. It is read here, once,
    //before that conversion, which is also why a 304 updates it correctly: the
    //remaining count is real even though nothing was charged.
    var budget = { limit: null, left: null, resets: null, at: null };

    function noteBudget(headers) {
        if (!headers) return;
        var left = headers['x-ratelimit-remaining'];
        if (left == null) return;
        budget.left = Number(left);
        budget.limit = headers['x-ratelimit-limit'] == null ? budget.limit : Number(headers['x-ratelimit-limit']);
        //SECONDS SINCE THE EPOCH, which is what GitHub sends. Kept as an ISO
        //string as well, because the number is unreadable in a pane and the
        //question somebody asks is "when does this come back".
        var when = headers['x-ratelimit-reset'];
        budget.resets = when == null ? budget.resets : new Date(Number(when) * 1000).toISOString();
        budget.at = new Date().toISOString();
    }

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

                    //BEFORE ANYTHING ELSE, INCLUDING THE 304 PATH BELOW, which
                    //returns headers that were kept rather than these.
                    noteBudget(res.headers);

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

    //READING A WHOLE LIST RATHER THAN THE FIRST HUNDRED OF IT. Nothing in this
    //app followed the `link` header until now: a tracker with five hundred open
    //issues answered with a hundred and was reported as a hundred, because from
    //inside one request a full page and a last page look identical.
    var all = Paged(call, MOST_PAGES);

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
            //---- WHAT IS LEFT OF THE HOUR ----------------------------------
            //
            //REPORTED BECAUSE IT IS THE THING THE FINGERPRINTS ARE FOR. GitHub
            //allows five thousand an hour and does not charge a `304` against
            //it at all, so "how much of the hour has this app spent" is the
            //measurement that says whether the caching above is working —
            //separately from how fast a pane feels, which is latency and a
            //different question.
            //
            //IT IS ALSO THE ONLY WAY TO SEE THE FAILURE THAT MATTERS. A cache
            //that quietly stopped sending `If-None-Match` would look exactly
            //like this one from the outside: same answers, same panes, same
            //speed to a human — and a quota draining twenty-six at a time.
            limit: r.headers['x-ratelimit-limit'] == null ? null : Number(r.headers['x-ratelimit-limit']),
            left: r.headers['x-ratelimit-remaining'] == null ? null : Number(r.headers['x-ratelimit-remaining']),
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
        //---- WHO A NAME ACTUALLY BELONGS TO ---------------------------------
        //
        //FOR NAMING SOMEBODY WHOSE WORDS MAY BE READ AS A REQUEST — see
        //./trust.js and Settings. Typing a login into a box and hoping is how a
        //typo becomes a trusted stranger: `bmatusiakk` is available, and looks
        //right at a glance in a list.
        //
        //THE ID IS THE PART THAT MATTERS, and it is why this returns one. A
        //login can be CHANGED and the old one taken by somebody else, so a list
        //of names is a list that can quietly come to mean different people. The
        //numeric id never changes and is never reissued.
        //
        //THE PICTURE AND THE NAME ARE FOR THE PERSON, not for the check. What
        //stops a lookalike is seeing the wrong face beside the right-looking
        //name, which no comparison here can do.
        undo.push(actions.define('githubWho', {
            about: 'Who a GitHub login belongs to: the account, its id, and its picture, so a name can be confirmed before it is trusted',
            takes: ['login'],
            run: async function (args) {
                var want = String((args || {}).login == null ? '' : (args || {}).login).trim();
                if (!want) throw new Error('Say which login to look up.');

                //A LOGIN AND NOT A PATH. It is joined to a URL, and a name with
                //a slash in it would ask about something else entirely.
                if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(want)) {
                    throw new Error('"' + want + '" is not a GitHub login. They are letters, numbers and '
                        + 'single dashes, up to 39 characters.');
                }

                var got = await call('GET', '/users/' + want);
                if (got.status === 404) {
                    throw new Error('GitHub has no account called "' + want + '". A name that does not exist '
                        + 'cannot be trusted, and one letter out is somebody else.');
                }
                if (got.status !== 200 || !got.body) {
                    throw new Error('GitHub would not say who "' + want + '" is: ' + got.status + '.');
                }

                return {
                    login: got.body.login,
                    id: got.body.id,
                    name: got.body.name || null,
                    kind: got.body.type || null,
                    avatar: got.body.avatar_url || null,
                    url: got.body.html_url || null,
                    since: got.body.created_at || null,
                    //SAID RATHER THAN LEFT TO BE NOTICED. GitHub answers for an
                    //organisation on the same path, and an organisation does not
                    //write comments — so trusting one traps nothing and looks
                    //like it worked.
                    note: got.body.type === 'User'
                        ? 'Confirm the picture and the name are who you mean before trusting it. What is kept '
                            + 'is the id (' + got.body.id + '), which never changes — a login can be renamed '
                            + 'and the old one taken by somebody else.'
                        : (function () {
                            var kind = String(got.body.type || 'account').toLowerCase();
                            return 'That is ' + (/^[aeiou]/.test(kind) ? 'an ' : 'a ') + kind + ', not a person. '
                                + 'Comments are written by people, so trusting this would trust nobody.';
                        }())
                };
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
            //WHAT IS LEFT OF THE HOUR, from the last answer rather than from
            //a request made to find out. `spare()` is the question a sweep
            //actually asks: is there room to go on without eating the margin a
            //person needs. Null when nothing has been asked yet -- which reads
            //as "go ahead", because refusing to start on no information would
            //make a cold app unable to do anything.
            budget: function () { return Object.assign({}, budget, { keepBack: KEEP_BACK }); },
            spare: function () { return budget.left == null || budget.left > KEEP_BACK; },
            //AND ASKING FOR ALL OF SOMETHING rather than the first page of it.
            //Answers `{ items, pages, more, why }`; `more` is true when the list
            //is longer than what came back, and `why` is the sentence to print.
            all: all,
            check: check,
            apiHost: function () { return keys.github.apiHost(); }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
