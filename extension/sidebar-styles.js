// Shadow-DOM CSS for the sidebar. Imported by sidebar.js as a string.
(function () {
    'use strict';
    window.__oreillyReaderSidebar = window.__oreillyReaderSidebar || {};
    window.__oreillyReaderSidebar.styles = `
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
})();
