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
        createPlaylist, removeCollectionItem, reorderPlaylistBooks,
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
    style.textContent = `
        :host, * { box-sizing: border-box; }
        .sb {
            position: fixed;
            top: 0; left: 0; bottom: 0;
            width: 280px;
            background: #ffffff;
            color: #111111;
            font: 14px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
            z-index: 2147483646;
            display: flex;
            flex-direction: column;
            transform: translateX(-283px);
            transition: transform 0.22s ease;
            border-right: 3px solid #111111;
        }
        .sb.open { transform: translateX(0); }

        .sb-header {
            padding: 10px 14px;
            border-bottom: 2px solid #111111;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            background: #ffffff;
        }
        .sb-title {
            font-size: 12px;
            font-weight: 700;
            color: #111111;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .sb-refresh {
            background: #ffffff;
            border: 2px solid #111111;
            color: #111111;
            border-radius: 3px;
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
            cursor: pointer;
            box-shadow: 2px 2px 0 0 #111111;
            transition: transform 0.06s ease, box-shadow 0.06s ease, background 0.12s ease;
        }
        .sb-refresh#new-playlist { background: #d80000; color: #ffffff; }
        .sb-refresh:hover { background: #f5f5f5; }
        .sb-refresh#new-playlist:hover { background: #ff1a1a; }
        .sb-refresh:active { transform: translate(2px, 2px); box-shadow: 0 0 0 0 #111111; }
        .sb-refresh:disabled { opacity: 0.5; cursor: default; box-shadow: 2px 2px 0 0 #111111; transform: none; }

        .sb-body { flex: 1; overflow-y: auto; padding: 2px 0 20px; }
        .sb-body::-webkit-scrollbar { width: 8px; }
        .sb-body::-webkit-scrollbar-thumb { background: #e4e4e7; border-radius: 4px; }
        .sb-body::-webkit-scrollbar-thumb:hover { background: #d1d5db; }

        .folder { padding: 4px 10px; }
        .folder-row {
            display: flex;
            align-items: center;
            padding: 8px 10px;
            margin: 0;
            background: #f7f7f5;
            border: 2px solid #111111;
            border-radius: 3px;
            box-shadow: 2px 2px 0 0 #111111;
            cursor: pointer;
            user-select: none;
            gap: 8px;
            transition: transform 0.06s ease, box-shadow 0.06s ease;
        }
        .folder-row:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 0 #111111; }
        .folder-row:active { transform: translate(2px, 2px); box-shadow: 0 0 0 0 #111111; }
        .chev {
            display: inline-block;
            width: 12px;
            transition: transform 0.15s ease;
            color: #111111;
            font-size: 11px;
            font-weight: 900;
            flex-shrink: 0;
        }
        .folder.open .chev { transform: rotate(90deg); }
        .folder-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 0.2px;
            color: #111111;
        }
        .folder-count {
            color: #ffffff;
            background: #111111;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
            font-size: 11px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            padding: 1px 6px;
            border-radius: 3px;
            min-width: 20px;
            text-align: center;
        }

        .folder.dragging { opacity: 0.4; }
        .folder.drop-before { box-shadow: inset 0 2px 0 0 #d80000; }
        .folder.drop-after { box-shadow: inset 0 -2px 0 0 #d80000; }
        .folder-row { cursor: grab; }
        .folder-row:active { cursor: grabbing; }

        .tile-del {
            position: absolute;
            top: 4px;
            right: 4px;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.95);
            color: #4a5056;
            border: 1px solid #e4e4e7;
            cursor: pointer;
            font-size: 15px;
            line-height: 1;
            padding: 0;
            opacity: 0;
            transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .tile:hover .tile-del { opacity: 1; }
        .tile-del:hover { color: #d80000; border-color: #d80000; }

        .tile-del.confirming {
            background: #d80000 !important;
            color: #fff !important;
            opacity: 1 !important;
            border-color: #d80000 !important;
            border-radius: 50%;
        }

        .new-row {
            padding: 10px 14px;
            border-bottom: 2px solid #111111;
            background: #ffffff;
        }
        .new-row input {
            width: 100%;
            background: #ffffff;
            color: #111111;
            border: 2px solid #111111;
            border-radius: 3px;
            padding: 6px 8px;
            font-size: 15px;
            font-family: inherit;
            outline: none;
            box-shadow: 2px 2px 0 0 #111111;
            transition: box-shadow 0.12s ease;
        }
        .new-row input:focus { box-shadow: 3px 3px 0 0 #d80000; }

        .toast {
            position: absolute;
            left: 12px;
            right: 12px;
            bottom: 12px;
            background: #d80000;
            color: #ffffff;
            padding: 8px 12px;
            border: 2px solid #111111;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 600;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            z-index: 20;
            opacity: 0;
            transition: opacity 0.18s ease;
            pointer-events: none;
            box-shadow: 4px 4px 0 0 #111111;
        }
        .toast.show { opacity: 1; }

        .reading-section {
            margin: 4px 10px 14px;
            padding-bottom: 14px;
            border-bottom: 2px solid #111111;
        }
        .reading-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 4px 8px;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
            font-size: 11px;
            font-weight: 700;
            color: #111111;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .reading-grid {
            display: grid !important;
            padding: 4px 0 0;
        }
        .reading-remove {
            position: absolute;
            top: 2px;
            right: 2px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #ffffff;
            color: #111111;
            border: 1.5px solid #111111;
            font-size: 13px;
            line-height: 1;
            padding: 0;
            cursor: pointer;
            opacity: 0;
            z-index: 4;
            transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
        }
        .tile:hover .reading-remove { opacity: 1; }
        .reading-remove:hover { background: #d80000; color: #ffffff; border-color: #d80000; }

        .grid {
            display: none;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            padding: 12px 14px 14px;
        }
        .folder.open .grid { display: grid; }

        .tile {
            display: block;
            cursor: pointer;
            border-radius: 1px 3px 3px 1px;
            overflow: hidden;
            background: #ffffff;
            position: relative;
            aspect-ratio: 3 / 4;
            box-shadow:
                0 0 0 1px rgba(0,0,0,0.15),
                1px 0 0 1px #fafaf6,
                2px 0 0 1px #efece4,
                3px 0 0 1px #e2ddd0,
                4px 0 0 1px #d2ccba,
                2px 2px 3px 0 rgba(0,0,0,0.12),
                5px 6px 14px -2px rgba(0,0,0,0.20),
                8px 12px 28px -4px rgba(0,0,0,0.12);
            transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .tile::before {
            content: '';
            position: absolute;
            top: 0; bottom: 0; left: 0;
            width: 8px;
            background: linear-gradient(to right, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.18) 30%, rgba(0,0,0,0.06) 60%, rgba(0,0,0,0) 100%);
            pointer-events: none;
            z-index: 2;
        }
        .tile::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 5px;
            background: linear-gradient(to bottom, rgba(255,255,255,0.16), rgba(255,255,255,0));
            pointer-events: none;
            z-index: 2;
        }
        .tile:hover {
            transform: translate(-1px, -3px);
            box-shadow:
                0 0 0 1px rgba(0,0,0,0.18),
                1px 0 0 1px #fafaf6,
                2px 0 0 1px #efece4,
                3px 0 0 1px #e2ddd0,
                4px 0 0 1px #d2ccba,
                5px 0 0 1px #c0b8a0,
                2px 4px 6px 0 rgba(0,0,0,0.15),
                7px 10px 20px -2px rgba(0,0,0,0.25),
                12px 18px 36px -4px rgba(0,0,0,0.18);
        }
        .tile:active {
            transform: translate(0, 1px);
            box-shadow:
                0 0 0 1px rgba(0,0,0,0.15),
                1px 0 0 1px #fafaf6,
                2px 0 0 1px #efece4,
                3px 0 0 1px #e2ddd0,
                4px 0 0 1px #d2ccba,
                2px 2px 3px 0 rgba(0,0,0,0.12),
                4px 4px 8px -1px rgba(0,0,0,0.15);
        }
        .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .tile .fallback {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 6px;
            font-size: 11px;
            font-weight: 600;
            color: #111111;
            line-height: 1.25;
        }
        .tile .bookmark {
            position: absolute;
            top: 0;
            right: 8px;
            width: 9px;
            height: 22%;
            background: linear-gradient(to right, #a80000 0%, #d80000 45%, #a80000 100%);
            z-index: 3;
            clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
            filter:
                drop-shadow(0 0 0.5px #111111)
                drop-shadow(0 0 0.5px #111111)
                drop-shadow(0 0 0.5px #ffffff);
            pointer-events: none;
        }
        .drop-marker {
            aspect-ratio: 3 / 4;
            border: 2px dashed #d80000;
            border-radius: 3px;
            background: rgba(216, 0, 0, 0.08);
            pointer-events: none;
        }

        .loading, .empty {
            padding: 14px 16px;
            color: #6b7280;
            font-size: 13px;
            line-height: 1.5;
        }

        .toggle {
            position: fixed;
            top: 50%;
            left: 0;
            transform: translateY(-50%);
            width: 22px;
            height: 56px;
            background: #ffffff;
            color: #111111;
            border: 2px solid #111111;
            border-left: none;
            border-radius: 0 4px 4px 0;
            box-shadow: 2px 2px 0 0 #111111;
            cursor: pointer;
            z-index: 2147483647;
            font-size: 18px;
            font-weight: 900;
            padding: 0;
            transition: left 0.22s ease, background 0.12s ease, transform 0.06s ease, box-shadow 0.06s ease;
        }
        .toggle:hover { background: #f5f5f5; }
        .toggle:active { transform: translateY(calc(-50% + 2px)) translateX(2px); box-shadow: 0 0 0 0 #111111; }
        .toggle.open { left: 283px; }
    `;
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
        order: [],
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

    function armConfirm(button, onConfirm) {
        let armed = false;
        let revert = null;
        const original = button.textContent;
        const arm = () => {
            armed = true;
            button.classList.add('confirming');
            button.textContent = '?';
            revert = setTimeout(() => {
                armed = false;
                button.classList.remove('confirming');
                button.textContent = original;
            }, 2500);
        };
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!armed) { arm(); return; }
            if (revert) clearTimeout(revert);
            button.classList.remove('confirming');
            button.textContent = original;
            armed = false;
            onConfirm();
        });
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

    let activeDrag = null;

    function setupTileDragDrop(tile, book, playlist) {
        tile.draggable = true;
        tile.dataset.bookId = book.id;

        tile.addEventListener('dragstart', (e) => {
            const origin = (e.composedPath && e.composedPath()[0]) || e.target;
            if (origin && origin.closest && origin.closest('.tile-del')) {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
            e.dataTransfer.setData('application/x-book', JSON.stringify({
                bookId: book.id,
                playlistId: playlist.id,
            }));
            e.dataTransfer.effectAllowed = 'move';
            const grid = tile.parentElement;
            const marker = document.createElement('div');
            marker.className = 'drop-marker';
            activeDrag = { tile, marker, grid, playlist, book };
            setTimeout(() => {
                if (activeDrag && activeDrag.tile === tile && tile.parentElement === grid) {
                    grid.replaceChild(marker, tile);
                }
            }, 0);
        });

        tile.addEventListener('dragend', () => {
            if (!activeDrag) return;
            if (activeDrag.marker.parentElement) {
                activeDrag.marker.replaceWith(activeDrag.tile);
            }
            activeDrag = null;
        });

        tile.addEventListener('dragover', (e) => {
            if (!activeDrag) return;
            if (activeDrag.playlist.id !== playlist.id) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const rect = tile.getBoundingClientRect();
            const before = (e.clientX - rect.left) < rect.width / 2;
            const ref = before ? tile : tile.nextSibling;
            if (activeDrag.marker !== ref && activeDrag.marker.nextSibling !== ref) {
                activeDrag.grid.insertBefore(activeDrag.marker, ref);
            }
        });

        tile.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!activeDrag) return;
            if (activeDrag.playlist.id !== playlist.id) {
                showToast('Cross-playlist move not supported yet');
                return;
            }

            const grid = activeDrag.grid;
            const draggedId = activeDrag.book.id;
            const newOrderIds = [];
            for (const child of Array.from(grid.children)) {
                if (child === activeDrag.marker) {
                    newOrderIds.push(draggedId);
                } else if (child.dataset && child.dataset.bookId) {
                    newOrderIds.push(child.dataset.bookId);
                }
            }

            activeDrag.marker.remove();
            activeDrag = null;

            const byId = new Map(playlist.books.map(b => [b.id, b]));
            const ourns = newOrderIds.map(id => `urn:orm:book:${id}`);

            try {
                await reorderPlaylistBooks(playlist.id, ourns);
                localStorage.removeItem(LIST_CACHE_KEY);
                await syncPlaylists(true);
                await refresh();
            } catch (err) {
                showToast('Reorder failed: ' + err.message);
                await refresh();
            }
        });
    }

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
            armConfirm(del, async () => {
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

        if (playlist) setupTileDragDrop(tile, book, playlist);
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
        const all = Object.keys(playlists);
        const known = new Set(state.order);
        const extras = all.filter(id => !known.has(id));
        extras.sort((a, b) => (playlists[a].title || '').localeCompare(playlists[b].title || ''));
        return [...state.order.filter(id => all.includes(id)), ...extras];
    }

    function setupDragDrop(folder, pid) {
        folder.setAttribute('draggable', 'true');

        folder.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', pid);
            e.dataTransfer.effectAllowed = 'move';
            folder.classList.add('dragging');
        });
        folder.addEventListener('dragend', () => folder.classList.remove('dragging'));

        folder.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = folder.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            folder.classList.toggle('drop-before', before);
            folder.classList.toggle('drop-after', !before);
        });
        folder.addEventListener('dragleave', () => {
            folder.classList.remove('drop-before', 'drop-after');
        });
        folder.addEventListener('drop', async (e) => {
            e.preventDefault();
            const srcId = e.dataTransfer.getData('text/plain');
            const before = folder.classList.contains('drop-before');
            folder.classList.remove('drop-before', 'drop-after');
            if (!srcId || srcId === pid) return;

            const data = await getData().catch(() => ({}));
            const ids = orderedIds(data.playlists || {});
            const from = ids.indexOf(srcId);
            let to = ids.indexOf(pid);
            if (from < 0 || to < 0) return;
            ids.splice(from, 1);
            if (from < to) to -= 1;
            ids.splice(before ? to : to + 1, 0, srcId);
            state.order = ids;
            writeState(state);
            render(data);
        });
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

            setupDragDrop(folder, pid);
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
