'use strict';
(function () {
    // Record review. Moderators and up land here; every pending record shows as
    // one card in a single run down the page, oldest first, with Accept and Deny
    // on each. The card carries exactly what the submitter sent.
    const root = document.getElementById('toolsRoot');
    const el = WB.el;

    let queue = [];
    let liveRecords = [];   // used to warn when accepting replaces an old record
    let history = [];
    let people = {};        // account id -> {display_name, role}
    let bannerQueue = [];   // banners waiting on a decision
    let busy = false;

    // The submitter's name, tinted by rank and linked to their profile, so you
    // can see at a glance whether a stranger or a mod sent something.
    function sentBy(sub) {
        const acct = sub.account_id ? people[sub.account_id] : null;
        return acct
            ? WB.profileLink(sub.account_name || acct.display_name, acct.role, acct.id)
            : WB.nameEl(sub.account_name || 'unknown', 'user');
    }

    WB.guard('moderator', root).then(ok => {
        if (ok) start();
    });

    async function start() {
        root.textContent = '';
        root.appendChild(header());
        root.appendChild(el('div', 'queue', ''));
        root.appendChild(el('div', 'section banner-section', ''));
        root.appendChild(el('div', 'section live-section', ''));
        root.appendChild(el('div', 'hist', ''));
        await refresh();
    }

    function header() {
        const h = el('div', 'tools-head');
        h.appendChild(el('h1', 'form-title', 'Mod Tools'));
        const sub = el('p', 'form-intro',
            'Records waiting on a decision. Accepting puts the record under its level straight away.');
        h.appendChild(sub);

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

        // Embedding levels(...) works off the foreign key, so a record always
        // shows the level it belongs to even after the list gets reordered.
        const pending = WB.client
            .from('record_submissions')
            .select('id, player, percent, proof, account_id, account_name, created_at, level_row_id, levels ( name, position )')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });

        const existing = WB.client
            .from('records')
            .select('id, level_row_id, player, percent, proof, levels ( name, position )')
            .order('percent', { ascending: false });

        const past = WB.client
            .from('record_submissions')
            .select('id, player, percent, status, note, reviewer_name, reviewed_at, levels ( name )')
            .neq('status', 'pending')
            .order('reviewed_at', { ascending: false })
            .limit(20);

        const banners = WB.client
            .from('banner_submissions')
            .select('id, url, account_id, account_name, created_at, level_row_id, levels ( name, position, list, banner )')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });

        const [a, b, c, roster, d] = await Promise.all([pending, existing, past, WB.people(), banners]);
        people = roster || {};
        bannerQueue = (d && d.data) || [];

        if (a.error) {
            list.textContent = '';
            list.appendChild(el('div', 'q-error', WB.errText(a.error)));
            return;
        }
        queue = a.data || [];
        liveRecords = (b && b.data) || [];
        history = (c && c.data) || [];
        render();
    }

    function render() {
        const list = root.querySelector('.queue');
        list.textContent = '';
        document.getElementById('queueCount').textContent =
            queue.length === 0 ? 'Nothing waiting'
                : queue.length === 1 ? '1 record waiting'
                    : queue.length + ' records waiting';

        if (!queue.length) {
            list.appendChild(el('div', 'q-empty', 'The queue is empty. Nothing to review right now.'));
        } else {
            queue.forEach(sub => list.appendChild(card(sub)));
        }
        renderBanners();
        renderLive();
        renderHistory();
    }

    // Accepting is otherwise a one-way door: nothing else on the site can take a
    // record back off a level once it is up.
    function renderLive() {
        const wrap = root.querySelector('.live-section');
        wrap.textContent = '';
        wrap.appendChild(el('div', 'section-head', 'Records on the list'));
        wrap.appendChild(el('div', 'section-sub', WB.atLeast('owner')
            ? 'Everything currently showing under a level. Remove one if it turns out to be wrong.'
            : 'Everything currently showing under a level. Only the owner can take one back off.'));

        if (!liveRecords.length) {
            wrap.appendChild(el('div', 'q-empty', 'No records accepted yet.'));
            return;
        }

        // Group under their level so the list reads the same way the site does.
        const byLevel = new Map();
        liveRecords.forEach(r => {
            const key = r.level_row_id;
            if (!byLevel.has(key)) byLevel.set(key, []);
            byLevel.get(key).push(r);
        });

        Array.from(byLevel.values())
            .sort((a, b) => (a[0].levels ? a[0].levels.position : 999) - (b[0].levels ? b[0].levels.position : 999))
            .forEach(group => {
                const head = group[0].levels
                    ? '#' + group[0].levels.position + '  ' + group[0].levels.name
                    : 'unknown level';
                wrap.appendChild(el('div', 'live-level', head));

                group.forEach(r => {
                    const row = el('div', 'list-row');
                    row.appendChild(el('span', 'rank', r.percent + '%'));
                    row.appendChild(el('div', 'li-name', r.player));

                    if (r.proof) {
                        const a = el('a', 'rec-proof', 'proof');
                        a.href = r.proof;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        row.appendChild(a);
                    } else {
                        row.appendChild(el('span', ''));
                    }

                    // Removing is owner-only, enforced in the database. The
                    // button is simply absent for everyone else rather than
                    // being there to fail.
                    if (WB.atLeast('owner')) {
                        const del = el('button', 'btn-remove', '×');
                        del.type = 'button';
                        del.title = 'Take this record off the level';
                        del.addEventListener('click', () => removeRecord(r));
                        row.appendChild(del);
                    } else {
                        row.appendChild(el('span', ''));
                    }
                    wrap.appendChild(row);
                });
            });
    }

    async function removeRecord(rec) {
        if (busy) return;
        if (!confirm("Take " + rec.player + "'s " + rec.percent + '% off the level?')) return;
        busy = true;
        const { error } = await WB.client.from('records').delete().eq('id', rec.id);
        busy = false;
        if (error) alert(WB.errText(error));
        refresh();
    }

    function card(sub) {
        const c = el('div', 'qcard');
        c.dataset.id = sub.id;

        const pct = el('div', 'q-pct', sub.percent + '%');
        c.appendChild(pct);

        const main = el('div', 'q-main');

        const line = el('div', 'q-line');
        line.appendChild(el('b', '', sub.player || 'unknown'));
        line.appendChild(el('span', 'q-on', ' on '));
        const lvl = sub.levels
            ? '#' + sub.levels.position + '  ' + sub.levels.name
            : 'a level that is no longer on the list';
        line.appendChild(el('span', 'q-level', lvl));
        main.appendChild(line);

        const meta = el('div', 'q-meta');
        const by = el('span', '', 'sent by ');
        by.appendChild(sentBy(sub));
        meta.appendChild(by);
        if (sub.created_at) meta.appendChild(el('span', '', WB.fmtWhen(sub.created_at)));
        main.appendChild(meta);

        // Accepting wipes that player's old record on the same level, so say so
        // before it happens rather than after.
        const clash = liveRecords.find(r =>
            r.level_row_id === sub.level_row_id &&
            (r.player || '').toLowerCase() === (sub.player || '').toLowerCase());
        if (clash) {
            main.appendChild(el('div', 'q-warn',
                'Replaces their current ' + clash.percent + '% on this level.'));
        }

        const noteIn = el('input', 'q-note');
        noteIn.type = 'text';
        noteIn.placeholder = 'Reason, only if you deny (optional)';
        noteIn.maxLength = 140;
        main.appendChild(noteIn);
        c.appendChild(main);

        const actions = el('div', 'q-actions');
        if (sub.proof) {
            const proof = el('a', 'rec-proof', 'Watch proof');
            proof.href = sub.proof;
            proof.target = '_blank';
            proof.rel = 'noopener noreferrer';
            actions.appendChild(proof);
        }

        const yes = el('button', 'btn-accept', 'Accept');
        yes.type = 'button';
        yes.addEventListener('click', () => decide(sub, 'accept', noteIn.value, c));
        actions.appendChild(yes);

        const no = el('button', 'btn-deny', 'Deny');
        no.type = 'button';
        no.addEventListener('click', () => decide(sub, 'deny', noteIn.value, c));
        actions.appendChild(no);

        c.appendChild(actions);
        return c;
    }

    async function decide(sub, what, note, cardEl) {
        if (busy) return;
        const ask = what === 'deny'
            ? 'Deny ' + sub.player + "'s " + sub.percent + '%?'
            : 'Put ' + sub.player + "'s " + sub.percent + '% on the level?';
        if (!confirm(ask)) return;

        busy = true;
        cardEl.classList.add('working');
        setCardButtons(cardEl, true);

        const call = what === 'accept'
            ? WB.client.rpc('approve_record', { p_submission: sub.id })
            : WB.client.rpc('deny_record', { p_submission: sub.id, p_note: note || null });

        const { error } = await call;
        busy = false;

        if (error) {
            cardEl.classList.remove('working');
            setCardButtons(cardEl, false);
            let msg = cardEl.querySelector('.q-error');
            if (!msg) {
                msg = el('div', 'q-error');
                cardEl.querySelector('.q-main').appendChild(msg);
            }
            msg.textContent = WB.errText(error);
            return;
        }

        // Drop it from the queue locally, then pull fresh numbers so the
        // replace-warning on other cards stays honest.
        queue = queue.filter(q => q.id !== sub.id);
        cardEl.classList.add('gone');
        setTimeout(refresh, 180);
    }

    function setCardButtons(cardEl, disabled) {
        cardEl.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
    }

    // ------------------------------------------------------------- banners

    // A banner is judged by watching it, so the card loops the clip at roughly
    // the size it will appear. The thing to look for is the seam.
    function renderBanners() {
        const wrap = root.querySelector('.banner-section');
        if (!wrap) return;
        wrap.textContent = '';
        wrap.appendChild(el('div', 'section-head',
            bannerQueue.length ? 'Banners waiting (' + bannerQueue.length + ')' : 'Banners'));
        wrap.appendChild(el('div', 'section-sub',
            'A banner sits behind a level row on the list. Watch the loop: a visible jump at the seam is the usual reason to turn one down. It replaces whatever that level has now.'));

        if (!bannerQueue.length) {
            wrap.appendChild(el('div', 'q-empty', 'No banners waiting.'));
            return;
        }

        bannerQueue.forEach(sub => {
            const c = el('div', 'qcard bancard');

            const shot = el('div', 'ban-preview');
            const v = document.createElement('video');
            v.src = sub.url;
            v.muted = true;
            v.loop = true;
            v.autoplay = true;
            v.playsInline = true;
            v.preload = 'auto';
            v.addEventListener('error', () => {
                shot.textContent = '';
                shot.appendChild(el('div', 'ban-dead', 'This link does not load'));
            });
            shot.appendChild(v);
            c.appendChild(shot);

            const main = el('div', 'q-main');
            main.appendChild(el('div', 'q-title', sub.levels
                ? '#' + sub.levels.position + '  ' + sub.levels.name
                : 'a level that is gone'));

            const meta = el('div', 'q-meta');
            const by = el('span', '', 'sent by ');
            by.appendChild(sentBy(sub));
            meta.appendChild(by);
            if (sub.created_at) meta.appendChild(el('span', '', WB.fmtWhen(sub.created_at)));
            const open = el('a', 'rec-proof', 'Open the file');
            open.href = sub.url;
            open.target = '_blank';
            open.rel = 'noopener noreferrer';
            meta.appendChild(open);
            main.appendChild(meta);

            if (sub.levels && sub.levels.banner) {
                main.appendChild(el('div', 'q-warn', 'This level already has a banner. Accepting replaces it.'));
            }

            const noteIn = el('input', 'q-note');
            noteIn.type = 'text';
            noteIn.placeholder = 'Reason, only if you deny (optional)';
            noteIn.maxLength = 140;
            main.appendChild(noteIn);
            c.appendChild(main);

            const actions = el('div', 'q-actions');
            const yes = el('button', 'btn-accept', 'Accept');
            yes.type = 'button';
            yes.addEventListener('click', () => decideBanner(sub, 'accept', noteIn.value, c));
            actions.appendChild(yes);

            const no = el('button', 'btn-deny', 'Deny');
            no.type = 'button';
            no.addEventListener('click', () => decideBanner(sub, 'deny', noteIn.value, c));
            actions.appendChild(no);
            c.appendChild(actions);

            wrap.appendChild(c);
        });
    }

    async function decideBanner(sub, what, noteText, cardEl) {
        if (busy) return;
        const where = sub.levels ? sub.levels.name : 'that level';
        if (!confirm(what === 'accept'
            ? 'Put this banner behind ' + where + '?'
            : 'Deny this banner?')) return;

        busy = true;
        setCardButtons(cardEl, true);
        const call = what === 'accept'
            ? WB.client.rpc('approve_banner', { p_submission: sub.id })
            : WB.client.rpc('deny_banner', { p_submission: sub.id, p_note: noteText || null });

        const { error } = await call;
        busy = false;
        if (error) {
            setCardButtons(cardEl, false);
            let msg = cardEl.querySelector('.q-error');
            if (!msg) {
                msg = el('div', 'q-error');
                cardEl.querySelector('.q-main').appendChild(msg);
            }
            msg.textContent = WB.errText(error);
            return;
        }
        cardEl.classList.add('gone');
        setTimeout(refresh, 180);
    }

    function renderHistory() {
        const wrap = root.querySelector('.hist');
        wrap.textContent = '';
        if (!history.length) return;

        const head = el('div', 'hist-head', 'Recently reviewed');
        wrap.appendChild(head);

        history.forEach(h => {
            const row = el('div', 'hist-row');
            row.appendChild(el('span', 'hist-tag tag-' + h.status, h.status));
            const what = (h.player || 'unknown') + ' · ' + h.percent + '%' +
                (h.levels ? ' on ' + h.levels.name : '');
            row.appendChild(el('span', 'hist-what', what));
            const by = (h.reviewer_name ? 'by ' + h.reviewer_name : '') +
                (h.reviewed_at ? ' · ' + WB.fmtWhen(h.reviewed_at) : '');
            row.appendChild(el('span', 'hist-by', by));
            if (h.note) row.appendChild(el('span', 'hist-note', '“' + h.note + '”'));
            wrap.appendChild(row);
        });
    }
})();
