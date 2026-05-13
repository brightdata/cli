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
};

export type {
    Deliver_webhook,
    Create_template_request,
    Create_template_response,
    Trigger_ai_request,
    Trigger_ai_response,
    Ai_progress_response,
    Scraper_create_opts,
};
