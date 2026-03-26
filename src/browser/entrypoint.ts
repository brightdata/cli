import {start_daemon_from_env} from './daemon';

const DAEMON_ARG = '--daemon';

type Daemon_like = {
    stop: ()=>Promise<void>;
};

type Process_once = (
    event: NodeJS.Signals,
    listener: ()=>void
)=>NodeJS.Process;

type Browser_daemon_entrypoint_deps = {
    argv?: string[];
    env?: NodeJS.ProcessEnv;
    exit?: (code: number)=>never|void;
    once?: Process_once;
    platform?: NodeJS.Platform;
    start_daemon?: (env?: NodeJS.ProcessEnv)=>Promise<Daemon_like>;
};

const is_browser_daemon_process = (
    argv: string[] = process.argv,
    env: NodeJS.ProcessEnv = process.env
): boolean=>{
    return env['BRIGHTDATA_DAEMON'] == '1' || argv.includes(DAEMON_ARG);
};

const get_browser_daemon_signals = (
    platform: NodeJS.Platform = process.platform
): NodeJS.Signals[]=>{
    if (platform == 'win32')
        return ['SIGINT', 'SIGTERM'];
    return ['SIGHUP', 'SIGINT', 'SIGTERM'];
};

const start_browser_daemon_process = async(
    deps: Browser_daemon_entrypoint_deps = {}
): Promise<Daemon_like>=>{
    const env = deps.env ?? process.env;
    const once = deps.once ?? (process.once.bind(process) as Process_once);
    const exit = deps.exit ?? process.exit;
    const daemon = await (deps.start_daemon ?? start_daemon_from_env)(env);
    let stop_promise: Promise<void>|null = null;

    const stop = ()=>{
        if (!stop_promise)
        {
            stop_promise = daemon.stop()
                .catch(()=>undefined)
                .finally(()=>{
                    exit(0);
                });
        }
    };

    for (const signal of get_browser_daemon_signals(deps.platform))
        once(signal, ()=>stop());

    return daemon;
};

const maybe_run_browser_daemon = async(
    deps: Browser_daemon_entrypoint_deps = {}
): Promise<boolean>=>{
    const argv = deps.argv ?? process.argv;
    const env = deps.env ?? process.env;
    if (!is_browser_daemon_process(argv, env))
        return false;

    await start_browser_daemon_process({...deps, env});
    return true;
};

export {
    DAEMON_ARG,
    get_browser_daemon_signals,
    is_browser_daemon_process,
    maybe_run_browser_daemon,
    start_browser_daemon_process,
};
export type {Browser_daemon_entrypoint_deps, Daemon_like};
