import fs from 'fs';
import path from 'path';
import {get} from './client';
import {get_config_dir} from './credentials';
import type {
    Scraper_entry,
    Scraper_details,
    Input_record,
} from '../types/pipelines';
import {USER_AGENT} from './user_agent';

const DOCS_URL = 'https://docs.brightdata.com';
const DETAILS_ENDPOINT = '/datasets/v3/scrapers';
const DAY_MS = 24*60*60*1000;
const FETCH_TIMEOUT_MS = 30_000;

type Raw_field = {
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
};

type Raw_method = {
    input_schema?: Raw_field[];
    output_fields?: Raw_field[];
    sample_input?: Input_record[];
};

type Raw_methods = Record<string, Raw_method>;

type Raw_dataset = {
    id?: string;
    description?: string;
    scrapers?: Raw_methods;
};

type Catalog_cache = {
    loaded_at: number;
    scrapers: Scraper_entry[];
};

type Catalog_opts = {
    docs_url?: string;
    cache_path?: string;
    ttl_ms?: number;
    now?: ()=>number;
};

const to_entry = (s: Partial<Scraper_entry>): Scraper_entry=>({
    dataset_id: String(s.dataset_id),
    name: String(s.name ?? '').trim(),
    domain: s.domain ?? '',
    collection_methods: s.collection_methods ?? [],
});

const score = (entry: Scraper_entry, words: string[]): number=>{
    const text = `${entry.name} ${entry.domain}`.toLowerCase();
    const id = entry.dataset_id.toLowerCase();
    return words.filter(w=>w.startsWith('gd_') ? id.includes(w)
        : text.includes(w)).length;
};

const to_method = (m: Raw_method, source: 'api'|'docs')=>({
    input_fields: (m.input_schema ?? []).map(f=>({name: f.name,
        type: f.type ?? 'text', required: !!f.required,
        description: f.description})),
    output_fields: (m.output_fields ?? []).map(f=>({name: f.name,
        description: f.description})),
    sample_input: source == 'api' && m.sample_input?.length
        ? m.sample_input : null,
});

const notes_for = (d: ReturnType<typeof to_method>,
    source: 'api'|'docs'): string[]=>{
    const notes: string[] = [];
    if (!d.sample_input)
    {
        notes.push(source == 'api' ? 'No example input for this method.'
            : 'Example input unavailable: details API failed.');
    }
    if (!d.input_fields.length)
        notes.push('This method has no documented input fields.');
    else if (!d.input_fields.some(f=>f.required))
        notes.push('This method has no required input fields.');
    return notes;
};

const fetch_json = async(url: string): Promise<unknown>=>{
    const res = await fetch(url, {
        headers: {'User-Agent': USER_AGENT},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok)
        throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    return res.json();
};

const create_scraper_catalog = (opts: Catalog_opts = {})=>{
    const docs_url = opts.docs_url ?? DOCS_URL;
    const cache_path = opts.cache_path
        ?? path.join(get_config_dir(), 'scrapers.json');
    const ttl_ms = opts.ttl_ms ?? DAY_MS;
    const now = opts.now ?? Date.now;
    let memo: Scraper_entry[]|null = null;
    const read_cache = (): Catalog_cache|null=>{
        try {
            const c = JSON.parse(fs.readFileSync(cache_path, 'utf8'));
            return Array.isArray(c?.scrapers) ? c : null;
        } catch(_e) {
            return null;
        }
    };
    const write_cache = (c: Catalog_cache)=>{
        try {
            fs.mkdirSync(path.dirname(cache_path), {recursive: true,
                mode: 0o700});
            fs.writeFileSync(cache_path, JSON.stringify(c), {mode: 0o600});
        } catch(e) {
            console.error(`Could not save the scraper list to ${cache_path}: `
                +(e as Error).message);
        }
    };
    const load_catalog = async(load_opts: {force?: boolean} = {})=>{
        if (memo && !load_opts.force)
            return memo;
        const cached = read_cache();
        if (cached && !load_opts.force && now()-cached.loaded_at < ttl_ms)
            return memo = cached.scrapers;
        try {
            const data = await fetch_json(`${docs_url}/scrapers.json`) as
                {scrapers?: Partial<Scraper_entry>[]};
            if (!Array.isArray(data?.scrapers))
                throw new Error('scrapers.json has no scrapers list');
            const scrapers = data.scrapers.map(to_entry);
            write_cache({loaded_at: now(), scrapers});
            return memo = scrapers;
        } catch(e) {
            if (!cached || load_opts.force)
                throw e;
            console.error('Scraper list refresh failed, using the copy from '
                +`${new Date(cached.loaded_at).toISOString()}: `
                +(e as Error).message);
            return memo = cached.scrapers;
        }
    };
    const search = async(query: string, limit = 10)=>{
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const list = await load_catalog();
        return list.map(entry=>({entry, n: score(entry, words)}))
            .filter(r=>r.n > 0)
            .sort((a, b)=>b.n-a.n || a.entry.name.localeCompare(b.entry.name))
            .slice(0, limit)
            .map(r=>r.entry);
    };
    const find = async(id: string)=>{
        const entry = (await load_catalog()).find(s=>s.dataset_id == id);
        if (!entry)
        {
            throw new Error(`Unknown dataset_id ${id}. Find one with: `
                +'brightdata pipelines search <site or data type>');
        }
        return entry;
    };
    const fetch_methods = async(api_key: string, id: string)=>{
        try {
            const res = await get<unknown>(api_key, `${DETAILS_ENDPOINT}`
                +`?dataset_id=${encodeURIComponent(id)}`);
            const list = (Array.isArray(res) ? res : [res]) as Raw_dataset[];
            const ds = list.find(d=>d?.id == id);
            if (!ds?.scrapers)
                throw new Error('scraper not returned by API');
            return {source: 'api' as const, methods: ds.scrapers,
                description: ds.description ?? null};
        } catch(e) {
            console.error(`Scraper details API failed for ${id}, using docs: `
                +(e as Error).message);
        }
        const data = await fetch_json(`${docs_url}/scrapers/`
            +`${encodeURIComponent(id)}.json`) as
            {collection_methods?: Raw_methods};
        return {source: 'docs' as const,
            methods: data?.collection_methods ?? {}, description: null};
    };
    const get_details = async(api_key: string, id: string,
        method: string): Promise<Scraper_details>=>{
        const entry = await find(id);
        const {source, methods, description} = await fetch_methods(api_key,
            id);
        if (!methods[method])
        {
            throw new Error(`${entry.name} has no method ${method}, `
                +`available: ${Object.keys(methods).join(', ')}`);
        }
        const d = to_method(methods[method], source);
        return {dataset_id: id, name: entry.name, domain: entry.domain,
            description, method, source, ...d, notes: notes_for(d, source)};
    };
    return {load_catalog, search, find, get_details};
};

type Scraper_catalog = ReturnType<typeof create_scraper_catalog>;

export {create_scraper_catalog, DOCS_URL};
export type {Scraper_catalog, Catalog_opts};
