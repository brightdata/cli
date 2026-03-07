import {resolve_api_key} from './config';
import {get_api_key} from './credentials';

const API_BASE = 'https://api.brightdata.com';


const resolve_key = (cli_val: string|undefined): string|undefined=>{
    const from_flag_or_env = resolve_api_key(cli_val);
    if (from_flag_or_env)
        return from_flag_or_env;
    return get_api_key();
};

const validate_key = async(api_key: string): Promise<boolean>=>{
    try {
        const res = await fetch(`${API_BASE}/zone`, {
            headers: {'Authorization': `Bearer ${api_key}`},
        });
        return res.status != 401 && res.status != 403;
    } catch(e) {
        return false;
    }
};


const ensure_authenticated = (cli_key: string|undefined): string=>{
    const key = resolve_key(cli_key);
    if (key)
        return key;
    console.error(
        'Error: No API key found.\n'
        +'  Run \'brightdata login\' or set BRIGHTDATA_API_KEY env variable.'
    );
    process.exit(1);
};

const mask_key = (key: string): string=>{
    if (key.length <= 8)
        return '****';
    return key.slice(0, 4)+'****'+key.slice(-4);
};

export {resolve_key, validate_key, ensure_authenticated, mask_key};
