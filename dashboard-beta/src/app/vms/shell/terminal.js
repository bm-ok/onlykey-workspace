//---------------------------------------------------------------------------
//WHAT A TERMINAL WAS SENT, TURNED BACK INTO TEXT.
//
//A pty does not return text. It returns DRAWING INSTRUCTIONS — what a terminal
//would have been asked to do — and anything scraped out of one has to be read
//back through that.
//
//THE ONE THAT ACTUALLY MATTERS HERE IS OSC 8, the hyperlink. It carries the
//address inside an escape sequence and then prints it AGAIN as the visible text.
//Left in, a URL arrives wrapped in escapes and doubled end to end:
//
//    ESC]8;;https://…BEL https://… ESC]8;;BEL
//
//WHICH LOOKS APPROXIMATELY RIGHT, and that is worse than looking wrong. It
//cannot be clicked, pasted or opened, and the reason is invisible in the middle
//of a long query string — so the failure reads as the sign-in being broken.
//
//BESIDE ./quoting.js RATHER THAN INSIDE A PLUGIN for the same reason: a pty is
//how ../auth reads a sign-in, and anything else that ever scrapes one will want
//this rather than a second copy of it.
//---------------------------------------------------------------------------

//BUILT RATHER THAN TYPED. A literal escape in a source file is invisible in a
//diff, survives a build, and is exactly what test/rules/bytes.test.js exists to
//catch — see the note in CLAUDE.md about this project's own backslash traps.
var ESC = String.fromCharCode(27);
var BEL = String.fromCharCode(7);

//THE TERMINATOR IS EITHER BEL OR ESC-BACKSLASH, and both are in use: xterm's
//original was BEL, the standard is ST. A stripper that knew only one leaves half
//the sequences in, which is the shape that produces almost-right output.
var END = '(?:' + BEL + '|' + ESC + '\\\\)';

var HYPERLINK = new RegExp(ESC + '\\]8;;[^' + BEL + ESC + ']*' + END, 'g');
var OSC = new RegExp(ESC + '\\][^' + BEL + ESC + ']*' + END, 'g');
var CSI = new RegExp(ESC + '\\[[0-9;?]*[ -\\/]*[@-~]', 'g');
var CHARSET = new RegExp(ESC + '[()][0-9A-B]', 'g');

//A RANGE OF CONTROL CHARACTERS, BUILT. Typing them puts real control bytes
//in this file — the first draft of this line did exactly that, six of them
//including a NUL, and `file` reported the source as binary.
function range(a, b) { return String.fromCharCode(a) + '-' + String.fromCharCode(b); }

//WHATEVER IS LEFT THAT A TERMINAL WOULD HAVE ACTED ON RATHER THAN SHOWN.
//Newline, carriage return and tab are kept: they are layout, and dropping them
//would run a log together into one line.
//0-8, 11-12, 14-31 and 127. The gaps are the ones that are LAYOUT rather than
//instructions: 9 tab, 10 newline, 13 carriage return. A class written as
//11-to-13 would swallow the carriage return — it is one character wider than it
//looks, and that is how a log comes back with its lines run together.
var CONTROL = new RegExp('[' + range(0, 8) + range(11, 12)
    + range(14, 31) + String.fromCharCode(127) + ']', 'g');

function plain(s) {
    return String(s == null ? '' : s)
        //HYPERLINKS FIRST, keeping the visible text and dropping the target, so
        //the address is not left in twice. Doing this after the general OSC rule
        //would consume the opener and leave the address behind as text.
        .replace(HYPERLINK, '')
        //ANY OTHER OPERATING-SYSTEM COMMAND: window titles, notifications.
        .replace(OSC, '')
        //COLOURS, CURSOR MOVEMENT, ERASE.
        .replace(CSI, '')
        .replace(CHARSET, '')
        .replace(CONTROL, '');
}

module.exports = { plain: plain, ESC: ESC, BEL: BEL };
