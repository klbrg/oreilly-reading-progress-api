// Runs on https://learning.oreilly.com/playlists/<id>/
// Fetches the user's collections, finds this one, redirects the tab to the
// most-recently-read book in it (or the first book).

(function () {
    'use strict';

    const {
        OREILLY, getData, savePlaylist,
        listUserCollections, isbnsFromCollection, collectionSkeleton,
    } = window.OReillyAPI;

    const m = location.pathname.match(/\/playlists\/([^/]+)/);
    if (!m) return;
    const playlistId = m[1];

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

    function latestByBook(storage) {
        const map = new Map();
        for (const key of Object.keys(storage || {})) {
            const e = storage[key];
            const bid = bookIdFromLibraryUrl(e.url);
            if (!bid) continue;
            const prev = map.get(bid);
            if (!prev || new Date(e.date) > new Date(prev.date)) map.set(bid, e);
        }
        return map;
    }

    async function main() {
        const colls = await listUserCollections();
        const coll = colls.find(c => c.id === playlistId);
        if (!coll) {
            console.warn('[Playlist] Collection not found for id', playlistId);
            return;
        }

        const isbns = isbnsFromCollection(coll);
        if (isbns.length === 0) {
            console.warn('[Playlist] No books in collection.');
            return;
        }

        try {
            const skel = collectionSkeleton(coll);
            await savePlaylist(playlistId, skel);
        } catch (err) {
            console.warn('[Playlist] Failed to persist skeleton:', err);
        }

        let storage = {};
        try { storage = (await getData()).storage || {}; } catch {}
        const latest = latestByBook(storage);

        let target = null;
        let bestDate = null;
        for (const isbn of isbns) {
            const entry = latest.get(isbn);
            if (entry && (!bestDate || new Date(entry.date) > bestDate)) {
                bestDate = new Date(entry.date);
                target = entry.url;
            }
        }
        if (!target) target = `${OREILLY}/library/view/-/${isbns[0]}/`;

        try { localStorage.setItem('oreilly-reader-active-playlist', playlistId); } catch {}
        console.log('[Playlist] Redirecting to', target);
        location.replace(target);
    }

    main();
})();
