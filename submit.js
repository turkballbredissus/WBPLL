'use strict';
(function () {
    // Public submission form. Posts to a Google Form's response endpoint, so the
    // submissions collect in a Google Sheet without this site needing a backend.
    //
    // ----------------------------------------------------------------------
    // CONFIG - fill these in once, from your own Google Form. See SETUP.md.
    // ----------------------------------------------------------------------
    const FORM_ID = '1FAIpQLSdeogQnd4eDg6M3UYE6r5ksxtAxQmxwZn7hScUX54nZ4cAclg';
    const ENTRY = {
        name: 'entry.1372701526',
        publisher: 'entry.1501548599',
        placement: 'entry.1040923498',
        levelId: 'entry.837123941',
        showcase: 'entry.325099746'
    };
    // ----------------------------------------------------------------------

    const form = document.getElementById('submitForm');
    const btn = document.getElementById('submitBtn');
    const note = document.getElementById('formNote');
    const done = document.getElementById('formDone');
    const honeypot = document.getElementById('in-website');

    const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

    function isConfigured() {
        return !/^PASTE_/.test(FORM_ID) &&
            Object.values(ENTRY).every(v => /^entry\.\d+$/.test(v) && v !== 'entry.0000000000');
    }

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
        placement: document.getElementById('f-placement'),
        levelId: document.getElementById('f-id'),
        showcase: document.getElementById('f-showcase')
    };
    const inputEls = {
        name: document.getElementById('in-name'),
        publisher: document.getElementById('in-publisher'),
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

    form.addEventListener('submit', function (e) {
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

        if (!isConfigured()) {
            note.textContent = 'The form is not connected yet, so nothing was sent.';
            return;
        }

        const payload = new URLSearchParams();
        payload.append(ENTRY.name, inputEls.name.value.trim());
        payload.append(ENTRY.publisher, inputEls.publisher.value.trim());
        payload.append(ENTRY.placement, inputEls.placement.value.trim());
        payload.append(ENTRY.levelId, inputEls.levelId.value.trim());
        payload.append(ENTRY.showcase, inputEls.showcase.value.trim());

        btn.disabled = true;
        btn.textContent = 'Sending';

        // Google does not send CORS headers back, so the response is opaque and
        // cannot be read. A rejected promise means the request never left.
        fetch('https://docs.google.com/forms/d/e/' + FORM_ID + '/formResponse', {
            method: 'POST',
            mode: 'no-cors',
            body: payload
        }).then(showDone).catch(function () {
            btn.disabled = false;
            btn.textContent = 'Send submission';
            note.textContent = 'That did not send. Check your connection and try again.';
        });
    });

    function showDone() {
        form.classList.add('hidden');
        done.classList.remove('hidden');
        const h = document.createElement('b');
        h.textContent = 'Submission received.';
        const p = document.createElement('div');
        p.style.marginTop = '8px';
        p.textContent = 'It goes into the review queue. If it gets added you will see it on the list.';
        done.append(h, p);
        window.scrollTo(0, 0);
    }
})();
