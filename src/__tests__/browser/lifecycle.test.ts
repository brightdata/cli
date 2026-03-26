import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {EventEmitter} from 'events';
import type {ChildProcess} from 'child_process';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_DAEMON_IDLE_TIMEOUT_MS} from '../../browser/daemon';
import {
    cleanup_stale_files,
    ensure_daemon,
    is_daemon_alive,
    wait_for_daemon,
} from '../../browser/lifecycle';

class Mock_child extends EventEmitter {
    readonly unref = vi.fn();
    readonly kill = vi.fn(()=>true);
}

const mk_tmp_dir = ()=>fs.mkdtempSync(path.join(os.tmpdir(), 'bdata-lifecycle-'));

const close_server = async(server: net.Server): Promise<void>=>{
    await new Promise(resolve=>server.close(()=>resolve(undefined)));
};

describe('browser/lifecycle', ()=>{
    let tmp_dir = '';
    let servers: net.Server[] = [];

    beforeEach(()=>{
        tmp_dir = mk_tmp_dir();
        servers = [];
    });

    afterEach(async()=>{
        vi.clearAllMocks();
        await Promise.all(servers.map(close_server));
        fs.rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('removes stale socket and pid files', ()=>{
        const pid_path = path.join(tmp_dir, 'demo.pid');
        const socket_path = path.join(tmp_dir, 'demo.sock');
        fs.writeFileSync(pid_path, '1');
        fs.writeFileSync(socket_path, '');

        cleanup_stale_files('demo', {daemon_dir: tmp_dir});

        expect(fs.existsSync(pid_path)).toBe(false);
        expect(fs.existsSync(socket_path)).toBe(false);
    });

    it('checks daemon liveness via a connectable unix socket', async()=>{
        if (process.platform == 'win32')
            return;

        const socket_path = path.join(tmp_dir, 'alive.sock');
        const server = net.createServer(socket=>socket.end());
        servers.push(server);
        await new Promise<void>((resolve, reject)=>{
            server.once('error', reject);
            server.listen(socket_path, ()=>resolve());
        });

        await expect(is_daemon_alive('alive', {
            daemon_dir: tmp_dir,
            timeout_ms: 250,
        })).resolves.toBe(true);
        await expect(is_daemon_alive('missing', {
            daemon_dir: tmp_dir,
            timeout_ms: 250,
        })).resolves.toBe(false);
    });

    it('waits until the daemon becomes connectable', async()=>{
        let attempts = 0;
        let now = 0;

        await wait_for_daemon('demo', 250, {daemon_dir: tmp_dir}, {
            current_time: ()=>now,
            is_daemon_alive: async()=>{
                attempts++;
                return attempts >= 3;
            },
            pause: async(ms: number)=>{
                now += ms;
            },
        });

        expect(attempts).toBe(3);
        expect(now).toBe(200);
    });

    it('times out when the daemon never becomes connectable', async()=>{
        let now = 0;

        await expect(wait_for_daemon('demo', 150, {daemon_dir: tmp_dir}, {
            current_time: ()=>now,
            is_daemon_alive: async()=>false,
            pause: async(ms: number)=>{
                now += ms;
            },
        })).rejects.toThrow(
            `Timed out waiting for browser daemon session "demo" to start at ${path.join(tmp_dir, 'demo.sock')}.`
        );
    });

    it('spawns a detached daemon with the expected environment and waits for readiness', async()=>{
        const child = new Mock_child();
        const spawn_process = vi.fn(()=>child as unknown as ChildProcess);
        const wait_for_ready = vi.fn(async()=>undefined);
        const stale_pid_path = path.join(tmp_dir, 'demo.pid');
        const stale_socket_path = path.join(tmp_dir, 'demo.sock');
        fs.writeFileSync(stale_pid_path, '999');
        fs.writeFileSync(stale_socket_path, '');

        await ensure_daemon('demo', {
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            exec_path: '/usr/bin/node',
            idle_timeout_ms: 4_321,
            startup_timeout_ms: 1_234,
        }, {
            is_daemon_alive: async()=>false,
            resolve_daemon_script: ()=>'/tmp/daemon-entry.js',
            spawn_process: spawn_process as unknown as typeof import('child_process').spawn,
            wait_for_daemon: wait_for_ready,
        });

        expect(fs.existsSync(stale_pid_path)).toBe(false);
        expect(fs.existsSync(stale_socket_path)).toBe(false);
        expect(spawn_process).toHaveBeenCalledWith(
            '/usr/bin/node',
            ['/tmp/daemon-entry.js', '--daemon'],
            expect.objectContaining({
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                env: expect.objectContaining({
                    BRIGHTDATA_CDP_ENDPOINT: 'wss://example.test',
                    BRIGHTDATA_DAEMON: '1',
                    BRIGHTDATA_DAEMON_DIR: tmp_dir,
                    BRIGHTDATA_IDLE_TIMEOUT_MS: '4321',
                    BRIGHTDATA_SESSION: 'demo',
                }),
            })
        );
        expect(child.unref).toHaveBeenCalledTimes(1);
        expect(wait_for_ready).toHaveBeenCalledWith(
            'demo',
            1_234,
            expect.objectContaining({transport: expect.any(Object)}),
            expect.any(Object)
        );
    });

    it('skips spawning when the daemon is already alive', async()=>{
        const spawn_process = vi.fn();

        await ensure_daemon('demo', {
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
        }, {
            is_daemon_alive: async()=>true,
            spawn_process: spawn_process as unknown as typeof import('child_process').spawn,
        });

        expect(spawn_process).not.toHaveBeenCalled();
    });

    it('cleans up and kills the child when startup fails', async()=>{
        const child = new Mock_child();
        const spawn_process = vi.fn(()=>child as unknown as ChildProcess);
        const stale_pid_path = path.join(tmp_dir, 'demo.pid');
        fs.writeFileSync(stale_pid_path, '999');

        await expect(ensure_daemon('demo', {
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            exec_path: '/usr/bin/node',
        }, {
            is_daemon_alive: async()=>false,
            resolve_daemon_script: ()=>'/tmp/daemon-entry.js',
            spawn_process: spawn_process as unknown as typeof import('child_process').spawn,
            wait_for_daemon: async()=>{
                throw new Error('startup failed');
            },
        })).rejects.toThrow('startup failed');

        expect(child.kill).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(stale_pid_path)).toBe(false);
    });

    it('uses the daemon idle timeout default when none is provided', async()=>{
        const child = new Mock_child();
        const spawn_process = vi.fn(()=>child as unknown as ChildProcess);

        await ensure_daemon('demo', {
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            exec_path: '/usr/bin/node',
        }, {
            is_daemon_alive: async()=>false,
            resolve_daemon_script: ()=>'/tmp/daemon-entry.js',
            spawn_process: spawn_process as unknown as typeof import('child_process').spawn,
            wait_for_daemon: async()=>undefined,
        });

        expect(spawn_process).toHaveBeenCalledWith(
            '/usr/bin/node',
            ['/tmp/daemon-entry.js', '--daemon'],
            expect.objectContaining({
                env: expect.objectContaining({
                    BRIGHTDATA_IDLE_TIMEOUT_MS: String(DEFAULT_DAEMON_IDLE_TIMEOUT_MS),
                }),
            })
        );
    });
});
