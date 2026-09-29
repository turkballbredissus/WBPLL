'use strict';
(function () {

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

    const forgotLink = document.getElementById('forgotLink');
    const backLink = document.getElementById('backLink');
    const capField = document.getElementById('f-captcha');

    const CAPKEY = (window.WBPILL_CONFIG || {}).HCAPTCHA_SITEKEY || '';
    const capOn = CAPKEY.length > 10 && !/^PASTE_/.test(CAPKEY);
    let capId = null;

    function capMount() {
        if (!capOn) return;
        if (!window.hcaptcha || !window.hcaptcha.render) {
            setTimeout(capMount, 200);
            return;
        }
        if (capId === null) {
            capId = window.hcaptcha.render('capBox', { sitekey: CAPKEY, theme: 'dark' });
        }
    }

    function capToken() {
        if (!capOn || capId === null) return undefined;
        return window.hcaptcha.getResponse(capId) || '';
    }

    function capReset() {
        if (capOn && capId !== null) window.hcaptcha.reset(capId);
    }

    function capError(msg) {
        capField.classList.toggle('invalid', !!msg);
        capField.querySelector('.err').textContent = msg;
    }

    const RECOVERY = /type=recovery/.test(location.hash) && /access_token=/.test(location.hash);

    let mode = 'signin';

    function nextPage() {
        const raw = new URLSearchParams(location.search).get('next') || 'index.html';
        return /^[a-z0-9_-]+\.html$/i.test(raw) ? raw : 'index.html';
    }

    const RESET_GAP = 60 * 1000;
    const RESET_PER_HOUR = 3;
    const HOUR = 60 * 60 * 1000;

    function resetLog() {
        try { return JSON.parse(localStorage.getItem('wbpll_reset') || '{}'); }
        catch (err) { return {}; }
    }

    function resetSave(log) {
        try { localStorage.setItem('wbpll_reset', JSON.stringify(log)); }
        catch (err) { }
    }

    function resetKey(email) {
        const s = email.trim().toLowerCase();
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return 'e' + h.toString(36);
    }

    function resetRecent(email) {
        return (resetLog()[resetKey(email)] || [])
            .filter(t => Date.now() - t < HOUR);
    }

    function resetBlocked(email) {
        const hits = resetRecent(email);
        if (hits.length >= RESET_PER_HOUR) {
            return 'That is ' + RESET_PER_HOUR + ' reset emails for that address in an hour, ' +
                'which is the limit. Try again later.';
        }
        const since = hits.length ? Date.now() - hits[hits.length - 1] : RESET_GAP;
        if (since < RESET_GAP) {
            return 'Wait ' + Math.ceil((RESET_GAP - since) / 1000) +
                ' more seconds before asking for another.';
        }
        return '';
    }

    function resetMark(email) {
        const log = resetLog();
        const keys = Object.keys(log);
        if (keys.length > 20) delete log[keys[0]];
        log[resetKey(email)] = resetRecent(email).concat(Date.now());
        resetSave(log);
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
            if (mode === 'recover') return '';
            if (!v.trim()) return 'Enter your email.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) return 'That does not look like an email.';
            return '';
        },
        password(v) {
            if (mode === 'forgot') return '';
            if (!v) return 'Enter your password.';
            if ((mode === 'signup' || mode === 'recover') && v.length < 8) {
                return 'Use at least 8 characters.';
            }
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

    function btnLabel() {
        return mode === 'recover' ? 'Save password'
            : mode === 'forgot' ? 'Send the link'
                : mode === 'signup' ? 'Create account' : 'Sign in';
    }

    function setMode(next) {
        mode = next;
        const signup = mode === 'signup';
        const forgot = mode === 'forgot';
        const recover = mode === 'recover';

        Array.from(tabs.children).forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
        tabs.classList.toggle('hidden', forgot || recover);

        fieldEls.name.classList.toggle('hidden', !signup);
        fieldEls.email.classList.toggle('hidden', recover);
        fieldEls.password.classList.toggle('hidden', forgot);

        forgotLink.classList.toggle('hidden', mode !== 'signin');
        backLink.classList.toggle('hidden', !forgot);
        capField.classList.toggle('hidden', !capOn || recover);
        capError('');
        if (capOn && !recover) capMount();

        title.textContent = recover ? 'Set a new password'
            : forgot ? 'Reset your password'
                : signup ? 'Create an account' : 'Sign in';

        intro.textContent = recover
            ? 'Pick something you have not used on another site.'
            : forgot
                ? 'Put in the email your account uses and a link to set a new password comes back to you.'
                : signup
                    ? 'One account covers submitting levels and records. Your display name is what other people see.'
                    : 'Submitting a level or a record needs an account, so every submission has a name attached to it that is actually yours.';

        btn.textContent = btnLabel();
        pwHint.textContent = (signup || recover) ? 'At least 8 characters.' : '';
        inputEls.password.autocomplete = (signup || recover) ? 'new-password' : 'current-password';
        note.textContent = '';
        Object.keys(fieldEls).forEach(k => setError(k, ''));
    }

    tabs.addEventListener('click', e => {
        const t = e.target.closest('.tab');
        if (t) setMode(t.dataset.mode);
    });

    forgotLink.addEventListener('click', () => setMode('forgot'));
    backLink.addEventListener('click', () => setMode('signin'));

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
        const tok = capToken();

        if (capOn && mode !== 'recover' && !tok) {
            capError('Tick the box to show you are a person.');
            return;
        }
        capError('');

        if (mode === 'forgot') {
            const blocked = resetBlocked(email);
            if (blocked) {
                note.textContent = blocked;
                return;
            }
        }

        btn.disabled = true;
        btn.textContent = mode === 'signup' ? 'Creating'
            : mode === 'forgot' ? 'Sending'
                : mode === 'recover' ? 'Saving' : 'Signing in';

        try {
            if (mode === 'forgot') {
                resetMark(email);
                const { error } = await WB.client.auth.resetPasswordForEmail(email, {
                    redirectTo: location.href.split('#')[0].split('?')[0],
                    captchaToken: tok
                });
                if (error) throw error;
                finish('Check your email.',
                    'If there is an account on ' + email + ', a link to set a new password is ' +
                    'on its way. It stops working after an hour.');
                return;
            }

            if (mode === 'recover') {
                const { error } = await WB.client.auth.updateUser({ password: password });
                if (error) throw error;
                finish('Password changed.',
                    'You are signed in with it already. Use it next time you sign in.');
                return;
            }

            if (mode === 'signup') {
                const { data, error } = await WB.client.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: { display_name: inputEls.name.value.trim() },
                        captchaToken: tok
                    }
                });
                if (error) throw error;

                if (!data.session) {
                    finish('Check your email.',
                        'Open the confirmation link we sent to ' + email + ', then come back and sign in. ' +
                        'If it is not there in a minute, look in your spam folder.');
                    return;
                }
            } else {
                const { error } = await WB.client.auth.signInWithPassword({
                    email: email, password: password, options: { captchaToken: tok }
                });
                if (error) throw error;
            }
            location.href = nextPage();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = btnLabel();
            note.textContent = friendly(err);
            capReset();
        }
    });

    function friendly(err) {
        const msg = (err && err.message) || '';
        if (/Invalid login credentials/i.test(msg)) return 'That email and password do not match an account.';
        if (/User already registered/i.test(msg)) return 'There is already an account on that email. Try signing in.';
        if (/Email not confirmed/i.test(msg)) return 'Confirm your email first, using the link that was sent to you.';
        if (/rate limit|too many|only request this after|security purposes/i.test(msg)) {
            return 'Too many tries. Wait a minute and go again.';
        }
        if (/should be different from the old password/i.test(msg)) {
            return 'That is the password you already have. Pick a different one.';
        }
        if (/captcha/i.test(msg)) {
            return 'The human check did not go through. Tick the box again and retry.';
        }
        if (/expired|invalid.*token/i.test(msg)) {
            return 'That reset link has expired. Ask for a new one from the sign in page.';
        }
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

    function intoRecovery() {
        box.classList.remove('hidden');
        done.classList.add('hidden');
        setMode('recover');
        inputEls.password.focus();
    }

    if (WB.client) {
        WB.client.auth.onAuthStateChange(event => {
            if (event === 'PASSWORD_RECOVERY') intoRecovery();
        });
    }

    WB.ready().then(() => {
        if (RECOVERY) {
            intoRecovery();
            return;
        }
        if (WB.user()) {
            finish('You are signed in as ' + WB.displayName() + '.',
                'Use the leaderboard, or sign out from the top right to switch accounts.');
        }
    });

    setMode('signin');
})();
