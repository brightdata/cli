import {Command} from 'commander';
import readline from 'readline';
import {save} from '../utils/credentials';
import {validate_key, mask_key} from '../utils/auth';
import {get as get_config, set as set_config} from '../utils/config';
import {get, post} from '../utils/client';
import {loopback_flow, device_flow, github_flow} from '../utils/browser_auth';

const UNLOCKER_ZONE = 'cli_unlocker';
const BROWSER_ZONE  = 'cli_browser';

type Zone = {
    name: string;
    type: string;
};

type Login_opts = {
    apiKey?: string;
    device?: boolean;
    github?: boolean;
    customerId?: string;
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

const resolve_customer_id = async(
    cli_customer_id: string|undefined
): Promise<string|undefined>=>{
    const resolved = cli_customer_id ?? process.env['BRIGHTDATA_CUSTOMER_ID'];
    return resolved?.trim() || undefined;
};
const prompt_yes_no = (question: string): Promise<boolean>=>
    new Promise(resolve=>{
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
        });
        rl.question(question, answer=>{
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
const handle_login = async(opts: Login_opts)=>{
    let api_key: string;

    if (opts.apiKey)
    {
        api_key = opts.apiKey.trim();
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
    }
    else if (opts.github)
    {
        const customer_id = await resolve_customer_id(opts.customerId);
        try {
            api_key = (await github_flow({customer_id})).trim();
        } catch(e) {
            console.error(`\nGitHub auth failed: ${(e as Error).message}`);
            const fallback = await prompt_yes_no(
                'Try device flow instead? [y/N] '
            );
            if (!fallback)
            {
                process.exit(1);
            }
            console.error('Falling back to device flow...');
            try {
                api_key = (await device_flow({customer_id})).trim();
            } catch(e2) {
                console.error(`Error: Authentication failed: ${(e2 as Error).message}`);
                process.exit(1);
            }
        }
    }
    else if (opts.device)
    {
        const customer_id = await resolve_customer_id(opts.customerId);
        try {
            api_key = (await device_flow({customer_id})).trim();
        } catch(e) {
            console.error(`Error: Authentication failed: ${(e as Error).message}`);
            process.exit(1);
        }
    }
    else
    {
        const customer_id = await resolve_customer_id(opts.customerId);
        try {
            api_key = (await loopback_flow({customer_id})).trim();
        } catch(e) {
            console.error(`Error: Authentication failed: ${(e as Error).message}`);
            process.exit(1);
        }
    }

    save({api_key});
    console.error(`Logged in successfully. Key: ${mask_key(api_key)}`);
    await ensure_zones(api_key);
};

const login_command = new Command('login')
    .description('Authenticate with Bright Data (opens browser)')
    .option('-k, --api-key <key>', 'Use API key directly (skips browser)')
    .option('-c, --customer-id <id>', 'Optional Bright Data account ID')
    .option('-d, --device', 'Use device flow for SSH/headless environments')
    .option('-g, --github', 'Authenticate using GitHub CLI (gh auth token)')
    .action(handle_login);

export {login_command, handle_login};
