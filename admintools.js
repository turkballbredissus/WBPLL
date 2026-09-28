'use strict';
(function () {

    const root = document.getElementById('toolsRoot');
    const el = WB.el;

    let queue = [];
    let levels = [];
    let adminList = WB.currentList();
    let history = [];
    let people = [];
    let peopleById = {};
    let allTags = [];
    let busy = false;

    function tagPicker(mount, selected) {
        const chosen = new Set(selected || []);
        mount.textContent = '';
        if (!allTags.length) {
            mount.appendChild(el('span', 'q-empty', 'No tags exist yet.'));
            return () => [];
        }
        allTags.forEach(t => {
            const chip = WB.tagChip(t);
            chip.classList.add('tag-pick');
            chip.classList.toggle('on', chosen.has(t.slug));
            chip.addEventListener('click', () => {
                if (chosen.has(t.slug)) chosen.delete(t.slug);
                else chosen.add(t.slug);
                chip.classList.toggle('on', chosen.has(t.slug));
            });
            mount.appendChild(chip);
        });
        return () => allTags.map(t => t.slug).filter(s => chosen.has(s));
    }

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
                .select('id, list, position, name, publisher, points, level_id, verifier, version, added, image, cps, min_percent, level_tags ( tags ( slug, label, colour, sort ) )')
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
        allTags = await WB.reloadTags();
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
            a.href = WB.safeUrl(sub.showcase);
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

        const grid = el('div', 'q-grid');

        const asked = (sub.list === 'possible' || sub.list === 'impossible') ? sub.list : 'impossible';
        const listIn = selectField(grid, 'List', WB.LISTS.map(l => ({ value: l.key, text: l.long })), asked);

        const posIn = numField(grid, 'Place at', clampPos(sub.placement || 999, asked), 1, 999);

        const ptsIn = textField(grid, 'Points', '…');
        ptsIn.readOnly = true;
        ptsIn.title = 'Worked out from the place on the list';

        const cpsIn = textField(grid, 'Avg CPS', sub.cps == null ? '' : String(sub.cps));
        cpsIn.placeholder = 'optional';
        const minIn = numField(grid, 'Min %', 0, 0, 100);
        minIn.step = '0.01';

        const verIn = textField(grid, 'Verifier', asked === 'possible' ? '' : '...its impossible.', 60);
        const gdIn = textField(grid, 'Made in', '2.2', 10);
        main.appendChild(grid);

        const tagBox = el('div', 'tag-picker');
        main.appendChild(el('div', 'tag-picker-head', 'Tags'));
        main.appendChild(tagBox);
        const getTags = tagPicker(tagBox, []);

        const preview = el('div', 'q-preview');
        main.appendChild(preview);

        let ptsToken = 0;
        const updatePoints = async () => {
            const mine = ++ptsToken;
            const pos = clampPos(Number(posIn.value), listIn.value);
            const { data, error } = await WB.client.rpc('position_points',
                { p_position: pos, p_list: listIn.value });
            if (mine !== ptsToken) return;
            ptsIn.value = error ? 'automatic' : WB.fmtPoints(data);
        };

        const updatePreview = () => {
            preview.textContent = previewText(sub, Number(posIn.value), listIn.value);
            updatePoints();
        };
        posIn.addEventListener('input', updatePreview);
        listIn.addEventListener('change', () => {

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
            minPercent: Number(minIn.value) || 0,
            tags: getTags(),
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

    function textField(grid, label, value, cap) {
        const f = el('label', 'q-field');
        f.appendChild(el('span', '', label));
        const i = el('input');
        i.type = 'text';
        i.value = value;
        if (cap) i.maxLength = cap;
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

            p_points: 250,
            p_cps: opts.cps === '' ? null : Number(opts.cps),
            p_tags: opts.tags,
            p_min_percent: opts.minPercent,
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

    function renderList() {
        const wrap = root.querySelector('.list-section');
        wrap.textContent = '';
        wrap.appendChild(el('div', 'section-head', 'The lists'));

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

        if (WB.atLeast('owner')) {
            const edit = el('button', 'btn-ghost btn-edit', 'Edit');
            edit.type = 'button';
            edit.title = 'Edit this level’s details';
            edit.addEventListener('click', () => toggleEditor(row, lvl, edit));
            row.appendChild(edit);
        } else {
            row.appendChild(el('span', ''));
        }

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

    async function moveToList(lvl, target) {
        if (busy) return;
        const count = levels.filter(l => l.list === target).length;
        const answer = prompt(
            'Move "' + lvl.name + '" to the ' + listTag(target) + '.' +
            ' Which rank should it land at? 1 is the top, and that list has ' +
            count + ' level' + (count === 1 ? '' : 's') + ' right now.' +
            ' Leave it blank to put it at the bottom.',
            '');
        if (answer === null) return;

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

    function toggleEditor(row, lvl, btn) {
        const open = row.nextElementSibling &&
            row.nextElementSibling.classList.contains('edit-row');

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
        f.name = editField(grid, 'Name', lvl.name || '', 'wide', 60);
        f.publisher = editField(grid, 'Publisher', lvl.publisher || '', 'wide', 60);
        f.image = editField(grid, 'Showcase link', lvl.image || '', 'wide', 400);
        f.verifier = editField(grid, 'Verifier', lvl.verifier || '', '', 60);
        f.level_id = editField(grid, 'Level ID', lvl.level_id || '', '', 12);

        f.points = editField(grid, 'Points',
            lvl.points == null ? '' : WB.fmtPoints(lvl.points));
        f.points.readOnly = true;
        f.points.title = 'Worked out from the place on the list';
        f.cps = editField(grid, 'Avg CPS', lvl.cps == null ? '' : String(lvl.cps));
        f.cps.placeholder = 'blank to clear';
        f.min = editField(grid, 'Min %', WB.fmtPercent(lvl.min_percent || 0));
        f.version = editField(grid, 'Made in', lvl.version || '', '', 10);
        f.added = editField(grid, 'Uploaded', lvl.added || '', '', 40);
        box.appendChild(grid);

        box.appendChild(el('div', 'edit-hint',
            'Rank and which list it is on are not here — drag it or use the box for rank. ' +
            'Points follow the rank on their own, so moving a level changes what it is worth.'));

        box.appendChild(el('div', 'tag-picker-head', 'Tags'));
        const tagBox = el('div', 'tag-picker');
        box.appendChild(tagBox);
        const getTags = tagPicker(tagBox, WB.tagsOf(lvl).map(t => t.slug));

        const tagSave = el('button', 'btn-ghost', 'Save tags');
        tagSave.type = 'button';
        tagSave.addEventListener('click', async () => {
            if (busy) return;
            busy = true;
            tagSave.disabled = true;
            tagSave.textContent = 'Saving';
            const { error } = await WB.client.rpc('set_level_tags',
                { p_level: lvl.id, p_slugs: getTags() });
            busy = false;
            tagSave.disabled = false;
            tagSave.textContent = 'Save tags';
            if (error) {

                msg.textContent = WB.errText(error);
                alert('Tags did not save.\n\n' + WB.errText(error));
                return;
            }
            msg.textContent = 'Tags saved.';
            refresh();
        });
        box.appendChild(tagSave);

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
            const minRaw = f.min.value.trim();
            const minNew = minRaw === '' ? 0 : Number(minRaw);
            if (!isFinite(minNew) || minNew < 0 || minNew > 100) {
                msg.textContent = 'Min % has to be between 0 and 100.';
                return;
            }
            const minOld = Number(lvl.min_percent) || 0;
            if (minNew > minOld && !confirm(
                'Raise the minimum to ' + WB.fmtPercent(minNew) + '%? ' +
                'Every record on this level below that is removed. This cannot be undone.')) {
                return;
            }

            busy = true;
            save.disabled = true;
            save.textContent = 'Saving';
            const { data: wiped, error } = await WB.client.rpc('edit_level', {
                p_level: lvl.id,
                p_name: f.name.value,
                p_publisher: f.publisher.value,
                p_level_id: f.level_id.value,

                p_points: null,
                p_verifier: f.verifier.value,
                p_version: f.version.value,
                p_added: f.added.value,
                p_image: f.image.value,
                p_cps: cps === '' ? null : Number(cps),

                p_clear_cps: cps === '',
                p_min_percent: minNew === minOld ? null : minNew
            });
            busy = false;
            save.disabled = false;
            save.textContent = 'Save';

            if (error) {
                msg.textContent = WB.errText(error);
                return;
            }
            if (wiped > 0) {
                alert(wiped === 1
                    ? '1 record was below the new minimum and has been removed.'
                    : wiped + ' records were below the new minimum and have been removed.');
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

    function editField(grid, label, value, cls, cap) {
        const wrap = el('label', 'edit-field' + (cls ? ' ' + cls : ''));
        wrap.appendChild(el('span', '', label));
        const input = el('input');
        input.type = 'text';
        input.value = value;
        if (cap) input.maxLength = cap;
        wrap.appendChild(input);
        grid.appendChild(wrap);
        return input;
    }

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

            const box = row.getBoundingClientRect();
            step = box.height + 8;

            row.classList.add('dragging');
            listEl.classList.add('drag-active');

            try { grip.setPointerCapture(e.pointerId); } catch (err) {  }
        });

        listEl.addEventListener('pointermove', e => {
            if (!row) return;
            const dy = e.clientY - startY;
            row.style.transform = 'translateY(' + dy + 'px)';

            const next = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
            if (next === to) return;
            to = next;

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
