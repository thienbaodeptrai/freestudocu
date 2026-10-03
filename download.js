// FreeStudocu - document download.
//
// Clicking Download runs in two phases:
//   0. Unblur first (unless disabled or the session is already fresh): the
//      background clears the Studocu session and reloads the tab with a
//      `_fs_dl=1` marker. main.js sees the marker and calls
//      download.resumeAfterReset(), which reopens the overlay automatically.
//      Building from freshly signed URLs is what makes the pages come out
//      sharp instead of blank or blurred.
//
// Then the copy is built incrementally, because the viewer lazy-loads page
// text and unmounts pages that scroll out of view:
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
        const t = h1 ? h1.textContent.trim() : '';
        return t || (document.title || 'document').trim();
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
    function waitForPageReady(pf, ui) {
        return new Promise(function (resolve) {
            let lastLen = -1, stable = 0, tries = 0;
            (function check() {
                if (ui && ui.closed) { resolve(); return; }
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
    // page order and restores the scroll position. Stops early when the
    // overlay is closed (previously it kept scrolling the page for minutes).
    function captureAllPages(ui, onProgress) {
        const pfs = FS.viewerPages();
        const saved = FS.saveScroll();
        const captured = [];
        return new Promise(function (resolve) {
            let i = 0;
            (function next() {
                if (i >= pfs.length || ui.closed) {
                    FS.restoreScroll(saved);
                    resolve(captured);
                    return;
                }
                const pf = pfs[i];
                try { pf.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) { /* detached */ }
                waitForPageReady(pf, ui).then(function () {
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
    // Resolves with the number of images that could NOT be embedded.
    function embedImages(root, ui, onProgress) {
        const targets = Array.prototype.filter.call(root.querySelectorAll('img'), function (img) {
            const s = img.getAttribute('src') || '';
            return s.indexOf('doc-assets') !== -1 || s.indexOf('/bg') !== -1;
        });
        const urls = Array.from(new Set(targets.map(function (img) { return img.getAttribute('src'); })));
        const map = {};
        let next = 0, done = 0, failed = 0;
        const CONCURRENCY = 6;

        return new Promise(function (resolve) {
            if (urls.length === 0) { resolve(0); return; }
            function worker() {
                if (next >= urls.length || ui.closed) return Promise.resolve();
                const url = urls[next++];
                return fetchDataUri(url).then(function (dataUri) {
                    if (dataUri) map[url] = dataUri; else failed++;
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
                resolve(failed);
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
            pf.querySelectorAll('.download-button-1, .fs-button-row, [data-freestudocu]').forEach(function (e) { e.remove(); });
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
                img.removeAttribute('loading');
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
            const w = Math.ceil(r.width - 0.01), h = Math.ceil(r.height - 0.01);
            if (!(w > 0 && h > 0)) return;
            const key = w + 'x' + h;
            if (!names[key]) {
                names[key] = 'fs-page-' + (rules.length + 1);
                rules.push('@page ' + names[key] + '{size:' + w + 'px ' + h + 'px;margin:0;}');
            }
            pf.style.setProperty('page', names[key]);
            // Pin the box to the sheet so sub-pixel rounding cannot spill onto a second sheet.
            pf.style.setProperty('width', w + 'px', 'important');
            pf.style.setProperty('height', h + 'px', 'important');
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

    function iconButton(className, icon, label, title) {
        const b = el('button', 'fs-dl-btn ' + className);
        b.type = 'button';
        b.appendChild(FS.icon(icon, 16));
        if (label) b.appendChild(el('span', 'fs-dl-btn-label', label));
        if (title) b.title = title;
        return b;
    }

    const STEPS = ['Unblur', 'Load pages', 'Embed images', 'Ready'];

    function createOverlay(title) {
        const overlay = el('div');
        overlay.id = 'fs-dl-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'FreeStudocu download');

        // ---- Top bar ----
        const bar = el('div', 'fs-dl-bar');
        const left = el('div', 'fs-dl-left');
        const logo = el('div', 'fs-dl-logo');
        logo.appendChild(FS.icon('download', 18));
        const titles = el('div', 'fs-dl-titles');
        const titleEl = el('div', 'fs-dl-title', title);
        titleEl.title = title;
        const meta = el('div', 'fs-dl-meta', 'Preparing…');
        titles.appendChild(titleEl);
        titles.appendChild(meta);
        left.appendChild(logo);
        left.appendChild(titles);

        const actions = el('div', 'fs-dl-actions');
        const hint = el('span', 'fs-dl-hint', 'Choose "Save as PDF" as the destination');
        const rebuildBtn = iconButton('fs-dl-rebuild', 'refresh', 'Unblur & rebuild',
            'Pages still blurry or blank? Clear the Studocu session, reload and build the PDF again');
        rebuildBtn.disabled = true;
        const printBtn = iconButton('fs-dl-print', 'printer', 'Save as PDF', 'Open the print dialog (Ctrl+P)');
        printBtn.disabled = true;
        const closeBtn = iconButton('fs-dl-close', 'close', '', 'Close (Esc)');
        closeBtn.setAttribute('aria-label', 'Close');
        actions.appendChild(hint);
        actions.appendChild(rebuildBtn);
        actions.appendChild(printBtn);
        actions.appendChild(closeBtn);
        bar.appendChild(left);
        bar.appendChild(actions);

        // ---- Loading card ----
        const loading = el('div', 'fs-dl-loading');
        const card = el('div', 'fs-dl-card');
        const stepper = el('ol', 'fs-dl-steps');
        const stepEls = STEPS.map(function (name, i) {
            const li = el('li', 'fs-dl-step');
            const dot = el('span', 'fs-dl-step-dot');
            dot.appendChild(el('span', 'fs-dl-step-num', String(i + 1)));
            dot.appendChild(FS.icon('check', 12));
            li.appendChild(dot);
            li.appendChild(el('span', 'fs-dl-step-name', name));
            stepper.appendChild(li);
            return li;
        });
        const spinner = el('div', 'fs-dl-spinner');
        const msg = el('div', 'fs-dl-msg', 'Preparing download');
        const barWrap = el('div', 'fs-dl-progress');
        const fill = el('div', 'fs-dl-fill');
        barWrap.appendChild(fill);
        const subRow = el('div', 'fs-dl-subrow');
        const sub = el('div', 'fs-dl-sub', '');
        const pct = el('div', 'fs-dl-pct', '0%');
        subRow.appendChild(sub);
        subRow.appendChild(pct);
        card.appendChild(stepper);
        card.appendChild(spinner);
        card.appendChild(msg);
        card.appendChild(barWrap);
        card.appendChild(subRow);
        loading.appendChild(card);

        const pagesEl = el('div', 'fs-dl-pages');

        overlay.appendChild(bar);
        overlay.appendChild(loading);
        overlay.appendChild(pagesEl);

        // Block the page (React, the viewer) from reacting to overlay input.
        ['click', 'mousedown', 'pointerdown', 'wheel', 'touchstart'].forEach(function (type) {
            overlay.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: type === 'wheel' || type === 'touchstart' });
        });

        const ui = {
            overlay: overlay, pages: pagesEl, printBtn: printBtn, rebuildBtn: rebuildBtn, closed: false,
        };

        ui.setStep = function (index, state) {
            stepEls.forEach(function (li, i) {
                li.classList.remove('fs-active', 'fs-done', 'fs-skipped');
                if (i < index) li.classList.add('fs-done');
                else if (i === index) li.classList.add(state === 'done' ? 'fs-done' : 'fs-active');
            });
        };
        ui.skipStep = function (index) {
            stepEls[index].classList.remove('fs-active', 'fs-done');
            stepEls[index].classList.add('fs-skipped');
        };
        ui.setMessage = function (text) { msg.textContent = text; };
        ui.setSub = function (text) { sub.textContent = text || ''; };
        ui.setMeta = function (text) { meta.textContent = text; };
        ui.setProgress = function (fraction) {
            const p = Math.max(0, Math.min(100, Math.round(fraction * 100)));
            fill.style.width = p + '%';
            pct.textContent = p + '%';
        };
        ui.setIndeterminate = function (on) {
            barWrap.classList.toggle('fs-indeterminate', !!on);
            pct.style.visibility = on ? 'hidden' : 'visible';
        };
        ui.fail = function (text) {
            card.classList.add('fs-error');
            spinner.replaceChildren(FS.icon('alert', 28));
            ui.setMessage('Something went wrong');
            ui.setSub(text);
            ui.setIndeterminate(false);
            rebuildBtn.disabled = false;
        };
        ui.finish = function () {
            loading.remove();
            ui.setStep(3, 'done');
            printBtn.disabled = false;
            rebuildBtn.disabled = false;
            printBtn.focus();
        };

        function close() {
            if (ui.closed) return;
            ui.closed = true;
            overlay.classList.remove('fs-dl-visible');
            setTimeout(function () { overlay.remove(); }, 180);
            const sizes = document.getElementById('fs-dl-page-size');
            if (sizes) sizes.remove();
            document.body.classList.remove('fs-dl-open');
            document.documentElement.classList.remove('fs-dl-open');
            document.removeEventListener('keydown', onKey, true);
        }
        function onKey(e) {
            // Leave Escape to a confirm dialog shown on top of the overlay.
            if (document.getElementById('fs-modal')) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P') && !printBtn.disabled) {
                e.preventDefault(); e.stopPropagation(); printWithTitle(title);
            }
        }
        closeBtn.addEventListener('click', close);
        printBtn.addEventListener('click', function () { printWithTitle(title); });
        rebuildBtn.addEventListener('click', function () { unblurThenDownload(ui, true); });
        document.addEventListener('keydown', onKey, true);
        ui.close = close;
        return ui;
    }

    // Chrome names the PDF after document.title, so use the document's name
    // for the duration of the print dialog.
    function printWithTitle(title) {
        const original = document.title;
        const safe = String(title || 'document').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
        document.title = safe || original;
        const restore = function () {
            document.title = original;
            window.removeEventListener('afterprint', restore);
        };
        window.addEventListener('afterprint', restore);
        window.print();
        // Fallback for browsers that do not fire afterprint reliably.
        setTimeout(restore, 1000);
    }

    function openOverlay() {
        const existing = document.getElementById('fs-dl-overlay');
        if (existing) existing.remove();
        const ui = createOverlay(getTitle());
        document.body.appendChild(ui.overlay);
        requestAnimationFrame(function () { ui.overlay.classList.add('fs-dl-visible'); });
        // The print rules in style.css only isolate the overlay while this
        // class is present.
        document.body.classList.add('fs-dl-open');
        document.documentElement.classList.add('fs-dl-open');
        return ui;
    }

    function pagesPresent() {
        return !!document.querySelector('.p2hv') && FS.viewerPages().length > 0;
    }

    // Phases 1-3: capture, embed, show. `ui` is an already open overlay.
    function build(ui) {
        const pfs = FS.viewerPages();
        if (!pagesPresent()) {
            ui.fail('Could not find the document pages. Close this, scroll the document a little, then click Download again.');
            return Promise.resolve();
        }
        const total = pfs.length;
        ui.setMeta(total + (total === 1 ? ' page' : ' pages'));
        ui.setStep(1);
        ui.setIndeterminate(false);
        ui.setMessage('Loading all pages');
        ui.setProgress(0);
        const assets = resolvePageAssets();

        return captureAllPages(ui, function (done, count) {
            ui.setProgress(done / count * 0.7);
            ui.setSub('Page ' + done + ' of ' + count);
        }).then(function (capturedPages) {
            if (ui.closed) return null;
            if (!capturedPages.length) throw new Error('no pages');
            ui.setStep(2);
            ui.setMessage('Embedding images');
            ui.setSub('');
            const container = download.assembleContainer(capturedPages, assets);
            return embedImages(container, ui, function (done, count) {
                ui.setProgress(0.7 + (count ? done / count : 1) * 0.3);
                ui.setSub('Image ' + done + ' of ' + count);
            }).then(function (failed) {
                return { container: container, failed: failed };
            });
        }).then(function (res) {
            if (!res || ui.closed) return;
            ui.setProgress(1);
            ui.pages.appendChild(res.container);
            download.applyPageSizes(res.container);
            ui.finish();
            if (res.failed > 0) {
                FS.notify(res.failed + ' image(s) could not be loaded. If pages look blank, use "Unblur & rebuild".', 8000, 'err');
            } else {
                FS.notify('Document ready - click "Save as PDF".', 4000, 'ok');
            }
        }).catch(function () {
            if (!ui.closed) ui.fail('Could not build the document. Try "Unblur & rebuild", or refresh the page.');
        });
    }

    // Phase 0: reset the session and reload with the `_fs_dl` marker. The
    // overlay (if any) shows the Unblur step until the tab reloads.
    function unblurThenDownload(existingUi, isRebuild) {
        const askOpts = {
            title: isRebuild ? 'Unblur & rebuild?' : 'Unblur, then download?',
            lead: 'FreeStudocu will first clear the Studocu session (cookies and page storage) and reload ' +
                'the tab so every page gets a freshly signed URL. The PDF is then built automatically.',
            confirmLabel: isRebuild ? 'Unblur & rebuild' : 'Unblur & download',
        };
        return FS.reset.confirm(askOpts).then(function (ok) {
            if (!ok) return;
            const ui = existingUi && !existingUi.closed ? existingUi : openOverlay();
            if (existingUi === ui) {
                // Rebuild: drop the previous result and show progress again.
                ui.close(); // also stops any build still running (sets ui.closed)
                return unblurInOverlay(openOverlay());
            }
            return unblurInOverlay(ui);
        });
    }

    function unblurInOverlay(ui) {
        ui.setStep(0);
        ui.setMessage('Unblurring document');
        ui.setSub('Clearing the Studocu session…');
        ui.setIndeterminate(true);
        return FS.reset.resetAll({ thenDownload: true }).then(function (res) {
            if (ui.closed) return;
            if (res && res.ok) {
                ui.setSub('Reloading the page - the download continues automatically.');
                return;
            }
            // Reset failed: still give the user their PDF with the current
            // session rather than nothing.
            FS.notify('Unblur failed (' + ((res && res.error) || 'unknown error') + '). Building with the current session.', 7000, 'err');
            ui.skipStep(0);
            return build(ui);
        });
    }

    // Entry point for the Download button.
    download.start = function () {
        if (document.getElementById('fs-dl-overlay')) return;
        const canUnblur = FS.reset && FS.reset.resetAll && FS.settings.unblurBeforeDownload;
        if (!canUnblur || FS.isFreshSession()) {
            download.generatePDF();
            return;
        }
        if (!pagesPresent()) {
            FS.notify('Could not find the document pages. Scroll the document a little, then click Download again.', 6000, 'err');
            return;
        }
        unblurThenDownload(null, false);
    };

    // Build straight away with the current session (no reset).
    download.generatePDF = function () {
        if (document.getElementById('fs-dl-overlay')) return;
        if (!pagesPresent()) {
            FS.notify('Could not find the document pages. Scroll the document a little, then click Download again.', 6000, 'err');
            return;
        }
        const ui = openOverlay();
        if (FS.isFreshSession()) ui.setStep(1); else ui.skipStep(0);
        const waitPrime = FS.pages && FS.pages.isPriming
            ? FS.waitFor(function () { return !FS.pages.isPriming(); }, 2000, 100)
            : Promise.resolve();
        waitPrime.then(function () { if (!ui.closed) build(ui); });
    };

    // Called by main.js when the page loaded with the `_fs_dl` marker, i.e.
    // straight after the Unblur reset triggered by Download.
    download.resumeAfterReset = function () {
        const ui = openOverlay();
        ui.setStep(1);
        ui.setMessage('Waiting for the document');
        ui.setSub('Studocu is signing fresh page URLs…');
        ui.setIndeterminate(true);
        FS.waitFor(pagesPresent, 25000, 300).then(function (found) {
            if (ui.closed) return;
            if (!found) {
                ui.fail('The document did not load in time. Close this and click Download again.');
                return;
            }
            // Let the viewer mount its first pages and fetch the access data.
            return FS.sleep(1200).then(function () {
                if (!ui.closed) return build(ui);
            });
        });
    };

    // ------------------------------------------------------------------
    // Toolbar button row (Download + Unblur + Settings)
    // ------------------------------------------------------------------

    function createDownloadButton() {
        const btn = el('button', 'download-button-1');
        btn.type = 'button';
        btn.setAttribute('data-freestudocu', 'download');
        btn.title = 'Unblur, then download the full document as PDF (FreeStudocu)';
        const icon = FS.icon('download', 16);
        icon.classList.add('download-icon');
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
        btn.appendChild(FS.icon('sliders', 16));
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            try {
                chrome.runtime.sendMessage({ type: 'FS_OPEN_POPUP' }, function (res) {
                    if (chrome.runtime.lastError || !res || !res.ok) {
                        FS.notify('Click the FreeStudocu icon in your browser toolbar to open settings.');
                    }
                });
            } catch (err) {
                FS.notify('Click the FreeStudocu icon in your browser toolbar to open settings.');
            }
        });
        return btn;
    }

    function createButtonRow() {
        const row = el('div', 'fs-button-row');
        row.setAttribute('data-freestudocu-row', '1');
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
        if (d) FS.setStyles(d, { display: 'none' });
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
                download.start();
            }
        }, true);
        document.addEventListener('mousedown', function (e) {
            if (e.target.closest && e.target.closest('[data-freestudocu="download"]')) e.stopPropagation();
        }, true);

        // Only childList changes can remove the row; refreshButton is cheap
        // but is rate-limited to one call per frame anyway.
        let scheduled = false;
        const obs = new MutationObserver(function () {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(function () { scheduled = false; download.refreshButton(); });
        });
        let observed = null;
        function attach() {
            const wrapper = document.querySelector('#viewer-wrapper');
            if (wrapper && wrapper !== observed) {
                obs.disconnect();
                obs.observe(wrapper, { childList: true, subtree: true });
                observed = wrapper;
            }
            download.refreshButton();
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
        else attach();
        window.addEventListener('load', attach);
    };
})();