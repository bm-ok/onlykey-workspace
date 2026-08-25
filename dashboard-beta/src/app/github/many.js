//---------------------------------------------------------------------------
//asking GitHub for a lot of things without asking for them one at a time.
//
//THE FINGERPRINTS SAVED THE PAYLOAD AND THE TAB WAS STILL SLOW. That is the
//failure ../core/cached/drawers.js warns about in its own header — the hit rate
//was perfect and the timing did not move — and the reason is that a 304 crosses
//the network exactly as slowly as a 200 does. Twenty-six pull requests read in a
//`for` loop with an `await` in it cost twenty-six round trips end to end,
//whatever comes back in them.
//
//---- why this is a file and not four lines inside ./server.js -------------
//
//BECAUSE A TEST HAS TO BE ABLE TO USE THE REAL ONE. The stand-in GitHub in
//../../../test/repositories/prcuts.test.js has to offer `many`, and a stand-in
//that carried its own copy would be a stub easier to satisfy than the thing it
//stands for: a sequential version passes every check a pooled one does, so the
//tests would go on passing on the day this stopped being concurrent. This app
//has already shipped one of those.
//
//SO THE MECHANISM IS HERE AND THE NUMBER IS IN ./server.js. How many at once is
//a judgement about GitHub, and it belongs with the plugin that owns the
//connection; what a pool IS belongs somewhere both a caller and a test can
//reach.
//
//---- what it promises -----------------------------------------------------
//
//ORDER IS KEPT. Callers build lists people read down, and a board that
//reshuffles itself by which request came back first is a board nobody can
//follow. Results land at their own index rather than being pushed.
//
//A FAILURE BEHAVES AS IT DID WHEN THIS WAS A LOOP: the first one is raised. It
//is raised AFTER everything has settled rather than the moment it happens, so
//nothing still in flight is left as a rejection nobody is waiting on — which is
//the one way a `for` loop turned into a pool changes behaviour without anybody
//having asked for it.
//
//`first` IS BY POSITION IN THE LIST AND NOT BY WHEN IT FAILED. In a loop the
//error a caller saw was the earliest item that could not be done, and which
//request happens to come back first is not something a caller should start
//depending on.
//---------------------------------------------------------------------------

module.exports = function Many(atOnce) {
    var most = Number(atOnce);
    if (!(most > 0)) throw new Error('a pool needs to know how many at once, and "' + atOnce + '" is not a number of things');

    return async function many(items, doIt) {
        var list = items || [];
        if (!list.length) return [];

        var out = new Array(list.length);
        var failed = null;
        var failedAt = -1;
        var next = 0;

        async function worker() {
            for (;;) {
                var i = next++;
                if (i >= list.length) return;
                try {
                    out[i] = await doIt(list[i], i);
                } catch (e) {
                    if (failedAt < 0 || i < failedAt) { failed = e; failedAt = i; }
                }
            }
        }

        var going = [];
        for (var w = 0; w < Math.min(most, list.length); w++) going.push(worker());
        await Promise.all(going);

        if (failed) throw failed;
        return out;
    };
};
