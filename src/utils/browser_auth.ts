import http from 'http';
import crypto from 'crypto';
import {SUCCESS_HTML, ERROR_HTML} from './auth_pages';

const BASE = process.env.BD_BASE || 'https://brightdata.com/users';
const AUTHORIZE_URL = `${BASE}/auth/cli/authorize`;
const TOKEN_URL = `${BASE}/auth/cli/token`;
const DEVICE_START = `${BASE}/auth/cli/device/start`;
const DEVICE_TOKEN = `${BASE}/auth/cli/device/token`;

type Browser_auth_opts = {
    customer_id: string;
};

type Json_value =
    | string
    | number
    | boolean
    | null
    | Json_value[]
    | {[key: string]: Json_value};

type Json_object = {[key: string]: Json_value};

type Open_fn = (typeof import('open'))['default'];

type Device_start_response = {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
    error?: string;
    error_description?: string;
} & Json_object;

type Device_token_response = {
    api_key?: string;
    error?: string;
    error_description?: string;
} & Json_object;

type Token_response = {
    api_key?: string;
    error?: string;
    error_description?: string;
} & Json_object;

const sleep = (ms: number)=>new Promise(resolve=>setTimeout(resolve, ms));

const base64url = (buf: Buffer): string=>Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const random_b64url = (bytes = 32): string=>base64url(crypto.randomBytes(bytes));

const sha256_b64url = (input: string): string=>
    base64url(crypto.createHash('sha256').update(input).digest());

const once = <T extends (...args: never[])=>void>(fn: T): T=>{
    let called = false;
    return ((...args: Parameters<T>)=>{
        if (called)
            return;
        called = true;
        fn(...args);
    }) as T;
};

let open_promise: Promise<Open_fn>|undefined;

const load_open = (): Promise<Open_fn>=>{
    if (!open_promise)
    {
        const dynamic_import = new Function(
            'specifier',
            'return import(specifier);'
        ) as (specifier: string)=>Promise<{default: Open_fn}>;
        open_promise = dynamic_import('open').then(mod=>mod.default);
    }
    return open_promise;
};

const format_remote_error = (
    fallback: string,
    payload: Json_object|undefined
): string=>{
    if (!payload)
        return fallback;
    const error = typeof payload.error == 'string' ? payload.error : undefined;
    const desc = typeof payload.error_description == 'string'
        ? payload.error_description
        : undefined;
    if (error && desc)
        return `${fallback}: ${error} ${desc}`;
    if (error)
        return `${fallback}: ${error}`;
    if (desc)
        return `${fallback}: ${desc}`;
    return fallback;
};

const read_json = async(res: Response): Promise<Json_object|undefined>=>{
    const text = await res.text();
    if (!text)
        return undefined;
    try {
        const parsed = JSON.parse(text) as Json_value;
        if (parsed && typeof parsed == 'object' && !Array.isArray(parsed))
            return parsed as Json_object;
    } catch(_e) {}
    return {raw: text};
};

const post_json = async<T extends Json_object>(
    url: string,
    body: Json_object
): Promise<{status: number; json: T|undefined}>=>{
    const res = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
        redirect: 'manual',
    });
    return {status: res.status, json: await read_json(res) as T|undefined};
};

const ensure_api_key = (
    payload: Json_object|undefined,
    context: string
): string=>{
    const api_key = payload?.api_key;
    if (typeof api_key == 'string' && api_key.trim())
        return api_key;
    throw new Error(format_remote_error(
        `${context}: missing api_key in response`,
        payload
    ));
};

const open_browser = async(url: string)=>{
    try {
        const open = await load_open();
        await open(url, {wait: false});
    } catch(_e) {
        console.error('Could not open a browser automatically.');
        console.error(`Open this URL manually:\n${url}`);
    }
};

const close_server = async(server: http.Server)=>{
    if (!server.listening)
        return;
    await new Promise<void>((resolve, reject)=>{
        server.close(err=>err ? reject(err) : resolve());
    });
};

const listen = async(server: http.Server): Promise<number>=>{
    await new Promise<void>((resolve, reject)=>{
        const on_error = (err: Error)=>{
            server.off('listening', on_listening);
            reject(err);
        };
        const on_listening = ()=>{
            server.off('error', on_error);
            resolve();
        };
        server.once('error', on_error);
        server.once('listening', on_listening);
        server.listen(0, '127.0.0.1');
    });
    const address = server.address();
    if (!address || typeof address == 'string')
        throw new Error('Failed to determine loopback port');
    return address.port;
};

const send_html = (
    res: http.ServerResponse,
    status: number,
    html: string
)=>{
    res.writeHead(status, {'content-type': 'text/html; charset=utf-8'});
    res.end(html);
};

const send_text = (
    res: http.ServerResponse,
    status: number,
    text: string
)=>{
    res.writeHead(status, {'content-type': 'text/plain; charset=utf-8'});
    res.end(text);
};

async function loopback_flow(opts: Browser_auth_opts): Promise<string> {
    const customer_id = opts.customer_id.trim();
    const state = random_b64url(24);
    const code_verifier = random_b64url(32);
    const code_challenge = sha256_b64url(code_verifier);

    let resolve_code: ((code: string)=>void)|undefined;
    let reject_code: ((error: Error)=>void)|undefined;
    const code_promise = new Promise<string>((resolve, reject)=>{
        resolve_code = resolve;
        reject_code = reject;
    });

    const server = http.createServer();
    const finish = once((error?: Error, code?: string)=>{
        void close_server(server).catch(()=>undefined);
        if (error)
            reject_code?.(error);
        else if (code)
            resolve_code?.(code);
        else
            reject_code?.(new Error('Authorization flow finished without a code'));
    });

    server.on('request', (req, res)=>{
        try {
            const req_url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (req_url.pathname != '/callback')
            {
                send_text(res, 404, 'Not found');
                return;
            }

            const error = req_url.searchParams.get('error');
            const error_description = req_url.searchParams.get('error_description');
            const code = req_url.searchParams.get('code');
            const returned_state = req_url.searchParams.get('state');

            if (error)
            {
                const message = error_description
                    ? `${error} ${error_description}`
                    : error;
                send_html(res, 200, ERROR_HTML(message));
                finish(new Error(`Authorization failed: ${message}`));
                return;
            }
            if (!code)
            {
                send_html(res, 400, ERROR_HTML('Missing "code" in callback'));
                finish(new Error('Missing "code" in callback'));
                return;
            }
            if (!returned_state)
            {
                send_html(res, 400, ERROR_HTML('Missing "state" in callback'));
                finish(new Error('Missing "state" in callback'));
                return;
            }
            if (returned_state != state)
            {
                send_html(res, 400, ERROR_HTML('State mismatch'));
                finish(new Error('State mismatch'));
                return;
            }

            send_html(res, 200, SUCCESS_HTML);
            finish(undefined, code);
        } catch(e) {
            try {
                send_text(res, 500, 'Internal error');
            } catch(_ignored) {}
            finish(e as Error);
        }
    });

    const port = await listen(server);
    const redirect_uri = `http://127.0.0.1:${port}/callback`;

    const authorize_url = new URL(AUTHORIZE_URL);
    authorize_url.searchParams.set('redirect_uri', redirect_uri);
    authorize_url.searchParams.set('state', state);
    authorize_url.searchParams.set('code_challenge', code_challenge);
    authorize_url.searchParams.set('code_challenge_method', 'S256');
    authorize_url.searchParams.set('customer_id', customer_id);

    console.error('Opening browser for Bright Data authentication...');
    console.error(`If it does not open, visit:\n${authorize_url.toString()}`);
    await open_browser(authorize_url.toString());

    const timeout = setTimeout(()=>{
        finish(new Error('Timed out waiting for callback'));
    }, 2 * 60 * 1000);
    timeout.unref();

    try {
        const code = await code_promise;
        const {status, json} = await post_json<Token_response>(TOKEN_URL, {
            code,
            code_verifier,
            redirect_uri,
        });
        if (status >= 400)
        {
            throw new Error(format_remote_error(
                `Token exchange failed (HTTP ${status})`,
                json
            ));
        }
        return ensure_api_key(json, 'Token exchange failed');
    } finally {
        clearTimeout(timeout);
        await close_server(server).catch(()=>undefined);
    }
}

async function device_flow(opts: Browser_auth_opts): Promise<string> {
    const customer_id = opts.customer_id.trim();
    const {status, json} = await post_json<Device_start_response>(
        DEVICE_START,
        {customer_id}
    );
    if (status >= 400)
    {
        throw new Error(format_remote_error(
            `Device flow start failed (HTTP ${status})`,
            json
        ));
    }

    const device_code = json?.device_code;
    const user_code = json?.user_code;
    const verification_uri = json?.verification_uri;
    if (typeof device_code != 'string' || !device_code)
        throw new Error('Device flow start failed: missing device_code');
    if (typeof user_code != 'string' || !user_code)
        throw new Error('Device flow start failed: missing user_code');
    if (typeof verification_uri != 'string' || !verification_uri)
    {
        throw new Error(
            'Device flow start failed: missing verification_uri'
        );
    }

    let interval_seconds = typeof json?.interval == 'number' && json.interval > 0
        ? json.interval
        : 5;
    const expires_in = typeof json?.expires_in == 'number' && json.expires_in > 0
        ? json.expires_in
        : 15 * 60;
    const deadline = Date.now() + expires_in * 1000;

    console.error('Approve login in your browser:');
    console.error(`  Code: ${user_code}`);
    console.error(`  URL: ${verification_uri}`);

    while (Date.now() < deadline)
    {
        await sleep(interval_seconds * 1000);
        const response = await post_json<Device_token_response>(DEVICE_TOKEN, {
            device_code,
        });

        if (response.status < 400)
            return ensure_api_key(response.json, 'Device flow failed');

        const error = response.json?.error;
        if (error == 'authorization_pending')
            continue;
        if (error == 'slow_down')
        {
            interval_seconds += 5;
            continue;
        }

        throw new Error(format_remote_error(
            `Device flow failed (HTTP ${response.status})`,
            response.json
        ));
    }

    throw new Error('Timed out waiting for approval');
}

export {loopback_flow, device_flow};
