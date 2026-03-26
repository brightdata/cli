import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    DEFAULT_IPC_TIMEOUT_MS: 30_000,
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
    DEFAULT_IPC_TIMEOUT_MS: mocks.DEFAULT_IPC_TIMEOUT_MS,
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
    create_browser_command,
    get_browser_session_names,
    handle_browser_close,
    handle_browser_cookies,
    handle_browser_open,
    handle_browser_reload,
    handle_browser_screenshot,
    handle_browser_sessions,
    handle_browser_snapshot,
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

    it('reloads the current page for an active browser session', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                status: 200,
                title: 'Reloaded Example',
                url: 'https://example.com',
            },
        });

        await handle_browser_reload({session: 'shop'});

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({action: 'reload'}),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.success).toHaveBeenCalledWith('Reloaded page.');
        expect(mocks.info).toHaveBeenNthCalledWith(1, 'Title: Reloaded Example');
        expect(mocks.info).toHaveBeenNthCalledWith(2, 'URL: https://example.com');
    });

    it('prints cookies for an active browser session', async()=>{
        const cookies = [{name: 'session', value: 'abc'}];
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {cookies},
        });

        await handle_browser_cookies({session: 'shop', pretty: true});

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({action: 'cookies'}),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            cookies,
            {json: undefined, output: undefined, pretty: true}
        );
    });

    it('prints snapshot text for an active browser session with extended snapshot params', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                compact: true,
                depth: 1,
                interactive: false,
                ref_count: 1,
                selector: '#checkout',
                snapshot: 'Page: Example Domain\nURL: https://example.com\n\n- link "Pricing" [ref=e1]',
                title: 'Example Domain',
                url: 'https://example.com',
            },
        });

        await handle_browser_snapshot({
            compact: true,
            depth: '1',
            selector: '#checkout',
            session: 'shop',
        });

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({
                action: 'snapshot',
                params: {
                    compact: true,
                    depth: 1,
                    interactive: false,
                    selector: '#checkout',
                },
            }),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            'Page: Example Domain\nURL: https://example.com\n\n- link "Pricing" [ref=e1]',
            {output: undefined}
        );
    });

    it('captures a screenshot for an active browser session', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                full_page: true,
                mime_type: 'image/png',
                path: '/tmp/browser-shot.png',
            },
        });

        await handle_browser_screenshot('/tmp/browser-shot.png', {
            fullPage: true,
            session: 'shop',
        });

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({
                action: 'screenshot',
                params: {
                    base64: false,
                    full_page: true,
                    path: '/tmp/browser-shot.png',
                },
            }),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            '/tmp/browser-shot.png',
            {output: undefined}
        );
    });

    it('rejects invalid snapshot depth before sending the command', async()=>{
        await expect(handle_browser_snapshot({depth: 'abc', session: 'shop'})).rejects.toThrow(
            'fail:Snapshot depth must be a non-negative integer.'
        );

        expect(mocks.send_command).not.toHaveBeenCalled();
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

    it('parses browser-group flags for open and forwards them to the handler flow', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                status: 200,
                title: 'Example Domain',
                url: 'https://example.com',
            },
        });
        const command = create_browser_command();
        command.exitOverride();

        await command.parseAsync([
            'open',
            'https://example.com',
            '--session',
            'shop',
            '--timeout',
            '1234',
            '--country',
            'us',
            '--zone',
            'browser_us',
            '--idle-timeout',
            '4567',
            '--json',
        ], {from: 'user'});

        expect(mocks.ensure_browser_zone).toHaveBeenCalledWith(
            'api_key',
            'browser_us'
        );
        expect(mocks.get_cdp_endpoint).toHaveBeenCalledWith(
            'api_key',
            'browser_us',
            'us'
        );
        expect(mocks.ensure_daemon).toHaveBeenCalledWith('shop', {
            cdp_endpoint: 'wss://browser.example',
            daemon_dir: undefined,
            idle_timeout_ms: 4567,
        });
        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({
                action: 'navigate',
                params: {url: 'https://example.com'},
            }),
            {daemon_dir: undefined, timeout_ms: 1234}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {
                status: 200,
                title: 'Example Domain',
                url: 'https://example.com',
            },
            {json: true, output: undefined, pretty: undefined}
        );
        expect(mocks.success).not.toHaveBeenCalled();
    });

    it('parses the back subcommand and sends the browser action', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                status: 200,
                title: 'Back Page',
                url: 'https://example.com/back',
            },
        });
        const command = create_browser_command();
        command.exitOverride();

        await command.parseAsync([
            'back',
            '--session',
            'shop',
            '--json',
        ], {from: 'user'});

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({action: 'back'}),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {
                status: 200,
                title: 'Back Page',
                url: 'https://example.com/back',
            },
            {json: true, output: undefined, pretty: undefined}
        );
    });

    it('parses snapshot flags and forwards the full snapshot param set', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                compact: false,
                depth: 2,
                interactive: true,
                ref_count: 1,
                selector: '#checkout',
                snapshot: 'Page: Example Domain\nURL: https://example.com\n\n- link "Pricing" [ref=e1]',
                title: 'Example Domain',
                url: 'https://example.com',
            },
        });
        const command = create_browser_command();
        command.exitOverride();

        await command.parseAsync([
            'snapshot',
            '--session',
            'shop',
            '--interactive',
            '--depth',
            '2',
            '--selector',
            '#checkout',
            '--json',
        ], {from: 'user'});

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({
                action: 'snapshot',
                params: {
                    compact: false,
                    depth: 2,
                    interactive: true,
                    selector: '#checkout',
                },
            }),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {
                compact: false,
                depth: 2,
                interactive: true,
                ref_count: 1,
                selector: '#checkout',
                snapshot: 'Page: Example Domain\nURL: https://example.com\n\n- link "Pricing" [ref=e1]',
                title: 'Example Domain',
                url: 'https://example.com',
            },
            {json: true, output: undefined, pretty: undefined}
        );
    });

    it('parses screenshot flags and forwards the screenshot params', async()=>{
        mocks.send_command.mockResolvedValue({
            success: true,
            data: {
                base64: 'aW1hZ2U=',
                full_page: true,
                mime_type: 'image/png',
                path: '/tmp/browser-shot.png',
            },
        });
        const command = create_browser_command();
        command.exitOverride();

        await command.parseAsync([
            'screenshot',
            '/tmp/browser-shot.png',
            '--session',
            'shop',
            '--full-page',
            '--base64',
            '--json',
        ], {from: 'user'});

        expect(mocks.send_command).toHaveBeenCalledWith(
            'shop',
            expect.objectContaining({
                action: 'screenshot',
                params: {
                    base64: true,
                    full_page: true,
                    path: '/tmp/browser-shot.png',
                },
            }),
            {daemon_dir: undefined, timeout_ms: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {
                base64: 'aW1hZ2U=',
                full_page: true,
                mime_type: 'image/png',
                path: '/tmp/browser-shot.png',
            },
            {json: true, output: undefined, pretty: undefined}
        );
    });

    it('rejects open-only flags on status through browser-group parsing', async()=>{
        const command = create_browser_command();
        command.exitOverride();

        await expect(command.parseAsync([
            'status',
            '--country',
            'us',
        ], {from: 'user'})).rejects.toThrow(
            'fail:--country is not supported by "brightdata browser status".'
        );

        expect(mocks.send_command).not.toHaveBeenCalled();
    });

    it('rejects compact mode outside the snapshot command', async()=>{
        const command = create_browser_command();
        command.exitOverride();

        await expect(command.parseAsync([
            'status',
            '--compact',
        ], {from: 'user'})).rejects.toThrow(
            'fail:--compact is not supported by "brightdata browser status".'
        );

        expect(mocks.send_command).not.toHaveBeenCalled();
    });

    it('rejects selector mode outside the snapshot command', async()=>{
        const command = create_browser_command();
        command.exitOverride();

        await expect(command.parseAsync([
            'status',
            '--selector',
            '#checkout',
        ], {from: 'user'})).rejects.toThrow(
            'fail:--selector is not supported by "brightdata browser status".'
        );

        expect(mocks.send_command).not.toHaveBeenCalled();
    });

    it('rejects screenshot-only flags outside the screenshot command', async()=>{
        const command = create_browser_command();
        command.exitOverride();

        await expect(command.parseAsync([
            'status',
            '--full-page',
        ], {from: 'user'})).rejects.toThrow(
            'fail:--full-page is not supported by "brightdata browser status".'
        );

        expect(mocks.send_command).not.toHaveBeenCalled();
    });

    it('rejects not-yet-implemented global flags on open', async()=>{
        const command = create_browser_command();
        command.exitOverride();

        await expect(command.parseAsync([
            'open',
            'https://example.com',
            '--headed',
        ], {from: 'user'})).rejects.toThrow(
            'fail:--headed is not supported by "brightdata browser open".'
        );

        expect(mocks.ensure_authenticated).not.toHaveBeenCalled();
    });
});
