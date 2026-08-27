'use strict';
(function () {
    // Banner submissions. Same shape as records: pick a level, send a link, a
    // moderator decides. Nothing is uploaded here - the clip stays on whatever
    // host the submitter used and the site only ever stores the link.
    //
    // The preview below the field is the point of this page. It loads the clip,
    // checks how long it actually is, and loops it in front of you, so a bad
    // link or a four second clip is caught here rather than in the queue.
    const form = document.getElementById('bannerForm');
    const btn = document.getElementById('bannerBtn');
    const note = document.getElementById('bannerNote');
    const done = document.getElementById('bannerDone');
    const gate = document.getElementById('signInGate');
    const honeypot = document.getElementById('in-website');
    const levelSelect = document.getElementById('in-level');
    const previewField = document.getElementById('f-preview');
    const previewBox = document.getElementById('bannerPreview');
    const previewNote = document.getElementById('previewNote');
    const el = WB.el;

    const MAX_SECONDS = 2;
    const VIDEO_URL = /^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i;

    let checked = { url: '', ok: false, seconds: 0 };

    const rules = {
        level(v) {
            if (!v) return 'Pick which level this is for.';
            return '';
        },
        url(v) {
            const u = v.trim();
            if (!u) return 'Paste a link to the clip.';
            if (/youtu\.?be/i.test(u)) {
                return 'YouTube links cannot be used. Upload the file somewhere like catbox.moe and paste that link.';
            }
            if (!/^https:\/\//i.test(u)) return 'The link has to start with https://';
            if (!VIDEO_URL.test(u)) return 'That is not a direct .mp4 or .webm link.';
            return '';
        }
    };

    const fieldEls = {
        level: document.getElementById('f-level'),
        url: document.getElementById('f-url')
    };
    const inputEls = {
        level: levelSelect,
        url: document.getElementById('in-url')
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

    // ------------------------------------------------------------- preview

    inputEls.url.addEventListener('blur', () => {
        const u = inputEls.url.value.trim();
        if (u && !rules.url(u)) loadPreview(u);
    });

    function loadPreview(url) {
        if (checked.url === url) return;
        previewField.classList.remove('hidden');
        previewBox.textContent = '';
        previewNote.textContent = 'Loading…';
        previewNote.className = 'preview-note';
        checked = { url: url, ok: false, seconds: 0 };

        const v = document.createElement('video');
        v.className = 'banner-preview-vid';
        v.src = url;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.autoplay = true;
        v.preload = 'metadata';

        v.addEventListener('loadedmetadata', () => {
            const secs = v.duration;
            checked.seconds = secs;
            if (!isFinite(secs)) {
                // Some hosts do not send a length. The moderator will see it anyway.
                checked.ok = true;
                say('Loaded. The length could not be read from this host, so make sure it is under two seconds.', 'warn');
                return;
            }
            if (secs > MAX_SECONDS + 0.05) {
                checked.ok = false;
                say('That clip is ' + secs.toFixed(1) + ' seconds. The limit is two.', 'bad');
                return;
            }
            checked.ok = true;
            say('Looks good — ' + secs.toFixed(1) + ' seconds. Watch the loop below and check the seam does not jump.', 'good');
        });

        v.addEventListener('error', () => {
            checked.ok = false;
            previewBox.textContent = '';
            say('That link did not load. Check it opens the video directly in a new tab.', 'bad');
        });

        previewBox.appendChild(v);
    }

    function say(text, kind) {
        previewNote.textContent = text;
        previewNote.className = 'preview-note note-' + kind;
    }

    // -------------------------------------------------------------- levels

    function fillLevels(levels) {
        levelSelect.textContent = '';
        if (!levels.length) {
            const opt = el('option', '', 'No levels on the list yet');
            opt.value = '';
            levelSelect.appendChild(opt);
            levelSelect.disabled = true;
            btn.disabled = true;
            note.textContent = 'There is nothing to make a banner for yet.';
            return;
        }
        const first = el('option', '', 'Pick a level');
        first.value = '';
        levelSelect.appendChild(first);

        WB.LISTS.forEach(meta => {
            const rows = levels.filter(l => l.list === meta.key);
            if (!rows.length) return;
            const group = document.createElement('optgroup');
            group.label = meta.long;
            rows.forEach(lvl => {
                const opt = el('option', '',
                    '#' + lvl.position + '  ' + (lvl.name || 'untitled') + (lvl.banner ? '  (has one)' : ''));
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
            .select('id, list, position, name, banner')
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
            lock('Not connected yet', 'The site cannot reach its database, so banners cannot be sent.');
            fillLevels([]);
            return;
        }
        fillLevels(await loadLevels());

        if (WB.isDisabled()) {
            lock('Your account is disabled',
                'It cannot submit anything at the moment. If you think that is a mistake, ask a moderator.');
        } else if (!WB.user()) {
            lock('You need an account',
                'Banners are reviewed before they go up, so the queue needs to know who sent one.',
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
            a.href = 'login.html?next=banners.html';
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

        const url = inputEls.url.value.trim();
        if (checked.url !== url) {
            loadPreview(url);
            note.textContent = 'Give the preview a second to load, then send it.';
            return;
        }
        if (!checked.ok) {
            note.textContent = 'That clip cannot be used yet. See the note under the preview.';
            return;
        }

        const user = WB.user();
        if (!user) {
            note.textContent = 'Sign in first, then send it.';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Sending';

        const { error } = await WB.client.from('banner_submissions').insert({
            level_row_id: Number(levelSelect.value),
            url: url,
            account_id: user.id,
            account_name: WB.displayName()
        });

        if (error) {
            btn.disabled = false;
            btn.textContent = 'Send banner';
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
        done.appendChild(el('b', '', 'Banner received.'));
        const p = el('div', '', 'A moderator watches it before it goes behind the level.');
        p.style.marginTop = '8px';
        done.appendChild(p);
        window.scrollTo(0, 0);
    }
})();
