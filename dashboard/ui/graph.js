'use strict'

// THE TWO PICTURES.
//
//   Repositories -> Graph   a branch's journey: the cut, the task, the machine
//                           that ran it, the judgement, the pull request.
//   Supervisor   -> Graph   what a supervisor did in one turn: woken, what it
//                           read, what it was refused, what it wrote, what it
//                           said.
//
// THEY ARE THE SAME KIND OF PICTURE, which is why they are one file: a list of
// nodes and a list of wires, laid out left to right in the order things happen.
// What differs is where the nodes come from.
//
// READ-ONLY, AND THAT IS A DESIGN DECISION RATHER THAN AN OMISSION. LiteGraph is
// a node EDITOR — nodes have an `onExecute`, a graph can be `start()`ed, and the
// canvas has a play button. None of that is used here. A picture that could be
// executed would be a second place where work can start, beside the queue, with
// its own idea of what the rules are; and the one thing this app has held to is
// that there is one surface. So no node has an onExecute, the graph is never
// started, and what is left is a layout engine, wires that route themselves, and
// dragging and zooming for free.
//
// NOTHING IS DRAWN WHILE THE PANE IS SHUT. Every paint here begins with the
// guard, and it is not decoration: the window redraws every three seconds, and a
// canvas nobody is looking at that asks the app for a graph is the fault this
// codebase has now paid for three times. See the top of CLAUDE.md.

// ---- where each picture is, so the guard can be written once ---------------
const flowShowing = () => view === 'repos' && repoPane === 'flow'
const turnShowing = () => view === 'chat' && chatPane === 'turn'

// ---- the colours a node wears ----------------------------------------------
//
// One per KIND of thing rather than one per state. A machine is a machine
// whether it is running or not; whether it went well is said on the node, in
// words, because a picture that encodes the answer only in colour is one that
// cannot be read by everybody and cannot be quoted by anybody.
const TONE = {
  branch: '#4aa3ff',
  task: '#d29922',
  machine: '#3fb950',
  judgement: '#a371f7',
  pull: '#f778ba',
  read: '#7d8998',
  wrote: '#d29922',
  refused: '#f85149',
  said: '#4aa3ff',
  woke: '#a371f7'
}

// ---- one node type, told what it is ----------------------------------------
//
// LiteGraph wants a registered type per node, and the obvious reading of that is
// a type per kind of thing — a BranchNode, a TaskNode, and so on. That was
// written and thrown away: every one of them was the same object with a
// different string in it, and adding a kind meant adding a class. What varies is
// data, so it is data.
// THE COLOUR GOES ON THE DOT, NOT THE TITLE BAR.
//
// LiteGraph draws `color` as the title BAR and its title text in a fixed pale
// grey. Setting the kind's colour there gave a bright pastel bar with pale
// text on it, which photographed as a row of cards whose titles could not be
// read at all — the one thing on a card that has to be.
//
// `boxcolor` is the dot at the left of the title, which is exactly the size a
// colour cue should be. The bar stays the panel colour the rest of this
// window uses, the title stays legible, and the kind is still visible at a
// glance — plus the body lines already carry their own tones.
function Card () {
  this.addInput('', 0)
  this.addOutput('', 0)
  // Wider than it looks like it needs to be: a branch name with a slash in it
  // and a task title are both longer than any tidy number.
  this.size = [250, 100]
  this.color = '#1c232d'
  this.bgcolor = '#0e1116'
  // What this node is about, filled in when it is made. Never null by the time
  // anything draws: see cardFor.
  this.about = { kind: null, lines: [] }
}

Card.prototype.onDrawBackground = function (ctx) {
  if (this.flags && this.flags.collapsed) return
  const lines = (this.about && this.about.lines) || []
  ctx.font = '11px ui-monospace, Consolas, monospace'
  let y = 34
  // FOUR, because the last one is when it happened and a timeline whose axis
  // cannot be read is just a row of cards. It was three, and the timestamp --
  // added last so it reads as a footer -- was silently dropped by this slice.
  for (const line of lines.slice(0, 4)) {
    ctx.fillStyle = line.tone || '#7d8998'
    ctx.fillText(String(line.text || '').slice(0, 34), 12, y)
    y += 15
  }
}

let registered = false
function registerOnce () {
  if (registered) return
  // GUARDED BECAUSE THIS FILE IS READ ONCE AND THE PANES ARE OPENED MANY TIMES.
  // LiteGraph warns and replaces on a second registration of the same name,
  // which is noise in the console that means nothing is wrong.
  if (typeof LiteGraph === 'undefined') return
  LiteGraph.registerNodeType('okc/card', Card)
  registered = true
}

// ---- a canvas, made when its pane is first opened --------------------------
//
// NOT AT LOAD TIME. A canvas in a hidden pane has no width, and LiteGraph sizes
// itself from the element it is given — so one built before its pane is shown is
// built at zero by zero and stays there, which draws as an empty tab with no
// error anywhere.
const built = new Map()

function canvasFor (which, canvasId) {
  if (built.has(which)) return built.get(which)
  if (typeof LiteGraph === 'undefined' || typeof LGraph === 'undefined') return null
  registerOnce()

  const holder = $(canvasId).parentElement
  if (!holder || !holder.clientWidth) return null

  const graph = new LGraph()
  const canvas = new LGraphCanvas($(canvasId), graph)

  // WHAT MAKES IT A PICTURE RATHER THAN AN EDITOR. Each of these is a way work
  // could be started or changed from here, and none of them should be.
  canvas.allow_interaction = true      // dragging and zooming, which is reading
  canvas.allow_dragnodes = true        // moving a card to see behind it
  canvas.allow_searchbox = false       // no adding nodes
  canvas.allow_reconnect_links = false // no rewiring what happened
  canvas.render_execution_order = false
  canvas.links_render_mode = LiteGraph.SPLINE_LINK
  canvas.background_image = null
  // LiteGraph's own corner readout — frame time, node count, FPS. It is for
  // somebody developing LiteGraph, and here it sits on top of the first card
  // reading like part of this app.
  canvas.show_info = false

  // THE GRAPH IS NEVER STARTED. `graph.start()` runs a loop calling onExecute on
  // every node; nothing here has one, so it would be a timer doing nothing
  // forever.
  //
  // THE CANVAS IS A DIFFERENT LOOP, AND IT STARTS ITSELF. `new LGraphCanvas`
  // calls startRendering() in its constructor: an animation frame, for ever,
  // whether or not the pane it is in is open. Most frames do nothing because
  // nothing is dirty, but 'mostly free, for ever, behind a closed tab' is the
  // exact shape of the thing this window has twice been slowed to a crawl by.
  // It was visible in the first photograph as a live FPS counter on a canvas
  // that had been sitting still.
  //
  // So it is stopped as soon as it is built, and only runs while its pane is
  // being looked at. See showing() below, which the paints call both ways.
  canvas.stopRendering()

  const made = { graph, canvas, holder, signature: null }
  built.set(which, made)
  resize(made)
  return made
}

// DRAWING OR NOT, in one place, so the two paints cannot disagree about it.
//
// Called on every draw of the window — including the draws where the pane is
// shut, which is the case that matters. A canvas asked to stop twice does not
// mind; a canvas nobody ever stops runs until the window closes.
function drawingWhile (made, showing) {
  if (!made) return showing
  if (showing && !made.drawing) { made.canvas.startRendering(); made.drawing = true }
  if (!showing && made.drawing) { made.canvas.stopRendering(); made.drawing = false }
  return showing
}

function resize (made) {
  if (!made || !made.holder || !made.holder.clientWidth) return
  made.canvas.resize(made.holder.clientWidth, made.holder.clientHeight)
}

// ---- laying out what happened ----------------------------------------------
//
// LEFT TO RIGHT IN THE ORDER IT HAPPENED, in columns, because that is what these
// two pictures are: a sequence with the occasional fork. Nothing here is a
// general graph layout — a spring layout would move every node whenever anything
// changed, and a picture somebody is watching must not rearrange itself under
// them while they read it.
const COLUMN = 290
const ROW = 130

function cardFor (made, node, column, row) {
  const made1 = LiteGraph.createNode('okc/card')
  made1.pos = [40 + column * COLUMN, 30 + row * ROW]
  made1.title = String(node.title || node.id || '').slice(0, 34)
  made1.about = { kind: node.kind || null, lines: node.lines || [] }
  if (TONE[node.kind]) made1.boxcolor = TONE[node.kind]
  made.graph.add(made1)
  return made1
}

// WHAT IS ON SCREEN NOW, so a redraw that would produce the same picture does
// not happen. Rebuilding a graph resets every position, which throws away
// whatever the person had dragged into view — the same fault as rewriting
// identical text and taking a selection with it, one level up.
function drawGraph (made, picture) {
  if (!made) return
  const signature = JSON.stringify(picture)
  if (made.signature === signature) return
  made.signature = signature

  made.graph.clear()
  const byId = new Map()
  for (const n of picture.nodes || []) {
    byId.set(n.id, cardFor(made, n, n.column || 0, n.row || 0))
  }
  for (const link of picture.links || []) {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    if (from && to) from.connect(0, to, 0)
  }
  // BACK TO THE TOP LEFT WHENEVER THE PICTURE CHANGES.
  //
  // LiteGraph keeps whatever pan and zoom it had, which is right while
  // somebody is reading — and wrong the moment the picture underneath them is
  // replaced by a different one. The first photograph of this had the top row
  // cut off and the left column half off the edge, which reads as a broken
  // canvas rather than as a scrolled one.
  //
  // Only here, in the branch that rebuilds. A redraw that changes nothing
  // returns above without touching the view, so dragging survives everything
  // except the picture actually becoming a different picture.
  made.canvas.ds.offset = [30, 40]
  made.canvas.ds.scale = 1
  made.canvas.setDirty(true, true)
}

// ---- nothing to draw is a thing to say --------------------------------------
//
// An empty canvas and a canvas that has not loaded look identical, and the
// difference matters: one means "no work is in flight", which is an answer.
function nothing (made, why) {
  drawGraph(made, { nodes: [{ id: 'none', title: 'nothing to draw', kind: 'read', lines: [{ text: why, tone: '#7d8998' }], column: 0, row: 0 }], links: [] })
}

// ---- a branch's journey -----------------------------------------------------
function paintFlow () {
  // STOPPED BEFORE THE EARLY RETURN, not after it. A guard that returns first
  // and tidies later never tidies: the pane being shut is exactly when there
  // is something to turn off.
  if (!drawingWhile(built.get('flow'), flowShowing())) return
  const made = canvasFor('flow', 'flow-canvas')
  if (!made) return
  drawingWhile(made, true)
  resize(made)

  api('workGraph').then(said => {
    // ASKED AGAIN AFTER THE ANSWER COMES BACK, because a call is not instant and
    // a person can be two tabs away by the time it returns. Without this the
    // picture is built into a hidden canvas, which is both wasted and wrong: the
    // canvas has no size while it is hidden, so what it builds is unreadable
    // when it is shown again.
    if (!flowShowing()) return
    setText($('flow-context'), said.note || '')
    if (!(said.nodes || []).length) return nothing(made, said.why || 'no work is in flight')
    drawGraph(made, said)
  }).catch(e => nothing(made, e.message))
}

// ---- what a supervisor did in a turn ---------------------------------------
function paintTurn () {
  // See paintFlow: stopped before the return, for the same reason.
  if (!drawingWhile(built.get('turn'), turnShowing())) return
  const made = canvasFor('turn', 'turn-canvas')
  if (!made) return
  drawingWhile(made, true)
  resize(made)

  api('turnGraph').then(said => {
    if (!turnShowing()) return
    setText($('turn-context'), said.note || '')
    if (!(said.nodes || []).length) return nothing(made, said.why || 'it has not taken a turn yet')
    drawGraph(made, said)
  }).catch(e => nothing(made, e.message))
}
