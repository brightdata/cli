import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {BrowserDaemon} from '../../browser/daemon';
import {
    connect_socket,
    get_daemon_base_dir,
    get_daemon_transport,
    get_port_for_session,
    parse_daemon_request,
    parse_daemon_response,
    read_line,
    send_command,
} from '../../browser/ipc';

const mk_tmp_dir = ()=>fs.mkdtempSync(path.join(os.tmpdir(), 'bdata-ipc-'));

const close_server = async(server: net.Server): Promise<void>=>{
    await new Promise(resolve=>server.close(()=>resolve(undefined)));
};

const listen_unix = async(server: net.Server, socket_path: string): Promise<void>=>{
    await new Promise((resolve, reject)=>{
        server.once('error', reject);
        server.listen(socket_path, ()=>resolve(undefined));
    });
};

const listen_tcp = async(server: net.Server, port: number): Promise<void>=>{
    await new Promise((resolve, reject)=>{
        server.once('error', reject);
        server.listen(port, '127.0.0.1', ()=>resolve(undefined));
    });
};

describe('browser/ipc', ()=>{
    let tmp_dir = '';
    let daemon: BrowserDaemon|null = null;
    let servers: net.Server[] = [];

    beforeEach(()=>{
        tmp_dir = mk_tmp_dir();
        daemon = null;
        servers = [];
    });

    afterEach(async()=>{
        if (daemon)
            await daemon.stop();
        await Promise.all(servers.map(close_server));
        fs.rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('validates requests, responses, and platform-specific paths', ()=>{
        expect(()=>parse_daemon_request({id: '', action: 'ping'}))
            .toThrow('Daemon request id must be a non-empty string.');
        expect(parse_daemon_request({
            id: ' req-1 ',
            action: ' ping ',
            params: {ok: true},
        })).toEqual({
            id: 'req-1',
            action: 'ping',
            params: {ok: true},
        });

        expect(()=>parse_daemon_response({id: 'r1', success: 'yes'}))
            .toThrow('Daemon response success must be a boolean.');
        expect(parse_daemon_response({
            id: ' res-1 ',
            success: true,
            data: {pong: true},
        })).toEqual({
            id: 'res-1',
            success: true,
            data: {pong: true},
            error: undefined,
        });

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
            kind: 'tcp',
            host: '127.0.0.1',
            port: get_port_for_session('shop'),
        });
    });

    it('sends commands to a real daemon over the unix socket transport', async()=>{
        if (process.platform == 'win32')
            return;

        daemon = new BrowserDaemon({
            cdp_endpoint: 'wss://example.test',
            daemon_dir: tmp_dir,
            idle_timeout_ms: 0,
            session_name: 'ipc-real',
        });
        await daemon.start();

        const response = await send_command('ipc-real', {
            id: 'req-1',
            action: 'status',
        }, {
            daemon_dir: tmp_dir,
            timeout_ms: 1_000,
        });

        expect(response).toMatchObject({
            id: 'req-1',
            success: true,
            data: {
                connected: false,
                session_name: 'ipc-real',
            },
        });
    });

    it('connects and reads line-delimited responses over the tcp transport', async()=>{
        const session_name = 'tcp-demo';
        const transport = get_daemon_transport(session_name, {
            home_dir: 'C:\\Users\\tester',
            platform: 'win32',
        });
        if (transport.kind != 'tcp')
            return;
        const server = net.createServer(socket=>{
            socket.setEncoding('utf8');
            let buffer = '';
            socket.on('data', chunk=>{
                buffer += chunk;
                const newline_index = buffer.indexOf('\n');
                if (newline_index < 0)
                    return;
                const request = parse_daemon_request(
                    JSON.parse(buffer.slice(0, newline_index))
                );
                socket.write(JSON.stringify({
                    id: request.id,
                    success: true,
                    data: {action: request.action},
                })+'\n');
            });
        });
        servers.push(server);
        await listen_tcp(server, transport.port);

        const response = await send_command(session_name, {
            id: 'req-2',
            action: 'ping',
        }, {
            home_dir: 'C:\\Users\\tester',
            platform: 'win32',
            timeout_ms: 1_000,
        });

        expect(response).toEqual({
            id: 'req-2',
            success: true,
            data: {action: 'ping'},
            error: undefined,
        });
    });

    it('reads a single line from a connected socket', async()=>{
        if (process.platform == 'win32')
            return;

        const transport = get_daemon_transport('ipc-line', {daemon_dir: tmp_dir});
        if (transport.kind != 'unix')
            return;

        const server = net.createServer(socket=>{
            socket.write('{"id":"req-3","success":true}');
            setTimeout(()=>socket.write('\nextra'), 5);
        });
        servers.push(server);
        await listen_unix(server, transport.socket_path);

        const socket = await connect_socket('ipc-line', {
            daemon_dir: tmp_dir,
            timeout_ms: 1_000,
        });
        const line = await read_line(socket);
        socket.destroy();

        expect(line).toBe('{"id":"req-3","success":true}');
    });

    it('rejects mismatched daemon response ids', async()=>{
        if (process.platform == 'win32')
            return;

        const transport = get_daemon_transport('ipc-bad-id', {daemon_dir: tmp_dir});
        if (transport.kind != 'unix')
            return;

        const server = net.createServer(socket=>{
            socket.setEncoding('utf8');
            socket.once('data', ()=>{
                socket.write(JSON.stringify({
                    id: 'unexpected',
                    success: true,
                })+'\n');
            });
        });
        servers.push(server);
        await listen_unix(server, transport.socket_path);

        await expect(send_command('ipc-bad-id', {
            id: 'req-4',
            action: 'status',
        }, {
            daemon_dir: tmp_dir,
            timeout_ms: 1_000,
        })).rejects.toThrow(
            'Browser daemon response id mismatch: expected "req-4", got "unexpected".'
        );
    });
});
