'use strict';
(function () {
    // Public, read-only leaderboard + ILL. Data comes from data/levels.js and
    // data/ill.js (loaded as <script>, so this works on file:// and on Vercel).
    const levelListEl = document.getElementById('levelList');
    const hero = {
        title: document.getElementById('heroTitle'),
        pub: document.getElementById('heroPub'),
        id: document.getElementById('heroId'),
        version: document.getElementById('heroVersion'),
        uploaded: document.getElementById('heroUploaded'),
        media: document.getElementById('heroMedia'),
        verifier: document.getElementById('heroVerifier')
    };
    const leaderboardView = document.getElementById('leaderboardView');
    const illView = document.getElementById('illView');
    const illList = document.getElementById('illList');
    const navIll = document.getElementById('navIll');

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

    // Load a data/*.js file. On the deployed (http/https) site we fetch it as TEXT and
    // pull the JSON object out of it, so the data is parsed as inert data and never
    // executed as code. On file:// (local double-click), fetch is blocked, so we fall
    // back to loading it as a <script> that sets the global — fine for your own machine.
    function loadData(path, globalName) {
        if (location.protocol === 'file:') {
            return new Promise(resolve => {
                const sc = document.createElement('script');
                sc.src = path;
                sc.onload = () => resolve(window[globalName] || null);
                sc.onerror = () => resolve(null);
                document.head.appendChild(sc);
            });
        }
        return fetch(path)
            .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
            .then(text => {
                const start = text.indexOf('{');
                const end = text.lastIndexOf('}');
                if (start < 0 || end <= start) throw new Error('no object in ' + path);
                return JSON.parse(text.slice(start, end + 1));
            })
            .catch(() => null);
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

    function getIllEntries() {
        const g = window.WBDL_ILL;
        if (!g) return [];
        if (Array.isArray(g)) return g;
        if (Array.isArray(g.entries)) return g.entries;
        if (Array.isArray(g.ill)) return g.ill;
        return [];
    }

    function renderIll() {
        illList.textContent = '';
        const entries = getIllEntries();
        if (!entries.length) {
            const msg = document.createElement('div');
            msg.className = 'cl-body';
            msg.textContent = 'No ILL entries yet.';
            illList.appendChild(msg);
            return;
        }
        entries.forEach(e => {
            const card = document.createElement('div');
            card.className = 'cl-card';
            if (e.date) {
                const d = document.createElement('div');
                d.className = 'cl-date';
                d.textContent = e.date;
                card.appendChild(d);
            }
            if (e.title) {
                const t = document.createElement('div');
                t.className = 'cl-title';
                t.textContent = e.title;
                card.appendChild(t);
            }
            if (e.body) {
                const b = document.createElement('div');
                b.className = 'cl-body';
                b.textContent = e.body;
                card.appendChild(b);
            }
            illList.appendChild(card);
        });
    }

    function route() {
        const isIll = (location.hash || '').replace('#', '').toLowerCase() === 'ill';
        leaderboardView.style.display = isIll ? 'none' : '';
        illView.style.display = isIll ? '' : 'none';
        if (navIll) navIll.classList.toggle('active', isIll);
        if (isIll) renderIll();
        window.scrollTo(0, 0);
    }

    // init
    Promise.all([
        loadData('data/levels.js', 'WBDL_LEVELS'),
        loadData('data/ill.js', 'WBDL_ILL')
    ]).then(([levelsData, illData]) => {
        if (levelsData) window.WBDL_LEVELS = levelsData;
        if (illData) window.WBDL_ILL = illData;

        levels = getData();
        if (levels.length) {
            renderList();
            selectLevel(0);
        } else {
            showEmpty();
        }
        window.addEventListener('hashchange', route);
        route();
    });
})();
