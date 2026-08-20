var { createRoot } = require('react-dom/client');

plugin.consumes = [];
plugin.provides = ['react'];
async function plugin(imports, register) {

    var react = {};
    react.root = createRoot(document.getElementById('root'));
    await register(null, { react });
}
module.exports = plugin;
