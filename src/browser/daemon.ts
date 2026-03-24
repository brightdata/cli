import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {chromium} from 'playwright-core';
import {clear_connection_state, ensure_connected as ensure_browser_connected} from './connection';
import {parse_daemon_request} from './ipc';
import type {
    Browser,
    BrowserContext,
    Page,
    Request as Playwright_request,
    Response as Playwright_response,
} from 'playwright-core';

const DEFAULT_SESSION_NAME = 'default';
const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 600_000;
const KEEPALIVE_INTERVAL = 30_000;
const MAX_TRACKED_REQUESTS = 200;
const WINDOWS_PORT_BASE = 49_152;
const WINDOWS_PORT_SPAN = 16_383;

type Json_object = Record<string, unknown>;

type Tracked_request = {
    method: string;
    url: string;
    status?: number;
};

type Daemon_request = {
    id: string;
    action: string;
    params?: Json_object;
};

type Daemon_response = {
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
};

type Daemon_state = {
    browser: Browser|null;
    page: Page|null;
    connected: boolean;
    dom_refs: Map<string, string>;
    requests: Map<string, Tracked_request>;
    cdp_endpoint: string;
    session_name: string;
    idle_timer: NodeJS.Timeout|null;
    keepalive_timer: NodeJS.Timeout|null;
};

type Unix_transport = {
    kind: 'unix';
    base_dir: string;
    pid_path: string;
    socket_path: string;
};

type Tcp_transport = {
    kind: 'tcp';
    base_dir: string;
    host: '127.0.0.1';
    pid_path: string;
    port: number;
    port_path: string;
};

type Daemon_transport = Unix_transport|Tcp_transport;

type Path_opts = {
    daemon_dir?: string;
    env?: NodeJS.ProcessEnv;
    home_dir?: string;
    platform?: NodeJS.Platform;
};

type Browser_daemon_opts = {
    cdp_endpoint: string;
    session_name?: string;
    idle_timeout_ms?: number;
    daemon_dir?: string;
    env?: NodeJS.ProcessEnv;
    home_dir?: string;
};

type Browser_daemon_deps = {
    clear_interval?: typeof clearInterval;
    clear_timeout?: typeof clearTimeout;
    connect_over_cdp?: (cdp_endpoint: string)=>Promise<Browser>;
    create_server?: (listener?: (socket: net.Socket)=>void)=>net.Server;
    pid?: ()=>number;
    set_interval?: typeof setInterval;
    set_timeout?: typeof setTimeout;
};

const is_object = (value: unknown): value is Json_object=>{
    return !!value && typeof value == 'object' && !Array.isArray(value);
};

const get_path_api = (platform: NodeJS.Platform)=>
    platform == 'win32' ? path.win32 : path.posix;

const format_error = (error: unknown): string=>{
    if (error instanceof Error)
        return error.message;
    return String(error);
};

const normalize_session_name = (session_name: string|undefined): string=>{
    const normalized = (session_name ?? DEFAULT_SESSION_NAME).trim();
    if (!normalized)
        throw new Error('Browser session name cannot be empty.');
    if (!/^[A-Za-z0-9._-]+$/.test(normalized))
    {
        throw new Error(
            'Browser session name may contain only letters, numbers, dots, '
            +'underscores, and hyphens.'
        );
    }
    return normalized;
};

const normalize_idle_timeout = (idle_timeout_ms: number|undefined): number=>{
    if (idle_timeout_ms === undefined)
        return DEFAULT_DAEMON_IDLE_TIMEOUT_MS;
    if (!Number.isFinite(idle_timeout_ms) || idle_timeout_ms < 0)
    {
        throw new Error(
            'Browser idle timeout must be a non-negative number of '
            +'milliseconds.'
        );
    }
    return Math.floor(idle_timeout_ms);
};

const parse_idle_timeout = (raw: string|undefined): number|undefined=>{
    const normalized = raw?.trim();
    if (!normalized)
        return undefined;
    return normalize_idle_timeout(Number(normalized));
};

const get_daemon_base_dir = (opts: Path_opts = {}): string=>{
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const home_dir = opts.home_dir ?? os.homedir();
    const path_api = get_path_api(platform);
    const daemon_dir = opts.daemon_dir?.trim();
    const env_daemon_dir = env['BRIGHTDATA_DAEMON_DIR']?.trim();

    if (daemon_dir)
        return daemon_dir;
    if (env_daemon_dir)
        return env_daemon_dir;
    if (platform == 'darwin')
    {
        return path_api.join(
            home_dir,
            'Library',
            'Application Support',
            'brightdata-cli'
        );
    }
    if (platform == 'win32')
        return path_api.join(home_dir, 'AppData', 'Roaming', 'brightdata-cli');

    const runtime_dir = env['XDG_RUNTIME_DIR']?.trim();
    if (runtime_dir)
        return path_api.join(runtime_dir, 'brightdata-cli');
    return path_api.join(home_dir, '.brightdata-cli');
};

const get_port_for_session = (session_name: string): number=>{
    let hash = 0;
    for (let i=0; i<session_name.length; i++)
    {
        hash = ((hash<<5)-hash+session_name.charCodeAt(i)) | 0;
    }
    return WINDOWS_PORT_BASE + ((hash>>>0) % WINDOWS_PORT_SPAN);
};

const get_daemon_transport = (
    session_name: string,
    opts: Path_opts = {}
): Daemon_transport=>{
    const normalized_session = normalize_session_name(session_name);
    const platform = opts.platform ?? process.platform;
    const base_dir = get_daemon_base_dir({...opts, platform});
    const path_api = get_path_api(platform);
    const pid_path = path_api.join(base_dir,
        `${normalized_session}.pid`);

    if (platform == 'win32')
    {
        const port = get_port_for_session(normalized_session);
        return {
            kind: 'tcp',
            base_dir,
            host: '127.0.0.1',
            pid_path,
            port,
            port_path: path_api.join(base_dir,
                `${normalized_session}.port`),
        };
    }

    return {
        kind: 'unix',
        base_dir,
        pid_path,
        socket_path: path_api.join(base_dir,
            `${normalized_session}.sock`),
    };
};

class BrowserDaemon {
    readonly state: Daemon_state;
    private readonly active_contexts = new WeakSet<BrowserContext>();
    private readonly active_pages = new WeakSet<Page>();
    private readonly deps: Required<Browser_daemon_deps>;
    private readonly idle_timeout_ms: number;
    private readonly request_ids = new WeakMap<Playwright_request, string>();
    private readonly transport: Daemon_transport;
    private active_requests = 0;
    private request_counter = 0;
    private server: net.Server|null = null;
    private stop_promise: Promise<void>|null = null;

    constructor(
        opts: Browser_daemon_opts,
        deps: Browser_daemon_deps = {}
    ){
        const session_name = normalize_session_name(opts.session_name);
        const cdp_endpoint = opts.cdp_endpoint.trim();
        if (!cdp_endpoint)
            throw new Error('Browser daemon CDP endpoint cannot be empty.');

        this.idle_timeout_ms = normalize_idle_timeout(opts.idle_timeout_ms);
        this.transport = get_daemon_transport(session_name, {
            daemon_dir: opts.daemon_dir,
            env: opts.env,
            home_dir: opts.home_dir,
        });
        this.state = {
            browser: null,
            page: null,
            connected: false,
            dom_refs: new Map<string, string>(),
            requests: new Map<string, Tracked_request>(),
            cdp_endpoint,
            session_name,
            idle_timer: null,
            keepalive_timer: null,
        };
        this.deps = {
            clear_interval: clearInterval,
            clear_timeout: clearTimeout,
            connect_over_cdp: (endpoint: string)=>chromium.connectOverCDP(endpoint),
            create_server: net.createServer,
            pid: ()=>process.pid,
            set_interval: setInterval,
            set_timeout: setTimeout,
            ...deps,
        };
    }

    get_transport(): Daemon_transport {
        return this.transport;
    }

    is_running(): boolean {
        return this.server?.listening === true;
    }

    async start(): Promise<void> {
        if (this.server?.listening)
            return;

        fs.mkdirSync(this.transport.base_dir, {recursive: true});
        if (this.transport.kind == 'unix' &&
            fs.existsSync(this.transport.socket_path))
        {
            fs.rmSync(this.transport.socket_path, {force: true});
        }

        const server = this.deps.create_server(socket=>this.handle_socket(socket));
        this.server = server;

        try {
            await new Promise<void>((resolve, reject)=>{
                const on_error = (error: Error)=>{
                    server.off('listening', on_listening);
                    reject(error);
                };
                const on_listening = ()=>{
                    server.off('error', on_error);
                    resolve();
                };

                server.once('error', on_error);
                server.once('listening', on_listening);

                if (this.transport.kind == 'unix')
                    server.listen(this.transport.socket_path);
                else
                    server.listen(this.transport.port, this.transport.host);
            });

            fs.writeFileSync(this.transport.pid_path, `${this.deps.pid()}`);
            if (this.transport.kind == 'tcp')
            {
                fs.writeFileSync(this.transport.port_path,
                    `${this.transport.port}`);
            }
            this.schedule_idle_timer();
            this.start_keepalive();
        } catch(error) {
            this.server = null;
            this.cleanup_transport_files();
            try {
                server.close();
            } catch(_error) {}
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.stop_promise)
            return this.stop_promise;

        this.stop_promise = this.stop_internal();
        try {
            await this.stop_promise;
        } finally {
            this.stop_promise = null;
        }
    }

    async handle_request(request: Daemon_request): Promise<Daemon_response> {
        this.begin_activity();
        try {
            const data = await this.execute_request(request);
            return {id: request.id, success: true, data};
        } catch(error) {
            return {
                id: request.id,
                success: false,
                error: format_error(error),
            };
        } finally {
            this.end_activity();
        }
    }

    private begin_activity(){
        this.active_requests++;
        this.clear_idle_timer();
    }

    private end_activity(){
        this.active_requests = Math.max(0, this.active_requests-1);
        if (this.active_requests == 0 && !this.stop_promise)
            this.schedule_idle_timer();
    }

    private clear_idle_timer(){
        if (this.state.idle_timer)
        {
            this.deps.clear_timeout(this.state.idle_timer);
            this.state.idle_timer = null;
        }
    }

    private schedule_idle_timer(){
        this.clear_idle_timer();
        if (this.idle_timeout_ms == 0)
            return;
        this.state.idle_timer = this.deps.set_timeout(()=>{
            void this.stop();
        }, this.idle_timeout_ms);
    }

    private clear_keepalive(){
        if (this.state.keepalive_timer)
        {
            this.deps.clear_interval(this.state.keepalive_timer);
            this.state.keepalive_timer = null;
        }
    }

    private start_keepalive(){
        this.clear_keepalive();
        this.state.keepalive_timer = this.deps.set_interval(()=>{
            const browser = this.state.browser;
            if (!browser)
                return;
            try {
                browser.contexts();
                this.state.connected = true;
            } catch(_error) {
                if (this.state.browser == browser)
                    clear_connection_state(this.state);
            }
        }, KEEPALIVE_INTERVAL);
    }

    private async stop_internal(): Promise<void> {
        this.clear_idle_timer();
        this.clear_keepalive();
        await this.close_browser();

        const server = this.server;
        this.server = null;
        if (server)
        {
            await new Promise<void>(resolve=>{
                server.close(()=>resolve());
            });
        }

        this.cleanup_transport_files();
    }

    private cleanup_transport_files(){
        fs.rmSync(this.transport.pid_path, {force: true});
        if (this.transport.kind == 'unix')
            fs.rmSync(this.transport.socket_path, {force: true});
        else
            fs.rmSync(this.transport.port_path, {force: true});
    }

    private handle_socket(socket: net.Socket){
        socket.setEncoding('utf8');
        let buffer = '';
        let queue = Promise.resolve();

        socket.on('data', chunk=>{
            buffer += chunk;
            let newline_index = buffer.indexOf('\n');
            while (newline_index >= 0)
            {
                const line = buffer.slice(0, newline_index).trim();
                buffer = buffer.slice(newline_index+1);
                if (line)
                {
                    queue = queue
                        .then(()=>this.process_line(socket, line))
                        .catch(()=>undefined);
                }
                newline_index = buffer.indexOf('\n');
            }
        });

        socket.on('error', ()=>undefined);
    }

    private async process_line(socket: net.Socket, line: string): Promise<void> {
        let request: Daemon_request|null = null;
        let response: Daemon_response;

        try {
            request = parse_daemon_request(JSON.parse(line));
            response = await this.handle_request(request);
        } catch(error) {
            response = {
                id: request?.id ?? 'invalid',
                success: false,
                error: format_error(error),
            };
        }

        if (!socket.destroyed)
            socket.write(JSON.stringify(response)+'\n');

        if (request?.action == 'close' && response.success)
        {
            socket.end();
            void this.stop();
        }
    }


    private async execute_request(request: Daemon_request): Promise<unknown> {
        switch (request.action)
        {
        case 'close':
            await this.close_browser();
            return {closed: true};
        case 'navigate':
            return this.handle_navigate(request.params);
        case 'network':
            return this.handle_network();
        case 'ping':
            return {alive: true, connected: this.state.connected};
        case 'status':
            return this.handle_status();
        default:
            throw new Error(
                `Unknown daemon action "${request.action}".`
            );
        }
    }

    private async handle_navigate(params: Json_object|undefined){
        const url = params?.['url'];
        if (typeof url != 'string' || !url.trim())
        {
            throw new Error('Navigate requires a non-empty "url" parameter.');
        }

        const page = await this.ensure_connected();
        this.state.dom_refs.clear();
        const response = await page.goto(url, {waitUntil: 'load'});
        return {
            status: response?.status() ?? null,
            title: await page.title(),
            url: page.url(),
        };
    }

    private handle_network(){
        return {
            requests: Array.from(this.state.requests.entries()).map(
                ([id, tracked_request])=>({id, ...tracked_request})
            ),
        };
    }

    private async handle_status(){
        const page = this.state.page && !this.state.page.isClosed()
            ? this.state.page
            : null;
        return {
            connected: this.state.connected,
            current_title: page ? await this.safe_page_title(page) : null,
            current_url: page ? page.url() : null,
            dom_refs: this.state.dom_refs.size,
            idle_timeout_ms: this.idle_timeout_ms,
            listener: this.transport.kind == 'unix'
                ? {
                    kind: 'unix',
                    socket_path: this.transport.socket_path,
                }
                : {
                    host: this.transport.host,
                    kind: 'tcp',
                    port: this.transport.port,
                },
            session_name: this.state.session_name,
            tracked_requests: this.state.requests.size,
        };
    }

    private async safe_page_title(page: Page): Promise<string|null> {
        try {
            return await page.title();
        } catch(_error) {
            return null;
        }
    }

    private async ensure_connected(): Promise<Page> {
        return ensure_browser_connected(this.state, {
            connect_over_cdp: this.deps.connect_over_cdp,
        }, {
            on_context: context=>this.track_context(context),
            on_page: page=>{
                this.track_page(page);
                this.state.page = page;
            },
        });
    }

    private track_context(context: BrowserContext){
        if (this.active_contexts.has(context))
            return;
        this.active_contexts.add(context);
        context.on('page', page=>{
            this.track_page(page);
            this.state.page = page;
            this.state.dom_refs.clear();
        });
    }

    private track_page(page: Page){
        if (this.active_pages.has(page))
            return;
        this.active_pages.add(page);
        page.on('close', ()=>{
            if (this.state.page == page)
            {
                this.state.page = null;
                this.state.dom_refs.clear();
            }
        });
        page.on('request', request=>this.track_request(request));
        page.on('response', response=>this.track_response(response));
    }

    private track_request(request: Playwright_request){
        const request_id = `r${++this.request_counter}`;
        this.request_ids.set(request, request_id);
        this.state.requests.set(request_id, {
            method: request.method(),
            url: request.url(),
        });
        this.trim_tracked_requests();
    }

    private track_response(response: Playwright_response){
        const request = response.request();
        const existing_id = this.request_ids.get(request)
            ?? `r${++this.request_counter}`;
        if (!this.request_ids.has(request))
            this.request_ids.set(request, existing_id);

        const tracked_request = this.state.requests.get(existing_id) ?? {
            method: request.method(),
            url: request.url(),
        };
        tracked_request.status = response.status();
        this.state.requests.set(existing_id, tracked_request);
        this.trim_tracked_requests();
    }

    private trim_tracked_requests(){
        while (this.state.requests.size > MAX_TRACKED_REQUESTS)
        {
            const oldest_id = this.state.requests.keys().next().value as
                string|undefined;
            if (!oldest_id)
                return;
            this.state.requests.delete(oldest_id);
        }
    }

    private async close_browser(){
        const browser = this.state.browser;
        clear_connection_state(this.state);
        if (!browser)
            return;
        try {
            await browser.close();
        } catch(_error) {}
    }
}

const create_daemon_from_env = (env: NodeJS.ProcessEnv = process.env)=>{
    const cdp_endpoint = env['BRIGHTDATA_CDP_ENDPOINT']?.trim();
    if (!cdp_endpoint)
    {
        throw new Error(
            'BRIGHTDATA_CDP_ENDPOINT is required to start the browser daemon.'
        );
    }
    return new BrowserDaemon({
        cdp_endpoint,
        idle_timeout_ms: parse_idle_timeout(env['BRIGHTDATA_IDLE_TIMEOUT_MS']),
        session_name: env['BRIGHTDATA_SESSION'] ?? DEFAULT_SESSION_NAME,
    });
};

const start_daemon_from_env = async(
    env: NodeJS.ProcessEnv = process.env
): Promise<BrowserDaemon>=>{
    const daemon = create_daemon_from_env(env);
    await daemon.start();
    return daemon;
};

export {
    BrowserDaemon,
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    KEEPALIVE_INTERVAL,
    DEFAULT_SESSION_NAME,
    create_daemon_from_env,
    get_daemon_base_dir,
    get_daemon_transport,
    get_port_for_session,
    normalize_session_name,
    parse_idle_timeout,
    start_daemon_from_env,
};
export type {
    Browser_daemon_deps,
    Browser_daemon_opts,
    Daemon_request,
    Daemon_response,
    Daemon_state,
    Daemon_transport,
    Tracked_request,
};
