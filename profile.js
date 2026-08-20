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
        const [people, records] = await Promise.all([
            WB.client.from('profiles').select('id, display_name, role, created_at'),
            WB.client.from('records').select('account_id')
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

        const list = (people.data || []).slice().sort((a, b) => {
            const d = ORDER[a.role] - ORDER[b.role];
            return d !== 0 ? d : a.display_name.localeCompare(b.display_name);
        });

        const head = el('div', 'tools-head');
        head.appendChild(el('h1', 'form-title', 'Players'));
        head.appendChild(el('p', 'form-intro',
            'Everyone with an account, staff first. Red is a moderator, blue an admin, yellow the owner.'));
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
        const [who, recs] = await Promise.all([
            WB.client.from('profiles').select('id, display_name, role, created_at')
                .eq('id', id).maybeSingle(),
            WB.client.from('records')
                .select('percent, proof, levels ( name, position )')
                .eq('account_id', id)
                .order('percent', { ascending: false })
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
                'Furthest so far: ' + best.percent + '% on ' +
                (best.levels ? best.levels.name : 'a level')));

            rows.forEach(r => {
                const row = el('div', 'list-row');
                row.appendChild(el('span', 'rank', r.percent + '%'));

                const mid = el('div', '');
                mid.appendChild(el('div', 'li-name', r.levels ? r.levels.name : 'unknown level'));
                mid.appendChild(el('div', 'li-pub', r.levels ? '#' + r.levels.position + ' on the list' : ''));
                row.appendChild(mid);

                if (r.proof) {
                    const a = el('a', 'rec-proof', 'proof');
                    a.href = r.proof;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    row.appendChild(a);
                } else {
                    row.appendChild(el('span', ''));
                }
                row.appendChild(el('span', ''));
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
