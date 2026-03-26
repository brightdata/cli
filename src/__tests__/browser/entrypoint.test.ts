import {describe, expect, it, vi} from 'vitest';
import {
    get_browser_daemon_signals,
    is_browser_daemon_process,
    maybe_run_browser_daemon,
} from '../../browser/entrypoint';

describe('browser/entrypoint', ()=>{
    it('detects daemon mode from argv or environment', ()=>{
        expect(is_browser_daemon_process(
            ['node', 'dist/index.js', '--daemon'],
            {}
        )).toBe(true);
        expect(is_browser_daemon_process(
            ['node', 'dist/index.js'],
            {BRIGHTDATA_DAEMON: '1'}
        )).toBe(true);
        expect(is_browser_daemon_process(
            ['node', 'dist/index.js'],
            {}
        )).toBe(false);
    });

    it('registers platform-appropriate shutdown signals', ()=>{
        expect(get_browser_daemon_signals('linux'))
            .toEqual(['SIGHUP', 'SIGINT', 'SIGTERM']);
        expect(get_browser_daemon_signals('win32'))
            .toEqual(['SIGINT', 'SIGTERM']);
    });

    it('does nothing when the process is not in daemon mode', async()=>{
        const start_daemon = vi.fn();

        await expect(maybe_run_browser_daemon({
            argv: ['node', 'dist/index.js'],
            env: {},
            start_daemon,
        })).resolves.toBe(false);

        expect(start_daemon).not.toHaveBeenCalled();
    });

    it('starts the daemon and stops it on shutdown signals', async()=>{
        const listeners: Partial<Record<NodeJS.Signals, ()=>void>> = {};
        const exit = vi.fn();
        const stop = vi.fn(async()=>undefined);
        const start_daemon = vi.fn(async()=>({stop}));

        await expect(maybe_run_browser_daemon({
            argv: ['node', 'dist/index.js', '--daemon'],
            env: {BRIGHTDATA_CDP_ENDPOINT: 'wss://example.test'},
            exit,
            once: (event, listener)=>{
                listeners[event] = listener;
                return process;
            },
            platform: 'linux',
            start_daemon,
        })).resolves.toBe(true);

        expect(start_daemon).toHaveBeenCalledWith({
            BRIGHTDATA_CDP_ENDPOINT: 'wss://example.test',
        });
        expect(listeners['SIGTERM']).toBeTypeOf('function');

        listeners['SIGTERM']?.();
        await vi.waitFor(()=>{
            expect(stop).toHaveBeenCalledTimes(1);
            expect(exit).toHaveBeenCalledWith(0);
        });
    });
});
