// FreeStudocu - document download.
//
// The viewer lazy-loads page text and unmounts pages that scroll out of view,
// so a faithful copy is built incrementally:
//   1. Scroll to each page, wait until it has rendered, clone it at once.
//   2. Assemble the clones in a fresh `.p2hv` container (the pdf2htmlEX
//      stylesheet already on the page scopes its rules under that class).
//   3. Point each page's background at its full-resolution figure layer, and
//      keep Studocu's blurred preview (plus a label) on premium-locked pages.
//   4. Embed every image as a data URI.
// The result is shown in a same-tab overlay (a backgrounded tab throttles
// timers and pauses lazy-loading) and printed to PDF with the browser.

(function () {
    'use strict';

    const FS = globalThis.FreeStudocu;
    const download = {};
    FS.download = download;

    function getTitle() {
        const h1 = document.querySelector('h1');
        return h1 ? h1.textContent.trim() : (document.title || 'document');
    }

    // Where each page's assets come from. Prefers the access model from
    // #__NEXT_DATA__; falls back to deriving the bg pattern from a
    // full-resolution image already in the DOM (no gating info in that case).
    function resolvePageAssets() {
        const a = FS.getDocumentAccessData();
        if (a && a.bgParams) {
            return {
                bgUrl: function (n) { return FS.bgImageUrl(a, n); },
                blurUrl: function (n) { return FS.blurredPageUrl(a, n); },
                isGated: function (n) { return FS.isTextGated(a, n); },
            };
        }
        const imgs = document.querySelectorAll('.pf img');
        for (let i = 0; i < imgs.length; i++) {
            const s = imgs[i].src || '';
            if (s.indexOf('/bg') !== -1 && s.indexOf('doc-assets') !== -1 && imgs[i].naturalWidth > 600) {
                const m = s.match(/(.*?\/bg)[0-9a-f]+(\.png\?.*)/i);
                if (m) {
                    return {
                        bgUrl: function (n) { return m[1] + n.toString(16) + m[2]; },
                        blurUrl: function () { return ''; },
                        isGated: function () { return false; },
                    };
                }
            }
        }
        return null;
    }

    // A page is "rendered" once it leaves the empty lazy placeholder state.
    function pageRendered(pf) {
        return pf.innerHTML.length > 500 && (FS.hasTextSpans(pf) || FS.imgLoaded(pf.querySelector('img')));
    }

    // Wait until a page has rendered and its content size has stabilised.
    function waitForPageReady(pf) {
        return new Promise(function (resolve) {
            let lastLen = -1, stable = 0, tries = 0;
            (function check() {
                const len = pf.innerHTML.length;
                if (pageRendered(pf)) {
                    if (len === lastLen) { stable++; } else { stable = 0; lastLen = len; }
                    if (stable >= 2) { resolve(); return; }
                }
                if (tries++ > 30) { resolve(); return; } // ~4.5s cap per page
                setTimeout(check, 150);
            })();
        });
    }

    // Scroll to each page, wait for it, clone it. Resolves with the clones in
    // page order and restores the scroll position.
    function captureAllPages(onProgress) {
        const pfs = FS.viewerPages();
        const saved = FS.saveScroll();
        const captured = [];
        return new Promise(function (resolve) {
            let i = 0;
            (function next() {
                if (i >= pfs.length) {
                    FS.restoreScroll(saved);
                    resolve(captured);
                    return;
                }
                const pf = pfs[i];
                try { pf.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) { /* detached */ }
                waitForPageReady(pf).then(function () {
                    captured.push(pf.cloneNode(true));
                    i++;
                    if (onProgress) onProgress(i, pfs.length);
                    next();
                });
            })();
        });
    }

    function fetchDataUri(url) {
        return fetch(url, { credentials: 'omit' })
            .then(function (r) { return r.ok ? r.blob() : null; })
            .then(function (blob) {
                if (!blob || blob.size === 0) return null;
                return new Promise(function (resolve) {
                    const fr = new FileReader();
                    fr.onload = function () { resolve(fr.result); };
                    fr.onerror = function () { resolve(null); };
                    fr.readAsDataURL(blob);
                });
            })
            .catch(function () { return null; });
    }

    // Replace every doc-assets image src inside `root` with a data URI.
    function embedImages(root, onProgress) {
        const targets = Array.prototype.filter.call(root.querySelectorAll('img'), function (img) {
            const s = img.getAttribute('src') || '';
            return s.indexOf('doc-assets') !== -1 || s.indexOf('/bg') !== -1;
        });
        const urls = Array.from(new Set(targets.map(function (img) { return img.getAttribute('src'); })));
        const map = {};
        let next = 0, done = 0;
        const CONCURRENCY = 6;

        return new Promise(function (resolve) {
            if (urls.length === 0) { resolve(); return; }
            function worker() {
                if (next >= urls.length) return Promise.resolve();
                const url = urls[next++];
                return fetchDataUri(url).then(function (dataUri) {
                    if (dataUri) map[url] = dataUri;
                    done++;
                    if (onProgress) onProgress(done, urls.length);
                    return worker();
                });
            }
            const starters = [];
            for (let c = 0; c < Math.min(CONCURRENCY, urls.length); c++) starters.push(worker());
            Promise.all(starters).then(function () {
                targets.forEach(function (img) {
                    const s = img.getAttribute('src');
                    if (map[s]) {
                        img.setAttribute('src', map[s]);
                        img.removeAttribute('srcset');
                    }
                });
                resolve();
            });
        });
    }

    // Assemble the clones into a fresh `.p2hv` container. Only that class is
    // kept: the live viewer's other classes carry virtual-scroller layout that
    // breaks pages cloned out of it.
    download.assembleContainer = function (capturedPages, assets) {
        const container = document.createElement('div');
        container.className = 'p2hv';

        capturedPages.forEach(function (pf, idx) {
            const pageNum = idx + 1;
            pf.removeAttribute('style');
            // Strip our own UI out of the clone. This covers the Unblur button
            // that markGatedPage() places inside the gated note as well.
            pf.querySelectorAll('.download-button-1, [data-freestudocu]').forEach(function (e) { e.remove(); });
            pf.querySelectorAll('[style]').forEach(function (e) {
                const st = e.getAttribute('style') || '';
                if (/display:\s*none/i.test(st)) {
                    e.setAttribute('style', st.replace(/display:\s*none/ig, 'display:block'));
                }
            });

            if (assets) {
                let img = pf.querySelector('img.bi') || pf.querySelector('img');
                const cur = img ? (img.getAttribute('src') || '') : '';
                if (!img) {
                    img = document.createElement('img');
                    img.className = 'bi x0 y0 w1 h1';
                    (pf.querySelector('.pc') || pf).appendChild(img);
                }
                if (assets.isGated(pageNum)) {
                    // Premium-locked: print Studocu's blurred preview, the only
                    // rendering of this page that exists, and label it.
                    const blur = assets.blurUrl(pageNum);
                    if (cur.indexOf('/pages/blurred/') === -1 && blur) img.setAttribute('src', blur);
                    if (!pf.querySelector('[data-fs-gated-note]')) pf.appendChild(FS.createGatedNote(pageNum));
                } else {
                    const clear = FS.deblurUrl(cur);
                    img.setAttribute('src', clear || assets.bgUrl(pageNum));
                }
                img.removeAttribute('srcset');
                img.removeAttribute('data-src');
            }

            // The viewer hides `.page-content` while scrolled out of view.
            pf.querySelectorAll('.page-content').forEach(function (pc) {
                pc.style.setProperty('display', 'block', 'important');
                pc.style.setProperty('filter', 'none', 'important');
                pc.style.setProperty('visibility', 'visible', 'important');
                pc.style.setProperty('opacity', '1', 'important');
            });
            container.appendChild(pf);
        });
        return container;
    };

    // Make each printed sheet exactly the size of the page it carries. Without
    // this the browser prints on its default paper (Letter or A4) and the
    // pdf2htmlEX page, which has its own fixed pixel size, is scaled onto it
    // with a blank strip at the bottom. Pages of different sizes get their
    // own named @page rule, so a landscape page in a portrait document still
    // prints on a landscape sheet. Returns the CSS it applied ('' if the
    // pages have no layout yet).
    download.applyPageSizes = function (container) {
        const pfs = container.querySelectorAll('.pf');
        const rules = [];
        const names = {};
        pfs.forEach(function (pf) {
            const r = pf.getBoundingClientRect();
            const w = Math.round(r.width), h = Math.round(r.height);
            if (!(w > 0 && h > 0)) return;
            const key = w + 'x' + h;
            if (!names[key]) {
                names[key] = 'fs-page-' + (rules.length + 1);
                rules.push('@page ' + names[key] + '{size:' + w + 'px ' + h + 'px;margin:0;}');
            }
            pf.style.setProperty('page', names[key]);
        });
        let style = document.getElementById('fs-dl-page-size');
        if (!style) {
            style = document.createElement('style');
            style.id = 'fs-dl-page-size';
            document.head.appendChild(style);
        }
        style.textContent = rules.join('');
        return style.textContent;
    };

    // ------------------------------------------------------------------
    // Overlay UI
    // ------------------------------------------------------------------

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function createOverlay(title, pageCount) {
        const overlay = el('div');
        overlay.id = 'fs-dl-overlay';

        const bar = el('div', 'fs-dl-bar');
        const titleEl = el('div', 'fs-dl-title', title);
        const meta = el('div', 'fs-dl-meta', pageCount + (pageCount === 1 ? ' page' : ' pages'));
        const actions = el('div', 'fs-dl-actions');
        const hint = el('span', 'fs-dl-hint', 'Choose "Save as PDF" in the print dialog');
        const printBtn = el('button', 'fs-dl-print', 'Print / Save as PDF');
        printBtn.disabled = true;
        printBtn.addEventListener('click', function () { window.print(); });
        const closeBtn = el('button', 'fs-dl-close', 'Close');
        closeBtn.title = 'Close (Esc)';
        actions.appendChild(hint);
        actions.appendChild(printBtn);
        actions.appendChild(closeBtn);
        const left = el('div', 'fs-dl-left');
        left.appendChild(titleEl);
        left.appendChild(meta);
        bar.appendChild(left);
        bar.appendChild(actions);

        const loading = el('div', 'fs-dl-loading');
        const msg = el('div', 'fs-dl-msg', 'Loading all pages');
        const barWrap = el('div', 'fs-dl-progress');
        const fill = el('div', 'fs-dl-fill');
        barWrap.appendChild(fill);
        const sub = el('div', 'fs-dl-sub');
        loading.appendChild(msg);
        loading.appendChild(barWrap);
        loading.appendChild(sub);
        const pagesEl = el('div', 'fs-dl-pages');

        // Notice bar: the overlay cannot reset the Studocu session without
        // losing itself (a reset reloads the tab, which destroys this overlay).
        // Tell the user the correct order: close, Unblur outside, wait for the
        // reload, then open Download again.
        const notice = el('div', 'fs-dl-notice',
            'Pages look blurry or blank? Close this overlay (Esc), ' +
            'click Unblur in the toolbar, wait for the page to reload, ' +
            'then open Download again.');

        overlay.appendChild(bar);
        overlay.appendChild(notice);
        overlay.appendChild(loading);
        overlay.appendChild(pagesEl);

        function close() {
            overlay.remove();
            const sizes = document.getElementById('fs-dl-page-size');
            if (sizes) sizes.remove();
            document.body.classList.remove('fs-dl-open');
            document.documentElement.classList.remove('fs-dl-open');
            document.removeEventListener('keydown', onKey, true);
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        }
        closeBtn.addEventListener('click', close);
        document.addEventListener('keydown', onKey, true);

        return { overlay: overlay, fill: fill, sub: sub, loading: loading, pages: pagesEl, printBtn: printBtn, close: close };
    }

    download.generatePDF = function () {
        if (document.getElementById('fs-dl-overlay')) return;
        const pfs = FS.viewerPages();
        if (!document.querySelector('.p2hv') || pfs.length === 0) {
            FS.notify('FreeStudocu: could not find the document pages. Scroll the document a little, then click Download again.');
            return;
        }

        const ui = createOverlay(getTitle(), pfs.length);
        document.body.appendChild(ui.overlay);
        // The print rules in style.css only isolate the overlay while this
        // class is present.
        document.body.classList.add('fs-dl-open');
        document.documentElement.classList.add('fs-dl-open');
        const assets = resolvePageAssets();

        captureAllPages(function (done, total) {
            ui.fill.style.width = Math.round(done / total * 70) + '%';
            ui.sub.textContent = 'Capturing pages ' + done + ' / ' + total;
        }).then(function (capturedPages) {
            if (!capturedPages.length) throw new Error('no pages');
            const container = download.assembleContainer(capturedPages, assets);
            return embedImages(container, function (done, total) {
                ui.fill.style.width = (70 + Math.round((total ? done / total : 1) * 30)) + '%';
                ui.sub.textContent = 'Embedding images ' + done + ' / ' + total;
            }).then(function () { return container; });
        }).then(function (container) {
            ui.loading.remove();
            ui.pages.appendChild(container);
            download.applyPageSizes(container);
            ui.printBtn.disabled = false;
            ui.printBtn.focus();
        }).catch(function () {
            ui.sub.textContent = 'Could not build the document. Refresh the page and try again.';
        });
    };

    // ------------------------------------------------------------------
    // Toolbar button row (Download + Unblur + Settings)
    // ------------------------------------------------------------------

    function createDownloadButton() {
        const btn = el('button', 'download-button-1');
        btn.type = 'button';
        btn.setAttribute('data-freestudocu', 'download');
        btn.title = 'Download the full document as PDF (FreeStudocu)';
        const icon = el('span', 'download-icon', '⤓');
        icon.setAttribute('aria-hidden', 'true');
        const label = el('span', 'download-text', 'Download');
        btn.appendChild(icon);
        btn.appendChild(label);
        return btn;
    }

    // Settings button: tries to open the extension popup via the background
    // (chrome.action.openPopup is only callable from an extension context).
    // Falls back to a notice pointing at the toolbar icon.
    function createSettingsButton() {
        const btn = el('button', 'fs-settings-button');
        btn.type = 'button';
        btn.title = 'FreeStudocu settings';
        btn.setAttribute('aria-label', 'FreeStudocu settings');
        btn.setAttribute('data-freestudocu', 'settings');
        btn.textContent = '\u2699'; // gear
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            try {
                chrome.runtime.sendMessage({ type: 'FS_OPEN_POPUP' }, function (res) {
                    if (chrome.runtime.lastError || !res || !res.ok) {
                        FS.notify('FreeStudocu: click the extension icon in your toolbar to open settings.');
                    }
                });
            } catch (err) {
                FS.notify('FreeStudocu: click the extension icon in your toolbar to open settings.');
            }
        });
        return btn;
    }

    function createButtonRow() {
        const row = el('div', 'fs-button-row');
        row.appendChild(createDownloadButton());
        if (FS.reset && FS.reset.createButton) {
            row.appendChild(FS.reset.createButton({
                label: 'Unblur',
                className: 'fs-unblur-button fs-unblur-toolbar',
                title: 'Fix blank or blurred pages (clears Studocu session and reloads)',
            }));
        }
        row.appendChild(createSettingsButton());
        return row;
    }

    // The row hosts three features, so it must be present even when one of
    // them is off; visibility of the individual buttons is driven by CSS via
    // the data-fs-* attributes on <html> (see applySettingsToDocument).
    download.refreshButton = function () {
        const c = document.querySelector('#viewer-wrapper');
        if (c && !c.querySelector('.fs-button-row')) c.prepend(createButtonRow());
        const d = document.querySelector('#modal-overlay');
        if (d) d.style.display = 'none';
    };

    download.init = function () {
        // Note: no early return on showDownloadButton. The row is the shared
        // home of the Unblur and Settings buttons, and CSS hides only the
        // Download button when it is disabled.

        // Capture-phase delegation fires before React's own handlers.
        document.addEventListener('click', function (e) {
            const btn = e.target.closest && e.target.closest('[data-freestudocu="download"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                download.generatePDF();
            }
        }, true);
        document.addEventListener('mousedown', function (e) {
            if (e.target.closest && e.target.closest('[data-freestudocu="download"]')) e.stopPropagation();
        }, true);

        const obs = new MutationObserver(download.refreshButton);
        function attach() {
            const wrapper = document.querySelector('#viewer-wrapper');
            if (wrapper) obs.observe(wrapper, { childList: true, subtree: true });
            download.refreshButton();
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
        else attach();
        window.addEventListener('load', attach);
    };
})();