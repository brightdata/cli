import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import type {ChildProcess} from 'child_process';
import {DEFAULT_DAEMON_IDLE_TIMEOUT_MS} from './daemon';
import {
    connect_socket,
    get_daemon_transport,
    normalize_session_name,
    send_command as send_ipc_command,
} from './ipc';
import type {
    Daemon_request,
    Daemon_response,
    Daemon_transport,
    Ipc_opts,
} from './ipc';

const DEFAULT_DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_LIVENESS_TIMEOUT_MS = 150;
const DAEMON_POLL_INTERVAL_MS = 100;

type Daemon_opts = Ipc_opts & {
    cdp_endpoint: string;
    daemon_script?: string;
    exec_path?: string;
    idle_timeout_ms?: number;
    startup_timeout_ms?: number;
};

type Lifecycle_deps = {
    current_time?: ()=>number;
    is_daemon_alive?: (session_name: string, opts?: Ipc_opts)=>Promise<boolean>;
    pause?: (ms: number)=>Promise<void>;
    resolve_daemon_script?: (opts: Daemon_opts)=>string;
    resolve_exec_path?: (opts: Daemon_opts)=>string;
    spawn_process?: typeof spawn;
    wait_for_daemon?: (
        session_name: string,
        timeout_ms: number,
        opts?: Ipc_opts,
        deps?: Pick<Lifecycle_deps, 'current_time'|'is_daemon_alive'|'pause'>,
    )=>Promise<void>;
};

const pause = async(ms: number)=>{
    await new Promise(resolve=>setTimeout(resolve, ms));
};

const normalize_startup_timeout = (timeout_ms: number|undefined): number=>{
    if (timeout_ms === undefined)
        return DEFAULT_DAEMON_STARTUP_TIMEOUT_MS;
    if (!Number.isFinite(timeout_ms) || timeout_ms < 0)
    {
        throw new Error(
            'Browser daemon startup timeout must be a non-negative number of '
            +'milliseconds.'
        );
    }
    return Math.floor(timeout_ms);
};

const ensure_transport_dir = (transport: Daemon_transport)=>{
    fs.mkdirSync(transport.base_dir, {recursive: true});

    const write_probe = path.join(
        transport.base_dir,
        `.daemon-write-test-${process.pid}`
    );
    try {
        fs.writeFileSync(write_probe, '');
    } catch(error) {
        throw new Error(
            `Browser daemon directory "${transport.base_dir}" is not writable: `
            +`${(error as Error).message}`
        );
    } finally {
        fs.rmSync(write_probe, {force: true});
    }

    if (transport.kind == 'unix' && transport.socket_path.length > 103)
    {
        throw new Error(
            `Browser session "${path.basename(transport.socket_path, '.sock')}" `
            +`is too long for a Unix socket path `
            +`(${transport.socket_path.length} bytes). Use a shorter session `
            +'name or daemon directory.'
        );
    }
};

const format_transport = (transport: Daemon_transport): string=>{
    if (transport.kind == 'unix')
        return transport.socket_path;
    return `${transport.host}:${transport.port}`;
};

const cleanup_stale_files = (session_name: string, opts: Ipc_opts = {})=>{
    const transport = get_daemon_transport(session_name, opts);
    fs.rmSync(transport.pid_path, {force: true});
    if (transport.kind == 'unix')
        fs.rmSync(transport.socket_path, {force: true});
    else
        fs.rmSync(transport.port_path, {force: true});
};

const is_daemon_alive = async(
    session_name: string,
    opts: Ipc_opts = {}
): Promise<boolean>=>{
    try {
        const socket = await connect_socket(session_name, {
            ...opts,
            timeout_ms: opts.timeout_ms ?? DEFAULT_LIVENESS_TIMEOUT_MS,
        });
        socket.destroy();
        return true;
    } catch(_error) {
        return false;
    }
};

const wait_for_daemon = async(
    session_name: string,
    timeout_ms = DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
    opts: Ipc_opts = {},
    deps: Pick<Lifecycle_deps, 'current_time'|'is_daemon_alive'|'pause'> = {}
): Promise<void>=>{
    const startup_timeout_ms = normalize_startup_timeout(timeout_ms);
    const now = deps.current_time ?? (()=>Date.now());
    const check_alive = deps.is_daemon_alive ?? is_daemon_alive;
    const sleep = deps.pause ?? pause;
    const deadline = now() + startup_timeout_ms;

    while (true)
    {
        if (await check_alive(session_name, opts))
            return;
        if (now() >= deadline)
            break;
        await sleep(Math.min(DAEMON_POLL_INTERVAL_MS, Math.max(0, deadline-now())));
    }

    const transport = opts.transport ?? get_daemon_transport(session_name, opts);
    throw new Error(
        `Timed out waiting for browser daemon session `
        +`"${normalize_session_name(session_name)}" to start at `
        +`${format_transport(transport)}.`
    );
};

const resolve_daemon_script = (opts: Daemon_opts): string=>{
    const override = opts.daemon_script?.trim();
    if (override)
        return override;

    const compiled_entry = path.join(__dirname, '..', 'index.js');
    if (fs.existsSync(compiled_entry))
        return compiled_entry;

    const fallback = process.argv[1]?.trim();
    if (fallback)
        return fallback;

    throw new Error('Could not resolve the browser daemon entry script.');
};

const resolve_exec_path = (opts: Daemon_opts): string=>{
    const resolved = opts.exec_path?.trim() || process.execPath;
    if (!resolved)
    {
        throw new Error(
            'Could not resolve the Node.js executable for browser daemon spawn.'
        );
    }
    return resolved;
};

const create_child_startup_guard = (child: ChildProcess)=>{
    let cleanup = ()=>undefined;
    const promise = new Promise<never>((_, reject)=>{
        const on_error = (error: Error)=>{
            cleanup();
            reject(error);
        };
        const on_exit = (code: number|null, signal: NodeJS.Signals|null)=>{
            cleanup();
            const suffix = code !== null
                ? ` with code ${code}`
                : signal
                    ? ` from signal ${signal}`
                    : '';
            reject(new Error(`Browser daemon exited during startup${suffix}.`));
        };

        cleanup = ()=>{
            child.off?.('error', on_error);
            child.off?.('exit', on_exit);
        };

        child.once?.('error', on_error);
        child.once?.('exit', on_exit);
    });
    return {cleanup, promise};
};

const ensure_daemon = async(
    session_name: string,
    opts: Daemon_opts,
    deps: Lifecycle_deps = {}
): Promise<void>=>{
    const normalized_session_name = normalize_session_name(session_name);
    const normalized_cdp_endpoint = opts.cdp_endpoint?.trim();
    if (!normalized_cdp_endpoint)
        throw new Error('Browser daemon CDP endpoint cannot be empty.');

    const transport = opts.transport ?? get_daemon_transport(normalized_session_name, opts);
    const check_alive = deps.is_daemon_alive ?? is_daemon_alive;
    const await_daemon = deps.wait_for_daemon ?? wait_for_daemon;
    if (await check_alive(normalized_session_name, {...opts, transport}))
        return;

    cleanup_stale_files(normalized_session_name, {...opts, transport});
    ensure_transport_dir(transport);

    const exec_path = (deps.resolve_exec_path ?? resolve_exec_path)(opts);
    const daemon_script = (deps.resolve_daemon_script ?? resolve_daemon_script)(opts);
    const spawn_process = deps.spawn_process ?? spawn;
    const startup_timeout_ms = normalize_startup_timeout(opts.startup_timeout_ms);
    const base_env = opts.env ?? process.env;
    const child = spawn_process(exec_path, [daemon_script, '--daemon'], {
        detached: true,
        env: {
            ...base_env,
            BRIGHTDATA_CDP_ENDPOINT: normalized_cdp_endpoint,
            BRIGHTDATA_DAEMON: '1',
            BRIGHTDATA_DAEMON_DIR: opts.daemon_dir ?? base_env['BRIGHTDATA_DAEMON_DIR'],
            BRIGHTDATA_IDLE_TIMEOUT_MS: String(
                opts.idle_timeout_ms ?? base_env['BRIGHTDATA_IDLE_TIMEOUT_MS']
                    ?? DEFAULT_DAEMON_IDLE_TIMEOUT_MS
            ),
            BRIGHTDATA_SESSION: normalized_session_name,
        },
        stdio: 'ignore',
        windowsHide: true,
    });
    child.unref?.();

    const guard = create_child_startup_guard(child);
    try {
        await Promise.race([
            await_daemon(normalized_session_name, startup_timeout_ms, {
                ...opts,
                transport,
            }, deps),
            guard.promise,
        ]);
    } catch(error) {
        try {
            child.kill();
        } catch(_kill_error) {}
        cleanup_stale_files(normalized_session_name, {...opts, transport});
        throw error;
    } finally {
        guard.cleanup();
    }
};

const send_command = async(
    session_name: string,
    request: Daemon_request,
    opts: Ipc_opts = {}
): Promise<Daemon_response>=>{
    return send_ipc_command(session_name, request, opts);
};

export {
    DEFAULT_DAEMON_STARTUP_TIMEOUT_MS,
    DEFAULT_LIVENESS_TIMEOUT_MS,
    cleanup_stale_files,
    ensure_daemon,
    format_transport,
    is_daemon_alive,
    resolve_daemon_script,
    resolve_exec_path,
    send_command,
    wait_for_daemon,
};
export type {Daemon_opts, Lifecycle_deps};
