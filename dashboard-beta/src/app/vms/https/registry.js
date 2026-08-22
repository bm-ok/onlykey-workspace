//---------------------------------------------------------------------------
//WHAT A MACHINE MAY REACH, AND WHO SAYS SO.
//
//This is the door a guest knocks on. ../https owns the TRANSPORT — the
//certificate, the port, and turning `vm:token` into a machine record — and knows
//nothing whatever about jobs, supervisors, artifacts or git.
//
//EACH PLUGIN REGISTERS ITS OWN API, the same way one registers a pane with
//../../ui/shell, an action with ../../core/actions, or a job with
//../../core/cron. The plugin that owns the work owns the verbs for it, and owns
//the sentence about who may ask.
//
//---- why that is the shape rather than a router ---------------------------
//
//THE APP BEING PORTED FROM HAD ONE LONG if-CHAIN in its server file, and the
//rules about who may reach what were scattered through it: `/supervisor/*`
//refused a runner, `/git/*` refused a supervisor because a supervisor holds no
//repositories, and neither rule was written anywhere near the plugin it was
//about. Adding a verb meant editing a file that belonged to nobody.
//
//SO `may` COMES WITH THE API. A plugin says what a machine must be to reach its
//verbs, in its own words, beside the verbs — and this file is the one place that
//asks. A rule stated once, where the thing it is about lives.
//
//---- and the refusal is deliberately uninformative ------------------------
//
//A MACHINE IS NOT TOLD WHAT IT IS NOT. A runner asking for a supervisor verb
//gets the same answer as a machine with a bad token, because the alternative
//tells anything that reaches this port what shape of machine would have got in.
//The reason goes in the log, where a person reads it.
//---------------------------------------------------------------------------

//A ROUTE IS A METHOD AND A PATH, and paths are matched WHOLE or by one trailing
//star. There is no pattern language on purpose: `/git/*` is the only shape any
//caller has ever needed, and a router with parameters is a thing that grows
//rules nobody can enumerate — which for the surface a guest reaches is the wrong
//kind of flexible.
var STAR = '/*';

module.exports = function registry(deps) {
    var d = deps || {};
    var say = d.say || function () {
        var to = { info: function () {}, warn: function () {}, good: function () {}, bad: function () {}, on: function () { return to; } };
        return to;
    };

    var apis = [];

    //---- registering one ---------------------------------------------------
    function api(spec) {
        var it = spec || {};
        var name = String(it.name || '').trim();

        if (!name) throw new Error('An API a machine can reach needs a name, so a refusal can say which one.');
        if (apis.some(function (a) { return a.name === name; })) {
            throw new Error('"' + name + '" is already registered. Two plugins claiming one API is two answers '
                + 'to what a machine may do with it.');
        }

        //`may` IS NOT OPTIONAL, and defaulting it to "anyone" would be the
        //worst possible default: a plugin that forgot to say who may reach its
        //verbs would open them to every machine on the host, silently, and the
        //omission would look exactly like a decision.
        if (typeof it.may !== 'function') {
            throw new Error('"' + name + '" must say which machines may reach it. Pass `may(vm)` — '
                + 'a plugin that does not say would be opening its verbs to every machine on this host.');
        }

        var routes = (it.routes || []).map(function (r) {
            var method = String(r.method || 'GET').toUpperCase();
            var path = String(r.path || '');
            if (!path || path.charAt(0) !== '/') {
                throw new Error('"' + name + '" has a route with no path. They start with a slash.');
            }
            if (typeof r.run !== 'function') {
                throw new Error('"' + name + '" has a route with nothing to run: ' + method + ' ' + path);
            }
            return { method: method, path: path, run: r.run, about: r.about || '' };
        });

        if (!routes.length) throw new Error('"' + name + '" registers no routes, so nothing can reach it.');

        var one = { name: name, may: it.may, routes: routes, about: it.about || '' };
        apis.push(one);
        say('https').info(name + ' is reachable by a machine: ' + routes.length + ' route(s)');

        //HANDED BACK SO IT CAN BE TAKEN AWAY. The node bundle is rebuilt on every
        //save, and an API registered twice is two handlers for one path — see
        //what ../../core/cron hands back for the same reason.
        return function () {
            var at = apis.indexOf(one);
            if (at >= 0) apis.splice(at, 1);
        };
    }

    //---- finding the one that answers --------------------------------------
    //
    //FIRST REGISTERED WINS, and a collision is reported rather than resolved. Two
    //plugins claiming one path is a fault in the app, not a routing question, and
    //quietly preferring one of them is how it stays a fault for months.
    function match(method, path) {
        var want = String(method || 'GET').toUpperCase();
        var where = String(path || '');
        var hits = [];

        apis.forEach(function (a) {
            a.routes.forEach(function (r) {
                if (r.method !== want) return;
                var got = r.path.slice(-STAR.length) === STAR
                    ? where.indexOf(r.path.slice(0, -1)) === 0
                    : where === r.path;
                if (got) hits.push({ api: a, route: r });
            });
        });

        if (hits.length > 1) {
            say('https').warn(want + ' ' + where + ' is claimed by ' + hits.length + ' apis: '
                + hits.map(function (h) { return h.api.name; }).join(', ')
                + ' — the first is answering, and that is a fault rather than a preference');
        }

        return hits[0] || null;
    }

    //---- and whether this machine may have it ------------------------------
    //
    //THE ANSWER IS YES OR NO AND NOTHING ELSE. A machine is never told what it
    //is not: a runner asking for a supervisor verb gets the same answer as a
    //machine with a bad token, because anything more tells whatever reached this
    //port what shape of machine would have got in.
    function allowed(hit, vm) {
        if (!hit) return false;
        try {
            return hit.api.may(vm) === true;
        } catch (e) {
            //A `may` THAT THREW IS A NO. It is a rule about who may reach real
            //verbs on real machines, and a rule that could not be evaluated has
            //not been satisfied.
            say('https', hit.api.name).bad('could not decide whether ' + ((vm && vm.name) || 'a machine')
                + ' may reach it, so it may not: ' + e.message);
            return false;
        }
    }

    //WHAT IS REACHABLE, for a person looking at the app rather than for anything
    //that runs. Never served to a machine: the list of what exists is exactly
    //what a refusal declines to give.
    function list() {
        return apis.map(function (a) {
            return {
                name: a.name,
                about: a.about,
                routes: a.routes.map(function (r) { return r.method + ' ' + r.path; })
            };
        });
    }

    return { api: api, match: match, allowed: allowed, list: list };
};
