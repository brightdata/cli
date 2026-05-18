import {load as load_config} from './config';

const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS_DEFAULT = 16_000;

const ERROR_HINTS: Record<number, string> = {
    401: 'Invalid or expired API key. Run \'brightdata login\' to re-authenticate.',
    403: 'Access denied. Check your zone permissions in the control panel.',
    404: 'Resource not found. Check the URL or dataset type.',
    429: 'Rate limit exceeded. Wait a moment and try again.',
};

// Commands pass body-pattern overrides via Request_opts.hints; the
// client stays generic, consulting them before the ERROR_HINTS map.
type Body_hint = {pattern: RegExp; hint: string};

const pick_hint = (
    status: number,
    body: string,
    extra_hints?: Body_hint[]
): string|undefined=>{
    if (extra_hints)
    {
        for (const {pattern, hint} of extra_hints)
        {
            if (pattern.test(body))
                return hint;
        }
    }
    return ERROR_HINTS[status];
};

// Per-request retry override, for callers needing a longer backoff
// than the generic transient-error schedule.
type Retry_event = {
    attempt: number; // 1-based retry number about to be slept
    max_attempts: number;
    delay_ms: number;
    status: number; // 0 for a pre-response network error
};

type Retry_config = {
    max_attempts?: number;
    base_ms?: number;
    max_ms?: number;
    on_retry?: (e: Retry_event)=>void;
};

type Request_opts = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timing?: boolean;
    raw_buffer?: boolean;
    hints?: Body_hint[];
    retry?: Retry_config;
};

type Api_error = {
    status: number;
    message: string;
    hint?: string;
};

const sleep = (ms: number)=>new Promise(resolve=>setTimeout(resolve, ms));

const format_error = (
    status: number,
    detail: string,
    extra_hints?: Body_hint[]
): Api_error=>({
    status,
    message: detail,
    hint: pick_hint(status, detail, extra_hints),
});

// full-jitter exponential delay (∈ [exp/2, exp]) to spread herds of
// concurrent processes that all 429 on the same tick.
const compute_backoff = (
    attempt: number,
    base_ms: number,
    max_ms: number
): number=>{
    const exp = Math.min(base_ms * 2 ** attempt, max_ms);
    const jitter = exp * 0.5 * Math.random();
    return Math.floor(exp / 2 + jitter);
};

const request = async<T = unknown>(
    api_key: string,
    endpoint: string,
    opts: Request_opts = {}
): Promise<T>=>{
    const config = load_config();
    const base_url = config.api_url ?? 'https://api.brightdata.com';
    const url = endpoint.startsWith('http') ? endpoint : 
        `${base_url}${endpoint}`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'brightdata-cli',
        ...opts.headers,
    };
    const fetch_opts: RequestInit = {
        method: opts.method ?? 'GET',
        headers,
    };
    if (opts.body !== undefined)
        fetch_opts.body = JSON.stringify(opts.body);
    const max_attempts = opts.retry?.max_attempts ?? MAX_RETRIES;
    const base_ms = opts.retry?.base_ms ?? RETRY_BASE_MS;
    const max_ms = opts.retry?.max_ms ?? RETRY_MAX_MS_DEFAULT;
    let attempt = 0;
    let start = opts.timing ? Date.now() : 0;
    while (attempt <= max_attempts)
    {
        try {
            const res = await fetch(url, fetch_opts);
            if (opts.timing)
            {
                console.error(`Timing: ${Date.now()-start}ms
                    (attempt ${attempt+1})`);
            }
            const brd_error = res.headers.get('x-brd-error')
                || res.headers.get('x-luminati-error');
            if (brd_error)
                throw new Error(`Error: ${brd_error}`);
            if (res.ok)
            {
                if (opts.raw_buffer)
                    return Buffer.from(
                        await res.arrayBuffer()) as unknown as T;
                const content_type = res.headers.get('content-type') ?? '';
                if (content_type.includes('application/json'))
                    return await res.json() as T;
                return await res.text() as unknown as T;
            }
            if (TRANSIENT_STATUSES.includes(res.status) &&
                attempt < max_attempts)
            {
                const delay = compute_backoff(attempt, base_ms, max_ms);
                opts.retry?.on_retry?.({
                    attempt: attempt + 1,
                    max_attempts,
                    delay_ms: delay,
                    status: res.status,
                });
                await sleep(delay);
                attempt++;
                continue;
            }
            let detail = `HTTP ${res.status}`;
            try {
                const err_body = await res.text();
                if (err_body)
                    detail = err_body;
            } catch(_e) {}
            const api_err = format_error(res.status, detail, opts.hints);
            const msg = [
                `Error: ${api_err.message}`,
                `  Status: ${api_err.status}`,
            ];
            if (api_err.hint)
                msg.push(`  Hint: ${api_err.hint}`);
            throw new Error(msg.join('\n'));
        } catch(e) {
            if (e instanceof Error && e.message.startsWith('Error:'))
                throw e;
            if (attempt < max_attempts)
            {
                const delay = compute_backoff(attempt, base_ms, max_ms);
                opts.retry?.on_retry?.({
                    attempt: attempt + 1,
                    max_attempts,
                    delay_ms: delay,
                    status: 0,
                });
                await sleep(delay);
                attempt++;
                continue;
            }
            throw new Error(
                `Error: Network request failed — ${(e as Error).message}\n`
                +'  Check your internet connection and try again.'
            );
        }
    }
    throw new Error('Error: Max retries exceeded.');
};

const post = <T = unknown>(
    api_key: string,
    endpoint: string,
    body: unknown,
    opts: Omit<Request_opts, 'method'|'body'> = {}
): Promise<T>=>request<T>(api_key, endpoint, {method: 'POST', body, ...opts});

const get = <T = unknown>(
    api_key: string,
    endpoint: string,
    opts: Omit<Request_opts, 'method'> = {}
): Promise<T>=>request<T>(api_key, endpoint, {method: 'GET', ...opts});

export {request, post, get, pick_hint, ERROR_HINTS, compute_backoff,
    RETRY_BASE_MS, RETRY_MAX_MS_DEFAULT, MAX_RETRIES};
export type {Request_opts, Api_error, Body_hint, Retry_config, Retry_event};
