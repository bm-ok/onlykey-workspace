//---------------------------------------------------------------------------
//WHAT A JUDGE CONCLUDED, READ OUT OF WHAT IT HANDED BACK.
//
//A judge ends its answer with one line, and that line is what everything
//downstream turns on: whether there is work to do, and whether a change may be
//sent out.
//
//READ FROM THE FILE THE JUDGE ACTUALLY HANDED BACK rather than from anything the
//run reported about itself — the file is what a person will read too, and two
//accounts of one judgement is one too many.
//
//---- three lanes, three vocabularies, and the reader has to know all -------
//
//  RECOMMENDATION: accept|reject   a change this host made, going out
//  CLAIM: true|false|unclear       a question somebody asked about code
//  RECOMMEND: YES|NO               a pull request that arrived
//
//THE THIRD IS NOT A SYNONYM INVENTED HERE. It is what the prompt for reading an
//arrived pull request ASKS FOR, in those words, because "do you recommend
//pulling this" is the sentence a person wants under somebody else's pull
//request. The reader this comes from knew the first two, so a judge that
//followed its instructions exactly was recorded as having "reached no
//conclusion" after reading for three and a half minutes and writing twelve
//thousand characters ending in RECOMMEND: NO.
//
//MAPPED, NOT KEPT. Downstream asks one question of this field — is this
//judgement a rejection — and a lane whose values it does not recognise reads as
//"not a rejection", which is the wrong way round for the one lane that is about
//somebody else's code.
//
//---- and why this is not ../judge/judgements.js's reader -------------------
//
//That one is for a person: it takes the LAST verdict-shaped line and shows what
//it said, whatever it said, including `VERDICT:` which a judge never writes but
//a person might. This one records a value the app then acts on, so it takes the
//FIRST line that is exactly one of the words it can act on, and maps it.
//
//Two readers of one sentence is a thing worth noticing. They answer different
//questions — what did it say, versus what does this app now do — and the day
//they are merged, one of the two starts lying.
//---------------------------------------------------------------------------

//ANCHORED TO A WHOLE LINE, and to the exact words. A judgement that spends a
//paragraph discussing whether to recommend acceptance is not concluding
//anything, and a reader that matched mid-sentence would file it as though it
//had.
var SAYS = /^\s*(RECOMMENDATION|CLAIM|RECOMMEND):\s*(accept|reject|true|false|unclear|yes|no)\s*$/im;

//WHAT THE PULL-REQUEST LANE'S WORDS MEAN IN THE OTHER TWO.
var MEANS = { yes: 'accept', no: 'reject' };

function concludedIn(text) {
    var m = String(text == null ? '' : text).match(SAYS);
    if (!m) return null;
    var said = m[2].toLowerCase();
    return MEANS[said] || said;
}

//---- and across the whole of what came back --------------------------------
//
//THE FIRST FILE THAT CONCLUDES ANYTHING. A judge hands back a survey and a
//verdict, or one file that is both; reading on past the first conclusion would
//let a later file's discussion overwrite the answer.
//
//A FILE THAT CANNOT BE READ IS SKIPPED, not fatal. What is being read is
//whatever a model chose to write to disk, and one unreadable file must not lose
//a conclusion sitting in the next one.
//
//ASYNC BECAUSE THE READING IS. What a judgement handed back lives in
//../core/archive's drawer, which answers off disk — so this awaits each file
//rather than being handed a bag of text somebody loaded first. Loading them all
//up front would read every file to answer a question the first one usually
//settles.
async function concludedAcross(handed, read) {
    for (var i = 0; i < (handed || []).length; i++) {
        var text = '';
        try { text = await read(handed[i].file); } catch (e) { continue; }
        var said = concludedIn(text);
        if (said) return said;
    }
    return null;
}

module.exports = { concludedIn: concludedIn, concludedAcross: concludedAcross, SAYS: SAYS };
