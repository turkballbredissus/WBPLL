'use strict';

window.WB = (function () {
    const cfg = window.WBPILL_CONFIG || {};

    function filled(v) {
        return typeof v === 'string' && v.length > 0 && !/^PASTE_/.test(v);
    }

    const hasKeys = filled(cfg.SUPABASE_URL) && filled(cfg.SUPABASE_ANON_KEY);

    const client = (hasKeys && window.supabase && window.supabase.createClient)
        ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
        : null;
    const configured = !!client;

    const RANK = { anon: -1, user: 0, moderator: 1, admin: 2, owner: 3 };

    const LISTS = [
        { key: 'impossible', short: 'Impossible', long: 'Physically impossible' },
        { key: 'possible', short: 'Possible', long: 'Physically possible' }
    ];
    function listInfo(key) {
        return LISTS.find(l => l.key === key) || LISTS[0];
    }

    let tagsPromise = null;
    let tagCache = [];
    function tags() {
        if (!tagsPromise) {
            tagsPromise = (!client
                ? Promise.resolve([])
                : client.from('tags').select('slug, label, colour, sort')
                    .order('sort').order('label')
                    .then(res => {
                        tagCache = (res && res.data) || [];
                        return tagCache;
                    }).catch(() => []));
        }
        return tagsPromise;
    }

    function tagBySlug(slug) {
        return tagCache.find(t => t.slug === slug) || null;
    }

    function reloadTags() {
        tagsPromise = null;
        return tags();
    }

    const TAG_COLOURS = ['neutral', 'green', 'blue', 'yellow', 'orange', 'red', 'purple', 'gold'];
    function tagChip(tag) {
        const colour = TAG_COLOURS.indexOf(tag && tag.colour) >= 0 ? tag.colour : 'neutral';
        return el('span', 'tag-chip tag-c-' + colour, (tag && tag.label) || '');
    }

    function tagsOf(row) {
        const links = (row && row.level_tags) || [];
        return links.map(l => l.tags).filter(Boolean)
            .sort((a, b) => (a.sort - b.sort) || a.label.localeCompare(b.label));
    }

    function currentList() {
        const fromUrl = new URLSearchParams(location.search).get('list');
        if (LISTS.some(l => l.key === fromUrl)) return fromUrl;
        try {
            const saved = localStorage.getItem('wbpll_list');
            if (LISTS.some(l => l.key === saved)) return saved;
        } catch (err) {  }
        return 'impossible';
    }
    function rememberList(key) {
        try { localStorage.setItem('wbpll_list', key); } catch (err) {  }
    }

    let session = null;
    let profile = null;
    let readyPromise = null;

    async function load() {
        if (!client) return { session: null, profile: null };
        try {
            const { data } = await client.auth.getSession();
            session = (data && data.session) || null;
            profile = null;
            if (session) {

                const wanted = (session.user.user_metadata || {}).display_name || null;
                const res = await client.rpc('ensure_profile', { p_display_name: wanted });
                if (res.error) console.error('Could not load your profile:', res.error.message);
                profile = res.data || null;
            }
        } catch (err) {
            console.error('Could not load the session:', err);
            session = null;
            profile = null;
        }
        return { session: session, profile: profile };
    }

    function ready() {
        if (!readyPromise) readyPromise = load();
        return readyPromise;
    }

    function role() {
        if (!session) return 'anon';
        return (profile && profile.role) || 'user';
    }
    function atLeast(name) {
        return RANK[role()] >= RANK[name];
    }

    function isDisabled() {
        return !!(profile && profile.disabled);
    }

    function displayName() {
        if (profile && profile.display_name) return profile.display_name;
        if (session && session.user && session.user.email) return session.user.email.split('@')[0];
        return '';
    }

    async function signOut() {
        if (client) await client.auth.signOut();
        location.href = 'index.html';
    }

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function safeUrl(u) {
        const t = String(u == null ? '' : u).trim();
        return /^https:\/\/[^\s<>"']{1,400}$/i.test(t) ? t : 'about:blank';
    }

    const BANNER_VIDEO = /^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i;
    const BANNER_IMAGE = /^https:\/\/[^\s]+\.(png|jpe?g|jfif|gif|webp|avif)(\?[^\s]*)?$/i;

    function bannerKind(url) {
        if (typeof url !== 'string') return null;
        const u = url.trim();
        if (BANNER_VIDEO.test(u)) return 'video';
        if (BANNER_IMAGE.test(u)) return 'image';
        return null;
    }

    function bannerMoves(url) {
        return bannerKind(url) === 'video' || /\.gif(\?[^\s]*)?$/i.test(String(url || ''));
    }

    function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function nameEl(text, role, tag) {
        const r = RANK[role] === undefined ? 'user' : role;
        return el(tag || 'span', 'name name-' + r, text || 'unknown');
    }

    function roleChip(role) {
        return el('span', 'role-chip role-' + role, role);
    }

    let peoplePromise = null;
    function people() {
        if (!peoplePromise) {
            peoplePromise = (!client
                ? Promise.resolve({})
                : client.from('profiles').select('id, display_name, role').then(res => {
                    const map = {};
                    ((res && res.data) || []).forEach(p => { map[p.id] = p; });
                    return map;
                }).catch(() => ({})));
        }
        return peoplePromise;
    }

    function profileLink(text, role, id) {
        if (!id) return nameEl(text, role);
        const a = nameEl(text, role, 'a');
        a.href = 'profile.html?id=' + encodeURIComponent(id);
        a.classList.add('name-link');
        return a;
    }

    function errText(err) {
        if (!err) return 'Something went wrong.';
        const msg = err.message || err.error_description || err.hint || String(err);
        if (/row-level security|permission denied/i.test(msg)) {
            return 'Your account is not allowed to do that.';
        }
        if (/Failed to fetch|NetworkError/i.test(msg)) {
            return 'Could not reach the server. Check your connection.';
        }
        if (/violates check constraint|_text_check|_name_check/i.test(msg)) {
            return 'One of those is too long, or has characters that are not allowed.';
        }
        return msg;
    }

    function fmtPoints(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '0';
        return v.toLocaleString('en-US', {
            minimumFractionDigits: v % 1 === 0 ? 0 : 1,
            maximumFractionDigits: 1
        });
    }

    function fmtPercent(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return '0';
        return String(Number(n.toFixed(2)));
    }

    function fmtWhen(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function mountNav() {
        const links = document.querySelector('.nav .links');
        const slot = document.getElementById('navAccount');
        const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

        if (links) {

            links.insertBefore(toolLink('leaderboard.html', 'Rankings', here),
                               links.children[1] || null);
            links.appendChild(toolLink('profile.html', 'Players', here));
            if (atLeast('moderator')) links.appendChild(toolLink('modtools.html', 'Mod Tools', here));
            if (atLeast('admin')) links.appendChild(toolLink('admintools.html', 'Admin Tools', here));
        }
        if (!slot) return;

        slot.textContent = '';
        if (!configured) {
            slot.appendChild(el('span', 'acct-warn', 'Backend not connected'));
            return;
        }
        if (!session) {
            const a = el('a', 'acct-link', 'Sign in');
            a.href = 'login.html';
            slot.appendChild(a);
            return;
        }

        const who = profileLink(displayName(), role(), session.user.id);
        who.classList.add('acct-name');
        slot.appendChild(who);
        if (atLeast('moderator')) slot.appendChild(roleChip(role()));

        const out = el('button', 'acct-out', 'Sign out');
        out.type = 'button';
        out.addEventListener('click', signOut);
        slot.appendChild(out);
    }

    function toolLink(href, label, here) {
        const a = el('a', href.toLowerCase() === here ? 'active' : '', label);
        a.href = href;
        return a;
    }

    async function guard(minRole, mountEl) {
        await ready();
        if (atLeast(minRole)) return true;

        mountEl.textContent = '';
        const box = el('div', 'gate');
        if (!configured) {
            box.appendChild(el('h1', 'form-title', 'Not connected'));
            box.appendChild(el('p', 'form-intro', hasKeys
                ? 'The Supabase library did not load, so there is nothing to sign in to. Check your connection and reload.'
                : 'supabase-config.js still has its placeholder values, so there is nothing to sign in to.'));
        } else if (!session) {
            box.appendChild(el('h1', 'form-title', 'Sign in first'));
            box.appendChild(el('p', 'form-intro', 'This page is for the review team.'));
            const a = el('a', 'btn-submit btn-link', 'Sign in');
            a.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop());
            box.appendChild(a);
        } else {
            box.appendChild(el('h1', 'form-title', 'Not for your account'));
            box.appendChild(el('p', 'form-intro',
                'This page needs ' + minRole + ' access. Your account is ' + role() + '.'));
        }
        mountEl.appendChild(box);
        return false;
    }

    ready().then(mountNav);

    return {
        client: client,
        configured: configured,
        ready: ready,
        guard: guard,
        role: role,
        atLeast: atLeast,
        isDisabled: isDisabled,
        displayName: displayName,
        signOut: signOut,
        user: function () { return session ? session.user : null; },
        profile: function () { return profile; },
        el: el,
        LISTS: LISTS,
        listInfo: listInfo,
        tags: tags,
        reloadTags: reloadTags,
        tagBySlug: tagBySlug,
        tagChip: tagChip,
        tagsOf: tagsOf,
        TAG_COLOURS: TAG_COLOURS,
        currentList: currentList,
        rememberList: rememberList,
        people: people,
        safeUrl: safeUrl,
        bannerKind: bannerKind,
        bannerMoves: bannerMoves,
        reducedMotion: reducedMotion,
        nameEl: nameEl,
        roleChip: roleChip,
        profileLink: profileLink,
        errText: errText,
        fmtPoints: fmtPoints,
        fmtPercent: fmtPercent,
        fmtWhen: fmtWhen
    };
})();
