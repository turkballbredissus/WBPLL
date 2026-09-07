'use strict';
(function () {
    // Level review, plus the two things that only make sense next to it: the
    // order of the live list, and who gets to review anything.
    const root = document.getElementById('toolsRoot');
    const el = WB.el;

    let queue = [];
    let levels = [];        // every level, both lists
    let adminList = WB.currentList();   // the one being managed below
    let history = [];
    let people = [];        // the Accounts panel roster
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
        // Admins see the roster too now, because disabling is theirs to do.
        root.appendChild(el('div', 'section people-section', ''));
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
                .select('id, name, publisher, level_id, showcase, placement, list, cps, account_id, account_name, created_at')
                .eq('status', 'pending')
                .order('created_at', { ascending: true }),
            WB.client
                .from('levels')
                .select('id, list, position, name, publisher, points, level_id, verifier, version, added, image, cps')
                .order('list', { ascending: true })
                .order('position', { ascending: true }),
            WB.client
                .from('level_submissions')
                .select('id, name, publisher, status, note, reviewer_name, reviewed_at')
                .neq('status', 'pending')
                .order('reviewed_at', { ascending: false })
                .limit(20)
        ];
        jobs.push(WB.client.from('profiles')
            .select('id, display_name, role, disabled, created_at').order('created_at'));

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
        renderPeople();
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
        // Their choice of list is a request, not a decision - an easy level
        // filed under impossible gets moved here rather than sent back.
        const asked = (sub.list === 'possible' || sub.list === 'impossible') ? sub.list : 'impossible';
        const listIn = selectField(grid, 'List', WB.LISTS.map(l => ({ value: l.key, text: l.long })), asked);

        const posIn = numField(grid, 'Place at', clampPos(sub.placement || 999, asked), 1, 999);
        // Points are no longer typed in. A level is worth whatever its place on
        // the list is worth, and the database keeps the column in step whenever
        // anything moves - so a number typed here would be wrong the first time
        // somebody dragged the list. Shown read-only so the placement decision
        // still shows its price.
        const ptsIn = textField(grid, 'Points', '…');
        ptsIn.readOnly = true;
        ptsIn.title = 'Worked out from the place on the list';
        // Prefilled from the submission when they offered one, blank otherwise.
        const cpsIn = textField(grid, 'Avg CPS', sub.cps == null ? '' : String(sub.cps));
        cpsIn.placeholder = 'optional';
        // "...its impossible." is the joke for the impossible list; a possible
        // level has a real verifier, so that field starts empty for you to fill.
        const verIn = textField(grid, 'Verifier', asked === 'possible' ? '' : '...its impossible.');
        const gdIn = textField(grid, 'Made in', '2.2');
        main.appendChild(grid);

        const preview = el('div', 'q-preview');
        main.appendChild(preview);

        // Only the database knows the scale, so the worth of a place is asked
        // for rather than worked out here. The token drops a reply that arrives
        // after a newer one, which typing a two-digit place makes likely.
        let ptsToken = 0;
        const updatePoints = async () => {
            const mine = ++ptsToken;
            const pos = clampPos(Number(posIn.value), listIn.value);
            const { data, error } = await WB.client.rpc('position_points', { p_position: pos });
            if (mine !== ptsToken) return;
            ptsIn.value = error ? 'automatic' : WB.fmtPoints(data);
        };

        const updatePreview = () => {
            preview.textContent = previewText(sub, Number(posIn.value), listIn.value);
            updatePoints();
        };
        posIn.addEventListener('input', updatePreview);
        listIn.addEventListener('change', () => {
            // Rank 4 of one list is not rank 4 of the other, so re-clamp it.
            posIn.value = clampPos(Number(posIn.value), listIn.value);
            verIn.value = listIn.value === 'possible' ? '' : '...its impossible.';
            updatePreview();
        });
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
            list: listIn.value,
            pos: clampPos(Number(posIn.value), listIn.value),
            cps: cpsIn.value.trim(),
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

    // A rank only means something inside one list, so every bit of position
    // maths below asks which list first.
    function inList(key) {
        return levels.filter(l => (l.list || 'impossible') === key);
    }

    function clampPos(n, key) {
        const max = inList(key).length + 1;
        if (!Number.isFinite(n) || n < 1) return 1;
        return Math.min(Math.round(n), max);
    }

    function previewText(sub, raw, key) {
        const rows = inList(key);
        const pos = clampPos(raw, key);
        const where = ' on the ' + WB.listInfo(key).long.toLowerCase() + ' list';

        if (pos > rows.length) {
            return rows.length
                ? 'Goes on the end' + where + ', at #' + pos + '.'
                : 'Starts' + where + ' as #1.';
        }
        const pushed = rows[pos - 1];
        return 'Goes in at #' + pos + where + ', pushing ' + pushed.name +
            ' down to #' + (pos + 1) + (rows.length > pos ? ' and everything below it too.' : '.');
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

    function selectField(grid, label, options, value) {
        const f = el('label', 'q-field');
        f.appendChild(el('span', '', label));
        const sel = el('select');
        options.forEach(o => {
            const opt = el('option', '', o.text);
            opt.value = o.value;
            if (o.value === value) opt.selected = true;
            sel.appendChild(opt);
        });
        f.appendChild(sel);
        grid.appendChild(f);
        return sel;
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
        if (!confirm('Put "' + sub.name + '" on the ' +
            WB.listInfo(opts.list).long.toLowerCase() + ' list at #' + opts.pos + '?')) return;

        busy = true;
        setCardButtons(cardEl, true);
        const { error } = await WB.client.rpc('approve_level', {
            p_submission: sub.id,
            p_position: opts.pos,
            // Still sent, and immediately overwritten: the levels trigger sets
            // points from the position in the same transaction. Kept in the
            // call rather than dropped so the argument list keeps matching the
            // function exactly, which is what PostgREST resolves on.
            p_points: 250,
            p_cps: opts.cps === '' ? null : Number(opts.cps),
            p_verifier: opts.verifier,
            p_version: opts.version,
            p_added: null,
            p_list: opts.list
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
        wrap.appendChild(el('div', 'section-head', 'The lists'));

        // One list is managed at a time. Dragging only ever reorders within
        // the list on screen, which is also all the database will allow.
        const tabs = el('div', 'list-tabs');
        WB.LISTS.forEach(info => {
            const n = inList(info.key).length;
            const t = el('button', 'ltab' + (info.key === adminList ? ' active' : ''),
                info.long + ' (' + n + ')');
            t.type = 'button';
            t.addEventListener('click', () => {
                if (info.key === adminList) return;
                adminList = info.key;
                WB.rememberList(adminList);
                renderList();
            });
            tabs.appendChild(t);
        });
        wrap.appendChild(tabs);

        wrap.appendChild(el('div', 'section-sub',
            'Drag a level by its handle to move it. The box is there for long jumps - ' +
            'type a rank and press Enter. Either way every other rank renumbers itself. ' +
            (WB.atLeast('owner')
                ? 'Removing a level takes its records with it.'
                : 'Only the owner can remove a level.')));

        const rows = inList(adminList);
        if (!rows.length) {
            wrap.appendChild(el('div', 'q-empty',
                'Nothing on the ' + WB.listInfo(adminList).long.toLowerCase() + ' list yet.'));
            return;
        }

        // Rows live in their own container so the drag code can treat child
        // index and rank as the same thing.
        const listEl = el('div', 'drag-list');
        rows.forEach(lvl => listEl.appendChild(levelRow(lvl, rows.length)));
        wrap.appendChild(listEl);
        enableDrag(listEl);
    }

    function levelRow(lvl, total) {
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
        jump.max = total;
        jump.value = lvl.position;
        jump.title = 'Jump to this rank';
        jump.addEventListener('keydown', e => {
            if (e.key === 'Enter') move(lvl, Number(jump.value));
        });
        row.appendChild(jump);

        // Owner only, enforced in the database. Which list a level belongs on
        // is a claim about the level, the same as its name or its verifier.
        if (WB.atLeast('owner')) {
            const other = lvl.list === 'possible' ? 'impossible' : 'possible';
            const swap = el('button', 'btn-ghost btn-swap', '→ ' + listTag(other));
            swap.type = 'button';
            swap.title = 'Move to the ' + (other === 'possible' ? 'possible' : 'impossible') + ' list';
            swap.addEventListener('click', () => moveToList(lvl, other));
            row.appendChild(swap);
        } else {
            row.appendChild(el('span', ''));
        }

        // Owner only, enforced in the database. What the list claims about a
        // level is yours to set, the same as removing one.
        if (WB.atLeast('owner')) {
            const edit = el('button', 'btn-ghost btn-edit', 'Edit');
            edit.type = 'button';
            edit.title = 'Edit this level’s details';
            edit.addEventListener('click', () => toggleEditor(row, lvl, edit));
            row.appendChild(edit);
        } else {
            row.appendChild(el('span', ''));
        }

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



    function listTag(key) {
        return key === 'possible' ? 'PPLL' : 'PILL';
    }

    // The rank is asked for rather than assumed, because dropping a level at
    // the bottom of the other list is right about as often as it is wrong.
    async function moveToList(lvl, target) {
        if (busy) return;
        const count = levels.filter(l => l.list === target).length;
        const answer = prompt(
            'Move "' + lvl.name + '" to the ' + listTag(target) + '.' +
            ' Which rank should it land at? 1 is the top, and that list has ' +
            count + ' level' + (count === 1 ? '' : 's') + ' right now.' +
            ' Leave it blank to put it at the bottom.',
            '');
        if (answer === null) return;   // cancelled

        const wanted = answer.trim();
        if (wanted !== '' && !/^\d+$/.test(wanted)) {
            alert('That is not a rank. Use a whole number, or leave it blank for the bottom.');
            return;
        }

        busy = true;
        const { error } = await WB.client.rpc('move_level_to_list', {
            p_level: lvl.id,
            p_list: target,
            p_position: wanted === '' ? null : Number(wanted)
        });
        busy = false;
        if (error) {
            alert(WB.errText(error));
            return;
        }
        refresh();
    }

    // ------------------------------------------------------------ editing

    // The editor opens as its own row underneath, rather than turning the row
    // itself into a form - the list stays readable while one level is open,
    // and dragging is unaffected.
    function toggleEditor(row, lvl, btn) {
        const open = row.nextElementSibling &&
            row.nextElementSibling.classList.contains('edit-row');
        // One at a time, so the list does not turn into a wall of forms.
        const others = row.parentNode.querySelectorAll('.edit-row');
        others.forEach(n => n.remove());
        row.parentNode.querySelectorAll('.btn-edit').forEach(b => { b.textContent = 'Edit'; });
        if (open) return;

        btn.textContent = 'Close';
        row.parentNode.insertBefore(buildEditor(row, lvl, btn), row.nextSibling);
    }

    function buildEditor(row, lvl, btn) {
        const box = el('div', 'edit-row');
        const grid = el('div', 'edit-grid');

        const f = {};
        f.name = editField(grid, 'Name', lvl.name || '', 'wide');
        f.publisher = editField(grid, 'Publisher', lvl.publisher || '', 'wide');
        f.image = editField(grid, 'Showcase link', lvl.image || '', 'wide');
        f.verifier = editField(grid, 'Verifier', lvl.verifier || '');
        f.level_id = editField(grid, 'Level ID', lvl.level_id || '');
        // Read-only: a level is worth whatever its place on the list is worth,
        // and the database resets this column every time anything moves. An
        // editable box here would just be a number that never sticks.
        f.points = editField(grid, 'Points',
            lvl.points == null ? '' : WB.fmtPoints(lvl.points));
        f.points.readOnly = true;
        f.points.title = 'Worked out from the place on the list';
        f.cps = editField(grid, 'Avg CPS', lvl.cps == null ? '' : String(lvl.cps));
        f.cps.placeholder = 'blank to clear';
        f.version = editField(grid, 'Made in', lvl.version || '');
        f.added = editField(grid, 'Uploaded', lvl.added || '');
        box.appendChild(grid);

        box.appendChild(el('div', 'edit-hint',
            'Rank and which list it is on are not here — drag it or use the box for rank. ' +
            'Points follow the rank on their own, so moving a level changes what it is worth.'));

        const msg = el('div', 'form-note');
        const actions = el('div', 'edit-actions');

        const save = el('button', 'btn-submit', 'Save');
        save.type = 'button';
        save.addEventListener('click', async () => {
            if (busy) return;
            const cps = f.cps.value.trim();
            if (cps !== '' && (!isFinite(Number(cps)) || Number(cps) < 0)) {
                msg.textContent = 'CPS has to be a number.';
                return;
            }

            busy = true;
            save.disabled = true;
            save.textContent = 'Saving';
            const { error } = await WB.client.rpc('edit_level', {
                p_level: lvl.id,
                p_name: f.name.value,
                p_publisher: f.publisher.value,
                p_level_id: f.level_id.value,
                // Null means "leave it alone", which is right: the trigger sets
                // it from the position the moment this update lands.
                p_points: null,
                p_verifier: f.verifier.value,
                p_version: f.version.value,
                p_added: f.added.value,
                p_image: f.image.value,
                p_cps: cps === '' ? null : Number(cps),
                // Null means "leave it alone", so emptying the box needs to say
                // so explicitly or a wrong number could never be taken back off.
                p_clear_cps: cps === ''
            });
            busy = false;
            save.disabled = false;
            save.textContent = 'Save';

            if (error) {
                msg.textContent = WB.errText(error);
                return;
            }
            btn.textContent = 'Edit';
            box.remove();
            refresh();
        });
        actions.appendChild(save);

        const cancel = el('button', 'btn-ghost', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => {
            btn.textContent = 'Edit';
            box.remove();
        });
        actions.appendChild(cancel);

        box.appendChild(actions);
        box.appendChild(msg);
        return box;
    }

    function editField(grid, label, value, cls) {
        const wrap = el('label', 'edit-field' + (cls ? ' ' + cls : ''));
        wrap.appendChild(el('span', '', label));
        const input = el('input');
        input.type = 'text';
        input.value = value;
        wrap.appendChild(input);
        grid.appendChild(wrap);
        return input;
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
            const rows2 = inList(adminList);
            const lvl = rows2[from];

            rows.forEach(r => { r.style.transform = ''; });
            row.classList.remove('dragging');
            listEl.classList.remove('drag-active');
            row = null;

            if (moved && lvl) {
                // Renumber this list on screen straight away, then let the
                // refresh that follows the save confirm it. The other list is
                // left exactly as it was.
                const copy = rows2.slice();
                copy.splice(to, 0, copy.splice(from, 1)[0]);
                const renumbered = copy.map((l, i) => Object.assign({}, l, { position: i + 1 }));
                levels = levels
                    .filter(l => (l.list || 'impossible') !== adminList)
                    .concat(renumbered);
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
        if (!confirm('Remove "' + lvl.name + '" from the ' +
            WB.listInfo(lvl.list || 'impossible').long.toLowerCase() +
            ' list? Its records go too.')) return;
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
        const owner = WB.atLeast('owner');
        wrap.appendChild(el('div', 'section-head', 'Accounts'));
        wrap.appendChild(el('div', 'section-sub', owner
            ? 'Disabling blocks an account from submitting anything and can be undone. Deleting cannot. Owner is set from the SQL editor only.'
            : 'Disabling blocks an account from submitting anything, and can be undone. Only the owner can change roles or delete an account.'));

        if (!people.length) {
            wrap.appendChild(el('div', 'q-empty', 'No accounts yet.'));
            return;
        }

        const me = WB.user();
        people.forEach(p => {
            const row = el('div', 'list-row user-row' + (p.disabled ? ' row-off' : ''));
            row.appendChild(WB.roleChip(p.role));

            const who = el('div', 'user-who');
            who.appendChild(WB.profileLink(p.display_name, p.role, p.id));
            if (p.disabled) who.appendChild(el('span', 'off-chip', 'disabled'));
            row.appendChild(who);

            const acts = el('div', 'user-acts');
            const isMe = !!(me && p.id === me.id);

            if (p.role === 'owner') {
                acts.appendChild(el('span', 'li-pub', isMe ? 'that is you' : 'owner'));
            } else {
                // Roles stay owner-only. Disabling is an admin call, because it
                // is reversible and undoing a mistake costs nothing.
                if (owner) {
                    const sel = el('select', 'role-pick');
                    ['user', 'moderator', 'admin'].forEach(r => {
                        const o = el('option', '', r);
                        o.value = r;
                        if (r === p.role) o.selected = true;
                        sel.appendChild(o);
                    });
                    sel.addEventListener('change', () => setRole(p, sel.value, sel));
                    acts.appendChild(sel);
                }

                const off = el('button', p.disabled ? 'btn-ghost' : 'btn-deny',
                    p.disabled ? 'Enable' : 'Disable');
                off.type = 'button';
                off.addEventListener('click', () => setDisabled(p, !p.disabled));
                acts.appendChild(off);

                if (owner) {
                    const del = el('button', 'btn-remove', '×');
                    del.type = 'button';
                    del.title = 'Delete this account';
                    del.addEventListener('click', () => deleteAccount(p));
                    acts.appendChild(del);
                }
            }
            row.appendChild(acts);
            wrap.appendChild(row);
        });
    }

    async function setDisabled(person, off) {
        if (busy) return;
        const q = off
            ? 'Disable ' + person.display_name + '?\n\nThey will not be able to submit anything until you turn it back on.'
            : 'Let ' + person.display_name + ' submit again?';
        if (!confirm(q)) return;

        busy = true;
        const { error } = await WB.client.rpc('set_account_disabled', {
            p_user: person.id,
            p_disabled: off
        });
        busy = false;
        if (error) {
            alert(WB.errText(error));
            return;
        }
        person.disabled = off;
        renderPeople();
    }

    // Two prompts on purpose: the first because this cannot be undone from the
    // site, the second because what happens to their records is a real choice.
    async function deleteAccount(person) {
        if (busy) return;
        if (!confirm('Delete ' + person.display_name + '?\n\nThis cannot be undone here. ' +
            'Their profile and anything still waiting for review are removed, and they ' +
            'cannot make a new account.')) return;

        const wipe = confirm('Also remove their records from the lists?\n\n' +
            'OK = remove their records too (for spam).\n' +
            'Cancel = leave their records where they are (for someone just leaving).');

        busy = true;
        const { error } = await WB.client.rpc('delete_account', {
            p_user: person.id,
            p_wipe_content: wipe
        });
        busy = false;
        if (error) {
            alert(WB.errText(error));
            return;
        }
        people = people.filter(x => x.id !== person.id);
        renderPeople();
        alert(person.display_name + ' is gone.\n\nTheir login still exists in Supabase, but ' +
            'they are blocked from coming back, so clearing it is optional — ' +
            'Authentication then Users, if you want it fully removed.');
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
