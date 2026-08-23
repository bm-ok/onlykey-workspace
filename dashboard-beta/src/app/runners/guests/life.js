//---------------------------------------------------------------------------
//HOW LONG A STORED SIGN-IN HAS LEFT, WITHOUT USING IT.
//
//FREE, INSTANT, AND NEEDS NO MACHINE — which is the whole point. The alternative
//was booting one, handing the credential over, and watching a worker fail.
//
//---- two clocks, and confusing them is the whole difficulty -----------------
//
//  the access token   short-lived, hours. EXPIRED IS ITS NORMAL STATE — Claude
//                     Code refreshes it whenever it needs to, so an expired one
//                     says nothing at all about whether the credential works.
//  the refresh token  weeks. THIS is the one that matters: when it goes, the
//                     credential is dead and only a person at a sign-in page can
//                     replace it.
//
//SO `usable` IS NEVER `true`. A live refresh token means "not known to be dead",
//and that is a different claim from "this works" — a refresh ROTATES the token,
//so one grabbed off a machine that has refreshed since is already superseded.
//Three states and the middle one is the honest answer for most credentials:
//
//    false   the refresh token has expired. Certain, and unrecoverable.
//    null    nothing can be told from here.
//
//TIMESTAMPS ONLY. No token is returned by this or anything that calls it — a
//window that can show a secret is a window that ends up in a screenshot, and
//this app's panes are photographed on purpose several times a day.
//---------------------------------------------------------------------------

module.exports = function life(deps) {
    var d = deps || {};

    var read = d.read;        //(file) -> the decrypted bytes
    var statOf = d.statOf;    //(file) -> { mtimeMs, size } or null

    //---- CACHED AGAINST THE FILE ITSELF ----------------------------------
    //
    //This is asked on a draw loop, and reading it means unsealing. Keyed on
    //mtime AND size so a file rewritten within the same millisecond is still a
    //different file.
    var cache = new Map();

    function of(file) {
        var stamp = null;
        var st = null;
        try { st = statOf(file); } catch (e) { st = null; }
        if (st) stamp = st.mtimeMs + ':' + st.size;

        var oauth = null;
        var had = stamp ? cache.get(file) : null;

        if (had && had.stamp === stamp) {
            oauth = had.oauth;
        } else {
            try {
                var parsed = JSON.parse(read(file).toString('utf8'));
                oauth = parsed.claudeAiOauth || parsed;
                if (stamp) cache.set(file, { stamp: stamp, oauth: oauth });
            } catch (e) {
                //NOT CACHED. A file that could not be read may be MID-WRITE, and
                //remembering "unreadable" against an mtime would keep saying so
                //after it became readable at the same mtime — which happens when
                //a write finishes inside one millisecond.
                return {
                    readable: false,
                    why: 'the stored credential could not be read or is not the shape this knows'
                };
            }
        }

        var at = Number(oauth.expiresAt) || null;
        var refresh = Number(oauth.refreshTokenExpiresAt) || null;
        var now = Date.now();

        return {
            readable: true,

            //NON-SECRET FACTS ABOUT THE ACCOUNT, useful for telling two apart.
            plan: oauth.subscriptionType || null,
            scopes: Array.isArray(oauth.scopes) ? oauth.scopes.length : null,

            access: at
                ? { at: new Date(at).toISOString(), left: at - now, expired: at <= now }
                : null,
            refresh: refresh
                ? { at: new Date(refresh).toISOString(), left: refresh - now, expired: refresh <= now }
                : null,

            //THE ONLY CERTAIN ANSWER AVAILABLE FROM A CLOCK.
            usable: refresh ? (refresh > now ? null : false) : null,

            why: !refresh
                ? 'it does not say when its refresh token expires, so nothing can be told from here'
                : refresh <= now
                    ? 'its refresh token has expired — this credential cannot be recovered, only replaced'
                    : 'its refresh token has not expired, which is not the same as it working: a refresh '
                        + 'rotates the token, so one grabbed from a machine that refreshed since is '
                        + 'already superseded'
        };
    }

    return { of: of };
};
