// Progressive-reveal reader for /library/view/* pages.
// Ported from tampermonkey.js; uses window.OReillyAPI for persistence.

(function () {
    'use strict';

    const {
        getData, saveProgress,
        pickNextBook, nextCandidates, latestByBook,
        bookIdFromUrl,
        addToCurrentlyReading, removeFromCurrentlyReading, isCurrentlyReading,
    } = window.OReillyAPI;

    function storageKey() {
        return 'oreilly-reader-progress-' + location.pathname.split('/').filter(Boolean).join('-');
    }

    function currentBookId() { return bookIdFromUrl(location.href); }

    let index = 0;
    let groupedBlocks = [];
    let navHandler = null;

    async function loadProgress() {
        const key = storageKey();
        try {
            const data = await getData();
            if (data?.storage?.[key]) {
                return data.storage[key].index ?? 0;
            }
        } catch (err) {
            console.warn('[Reader] Failed to load progress from API', err);
        }
        return 0;
    }

    async function persist() {
        const entry = {
            index,
            date: new Date().toISOString(),
            url: location.href,
            title: document.title,
        };
        try {
            await saveProgress(storageKey(), entry);
            console.log(`[Reader] Saved index ${index}`);
        } catch (err) {
            alert('[Reader] Failed to save progress');
            console.warn('[Reader] Failed to save progress:', err);
        }
    }

    function waitForContent(attempts = 0) {
        const container = document.querySelector('#sbo-rt-content');
        if (!container) {
            if (attempts < 20) return setTimeout(() => waitForContent(attempts + 1), 500);
            else return console.log('[Reader] Failed to find #sbo-rt-content');
        }

        const figures = Array.from(container.querySelectorAll('figure'));
        figures.forEach(fig => fig.setAttribute('data-reader-block', 'true'));
        container.querySelectorAll('p.codelink').forEach(el => el.remove());

        let elements = Array.from(container.querySelectorAll(
            'figure, .orm-Figure, .orm-CodeBlock, .code-area-container, h1, h2, h3, h4, h5, h6, table, pre, ul, ol, dl, p, img, mjx-container, blockquote'
        ));

        elements = elements.filter(el => {
            const tag = el.tagName.toLowerCase();
            if (!el.classList.contains('code-area-container') && el.closest('.code-area-container')) return false;
            const nestedListAncestor = el.closest('ul ul, ol ul, ul ol, ol ol, li ul, li ol, dl dd');
            if (nestedListAncestor) return false;
            if (tag === 'li') {
                const parent = el.parentElement;
                return parent && parent.tagName.toLowerCase() === 'ul' && !parent.closest('ul ul, ol ul, li ul');
            }
            if (tag === 'ul' || tag === 'ol') return !el.closest('ul ul, ol ul, li ul, li ol');
            if (tag === 'img') if (el.closest('figure, .orm-Figure, .orm-CodeBlock, p, dl dt a, pre a, h1, h2')) return false;
            if (['img', 'table', 'p', 'h6'].includes(tag)) {
                if (el.closest('figure, .orm-Figure, .orm-CodeBlock, blockquote')) return false;
                if (el.closest('li') && el.closest('li').closest('ul ul, ol ul, li ul')) return false;
            }
            if (tag === 'pre' && el.closest('li')) return false;
            return true;
        });

        if (elements.length === 0) {
            if (attempts < 20) return setTimeout(() => waitForContent(attempts + 1), 500);
            else return console.log('[Reader] No readable elements found');
        }

        groupedBlocks = [];
        let buffer = [];

        function isInsideContext(el) {
            return el.closest('figure, table, pre, ul, ol, dl, .orm-Figure, .orm-CodeBlock, .code-area-container');
        }

        for (let el of elements) {
            const tag = el.tagName.toLowerCase();
            const isPara = tag === 'p';
            const isContext = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'table', 'pre', 'img', 'ul', 'ol', 'dl', 'mjx-container', 'blockquote'].includes(tag)
                || el.classList.contains('orm-Figure')
                || el.classList.contains('orm-CodeBlock')
                || el.classList.contains('code-area-container');

            if (isPara && isInsideContext(el)) continue;

            if (el.hasAttribute('data-reader-block')) {
                if (buffer.length > 0) {
                    const wrapper = document.createElement('div');
                    buffer.forEach(b => wrapper.appendChild(b));
                    groupedBlocks.push(wrapper);
                    buffer = [];
                }
                const wrapper = document.createElement('div');
                wrapper.appendChild(el.cloneNode(true));
                groupedBlocks.push(wrapper);
                continue;
            }

            if (isContext || isPara) buffer.push(el.cloneNode(true));
            if (isPara && buffer.length > 0) {
                const wrapper = document.createElement('div');
                buffer.forEach(b => wrapper.appendChild(b));
                groupedBlocks.push(wrapper);
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            const wrapper = document.createElement('div');
            buffer.forEach(b => wrapper.appendChild(b));
            groupedBlocks.push(wrapper);
        }

        if (groupedBlocks.length === 0) {
            console.log('[Reader] No paragraph groups created');
            return;
        }

        createProgressDisplay(container);
        render(container);
        setupNavigation(container);
    }

    function createProgressDisplay() {
        const wrapper = document.createElement('div');
        wrapper.id = 'reader-progress';
        wrapper.style.position = 'fixed';
        wrapper.style.top = '0';
        wrapper.style.left = 'var(--reader-sidebar-offset, 0px)';
        wrapper.style.transition = 'left 0.22s ease';
        wrapper.style.right = '0';
        wrapper.style.zIndex = '999999';
        wrapper.style.background = '#ffffff';
        wrapper.style.borderBottom = '3px solid #111111';

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.padding = '0.3em 1em';
        row.style.gap = '0.75em';

        const label = document.createElement('div');
        label.id = 'reader-progress-label';
        label.style.flex = '1';
        label.style.minWidth = '0';
        label.style.fontFamily = 'ui-monospace, "SF Mono", Menlo, monospace';
        label.style.color = '#111111';
        label.style.lineHeight = '1.25';
        label.style.overflow = 'hidden';

        const reloadBtn = document.createElement('button');
        reloadBtn.id = 'reader-reload-btn';
        reloadBtn.textContent = 'Reload';
        reloadBtn.title = 'Reload page';
        reloadBtn.style.cssText = 'padding:0.25em 0.8em;font-size:0.75em;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;font-family:ui-monospace,"SF Mono",Menlo,monospace;border:2px solid #111111;border-radius:3px;background:#ffffff;cursor:pointer;color:#111111;box-shadow:2px 2px 0 0 #111111;transition:transform 0.06s ease,box-shadow 0.06s ease,background 0.12s ease;';
        reloadBtn.addEventListener('mouseenter', () => reloadBtn.style.background = '#f5f5f5');
        reloadBtn.addEventListener('mouseleave', () => reloadBtn.style.background = '#ffffff');
        reloadBtn.addEventListener('mousedown', () => { reloadBtn.style.transform = 'translate(2px,2px)'; reloadBtn.style.boxShadow = '0 0 0 0 #111111'; });
        const releaseReloadPress = () => { reloadBtn.style.transform = ''; reloadBtn.style.boxShadow = '2px 2px 0 0 #111111'; };
        reloadBtn.addEventListener('mouseup', releaseReloadPress);
        reloadBtn.addEventListener('mouseleave', releaseReloadPress);
        reloadBtn.addEventListener('click', () => location.reload());

        const resetBtn = document.createElement('button');
        resetBtn.id = 'reader-reset-btn';
        resetBtn.textContent = 'Reset';
        resetBtn.title = 'Reset chapter progress (click twice)';
        resetBtn.style.cssText = 'padding:0.25em 0.8em;font-size:0.75em;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;font-family:ui-monospace,"SF Mono",Menlo,monospace;border:2px solid #111111;border-radius:3px;background:#ffffff;cursor:pointer;color:#111111;box-shadow:2px 2px 0 0 #111111;transition:transform 0.06s ease,box-shadow 0.06s ease,background 0.12s ease,color 0.12s ease;';
        let resetArmed = false;
        let resetRevert = null;
        resetBtn.addEventListener('mouseenter', () => { if (!resetArmed) resetBtn.style.background = '#f5f5f5'; });
        resetBtn.addEventListener('mouseleave', () => { if (!resetArmed) resetBtn.style.background = '#ffffff'; });
        resetBtn.addEventListener('mousedown', () => { resetBtn.style.transform = 'translate(2px,2px)'; resetBtn.style.boxShadow = '0 0 0 0 #111111'; });
        const releaseResetPress = () => { resetBtn.style.transform = ''; resetBtn.style.boxShadow = '2px 2px 0 0 #111111'; };
        resetBtn.addEventListener('mouseup', releaseResetPress);
        resetBtn.addEventListener('click', async () => {
            if (!resetArmed) {
                resetArmed = true;
                resetBtn.textContent = '?';
                resetBtn.style.background = '#d80000';
                resetBtn.style.color = '#ffffff';
                resetRevert = setTimeout(() => {
                    resetArmed = false;
                    resetBtn.textContent = 'Reset';
                    resetBtn.style.background = '#ffffff';
                    resetBtn.style.color = '#111111';
                }, 2500);
                return;
            }
            clearTimeout(resetRevert);
            resetArmed = false;
            resetBtn.textContent = 'Reset';
            resetBtn.style.background = '#ffffff';
            resetBtn.style.color = '#111111';
            if (window.__oreillyReaderReset) await window.__oreillyReaderReset();
        });

        const readingBtn = document.createElement('button');
        readingBtn.id = 'reader-reading-btn';
        const baseBtnCss = 'padding:0.25em 0.8em;font-size:0.75em;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;font-family:ui-monospace, "SF Mono", Menlo, monospace;border:2px solid #111111;border-radius:3px;cursor:pointer;box-shadow:2px 2px 0 0 #111111;transition:transform 0.06s ease, box-shadow 0.06s ease, background 0.12s ease, color 0.12s ease;';
        function applyReadingState() {
            const here = isCurrentlyReading(currentBookId());
            readingBtn.textContent = here ? '✓ Reading' : '+ Reading';
            readingBtn.title = here ? 'Remove from Currently Reading' : 'Add to Currently Reading';
            const bg = here ? '#d80000' : '#ffffff';
            const fg = here ? '#ffffff' : '#111111';
            readingBtn.style.cssText = baseBtnCss + `background:${bg};color:${fg};`;
        }
        applyReadingState();
        readingBtn.addEventListener('mousedown', () => { readingBtn.style.transform = 'translate(2px, 2px)'; readingBtn.style.boxShadow = '0 0 0 0 #111111'; });
        const releaseReadingPress = () => { readingBtn.style.transform = ''; readingBtn.style.boxShadow = '2px 2px 0 0 #111111'; };
        readingBtn.addEventListener('mouseup', releaseReadingPress);
        readingBtn.addEventListener('mouseleave', releaseReadingPress);
        readingBtn.addEventListener('click', () => {
            const id = currentBookId();
            if (!id) return;
            if (isCurrentlyReading(id)) removeFromCurrentlyReading(id);
            else addToCurrentlyReading(id);
            applyReadingState();
            window.dispatchEvent(new CustomEvent('oreilly-reading-changed'));
        });
        window.addEventListener('oreilly-reading-changed', applyReadingState);

        const nextBtn = document.createElement('button');
        nextBtn.id = 'reader-next-book-btn';
        nextBtn.textContent = 'Next book →';
        nextBtn.title = 'Jump to the next book in your Currently Reading list';
        nextBtn.style.cssText = 'padding:0.25em 0.8em;font-size:0.75em;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;font-family:ui-monospace, "SF Mono", Menlo, monospace;border:2px solid #111111;border-radius:3px;background:#ffffff;cursor:pointer;color:#111111;box-shadow:2px 2px 0 0 #111111;transition:transform 0.06s ease, box-shadow 0.06s ease, background 0.12s ease;';
        nextBtn.addEventListener('mouseenter', () => nextBtn.style.background = '#f5f5f5');
        nextBtn.addEventListener('mouseleave', () => nextBtn.style.background = '#ffffff');
        nextBtn.addEventListener('mousedown', () => { nextBtn.style.transform = 'translate(2px, 2px)'; nextBtn.style.boxShadow = '0 0 0 0 #111111'; });
        const releaseNextPress = () => { nextBtn.style.transform = ''; nextBtn.style.boxShadow = '2px 2px 0 0 #111111'; };
        nextBtn.addEventListener('mouseup', releaseNextPress);
        nextBtn.addEventListener('mouseleave', releaseNextPress);
        nextBtn.addEventListener('click', async () => {
            nextBtn.disabled = true;
            nextBtn.textContent = '…';
            const next = await pickNextBook();
            if (!next) {
                nextBtn.textContent = 'No other books';
                setTimeout(() => { nextBtn.textContent = 'Next book →'; nextBtn.disabled = false; }, 1500);
                return;
            }
            location.href = next.url;
        });

        row.appendChild(label);
        row.appendChild(reloadBtn);
        row.appendChild(resetBtn);
        row.appendChild(readingBtn);
        row.appendChild(nextBtn);

        const track = document.createElement('div');
        track.style.height = '10px';
        track.style.background = '#ffffff';
        track.style.borderTop = '2px solid #111111';

        const fill = document.createElement('div');
        fill.id = 'reader-progress-fill';
        fill.style.height = '100%';
        fill.style.background = '#d80000';
        fill.style.width = '0%';
        fill.style.transition = 'width 0.3s ease';

        track.appendChild(fill);
        wrapper.appendChild(row);
        wrapper.appendChild(track);
        document.body.appendChild(wrapper);
        document.body.style.paddingTop = '4.4em';
    }

    function escapeText(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    let cachedBookTitle = '';

    async function loadBookTitle() {
        const id = currentBookId();
        if (!id) return;
        try {
            const data = await getData();
            const playlists = (data && data.playlists) || {};
            for (const p of Object.values(playlists)) {
                for (const b of (p.books || [])) {
                    if (b.id === id && b.title) {
                        cachedBookTitle = b.title;
                        const label = document.getElementById('reader-progress-label');
                        if (label) updateProgressDisplay();
                        return;
                    }
                }
            }
        } catch {}
    }

    function getBookTitle() {
        if (cachedBookTitle) return cachedBookTitle;
        const meta = document.querySelector(
            'meta[name="dcterms.title"], meta[property="og:title"], meta[name="book"], meta[name="citation_book_title"]'
        );
        if (meta) {
            const v = meta.getAttribute('content');
            if (v) return v.trim();
        }
        const headerBookEl = document.querySelector('[data-book-title], .o-book-title, [class*="bookTitle"], [class*="book-title"]');
        if (headerBookEl && headerBookEl.textContent.trim()) return headerBookEl.textContent.trim();
        const t = (document.title || '').trim();
        return t.split(/ \| | - O'Reilly| — O'Reilly/)[0] || t;
    }

    function getChapterTitle() {
        for (let i = 0; i < groupedBlocks.length; i++) {
            const h = groupedBlocks[i] && groupedBlocks[i].querySelector('h1, h2, h3, h4');
            if (h && h.textContent.trim()) return h.textContent.trim();
        }
        const container = document.querySelector('#sbo-rt-content');
        if (container) {
            const h = container.querySelector('h1, h2, h3, h4');
            if (h && h.textContent.trim()) return h.textContent.trim();
        }
        const t = (document.title || '').trim();
        const cleaned = t.split(/ \| | - O'Reilly| — O'Reilly/)[0];
        if (cleaned && cachedBookTitle && cleaned !== cachedBookTitle) return cleaned;
        return '';
    }

    function updateProgressDisplay() {
        const label = document.getElementById('reader-progress-label');
        const fill = document.getElementById('reader-progress-fill');
        if (!label || !fill) return;
        const getWordCount = el => el.textContent.trim().split(/\s+/).length;
        const wordsRead = groupedBlocks.slice(0, index + 1).reduce((sum, block) => sum + getWordCount(block), 0);
        const totalWords = groupedBlocks.reduce((sum, block) => sum + getWordCount(block), 0);
        const percent = totalWords > 0 ? Math.floor((wordsRead / totalWords) * 100) : 0;
        const book = getBookTitle();
        const chapter = getChapterTitle();
        const meta = `Section ${index + 1} of ${groupedBlocks.length} · ${percent}% read`;
        label.innerHTML = `
            <div style="font-size:0.85em;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeText(book)}</div>
            ${chapter ? `<div style="font-size:0.78em;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeText(chapter)}</div>` : ''}
            <div style="font-size:0.7em;font-weight:500;letter-spacing:0.2px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${meta}</div>
        `;
        fill.style.width = `${percent}%`;
    }

    function createNextButton(container) {
        const btn = document.createElement('button');
        btn.id = 'reader-next-btn';
        btn.textContent = 'Read more';
        btn.style.cssText = `
            display: block;
            margin: 2em auto;
            padding: 0.45em 1.3em;
            font-size: 0.8em;
            font-weight: 700;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
            cursor: pointer;
            color: #ffffff;
            background: #d80000;
            border: 2px solid #111111;
            border-radius: 4px;
            box-shadow: 4px 4px 0 0 #111111;
            transition: transform 0.06s ease, box-shadow 0.06s ease, background 0.12s ease;
        `;
        btn.addEventListener('mouseenter', () => btn.style.background = '#ff1a1a');
        btn.addEventListener('mouseleave', () => btn.style.background = '#d80000');
        btn.addEventListener('mousedown', () => {
            btn.style.transform = 'translate(4px, 4px)';
            btn.style.boxShadow = '0 0 0 0 #111111';
        });
        const releasePress = () => {
            btn.style.transform = '';
            btn.style.boxShadow = '4px 4px 0 0 #111111';
        };
        btn.addEventListener('mouseup', releasePress);
        btn.addEventListener('mouseleave', releasePress);
        btn.addEventListener('click', () => advance(container));
        container.appendChild(btn);
    }

    function render(container) {
        index = Math.max(0, Math.min(index, groupedBlocks.length - 1));
        container.innerHTML = '';
        for (let i = 0; i <= index; i++) {
            container.appendChild(groupedBlocks[i]);
        }
        updateProgressDisplay();
        if (index < groupedBlocks.length - 1) {
            createNextButton(container);
        }
        console.log(`[Reader] Restored up to index ${index}`);
        if (index > 0) {
            setTimeout(() => groupedBlocks[index].scrollIntoView({ behavior: 'instant', block: 'start' }), 500);
        }
    }

    function advance(container) {
        if (index >= groupedBlocks.length - 1) return;
        index++;

        const existingBtn = document.getElementById('reader-next-btn');
        if (existingBtn) existingBtn.remove();

        const newBlock = groupedBlocks[index];
        container.appendChild(newBlock);
        setTimeout(() => newBlock.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

        if (index < groupedBlocks.length - 1) {
            createNextButton(container);
        }

        updateProgressDisplay();
        persist();
    }

    function retreat(container) {
        if (index <= 0) return;

        const existingBtn = document.getElementById('reader-next-btn');
        if (existingBtn) existingBtn.remove();

        container.removeChild(groupedBlocks[index]);
        index--;

        createNextButton(container);
        setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);

        updateProgressDisplay();
        persist();
    }

    function setupNavigation(container) {
        if (navHandler) window.removeEventListener('keydown', navHandler, true);
        navHandler = (e) => {
            const realTarget = (e.composedPath && e.composedPath()[0]) || e.target;
            if (realTarget && realTarget.matches && realTarget.matches('input, textarea, [contenteditable="true"]')) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'f' && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                advance(container);
            } else if (e.key === 'd' && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                retreat(container);
            }
        };
        window.addEventListener('keydown', navHandler, true);
    }

    async function warmPlaylist() {
        const list = await nextCandidates();
        if (list.length === 0) return;
        const prerenderUrls = list.slice(0, 2).map(c => c.url).filter(Boolean);
        const prefetchUrls = list.slice(2).map(c => c.url).filter(Boolean);

        document.querySelectorAll('script[data-reader-speculation]').forEach(n => n.remove());
        const rules = {};
        if (prerenderUrls.length) rules.prerender = [{ urls: prerenderUrls, eagerness: 'immediate' }];
        if (prefetchUrls.length) rules.prefetch = [{ urls: prefetchUrls, eagerness: 'immediate' }];
        if (!rules.prerender && !rules.prefetch) return;

        const script = document.createElement('script');
        script.type = 'speculationrules';
        script.setAttribute('data-reader-speculation', 'true');
        script.textContent = JSON.stringify(rules);
        document.head.appendChild(script);
        console.log(`[Reader] Prerender ${prerenderUrls.length}, prefetch ${prefetchUrls.length}`);
    }

    async function init() {
        index = await loadProgress();
        waitForContent();
        warmPlaylist();
        loadBookTitle();
    }

    async function resetChapterProgress() {
        index = 0;
        try { await persist(); } catch {}
        const container = document.querySelector('#sbo-rt-content');
        if (container && groupedBlocks.length > 0) render(container);
    }
    window.__oreillyReaderReset = resetChapterProgress;

    init();
})();
