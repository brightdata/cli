type Scrape_format = 'markdown'|'html'|'screenshot'|'json';

type Scrape_request = {
    zone: string;
    url: string;
    format: 'raw'|'json';
    country?: string;
    data_format?: 'markdown'|'screenshot';
    async?: boolean;
};

type Scrape_response_json = {
    status: number;
    headers: Record<string, string>;
    body: string;
};

type Scrape_async_response = {
    response_id: string;
};

type Scrape_opts = {
    format?: Scrape_format;
    country?: string;
    zone?: string;
    mobile?: boolean;
    async?: boolean;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

export type {
    Scrape_format,
    Scrape_request,
    Scrape_response_json,
    Scrape_async_response,
    Scrape_opts,
};
