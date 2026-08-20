var React = require('react');

//---------------------------------------------------------------------------
//the shape of a tab.
//
//WHY THIS EXISTS AS COMPONENTS AND NOT AS MARKUP. In the old window the layout
//lived in index.html — 1,454 lines of skeleton, 19 `.cols` rows, 49 columns —
//and the JavaScript only ever filled containers that were already there. So
//porting the JavaScript brought the content across and silently dropped the
//shape: every pane ported before this file was one column, not because anything
//decided it should be but because nobody had written the shape down anywhere a
//port could pick it up.
//
//THE SHAPE IS THE SAME ON NEARLY EVERY TAB, and it is worth naming because it
//is an argument rather than a habit:
//
//    <Col narrow>          <Col>                  <Col wide>
//    the list              what can be done       what it carries
//                          TO THE SELECTION
//
//One set of buttons serves every item in the list. That is the entire reason
//for the split — a machine, a branch and a task each have a dozen things that
//can be done to them, and repeating those dozen inside every card is how a list
//becomes unreadable.
//---------------------------------------------------------------------------

//A row of columns. Wraps below 1100px, which the stylesheet handles.
function Cols({ children }) { return <div className="cols">{children}</div>; }

//Three up, for a chain read a rung at a time: job <- prompt <- contract. Same
//flex rules, narrower minimum, so three fit before they wrap.
function Cols3({ children }) { return <div className="cols3">{children}</div>; }

function Col({ narrow, wide, children }) {
    return <div className={'col' + (narrow ? ' narrow' : '') + (wide ? ' wide' : '')}>{children}</div>;
}

//A column of things with air between them.
//
//SPACING IS A PROPERTY OF THE CONTAINER AND NEVER OF THE COLUMN, which is what
//`.col > div + div` in the stylesheet is compensating for: two containers in one
//column had no rule about the join, and whether there was a gap depended on
//which classes happened to meet. Using this rather than dropping siblings into
//a <Col> is how that stays decided in one place.
function Stack({ children }) { return <div className="stack">{children}</div>; }

//A heading that can hold something on the right — the `+` that makes a new one,
//a sync state, a count.
function TitleRow({ children }) { return <h2 className="titlerow">{children}</h2>; }

//The spacer that pushes what follows to the right edge.
function Grow() { return <span className="grow" />; }

//A wrapping row of small things, inside a panel or a card.
function Row({ children }) { return <div className="row">{children}</div>; }

//ONE PANE, SEVERAL DETAILS, AND ONLY ONE OF THEM SHOWN. Not the same thing as a
//pane: this switches WITHIN one, which is how a master list on the left shows a
//different detail on the right without the tab changing.
//
//Rendered rather than hidden, unlike the old window — React unmounts what is not
//being looked at, so a detail that polls stops polling when it goes away, which
//the class-toggling version never did.
function View({ on, children }) { return on ? <div className="view active">{children}</div> : null; }

module.exports = { Cols, Cols3, Col, Stack, TitleRow, Grow, Row, View };
