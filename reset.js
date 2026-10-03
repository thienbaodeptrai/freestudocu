// FreeStudocu - factory reset, exposed to the UI as an "Unblur" button.
//
// A single button that wipes every Studocu cookie (including HttpOnly ones),
// the page's own storage (localStorage, sessionStorage, IndexedDB, Cache
// Storage, Service Worker registrations), then reloads the tab. Studocu signs
// every page image URL with a short-lived token; a fresh session usually
// restores images that stopped loading.
//
// The button appears in two places:
//   1. In a row next to the Download button in the viewer.
//   2. Inside the gated-page note of every premium-locked page.
// The Download button also runs this reset first (resetAll({thenDownload}))
// so the overlay is always built from freshly signed URLs; the background
// tags the reload URL with `_fs_dl=1` and main.js reopens the overlay.
//
// Only the background service worker holds the `cookies` permission, so the
// actual removal runs there. The extension's own settings (chrome.storage.sync)
// are left untouched.

(function () {
    'use strict';

    const FS = globalThis.FreeStudocu;
    const reset = {};
    FS.reset = reset;

    function send(msg) {
        return new Promise(function (resolve) {
            const api = globalThis.chrome;
            if (!api || !api.runtime || !api.runtime.sendMessage) {
                resolve({ ok: false, error: 'chrome.runtime is unavailable' });
                return;
            }
            try {
                api.runtime.sendMessage(msg, function (res) {
                    if (api.runtime.lastError) {
                        resolve({ ok: false, error: api.runtime.lastError.message });
                    } else {
                        resolve(res || { ok: false, error: 'no response from background' });
                    }
                });
            } catch (e) {
                resolve({ ok: false, error: String(e && e.message || e) });
            }
        });
    }

    reset.countCookies = function () {
        return send({ type: 'FS_COOKIE_COUNT' }).then(function (r) {
            return r.count || 0;
        });
    };

    // opts.thenDownload: after the reload, reopen the download overlay
    // automatically (the background adds a `_fs_dl=1` marker to the URL).
    reset.resetAll = function (opts) {
        const o = opts || {};
        return send({ type: 'FS_RESET_ALL', thenDownload: !!o.thenDownload });
    };
    // Auto-unblur: asks the background worker to run a reset only if the
    // cooldown has elapsed. The background decides and reloads the tab itself,
    // so this content script never sees the reload.
    reset.autoUnblur = function () {
        return send({ type: 'FS_AUTO_UNBLUR' });
    };

    // Ask the user before a reset (it signs them out), unless they ticked
    // "don't ask again" earlier. Resolves true when the reset may proceed.
    reset.confirm = function (opts) {
        const o = opts || {};
        if (!FS.settings.confirmBeforeUnblur) return Promise.resolve(true);
        return reset.countCookies().then(function (count) {
            return FS.confirmDialog({
                title: o.title || 'Unblur this document?',
                icon: 'eye',
                message: [
                    o.lead || ('Clears ' + count + ' Studocu cookies (including HttpOnly ones) and all page ' +
                        'storage, then reloads the tab once so Studocu signs a fresh set of page URLs.'),
                    'Blank or blurred pages usually come from expired signed URLs; a fresh session fixes them.',
                    'You will be signed out of Studocu. Your FreeStudocu settings are kept.',
                ],
                confirmLabel: o.confirmLabel || 'Unblur & reload',
                cancelLabel: o.cancelLabel || 'Cancel',
                dontAskLabel: "Don't ask me again",
            });
        }).then(function (res) {
            if (res.confirmed && res.dontAsk) {
                return FS.saveSetting('confirmBeforeUnblur', false).then(function () { return true; });
            }
            return res.confirmed;
        });
    };

    // Factory for an Unblur button. Callers place it wherever they like; clicks
    // are caught by the delegated listener installed in reset.init(), so
    // nothing else needs to wire event handlers on each button.
    reset.createButton = function (options) {
        const opts = options || {};
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = opts.className || 'fs-unblur-button';
        btn.setAttribute('data-freestudocu', 'unblur');
        btn.appendChild(FS.icon('eye', opts.iconSize || 16));
        const label = document.createElement('span');
        label.className = 'fs-btn-label';
        label.textContent = opts.label || 'Unblur';
        btn.appendChild(label);
        btn.title = opts.title ||
            'Fix blank or blurred pages: clear Studocu cookies and storage, then reload (signs you out)';
        return btn;
    };

    let _busy = false;

    function setBusy(btn, busy) {
        const label = btn.querySelector('.fs-btn-label');
        if (busy) {
            btn.disabled = true;
            btn.classList.add('fs-busy');
            if (label) { btn.dataset.fsLabel = label.textContent; label.textContent = 'Unblurring…'; }
        } else {
            btn.disabled = false;
            btn.classList.remove('fs-busy');
            if (label && btn.dataset.fsLabel) label.textContent = btn.dataset.fsLabel;
        }
    }

    function handleClick(btn) {
        if (_busy) return;
        _busy = true;
        reset.confirm().then(function (ok) {
            if (!ok) { _busy = false; return; }
            setBusy(btn, true);
            return reset.resetAll().then(function (res) {
                if (!res.ok) {
                    _busy = false;
                    setBusy(btn, false);
                    FS.notify('Unblur failed - ' + (res.error || 'unknown error'), 6000, 'err');
                }
                // On success the background worker reloads the tab, so this
                // content script dies with the page.
            });
        }).catch(function () { _busy = false; setBusy(btn, false); });
    }

    // One delegated handler catches every Unblur button, wherever it lives.
    // Runs in the capture phase so React never sees the event.
    reset.init = function () {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest && e.target.closest('[data-freestudocu="unblur"]');
            if (!btn || btn.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            handleClick(btn);
        }, true);
        document.addEventListener('mousedown', function (e) {
            if (e.target.closest && e.target.closest('[data-freestudocu="unblur"]')) {
                e.stopPropagation();
            }
        }, true);
    };
})();
