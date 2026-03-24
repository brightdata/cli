import {get, post} from './client';

const DEFAULT_BROWSER_ZONE = 'cli_browser';

type Status_response = {
    customer?: string;
};

type Zone_passwords_response = {
    passwords?: string[];
};

type Zone_summary = {
    name?: string;
    type?: string;
};

const normalize_zone = (zone: string): string=>{
    const normalized = zone.trim();
    if (!normalized)
        throw new Error('Browser zone cannot be empty.');
    return normalized;
};

const normalize_country = (country?: string): string|undefined=>{
    const normalized = country?.trim().toLowerCase();
    if (!normalized)
        return undefined;
    if (!/^[a-z]{2}$/.test(normalized))
        throw new Error('Browser country must be a 2-letter ISO code.');
    return normalized;
};

const ensure_browser_zone = async(
    api_key: string,
    zone = DEFAULT_BROWSER_ZONE
): Promise<void>=>{
    const normalized_zone = normalize_zone(zone);
    const zones = await get<Zone_summary[]>(api_key, '/zone/get_active_zones');
    const has_browser_zone = zones.some(z=>
        z.name == normalized_zone && z.type == 'browser_api'
    );
    if (has_browser_zone)
        return;

    await post(api_key, '/zone', {
        zone: {name: normalized_zone, type: 'browser_api'},
        plan: {type: 'browser_api'},
    });
};

const get_cdp_endpoint = async(
    api_key: string,
    zone: string,
    country?: string
): Promise<string>=>{
    const normalized_zone = normalize_zone(zone);
    const normalized_country = normalize_country(country);

    const {customer} = await get<Status_response>(api_key, '/status');
    if (!customer)
    {
        throw new Error(
            'Could not resolve Bright Data customer ID from /status.'
        );
    }

    const endpoint = `/zone/passwords?zone=${encodeURIComponent(
        normalized_zone
    )}`;
    const {passwords} = await get<Zone_passwords_response>(api_key, endpoint);
    const password = passwords?.[0];
    if (!password)
    {
        throw new Error(
            `No browser password found for zone "${normalized_zone}".`
        );
    }

    const country_suffix = normalized_country
        ? `-country-${normalized_country}`
        : '';
    return `wss://brd-customer-${customer}-zone-${normalized_zone}`
        + `${country_suffix}:${password}@brd.superproxy.io:9222`;
};

export {DEFAULT_BROWSER_ZONE, ensure_browser_zone, get_cdp_endpoint};

