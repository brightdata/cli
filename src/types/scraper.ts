type Deliver_webhook = {
    type: 'webhook';
    endpoint: string;
    filename: {
        template: string;
        extension: 'json'|'jsonl'|'csv';
    };
};

type Create_template_request = {
    name: string;
    deliver: Deliver_webhook;
};

type Create_template_response = {
    id: string;
    name?: string;
    zone?: string;
    active?: boolean;
    created?: string;
};

type Trigger_ai_request = {
    description: string;
    urls: string[];
};

type Trigger_ai_response = {
    id: string;
    queued: boolean;
};

type Ai_progress_response = {
    step?: string;
    completed_steps?: string[];
    status: string;
    diff?: unknown;
    preview_result?: unknown;
};

type Scraper_create_opts = {
    name?: string;
    deliverWebhook?: string;
    timeout?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
    legacyOutput?: boolean; // emit the pre-v0.3 bare payload to -o
    maxRetries?: string;
    retry?: boolean;
};

type Create_envelope = {
    collector_id: string;
    name: string;
    status: string;
    completed_steps: string[];
    view_url: string;
    created_at?: string;
    error?: string;
};

type Run_request = {
    url: string;
};

type Trigger_immediate_response = {
    response_id: string;
};

type Sync_timeout_response = {
    error: string;
    message?: string;
    response_id: string;
};

type Scraper_run_opts = {
    sync?: boolean;
    syncTimeout?: string;
    timeout?: string;
    name?: string;
    version?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
    urls?: string;
    inputFile?: string;
};

type Batch_trigger_response = {
    collection_id: string;
    start_eta?: string;
};

type Batch_pending_response = {
    status: string;
    message?: string;
};

type Refactor_request = {
    prompt: string;
    custom_input: unknown[];
};

type Heal_envelope = {
    collector_id: string;
    status: string;
    completed_steps: string[];
    prompt: string;
    view_url: string;
    next_step: string;
    preview_result?: unknown;
    diff_summary?: string;
    error?: string;
};

type Scraper_heal_opts = {
    url?: string;
    timeout?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
    legacyOutput?: boolean;
    maxRetries?: string;
    retry?: boolean;
};

type Refactor_resume_request = {
    message: boolean;
};

type Scraper_approve_opts = {
    reject?: boolean;
    url?: string;
    timeout?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
    legacyOutput?: boolean;
};

export type {
    Deliver_webhook,
    Create_template_request,
    Create_template_response,
    Trigger_ai_request,
    Trigger_ai_response,
    Ai_progress_response,
    Scraper_create_opts,
    Create_envelope,
    Run_request,
    Trigger_immediate_response,
    Sync_timeout_response,
    Scraper_run_opts,
    Batch_trigger_response,
    Batch_pending_response,
    Refactor_request,
    Heal_envelope,
    Scraper_heal_opts,
    Refactor_resume_request,
    Scraper_approve_opts,
};
