// ==UserScript==
// @name         O'Reilly Reader (Progressive Reveal + API Sync)
// @namespace    http://tampermonkey.net/
// @version      6.0.0
// @description  Progressively reveal sections on O'Reilly chapters via a Next Section button, save progress to localhost API
// @match        https://learning.oreilly.com/library/view/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = 'http://localhost:44433';

    const storageKey = 'oreilly-reader-progress-' + location.pathname.split('/').filter(Boolean).join('-');
    console.log(`[Reader] Storage Key: ${storageKey}`);

    let index = 0;
    let groupedBlocks = [];

    async function loadProgress() {
        try {
            const res = await fetch(`${API_URL}/data`);
            const json = await res.json();
            if (json.status === 'ok' && json.data?.storage?.[storageKey]) {
                return json.data.storage[storageKey].index ?? 0;
            }
        } catch (err) {
            console.warn('[Reader] Failed to load progress from API', err);
        }
        return 0;
    }

    async function saveProgress() {
        const progressData = {
            index,
            date: new Date().toISOString(),
            url: location.href,
            title: document.title,
        };
        try {
            await fetch(`${API_URL}/update`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storage: { [storageKey]: progressData } }),
            });
            console.log(`[Reader] Saved index ${index}`);
        } catch (err) {
            alert("[Reader] ❌ Failed to save progress");
            console.warn('[Reader] ❌ Failed to save progress:', err);
        }
    }


    // --- Main Reader Logic ---
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

    function createProgressDisplay(container) {
        const wrapper = document.createElement('div');
        wrapper.id = 'reader-progress';
        wrapper.style.position = 'fixed';
        wrapper.style.top = '0';
        wrapper.style.left = '0';
        wrapper.style.right = '0';
        wrapper.style.zIndex = '999999';
        wrapper.style.background = '#fff';
        wrapper.style.borderBottom = '1px solid #ddd';

        const label = document.createElement('div');
        label.id = 'reader-progress-label';
        label.style.padding = '0.4em 1em 0.3em';
        label.style.fontSize = '1em';
        label.style.color = '#555';

        const track = document.createElement('div');
        track.style.height = '4px';
        track.style.background = '#e8e8e8';

        const fill = document.createElement('div');
        fill.id = 'reader-progress-fill';
        fill.style.height = '100%';
        fill.style.background = '#c0392b';
        fill.style.width = '0%';
        fill.style.transition = 'width 0.3s ease';

        track.appendChild(fill);
        wrapper.appendChild(label);
        wrapper.appendChild(track);
        document.body.appendChild(wrapper);
        document.body.style.paddingTop = '3em';
    }

    function updateProgressDisplay() {
        const label = document.getElementById('reader-progress-label');
        const fill = document.getElementById('reader-progress-fill');
        if (!label || !fill) return;
        const getWordCount = el => el.textContent.trim().split(/\s+/).length;
        const wordsRead = groupedBlocks.slice(0, index + 1).reduce((sum, block) => sum + getWordCount(block), 0);
        const totalWords = groupedBlocks.reduce((sum, block) => sum + getWordCount(block), 0);
        const percent = totalWords > 0 ? Math.floor((wordsRead / totalWords) * 100) : 0;
        label.textContent = `Section ${index + 1} of ${groupedBlocks.length} · ${percent}% read`;
        fill.style.width = `${percent}%`;
    }

    function createNextButton(container) {
        const btn = document.createElement('button');
        btn.id = 'reader-next-btn';
        btn.textContent = 'Read more';
        btn.style.display = 'block';
        btn.style.margin = '2em auto';
        btn.style.padding = '0.6em 1.6em';
        btn.style.fontSize = '1em';
        btn.style.cursor = 'pointer';
        btn.style.borderRadius = '6px';
        btn.style.border = '1px solid #888';
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
        saveProgress();
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
        saveProgress();
    }

    function setupNavigation(container) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'f') {
                e.preventDefault();
                advance(container);
            } else if (e.key === 'd') {
                e.preventDefault();
                retreat(container);
            }
        });
    }

    async function init() {
        index = await loadProgress();
        waitForContent();
    }

    init();
})();
