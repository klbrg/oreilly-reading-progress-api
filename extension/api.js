// Shared API client. Exposed as window.OReillyAPI so content scripts loaded
// after this one can use it.

(function () {
    'use strict';

    const API_URL = 'http://localhost:44433';
    const OREILLY = 'https://learning.oreilly.com';

    // --- FastAPI ---

    async function getData() {
        const res = await fetch(`${API_URL}/data`);
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'getData failed');
        return json.data || {};
    }

    async function saveProgress(storageKey, entry) {
        const res = await fetch(`${API_URL}/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storage: { [storageKey]: entry } }),
        });
        if (!res.ok) throw new Error(`saveProgress HTTP ${res.status}`);
        return res.json();
    }

    async function savePlaylist(playlistId, playlist) {
        const res = await fetch(`${API_URL}/playlists/${encodeURIComponent(playlistId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(playlist),
        });
        if (!res.ok) throw new Error(`savePlaylist HTTP ${res.status}`);
        return res.json();
    }

    // --- O'Reilly ---

    function pick(obj, ...names) {
        for (const n of names) {
            if (obj && obj[n] != null) return obj[n];
        }
        return undefined;
    }

    function absUrl(u) {
        if (!u) return null;
        return u.startsWith('http') ? u : `${OREILLY}${u}`;
    }

    async function tryJson(urls) {
        for (const url of urls) {
            try {
                const res = await fetch(url, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' },
                });
                if (res.ok) {
                    const json = await res.json();
                    return json;
                }
                console.log('[OReillyAPI]', url, 'returned', res.status);
            } catch (err) {
                console.warn('[OReillyAPI] fetch failed for', url, err);
            }
        }
        return null;
    }

    async function listUserCollections() {
        const raw = await tryJson([`${OREILLY}/api/v3/collections/`]);
        return Array.isArray(raw) ? raw : [];
    }

    function itemsFromCollection(coll) {
        const items = (coll.content || [])
            .filter(c => c.content_type === 'PLATFORM_CONTENT' && typeof c.ourn === 'string')
            .sort((a, b) => (b.index || 0) - (a.index || 0));
        return items.map(c => {
            const m = c.ourn.match(/^urn:orm:([^:]+):(.+)$/);
            if (!m) return null;
            return {
                isbn: m[2],
                type: m[1],
                itemId: c.id,
                ourn: c.ourn,
            };
        }).filter(Boolean);
    }

    function isbnsFromCollection(coll) {
        return itemsFromCollection(coll).map(i => i.isbn);
    }

    function contentUrl(id, type) {
        if (type === 'video') return `${OREILLY}/course/-/${id}/`;
        return `${OREILLY}/library/view/-/${id}/`;
    }

    // --- mutations ---

    function getCsrfToken() {
        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? m[1] : null;
    }

    async function mutate(url, method, body) {
        const headers = {
            'Accept': 'application/json',
            'Origin': OREILLY,
            'Referer': `${OREILLY}/`,
        };
        const csrf = getCsrfToken();
        if (csrf) headers['X-CSRFToken'] = csrf;
        const opts = { method, credentials: 'include', headers };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`);
        }
        const txt = await res.text();
        return txt ? JSON.parse(txt) : null;
    }

    async function createPlaylist(name) {
        return mutate(`${OREILLY}/api/v3/collections/`, 'POST', {
            name, description: '', sharing: 'private',
        });
    }

    async function deletePlaylistRemote(pid) {
        return mutate(`${OREILLY}/api/v3/collections/${encodeURIComponent(pid)}/`, 'DELETE');
    }

    async function addBooksToPlaylist(pid, isbns) {
        const content = isbns.map(i => `/api/v1/book/${i}/`);
        return mutate(
            `${OREILLY}/api/v3/collections/${encodeURIComponent(pid)}/add-content/`,
            'POST',
            { content }
        );
    }

    async function removeCollectionItem(itemId) {
        return mutate(`${OREILLY}/api/v3/collection-items/${encodeURIComponent(itemId)}/`, 'DELETE');
    }

    async function reorderPlaylistBooks(pid, ourns) {
        return mutate(
            `${OREILLY}/api/v3/collections/${encodeURIComponent(pid)}/reorder-content-ourns/`,
            'POST',
            { content: [ourns] }
        );
    }

    async function fetchBookMeta(isbn, type = 'book') {
        const raw = await tryJson([
            `${OREILLY}/api/v2/epubs/urn:orm:${type}:${encodeURIComponent(isbn)}/`,
            `${OREILLY}/api/v2/epubs/urn:orm:book:${encodeURIComponent(isbn)}/`,
        ]);
        const title = raw ? (pick(raw, 'title', 'name') || String(isbn)) : String(isbn);
        return {
            id: String(isbn),
            title,
            cover: `${OREILLY}/library/cover/${isbn}/400w/`,
            url: contentUrl(isbn, type),
            type,
        };
    }

    function collectionTitle(coll) { return coll.name || coll.title || 'Untitled playlist'; }

    // --- next-book picker (used by reader and sidebar) ---

    const CURRENTLY_READING_KEY = 'oreilly-reader-currently-reading';

    function getCurrentlyReading() {
        try { return JSON.parse(localStorage.getItem(CURRENTLY_READING_KEY)) || []; }
        catch { return []; }
    }
    function setCurrentlyReading(ids) {
        try { localStorage.setItem(CURRENTLY_READING_KEY, JSON.stringify(ids)); } catch {}
    }
    function addToCurrentlyReading(bookId) {
        if (!bookId) return;
        const list = getCurrentlyReading();
        if (!list.includes(bookId)) {
            list.push(bookId);
            setCurrentlyReading(list);
        }
    }
    function removeFromCurrentlyReading(bookId) {
        if (!bookId) return;
        const list = getCurrentlyReading();
        const idx = list.indexOf(bookId);
        if (idx >= 0) {
            list.splice(idx, 1);
            setCurrentlyReading(list);
        }
    }
    function isCurrentlyReading(bookId) {
        return getCurrentlyReading().includes(bookId);
    }

    function bookIdFromUrl(url) {
        try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            const i = parts.indexOf('view');
            return i >= 0 && parts[i + 2] ? parts[i + 2] : null;
        } catch {
            return null;
        }
    }

    function latestByBook(storage) {
        const map = new Map();
        for (const key of Object.keys(storage || {})) {
            const e = storage[key];
            const bid = bookIdFromUrl(e.url);
            if (!bid) continue;
            const prev = map.get(bid);
            if (!prev || new Date(e.date) > new Date(prev.date)) map.set(bid, e);
        }
        return map;
    }

    async function nextCandidates() {
        const ids = getCurrentlyReading();
        if (!ids.length) return [];
        let data;
        try { data = await getData(); } catch { return []; }
        const playlists = data.playlists || {};
        const storage = data.storage || {};
        const curBook = bookIdFromUrl(location.href);

        const bookIndex = new Map();
        for (const p of Object.values(playlists)) {
            for (const b of (p.books || [])) {
                if (!bookIndex.has(b.id)) bookIndex.set(b.id, { ...b, playlistId: p.id });
            }
        }

        const latest = latestByBook(storage);
        const n = ids.length;
        const curIdx = ids.indexOf(curBook);
        const ordered = [];
        for (let offset = 1; offset <= n; offset++) {
            const idx = ((curIdx >= 0 ? curIdx : -1) + offset + n) % n;
            const id = ids[idx];
            if (id === curBook) continue;
            const b = bookIndex.get(id);
            if (!b) continue;
            const entry = latest.get(b.id);
            ordered.push({
                bookId: b.id,
                url: entry?.url || b.url,
                title: b.title,
                playlistId: b.playlistId,
            });
        }
        return ordered;
    }

    async function pickNextBook() {
        const list = await nextCandidates();
        return list[0] || null;
    }

    function collectionSkeleton(coll) {
        return {
            id: coll.id,
            title: collectionTitle(coll),
            url: `${OREILLY}/playlists/${coll.id}/`,
            last_opened: new Date().toISOString(),
            books: [],
        };
    }

    window.OReillyAPI = {
        API_URL,
        OREILLY,
        CURRENTLY_READING_KEY,
        getCurrentlyReading,
        addToCurrentlyReading,
        removeFromCurrentlyReading,
        isCurrentlyReading,
        getData,
        saveProgress,
        savePlaylist,
        listUserCollections,
        itemsFromCollection,
        isbnsFromCollection,
        fetchBookMeta,
        collectionSkeleton,
        collectionTitle,
        createPlaylist,
        deletePlaylistRemote,
        addBooksToPlaylist,
        removeCollectionItem,
        reorderPlaylistBooks,
        bookIdFromUrl,
        latestByBook,
        pickNextBook,
        nextCandidates,
    };
})();
