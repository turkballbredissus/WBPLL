'use strict';
(function () {
    // Sign in and sign up, on one page with two modes. Supabase holds the
    // password; nothing here ever stores or reads one back.
    const box = document.getElementById('authBox');
    const tabs = document.getElementById('authTabs');
    const form = document.getElementById('authForm');
    const btn = document.getElementById('authBtn');
    const note = document.getElementById('authNote');
    const done = document.getElementById('authDone');
    const title = document.getElementById('authTitle');
    const intro = document.getElementById('authIntro');
    const pwHint = document.getElementById('pwHint');
    const el = WB.el;

    const fieldEls = {
        name: document.getElementById('f-name'),
        email: document.getElementById('f-email'),
        password: document.getElementById('f-password')
    };
    const inputEls = {
        name: document.getElementById('in-name'),
        email: document.getElementById('in-email'),
        password: document.getElementById('in-password')
    };

    let mode = 'signin';

    // Where to go afterwards, so the mod tools can bounce you here and back.
    // Only a bare file name is accepted, never a full URL someone appended.
    function nextPage() {
        const raw = new URLSearchParams(location.search).get('next') || 'index.html';
        return /^[a-z0-9_-]+\.html$/i.test(raw) ? raw : 'index.html';
    }

    const rules = {
        name(v) {
            if (mode !== 'signup') return '';
            if (!v.trim()) return 'Pick a display name.';
            if (v.trim().length < 2) return 'That is too short.';
            if (!/^[\w .\-\[\]]+$/.test(v.trim())) return 'Letters, numbers, spaces and - _ . [ ] only.';
            return '';
        },
        email(v) {
            if (!v.trim()) return 'Enter your email.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) return 'That does not look like an email.';
            return '';
        },
        password(v) {
            if (!v) return 'Enter your password.';
            if (mode === 'signup' && v.length < 8) return 'Use at least 8 characters.';
            return '';
        }
    };

    function setError(key, msg) {
        fieldEls[key].classList.toggle('invalid', !!msg);
        fieldEls[key].querySelector('.err').textContent = msg;
    }

    function validateAll() {
        let firstBad = null;
        Object.keys(rules).forEach(key => {
            const msg = rules[key](inputEls[key].value);
            setError(key, msg);
            if (msg && !firstBad) firstBad = key;
        });
        return firstBad;
    }

    Object.keys(rules).forEach(key => {
        inputEls[key].addEventListener('blur', () => setError(key, rules[key](inputEls[key].value)));
        inputEls[key].addEventListener('input', () => {
            if (fieldEls[key].classList.contains('invalid')) {
                setError(key, rules[key](inputEls[key].value));
            }
        });
    });

    function setMode(next) {
        mode = next;
        const signup = mode === 'signup';
        Array.from(tabs.children).forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
        fieldEls.name.classList.toggle('hidden', !signup);
        title.textContent = signup ? 'Create an account' : 'Sign in';
        intro.textContent = signup
            ? 'One account covers submitting levels and records. Your display name is what other people see.'
            : 'Submitting a level or a record needs an account, so every submission has a name attached to it that is actually yours.';
        btn.textContent = signup ? 'Create account' : 'Sign in';
        pwHint.textContent = signup ? 'At least 8 characters.' : '';
        inputEls.password.autocomplete = signup ? 'new-password' : 'current-password';
        note.textContent = '';
        Object.keys(fieldEls).forEach(k => setError(k, ''));
    }

    tabs.addEventListener('click', e => {
        const t = e.target.closest('.tab');
        if (t) setMode(t.dataset.mode);
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        note.textContent = '';

        const firstBad = validateAll();
        if (firstBad) {
            inputEls[firstBad].focus();
            return;
        }
        if (!WB.configured) {
            note.textContent = 'The backend is not connected yet, so there is nothing to sign in to.';
            return;
        }

        const email = inputEls.email.value.trim();
        const password = inputEls.password.value;
        btn.disabled = true;
        btn.textContent = mode === 'signup' ? 'Creating' : 'Signing in';

        try {
            if (mode === 'signup') {
                const { data, error } = await WB.client.auth.signUp({
                    email: email,
                    password: password,
                    options: { data: { display_name: inputEls.name.value.trim() } }
                });
                if (error) throw error;

                // With email confirmation switched on, signUp returns a user but
                // no session until they click the link in their inbox.
                if (!data.session) {
                    finish('Check your email.',
                        'Open the confirmation link we sent to ' + email + ', then come back and sign in.');
                    return;
                }
            } else {
                const { error } = await WB.client.auth.signInWithPassword({ email: email, password: password });
                if (error) throw error;
            }
            location.href = nextPage();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
            note.textContent = friendly(err);
        }
    });

    function friendly(err) {
        const msg = (err && err.message) || '';
        if (/Invalid login credentials/i.test(msg)) return 'That email and password do not match an account.';
        if (/User already registered/i.test(msg)) return 'There is already an account on that email. Try signing in.';
        if (/Email not confirmed/i.test(msg)) return 'Confirm your email first, using the link that was sent to you.';
        if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and go again.';
        return WB.errText(err);
    }

    function finish(head, body) {
        box.classList.add('hidden');
        done.classList.remove('hidden');
        done.textContent = '';
        done.appendChild(el('b', '', head));
        const p = el('div', '', body);
        p.style.marginTop = '8px';
        done.appendChild(p);
        window.scrollTo(0, 0);
    }

    // Already signed in? Say so rather than showing a form that will confuse.
    WB.ready().then(() => {
        if (WB.user()) {
            finish('You are signed in as ' + WB.displayName() + '.',
                'Use the leaderboard, or sign out from the top right to switch accounts.');
        }
    });

    setMode('signin');
})();
