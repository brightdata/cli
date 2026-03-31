import {load as load_config} from './config';

const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

const ERROR_HINTS: Record<number, string> = {
    401: 'Invalid or expired API key. Run \'brightdata login\' to re-authenticate.',
    403: 'Access denied. Check your zone permissions in the control panel.',
    404: 'Resource not found. Check the URL or dataset type.',
    429: 'Rate limit exceeded. Wait a moment and try again.',
};

type Request_opts = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timing?: boolean;
    raw_buffer?: boolean;
};

type Api_error = {
    status: number;
    message: string;
    hint?: string;
};

const sleep = (ms: number)=>new Promise(resolve=>setTimeout(resolve, ms));

const format_error = (status: number, detail: string): Api_error=>({
    status,
    message: detail,
    hint: ERROR_HINTS[status],
});

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
    let attempt = 0;
    let start = opts.timing ? Date.now() : 0;
    while (attempt <= MAX_RETRIES)
    {
        try {
            const res = await fetch(url, fetch_opts);
            if (opts.timing)
            {
                console.error(`Timing: ${Date.now()-start}ms 
                    (attempt ${attempt+1})`);
            }
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
                attempt < MAX_RETRIES)
            {
                const delay = RETRY_BASE_MS * 2**attempt;
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
            const api_err = format_error(res.status, detail);
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
            if (attempt < MAX_RETRIES)
            {
                const delay = RETRY_BASE_MS * 2**attempt;
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

export {request, post, get};
export type {Request_opts, Api_error};
