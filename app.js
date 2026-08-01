'use strict';
(function () {
    // Public, read-only leaderboard. Data comes from data/levels.js, loaded so that
    // this works both on file:// and on the deployed site.
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

    function getData() {
        const g = window.WBDL_LEVELS;
        return g && Array.isArray(g.levels) ? g.levels : [];
    }

    // Parsing rules live in loader.js so the record form uses the same ones.
    const loadData = window.WBDLLoad;

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

            const who = document.createElement('div');
            who.className = 'rec-player';
            who.textContent = rec.player || 'unknown';

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

    function showEmpty() {
        levelListEl.textContent = '';
        const msg = document.createElement('div');
        msg.className = 'li-pub';
        msg.style.padding = '14px';
        msg.textContent = 'No level data found — make sure data/levels.js is present next to this page.';
        levelListEl.appendChild(msg);
    }

    // init
    loadData('data/levels.js', 'WBDL_LEVELS').then(levelsData => {
        if (levelsData) window.WBDL_LEVELS = levelsData;

        levels = getData();
        if (levels.length) {
            renderList();
            selectLevel(0);
        } else {
            showEmpty();
        }
    });
})();
