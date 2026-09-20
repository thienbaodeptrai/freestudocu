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
// (It is NOT in the download overlay: reloading the tab while the overlay was
// open caused a visible double-reload.)
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

    reset.resetAll = function () {
        return send({ type: 'FS_RESET_ALL' });
    };
    // Auto-unblur: asks the background worker to run a reset only if the
    // cooldown has elapsed. The background decides and reloads the tab itself,
    // so this content script never sees the reload.
    reset.autoUnblur = function () {
        return send({ type: 'FS_AUTO_UNBLUR' });
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
        btn.textContent = opts.label || 'Unblur';
        btn.title = opts.title ||
            'Fix blank or blurred pages: clear Studocu cookies and storage, then reload (signs you out)';
        return btn;
    };

    function handleClick(btn) {
        reset.countCookies().then(function (count) {
            const msg =
                'Unblur this document?\n' +
                '\n' +
                'This clears ' + count + ' cookies from Studocu and the widgets it embeds ' +
                '(Trustpilot reviews, ad networks) - including HttpOnly ones - plus all ' +
                'page storage, then reloads the tab once.\n' +
                '\n' +
                'Why this helps: Studocu serves every page image through a signed URL ' +
                'with a short-lived token. Once that token expires, pages stop loading ' +
                'and show blank or broken images. Clearing the cookies forces Studocu ' +
                'to sign a fresh set of URLs, which usually makes the images load again.\n' +
                '\n' +
                'You will be signed out of Studocu. Your FreeStudocu settings are kept.';
            if (!window.confirm(msg)) return;

            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = 'Unblurring...';

            reset.resetAll().then(function (res) {
                if (!res.ok) {
                    btn.disabled = false;
                    btn.textContent = original;
                    FS.notify('FreeStudocu: unblur failed - ' + (res.error || 'unknown error'));
                }
                // On success the background worker reloads the tab, so this
                // content script dies with the page.
            });
        });
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