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
    _url: string,
    _description: string,
    _opts: Scraper_create_opts
)=>{
    // Implemented in Task 3
    throw new Error('not implemented');
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
