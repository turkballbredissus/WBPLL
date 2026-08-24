'use strict';
(function () {
    // Public, read-only leaderboard. The list lives in Supabase, so an approval
    // in Admin Tools shows up here on the next load with nothing to push. There
    // is no local copy of the list any more: if the database cannot be reached,
    // the page says so rather than showing an empty list as if it were the truth.
    const levelListEl = document.getElementById('levelList');
    const hero = {
        title: document.getElementById('heroTitle'),
        pub: document.getElementById('heroPub'),
        id: document.getElementById('heroId'),
        version: document.getElementById('heroVersion'),
        uploaded: document.getElementById('heroUploaded'),
        media: document.getElementById('heroMedia'),
        verifier: document.getElementById('heroVerifier'),
        records: document.getElementById('heroRecords')
    };
    let levels = [];
    let people = {};   // account id -> {display_name, role}, for tinting names
    let list = WB.currentList();

    function formatPoints(p) {
        const n = Number(p);
        return (Number.isFinite(n) ? n : 0).toFixed(2);
    }

    // Detect a YouTube link (watch, youtu.be, embed, shorts) and return its 11-char id.
    function youtubeId(url) {
        if (typeof url !== 'string') return null;
        const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }
    function safeImageUrl(url) {
        if (typeof url !== 'string') return '';
        const u = url.trim();
        return /^https?:\/\//i.test(u) ? u.replace(/["\\]/g, '') : '';
    }

    // The database columns and the old file format are not quite the same
    // shape, so everything is normalised here and the rendering below never
    // has to care which one it came from.
    function fromDatabase(rows) {
        return rows.map(function (r) {
            return {
                name: r.name,
                publisher: r.publisher,
                points: r.points,
                verifier: r.verifier,
                id: r.level_id,
                version: r.version,
                added: r.added,
                image: r.image,
                records: Array.isArray(r.records) ? r.records : []
            };
        });
    }

    // Resolves to an array on success, or a string explaining what went wrong.
    async function loadLevels() {
        if (!WB.configured) {
            return 'The list is not connected to its database yet.';
        }
        const { data, error } = await WB.client
            .from('levels')
            .select('id, position, name, publisher, level_id, points, verifier, version, added, image, records ( player, percent, proof, account_id )')
            .eq('list', list)
            .order('position', { ascending: true });

        if (error) {
            console.error('Could not load the list:', error.message);
            return 'Could not reach the list right now. Try again in a minute.';
        }
        return fromDatabase(data || []);
    }

    function renderList() {
        levelListEl.textContent = '';
        levels.forEach((lvl, i) => {
            const item = document.createElement('div');
            item.className = 'level-item';

            const thumb = document.createElement('div');
            thumb.className = 'thumb';
            const yt = youtubeId(lvl.image);
            const img = safeImageUrl(lvl.image);
            if (yt) thumb.style.backgroundImage = `url("https://img.youtube.com/vi/${yt}/hqdefault.jpg")`;
            else if (img) thumb.style.backgroundImage = `url("${img}")`;

            const rank = document.createElement('div');
            rank.className = 'rank';
            rank.textContent = '#' + (i + 1);

            const content = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'li-name';
            name.textContent = lvl.name || '';
            const pub = document.createElement('div');
            pub.className = 'li-pub';
            pub.textContent = 'published by ' + (lvl.publisher || 'unknown');
            const pts = document.createElement('div');
            pts.className = 'li-pts';
            const strong = document.createElement('b');
            strong.textContent = formatPoints(lvl.points);
            pts.append(strong, document.createTextNode(' (100%) points'));

            content.append(name, pub, pts);
            item.append(thumb, rank, content);
            item.addEventListener('click', () => selectLevel(i));
            levelListEl.appendChild(item);
        });
    }

    function setMedia(lvl) {
        hero.media.textContent = '';
        hero.media.style.backgroundImage = '';
        const yt = youtubeId(lvl.image);
        if (yt) {
            const iframe = document.createElement('iframe');
            iframe.src = 'https://www.youtube.com/embed/' + yt;
            iframe.title = (lvl.name || 'Level') + ' video';
            iframe.loading = 'lazy';
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            iframe.allowFullscreen = true;
            hero.media.appendChild(iframe);
            return;
        }
        const img = safeImageUrl(lvl.image);
        hero.media.style.backgroundImage = img ? `url("${img}")` : 'linear-gradient(135deg, #1c1c20, #0e0e10)';
    }

    // Nobody finishes these levels, so a record is how far someone got. Highest first.
    function renderRecords(lvl) {
        if (!hero.records) return;
        hero.records.textContent = '';

        const list = Array.isArray(lvl.records) ? lvl.records.slice() : [];
        list.sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0));

        const head = document.createElement('div');
        head.className = 'rec-head';
        head.textContent = list.length
            ? 'Records (' + list.length + ')'
            : 'Records';
        hero.records.appendChild(head);

        if (!list.length) {
            const none = document.createElement('div');
            none.className = 'rec-none';
            none.textContent = 'No records on this level yet.';
            hero.records.appendChild(none);
            return;
        }

        list.forEach((rec, idx) => {
            const row = document.createElement('div');
            row.className = 'rec-row';

            const pos = document.createElement('div');
            pos.className = 'rec-pos';
            pos.textContent = '#' + (idx + 1);

            // The player name is whatever they typed, but if it came from an
            // account we can tint it by rank and link through to the profile.
            const acct = rec.account_id ? people[rec.account_id] : null;
            const who = document.createElement('div');
            who.className = 'rec-player';
            who.appendChild(acct
                ? WB.profileLink(rec.player || acct.display_name, acct.role, acct.id)
                : document.createTextNode(rec.player || 'unknown'));

            const pct = document.createElement('div');
            pct.className = 'rec-pct';
            pct.textContent = (Number(rec.percent) || 0) + '%';

            row.append(pos, who, pct);

            const proof = safeImageUrl(rec.proof);
            if (proof) {
                const a = document.createElement('a');
                a.className = 'rec-proof';
                a.href = proof;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = 'proof';
                row.appendChild(a);
            }
            hero.records.appendChild(row);
        });
    }

    function selectLevel(i) {
        const lvl = levels[i];
        if (!lvl) return;
        hero.title.textContent = '#' + (i + 1) + ' - ' + (lvl.name || '');
        hero.pub.textContent = lvl.publisher || 'unknown';
        hero.id.textContent = lvl.id || '—';
        hero.version.textContent = lvl.version || '2.2';
        hero.uploaded.textContent = lvl.added || 'TBD';
        hero.verifier.textContent = lvl.verifier || '—';
        setMedia(lvl);
        renderRecords(lvl);
        Array.from(levelListEl.children).forEach((el, idx) => el.classList.toggle('active', idx === i));
    }

    // With nothing to show, the hero is an empty shell full of dashes, which
    // reads as broken rather than as empty. Take it away and leave the reason.
    // Two tabs above the list. Switching re-queries rather than filtering in
    // the page, so a long list never has to be downloaded twice over.
    function renderSwitch() {
        const wrap = document.getElementById('listSwitch');
        if (!wrap) return;
        wrap.textContent = '';

        WB.LISTS.forEach(l => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'lswitch' + (l.key === list ? ' active' : '');
            tab.dataset.list = l.key;

            const big = document.createElement('span');
            big.className = 'lswitch-name';
            big.textContent = l.short;
            const small = document.createElement('span');
            small.className = 'lswitch-sub';
            small.textContent = l.long;
            tab.append(big, small);

            tab.addEventListener('click', () => {
                if (l.key === list) return;
                list = l.key;
                WB.rememberList(list);
                // Keep the address bar honest, so a tab can be linked to.
                // Only the query is replaced, so the file name survives, and
                // a browser that refuses (file:// does) must not take the
                // click down with it.
                try { history.replaceState(null, '', '?list=' + list); }
                catch (err) { /* the switch still works, the URL just will not say so */ }
                renderSwitch();
                refresh();
            });
            wrap.appendChild(tab);
        });
    }

    async function refresh() {
        levelListEl.textContent = '';
        const loading = document.createElement('div');
        loading.className = 'li-pub';
        loading.style.padding = '14px';
        loading.textContent = 'Loading…';
        levelListEl.appendChild(loading);

        const article = document.querySelector('.hero');
        if (article) article.classList.remove('hidden');

        const result = await loadLevels();
        if (typeof result === 'string') {
            showMessage(result);
            return;
        }
        levels = result;
        if (levels.length) {
            renderList();
            selectLevel(0);
        } else {
            showMessage('Nothing on the ' + WB.listInfo(list).long.toLowerCase() +
                ' list yet. Submit something and it could be first.');
        }
    }

    function showMessage(text) {
        levelListEl.textContent = '';
        const msg = document.createElement('div');
        msg.className = 'li-pub';
        msg.style.padding = '14px';
        msg.textContent = text;
        levelListEl.appendChild(msg);

        const article = document.querySelector('.hero');
        if (article) article.classList.add('hidden');
    }

    // init - wait for the session so the nav is settled, then load the roster
    // once (record names are tinted by rank) and the chosen list.
    WB.ready()
        .then(() => WB.people())
        .then(roster => {
            people = roster || {};
            renderSwitch();
            return refresh();
        });
})();
