import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    DEFAULT_SESSION_NAME: 'default',
    ensure_authenticated: vi.fn(),
    ensure_browser_zone: vi.fn(),
    ensure_daemon: vi.fn(),
    existsSync: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    get_cdp_endpoint: vi.fn(),
    get_daemon_base_dir: vi.fn(),
    info: vi.fn(),
    is_daemon_alive: vi.fn(),
    normalize_session_name: vi.fn(),
    print: vi.fn(),
    readdirSync: vi.fn(),
    send_command: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    success: vi.fn(),
}));

vi.mock('fs', ()=>({
    default: {
        existsSync: mocks.existsSync,
        readdirSync: mocks.readdirSync,
    },
}));

vi.mock('../../browser/daemon', ()=>({
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS: 600_000,
}));

vi.mock('../../browser/ipc', ()=>({
    DEFAULT_SESSION_NAME: mocks.DEFAULT_SESSION_NAME,
    get_daemon_base_dir: mocks.get_daemon_base_dir,
    normalize_session_name: mocks.normalize_session_name,
}));

vi.mock('../../browser/lifecycle', ()=>({
    ensure_daemon: mocks.ensure_daemon,
    is_daemon_alive: mocks.is_daemon_alive,
    send_command: mocks.send_command,
}));

vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));

vi.mock('../../utils/browser-credentials', ()=>({
    DEFAULT_BROWSER_ZONE: 'cli_browser',
    ensure_browser_zone: mocks.ensure_browser_zone,
    get_cdp_endpoint: mocks.get_cdp_endpoint,
}));

vi.mock('../../utils/output', ()=>({
    fail: mocks.fail,
    info: mocks.info,
    print: mocks.print,
    success: mocks.success,
}));

vi.mock('../../utils/spinner', ()=>({
    start: mocks.start,
}));

import {
    get_browser_session_names,
    handle_browser_close,
    handle_browser_open,
    handle_browser_sessions,
    handle_browser_status,
} from '../../commands/browser';

describe('commands/browser', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.get_cdp_endpoint.mockResolvedValue('wss://browser.example');
        mocks.get_daemon_base_dir.mockReturnValue('/tmp/brightdata-cli');
        mocks.is_daemon_alive.mockResolvedValue(true);
        mocks.normalize_session_name.mockImplementation((name: string|undefined)=>
            (name ?? mocks.DEFAULT_SESSION_NAME).trim()
        );
        mocks.send_command.mockResolvedValue({success: true, data: {}});
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    it('opens a URL by resolving credentials, ensuring the daemon, and navigating', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                status: 200,
                title: 'Example Domain',
                url: 'https://example.com',
            },
        });

        await handle_browser_open('https://example.com', {});

        expect(mocks.ensure_authenticated).toHaveBeenCalledWith(undefined);
        expect(mocks.ensure_browser_zone).toHaveBeenCalledWith(
            'api_key',
            'cli_browser'
        );
        expect(mocks.get_cdp_endpoint).toHaveBeenCalledWith(
            'api_key',
            'cli_browser',
            undefined
        );
        expect(mocks.ensure_daemon).toHaveBeenCalledWith('default', {
            cdp_endpoint: 'wss://browser.example',
            daemon_dir: undefined,
            idle_timeout_ms: undefined,
        });
        expect(mocks.send_command).toHaveBeenCalledWith(
            'default',
            expect.objectContaining({
                action: 'navigate',
                params: {url: 'https://example.com'},
            }),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(mocks.success).toHaveBeenCalledWith('Navigated to https://example.com');
        expect(mocks.info).toHaveBeenNthCalledWith(1, 'Title: Example Domain');
        expect(mocks.info).toHaveBeenNthCalledWith(2, 'URL: https://example.com');
    });

    it('fails status when the session is not active', async()=>{
        mocks.is_daemon_alive.mockResolvedValue(false);

        await expect(handle_browser_status({session: 'shop'})).rejects.toThrow(
            'fail:No active browser session "shop".'
        );

        expect(mocks.send_command).not.toHaveBeenCalled();
    });

    it('collects browser session names from daemon files', ()=>{
        mocks.existsSync.mockReturnValue(true);
        mocks.readdirSync.mockReturnValue([
            'shop.sock',
            'shop.pid',
            'stale.pid',
            'notes.txt',
        ]);

        expect(get_browser_session_names({daemonDir: '/tmp/test'}))
            .toEqual(['shop', 'stale']);
        expect(mocks.get_daemon_base_dir).toHaveBeenCalledWith({daemon_dir: '/tmp/test'});
    });

    it('lists only active browser sessions', async()=>{
        mocks.existsSync.mockReturnValue(true);
        mocks.readdirSync.mockReturnValue([
            'shop.sock',
            'shop.pid',
            'stale.pid',
        ]);
        mocks.is_daemon_alive.mockImplementation(async(name: string)=>name == 'shop');
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {session_name: 'shop', connected: true},
        });

        await handle_browser_sessions({pretty: true});

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({action: 'status'}),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            [{session_name: 'shop', connected: true}],
            {json: undefined, output: undefined, pretty: true}
        );
    });

    it('closes all active browser sessions', async()=>{
        mocks.existsSync.mockReturnValue(true);
        mocks.readdirSync.mockReturnValue([
            'shop.pid',
            'cart.sock',
            'stale.pid',
        ]);
        mocks.is_daemon_alive.mockImplementation(async(name: string)=>name != 'stale');
        mocks.send_command.mockResolvedValue({success: true, data: {closed: true}});

        await handle_browser_close({all: true});

        expect(mocks.send_command).toHaveBeenCalledTimes(2);
        expect(mocks.send_command).toHaveBeenNthCalledWith(
            1,
            'cart',
            expect.objectContaining({action: 'close'}),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.send_command).toHaveBeenNthCalledWith(
            2,
            'shop',
            expect.objectContaining({action: 'close'}),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.success).toHaveBeenCalledWith('Closed 2 browser sessions.');
    });
});
