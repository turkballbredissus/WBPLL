'use strict';
(function () {
    const me = document.currentScript;
    const tool = me && me.dataset.tool;
    const role = me && me.dataset.role;
    const root = document.getElementById('toolsRoot');
    if (!tool || !role || !root) return;

    WB.guard(role, root).then(async ok => {
        if (!ok) return;

        const res = await WB.client.rpc('get_staff_code', { p_name: tool });
        if (res.error || typeof res.data !== 'string' || !res.data) {
            root.textContent = '';
            root.appendChild(WB.el('div', 'q-error',
                res.error ? WB.errText(res.error) : 'The tools could not be loaded. Reload to try again.'));
            return;
        }

        const s = document.createElement('script');
        s.textContent = res.data;
        document.body.appendChild(s);
    });
})();
