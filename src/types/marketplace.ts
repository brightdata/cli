// Dataset Marketplace: querying pre-collected records. Distinct from the
// /datasets/v3/* Web Scraper API that `pipelines` uses — that one collects new
// data and bills for scraping; this one filters data Bright Data already holds.
// Note the formats differ too: no ndjson here.
type Marketplace_format = 'json'|'jsonl'|'csv';

type Dataset_info = {
    id: string;
    name?: string;
    size?: number;      // record count
};

type Dataset_field = {
    type?: string;      // text | number | url | array | object | boolean
    active?: boolean;
    required?: boolean;
    description?: string;
};

type Dataset_metadata = {
    id?: string;
    fields?: Record<string, Dataset_field>;
};

type Snapshot_status = {
    id?: string;
    snapshot_id?: string;
    status?: 'scheduled'|'building'|'ready'|'failed'|string;
    dataset_id?: string;
    dataset_size?: number;   // records
    file_size?: number;      // bytes
    cost?: number;
    error?: string;
    error_message?: string;
    failure_reason?: string;
    message?: string;
    // A zero-match query comes back as status:failed with these set, rather
    // than as a ready snapshot holding no rows.
    warning?: string;
    warning_code?: string;
};

// records_limit is optional in the API but REQUIRED by this CLI: omitting it
// means "no cap" against datasets holding hundreds of millions of records, and
// cost is only observable after the query is committed.
type Filter_request = {
    dataset_id: string;
    filter: unknown;
    records_limit: number;
};

type Filter_response = {
    snapshot_id?: string;
    error?: string;
    message?: string;
    failure_reason?: string;
};

type Marketplace_opts = {
    dataset?: string;
    datasetId?: string;
    filter?: string;
    filterFile?: string;
    recordsLimit?: string;
    featured?: boolean;
    search?: string;
    format?: string;
    timeout?: string;
    wait?: boolean;
    async?: boolean;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

export type {
    Marketplace_format,
    Dataset_info,
    Dataset_field,
    Dataset_metadata,
    Snapshot_status,
    Filter_request,
    Filter_response,
    Marketplace_opts,
};
