'use strict';
// The account layer every page shares: one Supabase client, the signed-in
// profile, the role check, and the account strip in the nav bar.
//
// Roles rank upward - user, moderator, admin, owner. A moderator reviews
// records, an admin also reviews levels and owns the list order, and the owner
// is the only one who can change anyone's role.
window.WB = (function () {
    const cfg = window.WBPILL_CONFIG || {};

    function filled(v) {
        return typeof v === 'string' && v.length > 0 && !/^PASTE_/.test(v);
    }
    // Two ways this can be dead: the config still holds placeholders, or the
    // Supabase library did not load. Either way every page falls back to
    // read-only rather than throwing, and `configured` is the single flag for it.
    const hasKeys = filled(cfg.SUPABASE_URL) && filled(cfg.SUPABASE_ANON_KEY);

    const client = (hasKeys && window.supabase && window.supabase.createClient)
        ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
        : null;
    const configured = !!client;

    const RANK = { anon: -1, user: 0, moderator: 1, admin: 2, owner: 3 };

    // The two lists. `key` is what the database stores; everything else is
    // wording, kept here so renaming a list is a one-line job.
    const LISTS = [
        { key: 'impossible', short: 'Impossible', long: 'Physically impossible' },
        { key: 'possible', short: 'Possible', long: 'Physically possible' }
    ];
    function listInfo(key) {
        return LISTS.find(l => l.key === key) || LISTS[0];
    }

    // Tags are rows in the database, not a list in here, because the owner adds
    // and removes them from Admin Tools. Fetched once per page and cached, the
    // same way the roster is. A level carries any number of them.
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
    // Synchronous lookup for code that has already awaited tags(). Null for a
    // slug that no longer exists, so a deleted tag simply stops rendering.
    function tagBySlug(slug) {
        return tagCache.find(t => t.slug === slug) || null;
    }
    // Throws the cache away so the next tags() goes back to the database. Admin
    // Tools calls this after adding or removing one, or every picker on the
    // page would keep offering the old set until a reload.
    function reloadTags() {
        tagsPromise = null;
        return tags();
    }

    // Colour is a palette name, never raw CSS, so a tag the owner types cannot
    // put a style into the page. Anything unrecognised falls back to neutral.
    const TAG_COLOURS = ['neutral', 'green', 'blue', 'yellow', 'orange', 'red', 'purple', 'gold'];
    function tagChip(tag) {
        const colour = TAG_COLOURS.indexOf(tag && tag.colour) >= 0 ? tag.colour : 'neutral';
        return el('span', 'tag-chip tag-c-' + colour, (tag && tag.label) || '');
    }

    // levels rows arrive with their tags nested two deep, because the join
    // table sits between. Flattened here so no page has to know that shape.
    function tagsOf(row) {
        const links = (row && row.level_tags) || [];
        return links.map(l => l.tags).filter(Boolean)
            .sort((a, b) => (a.sort - b.sort) || a.label.localeCompare(b.label));
    }
    // Which list the visitor was last looking at, so moving between pages does
    // not keep dumping them back on the impossible one.
    function currentList() {
        const fromUrl = new URLSearchParams(location.search).get('list');
        if (LISTS.some(l => l.key === fromUrl)) return fromUrl;
        try {
            const saved = localStorage.getItem('wbpll_list');
            if (LISTS.some(l => l.key === saved)) return saved;
        } catch (err) { /* storage off - the default is fine */ }
        return 'impossible';
    }
    function rememberList(key) {
        try { localStorage.setItem('wbpll_list', key); } catch (err) { /* no matter */ }
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
                // ensure_profile creates the row the first time and hands it
                // back every time after, so a new account needs no setup step
                // and there is no window where someone is signed in with no
                // profile behind them.
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

    // Every page awaits this before it renders anything role-dependent.
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
    // A disabled account can still sign in and read; it just cannot submit.
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

    // What a banner is allowed to be, decided in one place so the submit page,
    // the review queue and the list itself cannot drift apart. The database
    // enforces the same set, so nothing here is the only line of defence.
    const BANNER_VIDEO = /^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i;
    const BANNER_IMAGE = /^https:\/\/[^\s]+\.(png|jpe?g|jfif|gif|webp|avif)(\?[^\s]*)?$/i;

    // 'video', 'image', or null when it is not usable as a banner at all.
    function bannerKind(url) {
        if (typeof url !== 'string') return null;
        const u = url.trim();
        if (BANNER_VIDEO.test(u)) return 'video';
        if (BANNER_IMAGE.test(u)) return 'image';
        return null;
    }

    // A gif animates, so it counts as motion even though it is an image.
    function bannerMoves(url) {
        return bannerKind(url) === 'video' || /\.gif(\?[^\s]*)?$/i.test(String(url || ''));
    }

    function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // One place decides how a display name looks, so the colours cannot drift
    // apart between the leaderboard, the queues and the profile pages.
    function nameEl(text, role, tag) {
        const r = RANK[role] === undefined ? 'user' : role;
        return el(tag || 'span', 'name name-' + r, text || 'unknown');
    }

    function roleChip(role) {
        return el('span', 'role-chip role-' + role, role);
    }

    // id -> {display_name, role} for everyone, fetched once per page. Profiles
    // are public, so this works for signed-out visitors too and is what lets a
    // name be tinted anywhere it shows up.
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

    // Links to a profile, or to the members list when there is no account.
    function profileLink(text, role, id) {
        if (!id) return nameEl(text, role);
        const a = nameEl(text, role, 'a');
        a.href = 'profile.html?id=' + encodeURIComponent(id);
        a.classList.add('name-link');
        return a;
    }

    // Supabase errors arrive in a few shapes depending on whether they came
    // from a policy, a constraint or a raise in one of the functions.
    function errText(err) {
        if (!err) return 'Something went wrong.';
        const msg = err.message || err.error_description || err.hint || String(err);
        if (/row-level security|permission denied/i.test(msg)) {
            return 'Your account is not allowed to do that.';
        }
        if (/Failed to fetch|NetworkError/i.test(msg)) {
            return 'Could not reach the server. Check your connection.';
        }
        return msg;
    }

    // Point totals show on the rankings, on a profile and next to every record,
    // so the rounding lives here rather than being retyped on each page. The
    // database has already rounded to one decimal; this only decides how it
    // reads - grouped, and with no ".0" hanging off a whole number.
    // en-US on purpose, not the visitor's own locale. On a Turkish or German
    // browser the default puts a comma where the decimal point goes, so 573.1
    // points renders as "573,1" and reads as five and a half thousand. A score
    // has to mean the same thing to everyone looking at the same board.
    function fmtPoints(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '0';
        return v.toLocaleString('en-US', {
            minimumFractionDigits: v % 1 === 0 ? 0 : 1,
            maximumFractionDigits: 1
        });
    }

    // Records carry two decimals now, because Web Dashers reports them that way
    // and 6.83% has to beat 6.12%. Trailing zeros are dropped, so a plain 34
    // still reads "34" rather than "34.00". Numeric columns can arrive as
    // strings depending on the driver, hence the Number() rather than toFixed
    // straight on the value.
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

    // The nav is written into each page as plain HTML; the parts that depend on
    // who is signed in get added here so there is only one copy of the rules.
    function mountNav() {
        const links = document.querySelector('.nav .links');
        const slot = document.getElementById('navAccount');
        const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

        if (links) {
            // Straight after the list itself, since it is the same subject seen
            // from the other side. Inserted here rather than written into eight
            // pages of markup, so the highlighting has one set of rules.
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

    // Gate for modtools/admintools. Renders the reason in place of the page and
    // resolves false when the visitor should not be here.
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
