import fs from 'fs';
import path from 'path';
import {get_config_dir} from './credentials';

const get_config_path = ()=>path.join(get_config_dir(), 'config.json');

type Config = {
    default_zone_unlocker?: string;
    default_zone_serp?: string;
    default_format?: string;
    api_url?: string;
    sanitize_csv?: boolean;
};

type String_config_key = {
    [K in keyof Config]-?: Config[K] extends string|undefined ? K : never
}[keyof Config];

const DEFAULTS: Config = {
    default_format: 'markdown',
    api_url: 'https://api.brightdata.com',
    sanitize_csv: true,
};

const load = (): Config=>{
    const config_path = get_config_path();
    if (!fs.existsSync(config_path))
        return {...DEFAULTS};
    try {
        const raw = fs.readFileSync(config_path, 'utf8');
        return {...DEFAULTS, ...JSON.parse(raw) as Config};
    } catch(e) {
        return {...DEFAULTS};
    }
};

const save = (config: Config)=>{
    const dir = get_config_dir();
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(get_config_path(), JSON.stringify(config, null, 4));
};

const get = <K extends keyof Config>(key: K): Config[K]=>{
    const config = load();
    return config[key];
};

const set = <K extends keyof Config>(key: K, value: Config[K])=>{
    const config = load();
    config[key] = value;
    save(config);
};


const resolve = (
    cli_val: string|undefined,
    env_key: string,
    config_key: String_config_key
): string|undefined=>{
    if (cli_val)
        return cli_val;
    const env_val = process.env[env_key];
    if (env_val)
        return env_val;
    return get(config_key);
};

const resolve_api_key = (cli_val: string|undefined): string|undefined=>{
    if (cli_val)
        return cli_val;
    const env_val = process.env['BRIGHTDATA_API_KEY'];
    if (env_val)
        return env_val;
    return undefined;
};

export {load, save, get, set, resolve, resolve_api_key, DEFAULTS};
export type {Config};
