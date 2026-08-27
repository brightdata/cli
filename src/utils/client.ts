import {load as load_config} from './config';
import {dim} from './output';

const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS_DEFAULT = 16_000;
// Bounds a black-holed connection (VPN drop, hung load balancer), which would
// otherwise hang forever: fetch() has no default timeout, and no error ever
// arrives for the retry loop to react to. Deliberately generous — it must not
// cut off slow-but-alive work (protected-site scrapes, large snapshot bodies).
// Per-request override via Request_opts.timeout_ms.
const REQUEST_TIMEOUT_MS = 120_000;
// A timed-out attempt is retried at most this many times. Retries multiply the
// user-visible wait (timeout x attempts), so the generic retry budget is not
// reused here: 3 retries would mean an 8-minute silent stall.
const TIMEOUT_MAX_RETRIES = 1;

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

type Retry_event = {
    attempt: number;
    max_attempts: number;
    delay_ms: number;
    status: number;
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
    timeout_ms?: number;
};

type Api_error = {
    status: number;
    message: string;
    hint?: string;
};

// What the server actually said. request() returns only the body (the shape
// almost every call site wants); callers that must reason about the protocol
// itself — e.g. "is this snapshot still building?" (HTTP 202) vs "this is the
// data" (200) — use get_with_status rather than guess from body shape.
type Response_envelope<T = unknown> = {
    status: number;
    headers: Headers;
    body: T;
};

// Errors the client itself formatted from an API response, as opposed to
// network-level failures. The retry loop needs to tell those apart: API errors
// are final, network errors are retryable. This used to be decided by testing
// whether the message started with 'Error:', which coupled retry semantics to
// message wording — rewording a template silently changed behavior.
class Client_api_error extends Error {
    status: number;
    hint?: string;
    constructor(message: string, status: number, hint?: string){
        super(message);
        this.name = 'Client_api_error';
        this.status = status;
        this.hint = hint;
    }
}

const is_timeout_error = (e: unknown): boolean=>
    e instanceof Error && (e.name == 'TimeoutError' || e.name == 'AbortError');

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

const compute_backoff = (
    attempt: number,
    base_ms: number,
    max_ms: number
): number=>{
    const exp = Math.min(base_ms * 2 ** attempt, max_ms);
    const jitter = exp * 0.5 * Math.random();
    return Math.floor(exp / 2 + jitter);
};

const request_core = async<T = unknown>(
    api_key: string,
    endpoint: string,
    opts: Request_opts = {}
): Promise<Response_envelope<T>>=>{
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
    const timeout_ms = opts.timeout_ms ?? REQUEST_TIMEOUT_MS;
    let attempt = 0;
    let timeout_retries = 0;
    let start = opts.timing ? Date.now() : 0;
    while (attempt <= max_attempts)
    {
        try {
            // A fresh signal per attempt: AbortSignal.timeout starts counting
            // when created, so hoisting it would abort retries instantly.
            const res = await fetch(url, {
                ...fetch_opts,
                signal: AbortSignal.timeout(timeout_ms),
            });
            if (opts.timing)
            {
                console.error(`Timing: ${Date.now()-start}ms
                    (attempt ${attempt+1})`);
            }
            const brd_error = res.headers.get('x-brd-error')
                || res.headers.get('x-luminati-error');
            if (brd_error)
                throw new Client_api_error(`Error: ${brd_error}`, res.status);
            if (res.ok)
            {
                const envelope = {status: res.status, headers: res.headers};
                if (opts.raw_buffer)
                {
                    const buffer = Buffer.from(await res.arrayBuffer());
                    return {...envelope, body: buffer as unknown as T};
                }
                const content_type = res.headers.get('content-type') ?? '';
                if (content_type.includes('application/json'))
                    return {...envelope, body: await res.json() as T};
                return {...envelope, body: await res.text() as unknown as T};
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
            throw new Client_api_error(
                msg.join('\n'), api_err.status, api_err.hint);
        } catch(e) {
            if (e instanceof Client_api_error)
                throw e;
            const timed_out = is_timeout_error(e);
            if (timed_out && timeout_retries >= TIMEOUT_MAX_RETRIES)
            {
                throw new Error(
                    `Error: Request timed out after `
                    +`${Math.round(timeout_ms/1000)}s.\n`
                    +'  The server accepted the connection but sent no '
                    +'response. Check your connection and try again.'
                );
            }
            if (attempt < max_attempts)
            {
                if (timed_out)
                {
                    timeout_retries++;
                    console.error(dim(
                        `Request timed out after `
                        +`${Math.round(timeout_ms/1000)}s — retrying...`
                    ));
                }
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

const request = async<T = unknown>(
    api_key: string,
    endpoint: string,
    opts: Request_opts = {}
): Promise<T>=>(await request_core<T>(api_key, endpoint, opts)).body;

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

// Opt-in protocol-aware GET. Same request path as get(), but hands back the
// status code and headers alongside the body.
const get_with_status = <T = unknown>(
    api_key: string,
    endpoint: string,
    opts: Omit<Request_opts, 'method'> = {}
): Promise<Response_envelope<T>>=>
    request_core<T>(api_key, endpoint, {method: 'GET', ...opts});

export {request, post, get, get_with_status, Client_api_error, pick_hint,
    ERROR_HINTS, compute_backoff, RETRY_BASE_MS, RETRY_MAX_MS_DEFAULT,
    MAX_RETRIES, REQUEST_TIMEOUT_MS, TIMEOUT_MAX_RETRIES};
export type {Request_opts, Api_error, Body_hint, Retry_config, Retry_event,
    Response_envelope};
