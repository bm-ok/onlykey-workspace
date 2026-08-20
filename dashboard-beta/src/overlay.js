//a failure with no window to look at is the expensive kind. anything that goes
//wrong before or underneath the ui gets printed on top of the page.

module.exports = function showError(title, detail) {
    if (typeof document == 'undefined') return;

    var id = 'app-error-overlay';
    var pre = document.getElementById(id);
    if (!pre) {
        pre = document.createElement('pre');
        pre.id = id;
        pre.style.cssText = 'position:relative;z-index:9999;margin:0;padding:1rem;' +
            'white-space:pre-wrap;font:12px/1.5 monospace;color:#fff;background:#b00';
        document.body.insertBefore(pre, document.body.firstChild);
    }
    pre.textContent = title + '\n\n' + (detail && detail.stack || detail || '');
};
