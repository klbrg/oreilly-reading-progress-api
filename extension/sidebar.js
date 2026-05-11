// Finder-style collapsible sidebar. Shadow DOM so page styles don't bleed.
// Auto-discovers the user's O'Reilly playlists, lazy-loads each playlist's books
// when its folder is first expanded.

(function () {
    'use strict';

    if (window.__oreillyReaderSidebarInjected) return;
    window.__oreillyReaderSidebarInjected = true;

    const {
        getData, savePlaylist,
        listUserCollections, itemsFromCollection, fetchBookMeta,
        collectionSkeleton, collectionTitle,
        pickNextBook,
        createPlaylist, removeCollectionItem,
        getCurrentlyReading, removeFromCurrentlyReading, isCurrentlyReading,
        CURRENTLY_READING_KEY,
    } = window.OReillyAPI;

    const STATE_KEY = 'oreilly-reader-sidebar-state';
    const LIST_CACHE_KEY = 'oreilly-reader-playlists-last-listed';
    const LIST_TTL_MS = 60 * 60 * 1000; // 1h

    const host = document.createElement('div');
    host.id = 'oreilly-reader-sidebar-host';
    host.style.all = 'initial';
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = (window.__oreillyReaderSidebar && window.__oreillyReaderSidebar.styles) || '';
    root.appendChild(style);

    const sb = document.createElement('div');
    sb.className = 'sb';
    sb.innerHTML = `
        <div class="sb-header">
            <span class="sb-title">Playlists</span>
            <div style="display:flex;gap:6px;">
                <button class="sb-refresh" id="new-playlist" title="Create a new playlist">+ New</button>
                <button class="sb-refresh" id="refresh" title="Re-fetch playlists from O'Reilly">Refresh</button>
            </div>
        </div>
        <div id="new-row-slot"></div>
        <div class="sb-body" id="body"></div>
        <div class="toast" id="toast"></div>
    `;
    root.appendChild(sb);

    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    toggle.textContent = '›';
    toggle.title = 'Show/hide reader sidebar (ö)';
    root.appendChild(toggle);

    function readState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
    }
    function writeState(s) {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
    }

    const state = Object.assign({
        open: false,
        expanded: {},
    }, readState());

    function applyOpen() {
        sb.classList.toggle('open', state.open);
        toggle.classList.toggle('open', state.open);
        toggle.textContent = state.open ? '‹' : '›';
        document.documentElement.style.setProperty('--reader-sidebar-offset', state.open ? '280px' : '0px');
    }
    applyOpen();

    toggle.addEventListener('click', () => {
        state.open = !state.open;
        writeState(state);
        applyOpen();
    });

    document.documentElement.appendChild(host);

    // --- helpers ---

    function bookIdFromLibraryUrl(url) {
        try {
            const u = new URL(url);
            const parts = u.pathname.split('/').filter(Boolean);
            const i = parts.indexOf('view');
            return i >= 0 && parts[i + 2] ? parts[i + 2] : null;
        } catch {
            return null;
        }
    }

    function latestEntryByBook(storage) {
        const map = new Map();
        for (const key of Object.keys(storage || {})) {
            const e = storage[key];
            const bid = bookIdFromLibraryUrl(e.url);
            if (!bid) continue;
            const prev = map.get(bid);
            if (!prev || new Date(e.date) > new Date(prev.date)) {
                map.set(bid, e);
            }
        }
        return map;
    }

    function currentBookId() { return bookIdFromLibraryUrl(location.href); }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    let toastTimer = null;
    function showToast(msg, ms = 2500) {
        const t = root.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    }


    // --- sync ---

    async function syncPlaylists(force = false) {
        const last = Number(localStorage.getItem(LIST_CACHE_KEY) || 0);
        if (!force && Date.now() - last < LIST_TTL_MS) return;

        let colls;
        try { colls = await listUserCollections(); } catch (err) {
            console.warn('[Sidebar] listUserCollections failed:', err);
            return;
        }
        if (colls.length === 0) {
            console.warn('[Sidebar] No collections returned.');
            return;
        }

        let data;
        try { data = await getData(); } catch { data = {}; }
        const existing = data.playlists || {};

        const bookCache = new Map();
        for (const p of Object.values(existing)) {
            for (const b of (p.books || [])) {
                if (b && b.id) bookCache.set(String(b.id), b);
            }
        }

        const missing = new Map();
        for (const coll of colls) {
            for (const { isbn, type } of itemsFromCollection(coll)) {
                if (!bookCache.has(String(isbn))) missing.set(String(isbn), type);
            }
        }

        if (missing.size > 0) {
            console.log(`[Sidebar] Fetching metadata for ${missing.size} item(s)…`);
            const fetched = await Promise.all(
                Array.from(missing.entries()).map(([isbn, type]) =>
                    fetchBookMeta(isbn, type).catch(() => null)
                )
            );
            for (const b of fetched) {
                if (b && b.id) bookCache.set(String(b.id), b);
            }
        }

        for (const coll of colls) {
            const items = itemsFromCollection(coll);
            const books = items.map(({ isbn, itemId }) => {
                const meta = bookCache.get(String(isbn));
                if (!meta) return null;
                return { ...meta, item_id: itemId };
            }).filter(Boolean);
            const playlist = {
                id: coll.id,
                title: collectionTitle(coll),
                url: `https://learning.oreilly.com/playlists/${coll.id}/`,
                last_opened: new Date().toISOString(),
                books,
            };
            try { await savePlaylist(coll.id, playlist); }
            catch (err) { console.warn('[Sidebar] Failed to save', coll.id, err); }
        }

        const liveIds = new Set(colls.map(c => c.id));
        for (const oldId of Object.keys(existing)) {
            if (liveIds.has(oldId)) continue;
            try {
                await fetch(`${window.OReillyAPI.API_URL}/playlists/${encodeURIComponent(oldId)}`, { method: 'DELETE' });
            } catch (err) {
                console.warn('[Sidebar] Failed to prune', oldId, err);
            }
        }

        localStorage.setItem(LIST_CACHE_KEY, String(Date.now()));
    }

    // --- render ---

    function renderTile(book, latest, curBook, pid, playlist) {
        const tile = document.createElement('div');
        const isReading = isCurrentlyReading(book.id);
        tile.className = 'tile' + (isReading ? ' reading' : '');
        tile.title = book.title;
        if (isReading) {
            const bm = document.createElement('span');
            bm.className = 'bookmark';
            tile.appendChild(bm);
        }
        const entry = latest.get(book.id);
        const targetUrl = entry?.url || book.url;

        if (book.cover) {
            const img = document.createElement('img');
            img.src = book.cover;
            img.alt = book.title;
            img.loading = 'lazy';
            img.onerror = () => {
                img.remove();
                const fb = document.createElement('div');
                fb.className = 'fallback';
                fb.textContent = book.title;
                tile.appendChild(fb);
            };
            tile.appendChild(img);
        } else {
            const fb = document.createElement('div');
            fb.className = 'fallback';
            fb.textContent = book.title;
            tile.appendChild(fb);
        }

        if (book.item_id) {
            const del = document.createElement('button');
            del.className = 'tile-del';
            del.textContent = '×';
            del.title = 'Remove from this playlist (click twice)';
            let armed = false;
            let revert = null;
            del.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!armed) {
                    armed = true;
                    del.classList.add('confirming');
                    del.textContent = '?';
                    revert = setTimeout(() => {
                        armed = false;
                        del.classList.remove('confirming');
                        del.textContent = '×';
                    }, 2500);
                    return;
                }
                clearTimeout(revert);
                del.classList.remove('confirming');
                del.textContent = '×';
                armed = false;
                try {
                    await removeCollectionItem(book.item_id);
                    localStorage.removeItem(LIST_CACHE_KEY);
                    await syncPlaylists(true);
                    await refresh();
                } catch (err) {
                    showToast('Remove failed: ' + err.message);
                }
            });
            tile.appendChild(del);
        }

        tile.addEventListener('click', () => {
            if (targetUrl) location.href = targetUrl;
        });

        return tile;
    }

    function renderGrid(grid, books, latest, curBook, pid, playlist) {
        grid.innerHTML = '';
        if (!books || books.length === 0) {
            const ld = document.createElement('div');
            ld.className = 'loading';
            ld.textContent = 'Loading books…';
            ld.style.gridColumn = '1 / -1';
            grid.appendChild(ld);
            return;
        }
        for (const book of books) {
            grid.appendChild(renderTile(book, latest, curBook, pid, playlist));
        }
    }

    function orderedIds(playlists) {
        return Object.keys(playlists).sort((a, b) =>
            (playlists[a].title || '').localeCompare(playlists[b].title || ''));
    }

    function render(data) {
        const body = root.getElementById('body');
        const playlists = (data && data.playlists) || {};
        const storage = (data && data.storage) || {};
        const latest = latestEntryByBook(storage);
        const curBook = currentBookId();

        const ids = orderedIds(playlists);
        if (ids.length === 0) {
            body.innerHTML = `<div class="empty">No playlists yet. Click Refresh, or open an O'Reilly playlist URL.</div>`;
            return;
        }

        const frag = document.createDocumentFragment();

        const readingIds = getCurrentlyReading();
        if (readingIds.length) {
            const bookIndex = new Map();
            for (const p of Object.values(playlists)) {
                for (const b of (p.books || [])) {
                    if (!bookIndex.has(b.id)) bookIndex.set(b.id, { ...b, _pid: p.id, _playlist: p });
                }
            }
            const reading = readingIds.map(id => bookIndex.get(id)).filter(Boolean);
            if (reading.length) {
                const section = document.createElement('div');
                section.className = 'reading-section';
                const header = document.createElement('div');
                header.className = 'reading-header';
                header.innerHTML = `<span>Currently Reading</span><span class="folder-count">${reading.length}</span>`;
                section.appendChild(header);
                const grid = document.createElement('div');
                grid.className = 'grid reading-grid';
                for (const b of reading) {
                    const tile = renderTile(b, latest, curBook, b._pid, b._playlist);
                    const remove = document.createElement('button');
                    remove.className = 'reading-remove';
                    remove.title = 'Remove from Currently Reading';
                    remove.textContent = '×';
                    remove.addEventListener('click', (e) => {
                        e.stopPropagation();
                        removeFromCurrentlyReading(b.id);
                        window.dispatchEvent(new CustomEvent('oreilly-reading-changed'));
                        render(data);
                    });
                    tile.appendChild(remove);
                    grid.appendChild(tile);
                }
                section.appendChild(grid);
                frag.appendChild(section);
            }
        }

        for (const pid of ids) {
            const p = playlists[pid];
            const folder = document.createElement('div');
            folder.className = 'folder' + (state.expanded[pid] ? ' open' : '');

            const row = document.createElement('div');
            row.className = 'folder-row';
            row.title = 'Click to expand';
            row.innerHTML = `
                <span class="chev">❯</span>
                <span class="folder-name">${escapeHtml(p.title || pid)}</span>
                <span class="folder-count">${(p.books || []).length}</span>
            `;
            folder.appendChild(row);

            const grid = document.createElement('div');
            grid.className = 'grid';
            renderGrid(grid, p.books, latest, curBook, pid, p);
            folder.appendChild(grid);

            row.addEventListener('click', () => {
                const wasOpen = folder.classList.contains('open');
                folder.classList.toggle('open', !wasOpen);
                state.expanded[pid] = !wasOpen;
                writeState(state);
            });

            frag.appendChild(folder);
        }
        body.innerHTML = '';
        body.appendChild(frag);
    }

    async function refresh() {
        try {
            const data = await getData();
            render(data);
        } catch (err) {
            console.warn('[Sidebar] Failed to load data:', err);
            root.getElementById('body').innerHTML =
                `<div class="empty">Could not reach local API at localhost:44433.</div>`;
        }
    }

    const refreshBtn = root.getElementById('refresh');
    refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '…';
        await syncPlaylists(true);
        await refresh();
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
    });

    const newBtn = root.getElementById('new-playlist');
    const newSlot = root.getElementById('new-row-slot');
    newBtn.addEventListener('click', () => {
        if (newSlot.firstChild) { newSlot.innerHTML = ''; return; }
        const wrap = document.createElement('div');
        wrap.className = 'new-row';
        const input = document.createElement('input');
        input.placeholder = 'New playlist name (Enter to create, Esc to cancel)';
        wrap.appendChild(input);
        newSlot.appendChild(wrap);
        setTimeout(() => input.focus(), 0);

        const cancel = () => { newSlot.innerHTML = ''; };
        const submit = async () => {
            const name = input.value.trim();
            if (!name) { cancel(); return; }
            input.disabled = true;
            try {
                await createPlaylist(name);
                localStorage.removeItem(LIST_CACHE_KEY);
                await syncPlaylists(true);
                await refresh();
                cancel();
            } catch (err) {
                showToast('Create failed: ' + err.message);
                input.disabled = false;
            }
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            e.stopPropagation();
        });
        input.addEventListener('blur', () => {
            setTimeout(() => { if (!input.disabled && !input.value) cancel(); }, 150);
        });
    });

    window.addEventListener('oreilly-reading-changed', () => { refresh(); });

    window.addEventListener('keydown', (e) => {
        const realTarget = (e.composedPath && e.composedPath()[0]) || e.target;
        if (realTarget && realTarget.matches && realTarget.matches('input, textarea, [contenteditable="true"]')) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key !== 'ö') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        state.open = !state.open;
        writeState(state);
        applyOpen();
    }, true);

    (async () => {
        await refresh();
        await syncPlaylists(false);
        await refresh();
    })();
})();
