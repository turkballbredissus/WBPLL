'use strict';
(function () {
    // The global rankings. Every point total on this page is worked out by the
    // database when it is asked - nothing is stored on a profile - so accepting
    // or removing a record moves the board straight away, and changing the
    // curve in site_config re-scores everyone at once.
    const root = document.getElementById('boardRoot');
    const el = WB.el;

    const fmtPoints = WB.fmtPoints;

    function plural(n, one, many) {
        return n === 1 ? '1 ' + one : n + ' ' + many;
    }

    WB.ready().then(async () => {
        root.textContent = '';

        if (!WB.configured) {
            root.appendChild(el('h1', 'form-title', 'Not connected'));
            root.appendChild(el('p', 'form-intro',
                'The site cannot reach its database, so there are no rankings to show.'));
            return;
        }

        const { data, error } = await WB.client.rpc('leaderboard');

        const head = el('div', 'tools-head');
        head.appendChild(el('h1', 'form-title', 'Rankings'));
        root.appendChild(head);

        if (error) {
            root.appendChild(el('div', 'q-error', WB.errText(error)));
            return;
        }

        const rows = data || [];
        if (!rows.length) {
            root.appendChild(el('div', 'q-empty',
                'Nobody has scored yet. Get a record accepted and this fills up.'));
            return;
        }

        const me = WB.user();
        const board = el('div', 'board');
        rows.forEach(r => {
            const row = el('div', 'board-row');
            // Gold, silver and bronze for the top three, and a marker on your
            // own row so you can find yourself without reading every name.
            if (r.place <= 3) row.classList.add('board-top' + r.place);
            if (me && me.id === r.account_id) row.classList.add('board-me');

            row.appendChild(el('div', 'board-place', '#' + r.place));

            const who = el('div', 'board-who');
            const top = el('div', 'board-top-line');
            top.appendChild(WB.profileLink(r.display_name, r.role, r.account_id));
            if (r.role !== 'user') top.appendChild(WB.roleChip(r.role));
            who.appendChild(top);
            who.appendChild(el('div', 'board-sub',
                plural(r.levels_counted, 'level', 'levels') +
                ' · best ' + r.best_percent + '%'));
            row.appendChild(who);

            const pts = el('div', 'board-pts');
            pts.appendChild(el('b', '', fmtPoints(r.points)));
            pts.appendChild(el('span', 'board-pts-label', 'points'));
            row.appendChild(pts);

            board.appendChild(row);
        });
        root.appendChild(board);
    });
})();
