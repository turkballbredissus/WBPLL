'use strict';
// Shared loader for the data/*.js files, used by both the leaderboard and the
// record form so there is only one copy of the parsing rules.
//
// On the deployed site the file is fetched as TEXT and the JSON object is pulled
// out of it, so the data is parsed as inert data and never executed as code. On
// file:// fetch is blocked, so it falls back to a <script> tag that sets the global.
window.WBDLLoad = function (path, globalName) {
    if (location.protocol === 'file:') {
        return new Promise(function (resolve) {
            var sc = document.createElement('script');
            sc.src = path;
            sc.onload = function () { resolve(window[globalName] || null); };
            sc.onerror = function () { resolve(null); };
            document.head.appendChild(sc);
        });
    }
    return fetch(path)
        .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(String(r.status))); })
        .then(function (text) {
            var start = text.indexOf('{');
            var end = text.lastIndexOf('}');
            if (start < 0 || end <= start) throw new Error('no object in ' + path);
            // JS allows a trailing comma before ] or }, JSON does not. Strip them so
            // hand-edited data files still parse on the deployed site.
            return JSON.parse(text.slice(start, end + 1).replace(/,(\s*[\]}])/g, '$1'));
        })
        .catch(function (err) {
            console.error('Failed to load ' + path + ':', err);
            return null;
        });
};
