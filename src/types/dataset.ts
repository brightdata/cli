type Webdata_format = 'json'|'csv'|'ndjson'|'jsonl';

type Webdata_opts = {
    format?: string;
    timeout?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

type Trigger_response = {
    snapshot_id?: string;
};

type Snapshot_status = 'starting'|'building'|'running'|'ready'|'failed'|string;

type Snapshot_meta = {
    status?: Snapshot_status;
};

export type {
    Webdata_format,
    Webdata_opts,
    Trigger_response,
    Snapshot_status,
    Snapshot_meta,
};
