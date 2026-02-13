// Mobile Adapter
// Used when running Clara outside Electron (e.g. iPad/Capacitor/PWA).
// Rewrites relative API routes to a configurable backend base URL.

(function () {
    'use strict';

    const originalFetch = window.fetch.bind(window);
    const API_BASE_KEY = 'clara_api_base_url';
    const DEFAULT_API_BASE = 'https://api.your-clara-domain.com';
    const RELATIVE_URL_PATTERN = /^\/(?!\/)/;
    const STATE_KEY = 'clara_first_launch_complete';

    function normalizeBase(url) {
        if (!url || typeof url !== 'string') return DEFAULT_API_BASE;
        return url.endsWith('/') ? url.slice(0, -1) : url;
    }

    function getApiBaseUrl() {
        const fromStorage = localStorage.getItem(API_BASE_KEY);
        const fromGlobal = typeof window.CLARA_API_BASE_URL === 'string' ? window.CLARA_API_BASE_URL : '';
        return normalizeBase(fromStorage || fromGlobal || DEFAULT_API_BASE);
    }

    function setApiBaseUrl(url) {
        const normalized = normalizeBase(url);
        localStorage.setItem(API_BASE_KEY, normalized);
        return normalized;
    }

    function firstLaunchStatusFromLocal() {
        const completed = localStorage.getItem(STATE_KEY) === 'true';
        return {
            is_first_launch: !completed,
            has_base_model: true,
            base_model: {
                id: 'cloud',
                name: 'Cloud AI',
                size_mb: 0
            }
        };
    }

    window.fetch = async function (input, init) {
        let url = typeof input === 'string' ? input : input?.url || '';
        const method = (init?.method || 'GET').toUpperCase();

        if (url === '/first-launch-status' && method === 'GET') {
            return new Response(JSON.stringify(firstLaunchStatusFromLocal()), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (url === '/mark-first-launch-complete' && method === 'POST') {
            localStorage.setItem(STATE_KEY, 'true');
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (typeof input === 'string' && RELATIVE_URL_PATTERN.test(input)) {
            url = `${getApiBaseUrl()}${input}`;
            return originalFetch(url, init);
        }

        if (input instanceof Request && RELATIVE_URL_PATTERN.test(input.url)) {
            const rewritten = new Request(`${getApiBaseUrl()}${new URL(input.url).pathname}${new URL(input.url).search}`, input);
            return originalFetch(rewritten, init);
        }

        return originalFetch(input, init);
    };

    window.ClaraMobile = {
        getApiBaseUrl,
        setApiBaseUrl
    };

    console.log('[MobileAdapter] Initialized with API base:', getApiBaseUrl());
})();
