'use strict';
(function () {
    // Level submissions. They go into the level_submissions table as pending
    // rows and sit there, exactly as typed, until an admin reviews them in
    // Admin Tools. An account is required so the queue shows who sent what.
    const form = document.getElementById('submitForm');
    const btn = document.getElementById('submitBtn');
    const note = document.getElementById('formNote');
    const done = document.getElementById('formDone');
    const gate = document.getElementById('signInGate');
    const honeypot = document.getElementById('in-website');
    const el = WB.el;

    const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

    // Each rule returns an error string, or '' when the value is acceptable.
    const rules = {
        name(v) {
            if (!v.trim()) return 'Enter the level name.';
            if (v.trim().length < 2) return 'That name looks too short.';
            return '';
        },
        publisher(v) {
            if (!v.trim()) return 'Enter who published the level.';
            if (v.trim().length < 2) return 'That name looks too short.';
            return '';
        },
        list(v) {
            if (!v) return 'Pick which list this belongs on.';
            return '';
        },
        placement(v) {
            if (!v.trim()) return 'Enter a placement number.';
            if (!/^\d+$/.test(v.trim())) return 'Use a whole number, like 3.';
            const n = Number(v);
            if (n < 1 || n > 999) return 'Placement must be between 1 and 999.';
            return '';
        },
        levelId(v) {
            if (!v.trim()) return 'Enter the level ID.';
            if (!/^\d{1,12}$/.test(v.trim())) return 'The level ID is digits only.';
            return '';
        },
        showcase(v) {
            if (!v.trim()) return 'Enter a showcase link.';
            if (!YT.test(v.trim())) return 'That is not a YouTube link.';
            return '';
        }
    };

    const fieldEls = {
        name: document.getElementById('f-name'),
        publisher: document.getElementById('f-publisher'),
        list: document.getElementById('f-list'),
        placement: document.getElementById('f-placement'),
        levelId: document.getElementById('f-id'),
        showcase: document.getElementById('f-showcase')
    };
    const inputEls = {
        name: document.getElementById('in-name'),
        publisher: document.getElementById('in-publisher'),
        list: document.getElementById('in-list'),
        placement: document.getElementById('in-placement'),
        levelId: document.getElementById('in-id'),
        showcase: document.getElementById('in-showcase')
    };

    function setError(key, msg) {
        const wrap = fieldEls[key];
        wrap.classList.toggle('invalid', !!msg);
        wrap.querySelector('.err').textContent = msg;
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

    // Re-check a field once it has been touched, so errors clear as they are fixed.
    Object.keys(rules).forEach(key => {
        inputEls[key].addEventListener('blur', () => setError(key, rules[key](inputEls[key].value)));
        inputEls[key].addEventListener('input', () => {
            if (fieldEls[key].classList.contains('invalid')) {
                setError(key, rules[key](inputEls[key].value));
            }
        });
    });

    // The form is visible either way; without an account the button is off and
    // the reason sits above it, rather than the page looking broken.
    WB.ready().then(() => {
        inputEls.list.value = WB.currentList();
        if (!WB.configured) {
            lock('Not connected yet',
                'The site is not wired to its backend, so submissions cannot be sent.');
            return;
        }
        if (WB.isDisabled()) {
            lock('Your account is disabled',
                'It cannot submit anything at the moment. If you think that is a mistake, ' +
                'ask a moderator.');
            return;
        }
        if (!WB.user()) {
            lock('You need an account',
                'Submissions carry the name of whoever sent them, so the review queue knows who to thank.',
                true);
        }
    });

    function lock(head, body, withLink) {
        gate.classList.remove('hidden');
        gate.textContent = '';
        gate.appendChild(el('b', '', head));
        gate.appendChild(el('div', 'gate-body', body));
        if (withLink) {
            const a = el('a', 'btn-submit btn-link', 'Sign in or create an account');
            a.href = 'login.html?next=submit.html';
            gate.appendChild(a);
        }
        btn.disabled = true;
        form.classList.add('locked');
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        note.textContent = '';

        // Bots fill every field they find, including the hidden one. Drop those
        // without telling them anything is wrong.
        if (honeypot.value) {
            showDone();
            return;
        }

        const firstBad = validateAll();
        if (firstBad) {
            inputEls[firstBad].focus();
            note.textContent = 'Fix the highlighted fields and try again.';
            return;
        }

        const user = WB.user();
        if (!user) {
            note.textContent = 'Sign in first, then send it.';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Sending';

        const { error } = await WB.client.from('level_submissions').insert({
            name: inputEls.name.value.trim(),
            publisher: inputEls.publisher.value.trim(),
            level_id: inputEls.levelId.value.trim(),
            showcase: inputEls.showcase.value.trim(),
            list: inputEls.list.value,
            placement: Number(inputEls.placement.value),
            account_id: user.id,
            account_name: WB.displayName()
        });

        if (error) {
            btn.disabled = false;
            btn.textContent = 'Send submission';
            note.textContent = WB.errText(error);
            return;
        }
        showDone();
    });

    function showDone() {
        form.classList.add('hidden');
        gate.classList.add('hidden');
        done.classList.remove('hidden');
        done.textContent = '';
        done.appendChild(el('b', '', 'Submission received.'));
        const p = el('div', '', 'It goes into the review queue. If it gets added you will see it on the list.');
        p.style.marginTop = '8px';
        done.appendChild(p);
        window.scrollTo(0, 0);
    }
})();
