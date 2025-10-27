// ==UserScript==
// @name         O'Reilly Reader (Single Block Navigation + Progress Display)
// @namespace    http://tampermonkey.net/
// @version      3.7.1
// @description  Show one section at a time on O'Reilly chapters, with per-chapter progress saving and visible section counter.
// @match        https://learning.oreilly.com/library/view/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

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

    // Restore the last read section index, or start at 0
    let index = typeof saved.index === 'number' ? saved.index : 0;
    console.log(`[Reader] Restored index: ${index}`);

    // This will hold all the grouped content blocks (sections)
    let groupedBlocks = [];

    // Wait for the main content to load, retrying if necessary
    function waitForContent(attempts = 0) {
        // Main content container
        const container = document.querySelector('#sbo-rt-content');
        if (!container) {
            // Retry up to 20 times if not found
            if (attempts < 20) return setTimeout(() => waitForContent(attempts + 1), 500);
            else return console.log('[Reader] Failed to find #sbo-rt-content');
        }

        // Mark all <figure> elements as special blocks
        const figures = Array.from(container.querySelectorAll('figure'));
        figures.forEach(fig => fig.setAttribute('data-reader-block', 'true'));

        // Remove code download links (not needed for reading)
        container.querySelectorAll('p.codelink').forEach(el => el.remove());

        // Select all relevant elements to group into sections
        let elements = Array.from(container.querySelectorAll(
            'figure, .orm-Figure, .orm-CodeBlock, .code-area-container, h1, h2, h3, h4, h5, h6, table, pre, ul, ol, dl, p, img, mjx-container, blockquote'
        ));
        // Filter out elements that are inside other blocks to avoid duplicates
        elements = elements.filter(el => {
            const tag = el.tagName.toLowerCase();
            // 🚫 Skip any element inside .code-area-container
            if (!el.classList.contains('code-area-container') && el.closest('.code-area-container')) return false;


            // ❌ Skip any element that is inside a nested <ul> or <ol>
            const nestedListAncestor = el.closest('ul ul, ol ul, ul ol, ol ol, li ul, li ol, dl dd');
            if (nestedListAncestor) return false;

            // ❌ Skip <li> not directly under a top-level <ul>
            if (tag === 'li') {
                const parent = el.parentElement;
                return parent && parent.tagName.toLowerCase() === 'ul' && !parent.closest('ul ul, ol ul, li ul');
            }

            // ❌ Skip <ul> nested in any list structure
            if (tag === 'ul' || tag === 'ol') {
                return !el.closest('ul ul, ol ul, li ul, li ol');
            }
            if (tag === 'img') {
                // ❌ Skip if inside a figure, paragraph, or code block
                if (el.closest('figure, .orm-Figure, .orm-CodeBlock, p, dl dt a, pre a, h1, h2')) return false;
            }


            // ❌ Skip <p>, <img>, etc. if they're inside figures or code blocks
            if (['img', 'table', 'p', 'h6'].includes(tag)) {
                if (el.closest('figure, .orm-Figure, .orm-CodeBlock, blockquote')) return false;
                // ❌ Also exclude <p> inside nested <li>
                if (el.closest('li') && el.closest('li').closest('ul ul, ol ul, li ul')) return false;
            }

            // ❌ Skip <pre> inside any list item
            if (tag === 'pre' && el.closest('li')) return false;

            return true;
        });

        // If no elements found, retry
        if (elements.length === 0) {
            if (attempts < 20) return setTimeout(() => waitForContent(attempts + 1), 500);
            else return console.log('[Reader] No readable elements found');
        }

        console.log(`[Reader] ${elements.length} elements found`);

        // Group elements into blocks/sections
        groupedBlocks = [];
        let buffer = [];

        // Helper: check if element is inside a context block
        function isInsideContext(el) {
            return el.closest('figure, table, pre, ul, ol, dl, .orm-Figure, .orm-CodeBlock, .code-area-container');
        }

        // Go through each element and group them
        for (let el of elements) {
            const tag = el.tagName.toLowerCase();
            const isPara = tag === 'p';
            const isContext = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'table', 'pre', 'img', 'ul', 'ol', 'dl', 'mjx-container', 'blockquote'].includes(tag)
                || el.classList.contains('orm-Figure')
                || el.classList.contains('orm-CodeBlock')
                || el.classList.contains('code-area-container');

            // Skip paragraphs inside context blocks
            if (isPara && isInsideContext(el)) {
                continue;
            }

            // If it's a marked block, flush buffer and add as its own section
            if (el.hasAttribute('data-reader-block')) {
                if (buffer.length > 0) {
                    const wrapper = document.createElement('div');
                    wrapper.style.marginBottom = '2em';
                    buffer.forEach(b => wrapper.appendChild(b));
                    groupedBlocks.push(wrapper);
                    buffer = [];
                }
                const wrapper = document.createElement('div');
                wrapper.style.marginBottom = '2em';
                wrapper.appendChild(el.cloneNode(true));
                groupedBlocks.push(wrapper);
                continue;
            }

            // Add context or paragraph elements to buffer
            if (isContext || isPara) {
                buffer.push(el.cloneNode(true));
            }

            // If it's a paragraph, flush buffer as a section
            if (isPara && buffer.length > 0) {
                const wrapper = document.createElement('div');
                wrapper.style.marginBottom = '2em';
                buffer.forEach(b => wrapper.appendChild(b));
                groupedBlocks.push(wrapper);
                buffer = [];
            }
        }

        // Flush any remaining buffer
        if (buffer.length > 0) {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '2em';
            buffer.forEach(b => wrapper.appendChild(b));
            groupedBlocks.push(wrapper);
        }

        // If no blocks created, log and stop
        if (groupedBlocks.length === 0) {
            console.log('[Reader] No paragraph groups created');
            return;
        }

        console.log(`[Reader] ${groupedBlocks.length} paragraph groups created`);

        // Add progress display above content
        createProgressDisplay(container);
        // Show the first (or saved) section
        render(container);
        // Setup navigation with j/k keys
        setupNavigation(container);
        // Setup jump-to-section with 's' key
        setupJumpToSection(container);
    }

    // Create a sticky progress display above the content
    function createProgressDisplay(container) {
        const progressDisplay = document.createElement('div');
        progressDisplay.style.position = 'sticky';
        progressDisplay.style.top = '0';
        // progressDisplay.style.background = 'white';
        progressDisplay.style.padding = '0.5em 1em';
        progressDisplay.style.fontSize = '0.9em';
        // progressDisplay.style.color = '#444';
        progressDisplay.style.borderBottom = '1px solid #ccc';
        progressDisplay.style.marginBottom = '1em'
        progressDisplay.style.zIndex = '100';
        progressDisplay.id = 'reader-progress';

        // Insert above the content container
        container.parentElement.insertBefore(progressDisplay, container);
    }

    // Update the progress display with current section and percent read
    function updateProgressDisplay() {
        const el = document.getElementById('reader-progress');
        if (!el) return;

        // Get all blocks up to and including the current one
        const seenBlocks = groupedBlocks.slice(0, index + 1);

        // Helper: count words in a block
        const getWordCount = el => el.textContent.trim().split(/\s+/).length;

        // Calculate words read and total words
        const wordsRead = seenBlocks.reduce((sum, block) => sum + getWordCount(block), 0);
        const totalWords = groupedBlocks.reduce((sum, block) => sum + getWordCount(block), 0);

        // Calculate percent read
        const percent = totalWords > 0 ? Math.floor((wordsRead / totalWords) * 100) : 0;

        // Show section and percent
        el.textContent = `Section ${index + 1} of ${groupedBlocks.length} · ${percent}% read`;
    }

    // Render the current section
    function render(container) {
        // Clamp index to valid range
        index = Math.max(0, Math.min(index, groupedBlocks.length - 1));
        // Clear content and show current block
        container.innerHTML = '';
        container.appendChild(groupedBlocks[index]);
        // Update progress display
        updateProgressDisplay();
        console.log(`[Reader] Showing index ${index}`);
    }

    // Update the view and save progress
    function update(container) {
        container.innerHTML = '';
        container.appendChild(groupedBlocks[index]);
        updateProgressDisplay();
        // Save current index to localStorage
        localStorage.setItem(storageKey, JSON.stringify({ index }));
        console.log(`[Reader] Updated index to ${index} (saved)`);
    }

    // Setup navigation with 'j' (next) and 'k' (previous) keys
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

    // Start the script by waiting for content to load
    waitForContent();
})();
