import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {EventEmitter} from 'events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Browser, BrowserContext, Page} from 'playwright-core';
import {
    BrowserDaemon,
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    KEEPALIVE_INTERVAL,
    create_daemon_from_env,
    get_daemon_base_dir,
    get_daemon_transport,
    get_port_for_session,
    normalize_session_name,
    parse_idle_timeout,
} from '../../browser/daemon';

type Mock_request = {
    method: ()=>string;
    url: ()=>string;
};

class Mock_response {
    private readonly mock_request: Mock_request;
    private readonly mock_status: number;

    constructor(mock_request: Mock_request, mock_status: number){
        this.mock_request = mock_request;
        this.mock_status = mock_status;
    }

    request(){
        return this.mock_request;
    }

    status(){
        return this.mock_status;
    }
}

class Mock_page extends EventEmitter {
    private closed = false;
    private current_title = 'Blank';
    private current_url = 'about:blank';
    private mock_context: Mock_context|null = null;
    private screenshot_opts: {fullPage?: boolean}|null = null;

    constructor(mock_context?: Mock_context){
        super();
        this.mock_context = mock_context ?? null;
    }

    set_context(mock_context: Mock_context){
        this.mock_context = mock_context;
    }

    private set_location(url: string){
        this.current_url = url;
        this.current_title = `Title for ${url}`;
    }

    async goto(url: string){
        this.set_location(url);
        return {status: ()=>200};
    }

    async goBack(){
        this.set_location('https://example.com/back');
        return {status: ()=>200};
    }

    async goForward(){
        this.set_location('https://example.com/forward');
        return {status: ()=>200};
    }

    async reload(){
        this.current_title = `Title for ${this.current_url}`;
        return {status: ()=>200};
    }

    async screenshot(opts?: {fullPage?: boolean}){
        this.screenshot_opts = opts ?? {};
        return Buffer.from(
            opts?.fullPage ? 'full-page-image' : 'viewport-image'
        );
    }

    async evaluate(_fn: unknown, arg: {attr_name: string; selector?: string}){
        return {
            nodes: [
                {
                    children: [],
                    level: 1,
                    name: 'Welcome',
                    role: 'heading',
                },
                {
                    children: [
                        {
                            children: [],
                            interactive: true,
                            name: 'Pricing',
                            ref: 'e1',
                            role: 'link',
                        },
                    ],
                    role: 'navigation',
                },
                {
                    children: [
                        {
                            children: [],
                            interactive: true,
                            name: 'Buy',
                            ref: 'e2',
                            role: 'button',
                        },
                    ],
                    role: 'main',
                },
            ],
            refs: [
                {ref: 'e1', selector: `[${arg.attr_name}="e1"]`},
                {ref: 'e2', selector: `[${arg.attr_name}="e2"]`},
            ],
        };
    }

    context(){
        if (!this.mock_context)
            throw new Error('Mock page has no context.');
        return this.mock_context as unknown as BrowserContext;
    }

    isClosed(){
        return this.closed;
    }

    async title(){
        return this.current_title;
    }

    url(){
        return this.current_url;
    }

    close_page(){
        this.closed = true;
        this.emit('close');
    }

    last_screenshot_opts(){
        return this.screenshot_opts;
    }
}

class Mock_context extends EventEmitter {
    private readonly mock_cookies: Array<Record<string, unknown>>;
    private readonly mock_pages: Mock_page[];

    constructor(
        mock_pages: Mock_page[] = [],
        mock_cookies: Array<Record<string, unknown>> = [],
    ){
        super();
        this.mock_cookies = mock_cookies;
        this.mock_pages = [];
        const pages = mock_pages.length ? mock_pages : [new Mock_page()];
        for (const page of pages)
            this.attach_page(page);
    }

    private attach_page(page: Mock_page){
        page.set_context(this);
        this.mock_pages.push(page);
    }

    async newPage(){
        const page = new Mock_page(this);
        this.mock_pages.push(page);
        this.emit('page', page as unknown as Page);
        return page as unknown as Page;
    }

    async cookies(){
        return this.mock_cookies;
    }

    pages(){
        return this.mock_pages as unknown as Page[];
    }

    first_page(){
        return this.mock_pages[0];
    }
}

class Mock_browser extends EventEmitter {
    private connected = true;
    private contexts_calls = 0;
    private contexts_error: Error|null = null;
    private readonly mock_contexts: Mock_context[];

    constructor(mock_contexts: Mock_context[] = [new Mock_context()]){
        super();
        this.mock_contexts = mock_contexts;
    }

    async close(){
        this.connected = false;
        this.emit('disconnected');
    }

    contexts(){
        this.contexts_calls++;
        if (this.contexts_error)
            throw this.contexts_error;
        return this.mock_contexts as unknown as BrowserContext[];
    }

    isConnected(){
        return this.connected;
    }

    async newContext(){
        const context = new Mock_context([]);
        this.mock_contexts.push(context);
        return context as unknown as BrowserContext;
    }

    break_health_check(message = 'stale browser'){
        this.contexts_error = new Error(message);
    }

    contexts_call_count(){
        return this.contexts_calls;
    }

    disconnect(){
        this.connected = false;
        this.emit('disconnected');
    }

    first_context(){
        return this.mock_contexts[0];
    }
}

const mk_tmp_dir = ()=>fs.mkdtempSync(path.join(os.tmpdir(), 'bdata-daemon-'));

const read_line = async(socket: net.Socket): Promise<string>=>{
    return await new Promise((resolve, reject)=>{
        let buffer = '';
        const on_data = (chunk: Buffer|string)=>{
            buffer += chunk.toString();
            const newline_index = buffer.indexOf('\n');
            if (newline_index >= 0)
            {
                cleanup();
                resolve(buffer.slice(0, newline_index));
            }
        };
        const on_error = (error: Error)=>{
            cleanup();
            reject(error);
        };
        const on_end = ()=>{
            cleanup();
            reject(new Error('Socket closed before a response was received.'));
        };
        const cleanup = ()=>{
            socket.off('data', on_data);
            socket.off('error', on_error);
            socket.off('end', on_end);
        };

        socket.on('data', on_data);
        socket.on('error', on_error);
        socket.on('end', on_end);
    });
};

describe('browser/daemon', ()=>{
    let tmp_dir = '';

    beforeEach(()=>{
        tmp_dir = mk_tmp_dir();
    });

    afterEach(()=>{
        vi.useRealTimers();
        fs.rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('normalizes and validates session names', ()=>{
        expect(normalize_session_name(' shop.us-1 ')).toBe('shop.us-1');
        expect(()=>normalize_session_name('../bad'))
            .toThrow('Browser session name may contain only letters');
    });

    it('resolves daemon directories and transports per platform', ()=>{
        expect(get_daemon_base_dir({
            env: {XDG_RUNTIME_DIR: '/run/user/1000'},
            home_dir: '/home/tester',
            platform: 'linux',
        })).toBe('/run/user/1000/brightdata-cli');

        expect(get_daemon_base_dir({
            home_dir: '/Users/tester',
            platform: 'darwin',
        })).toBe('/Users/tester/Library/Application Support/brightdata-cli');

        expect(get_daemon_transport('shop', {
            home_dir: 'C:\\Users\\tester',
            platform: 'win32',
        })).toMatchObject({
            host: '127.0.0.1',
            kind: 'tcp',
            port: get_port_for_session('shop'),
        });
    });

    it('parses daemon env and idle timeout defaults', async()=>{
        expect(parse_idle_timeout(undefined)).toBe(undefined);
        expect(parse_idle_timeout('2500')).toBe(2500);
        expect(()=>create_daemon_from_env({}))
            .toThrow('BRIGHTDATA_CDP_ENDPOINT is required');

        const daemon = create_daemon_from_env({
            BRIGHTDATA_CDP_ENDPOINT: 'wss://example.test',
            BRIGHTDATA_SESSION: 'demo',
        });
        const transport = daemon.get_transport();
        expect(transport.kind).toBe(process.platform == 'win32' ? 'tcp' : 'unix');
        expect(daemon.state.session_name).toBe('demo');

        const default_daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
        });
        const response = await default_daemon.handle_request({
            id: 'status-1',
            action: 'status',
        });
        expect(response.success).toBe(true);
        expect((response.data as {idle_timeout_ms: number}).idle_timeout_ms)
            .toBe(DEFAULT_DAEMON_IDLE_TIMEOUT_MS);
    });

    it('connects, navigates, and tracks network requests', async()=>{
        const mock_browser = new Mock_browser();
        const connect_over_cdp = vi.fn(async()=>mock_browser as unknown as Browser);
        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'stateful',
        }, {connect_over_cdp});

        const navigate = await daemon.handle_request({
            id: 'nav-1',
            action: 'navigate',
            params: {url: 'https://example.com'},
        });
        expect(navigate).toMatchObject({
            id: 'nav-1',
            success: true,
            data: {
                status: 200,
                title: 'Title for https://example.com',
                url: 'https://example.com',
            },
        });
        expect(connect_over_cdp).toHaveBeenCalledTimes(1);

        const page = mock_browser.first_context().first_page();
        const request = {
            method: ()=> 'GET',
            url: ()=> 'https://example.com/',
        };
        page.emit('request', request);
        page.emit('response', new Mock_response(request, 200));

        const network = await daemon.handle_request({
            id: 'net-1',
            action: 'network',
        });
        expect(network).toMatchObject({
            id: 'net-1',
            success: true,
            data: {
                requests: [
                    {
                        id: 'r1',
                        method: 'GET',
                        status: 200,
                        url: 'https://example.com/',
                    },
                ],
            },
        });

        mock_browser.disconnect();
        const status = await daemon.handle_request({
            id: 'status-2',
            action: 'status',
        });
        expect(status).toMatchObject({
            id: 'status-2',
            success: true,
            data: {
                connected: false,
                current_title: null,
                current_url: null,
            },
        });

        await daemon.stop();
    });

    it('captures snapshot text and refreshes daemon DOM refs', async()=>{
        const mock_browser = new Mock_browser();
        const connect_over_cdp = vi.fn(async()=>mock_browser as unknown as Browser);
        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'snapshot-actions',
        }, {connect_over_cdp});

        await daemon.handle_request({
            id: 'nav-snapshot',
            action: 'navigate',
            params: {url: 'https://example.com'},
        });

        const snapshot = await daemon.handle_request({
            id: 'snapshot-1',
            action: 'snapshot',
            params: {
                compact: true,
                depth: 1,
                selector: '#checkout',
            },
        });
        expect(snapshot).toMatchObject({
            id: 'snapshot-1',
            success: true,
            data: {
                compact: true,
                depth: 1,
                interactive: false,
                ref_count: 2,
                selector: '#checkout',
                title: 'Title for https://example.com',
                url: 'https://example.com',
            },
        });
        expect((snapshot.data as {snapshot: string}).snapshot).toContain(
            '- navigation'
        );
        expect((snapshot.data as {snapshot: string}).snapshot).toContain(
            'link "Pricing" [ref=e1]'
        );
        expect((snapshot.data as {snapshot: string}).snapshot).toContain(
            'button "Buy" [ref=e2]'
        );
        expect(daemon.state.dom_refs.get('e1')).toBe('[data-bd-ref="e1"]');
        expect(daemon.state.dom_refs.get('e2')).toBe('[data-bd-ref="e2"]');

        await daemon.stop();
    });

    it('supports back, forward, reload, and cookies actions', async()=>{
        const cookies = [{name: 'session', value: 'abc'}];
        const mock_browser = new Mock_browser([
            new Mock_context([], cookies),
        ]);
        const connect_over_cdp = vi.fn(async()=>mock_browser as unknown as Browser);
        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'navigation-actions',
        }, {connect_over_cdp});

        await daemon.handle_request({
            id: 'nav-seed',
            action: 'navigate',
            params: {url: 'https://example.com'},
        });

        const back = await daemon.handle_request({
            id: 'back-1',
            action: 'back',
        });
        expect(back).toMatchObject({
            id: 'back-1',
            success: true,
            data: {
                status: 200,
                title: 'Title for https://example.com/back',
                url: 'https://example.com/back',
            },
        });

        const forward = await daemon.handle_request({
            id: 'forward-1',
            action: 'forward',
        });
        expect(forward).toMatchObject({
            id: 'forward-1',
            success: true,
            data: {
                status: 200,
                title: 'Title for https://example.com/forward',
                url: 'https://example.com/forward',
            },
        });

        const reload = await daemon.handle_request({
            id: 'reload-1',
            action: 'reload',
        });
        expect(reload).toMatchObject({
            id: 'reload-1',
            success: true,
            data: {
                status: 200,
                title: 'Title for https://example.com/forward',
                url: 'https://example.com/forward',
            },
        });

        const cookie_response = await daemon.handle_request({
            id: 'cookies-1',
            action: 'cookies',
        });
        expect(cookie_response).toMatchObject({
            id: 'cookies-1',
            success: true,
            data: {cookies},
        });

        await daemon.stop();
    });

    it('captures screenshots and returns the saved file path', async()=>{
        const mock_browser = new Mock_browser();
        const connect_over_cdp = vi.fn(async()=>mock_browser as unknown as Browser);
        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'screenshot-actions',
        }, {connect_over_cdp});

        const output_path = path.join(tmp_dir, 'captures', 'page.png');
        const screenshot = await daemon.handle_request({
            id: 'screenshot-1',
            action: 'screenshot',
            params: {
                base64: true,
                full_page: true,
                path: output_path,
            },
        });
        expect(screenshot).toMatchObject({
            id: 'screenshot-1',
            success: true,
            data: {
                base64: Buffer.from('full-page-image').toString('base64'),
                full_page: true,
                mime_type: 'image/png',
                path: output_path,
            },
        });

        const page = mock_browser.first_context().first_page();
        expect(page.last_screenshot_opts()).toEqual({fullPage: true});
        expect(fs.readFileSync(output_path, 'utf8')).toBe('full-page-image');

        await daemon.stop();
    });

    it('starts and clears the keepalive interval with the daemon lifecycle', async()=>{
        vi.useFakeTimers();

        const set_interval = vi.fn((handler: TimerHandler, timeout?: number)=>
            setInterval(handler, timeout)
        );
        const clear_interval = vi.fn((interval: NodeJS.Timeout|string|number|undefined)=>{
            clearInterval(interval as NodeJS.Timeout);
        });
        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'keepalive-lifecycle',
        }, {
            clear_interval: clear_interval as typeof clearInterval,
            set_interval: set_interval as unknown as typeof setInterval,
        });

        await daemon.start();

        expect(set_interval).toHaveBeenCalledWith(
            expect.any(Function),
            KEEPALIVE_INTERVAL
        );

        await daemon.stop();

        expect(clear_interval).toHaveBeenCalledTimes(1);
    });

    it('pings the browser on keepalive and clears stale state on health-check failure', async()=>{
        vi.useFakeTimers();

        const mock_browser = new Mock_browser();
        const connect_over_cdp = vi.fn(async()=>mock_browser as unknown as Browser);
        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'keepalive-health',
        }, {connect_over_cdp});

        await daemon.start();
        await daemon.handle_request({
            id: 'nav-keepalive',
            action: 'navigate',
            params: {url: 'https://example.com'},
        });

        const before_tick = mock_browser.contexts_call_count();
        await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL);
        expect(mock_browser.contexts_call_count()).toBeGreaterThan(before_tick);

        mock_browser.break_health_check();
        await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL);

        const status = await daemon.handle_request({
            id: 'status-keepalive',
            action: 'status',
        });
        expect(status).toMatchObject({
            id: 'status-keepalive',
            success: true,
            data: {
                connected: false,
                current_title: null,
                current_url: null,
            },
        });

        await daemon.stop();
    });

    it('serves requests over the daemon listener', async()=>{
        if (process.platform == 'win32')
            return;

        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'socket-test',
        });
        await daemon.start();

        const transport = daemon.get_transport();
        expect(transport.kind).toBe('unix');

        const socket = net.createConnection((transport as {socket_path: string}).socket_path);
        socket.write(JSON.stringify({id: 'sock-1', action: 'status'})+'\n');
        const response = JSON.parse(await read_line(socket)) as {
            success: boolean;
            data: {session_name: string};
        };
        expect(response.success).toBe(true);
        expect(response.data.session_name).toBe('socket-test');

        socket.end();
        await daemon.stop();
    });

    it('shuts down after the idle timeout', async()=>{
        vi.useFakeTimers();

        const daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 25,
            session_name: 'idle-test',
        });
        await daemon.start();
        expect(daemon.is_running()).toBe(true);

        await vi.advanceTimersByTimeAsync(30);

        expect(daemon.is_running()).toBe(false);
        const transport = daemon.get_transport();
        expect(fs.existsSync(transport.pid_path)).toBe(false);
    });
});
