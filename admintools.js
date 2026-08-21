'use strict';
(function () {
    // Level review, plus the two things that only make sense next to it: the
    // order of the live list, and who gets to review anything.
    const root = document.getElementById('toolsRoot');
    const el = WB.el;

    let queue = [];
    let levels = [];
    let history = [];
    let people = [];        // the Accounts panel roster, owner only
    let peopleById = {};    // account id -> {display_name, role}, for tinting names
    let busy = false;

    const YT = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

    WB.guard('admin', root).then(ok => {
        if (ok) start();
    });

    async function start() {
        root.textContent = '';
        root.appendChild(header());
        root.appendChild(el('div', 'queue', ''));
        root.appendChild(el('div', 'section list-section', ''));
        root.appendChild(el('div', 'hist', ''));
        if (WB.atLeast('owner')) root.appendChild(el('div', 'section people-section', ''));
        await refresh();
    }

    function header() {
        const h = el('div', 'tools-head');
        h.appendChild(el('h1', 'form-title', 'Admin Tools'));
        h.appendChild(el('p', 'form-intro',
            'Levels waiting on a decision. Approving asks you where it lands, and everything at that rank and below moves down one.'));

        const bar = el('div', 'tools-bar');
        const count = el('span', 'tools-count', '');
        count.id = 'queueCount';
        bar.appendChild(count);

        const reload = el('button', 'btn-ghost', 'Refresh');
        reload.type = 'button';
        reload.addEventListener('click', refresh);
        bar.appendChild(reload);
        h.appendChild(bar);
        return h;
    }

    async function refresh() {
        const list = root.querySelector('.queue');
        list.textContent = '';
        list.appendChild(el('div', 'q-empty', 'Loading…'));

        const jobs = [
            WB.client
                .from('level_submissions')
                .select('id, name, publisher, level_id, showcase, placement, account_id, account_name, created_at')
                .eq('status', 'pending')
                .order('created_at', { ascending: true }),
            WB.client
                .from('levels')
                .select('id, position, name, publisher, points')
                .order('position', { ascending: true }),
            WB.client
                .from('level_submissions')
                .select('id, name, publisher, status, note, reviewer_name, reviewed_at')
                .neq('status', 'pending')
                .order('reviewed_at', { ascending: false })
                .limit(20)
        ];
        if (WB.atLeast('owner')) {
            jobs.push(WB.client.from('profiles').select('id, display_name, role, created_at').order('created_at'));
        }

        const res = await Promise.all(jobs);
        peopleById = await WB.people();
        if (res[0].error) {
            list.textContent = '';
            list.appendChild(el('div', 'q-error', WB.errText(res[0].error)));
            return;
        }
        queue = res[0].data || [];
        levels = (res[1] && res[1].data) || [];
        history = (res[2] && res[2].data) || [];
        people = (res[3] && res[3].data) || [];
        render();
    }

    function render() {
        const list = root.querySelector('.queue');
        list.textContent = '';
        document.getElementById('queueCount').textContent =
            queue.length === 0 ? 'Nothing waiting'
                : queue.length === 1 ? '1 level waiting'
                    : queue.length + ' levels waiting';

        if (!queue.length) {
            list.appendChild(el('div', 'q-empty', 'The queue is empty. Nothing to review right now.'));
        } else {
            queue.forEach(sub => list.appendChild(card(sub)));
        }
        renderList();
        renderHistory();
        if (WB.atLeast('owner')) renderPeople();
    }

    // ---------------------------------------------------------------- queue

    function card(sub) {
        const c = el('div', 'qcard lvlcard');

        const yt = (sub.showcase || '').match(YT);
        const thumb = el('div', 'q-thumb');
        if (yt) thumb.style.backgroundImage = 'url("https://img.youtube.com/vi/' + yt[1] + '/hqdefault.jpg")';
        c.appendChild(thumb);

        const main = el('div', 'q-main');
        main.appendChild(el('div', 'q-title', sub.name || 'untitled'));

        const meta = el('div', 'q-meta');
        meta.appendChild(el('span', '', 'by ' + (sub.publisher || 'unknown')));
        meta.appendChild(el('span', 'id-badge', 'ID: ' + (sub.level_id || '—')));
        if (sub.showcase) {
            const a = el('a', 'rec-proof', 'Showcase');
            a.href = sub.showcase;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            meta.appendChild(a);
        }
        main.appendChild(meta);

        const meta2 = el('div', 'q-meta');
        const acct = sub.account_id ? peopleById[sub.account_id] : null;
        const by = el('span', '', 'sent by ');
        by.appendChild(acct
            ? WB.profileLink(sub.account_name || acct.display_name, acct.role, acct.id)
            : WB.nameEl(sub.account_name || 'unknown', 'user'));
        meta2.appendChild(by);
        if (sub.created_at) meta2.appendChild(el('span', '', WB.fmtWhen(sub.created_at)));
        if (sub.placement) meta2.appendChild(el('span', 'q-ask', 'asked for #' + sub.placement));
        main.appendChild(meta2);

        // What the admin fills in, as opposed to what the submitter sent.
        const grid = el('div', 'q-grid');
        const posIn = numField(grid, 'Place at', clampPos(sub.placement || levels.length + 1), 1, levels.length + 1);
        const ptsIn = numField(grid, 'Points', 250, 0, 999999);
        const verIn = textField(grid, 'Verifier', '...its impossible.');
        const gdIn = textField(grid, 'Made in', '2.2');
        main.appendChild(grid);

        const preview = el('div', 'q-preview');
        main.appendChild(preview);
        const updatePreview = () => { preview.textContent = previewText(sub, Number(posIn.value)); };
        posIn.addEventListener('input', updatePreview);
        updatePreview();

        const noteIn = el('input', 'q-note');
        noteIn.type = 'text';
        noteIn.placeholder = 'Reason, only if you deny (optional)';
        noteIn.maxLength = 140;
        main.appendChild(noteIn);
        c.appendChild(main);

        const actions = el('div', 'q-actions');
        const yes = el('button', 'btn-accept', 'Approve and place');
        yes.type = 'button';
        yes.addEventListener('click', () => approve(sub, {
            pos: clampPos(Number(posIn.value)),
            points: Number(ptsIn.value),
            verifier: verIn.value,
            version: gdIn.value
        }, c));
        actions.appendChild(yes);

        const no = el('button', 'btn-deny', 'Deny');
        no.type = 'button';
        no.addEventListener('click', () => deny(sub, noteIn.value, c));
        actions.appendChild(no);

        c.appendChild(actions);
        return c;
    }

    function clampPos(n) {
        const max = levels.length + 1;
        if (!Number.isFinite(n) || n < 1) return 1;
        return Math.min(Math.round(n), max);
    }

    function previewText(sub, raw) {
        const pos = clampPos(raw);
        if (pos > levels.length) {
            return 'Goes on the end, at #' + pos + '.';
        }
        const pushed = levels[pos - 1];
        return 'Goes in at #' + pos + ', pushing ' + pushed.name + ' down to #' + (pos + 1) +
            (levels.length > pos ? ' and everything below it too.' : '.');
    }

    function numField(grid, label, value, min, max) {
        const f = el('label', 'q-field');
        f.appendChild(el('span', '', label));
        const i = el('input');
        i.type = 'number';
        i.value = value;
        i.min = min;
        i.max = max;
        f.appendChild(i);
        grid.appendChild(f);
        return i;
    }

    function textField(grid, label, value) {
        const f = el('label', 'q-field');
        f.appendChild(el('span', '', label));
        const i = el('input');
        i.type = 'text';
        i.value = value;
        f.appendChild(i);
        grid.appendChild(f);
        return i;
    }

    async function approve(sub, opts, cardEl) {
        if (busy) return;
        if (!confirm('Put "' + sub.name + '" on the list at #' + opts.pos + '?')) return;

        busy = true;
        setCardButtons(cardEl, true);
        const { error } = await WB.client.rpc('approve_level', {
            p_submission: sub.id,
            p_position: opts.pos,
            p_points: Number.isFinite(opts.points) ? opts.points : 250,
            p_verifier: opts.verifier,
            p_version: opts.version,
            p_added: null
        });
        busy = false;
        if (error) return cardError(cardEl, error);
        cardEl.classList.add('gone');
        setTimeout(refresh, 180);
    }

    async function deny(sub, note, cardEl) {
        if (busy) return;
        if (!confirm('Deny "' + sub.name + '"?')) return;

        busy = true;
        setCardButtons(cardEl, true);
        const { error } = await WB.client.rpc('deny_level', {
            p_submission: sub.id,
            p_note: note || null
        });
        busy = false;
        if (error) return cardError(cardEl, error);
        cardEl.classList.add('gone');
        setTimeout(refresh, 180);
    }

    function cardError(cardEl, error) {
        setCardButtons(cardEl, false);
        let msg = cardEl.querySelector('.q-error');
        if (!msg) {
            msg = el('div', 'q-error');
            cardEl.querySelector('.q-main').appendChild(msg);
        }
        msg.textContent = WB.errText(error);
    }

    function setCardButtons(cardEl, disabled) {
        cardEl.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
    }

    // ----------------------------------------------------------- the list

    function renderList() {
        const wrap = root.querySelector('.list-section');
        wrap.textContent = '';
        wrap.appendChild(el('div', 'section-head', 'The list'));
        wrap.appendChild(el('div', 'section-sub',
            'Drag a level by its handle to move it. The box is there for long jumps - ' +
            'type a rank and press Enter. Either way every other rank renumbers itself. ' +
            (WB.atLeast('owner')
                ? 'Removing a level takes its records with it.'
                : 'Only the owner can remove a level.')));

        if (!levels.length) {
            wrap.appendChild(el('div', 'q-empty', 'Nothing on the list yet.'));
            return;
        }

        // Rows live in their own container so the drag code can treat child
        // index and rank as the same thing.
        const listEl = el('div', 'drag-list');
        levels.forEach(lvl => listEl.appendChild(levelRow(lvl)));
        wrap.appendChild(listEl);
        enableDrag(listEl);
    }

    function levelRow(lvl) {
        const row = el('div', 'list-row drag-row');
        row.dataset.id = lvl.id;

        const grip = el('div', 'drag-handle', '⠿');
        grip.title = 'Drag to reorder';
        row.appendChild(grip);

        row.appendChild(el('span', 'rank', '#' + lvl.position));

        const mid = el('div', '');
        mid.appendChild(el('div', 'li-name', lvl.name));
        mid.appendChild(el('div', 'li-pub', 'published by ' + lvl.publisher));
        row.appendChild(mid);

        const jump = el('input', 'pos-box');
        jump.type = 'number';
        jump.min = 1;
        jump.max = levels.length;
        jump.value = lvl.position;
        jump.title = 'Jump to this rank';
        jump.addEventListener('keydown', e => {
            if (e.key === 'Enter') move(lvl, Number(jump.value));
        });
        row.appendChild(jump);

        // Owner only, enforced in the database. Admins place and reorder;
        // taking a level off destroys its records, so that is the owner's.
        if (WB.atLeast('owner')) {
            const del = el('button', 'btn-remove', '×');
            del.type = 'button';
            del.title = 'Remove from the list';
            del.addEventListener('click', () => remove(lvl));
            row.appendChild(del);
        } else {
            row.appendChild(el('span', ''));
        }

        return row;
    }

    // Drag to reorder. Rows are a uniform height, so the rank the pointer is
    // over is just how many row-heights it has travelled. The rows in between
    // slide out of the way to show where it would land, and nothing is written
    // to the database until the drag ends - so letting go back where you
    // started costs nothing.
    function enableDrag(listEl) {
        let row = null, rows = [], from = 0, to = 0, startY = 0, step = 0;

        listEl.addEventListener('pointerdown', e => {
            const grip = e.target.closest('.drag-handle');
            if (!grip || busy) return;
            e.preventDefault();

            row = grip.closest('.drag-row');
            rows = Array.from(listEl.children);
            from = rows.indexOf(row);
            to = from;
            startY = e.clientY;

            // Height of one row plus the gap under it.
            const box = row.getBoundingClientRect();
            step = box.height + 8;

            row.classList.add('dragging');
            listEl.classList.add('drag-active');
            // Keeps the moves coming even when the pointer outruns the row.
            try { grip.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
        });

        listEl.addEventListener('pointermove', e => {
            if (!row) return;
            const dy = e.clientY - startY;
            row.style.transform = 'translateY(' + dy + 'px)';

            const next = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
            if (next === to) return;
            to = next;

            // Open a gap at the target by nudging everything between.
            rows.forEach((r, i) => {
                if (r === row) return;
                let shift = 0;
                if (from < to && i > from && i <= to) shift = -step;
                else if (from > to && i >= to && i < from) shift = step;
                r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
            });
        });

        function end() {
            if (!row) return;
            const moved = to !== from;
            const lvl = levels[from];

            rows.forEach(r => { r.style.transform = ''; });
            row.classList.remove('dragging');
            listEl.classList.remove('drag-active');
            row = null;

            if (moved && lvl) {
                // Renumber on screen straight away, then let the refresh that
                // follows the save confirm it.
                const copy = levels.slice();
                copy.splice(to, 0, copy.splice(from, 1)[0]);
                levels = copy.map((l, i) => Object.assign({}, l, { position: i + 1 }));
                renderList();
                move(lvl, to + 1);
            }
        }

        listEl.addEventListener('pointerup', end);
        listEl.addEventListener('pointercancel', end);
    }

    async function move(lvl, to) {
        if (busy || !Number.isFinite(to) || to === lvl.position) return;
        busy = true;
        const { error } = await WB.client.rpc('move_level', { p_level: lvl.id, p_position: to });
        busy = false;
        if (error) alert(WB.errText(error));
        refresh();
    }

    async function remove(lvl) {
        if (busy) return;
        if (!confirm('Remove "' + lvl.name + '" from the list? Its records go too.')) return;
        busy = true;
        const { error } = await WB.client.rpc('delete_level', { p_level: lvl.id });
        busy = false;
        if (error) alert(WB.errText(error));
        refresh();
    }

    // -------------------------------------------------------------- people

    function renderPeople() {
        const wrap = root.querySelector('.people-section');
        wrap.textContent = '';
        wrap.appendChild(el('div', 'section-head', 'Accounts'));
        wrap.appendChild(el('div', 'section-sub',
            'Moderators review records. Admins also review levels and hold the list order. Owner is set from the SQL editor only.'));

        if (!people.length) {
            wrap.appendChild(el('div', 'q-empty', 'No accounts yet.'));
            return;
        }

        people.forEach(p => {
            const row = el('div', 'list-row user-row');
            row.appendChild(WB.roleChip(p.role));
            row.appendChild(WB.profileLink(p.display_name, p.role, p.id));

            const me = WB.user();
            if (p.role === 'owner') {
                row.appendChild(el('span', 'li-pub',
                    me && p.id === me.id ? 'that is you' : 'owner, not editable here'));
            } else {
                const sel = el('select', 'role-pick');
                ['user', 'moderator', 'admin'].forEach(r => {
                    const o = el('option', '', r);
                    o.value = r;
                    if (r === p.role) o.selected = true;
                    sel.appendChild(o);
                });
                sel.addEventListener('change', () => setRole(p, sel.value, sel));
                row.appendChild(sel);
            }
            wrap.appendChild(row);
        });
    }

    async function setRole(person, role, sel) {
        if (busy) return;
        if (!confirm('Make ' + person.display_name + ' a ' + role + '?')) {
            sel.value = person.role;
            return;
        }
        busy = true;
        sel.disabled = true;
        const { error } = await WB.client.rpc('set_role', { p_user: person.id, p_role: role });
        busy = false;
        sel.disabled = false;
        if (error) {
            alert(WB.errText(error));
            sel.value = person.role;
            return;
        }
        person.role = role;
        renderPeople();
    }

    // ------------------------------------------------------------- history

    function renderHistory() {
        const wrap = root.querySelector('.hist');
        wrap.textContent = '';
        if (!history.length) return;

        wrap.appendChild(el('div', 'hist-head', 'Recently reviewed'));
        history.forEach(h => {
            const row = el('div', 'hist-row');
            row.appendChild(el('span', 'hist-tag tag-' + h.status, h.status));
            row.appendChild(el('span', 'hist-what', h.name + ' · ' + h.publisher));
            const by = (h.reviewer_name ? 'by ' + h.reviewer_name : '') +
                (h.reviewed_at ? ' · ' + WB.fmtWhen(h.reviewed_at) : '');
            row.appendChild(el('span', 'hist-by', by));
            if (h.note) row.appendChild(el('span', 'hist-note', '“' + h.note + '”'));
            wrap.appendChild(row);
        });
    }
})();
