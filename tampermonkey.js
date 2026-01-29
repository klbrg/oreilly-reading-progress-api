// ==UserScript==
// @name         O'Reilly Reader (Single Block Navigation + Full Storage Sync)
// @namespace    http://tampermonkey.net/
// @version      4.1.0
// @description  Show one section at a time on O'Reilly chapters, save progress locally, and POST the entire localStorage to localhost
// @match        https://learning.oreilly.com/library/view/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = 'http://localhost:44433/update';

    // Create a unique key for saving progress, based on the URL path
    const storageKey = 'oreilly-reader-progress-' + location.pathname.split('/').filter(Boolean).join('-');
    console.log(`[Reader] Storage Key: ${storageKey}`);

    // Try to load saved progress from localStorage
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (e) {
        console.warn('[Reader] Failed to parse saved progress', e);
        saved = {};
    }

    // Restore last read section index, or start at 0
    let index = typeof saved.index === 'number' ? saved.index : 0;
    console.log(`[Reader] Restored index: ${index}`);

    let groupedBlocks = [];

    // 🔥 Send the localStorage as JSON to the backend
    async function postFullLocalStorage() {
        try {
            const storageDump = {};
            const prefix = "oreilly-reader-progress";

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    try {
                        storageDump[key] = JSON.parse(localStorage.getItem(key));
                    } catch {
                        storageDump[key] = localStorage.getItem(key);
                    }
                }
            }

            const payload = { title: document.title, storage: storageDump };

            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            console.log('[Reader] ✅ Posted filtered localStorage (oreilly-reader-progress*) to FastAPI');
        } catch (err) {
            alert("[Reader] ❌ Failed to post filtered localStorage");
            console.warn('[Reader] ❌ Failed to post filtered localStorage:', err);
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
        const progressDisplay = document.createElement('div');
        progressDisplay.style.position = 'sticky';
        progressDisplay.style.top = '0';
        progressDisplay.style.padding = '0.5em 1em';
        progressDisplay.style.fontSize = '0.9em';
        progressDisplay.style.borderBottom = '1px solid #ccc';
        progressDisplay.style.marginBottom = '1em';
        progressDisplay.style.zIndex = '100';
        progressDisplay.id = 'reader-progress';
        container.parentElement.insertBefore(progressDisplay, container);
    }

    function updateProgressDisplay() {
        const el = document.getElementById('reader-progress');
        if (!el) return;
        const seenBlocks = groupedBlocks.slice(0, index + 1);
        const getWordCount = el => el.textContent.trim().split(/\s+/).length;
        const wordsRead = seenBlocks.reduce((sum, block) => sum + getWordCount(block), 0);
        const totalWords = groupedBlocks.reduce((sum, block) => sum + getWordCount(block), 0);
        const percent = totalWords > 0 ? Math.floor((wordsRead / totalWords) * 100) : 0;
        el.textContent = `Section ${index + 1} of ${groupedBlocks.length} · ${percent}% read`;
    }

    function render(container) {
        index = Math.max(0, Math.min(index, groupedBlocks.length - 1));
        container.innerHTML = '';
        container.appendChild(groupedBlocks[index]);
        updateProgressDisplay();
        console.log(`[Reader] Showing index ${index}`);
    }

    function update(container) {
        container.innerHTML = '';
        container.appendChild(groupedBlocks[index]);
        updateProgressDisplay();

        // Save to localStorage
        const progressData = { index };
        const url = location.href;
        progressData.date = new Date().toISOString();
        progressData.url = url;
        localStorage.setItem(storageKey, JSON.stringify(progressData));
        console.log(`[Reader] Updated index to ${index} (saved)`);

        // 🔥 Post *entire* localStorage to backend
        postFullLocalStorage();
    }

    function setupNavigation(container) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'f') {
                e.preventDefault();
                if (index < groupedBlocks.length - 1) {
                    index++;
                    update(container);
                }
            } else if (e.key === 'd') {
                e.preventDefault();
                if (index > 0) {
                    index--;
                    update(container);
                }
            }
        });
    }

    waitForContent();
})();
