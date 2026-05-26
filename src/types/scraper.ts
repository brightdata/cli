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
};

type Batch_trigger_response = {
    collection_id: string;
    start_eta?: string;
};

type Batch_pending_response = {
    status: string;
    message?: string;
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
};
