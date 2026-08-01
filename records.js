'use strict';
(function () {
    // Record submissions. Same approach as submit.js: posts to a Google Form so the
    // rows collect in a sheet, with no backend on this site.
    //
    // ----------------------------------------------------------------------
    // CONFIG - this needs its own Google Form, separate from the level form.
    // ----------------------------------------------------------------------
    const FORM_ID = '1FAIpQLSfq2gySrra6D4jZQafXyJiIVHnOrLLqK6o2FzzmltrcZKvkJg';

    const ENTRY = {
        player: 'entry.1846838960',
        level: 'entry.699998401',
        percent: 'entry.652574810',
        proof: 'entry.1079603762'
    };
    // ----------------------------------------------------------------------

    const form = document.getElementById('recordForm');
    const btn = document.getElementById('recordBtn');
    const note = document.getElementById('recordNote');
    const done = document.getElementById('recordDone');
    const honeypot = document.getElementById('in-website');
    const levelSelect = document.getElementById('in-level');

    const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

    function isConfigured() {
        return !/^PASTE_/.test(FORM_ID) &&
            Object.values(ENTRY).every(v => /^entry\.\d+$/.test(v) && v !== 'entry.0000000000');
    }

    const rules = {
        player(v) {
            if (!v.trim()) return 'Enter your player name.';
            if (v.trim().length < 2) return 'That name looks too short.';
            return '';
        },
        level(v) {
            if (!v) return 'Pick which level this is for.';
            return '';
        },
        percent(v) {
            if (!v.trim()) return 'Enter how far you got.';
            if (!/^\d+$/.test(v.trim())) return 'Use a whole number, like 34.';
            const n = Number(v);
            if (n < 1 || n > 100) return 'Percent must be between 1 and 100.';
            return '';
        },
        proof(v) {
            if (!v.trim()) return 'Enter a proof link.';
            if (!YT.test(v.trim())) return 'That is not a YouTube link.';
            return '';
        }
    };

    const fieldEls = {
        player: document.getElementById('f-player'),
        level: document.getElementById('f-level'),
        percent: document.getElementById('f-percent'),
        proof: document.getElementById('f-proof')
    };
    const inputEls = {
        player: document.getElementById('in-player'),
        level: levelSelect,
        percent: document.getElementById('in-percent'),
        proof: document.getElementById('in-proof')
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

    Object.keys(rules).forEach(key => {
        inputEls[key].addEventListener('blur', () => setError(key, rules[key](inputEls[key].value)));
        inputEls[key].addEventListener('input', () => {
            if (fieldEls[key].classList.contains('invalid')) {
                setError(key, rules[key](inputEls[key].value));
            }
        });
    });

    // Build the level dropdown from the same data the leaderboard uses, so it can
    // never drift out of sync with what is actually on the list.
    function fillLevels(levels) {
        levelSelect.textContent = '';
        if (!levels.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No levels on the list yet';
            levelSelect.appendChild(opt);
            levelSelect.disabled = true;
            btn.disabled = true;
            note.textContent = 'There is nothing to submit a record for yet.';
            return;
        }
        const first = document.createElement('option');
        first.value = '';
        first.textContent = 'Pick a level';
        levelSelect.appendChild(first);

        levels.forEach((lvl, i) => {
            const opt = document.createElement('option');
            // Value carries the rank and name so you can tell them apart at review
            // even if two levels share a name.
            opt.value = '#' + (i + 1) + ' ' + (lvl.name || 'untitled');
            opt.textContent = '#' + (i + 1) + '  ' + (lvl.name || 'untitled');
            levelSelect.appendChild(opt);
        });
    }

    window.WBDLLoad('data/levels.js', 'WBDL_LEVELS').then(data => {
        const levels = data && Array.isArray(data.levels) ? data.levels : [];
        fillLevels(levels);
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        note.textContent = '';

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
            note.textContent = 'The record form is not connected yet, so nothing was sent.';
            return;
        }

        const payload = new URLSearchParams();
        payload.append(ENTRY.player, inputEls.player.value.trim());
        payload.append(ENTRY.level, inputEls.level.value);
        payload.append(ENTRY.percent, inputEls.percent.value.trim());
        payload.append(ENTRY.proof, inputEls.proof.value.trim());

        btn.disabled = true;
        btn.textContent = 'Sending';

        fetch('https://docs.google.com/forms/d/e/' + FORM_ID + '/formResponse', {
            method: 'POST',
            mode: 'no-cors',
            body: payload
        }).then(showDone).catch(function () {
            btn.disabled = false;
            btn.textContent = 'Send record';
            note.textContent = 'That did not send. Check your connection and try again.';
        });
    });

    function showDone() {
        form.classList.add('hidden');
        done.classList.remove('hidden');
        const h = document.createElement('b');
        h.textContent = 'Record received.';
        const p = document.createElement('div');
        p.style.marginTop = '8px';
        p.textContent = 'It gets checked against the proof video before it goes under the level.';
        done.append(h, p);
        window.scrollTo(0, 0);
    }
})();
