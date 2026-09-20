// FreeStudocu - settings popup.
//
// Reads/writes the same chrome.storage.sync keys the content scripts use.
// Also offers a "Factory reset now" button that asks the background worker
// to clear cookies on the active Studocu tab.

'use strict';

const DEFAULTS = {
    hideAds: true,
    hideAiToolbar: true,
    replaceLogo: true,
    showDownloadButton: true,
    showUnblurButton: true,
    showGatedNote: true,
    autoLoadPages: true,
    autoUnblurOnLoad: false,
};

const FIELDS = Object.keys(DEFAULTS);

const STUDOCU_HOSTS = ['studocu.com', 'studeersnel.nl', 'studocu.vn', 'studocu.id'];

function $(id) { return document.getElementById(id); }

let statusTimer = 0;
function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
    if (statusTimer) clearTimeout(statusTimer);
    if (msg) {
        statusTimer = setTimeout(function () {
            el.textContent = '';
            el.className = 'status';
            statusTimer = 0;
        }, 3000);
    }
}

function isStudocuUrl(url) {
    if (!url) return false;
    return STUDOCU_HOSTS.some(function (h) { return url.indexOf(h) !== -1; });
}

function loadIntoForm() {
    chrome.storage.sync.get(DEFAULTS, function (stored) {
        FIELDS.forEach(function (key) {
            const input = $(key);
            if (!input) return;
            input.checked = (typeof stored[key] === 'boolean') ? stored[key] : DEFAULTS[key];
        });
    });
}

function saveField(key, value) {
    const obj = {};
    obj[key] = value;
    chrome.storage.sync.set(obj, function () {
        if (chrome.runtime.lastError) {
            setStatus('Failed to save: ' + chrome.runtime.lastError.message, 'err');
        } else {
            setStatus('Saved');
        }
    });
}

FIELDS.forEach(function (key) {
    const input = $(key);
    if (!input) return;
    input.addEventListener('change', function () {
        saveField(key, input.checked);
    });
});

$('reset').addEventListener('click', function () {
    chrome.storage.sync.set(DEFAULTS, function () {
        if (chrome.runtime.lastError) {
            setStatus('Failed: ' + chrome.runtime.lastError.message, 'err');
            return;
        }
        FIELDS.forEach(function (key) {
            const input = $(key);
            if (input) input.checked = DEFAULTS[key];
        });
        setStatus('Reset to defaults', 'ok');
    });
});

$('factory').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
            setStatus('No active tab', 'err');
            return;
        }
        if (!isStudocuUrl(tab.url)) {
            setStatus('This is not a Studocu tab', 'err');
            return;
        }
        const ok = window.confirm(
            'Run the factory reset now?\n\n' +
            'This clears Studocu cookies and page storage, then reloads the tab.\n' +
            'You will be signed out. FreeStudocu settings are kept.'
        );
        if (!ok) return;

        chrome.runtime.sendMessage({ type: 'FS_RESET_ALL', tabId: tab.id }, function (res) {
            if (chrome.runtime.lastError) {
                setStatus('Failed: ' + chrome.runtime.lastError.message, 'err');
                return;
            }
            if (res && res.ok) {
                setStatus('Reset started', 'ok');
                window.close();
            } else {
                setStatus('Failed: ' + ((res && res.error) || 'unknown error'), 'err');
            }
        });
    });
});

loadIntoForm();