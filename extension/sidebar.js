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
        createPlaylist, deletePlaylistRemote, addBooksToPlaylist, removeCollectionItem,
    } = window.OReillyAPI;

    const STATE_KEY = 'oreilly-reader-sidebar-state';
    const LIST_CACHE_KEY = 'oreilly-reader-playlists-last-listed';
    const ACTIVE_KEY = 'oreilly-reader-active-playlist';
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
            background: #1f2430;
            color: #e6e6e6;
            font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 2147483646;
            display: flex;
            flex-direction: column;
            transform: translateX(-280px);
            transition: transform 0.22s ease;
            box-shadow: 2px 0 10px rgba(0,0,0,0.2);
        }
        .sb.open { transform: translateX(0); }
        .sb-header {
            padding: 10px 12px;
            border-bottom: 1px solid #2c3240;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .sb-title { font-size: 13px; font-weight: 600; color: #cfd3dc; letter-spacing: 0.3px; }
        .sb-refresh {
            background: transparent;
            border: 1px solid #3a4050;
            color: #cfd3dc;
            border-radius: 4px;
            padding: 3px 8px;
            font-size: 11px;
            cursor: pointer;
        }
        .sb-refresh:hover { background: #262c3a; }
        .sb-refresh:disabled { opacity: 0.5; cursor: default; }
        .sb-body { flex: 1; overflow-y: auto; padding: 6px 0 16px; }
        .sb-body::-webkit-scrollbar { width: 8px; }
        .sb-body::-webkit-scrollbar-thumb { background: #394151; border-radius: 4px; }

        .folder { border-bottom: 1px solid #262b37; }
        .folder-row {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            gap: 8px;
        }
        .folder-row:hover { background: #262c3a; }
        .chev {
            display: inline-block;
            width: 10px;
            transition: transform 0.15s ease;
            color: #8c93a3;
            font-size: 10px;
        }
        .folder.open .chev { transform: rotate(90deg); }
        .folder-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 500;
        }
        .folder-count { color: #8c93a3; font-size: 11px; }
        .pin-btn {
            background: transparent;
            border: none;
            color: #5a6170;
            cursor: pointer;
            font-size: 13px;
            padding: 0 4px;
            line-height: 1;
            opacity: 0;
            transition: opacity 0.12s ease, color 0.12s ease;
        }
        .folder-row:hover .pin-btn { opacity: 1; }
        .pin-btn.pinned { color: #e2b84a; opacity: 1; }
        .pin-btn:hover { color: #f5d97a; }

        .folder.dragging { opacity: 0.4; }
        .folder.drop-before { box-shadow: inset 0 2px 0 0 #c0392b; }
        .folder.drop-after { box-shadow: inset 0 -2px 0 0 #c0392b; }
        .folder-row { cursor: grab; }
        .folder-row:active { cursor: grabbing; }

        .folder-del {
            background: transparent;
            border: none;
            color: #6b7280;
            cursor: pointer;
            font-size: 14px;
            padding: 0 4px;
            line-height: 1;
            opacity: 0;
            transition: opacity 0.12s ease, color 0.12s ease;
        }
        .folder-row:hover .folder-del { opacity: 1; }
        .folder-del:hover { color: #e74c3c; }

        .tile-del {
            position: absolute;
            top: 3px;
            right: 3px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: rgba(30, 30, 30, 0.8);
            color: #fff;
            border: none;
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
            padding: 0;
            opacity: 0;
            transition: opacity 0.12s ease, background 0.12s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .tile:hover .tile-del { opacity: 1; }
        .tile-del:hover { background: #e74c3c; }

        .add-tile {
            display: flex;
            align-items: center;
            justify-content: center;
            aspect-ratio: 3 / 4;
            border: 1.5px dashed #4a5165;
            border-radius: 4px;
            color: #8c93a3;
            cursor: pointer;
            font-size: 20px;
            background: transparent;
            transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
        }
        .add-tile:hover { border-color: #c0392b; color: #c0392b; background: rgba(192, 57, 43, 0.05); }
        .add-tile.editing { border-style: solid; padding: 6px; cursor: default; background: transparent; }
        .add-tile.editing:hover { border-color: #c0392b; }
        .add-tile input {
            width: 100%;
            background: transparent;
            color: #e6e6e6;
            border: none;
            outline: none;
            font-size: 10px;
            font-family: inherit;
            text-align: center;
        }
        .tile-del.confirming, .folder-del.confirming {
            background: #e74c3c !important;
            color: #fff !important;
            opacity: 1 !important;
            border-radius: 3px;
        }

        .new-row {
            padding: 8px 12px;
            border-bottom: 1px solid #2c3240;
            background: #262c3a;
        }
        .new-row input {
            width: 100%;
            background: #1f2430;
            color: #e6e6e6;
            border: 1px solid #4a5165;
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 13px;
            font-family: inherit;
            outline: none;
        }
        .new-row input:focus { border-color: #c0392b; }

        .toast {
            position: absolute;
            left: 12px;
            right: 12px;
            bottom: 12px;
            background: #c0392b;
            color: #fff;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 20;
            opacity: 0;
            transition: opacity 0.18s ease;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .toast.show { opacity: 1; }

        .active-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            border: 1.5px solid #6b7280;
            background: transparent;
            cursor: pointer;
            padding: 0;
            flex-shrink: 0;
            transition: background 0.12s ease, border-color 0.12s ease;
        }
        .active-dot:hover { border-color: #c0392b; }
        .active-dot.on { background: #c0392b; border-color: #c0392b; }
        .folder.active > .folder-row { background: #262c3a; }
        .folder.active > .folder-row .folder-name { color: #fff; }

        .grid {
            display: none;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            padding: 6px 12px 14px;
        }
        .folder.open .grid { display: grid; }

        .tile {
            display: block;
            cursor: pointer;
            border-radius: 4px;
            overflow: hidden;
            background: #2a3040;
            position: relative;
            aspect-ratio: 3 / 4;
            transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .tile:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
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
            font-size: 10px;
            color: #b8bdc7;
            line-height: 1.25;
        }
        .tile.current { outline: 2px solid #c0392b; outline-offset: -2px; }

        .loading, .empty {
            padding: 12px 14px;
            color: #8c93a3;
            font-size: 12px;
            line-height: 1.5;
        }

        .toggle {
            position: fixed;
            top: 50%;
            left: 0;
            transform: translateY(-50%);
            width: 22px;
            height: 56px;
            background: #1f2430;
            color: #e6e6e6;
            border: none;
            border-radius: 0 6px 6px 0;
            cursor: pointer;
            z-index: 2147483647;
            font-size: 13px;
            padding: 0;
            box-shadow: 2px 0 6px rgba(0,0,0,0.2);
            transition: left 0.22s ease;
        }
        .toggle:hover { background: #262c3a; }
        .toggle.open { left: 280px; }
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
    toggle.title = 'Show/hide reader sidebar';
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
        order: [],   // custom ordering of playlist ids; ids not here fall back to alphabetical
        pinned: [],  // subset of playlist ids pinned to top
    }, readState());

    function applyOpen() {
        sb.classList.toggle('open', state.open);
        toggle.classList.toggle('open', state.open);
        toggle.textContent = state.open ? '‹' : '›';
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

        const missing = new Set();
        for (const coll of colls) {
            for (const { isbn } of itemsFromCollection(coll)) {
                if (!bookCache.has(String(isbn))) missing.add(String(isbn));
            }
        }

        if (missing.size > 0) {
            console.log(`[Sidebar] Fetching metadata for ${missing.size} book(s)…`);
            const fetched = await Promise.all(
                Array.from(missing).map(isbn => fetchBookMeta(isbn).catch(() => null))
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

    function renderTile(book, latest, curBook, pid) {
        const tile = document.createElement('div');
        tile.className = 'tile' + (book.id === curBook ? ' current' : '');
        tile.title = book.title;
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
            if (pid) localStorage.setItem(ACTIVE_KEY, pid);
            if (targetUrl) location.href = targetUrl;
        });
        return tile;
    }

    function renderAddBookTile(pid) {
        const tile = document.createElement('div');
        tile.className = 'add-tile';
        tile.title = 'Add a book by URL or ISBN';

        const showButton = () => {
            tile.classList.remove('editing');
            tile.innerHTML = '';
            tile.textContent = '+';
            tile.onclick = (e) => { e.stopPropagation(); showInput(); };
        };
        const showInput = () => {
            tile.classList.add('editing');
            tile.innerHTML = '';
            tile.onclick = null;
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'URL or ISBN';
            tile.appendChild(input);
            setTimeout(() => input.focus(), 0);

            const submit = async () => {
                const raw = input.value.trim();
                if (!raw) { showButton(); return; }
                const isbn = extractIsbn(raw);
                if (!isbn) { showToast('Could not parse ISBN'); return; }
                input.disabled = true;
                try {
                    await addBooksToPlaylist(pid, [isbn]);
                    localStorage.removeItem(LIST_CACHE_KEY);
                    await syncPlaylists(true);
                    await refresh();
                } catch (err) {
                    showToast('Add failed: ' + err.message);
                    showButton();
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                else if (e.key === 'Escape') { e.preventDefault(); showButton(); }
                e.stopPropagation();
            });
            input.addEventListener('blur', () => {
                setTimeout(() => { if (!input.disabled) showButton(); }, 150);
            });
        };

        showButton();
        return tile;
    }

    function extractIsbn(s) {
        const m = s.match(/(\d{10,13})/);
        return m ? m[1] : null;
    }

    function renderGrid(grid, books, latest, curBook, pid) {
        grid.innerHTML = '';
        if (!books || books.length === 0) {
            const ld = document.createElement('div');
            ld.className = 'loading';
            ld.textContent = 'Loading books…';
            ld.style.gridColumn = '1 / -1';
            grid.appendChild(ld);
        } else {
            for (const book of books) {
                grid.appendChild(renderTile(book, latest, curBook, pid));
            }
        }
        grid.appendChild(renderAddBookTile(pid));
    }

    function orderedIds(playlists) {
        const all = Object.keys(playlists);
        const pinned = new Set(state.pinned);
        const known = new Set(state.order);
        const extras = all.filter(id => !known.has(id));
        extras.sort((a, b) => (playlists[a].title || '').localeCompare(playlists[b].title || ''));
        const full = [...state.order.filter(id => all.includes(id)), ...extras];
        const pinnedIds = full.filter(id => pinned.has(id));
        const rest = full.filter(id => !pinned.has(id));
        return [...pinnedIds, ...rest];
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

        const pinned = new Set(state.pinned);
        const activePid = localStorage.getItem(ACTIVE_KEY) || '';
        const frag = document.createDocumentFragment();
        for (const pid of ids) {
            const p = playlists[pid];
            const folder = document.createElement('div');
            folder.className = 'folder'
                + (state.expanded[pid] ? ' open' : '')
                + (pid === activePid ? ' active' : '');

            const row = document.createElement('div');
            row.className = 'folder-row';
            const isPinned = pinned.has(pid);
            const isActive = pid === activePid;
            row.innerHTML = `
                <span class="chev">▶</span>
                <button class="active-dot${isActive ? ' on' : ''}" title="${isActive ? 'Active playlist (for Next book)' : 'Set as active playlist'}"></button>
                <span class="folder-name">${escapeHtml(p.title || pid)}</span>
                <button class="pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin to top'}">${isPinned ? '★' : '☆'}</button>
                <span class="folder-count">${(p.books || []).length}</span>
                <button class="folder-del" title="Delete playlist">×</button>
            `;
            folder.appendChild(row);

            const grid = document.createElement('div');
            grid.className = 'grid';
            renderGrid(grid, p.books, latest, curBook, pid);
            folder.appendChild(grid);

            row.addEventListener('click', (e) => {
                const cls = e.target.classList;
                if (cls.contains('pin-btn') || cls.contains('active-dot') || cls.contains('folder-del')) return;
                const wasOpen = folder.classList.contains('open');
                folder.classList.toggle('open', !wasOpen);
                state.expanded[pid] = !wasOpen;
                writeState(state);
            });

            armConfirm(row.querySelector('.folder-del'), async () => {
                try {
                    await deletePlaylistRemote(pid);
                    localStorage.removeItem(LIST_CACHE_KEY);
                    await syncPlaylists(true);
                    await refresh();
                } catch (err) {
                    showToast('Delete failed: ' + err.message);
                }
            });

            row.querySelector('.pin-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const set = new Set(state.pinned);
                if (set.has(pid)) set.delete(pid); else set.add(pid);
                state.pinned = Array.from(set);
                writeState(state);
                render(data);
            });

            row.querySelector('.active-dot').addEventListener('click', (e) => {
                e.stopPropagation();
                const current = localStorage.getItem(ACTIVE_KEY);
                if (current === pid) {
                    localStorage.removeItem(ACTIVE_KEY);
                } else {
                    localStorage.setItem(ACTIVE_KEY, pid);
                }
                render(data);
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

    window.addEventListener('keydown', (e) => {
        if (e.target && e.target.matches && e.target.matches('input, textarea, [contenteditable="true"]')) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key !== 'ö') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        (async () => {
            const next = await pickNextBook();
            if (!next) return;
            if (next.playlistId) localStorage.setItem(ACTIVE_KEY, next.playlistId);
            location.href = next.url;
        })();
    }, true);

    (async () => {
        await refresh();
        await syncPlaylists(false);
        await refresh();
    })();
})();
