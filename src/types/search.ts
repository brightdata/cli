type Search_engine = 'google'|'bing'|'yandex';

type Search_type = 'web'|'news'|'images'|'shopping';

type Search_device = 'desktop'|'mobile';

type Organic_result = {
    rank: number;
    global_rank?: number;
    title: string;
    link: string;
    description?: string;
};

type Search_general = {
    search_engine: string;
    query: string;
    results_cnt?: number;
    language?: string;
    device?: string;
};

type Search_response = {
    general?: Search_general;
    organic?: Organic_result[];
    paid?: unknown[];
    product_listing_ads?: unknown[];
    knowledge_graph?: unknown;
    people_also_ask?: unknown[];
    related_searches?: unknown[];
    maps?: unknown[];
    news?: unknown[];
    videos?: unknown[];
    recipes?: unknown[];
    perspectives?: unknown[];
};

type Search_opts = {
    engine?: string;
    country?: string;
    language?: string;
    page?: string;
    type?: string;
    zone?: string;
    device?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

export type {
    Search_engine,
    Search_type,
    Search_device,
    Organic_result,
    Search_general,
    Search_response,
    Search_opts,
};
