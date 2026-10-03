// FreeStudocu - shared namespace.
//
// Every content script listed in manifest.json runs in the same isolated world,
// in manifest order. This file runs first and publishes `globalThis.FreeStudocu`
// (aliased `FS` in the other scripts). It holds the things more than one script
// needs: the selector lists, the document access model, URL builders, the
// premium-locked detection, and the user settings.
//
// Keep this file free of side effects on the page. It only defines things.

(function () {
    'use strict';

    const FS = {};
    globalThis.FreeStudocu = FS;

    FS.LOG_PREFIX = 'FreeStudocu:';
    FS.log = function () {
        const args = Array.prototype.slice.call(arguments);
        args.unshift(FS.LOG_PREFIX);
        console.log.apply(console, args);
    };

    // ---------------------------------------------------------------------
    // Selectors
    //
    // The CSS in style.css hides most of these statically so nothing flashes
    // before the scripts run; the JS removal below is the second line of defence
    // for elements React re-mounts. When you add a selector here, add it to
    // style.css too (and vice versa).
    // ---------------------------------------------------------------------

    FS.SELECTORS = {
        banners: [
            '.banner-wrapper',
            '[class*="InlineBanner_inline-banner"]',
            '[class*="PremiumBannerBlobWrapper"]',
            '[class*="PremiumPageClarificationBanner"]',
            '[class*="PremiumBannerHeader"]',
            '[class*="PremiumBannerBenefitsList"]',
            '[class*="PremiumBannerButtons"]',
            '[data-test-selector="modal-document-viewer-preview-message"]',
            '[data-test-selector="preview-banner-upgrade-first-cta"]',
            '[data-test-selector="preview-banner-upload-second-cta"]',
            '._95f5f1767857',
            '._3273140306b6',
            '._8690b6fc16a3',
            '._4d5ecd011027',
            '[class*="premium-banner-wrapper"]',
            '[class*="PremiumBannerWrapper"]',
            '[class*="premiumBannerWrapper"]',
            '[class*="ViewerContainer_premium"]',
        ],
        premiumBadges: [
            '[class*="PremiumBadge"]',
            '[class*="premium-badge"]',
            '[class*="premiumBadge"]',
            '[class*="PremiumLabel"]',
            '[class*="premiumLabel"]',
            '[class*="premium-label"]',
            '[class*="PremiumTag"]',
            '[class*="premiumTag"]',
            '[class*="premium-tag"]',
            '[class*="premium_tag"]',
            '[class*="premium_badge"]',
            '[class*="PremiumIcon"]',
            '[class*="premiumIcon"]',
            '[class*="premium-icon"]',
            '[data-test-selector*="premium-badge"]',
            '[data-test-selector*="premium-tag"]',
            '[data-test-selector*="premium-label"]',
        ],
        // Ads are served through Refinery89 (r89) wrappers, Google Publisher Tag
        // iframes and Adagio. Hidden by style.css; listed here for reference and
        // for the tests.
        ads: [
            '[class*="AdsContainer"]',
            'r89-standalone',
            '[id^="r89-"]',
            '[id*="r89-"]',
            'iframe[id^="google_ads_iframe"]',
            'div[id^="google_ads_iframe"]',
            '[id^="div-gpt-ad"]',
            '[id*="gpt-ad"]',
            '[id*="adagio"]',
            '[class*="adagio"]',
            '[class*="Advertisement"]',
            '[class*="advertisement"]',
        ],
        // "Ask a question about this document" plus the Mock exam / Summary /
        // Quiz pills, which live in the same wrapper.
        aiToolbar: [
            '[class*="AIToolbar"]',
        ],
        nativeDownloadButton: '[data-test-selector="document-viewer-download-button-topbar"]',
        // Studocu's own Download button (it opens the paywall) has no stable
        // attribute any more, so it is matched by its label. The whole trimmed
        // text must equal one of these, which keeps links like "Download the
        // app" in the footer alone. Add the word for a new locale here.
        nativeDownloadWords: /^(download|downloaden|scarica|descargar|t[eé]l[eé]charger|herunterladen|pobierz|baixar|indir|скачать|ladda ner|last ned|lataa|tải xuống|tải về)$/i,
        logos: [
            '[aria-label="StudeerSnel Logo"]',
            '[aria-label="StuDocu Logo"]',
            '[aria-label="Studocu Logo"]',
        ],
    };

    // Remove every element matching any selector in `list`. Invalid selectors
    // are skipped so one bad entry cannot disable the whole pass.
    FS.removeMatching = function (list, root) {
        const scope = root || document;
        list.forEach(function (selector) {
            try {
                scope.querySelectorAll(selector).forEach(function (el) { el.remove(); });
            } catch (e) { /* invalid selector */ }
        });
    };

    // ---------------------------------------------------------------------
    // Settings
    //
    // Stored in chrome.storage.sync and edited from the toolbar popup. Every
    // feature defaults to on. The `chrome` namespace is used on purpose: Firefox
    // exposes it too, and the callback form works identically in both.
    // ---------------------------------------------------------------------

    FS.DEFAULT_SETTINGS = {
        hideAds: true,
        hideAiToolbar: true,
        replaceLogo: true,
        showDownloadButton: true,
        showUnblurButton: true,
        showGatedNote: true,
        autoLoadPages: true,
        autoUnblurOnLoad: false,
        // Download first runs the Unblur reset (fresh signed URLs), reloads,
        // then reopens the download overlay automatically.
        unblurBeforeDownload: true,
        // Show the confirmation dialog before a reset that signs you out.
        confirmBeforeUnblur: true,
    };

    FS.settings = Object.assign({}, FS.DEFAULT_SETTINGS);

    // Resolves once the value is really persisted (or the write failed), so a
    // caller that is about to reload the tab can wait for it.
    FS.saveSetting = function (key, value) {
        FS.settings[key] = value;
        return new Promise(function (resolve) {
            try {
                const obj = {};
                obj[key] = value;
                chrome.storage.sync.set(obj, function () {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        FS.log('could not save setting', key, chrome.runtime.lastError.message);
                    }
                    resolve();
                });
            } catch (e) { resolve(); /* extension context invalidated */ }
        });
    };

    FS.loadSettings = function () {
        return new Promise(function (resolve) {
            const api = globalThis.chrome;
            if (!api || !api.storage || !api.storage.sync) {
                resolve(FS.settings);
                return;
            }
            try {
                api.storage.sync.get(FS.DEFAULT_SETTINGS, function (stored) {
                    if (stored && typeof stored === 'object') {
                        Object.keys(FS.DEFAULT_SETTINGS).forEach(function (key) {
                            if (typeof stored[key] === 'boolean') FS.settings[key] = stored[key];
                        });
                    }
                    resolve(FS.settings);
                });
            } catch (e) {
                resolve(FS.settings);
            }
        });
    };

    // style.css hides ads, the AI toolbar and Studocu's own download button by
    // default. A disabled feature is expressed as an attribute on <html> that the
    // CSS rules exclude, so turning a feature off needs no stylesheet juggling.
    FS.applySettingsToDocument = function () {
        const root = document.documentElement;
        if (!root) return;
        root.setAttribute('data-fs-ads', FS.settings.hideAds ? 'hide' : 'show');
        root.setAttribute('data-fs-ai', FS.settings.hideAiToolbar ? 'hide' : 'show');
        root.setAttribute('data-fs-download', FS.settings.showDownloadButton ? 'on' : 'off');
        root.setAttribute('data-fs-unblur', FS.settings.showUnblurButton ? 'show' : 'hide');
        root.setAttribute('data-fs-gated-note', FS.settings.showGatedNote ? 'show' : 'hide');
    };

    // ---------------------------------------------------------------------
    // Document access model
    //
    // Studocu renders native PDFs with pdf2htmlEX in split-page mode, so every
    // page is TWO separately signed layers under
    // https://doc-assets.studocu.com/{objectKey}/html/ :
    //
    //   bg{hex}.png               the FIGURE layer: rules, table borders, bullet
    //                             glyphs, coloured boxes. No text.
    //   {objectKey}{n}.page       the TEXT layer: positioned <span>s.
    //   pages/blurred/page{n}.webp  Studocu's blurred preview thumbnail.
    //
    // Only the background images are HEX-numbered (page 18 -> bg12.png, as
    // pdf2htmlEX writes them). The .page fragments and the blurred previews are
    // DECIMAL (page 18 -> {objectKey}18.page, page18.webp).
    //
    // The signing key lives in __NEXT_DATA__ under
    // props.pageProps.documentAccess.signedQueryParams, and its shape varies:
    //   scanned/image docs:    { global }
    //   native pdf2htmlEX docs: { html, css, png, blurredPage, pages }
    // `png`/`global` are wildcard strings for /html/*.png. `pages` is an ARRAY
    // of { pageNumber, signedQueryParams }, one per text-bearing page the reader
    // is allowed to see. A page missing from `pages` on a document that has the
    // key is premium-locked: its text is never sent to the browser in any form
    // (verified live, issue #58), so nothing client-side can un-blur it.
    // ---------------------------------------------------------------------

    FS.DOC_ASSETS = 'https://doc-assets.studocu.com/';

    // First string-valued key out of `keys`, or ''. Never returns the `pages`
    // array (concatenating it into a URL produced "bg8.png[object Object]").
    FS.pickParam = function (sp, keys) {
        if (!sp) return '';
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (typeof sp[k] === 'string' && sp[k]) return sp[k];
        }
        return '';
    };

    // Parse a documentAccess object (plus the optional document object) into the
    // normalised shape the rest of the extension works with. Pure; used by the
    // tests directly.
    FS.parseDocumentAccess = function (da, doc) {
        if (!da || !da.objectKey || !da.signedQueryParams) return null;
        const sp = da.signedQueryParams;
        const pageParams = {};
        if (Array.isArray(sp.pages)) {
            sp.pages.forEach(function (p) {
                if (p && p.pageNumber && typeof p.signedQueryParams === 'string') {
                    pageParams[p.pageNumber] = p.signedQueryParams;
                }
            });
        }
        return {
            objectKey: da.objectKey,
            bgParams: FS.pickParam(sp, ['png', 'global']),
            pageParams: pageParams,
            blurredParams: FS.pickParam(sp, ['blurredPage', 'global']),
            hasBlurredPages: !!da.hasBlurredPages,
            pageCount: doc ? (doc.numberOfPages || doc.pageCount || 0) : 0,
            // True when the document keeps its text in separate .page fragments,
            // i.e. bg{hex}.png is only a figure layer. Keyed off the PRESENCE of
            // `pages`, not its length: `pages: []` means every page is gated, not
            // that the document is a scanned one.
            hasTextLayer: Array.isArray(sp.pages),
        };
    };

    let _docAccess = null;

    // Read (and cache) the access data from #__NEXT_DATA__. Must be called
    // before patchNextData() rewrites hasBlurredPages in that JSON.
    FS.getDocumentAccessData = function () {
        if (_docAccess) return _docAccess;
        try {
            const el = document.querySelector('#__NEXT_DATA__');
            if (!el) return null;
            const data = JSON.parse(el.textContent);
            const props = data && data.props && data.props.pageProps;
            _docAccess = FS.parseDocumentAccess(props && props.documentAccess, props && props.document);
        } catch (e) {
            _docAccess = null;
        }
        return _docAccess;
    };

    // Figure-layer background: HEX page number, png/global param.
    FS.bgImageUrl = function (a, pageNum) {
        if (!a || !a.bgParams) return '';
        return FS.DOC_ASSETS + a.objectKey + '/html/bg' + pageNum.toString(16) + '.png' + a.bgParams;
    };

    // Per-page text fragment, signed per page. '' when this page has no entry.
    // DECIMAL page number: pdf2htmlEX names split pages with %d but background
    // images with %x. Verified live (2026-09): the viewer requests
    // {objectKey}10.page for page 10 while page 10's background is bga.png.
    FS.pageTextUrl = function (a, pageNum) {
        if (!a) return '';
        const param = a.pageParams[pageNum];
        if (!param) return '';
        return FS.DOC_ASSETS + a.objectKey + '/html/' + a.objectKey + pageNum + '.page' + param;
    };

    // Studocu's own blurred preview raster. DECIMAL page number.
    FS.blurredPageUrl = function (a, pageNum) {
        if (!a || !a.blurredParams) return '';
        return FS.DOC_ASSETS + a.objectKey + '/html/pages/blurred/page' + pageNum + '.webp' + a.blurredParams;
    };

    // A page is premium-locked when the document has text layers but this page
    // has no signed entry for its own. Deliberately NOT keyed off hasBlurredPages,
    // which patchNextData() rewrites; `pages` is never rewritten.
    FS.isTextGated = function (a, pageNum) {
        return !!(a && a.hasTextLayer && !a.pageParams[pageNum]);
    };

    // Convert a baked-in-blur raster URL to its clear sibling, keeping the signed
    // param. Returns null when the URL is not a blurred one.
    FS.deblurUrl = function (url) {
        if (!url || url.indexOf('/blurred/') === -1) return null;
        return url.replace('/pages/blurred/', '/pages/').replace('/blurred/', '/');
    };

    FS.gatedNoteText = function (pageNum) {
        return 'Page ' + pageNum + ' is premium-locked. Studocu does not send the text ' +
            'of this page to non-subscribers, so it cannot be unblurred.';
    };

    // The label placed on a premium-locked page, in the viewer and in the
    // download. Idempotent per page via the data attribute.
    FS.createGatedNote = function (pageNum) {
        const note = document.createElement('div');
        note.setAttribute('data-fs-gated-note', String(pageNum));
        note.className = 'fs-gated-note';
        note.textContent = FS.gatedNoteText(pageNum);
        return note;
    };

    // ---------------------------------------------------------------------
    // Viewer DOM helpers
    // ---------------------------------------------------------------------

    // The pages of the live viewer, excluding the clones the download overlay
    // renders (it reuses the `.p2hv` class so the pdf2htmlEX CSS applies).
    FS.viewerPages = function () {
        const all = document.querySelectorAll('.pf');
        return Array.prototype.filter.call(all, function (pf) {
            return !pf.closest('#fs-dl-overlay');
        });
    };

    // The element that actually scrolls the document. On the current site the
    // viewer wrappers are as tall as their content and the WINDOW scrolls, so a
    // wrapper is only chosen when it really overflows; otherwise the auto-load
    // pass would "restore" a wrapper's scrollTop to 0 and leave the reader
    // stranded fifty pages down.
    FS.getScroller = function () {
        const candidates = [document.getElementById('viewer-wrapper'), document.getElementById('document-wrapper')];
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (!el || el.scrollHeight <= el.clientHeight + 1) continue;
            const oy = getComputedStyle(el).overflowY;
            if (oy === 'auto' || oy === 'scroll') return el;
        }
        return document.scrollingElement || document.documentElement;
    };

    // Snapshot and restore the reader's position across a pass that scrolls
    // the whole document (auto-load, download capture). Both the scroller and
    // the window are recorded so it works whichever one owns the scroll.
    FS.saveScroll = function () {
        const el = FS.getScroller();
        return { el: el, top: el ? el.scrollTop : 0, y: window.scrollY || 0 };
    };
    FS.restoreScroll = function (saved) {
        if (!saved) return;
        try { if (saved.el) saved.el.scrollTop = saved.top; } catch (e) { /* detached */ }
        try { window.scrollTo(0, saved.y); } catch (e) { /* not scrollable */ }
    };

    // A page shows real text once it has more than a handful of spans; empty
    // lazy placeholders have none.
    FS.hasTextSpans = function (pf) {
        return pf.querySelectorAll('span').length > 3;
    };

    FS.imgLoaded = function (img) {
        return !!(img && img.complete && img.naturalWidth > 0);
    };

    // ---------------------------------------------------------------------
    // Guarded DOM writes
    //
    // Assigning an inline style or calling classList.add() queues a mutation
    // record even when the value does not change. main.js observes `style`
    // and `class`, so unguarded writes from the periodic blur sweep kept
    // re-triggering the observer every 50 ms. Only write what differs.
    // ---------------------------------------------------------------------

    FS.setStyles = function (el, styles) {
        if (!el || !el.style) return;
        for (const k in styles) {
            if (el.style[k] !== styles[k]) el.style[k] = styles[k];
        }
    };

    FS.addClass = function (el, cls) {
        if (el && el.classList && !el.classList.contains(cls)) el.classList.add(cls);
    };

    FS.sleep = function (ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    };

    // Resolve once predicate() is truthy, or with false after timeoutMs.
    FS.waitFor = function (predicate, timeoutMs, intervalMs) {
        const started = Date.now();
        return new Promise(function (resolve) {
            (function check() {
                let ok = false;
                try { ok = !!predicate(); } catch (e) { ok = false; }
                if (ok) { resolve(true); return; }
                if (Date.now() - started > timeoutMs) { resolve(false); return; }
                setTimeout(check, intervalMs || 250);
            })();
        });
    };

    // ---------------------------------------------------------------------
    // Fresh session tracking
    //
    // Set by main.js when the page loads straight out of a reset. Download
    // skips its own reset while the session is still fresh, so closing and
    // reopening the overlay does not reload the tab again.
    // ---------------------------------------------------------------------

    FS.FRESH_SESSION_MS = 10 * 60 * 1000;
    FS.freshSession = null; // { at, path }

    FS.isFreshSession = function () {
        const s = FS.freshSession;
        return !!(s && s.path === location.pathname && Date.now() - s.at < FS.FRESH_SESSION_MS);
    };

    // ---------------------------------------------------------------------
    // Icons
    //
    // Built with createElementNS instead of innerHTML so the markup works on
    // pages that enforce Trusted Types.
    // ---------------------------------------------------------------------

    const ICONS = {
        download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
        eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
        sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
        close: ['M18 6 6 18', 'M6 6l12 12'],
        printer: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
        refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
        check: ['M20 6 9 17l-5-5'],
        lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
        alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
        info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01'],
    };

    FS.icon = function (name, size) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        const s = String(size || 16);
        svg.setAttribute('width', s);
        svg.setAttribute('height', s);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'fs-icon');
        (ICONS[name] || []).forEach(function (d) {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', d);
            svg.appendChild(p);
        });
        return svg;
    };

    // ---------------------------------------------------------------------
    // Toast and modal
    // ---------------------------------------------------------------------

    // Small in-page notice used instead of alert(), which blocks the tab.
    // kind: 'info' (default) | 'ok' | 'err'.
    FS.notify = function (message, ms, kind) {
        let el = document.getElementById('fs-notice');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fs-notice';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            (document.body || document.documentElement).appendChild(el);
        }
        const k = kind || (/fail|error|could not/i.test(message) ? 'err' : 'info');
        el.className = 'fs-notice-' + k;
        el.replaceChildren(
            FS.icon(k === 'err' ? 'alert' : (k === 'ok' ? 'check' : 'info'), 18),
            document.createTextNode(String(message).replace(/^FreeStudocu:\s*/, ''))
        );
        // Force a reflow so the transition replays when re-shown.
        void el.offsetWidth;
        el.classList.add('fs-notice-visible');
        clearTimeout(el._fsTimer);
        el._fsTimer = setTimeout(function () {
            el.classList.remove('fs-notice-visible');
        }, ms || 5000);
    };

    // Non-blocking replacement for window.confirm(). Resolves with
    // { confirmed: boolean, dontAsk: boolean }.
    FS.confirmDialog = function (opts) {
        const o = opts || {};
        return new Promise(function (resolve) {
            const prev = document.getElementById('fs-modal');
            if (prev) prev.remove();

            const backdrop = document.createElement('div');
            backdrop.id = 'fs-modal';
            backdrop.setAttribute('data-freestudocu', 'modal');

            const box = document.createElement('div');
            box.className = 'fs-modal-box';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');

            const head = document.createElement('div');
            head.className = 'fs-modal-head';
            const badge = document.createElement('div');
            badge.className = 'fs-modal-badge' + (o.danger ? ' fs-danger' : '');
            badge.appendChild(FS.icon(o.icon || (o.danger ? 'alert' : 'info'), 20));
            const title = document.createElement('h2');
            title.className = 'fs-modal-title';
            title.textContent = o.title || 'Are you sure?';
            head.appendChild(badge);
            head.appendChild(title);
            box.appendChild(head);

            const body = document.createElement('div');
            body.className = 'fs-modal-body';
            (Array.isArray(o.message) ? o.message : [o.message || '']).forEach(function (para) {
                const p = document.createElement('p');
                p.textContent = para;
                body.appendChild(p);
            });
            box.appendChild(body);

            let dontAskInput = null;
            if (o.dontAskLabel) {
                const lbl = document.createElement('label');
                lbl.className = 'fs-modal-check';
                dontAskInput = document.createElement('input');
                dontAskInput.type = 'checkbox';
                lbl.appendChild(dontAskInput);
                lbl.appendChild(document.createTextNode(' ' + o.dontAskLabel));
                box.appendChild(lbl);
            }

            const actions = document.createElement('div');
            actions.className = 'fs-modal-actions';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'fs-modal-btn fs-modal-cancel';
            cancel.textContent = o.cancelLabel || 'Cancel';
            const ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'fs-modal-btn fs-modal-ok' + (o.danger ? ' fs-danger' : '');
            ok.textContent = o.confirmLabel || 'Continue';
            actions.appendChild(cancel);
            actions.appendChild(ok);
            box.appendChild(actions);

            backdrop.appendChild(box);
            (document.body || document.documentElement).appendChild(backdrop);
            requestAnimationFrame(function () { backdrop.classList.add('fs-modal-open'); });
            ok.focus();

            function finish(confirmed) {
                document.removeEventListener('keydown', onKey, true);
                backdrop.classList.remove('fs-modal-open');
                setTimeout(function () { backdrop.remove(); }, 160);
                resolve({ confirmed: confirmed, dontAsk: !!(dontAskInput && dontAskInput.checked) });
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
                else if (e.key === 'Enter' && document.activeElement !== cancel) {
                    e.preventDefault(); e.stopPropagation(); finish(true);
                }
            }
            // Keep page handlers (React, the viewer) from seeing modal clicks.
            ['click', 'mousedown', 'pointerdown'].forEach(function (type) {
                backdrop.addEventListener(type, function (e) { e.stopPropagation(); });
            });
            backdrop.addEventListener('click', function (e) { if (e.target === backdrop) finish(false); });
            cancel.addEventListener('click', function () { finish(false); });
            ok.addEventListener('click', function () { finish(true); });
            document.addEventListener('keydown', onKey, true);
        });
    };
})();