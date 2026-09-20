// FreeStudocu - entry point.
//
// Loads the user's settings, then wires the cleanup and page modules to the
// events that matter on a Studocu document page: DOM mutations, scrolling, and
// a periodic sweep for React re-renders that put the blur back.

(function () {
    'use strict';

    const FS = globalThis.FreeStudocu;
    const cleanup = FS.cleanup;
    const pages = FS.pages;

    function runAll() {
        cleanup.runAll();
        pages.removeBlur();
        pages.ensureAllPagesLoaded();
        pages.patchReactBlurState();
    }

    let debounceTimer = null;
    function debouncedCleanup() {
        if (debounceTimer) return;
        debounceTimer = setTimeout(function () {
            debounceTimer = null;
            cleanup.removeBanners();
            pages.removeBlur();
            pages.ensureAllPagesLoaded();
            cleanup.removePremiumBadges();
            cleanup.removeStudocuDownloadButtons();
        }, 50);
    }

    function looksBlurred(node) {
        if (node.tagName === 'IMG' && (node.src || '').indexOf('blurred') !== -1) return true;
        if (node.querySelector && node.querySelector('img[src*="blurred"]')) return true;
        const cn = (node.className && node.className.toString) ? node.className.toString() : '';
        return cn.indexOf('blurred') !== -1 || cn.indexOf('Blurred') !== -1 ||
            cn.indexOf('PremiumBanner') !== -1 || cn.indexOf('premium-banner') !== -1;
    }

    function observeMutations() {
        const observer = new MutationObserver(function (mutations) {
            let hasNewBlurredContent = false;
            for (let m = 0; m < mutations.length && !hasNewBlurredContent; m++) {
                const mutation = mutations[m];
                if (mutation.type === 'childList') {
                    for (let n = 0; n < mutation.addedNodes.length; n++) {
                        const node = mutation.addedNodes[n];
                        if (node.nodeType === Node.ELEMENT_NODE && looksBlurred(node)) {
                            hasNewBlurredContent = true;
                            break;
                        }
                    }
                } else if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                    const t = mutation.target;
                    if (t.tagName === 'IMG' && (t.src || '').indexOf('blurred') !== -1) hasNewBlurredContent = true;
                }
            }
            if (hasNewBlurredContent) {
                pages.removeBlur();
                pages.patchReactBlurState();
            }
            debouncedCleanup();
        });
        const target = document.body || document.documentElement;
        if (target) {
            observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'class', 'style'],
            });
        }
    }

    function observeScroll() {
        let scrollDebounce = null;
        const onScroll = function () {
            if (scrollDebounce) return;
            scrollDebounce = setTimeout(function () {
                scrollDebounce = null;
                pages.removeBlur();
                pages.ensureAllPagesLoaded();
                pages.patchReactBlurState();
            }, 100);
        };
        const attach = function () {
            ['viewer-wrapper', 'document-wrapper'].forEach(function (id) {
                const node = document.getElementById(id);
                if (node && !node.dataset.fsScroll) {
                    node.dataset.fsScroll = '1';
                    node.addEventListener('scroll', onScroll, { passive: true });
                }
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        attach();
        document.addEventListener('DOMContentLoaded', attach);
        window.addEventListener('load', attach);
    }

    // Every 2 seconds for the first 30 seconds, then every 5 seconds. Skipped
    // while the tab is hidden: nothing can re-blur a page nobody is looking at,
    // and the sweep is not free on long documents.
    function startPeriodicSweep() {
        let count = 0;
        const sweep = function () {
            if (document.hidden) return;
            pages.removeBlur();
            pages.ensureAllPagesLoaded();
            pages.patchReactBlurState();
        };
        const fast = setInterval(function () {
            sweep();
            if (++count >= 15) {
                clearInterval(fast);
                setInterval(sweep, 5000);
            }
        }, 2000);
    }

    function startPeriodicSweep() {
        let count = 0;
        const sweep = function () {
            if (document.hidden) return;
            pages.removeBlur();
            pages.ensureAllPagesLoaded();
            pages.patchReactBlurState();
        };
        const fast = setInterval(function () {
            sweep();
            if (++count >= 15) {
                clearInterval(fast);
                setInterval(sweep, 5000);
            }
        }, 2000);
    }

    // ------------------------------------------------------------------
    // Auto-unblur
    // ------------------------------------------------------------------

    function hasPfs() {
        return document.querySelectorAll('.pf').length > 0;
    }

    function waitForPfs(cb, maxWaitMs) {
        const started = Date.now();
        (function check() {
            if (hasPfs()) { cb(); return; }
            if (Date.now() - started > maxWaitMs) return;
            setTimeout(check, 500);
        })();
    }

    function maybeAutoUnblur() {
        if (!FS.settings.autoUnblurOnLoad) return;
        if (!FS.reset || !FS.reset.autoUnblur) return;

        // If the current URL carries our reset marker, we have just come back
        // from a reset. Strip the marker and skip so we do not loop.
        const url = new URL(window.location.href);
        if (url.searchParams.has('_fs_reset')) {
            url.searchParams.delete('_fs_reset');
            try { history.replaceState(null, '', url.toString()); } catch (e) { /* ignore */ }
            return;
        }

        // Only fire on document pages (they have .pf), not on the homepage.
        waitForPfs(function () {
            // Small extra delay so the viewer has time to fetch the signed
            // URLs before we blow the session away.
            setTimeout(function () {
                FS.reset.autoUnblur();
            }, 2500);
        }, 10000);
    }

    // ------------------------------------------------------------------
    // Settings changes: react to popup edits live
    // ------------------------------------------------------------------

    function watchSettings() {
        if (!globalThis.chrome || !chrome.storage || !chrome.storage.onChanged) return;
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== 'sync') return;
            let touched = false;
            Object.keys(changes).forEach(function (key) {
                if (key in FS.DEFAULT_SETTINGS) {
                    FS.settings[key] = changes[key].newValue;
                    touched = true;
                }
            });
            if (!touched) return;

            FS.applySettingsToDocument();

            // Rebuild the toolbar row so the new visibility rules take effect.
            const row = document.querySelector('.fs-button-row');
            if (row) row.remove();
            if (FS.download && FS.download.refreshButton) FS.download.refreshButton();

            // Re-run cleanup in case something became visible again.
            if (cleanup && cleanup.runAll) cleanup.runAll();
        });
    }

    function start() {
        FS.applySettingsToDocument();
        runAll();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                pages.patchNextData();
                runAll();
            });
        } else {
            pages.patchNextData();
        }
        window.addEventListener('load', runAll);

        setTimeout(pages.primeAllPages, 1800);
        window.addEventListener('load', function () { setTimeout(pages.primeAllPages, 1800); });

        observeMutations();
        observeScroll();
        startPeriodicSweep();
        watchSettings();

        const sidebarToggle = document.querySelector('[data-test-selector="content-sidebar-toggle"]');
        if (sidebarToggle) sidebarToggle.addEventListener('click', cleanup.replaceLogos);

        FS.reset.init();
        FS.download.init();

        // Run auto-unblur last so the rest of the UI has settled.
        maybeAutoUnblur();
    }

    FS.loadSettings().then(start);
})();