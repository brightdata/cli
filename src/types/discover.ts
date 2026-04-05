type Discover_request = {
    query: string;
    intent?: string;
    city?: string;
    country?: string;
    filter_keywords?: string[];
    format?: 'json'|'md';
    include_content?: boolean;
    language?: string;
    num_results?: number;
    remove_duplicates?: boolean;
    start_date?: string;
    end_date?: string;
};

type Discover_trigger_response = {
    status: string;
    task_id: string;
};

type Discover_result = {
    link: string;
    title: string;
    description: string;
    relevance_score: number;
    content?: string|null;
};

type Discover_poll_response = {
    status: string;
    duration_seconds?: number;
    results?: Discover_result[];
};

type Discover_opts = {
    intent?: string;
    city?: string;
    country?: string;
    language?: string;
    numResults?: string;
    filterKeywords?: string;
    includeContent?: boolean;
    removeDuplicates?: boolean;
    startDate?: string;
    endDate?: string;
    timeout?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

export type {
    Discover_request,
    Discover_trigger_response,
    Discover_result,
    Discover_poll_response,
    Discover_opts,
};
