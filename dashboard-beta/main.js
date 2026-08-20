//nw.js loads `main` from package.json into a generated background page at the
//app root, and resolves that script's requires from the root rather than from
//the file's own directory — so a boot living in src/ cannot require its
//neighbours. this hands over to it as an ordinary module, where relative paths
//mean what they look like.
//
//the three boots are src/main.js, src/server.js and src/window.js.
require('./src/main.js');
