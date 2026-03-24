import net from 'net';
import os from 'os';
import path from 'path';

const DEFAULT_SESSION_NAME = 'default';
const DEFAULT_IPC_TIMEOUT_MS = 30_000;
const WINDOWS_PORT_BASE = 49_152;
const WINDOWS_PORT_SPAN = 16_383;

type Json_object = Record<string, unknown>;

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

type Ipc_opts = Path_opts & {
    timeout_ms?: number;
    transport?: Daemon_transport;
};

const is_object = (value: unknown): value is Json_object=>{
    return !!value && typeof value == 'object' && !Array.isArray(value);
};

const get_path_api = (platform: NodeJS.Platform)=>
    platform == 'win32' ? path.win32 : path.posix;

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

const normalize_timeout_ms = (timeout_ms: number|undefined): number=>{
    if (timeout_ms === undefined)
        return DEFAULT_IPC_TIMEOUT_MS;
    if (!Number.isFinite(timeout_ms) || timeout_ms < 0)
        throw new Error('IPC timeout must be a non-negative number of milliseconds.');
    return Math.floor(timeout_ms);
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

const parse_daemon_request = (value: unknown): Daemon_request=>{
    if (!is_object(value))
        throw new Error('Daemon request must be an object.');
    const {id, action, params} = value;
    if (typeof id != 'string' || !id.trim())
        throw new Error('Daemon request id must be a non-empty string.');
    if (typeof action != 'string' || !action.trim())
        throw new Error('Daemon request action must be a non-empty string.');
    if (params !== undefined && !is_object(params))
        throw new Error('Daemon request params must be an object when provided.');
    return {
        id: id.trim(),
        action: action.trim(),
        params,
    };
};

const parse_daemon_response = (value: unknown): Daemon_response=>{
    if (!is_object(value))
        throw new Error('Daemon response must be an object.');
    const {id, success, error} = value;
    if (typeof id != 'string' || !id.trim())
        throw new Error('Daemon response id must be a non-empty string.');
    if (typeof success != 'boolean')
        throw new Error('Daemon response success must be a boolean.');
    if (error !== undefined && typeof error != 'string')
        throw new Error('Daemon response error must be a string when provided.');
    return {
        id: id.trim(),
        success,
        data: value['data'],
        error,
    };
};

const connect_socket = async(
    session_name: string,
    opts: Ipc_opts = {}
): Promise<net.Socket>=>{
    const transport = opts.transport ?? get_daemon_transport(session_name, opts);
    const timeout_ms = normalize_timeout_ms(opts.timeout_ms);
    const socket = transport.kind == 'unix'
        ? net.createConnection(transport.socket_path)
        : net.createConnection(transport.port, transport.host);
    socket.setEncoding('utf8');
    socket.setTimeout(timeout_ms);

    await new Promise<void>((resolve, reject)=>{
        const on_connect = ()=>{
            cleanup();
            resolve();
        };
        const on_error = (error: Error)=>{
            cleanup();
            socket.destroy();
            reject(error);
        };
        const on_timeout = ()=>{
            cleanup();
            socket.destroy();
            reject(new Error(
                `Timed out connecting to browser daemon session "${normalize_session_name(session_name)}".`
            ));
        };
        const cleanup = ()=>{
            socket.off('connect', on_connect);
            socket.off('error', on_error);
            socket.off('timeout', on_timeout);
        };

        socket.once('connect', on_connect);
        socket.once('error', on_error);
        socket.once('timeout', on_timeout);
    });

    return socket;
};

const read_line = async(socket: net.Socket): Promise<string>=>{
    return await new Promise((resolve, reject)=>{
        let buffer = '';
        const on_data = (chunk: Buffer|string)=>{
            buffer += chunk.toString();
            const newline_index = buffer.indexOf('\n');
            if (newline_index < 0)
                return;
            cleanup();
            resolve(buffer.slice(0, newline_index));
        };
        const on_close = ()=>{
            cleanup();
            reject(new Error(
                'Browser daemon closed the connection before sending a response.'
            ));
        };
        const on_error = (error: Error)=>{
            cleanup();
            reject(error);
        };
        const on_timeout = ()=>{
            cleanup();
            reject(new Error('Timed out waiting for browser daemon response.'));
        };
        const cleanup = ()=>{
            socket.off('data', on_data);
            socket.off('close', on_close);
            socket.off('end', on_close);
            socket.off('error', on_error);
            socket.off('timeout', on_timeout);
        };

        socket.on('data', on_data);
        socket.once('close', on_close);
        socket.once('end', on_close);
        socket.once('error', on_error);
        socket.once('timeout', on_timeout);
    });
};

const write_line = async(socket: net.Socket, line: string): Promise<void>=>{
    await new Promise((resolve, reject)=>{
        const on_error = (error: Error)=>{
            cleanup();
            reject(error);
        };
        const on_timeout = ()=>{
            cleanup();
            reject(new Error('Timed out writing to the browser daemon socket.'));
        };
        const cleanup = ()=>{
            socket.off('error', on_error);
            socket.off('timeout', on_timeout);
        };

        socket.once('error', on_error);
        socket.once('timeout', on_timeout);
        socket.write(line, ()=>{
            cleanup();
            resolve(undefined);
        });
    });
};

const send_command = async(
    session_name: string,
    request: Daemon_request,
    opts: Ipc_opts = {}
): Promise<Daemon_response>=>{
    const normalized_request = parse_daemon_request(request);
    const socket = await connect_socket(session_name, opts);
    try {
        await write_line(socket, JSON.stringify(normalized_request)+'\n');
        let line: string;
        try {
            line = await read_line(socket);
        } catch(error) {
            throw error;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch(error) {
            throw new Error(
                'Browser daemon returned invalid JSON: '
                +(error as Error).message
            );
        }
        const response = parse_daemon_response(parsed);
        if (response.id != normalized_request.id)
        {
            throw new Error(
                `Browser daemon response id mismatch: expected "${normalized_request.id}", got "${response.id}".`
            );
        }
        return response;
    } finally {
        socket.destroy();
    }
};

export {
    DEFAULT_IPC_TIMEOUT_MS,
    DEFAULT_SESSION_NAME,
    connect_socket,
    get_daemon_base_dir,
    get_daemon_transport,
    get_port_for_session,
    normalize_session_name,
    parse_daemon_request,
    parse_daemon_response,
    read_line,
    send_command,
};
export type {
    Daemon_request,
    Daemon_response,
    Daemon_transport,
    Ipc_opts,
    Json_object,
    Path_opts,
};
