'use strict';
(function () {
    // Record submissions. Same shape as submit.js, into record_submissions,
    // where a moderator picks them up in Mod Tools. The level dropdown is built
    // from the live list so a record can only ever point at a real level.
    const form = document.getElementById('recordForm');
    const btn = document.getElementById('recordBtn');
    const note = document.getElementById('recordNote');
    const done = document.getElementById('recordDone');
    const gate = document.getElementById('signInGate');
    const honeypot = document.getElementById('in-website');
    const levelSelect = document.getElementById('in-level');
    const el = WB.el;

    const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

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

    // The option value is the level's row id, so the record stays attached to
    // the right level even after the list gets reordered.
    function fillLevels(levels) {
        levelSelect.textContent = '';
        if (!levels.length) {
            const opt = el('option', '', 'No levels on the list yet');
            opt.value = '';
            levelSelect.appendChild(opt);
            levelSelect.disabled = true;
            btn.disabled = true;
            note.textContent = 'There is nothing to submit a record for yet.';
            return;
        }
        const first = el('option', '', 'Pick a level');
        first.value = '';
        levelSelect.appendChild(first);

        WB.LISTS.forEach(info => {
            const mine = levels.filter(l => (l.list || 'impossible') === info.key);
            if (!mine.length) return;

            const group = el('optgroup');
            group.label = info.long;
            mine.forEach(lvl => {
                const opt = el('option', '', '#' + lvl.position + '  ' + (lvl.name || 'untitled'));
                opt.value = String(lvl.id);
                group.appendChild(opt);
            });
            levelSelect.appendChild(group);
        });
    }

    async function loadLevels() {
        if (!WB.client) return [];
        const { data, error } = await WB.client
            .from('levels')
            .select('id, list, position, name')
            .order('list', { ascending: true })
            .order('position', { ascending: true });
        if (error) {
            note.textContent = WB.errText(error);
            return [];
        }
        return data || [];
    }

    WB.ready().then(async () => {
        if (!WB.configured) {
            lock('Not connected yet', 'The site is not wired to its backend, so records cannot be sent.');
            fillLevels([]);
            return;
        }
        fillLevels(await loadLevels());

        if (WB.isDisabled()) {
            lock('Your account is disabled',
                'It cannot submit anything at the moment. If you think that is a mistake, ' +
                'ask a moderator.');
            return;
        }
        if (!WB.user()) {
            lock('You need an account',
                'Records are checked against the account that sent them, so nobody can file one under your name.',
                true);
        } else if (!inputEls.player.value) {
            // Prefilled, not forced: plenty of people go by a different name in game.
            inputEls.player.value = WB.displayName();
        }
    });

    function lock(head, body, withLink) {
        gate.classList.remove('hidden');
        gate.textContent = '';
        gate.appendChild(el('b', '', head));
        gate.appendChild(el('div', 'gate-body', body));
        if (withLink) {
            const a = el('a', 'btn-submit btn-link', 'Sign in or create an account');
            a.href = 'login.html?next=records.html';
            gate.appendChild(a);
        }
        btn.disabled = true;
        form.classList.add('locked');
    }

    form.addEventListener('submit', async function (e) {
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

        const user = WB.user();
        if (!user) {
            note.textContent = 'Sign in first, then send it.';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Sending';

        const { error } = await WB.client.from('record_submissions').insert({
            level_row_id: Number(levelSelect.value),
            player: inputEls.player.value.trim(),
            percent: Number(inputEls.percent.value),
            proof: inputEls.proof.value.trim(),
            account_id: user.id,
            account_name: WB.displayName()
        });

        if (error) {
            btn.disabled = false;
            btn.textContent = 'Send record';
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
        done.appendChild(el('b', '', 'Record received.'));
        const p = el('div', '', 'It gets checked against the proof video before it goes under the level.');
        p.style.marginTop = '8px';
        done.appendChild(p);
        window.scrollTo(0, 0);
    }
})();
