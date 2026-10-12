type Scraper_entry = {
    dataset_id: string;
    name: string;
    domain: string;
    collection_methods: string[];
};

type Input_field = {
    name: string;
    type: string;
    required: boolean;
    description?: string;
};

type Output_field = {
    name: string;
    description?: string;
};

type Input_record = Record<string, unknown>;

type Scraper_details = {
    dataset_id: string;
    name: string;
    domain: string;
    description: string|null;
    method: string;
    source: 'api'|'docs';
    input_fields: Input_field[];
    output_fields: Output_field[];
    sample_input: Input_record[]|null;
    notes: string[];
};

type Run_request = {
    dataset_id: string;
    method: string;
    input: Input_record[];
    limit_per_input?: number;
};

type Results_response = {
    snapshot_id: string;
    status: 'running'|'ready';
    data?: unknown;
};

export type {
    Scraper_entry,
    Input_field,
    Output_field,
    Input_record,
    Scraper_details,
    Run_request,
    Results_response,
};
