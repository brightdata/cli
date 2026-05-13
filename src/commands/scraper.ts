import {Command} from 'commander';
import {post, get} from '../utils/client';
import {ensure_authenticated} from '../utils/auth';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout, poll_until} from '../utils/polling';
import {print, success, fail, dim, is_tty} from '../utils/output';
import type {
    Create_template_request,
    Create_template_response,
    Trigger_ai_request,
    Trigger_ai_response,
    Ai_progress_response,
    Scraper_create_opts,
} from '../types/scraper';

const CREATE_TEMPLATE_ENDPOINT = '/dca/collector';
const AI_TRIGGER_PATH = 'automate_template';
const AI_PROGRESS_PATH = 'automate_template/progress';
const RUNNING_SENTINEL = '__running__';
const DONE_STATUS = 'done';

const build_template_request = (
    opts: Scraper_create_opts
): Create_template_request=>({
    name: opts.name ?? `cli-scraper-${Math.floor(Date.now()/1000)}`,
    deliver: {
        type: 'webhook',
        endpoint: opts.deliverWebhook ?? 'https://example.com/webhook',
        filename: {template: 'data', extension: 'json'},
    },
});

const build_ai_request = (
    url: string,
    description: string
): Trigger_ai_request=>({
    description,
    urls: [url],
});

const extract_progress_status = (
    result: Ai_progress_response
): string|undefined=>{
    if (!result || typeof result != 'object')
        return undefined;
    if (typeof result.status != 'string')
        return undefined;
    if (result.status == DONE_STATUS)
        return DONE_STATUS;
    return RUNNING_SENTINEL;
};

const format_create_summary = (
    collector_id: string,
    name: string,
    progress: Ai_progress_response
): string=>{
    const steps = progress.completed_steps?.length ?? 0;
    const lines = [
        `Scraper created: ${name}`,
        `  Collector ID: ${collector_id}`,
        `  Completed steps: ${steps}`,
        `  View in web UI: https://brightdata.com/cp/scrapers`,
    ];
    return lines.join('\n');
};

const handle_create_scraper = async(
    url: string,
    description: string,
    opts: Scraper_create_opts
)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const template_body = build_template_request(opts);
    const create_spinner = start_spinner('Creating scraper template...');
    let collector_id = '';
    let scraper_name = template_body.name;
    try {
        const template = await post<Create_template_response>(
            api_key,
            CREATE_TEMPLATE_ENDPOINT,
            template_body,
            {timing: opts.timing}
        );
        create_spinner.stop();
        if (!template.id)
        {
            fail('Failed to create scraper template (missing id).');
            return;
        }
        collector_id = template.id;
        scraper_name = template.name ?? template_body.name;
        console.error(dim(`Template created: ${collector_id}`));
    } catch(e) {
        create_spinner.stop();
        console.error(
            `Failed to create scraper template: ${(e as Error).message}`);
        process.exit(1);
        return;
    }
    const trigger_spinner = start_spinner('Triggering AI generation...');
    try {
        await post<Trigger_ai_response>(
            api_key,
            `/dca/collectors/${collector_id}/${AI_TRIGGER_PATH}`,
            build_ai_request(url, description),
            {timing: opts.timing}
        );
        trigger_spinner.stop();
    } catch(e) {
        trigger_spinner.stop();
        console.error(
            `Failed to start AI generation for collector `
            +`${collector_id}: ${(e as Error).message}`
        );
        process.exit(1);
        return;
    }
    const poll_spinner = start_spinner('Generating scraper...');
    try {
        const poll_result = await poll_until<Ai_progress_response>({
            timeout_seconds: timeout,
            fetch_once: ()=>get<Ai_progress_response>(
                api_key,
                `/dca/collectors/${collector_id}/${AI_PROGRESS_PATH}`,
                {timing: opts.timing}
            ),
            get_status: extract_progress_status,
            running_statuses: [RUNNING_SENTINEL],
            timeout_label: `AI generation (collector ${collector_id})`,
            on_running: ({attempt, timeout_seconds, result})=>{
                const step = result.step ?? 'pending';
                console.error(dim(
                    `Step: ${step} — polling `
                    +`(attempt ${attempt}/${timeout_seconds})`
                ));
            },
        });
        poll_spinner.stop();
        console.error(dim(
            `Done in ${poll_result.attempts} poll attempts.`));
        const progress = poll_result.result;
        if (progress.status != DONE_STATUS)
        {
            console.error(
                `AI generation failed (collector ${collector_id}, `
                +`status: ${progress.status}).`
            );
            process.exit(1);
            return;
        }
        const print_opts = {json: opts.json, pretty: opts.pretty,
            output: opts.output};
        if (opts.json || opts.pretty || opts.output || !is_tty)
        {
            print(progress, print_opts);
            return;
        }
        success(format_create_summary(
            collector_id, scraper_name, progress));
    } catch(e) {
        poll_spinner.stop();
        console.error(
            `${(e as Error).message} (collector ${collector_id})`);
        process.exit(1);
        return;
    }
};

const scraper_command = new Command('scraper')
    .description('Build and manage Bright Data scrapers');

export {
    scraper_command,
    handle_create_scraper,
    build_template_request,
    build_ai_request,
    extract_progress_status,
    format_create_summary,
};
