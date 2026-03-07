import {Command} from 'commander';
import {password} from '@inquirer/prompts';
import {save} from '../utils/credentials';
import {validate_key, mask_key} from '../utils/auth';
import {get as get_config, set as set_config} from '../utils/config';
import {get, post} from '../utils/client';

const UNLOCKER_ZONE = 'cli_unlocker';
const BROWSER_ZONE  = 'cli_browser';

type Zone = {
    name: string;
    type: string;
};

const ensure_zones = async(api_key: string)=>{
    console.error('Checking for required zones...');
    let zones: Zone[] = [];
    try {
        zones = await get<Zone[]>(api_key, '/zone/get_active_zones');
    } catch(e) {
        console.error('Warning: Could not fetch zones —', (e as Error).message);
        return;
    }
    const has_unlocker = zones.some(z=>z.name == UNLOCKER_ZONE);
    const has_browser  = zones.some(z=>z.name == BROWSER_ZONE);
    if (!has_unlocker)
    {
        console.error(`Zone "${UNLOCKER_ZONE}" not found, creating...`);
        try {
            await post(api_key, '/zone', {
                zone: {name: UNLOCKER_ZONE, type: 'unblocker'},
                plan: {type: 'unblocker'},
            });
            console.error(`Zone "${UNLOCKER_ZONE}" created successfully.`);
        } catch(e) {
            console.error(`Warning: Could not create zone "${UNLOCKER_ZONE}" —`,
                (e as Error).message);
        }
    }
    else
        console.error(`Zone "${UNLOCKER_ZONE}" already exists.`);
    if (!has_browser)
    {
        console.error(`Zone "${BROWSER_ZONE}" not found, creating...`);
        try {
            await post(api_key, '/zone', {
                zone: {name: BROWSER_ZONE, type: 'browser_api'},
                plan: {type: 'browser_api'},
            });
            console.error(`Zone "${BROWSER_ZONE}" created successfully.`);
        } catch(e) {
            console.error(`Warning: Could not create zone "${BROWSER_ZONE}" —`,
                (e as Error).message);
        }
    }
    else
        console.error(`Zone "${BROWSER_ZONE}" already exists.`);
    // persist unlocker zone as default if not already configured
    if (!get_config('default_zone_unlocker'))
        set_config('default_zone_unlocker', UNLOCKER_ZONE);
};

const handle_login = async(opts: {apiKey?: string})=>{
    let api_key = opts.apiKey;
    if (!api_key)
    {
        api_key = await password({
            message: 'Enter your Bright Data API key:',
            mask: '*',
        });
    }
    api_key = api_key.trim();
    if (!api_key)
    {
        console.error('Error: API key cannot be empty.');
        process.exit(1);
    }
    console.error('Validating API key...');
    const valid = await validate_key(api_key);
    if (!valid)
    {
        console.error(
            'Error: Invalid API key. Check your key at '
            +'https://brightdata.com/cp/setting/users'
        );
        process.exit(1);
    }
    save({api_key});
    console.error(`Logged in successfully. Key: ${mask_key(api_key)}`);
    await ensure_zones(api_key);
};

const login_command = new Command('login')
    .description('Authenticate with your Bright Data API key')
    .option('-k, --api-key <key>', 'API key (skips interactive prompt)')
    .action(handle_login);

export {login_command, handle_login};
