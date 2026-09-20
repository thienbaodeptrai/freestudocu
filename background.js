// FreeStudocu - background service worker.
//
// Only the background context holds the `cookies` permission, so every cookie
// removal (including HttpOnly cookies that the page cannot touch) happens here.
// The content script sends a message, the worker clears everything and then
// reloads the originating tab exactly once, with a cache-buster.

'use strict';

const PARTNER_DOMAINS = [
    'studocu',
    'trustpilot',
    'refinery89',
    'adagio',
];

// Cooldown between two consecutive auto-unblur runs. Prevents the automatic
// path from reloading the tab in a loop when the user navigates quickly.
const AUTO_UNBLUR_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Tabs currently being reset. Entries expire after 30 seconds so a failed
// reset cannot lock a tab forever.
const _resetting = new Map();

function isResetting(tabId) {
    const t = _resetting.get(tabId);
    if (!t) return false;
    if (Date.now() - t > 30000) { _resetting.delete(tabId); return false; }
    return true;
}
function markResetting(tabId) { _resetting.set(tabId, Date.now()); }
function clearResetting(tabId) { _resetting.delete(tabId); }

async function collectStudocuCookies() {
    const all = await chrome.cookies.getAll({});
    return all.filter(function (c) {
        const d = (c.domain || '').toLowerCase();
        return PARTNER_DOMAINS.some(function (p) { return d.indexOf(p) !== -1; });
    });
}

async function removeCookies(cookies) {
    let removed = 0;
    let failed = 0;
    await Promise.all(cookies.map(async function (c) {
        const host = c.domain.replace(/^\./, '');
        const scheme = c.secure ? 'https' : 'http';
        const url = scheme + '://' + host + (c.path || '/');
        try {
            const r = await chrome.cookies.remove({
                url: url,
                name: c.name,
                storeId: c.storeId,
            });
            if (r) removed++; else failed++;
        } catch (e) {
            failed++;
            console.warn('[FreeStudocu] cookie remove failed:', c.domain, c.name, String(e));
        }
    }));
    return { removed: removed, failed: failed };
}

function clearStorageAndReloadInPage() {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    try {
        if (indexedDB.databases) {
            indexedDB.databases().then(function (dbs) {
                dbs.forEach(function (db) {
                    if (db && db.name) indexedDB.deleteDatabase(db.name);
                });
            }).catch(function () {});
        }
    } catch (e) {}
    try {
        if (self.caches) {
            caches.keys().then(function (keys) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }).catch(function () {});
        }
    } catch (e) {}
    try {
        if (navigator.serviceWorker) {
            navigator.serviceWorker.getRegistrations().then(function (regs) {
                return Promise.all(regs.map(function (r) { return r.unregister(); }));
            }).catch(function () {});
        }
    } catch (e) {}

    var url = new URL(window.location.href);
    url.searchParams.set('_fs_reset', Date.now().toString(36));
    window.location.replace(url.toString());
}

async function readAutoUnblurTimestamp() {
    try {
        const data = await chrome.storage.local.get({ fs_lastAutoUnblur: 0 });
        return data.fs_lastAutoUnblur || 0;
    } catch (e) { return 0; }
}

async function writeAutoUnblurTimestamp(ts) {
    try { await chrome.storage.local.set({ fs_lastAutoUnblur: ts }); } catch (e) {}
}

// Perform a reset for the given tab: clears matching cookies, then injects
// the clear+reload function. Shared by manual and automatic paths.
async function performReset(tabId) {
    const cookies = await collectStudocuCookies();
    const result = await removeCookies(cookies);
    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: clearStorageAndReloadInPage,
    });
    return { total: cookies.length, removed: result.removed, failed: result.failed };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'FS_COOKIE_COUNT') {
        collectStudocuCookies().then(function (cookies) {
            sendResponse({ count: cookies.length });
        }).catch(function () { sendResponse({ count: 0 }); });
        return true;
    }

    // Open the settings popup. chrome.action.openPopup() only works from an
    // extension context, so the content script relays through here.
    if (msg.type === 'FS_OPEN_POPUP') {
        (async function () {
            try {
                if (chrome.action && typeof chrome.action.openPopup === 'function') {
                    await chrome.action.openPopup();
                    sendResponse({ ok: true });
                } else {
                    sendResponse({ ok: false, error: 'openPopup not supported' });
                }
            } catch (e) {
                sendResponse({ ok: false, error: String(e && e.message || e) });
            }
        })();
        return true;
    }

    if (msg.type === 'FS_RESET_ALL') {
        const tabId = (msg.tabId != null) ? msg.tabId : (sender.tab && sender.tab.id);
        if (tabId == null) {
            sendResponse({ ok: false, error: 'no tab to reset' });
            return true;
        }
        if (isResetting(tabId)) {
            sendResponse({ ok: false, error: 'reset already in progress for this tab' });
            return true;
        }
        markResetting(tabId);

        (async function () {
            try {
                const res = await performReset(tabId);
                sendResponse(Object.assign({ ok: true }, res));
                // The injected function navigates the tab. No cleanup of
                // _resetting is needed on success; the map entry expires.
            } catch (e) {
                clearResetting(tabId);
                try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch (err) {}
            }
        })();
        return true;
    }

    if (msg.type === 'FS_AUTO_UNBLUR') {
        const tabId = sender.tab && sender.tab.id;
        if (tabId == null) {
            sendResponse({ ok: false, error: 'no tab' });
            return true;
        }
        if (isResetting(tabId)) {
            sendResponse({ ok: true, skipped: 'in-progress' });
            return true;
        }
        (async function () {
            try {
                const last = await readAutoUnblurTimestamp();
                if (Date.now() - last < AUTO_UNBLUR_COOLDOWN_MS) {
                    sendResponse({ ok: true, skipped: 'cooldown' });
                    return;
                }
                markResetting(tabId);
                await writeAutoUnblurTimestamp(Date.now());
                const res = await performReset(tabId);
                sendResponse(Object.assign({ ok: true, auto: true }, res));
            } catch (e) {
                clearResetting(tabId);
                try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch (err) {}
            }
        })();
        return true;
    }
});