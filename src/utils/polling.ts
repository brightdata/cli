type Poll_running_cb<T> = (ctx: {
    attempt: number;
    timeout_seconds: number;
    status: string;
    result: T;
})=>void;

type Poll_opts<T> = {
    timeout_seconds: number;
    fetch_once: ()=>Promise<T>;
    get_status: (result: T)=>string|undefined;
    running_statuses: string[];
    interval_ms?: number;
    timeout_label?: string;
    on_running?: Poll_running_cb<T>;
};

type Poll_result<T> = {
    result: T;
    attempts: number;
    last_status?: string;
};

const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_POLL_INTERVAL_MS = 1000;

const sleep = (ms: number)=>new Promise(resolve=>setTimeout(resolve, ms));

const parse_timeout = (
    raw_timeout: string|undefined,
    env_key = 'BRIGHTDATA_POLLING_TIMEOUT'
): number=>{
    const timeout_raw = raw_timeout ?? process.env[env_key]
        ?? String(DEFAULT_TIMEOUT_SECONDS);
    const timeout = +timeout_raw;
    if (!Number.isFinite(timeout) || timeout <= 0)
    {
        throw new Error(
            `Invalid timeout "${timeout_raw}".\n`
            +'  Use a positive integer number of seconds.'
        );
    }
    return Math.floor(timeout);
};

const poll_until = async<T>(opts: Poll_opts<T>): Promise<Poll_result<T>>=>{
    const interval_ms = opts.interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout_label = opts.timeout_label ?? 'completion';
    // timeout_seconds is a wall-clock budget. The loop runs until this much
    // real time has elapsed, counting both each request round-trip and the
    // sleep interval. The previous version looped exactly timeout_seconds
    // times, so every request's round-trip pushed the real runtime well past
    // the stated budget (e.g. --timeout 600 took ~12 min, not ~10).
    const deadline = Date.now()+opts.timeout_seconds*1000;
    let attempt = 0;
    for (;;)
    {
        attempt++;
        const result = await opts.fetch_once();
        const status = opts.get_status(result);
        if (!status || !opts.running_statuses.includes(status))
        {
            return {
                result,
                attempts: attempt,
                last_status: status,
            };
        }
        if (opts.on_running)
        {
            opts.on_running({
                attempt,
                timeout_seconds: opts.timeout_seconds,
                status,
                result,
            });
        }
        // Stop before a sleep that would run past the budget.
        if (Date.now()+interval_ms >= deadline)
            break;
        await sleep(interval_ms);
    }
    throw new Error(
        `Timeout after ${opts.timeout_seconds} seconds `
        +`waiting for ${timeout_label}.`
    );
};

export {sleep, parse_timeout, poll_until};
export type {Poll_running_cb, Poll_opts, Poll_result};
