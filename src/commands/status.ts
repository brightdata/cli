import {Command} from 'commander';
import {ensure_authenticated} from '../utils/auth';
import {get} from '../utils/client';
import {start as start_spinner} from '../utils/spinner';
import {print, dim, fail} from '../utils/output';
import {parse_timeout, poll_until} from '../utils/polling';

const PROGRESS_ENDPOINT = '/datasets/v3/progress';
const RUNNING_STATUSES = ['starting', 'building', 'running', 'pending',
     'queued'];

type Status_opts = {
    wait?: boolean;
    timeout?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

type Job_status = {
    status?: string;
    state?: string;
};

const extract_status = (result: unknown): string|undefined=>{
    if (!result || typeof result != 'object')
        return undefined;
    const body = result as Job_status;
    if (typeof body.status == 'string')
        return body.status;
    if (typeof body.state == 'string')
        return body.state;
    return undefined;
};

const fetch_status = async(
    api_key: string,
    job_id: string,
    timing: boolean|undefined
): Promise<unknown>=>{
    const endpoint = `${PROGRESS_ENDPOINT}/${job_id}`;
    return get<unknown>(api_key, endpoint, {timing});
};

const handle_status = async(job_id: string, opts: Status_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const spinner = start_spinner(`Checking status for "${job_id}"...`);
    try {
        let result = await fetch_status(api_key, job_id, opts.timing);
        spinner.stop();
        if (!opts.wait)
        {
            print(result, {json: opts.json, pretty: opts.pretty, 
                output: opts.output});
            return;
        }
        let timeout = 600;
        try {
            timeout = parse_timeout(opts.timeout);
        } catch(e) {
            fail((e as Error).message);
            return;
        }
        const first_status = extract_status(result);
        if (!first_status || !RUNNING_STATUSES.includes(first_status))
        {
            print(result, {
                json: opts.json,
                pretty: opts.pretty,
                output: opts.output,
            });
            return;
        }
        if (timeout <= 1)
        {
            fail(`Timeout after ${timeout} seconds waiting for completion.`);
            return;
        }
        console.error(dim(
            `Status: ${first_status} - polling again `
            +`(attempt 1/${timeout})`
        ));
        const poll_result = await poll_until<unknown>({
            timeout_seconds: timeout-1,
            fetch_once: ()=>fetch_status(api_key, job_id, opts.timing),
            get_status: extract_status,
            running_statuses: RUNNING_STATUSES,
            timeout_label: 'completion',
            on_running: ({attempt, timeout_seconds, status})=>{
                console.error(dim(
                    `Status: ${status} - polling again `
                    +`(attempt ${attempt+1}/${timeout_seconds+1})`
                ));
            },
        });
        result = poll_result.result;
        print(result, {
            json: opts.json,
            pretty: opts.pretty,
            output: opts.output,
        });
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const status_command = new Command('status')
    .description('Check status of an async Web Scraper snapshot job')
    .argument('<job-id>', 'Snapshot ID returned by trigger request')
    .option('--wait', 'Poll until the job is complete')
    .option('--timeout <seconds>',
        'Polling timeout in seconds (default: 600 or' +
        'BRIGHTDATA_POLLING_TIMEOUT)')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_status);

export {status_command, handle_status};
