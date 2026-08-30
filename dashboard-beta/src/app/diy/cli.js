//---------------------------------------------------------------------------
//how DIY's one action prints.
//
//IT NORMALLY PRINTS A REFUSAL, and that is worth printing well rather than as a
//stack. `openEditor` is a person's press at the window — see ./server.js — so
//the command line reaching for it is the ordinary case, not the exceptional one,
//and the answer somebody needs is where the button is.
//
//A refusal does not reach a printer at all: `okc.js` reports a thrown action as
//an error. So this is for the two ways it DOES answer — from the window, and
//from a drill — and both want the same three facts: what was opened, where, and
//whose key got it in.
//---------------------------------------------------------------------------

module.exports = {
    print: {
        openEditor: function (said) {
            if (!said || !said.opened) return 'Nothing was opened.';

            var out = [
                'opened  ' + said.opened,
                'on      ' + said.on + '   (' + said.user + '@' + said.address + ')',
                'editor  ' + (said.using || 'not recorded') + (said.found ? '   — ' + said.found : '')
            ];

            //THE KEY LINE ONLY WHEN IT IS NOT THIS APP'S, because a line that
            //says "yes, normal" on every ordinary answer is one nobody reads on
            //the day it says something else.
            if (!said.usesOurKey) {
                out.push('');
                out.push('  This machine was not built with this app\'s ssh key, so ssh used whatever');
                out.push('  identity it has by default. Keys -> this app\'s key says which that is.');
            }

            return out.join('\n');
        }
    }
};
