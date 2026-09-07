'use strict';
(function () {
    // Two views off one page: everyone on the site, and one person in detail.
    // profile.html          -> the roster
    // profile.html?id=<uuid> -> that account
    //
    // Profiles are readable by anyone, signed in or not, because a list where
    // you cannot see who the moderators are is not much of a community.
    const root = document.getElementById('profileRoot');
    const el = WB.el;

    const ORDER = { owner: 0, admin: 1, moderator: 2, user: 3 };

    function wantedId() {
        const raw = new URLSearchParams(location.search).get('id') || '';
        // Only ever a uuid, so a hand-edited URL cannot smuggle anything into a query.
        return /^[0-9a-f-]{36}$/i.test(raw) ? raw : '';
    }

    WB.ready().then(() => {
        if (!WB.configured) {
            root.textContent = '';
            root.appendChild(el('h1', 'form-title', 'Not connected'));
            root.appendChild(el('p', 'form-intro',
                'The site cannot reach its database, so there are no profiles to show.'));
            return;
        }
        return wantedId() ? showOne(wantedId()) : showRoster();
    });

    // ------------------------------------------------------------- roster

    async function showRoster() {
        const [people, records, board] = await Promise.all([
            WB.client.from('profiles').select('id, display_name, role, disabled, created_at'),
            WB.client.from('records').select('account_id'),
            WB.client.rpc('leaderboard')
        ]);

        root.textContent = '';
        if (people.error) {
            root.appendChild(el('div', 'q-error', WB.errText(people.error)));
            return;
        }

        const counts = {};
        ((records && records.data) || []).forEach(r => {
            if (r.account_id) counts[r.account_id] = (counts[r.account_id] || 0) + 1;
        });

        // Only people who have scored appear in the rankings, so anyone missing
        // from this map has no points rather than an unknown number of them.
        const scores = {};
        ((board && board.data) || []).forEach(b => { scores[b.account_id] = b; });

        // Disabled accounts drop off the public roster. Staff still see them in
        // Admin Tools; there is no reason to label someone publicly.
        const list = (people.data || []).filter(p => !p.disabled).slice().sort((a, b) => {
            const d = ORDER[a.role] - ORDER[b.role];
            return d !== 0 ? d : a.display_name.localeCompare(b.display_name);
        });

        const head = el('div', 'tools-head');
        head.appendChild(el('h1', 'form-title', 'Players'));
        root.appendChild(head);

        if (!list.length) {
            root.appendChild(el('div', 'q-empty', 'Nobody has signed up yet.'));
            return;
        }

        const wrap = el('div', 'roster');
        list.forEach(p => {
            const card = el('a', 'roster-card');
            card.href = 'profile.html?id=' + encodeURIComponent(p.id);

            const top = el('div', 'roster-top');
            top.appendChild(WB.nameEl(p.display_name, p.role));
            if (p.role !== 'user') top.appendChild(WB.roleChip(p.role));
            card.appendChild(top);

            const s = scores[p.id];
            card.appendChild(el('div', 'roster-sub', s
                ? WB.fmtPoints(s.points) + ' points · #' + s.place
                : 'no points yet'));

            const n = counts[p.id] || 0;
            card.appendChild(el('div', 'roster-sub',
                (n === 1 ? '1 record on the list' : n + ' records on the list')));
            card.appendChild(el('div', 'roster-sub', 'joined ' + WB.fmtWhen(p.created_at)));
            wrap.appendChild(card);
        });
        root.appendChild(wrap);
    }

    // ---------------------------------------------------------- one person

    async function showOne(id) {
        // player_records hands back each run already priced, and leaderboard
        // hands back the place. Both are worked out by the database, so a
        // profile can never disagree with the rankings about a total.
        const [who, recs, board] = await Promise.all([
            WB.client.from('profiles').select('id, display_name, role, created_at')
                .eq('id', id).maybeSingle(),
            WB.client.rpc('player_records', { p_id: id }),
            WB.client.rpc('leaderboard')
        ]);

        root.textContent = '';
        const back = el('a', 'back-link', '← All players');
        back.href = 'profile.html';
        root.appendChild(back);

        if (who.error || !who.data) {
            root.appendChild(el('h1', 'form-title', 'No such player'));
            root.appendChild(el('p', 'form-intro', 'That account does not exist, or was removed.'));
            return;
        }
        const p = who.data;
        const me = WB.user();
        const isMe = !!(me && me.id === p.id);

        const head = el('div', 'profile-head');
        const title = el('h1', 'form-title');
        title.appendChild(WB.nameEl(p.display_name, p.role));
        head.appendChild(title);

        const badges = el('div', 'profile-badges');
        badges.appendChild(WB.roleChip(p.role));
        badges.appendChild(el('span', 'profile-joined', 'joined ' + WB.fmtWhen(p.created_at)));
        head.appendChild(badges);

        const mine = ((board && board.data) || []).find(b => b.account_id === p.id);
        const score = el('div', 'profile-score');
        score.appendChild(el('b', '', mine ? WB.fmtPoints(mine.points) : '0'));
        // Somebody off the board has no place to show, so it says why instead
        // of printing a rank they do not have.
        score.appendChild(el('span', '', mine
            ? 'points · #' + mine.place + ' on the rankings'
            : 'points · not on the rankings yet'));
        head.appendChild(score);
        root.appendChild(head);

        if (isMe) root.appendChild(renameBox(p));

        // Their records. Nobody beats these levels, so this is the real scoreboard.
        const rows = (recs && recs.data) || [];
        const sec = el('div', 'section');
        sec.appendChild(el('div', 'section-head', 'Records'));

        if (!rows.length) {
            sec.appendChild(el('div', 'q-empty', isMe
                ? 'Nothing accepted yet. Submit a record and it shows up here once it is checked.'
                : 'No accepted records yet.'));
        } else {
            const best = rows[0];
            sec.appendChild(el('div', 'section-sub',
                'Furthest so far: ' + best.percent + '% on ' + (best.level_name || 'a level') +
                '. A run that a better one on the same level has replaced is faded, ' +
                'and counts nothing.'));

            rows.forEach(r => {
                const row = el('div', 'list-row rec-row-p');
                if (!r.counts) row.classList.add('beaten');
                row.appendChild(el('span', 'rank', r.percent + '%'));

                const mid = el('div', '');
                mid.appendChild(el('div', 'li-name', r.level_name || 'unknown level'));
                mid.appendChild(el('div', 'li-pub',
                    '#' + r.level_position + ' on ' + WB.listInfo(r.level_list).long.toLowerCase()));
                row.appendChild(mid);

                const worth = el('div', 'rec-worth');
                worth.appendChild(el('b', '', WB.fmtPoints(r.points)));
                worth.appendChild(document.createTextNode(' pts'));
                row.appendChild(worth);

                if (r.proof) {
                    const a = el('a', 'rec-proof', 'proof');
                    a.href = r.proof;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    row.appendChild(a);
                } else {
                    row.appendChild(el('span', ''));
                }
                sec.appendChild(row);
            });
        }
        root.appendChild(sec);
    }

    // Only ever shown on your own profile. The database refuses a role change
    // from here regardless, so the worst case is a wasted click.
    function renameBox(p) {
        const box = el('div', 'section');
        box.appendChild(el('div', 'section-head', 'Your name'));
        box.appendChild(el('div', 'section-sub',
            'This is what shows next to your records and submissions.'));

        const row = el('div', 'rename-row');
        const input = el('input', 'q-note');
        input.type = 'text';
        input.value = p.display_name;
        input.maxLength = 24;
        row.appendChild(input);

        const btn = el('button', 'btn-submit', 'Save');
        btn.type = 'button';
        row.appendChild(btn);
        box.appendChild(row);

        const note = el('div', 'form-note');
        box.appendChild(note);

        btn.addEventListener('click', async () => {
            const name = input.value.trim();
            if (name.length < 2) {
                note.textContent = 'That is too short.';
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Saving';
            const { error } = await WB.client
                .from('profiles')
                .update({ display_name: name })
                .eq('id', p.id);
            btn.disabled = false;
            btn.textContent = 'Save';

            if (error) {
                note.textContent = WB.errText(error);
                return;
            }
            note.textContent = 'Saved.';
            // The nav still shows the old name until the page is rebuilt.
            setTimeout(() => location.reload(), 500);
        });
        return box;
    }
})();
