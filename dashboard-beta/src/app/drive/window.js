//---------------------------------------------------------------------------
//the page half of the driver: find what is on screen, and press it.
//
//See ./server.js for why this exists and what shuts it. This half does no
//checking of its own — by the time anything arrives here it has been through
//the gate, and a second opinion about whether it may run is the second set of
//rules.
//
//VISIBLE ONLY, which is what makes "what is on screen" answerable at all.
//`offsetParent` is null for anything `display: none`, and that is the whole
//filter. It matters less here than in the old window, where every pane was in
//the document the whole time and hidden with CSS — this shell mounts one tab at
//a time — but `.pane` is still display:none without `.active`, and a dialog
//still covers everything behind it.
//
//A DIALOG TAKES THE WHOLE SCREEN when one is open, because it is modal: nothing
//behind it can be pressed by a person either, and offering it would be offering
//something that does not work.
//---------------------------------------------------------------------------

plugin.consumes = ['okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var io = imports.okc.io;
    if (!io) return register(null, {});

    var seen = function (n) { return !!n.offsetParent; };
    var words = function (n) { return (n.textContent || '').replace(/\s+/g, ' ').trim(); };

    //A BUTTON'S WORDS, WITH ITS PIECES KEPT APART. A chip is a word and a count
    //in two elements with no space between them, so plain textContent gave
    //"running0" — which is not what is on the screen, and this answer's whole
    //job is telling somebody what to type. Joining the children with a space
    //and collapsing after leaves an ordinary button's text untouched.
    var btnWords = function (n) {
        return [].slice.call(n.childNodes)
            .map(function (c) { return c.textContent || ''; })
            .join(' ').replace(/\s+/g, ' ').trim();
    };

    //The same, minus anything that is itself pressable. A card's title carries a
    //settings cog and a badge or two; a name with a cog stuck on the end matches
    //nothing anybody would type, and reads in the answer like a mistake.
    var cardWords = function (n) {
        return [].slice.call(n.childNodes)
            .filter(function (c) {
                return !(c.nodeType === 1 && (c.tagName === 'BUTTON' || c.classList.contains('badge')));
            })
            .map(function (c) { return (c.textContent || '').replace(/\s+/g, ' '); })
            .join(' ').replace(/\s+/g, ' ').trim();
    };

    //WHERE THIS PRESS IS HAPPENING, read off the markup rather than from the
    //shell's own state. Two reasons: this plugin then knows nothing about the
    //shell, and what it reports is what is actually on the screen rather than
    //what something believes should be.
    function region() {
        var dlg = document.querySelector('.dlg-overlay .dlg');
        if (dlg) return { where: 'the open dialog', node: dlg, dialog: true };
        var tab = document.querySelector('.tab.active');
        var pane = document.querySelector('.subtab.active');
        return {
            where: (tab ? words(tab) : '?') + (pane ? '/' + words(pane) : ''),
            node: document.body,
            dialog: false
        };
    }

    //The label a field goes by, in the words on the screen. A <label> sits
    //immediately before its input wherever there is one; the placeholder is the
    //fallback, because a field with no label still has to be nameable.
    function labelOf(n) {
        var prev = n.previousElementSibling;
        if (prev && prev.tagName === 'LABEL') return words(prev);
        //A checkbox is inside its label rather than after it — the label reads
        //as an unlabelled square otherwise. So look up as well as back.
        var up = n.closest('label');
        if (up) return words(up);
        return n.placeholder || '';
    }

    //ONE MATCH OR A REFUSAL, never the first of several.
    //
    //Picking the first would work most of the time and be wrong silently the
    //rest, which is the worst available behaviour for something whose whole job
    //is to find out whether the window does what it says. Being told that a word
    //matches four things, with the list, is the useful answer; `nth` is how you
    //then say which.
    function theOne(all, text, nth, kind) {
        var want = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!want) throw new Error('Say which ' + kind + ', by the words on it. Ask for windowControls to see what is there.');
        var exact = all.filter(function (x) { return x.label.toLowerCase() === want; });
        var some = exact.length ? exact : all.filter(function (x) { return x.label.toLowerCase().indexOf(want) >= 0; });
        if (!some.length) {
            throw new Error('There is no ' + kind + ' reading "' + text + '" on screen. What is there: ' +
                (all.map(function (x) { return '"' + x.label + '"'; }).join(', ') || 'nothing') + '.');
        }
        if (some.length > 1 && nth == null) {
            throw new Error('"' + text + '" matches ' + some.length + ' of them: ' +
                some.map(function (x, i) { return (i + 1) + '. "' + x.label + '"'; }).join(', ') + '. Say which with --nth.');
        }
        var at = nth == null ? 0 : Number(nth) - 1;
        if (!some[at]) throw new Error('There is no ' + (at + 1) + ' — "' + text + '" matches ' + some.length + '.');
        return some[at];
    }

    function look(r) {
        //BUTTONS, AND THE CARDS THAT ARE ALSO BUTTONS.
        //
        //Half of this window is chosen rather than pressed: a machine, a task, a
        //line, a cut. Those are cards with a click handler and the class `pick`,
        //and without this they do not exist to the driver — so a machine could
        //be started, stopped and released from the command line and could not be
        //SELECTED, and every check that needed a particular one would have to
        //arrange for it to be first in the list. That is arranging the world to
        //suit the instrument.
        //
        //Marked as a pick rather than a button so the answer still says which is
        //which: pressing "Stop it" and choosing "kit-1" are different acts and
        //should not read the same in a log.
        var buttons = [].slice.call(r.node.querySelectorAll('button')).filter(seen)
            .map(function (n) {
                return {
                    node: n, label: btnWords(n), disabled: !!n.disabled, why: n.title || '',
                    //NAVIGATION IS NOT AN ACT. A tab, a sub-tab, a tab inside a
                    //dialog — pressing one changes what is being looked at and
                    //nothing else, which is why `show` is allowed to do it with
                    //no gate at all. Marked so the guards pane can leave them
                    //out: eleven tabs listed as things somebody might want to
                    //guard is eleven rows of noise in front of the two that
                    //matter.
                    nav: n.classList.contains('tab') || n.classList.contains('subtab')
                        || n.classList.contains('dlg-tab')
                        //A CHIP IS A FILTER, which is the same kind of thing as
                        //a tab: it changes what is being LOOKED AT and nothing
                        //else. The guards pane listing its own "guarded 0" and
                        //"open 3" chips as things somebody might want to guard
                        //was how this became obvious.
                        || n.classList.contains('chip'),
                    //PURPLE MEANS A PERSON PRESSES IT. Carried into the answer
                    //so a list of buttons says which are mine to press and which
                    //are not, rather than that only being found out by trying.
                    protected: n.classList.contains('protected')
                };
            })
            .concat([].slice.call(r.node.querySelectorAll('.pick')).filter(seen)
                .map(function (n) {
                    return {
                        node: n,
                        label: cardWords(n.querySelector('.card-title') || n),
                        picks: true,
                        disabled: false,
                        why: n.classList.contains('on') ? 'already chosen' : 'choose it'
                    };
                })
                .filter(function (x) { return x.label; }));

        var fields = [].slice.call(r.node.querySelectorAll('input, select, textarea')).filter(seen)
            .map(function (n) {
                //A PROTECTED FIELD'S VALUE NEVER LEAVES THE PAGE.
                //
                //The operator's rule: what was done in here is knowable and what
                //was typed is not. A token, an ssh key, a password. The label,
                //the kind and whether there is anything in it are all reportable
                //— "is it set" is a real question somebody has to be able to
                //answer — and the value is not.
                var shut = n.classList.contains('protected');
                return {
                    node: n,
                    label: labelOf(n),
                    kind: n.type === 'checkbox' ? 'checkbox' : n.tagName.toLowerCase(),
                    protected: shut,
                    value: shut ? null : (n.type === 'checkbox' ? n.checked : n.value),
                    //Emptiness is not the secret. Without this, "is the token
                    //set" is unanswerable from here and somebody goes looking
                    //for it somewhere that does show it.
                    filled: shut ? !!n.value : undefined,
                    //A SELECT'S OPTIONS ARE ITS VALUES. Listing them for a
                    //protected one hands over the answer with extra steps.
                    options: n.tagName === 'SELECT' && !shut
                        ? [].slice.call(n.options).map(function (o) { return o.textContent.trim(); })
                        : null
                };
            });

        return { buttons: buttons, fields: fields };
    }

    var strip = function (x) { var y = Object.assign({}, x); delete y.node; return y; };

    async function run(want) {
        var r = region();
        var got = look(r);

        if (want.do === 'controls') {
            return {
                on: r.where,
                dialog: r.dialog,
                //IS IT STILL COMING? A skeleton on the screen is the pane saying
                //"this is a list and it is on its way", and it is the difference
                //between "there is nothing here" and "nothing has arrived yet"
                //— two answers this app has already confused three times, in
                //three different panes.
                //
                //Reported rather than inferred. Anything reading this from
                //outside would otherwise have to guess from an empty list, which
                //is exactly the guess that goes wrong.
                loading: !![].slice.call(document.querySelectorAll('.skel'))
                    .filter(seen)
                    //A SPECIMEN IS NOT A WAIT. The Kit pane exhibits a skeleton
                    //so the look of one can be reviewed beside everything else,
                    //and counting it made the catalogue read as permanently
                    //loading.
                    .filter(function (n) { return !n.closest('[data-sample]'); })
                    .length,
                //THE TITLE TOO, because a dialog is a question and the question
                //is the point. Reading back "there is a dialog with a Stop it
                //button" and not what it is about is how the wrong thing gets
                //confirmed.
                asking: r.dialog ? words(document.querySelector('.dlg-title')) : null,
                buttons: got.buttons.map(strip),
                fields: got.fields.map(strip)
            };
        }

        if (want.do === 'fill') {
            var f = theOne(got.fields, want.label, want.nth, 'field');

            //A PROTECTED FIELD IS NEITHER READ NOR WRITTEN FROM HERE.
            //
            //Withholding the value and allowing the write was the half-measure,
            //and it was wrong twice over. Writing a secret means something other
            //than the person choosing what it is — and a value written is a
            //value known, so writing is a way of learning that does not look
            //like reading. The token, the key, the password: they are typed by
            //the person whose they are, at the window, and nowhere else.
            //
            //It still APPEARS in windowControls, with its label and whether
            //anything is in it. "Is the token set" has to be answerable, and it
            //is not the secret.
            if (f.protected) {
                throw new Error('"' + f.label + '" is protected, which is what the purple outline says: ' +
                    'nothing here may read it or write it. A value written from here is a value known from here. ' +
                    'It is typed at the window by the person whose it is.');
            }

            var before = f.kind === 'checkbox' ? f.node.checked : f.node.value;

            if (f.kind === 'checkbox') {
                f.node.checked = !(want.value === false || want.value === 'false' || want.value === '' || want.value === '0');
            } else {
                f.node.value = want.value == null ? '' : String(want.value);
                //A SELECT ONLY TAKES WHAT IT HAS. Assigning a value it has no
                //option for leaves it empty, which reads as a real choice —
                //"none" is a real answer in half the dropdowns here — so it is
                //checked rather than reported as done.
                if (f.kind === 'select' && f.node.value !== String(want.value == null ? '' : want.value)) {
                    f.node.value = before;
                    throw new Error('"' + f.label + '" has no option "' + want.value + '". It offers: ' +
                        f.options.map(function (o) { return '"' + o + '"'; }).join(', ') + '.');
                }
            }

            //THE EVENTS A PERSON'S TYPING RAISES, because that is what React is
            //listening for. Setting `.value` alone raises neither, so a filled
            //form looks right on screen and is empty everywhere it matters.
            //
            //AND REACT NEEDS MORE THAN THAT. It keeps its own copy of the value
            //on the DOM node and skips the change when its copy already matches
            //what was assigned — so the native setter has to be called, past the
            //property React installed, or the field reverts on the next render.
            var proto = f.node instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype
                : f.node instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, f.kind === 'checkbox' ? 'checked' : 'value');
            if (setter && setter.set) {
                setter.set.call(f.node, f.kind === 'checkbox' ? f.node.checked : f.node.value);
            }
            f.node.dispatchEvent(new Event('input', { bubbles: true }));
            f.node.dispatchEvent(new Event('change', { bubbles: true }));

            return {
                on: r.where, filled: f.label, was: before,
                now: f.kind === 'checkbox' ? f.node.checked : f.node.value
            };
        }

        if (want.do === 'click') {
            var b = theOne(got.buttons, want.text, want.nth, 'button');

            //SAYING WHICH ONE, WITHOUT PRESSING IT.
            //
            //Matching is by the words on the button, so the thing to be sure of
            //is that your words picked the button you meant — and the only way
            //to find out was to press it. Ambiguity already refuses; this is the
            //other half, an UNambiguous match that is unambiguously the wrong
            //button.
            if (want.dry) {
                return {
                    on: r.where, would: b.label, picks: !!b.picks,
                    disabled: b.disabled, why: b.why || null,
                    protected: !!b.protected,
                    note: b.protected
                        ? "Nothing was pressed, and nothing here can press it: this one is a person's."
                        : 'Nothing was pressed. Run it again without --dry to press it.'
                };
            }

            //A PERSON PRESSES THIS ONE, AND THAT IS THE WHOLE FEATURE.
            //
            //Testing mode being on says the window may be driven; it does not
            //say every press in it may be a model's. Send it, merge it, allow
            //this to be judged, approve a prompt — the point of those buttons is
            //that somebody read the thing and decided, and a driven press is
            //indistinguishable from a person's once it reaches the handler. So
            //this is where the difference has to be made, and it is made by
            //refusing rather than by anybody remembering.
            //
            //Refused even in testing mode, and refused for --dry's benefit too:
            //--dry still names it, so the button can be FOUND from here and
            //cannot be pressed from here.
            if (b.protected) {
                throw new Error('"' + b.label + '" is a person\'s press. It is marked protected, which is what the purple says: ' +
                    'the point of this button is that somebody read what it is about and decided. Testing mode does not open it.');
            }

            //REFUSED RATHER THAN PRESSED AND IGNORED. A disabled button does
            //nothing when clicked, so driving one would report success and
            //change nothing — and half the buttons here are deliberately
            //disabled with the reason in their title, which is exactly what
            //somebody testing wants to read.
            if (b.disabled) {
                throw new Error('"' + b.label + '" is disabled' + (b.why ? ': ' + b.why : ' and says no reason') + '.');
            }

            b.node.click();
            //Long enough for what the press caused to have happened — a dialog
            //to open, a pane to switch, a read to come back. Said as a duration
            //for the same reason the screenshot's wait is: the work is
            //asynchronous and there is no count of frames that means "done".
            await new Promise(function (r2) { setTimeout(r2, 600); });

            var after = region();
            var out = { on: r.where, now: after.where };
            out[b.picks ? 'chose' : 'clicked'] = b.label;
            //WHERE IT LANDED, because that is the assertion. A click meant to
            //open a dialog and did not is the failure being looked for, and it
            //is invisible in "clicked: ok".
            out.asking = after.dialog ? words(document.querySelector('.dlg-title')) : null;
            return out;
        }

        throw new Error('"' + want.do + '" is not something that can be done to the window.');
    }

    function onDrive(want, say) {
        run(want).then(say, function (e) { say({ error: e.message }); });
    }
    io.on('drive:do', onDrive);

    await register(null, {
        onDestroy: function () { io.off('drive:do', onDrive); }
    });
}
module.exports = plugin;
