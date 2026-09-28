'use strict';
(function () {

    const el = WB.el;

    const onPage = !!document.getElementById('notifRoot');

    let items = [];
    let seen = 0;

    function seenKey(id) { return 'wbpill_seen_' + id; }
    function hideKey(id) { return 'wbpll_hidden_' + id; }
    function readHidden(id) {
        try { return new Set(JSON.parse(localStorage.getItem(hideKey(id)) || '[]')); }
        catch (err) { return new Set(); }
    }
    function writeHidden(id, set) {
        try { localStorage.setItem(hideKey(id), JSON.stringify(Array.from(set).slice(-500))); }
        catch (err) {  }
    }
    let hidden = new Set();
    function keyOf(it) { return it.type + ':' + it.id; }
    function readSeen(id) {
        try { return Number(localStorage.getItem(seenKey(id))) || 0; }
        catch (err) { return 0; }
    }
    function writeSeen(id, when) {
        try { localStorage.setItem(seenKey(id), String(when)); }
        catch (err) {  }
    }
    function stamp(iso) {
        const t = Date.parse(iso || '');
        return isNaN(t) ? 0 : t;
    }

    function clip(s) {
        const t = String(s == null ? '' : s);
        return t.length > 160 ? t.slice(0, 160) + '…' : t;
    }

    const LABEL = {
        'record-approved': 'Record accepted',
        'record-denied': 'Record denied',
        'level-approved': 'Level accepted',
        'level-denied': 'Level rejected',
        'new-record': 'New record submission',
        'new-level': 'New level submission'
    };

    async function load(user) {
        const jobs = [
            WB.client.from('record_submissions')
                .select('id, status, note, percent, reviewed_at, levels ( name )')
                .eq('account_id', user.id).neq('status', 'pending')
                .order('reviewed_at', { ascending: false }).limit(40),
            WB.client.from('level_submissions')
                .select('id, status, note, name, reviewed_at')
                .eq('account_id', user.id).neq('status', 'pending')
                .order('reviewed_at', { ascending: false }).limit(40)
        ];

        if (WB.atLeast('moderator')) {
            jobs.push(WB.client.from('record_submissions')
                .select('id, player, percent, account_name, created_at, levels ( name )')
                .eq('status', 'pending')
                .order('created_at', { ascending: false }).limit(40));
        }
        if (WB.atLeast('admin')) {
            jobs.push(WB.client.from('level_submissions')
                .select('id, name, publisher, account_name, created_at')
                .eq('status', 'pending')
                .order('created_at', { ascending: false }).limit(40));
        }

        const res = await Promise.all(jobs);
        const out = [];

        ((res[0] && res[0].data) || []).forEach(r => out.push({
            id: r.id,
            type: 'record-' + r.status,
            subject: WB.fmtPercent(r.percent) + '% on ' + (r.levels ? r.levels.name : 'a level'),
            note: r.note,
            denied: r.status !== 'approved',
            at: stamp(r.reviewed_at)
        }));

        ((res[1] && res[1].data) || []).forEach(l => out.push({
            id: l.id,
            type: 'level-' + l.status,
            subject: l.name,
            note: l.note,
            denied: l.status !== 'approved',
            at: stamp(l.reviewed_at)
        }));

        ((res[2] && res[2].data) || []).forEach(r => out.push({
            id: r.id,
            type: 'new-record',
            subject: (r.player || 'someone') + ' · ' + WB.fmtPercent(r.percent) + '% on ' +
                (r.levels ? r.levels.name : 'a level'),
            href: 'modtools.html',
            at: stamp(r.created_at)
        }));

        ((res[3] && res[3].data) || []).forEach(l => out.push({
            id: l.id,
            type: 'new-level',
            subject: l.name + ' by ' + (l.publisher || 'unknown'),
            href: 'admintools.html',
            at: stamp(l.created_at)
        }));

        out.sort((a, b) => b.at - a.at);
        return out;
    }

    function buildBell(user) {
        const slot = document.getElementById('navAccount');
        if (!slot) return;

        const wrap = el('span', 'notif-wrap');
        const link = el('a', 'notif-btn');
        link.href = 'notification.html';
        link.title = 'Notifications';
        link.setAttribute('aria-label', 'Notifications');
        link.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
            '<path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
        wrap.appendChild(link);

        const unread = items.filter(it => !hidden.has(keyOf(it)) && it.at > seen).length;
        if (unread) {
            link.classList.add('has-unread');
            wrap.appendChild(el('span', 'notif-dot', unread > 9 ? '9+' : String(unread)));
        }

        const out = slot.querySelector('.acct-out');
        if (out) slot.insertBefore(wrap, out);
        else slot.appendChild(wrap);
    }

    function renderPage(user) {
        const root = document.getElementById('notifRoot');
        if (!root) return;
        root.textContent = '';

        const head = el('div', 'notif-bar');
        head.appendChild(el('h1', 'notif-h1', 'Notifications'));

        const shown = items.filter(it => !hidden.has(keyOf(it)));

        const unread = shown.filter(it => it.at > seen).length;
        if (unread) {
            const btn = el('button', 'btn-readall', 'Read all');
            btn.type = 'button';
            btn.addEventListener('click', () => {
                seen = items.length ? items[0].at : Date.now();
                writeSeen(user.id, seen);
                renderPage(user);
                const dot = document.querySelector('.notif-dot');
                if (dot) dot.remove();
                const bell = document.querySelector('.notif-btn');
                if (bell) bell.classList.remove('has-unread');
            });
            head.appendChild(btn);
        }

        if (shown.length) {
            const clear = el('button', 'btn-ghost', 'Clear all');
            clear.type = 'button';
            clear.addEventListener('click', () => {
                if (!confirm('Clear every notification from this device?')) return;
                shown.forEach(it => hidden.add(keyOf(it)));
                writeHidden(user.id, hidden);
                seen = items.length ? items[0].at : Date.now();
                writeSeen(user.id, seen);
                renderPage(user);
                const dot = document.querySelector('.notif-dot');
                if (dot) dot.remove();
                const bell = document.querySelector('.notif-btn');
                if (bell) bell.classList.remove('has-unread');
            });
            head.appendChild(clear);
        }
        root.appendChild(head);

        if (!shown.length) {
            root.appendChild(el('div', 'notif-none',
                'Nothing yet. When a level or record of yours is reviewed, it turns up here.'));
            return;
        }

        const list = el('div', 'notif-list');
        shown.forEach(it => list.appendChild(pageRow(it, user)));
        root.appendChild(list);
    }

    function pageRow(it, user) {
        const fresh = it.at > seen;
        const r = el('div', 'nrow' + (fresh ? ' fresh' : '') + (it.denied ? ' clickable' : ''));

        const line = el('div', 'nrow-line');
        line.appendChild(el('span', 'nrow-label lb-' + it.type, LABEL[it.type] + ':'));
        line.appendChild(el('span', 'nrow-subject', clip(it.subject)));
        if (it.at) line.appendChild(el('span', 'nrow-when', WB.fmtWhen(new Date(it.at).toISOString())));

        const x = el('button', 'nrow-x', '×');
        x.type = 'button';
        x.title = 'Remove this notification';
        x.addEventListener('click', ev => {
            ev.stopPropagation();
            hidden.add(keyOf(it));
            writeHidden(user.id, hidden);
            r.remove();
        });
        line.appendChild(x);
        r.appendChild(line);

        if (it.href) {
            const go = el('a', 'nrow-go', 'Open the queue →');
            go.href = it.href;
            r.appendChild(go);
        }

        if (it.denied) {
            r.appendChild(el('div', 'nrow-more', 'Click to see why'));
            r.appendChild(el('div', 'nrow-reason', clip(it.note) || 'No reason was given.'));
            r.addEventListener('click', () => {
                const open = r.classList.toggle('open');
                r.querySelector('.nrow-more').textContent = open ? 'Click to hide' : 'Click to see why';
            });
        }
        return r;
    }

    WB.ready().then(async () => {
        const user = WB.user();
        const root = document.getElementById('notifRoot');

        if (!user || !WB.client) {
            if (root) {
                root.textContent = '';
                root.appendChild(el('h1', 'notif-h1', 'Notifications'));
                root.appendChild(el('div', 'notif-none', 'Sign in to see yours.'));
            }
            return;
        }

        seen = readSeen(user.id);
        hidden = readHidden(user.id);
        try {
            items = await load(user);
        } catch (err) {
            console.error('Could not load notifications:', err);
            items = [];
        }

        buildBell(user);
        if (onPage) renderPage(user);
    });
})();
