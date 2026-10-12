import {get, post} from './client';
import {poll_until} from './polling';
import type {Poll_running_cb} from './polling';
import type {Trigger_response} from '../types/dataset';
import type {Run_request, Results_response} from '../types/pipelines';

const PENDING = ['starting', 'building', 'running'];
const DISCOVER = 'discover_by_';
const enc = encodeURIComponent;

type Call_opts = {
    headers?: Record<string, string>;
    timing?: boolean;
};

type Wait_opts = Call_opts & {
    format?: string;
    timeout_seconds: number;
    interval_ms?: number;
    on_running?: Poll_running_cb<Results_response>;
};

const scraper_headers = (dataset_id: string, method: string)=>({
    'x-mcp-dataset-id': dataset_id,
    'x-mcp-method': method,
});

const step = async<T>(name: string, call: Promise<T>): Promise<T>=>{
    try {
        return await call;
    } catch(e) {
        throw new Error(`${name} failed. ${(e as Error).message}`);
    }
};

const strip_nulls = (data: unknown): unknown=>JSON.parse(
    JSON.stringify(data, (_k, v)=>v === null ? undefined : v));

const is_pending = (data: unknown): boolean=>!!data
    && typeof data == 'object' && !Array.isArray(data)
    && PENDING.includes((data as {status?: string}).status ?? '');

const trigger = async(api_key: string, req: Run_request,
    opts: Call_opts = {}): Promise<string>=>{
    const params = new URLSearchParams({dataset_id: req.dataset_id,
        include_errors: 'true'});
    if (req.method.startsWith(DISCOVER))
    {
        params.set('type', 'discover_new');
        params.set('discover_by', req.method.slice(DISCOVER.length));
        params.set('limit_per_input', String(req.limit_per_input ?? 10));
    }
    const res = await step('trigger', post<Trigger_response>(api_key,
        `/datasets/v3/trigger?${params}`, req.input, opts));
    if (!res?.snapshot_id)
        throw new Error('trigger failed. No snapshot_id returned.');
    return res.snapshot_id;
};

const progress = (api_key: string, snapshot_id: string,
    opts: Call_opts = {})=>step('progress', get<unknown>(api_key,
    `/datasets/v3/progress/${enc(snapshot_id)}`, opts));

const results = async(api_key: string, snapshot_id: string,
    opts: Call_opts & {format?: string} = {}): Promise<Results_response>=>{
    const {format = 'json', ...call_opts} = opts;
    const data = await step('results', get<unknown>(api_key,
        `/datasets/v3/snapshot/${enc(snapshot_id)}?format=${enc(format)}`,
        call_opts));
    if (is_pending(data))
        return {snapshot_id, status: 'running'};
    return {snapshot_id, status: 'ready',
        data: format == 'json' ? strip_nulls(data) : data};
};

const wait_for_results = async(api_key: string, snapshot_id: string,
    opts: Wait_opts): Promise<Results_response>=>{
    const {timeout_seconds, interval_ms, on_running, ...call_opts} = opts;
    const res = await poll_until<Results_response>({
        timeout_seconds,
        interval_ms,
        fetch_once: ()=>results(api_key, snapshot_id, call_opts),
        get_status: r=>r.status,
        running_statuses: ['running'],
        timeout_label: `snapshot ${snapshot_id}`,
        on_running,
    });
    return res.result;
};

export {
    scraper_headers,
    strip_nulls,
    trigger,
    progress,
    results,
    wait_for_results,
};
