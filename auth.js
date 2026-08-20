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

        const who = el('span', 'acct-name', displayName());
        slot.appendChild(who);
        if (atLeast('moderator')) slot.appendChild(el('span', 'role-chip role-' + role(), role()));

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
        displayName: displayName,
        signOut: signOut,
        user: function () { return session ? session.user : null; },
        profile: function () { return profile; },
        el: el,
        errText: errText,
        fmtWhen: fmtWhen
    };
})();
