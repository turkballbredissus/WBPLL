'use strict';
(function () {
    // The bell next to your name. There is no notifications table behind this -
    // a notification IS one of your own submissions once somebody has reviewed
    // it, which the queues already record. That means nothing extra to keep in
    // sync, and a decision can never go missing.
    //
    // What counts as unread is kept in this browser, not the database, so the
    // badge is per-device. Signing in somewhere else shows the recent ones as
    // new again. For a list this size that is a fair trade for no extra table.
    const el = WB.el;

    let items = [];
    let panel = null;
    let openRow = null;

    function seenKey(userId) { return 'wbpill_seen_' + userId; }

    function lastSeen(userId) {
        try { return Number(localStorage.getItem(seenKey(userId))) || 0; }
        catch (err) { return 0; }   // private mode, or storage switched off
    }
    function markSeen(userId, when) {
        try { localStorage.setItem(seenKey(userId), String(when)); }
        catch (err) { /* not worth failing over */ }
    }

    function stamp(iso) {
        const t = Date.parse(iso || '');
        return isNaN(t) ? 0 : t;
    }

    // His words: a record is denied, a level is rejected.
    function label(it) {
        if (it.kind === 'record') return it.status === 'approved' ? 'Record accepted' : 'Record denied';
        return it.status === 'approved' ? 'Level accepted' : 'Level rejected';
    }

    function detail(it) {
        if (it.kind === 'record') {
            return it.percent + '% on ' + (it.subject || 'a level');
        }
        return it.subject || 'your level';
    }

    async function load(userId) {
        const recs = WB.client
            .from('record_submissions')
            .select('id, status, note, percent, reviewed_at, levels ( name )')
            .eq('account_id', userId)
            .neq('status', 'pending')
            .order('reviewed_at', { ascending: false })
            .limit(30);

        const lvls = WB.client
            .from('level_submissions')
            .select('id, status, note, name, reviewed_at')
            .eq('account_id', userId)
            .neq('status', 'pending')
            .order('reviewed_at', { ascending: false })
            .limit(30);

        const [a, b] = await Promise.all([recs, lvls]);

        const out = [];
        ((a && a.data) || []).forEach(r => out.push({
            kind: 'record',
            status: r.status,
            note: r.note,
            percent: r.percent,
            subject: r.levels ? r.levels.name : '',
            at: stamp(r.reviewed_at)
        }));
        ((b && b.data) || []).forEach(l => out.push({
            kind: 'level',
            status: l.status,
            note: l.note,
            subject: l.name,
            at: stamp(l.reviewed_at)
        }));

        out.sort((x, y) => y.at - x.at);
        return out;
    }

    function build(userId) {
        const slot = document.getElementById('navAccount');
        if (!slot) return;

        const wrap = el('span', 'notif-wrap');

        const btn = el('button', 'notif-btn');
        btn.type = 'button';
        btn.title = 'Notifications';
        btn.setAttribute('aria-label', 'Notifications');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
            '<path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
        wrap.appendChild(btn);

        const unread = items.filter(it => it.at > lastSeen(userId)).length;
        if (unread) {
            btn.classList.add('has-unread');
            wrap.appendChild(el('span', 'notif-dot', unread > 9 ? '9+' : String(unread)));
        }

        btn.addEventListener('click', e => {
            e.stopPropagation();
            togglePanel(wrap, userId);
        });

        // The sign-out button stays last, so the bell goes just before it.
        const out = slot.querySelector('.acct-out');
        if (out) slot.insertBefore(wrap, out);
        else slot.appendChild(wrap);
    }

    function togglePanel(wrap, userId) {
        if (panel) {
            closePanel();
            return;
        }
        panel = el('div', 'notif-panel');

        const head = el('div', 'notif-title', items.length ? 'Notifications' : 'Nothing yet');
        panel.appendChild(head);

        if (!items.length) {
            panel.appendChild(el('div', 'notif-empty',
                'When a level or record of yours is reviewed, it shows up here.'));
        } else {
            items.forEach(it => panel.appendChild(row(it, userId)));
        }

        panel.addEventListener('click', e => e.stopPropagation());
        wrap.appendChild(panel);

        // Opening it counts as reading it.
        const newest = items.length ? items[0].at : Date.now();
        markSeen(userId, newest);
        const dot = wrap.querySelector('.notif-dot');
        if (dot) dot.remove();
        wrap.querySelector('.notif-btn').classList.remove('has-unread');

        document.addEventListener('click', closePanel);
        document.addEventListener('keydown', escClose);
    }

    function row(it, userId) {
        const denied = it.status !== 'approved';
        const r = el('div', 'notif-row' + (denied ? ' clickable' : ''));
        if (it.at > lastSeen(userId)) r.classList.add('fresh');

        const top = el('div', 'notif-head');
        top.appendChild(el('span', 'notif-tag tag-' + it.status, label(it)));
        if (it.at) top.appendChild(el('span', 'notif-when', WB.fmtWhen(new Date(it.at).toISOString())));
        r.appendChild(top);

        r.appendChild(el('div', 'notif-what', detail(it)));

        if (denied) {
            r.appendChild(el('div', 'notif-more', 'Click to see why'));

            const reason = el('div', 'notif-reason',
                it.note ? it.note : 'No reason was given.');
            r.appendChild(reason);

            r.addEventListener('click', () => {
                const opening = openRow !== r;
                // One reason open at a time, so the panel only has to be wide
                // for the thing you are actually reading.
                if (openRow) openRow.classList.remove('open');
                openRow = opening ? r : null;
                if (opening) r.classList.add('open');
                panel.classList.toggle('wide', opening);
                const more = r.querySelector('.notif-more');
                if (more) more.textContent = opening ? 'Click to hide' : 'Click to see why';
            });
        }
        return r;
    }

    function closePanel() {
        if (!panel) return;
        panel.remove();
        panel = null;
        openRow = null;
        document.removeEventListener('click', closePanel);
        document.removeEventListener('keydown', escClose);
    }

    function escClose(e) {
        if (e.key === 'Escape') closePanel();
    }

    WB.ready().then(async () => {
        const user = WB.user();
        if (!user || !WB.client) return;
        try {
            items = await load(user.id);
        } catch (err) {
            console.error('Could not load notifications:', err);
            items = [];
        }
        build(user.id);
    });
})();
