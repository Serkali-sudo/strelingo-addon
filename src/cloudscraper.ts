// ---------------------------------------------------------------------------
// A tiny, dependency-free "cloudscraper-style" fetch.
//
// It ports the ONE part of the classic `cloudscraper` package that is both
// portable to our runtimes (Node / Cloudflare Workers / Vercel) and relevant to
// a plain Cloudflare 403: mimicking a real browser's header profile so the WAF's
// UA/header heuristics let the request through.
//
// It deliberately does NOT try to solve JS / Turnstile challenges. cloudscraper's
// solver targets the 2019-era `jschl-answer` challenge (see the original
// index.js), which Cloudflare retired years ago, needs Node's `vm` module (absent
// on edge runtimes), and only fires on an actual challenge *page* — not a hard
// 403 block. If Cloudflare is fingerprinting the server's IP or TLS handshake,
// no pure-fetch trick can help; this just maximizes the header-based odds.
// ---------------------------------------------------------------------------

interface BrowserProfile {
    ua: string;
    secChUa: string;
    platform: string;
}

// Current-ish Chrome profiles. Unlike cloudscraper's ancient UA list, these are
// modern versions with matching client hints — old Chrome UAs get *more* scrutiny.
const BROWSER_PROFILES: BrowserProfile[] = [
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        secChUa: '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        platform: '"Windows"'
    },
    {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        secChUa: '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        platform: '"macOS"'
    },
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        secChUa: '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
        platform: '"Windows"'
    },
    {
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        secChUa: '"Google Chrome";v="126", "Chromium";v="126", "Not.A/Brand";v="24"',
        platform: '"Linux"'
    }
];

function pickProfile(): BrowserProfile {
    return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

// Build the header set a real Chrome sends on a top-level navigation — which is
// exactly what happens (and works) when you paste the API URL into the browser.
function browserNavigationHeaders(profile: BrowserProfile): Record<string, string> {
    return {
        'User-Agent': profile.ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'sec-ch-ua': profile.secChUa,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': profile.platform,
        'Cache-Control': 'max-age=0'
    };
}

// Minimal in-memory cookie jar (per host). Lets a cf_clearance / session cookie
// survive across the calls we make in a single worker lifetime.
const cookieJar = new Map<string, Map<string, string>>();

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return '';
    }
}

function readSetCookies(response: Response): string[] {
    const anyHeaders = response.headers as any;
    if (typeof anyHeaders.getSetCookie === 'function') {
        return anyHeaders.getSetCookie();
    }
    const raw = response.headers.get('set-cookie');
    return raw ? [raw] : [];
}

function storeCookies(host: string, response: Response): void {
    const setCookies = readSetCookies(response);
    if (setCookies.length === 0) return;
    const jar = cookieJar.get(host) || new Map<string, string>();
    for (const cookie of setCookies) {
        const first = cookie.split(';')[0];
        const eq = first.indexOf('=');
        if (eq > 0) {
            jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
        }
    }
    cookieJar.set(host, jar);
}

function cookieHeader(host: string): string | undefined {
    const jar = cookieJar.get(host);
    if (!jar || jar.size === 0) return undefined;
    return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Detect whether a response body is a Cloudflare challenge (as opposed to a hard
// block). Purely informational — we can't solve modern challenges, but logging
// the difference tells us whether the 403 is even theoretically bypassable.
export function describeCloudflareBlock(status: number, body: string): string | null {
    if (status !== 403 && status !== 503 && status !== 429) return null;
    const b = body || '';
    if (b.includes('jschl-answer') || b.includes('/cdn-cgi/l/chk_jschl')) {
        return 'legacy-iuam-challenge (2019-era; retired by Cloudflare)';
    }
    if (b.includes('cf_chl_opt') || b.includes('turnstile') || b.includes('challenge-platform') || b.includes('Just a moment')) {
        return 'modern-managed-challenge (Turnstile — needs a real browser)';
    }
    if (b.includes('error code: 1020') || /Access denied/i.test(b) || b.includes('cf-error-details')) {
        return 'hard-waf-block (IP/rule based — no challenge to solve)';
    }
    return 'unknown (no recognizable Cloudflare challenge markers)';
}

export interface CloudscraperInit {
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
}

// Browser-mimicking fetch. Caller headers (Authorization / X-API-Key / etc.)
// override the browser defaults. Sends stored cookies for the host.
export async function cloudscraperFetch(url: string, init: CloudscraperInit = {}): Promise<Response> {
    const host = hostOf(url);
    const profile = pickProfile();
    const headers: Record<string, string> = {
        ...browserNavigationHeaders(profile),
        ...(init.headers || {})
    };

    const cookies = cookieHeader(host);
    if (cookies && !headers['Cookie'] && !headers['cookie']) {
        headers['Cookie'] = cookies;
    }

    const response = await fetch(url, {
        method: init.method || 'GET',
        headers,
        redirect: 'follow',
        signal: init.signal
    });

    if (host) storeCookies(host, response);
    return response;
}
