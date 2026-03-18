import {Command} from 'commander';
import {confirm, input, password, select} from '@inquirer/prompts';
import {validate_key, mask_key, resolve_key} from '../utils/auth';
import {get_api_key, save as save_credentials} from '../utils/credentials';
import {resolve, get as get_config, set as set_config} from '../utils/config';
import {get} from '../utils/client';
import {
    is_tty,
    green,
    yellow,
    dim,
    success,
    warn,
    fail,
} from '../utils/output';
import {start as start_spinner} from '../utils/spinner';

const white = (text: string)=>is_tty ? `\x1b[37m${text}\x1b[0m` : text;
const blue = (text: string)=>is_tty ? `\x1b[34m${text}\x1b[0m` : text;
const BANNER_SPLIT_COL = 62;

type Init_opts = {
    skipAuth?: boolean;
    apiKey?: string;
};

type Zone = {
    name?: string;
    type?: string;
};

const BANNER = [
    '███████████             ███           █████       █████       ██████████              █████             ',
    '░░███░░░░░███           ░░░           ░░███       ░░███       ░░███░░░░███            ░░███              ',
    ' ░███    ░███ ████████  ████   ███████ ░███████   ███████      ░███   ░░███  ██████   ███████    ██████  ',
    ' ░██████████ ░░███░░███░░███  ███░░███ ░███░░███ ░░░███░       ░███    ░███ ░░░░░███ ░░░███░    ░░░░░███ ',
    ' ░███░░░░░███ ░███ ░░░  ░███ ░███ ░███ ░███ ░███   ░███        ░███    ░███  ███████   ░███      ███████ ',
    ' ░███    ░███ ░███      ░███ ░███ ░███ ░███ ░███   ░███ ███    ░███    ███  ███░░███   ░███ ███ ███░░███ ',
    ' ███████████  █████     █████░░███████ ████ █████  ░░█████     ██████████  ░░████████  ░░█████ ░░████████',
    '░░░░░░░░░░░  ░░░░░     ░░░░░  ░░░░░███░░░░ ░░░░░    ░░░░░     ░░░░░░░░░░    ░░░░░░░░    ░░░░░   ░░░░░░░░ ',
    '                              ███ ░███                                                                   ',
    '                             ░░██████                                                                    ',
    '                              ░░░░░░                                                                     ',
];

const sleep = (ms: number)=>new Promise(resolve=>setTimeout(resolve, ms));

const print_banner = ()=>{
    process.stderr.write('\n');
    for (let i=0; i<BANNER.length; i++)
    {
        const left = BANNER[i].slice(0, BANNER_SPLIT_COL);
        const right = BANNER[i].slice(BANNER_SPLIT_COL);
        process.stderr.write(white(left)+blue(right)+'\n');
    }
    process.stderr.write('\n');
    process.stderr.write(dim('Bright Data CLI setup wizard')+'\n');
    process.stderr.write(dim('This configures authentication and defaults')+'\n\n');
};

const fetch_active_zones = async(api_key: string): Promise<Zone[]>=>{
    const spinner = start_spinner('Loading active zones...');
    try {
        const zones = await get<Zone[]>(api_key, '/zone/get_active_zones');
        spinner.stop();
        if (!zones.length)
        {
            warn('No active zones were found in your account.');
            return [];
        }
        success(`Found ${zones.length} active zone(s).`);
        return zones;
    } catch(e) {
        spinner.stop();
        warn(`Could not load zones: ${(e as Error).message}`);
        return [];
    }
};

const pick_best_zone = (
    zone_names: string[],
    preferred: string|undefined
): string|undefined=>{
    if (preferred && zone_names.includes(preferred))
        return preferred;
    if (zone_names.includes('cli_unlocker'))
        return 'cli_unlocker';
    if (zone_names.length)
        return zone_names[0];
    return preferred;
};

const prompt_zone = async(
    title: string,
    zone_names: string[],
    suggested: string|undefined
): Promise<string|undefined>=>{
    if (!is_tty)
        return suggested;
    if (!zone_names.length)
    {
        const typed = (await input({
            message: `${title}:`,
            default: suggested ?? '',
        })).trim();
        if (typed)
            return typed;
        return suggested;
    }
    const choices = zone_names.map(name=>({name, value: name}));
    choices.push({name: 'Enter custom zone name', value: '__custom__'});
    const selected = await select({
        message: title,
        choices,
        default: suggested && zone_names.includes(suggested)
            ? suggested
            : zone_names[0],
    });
    if (selected != '__custom__')
        return selected;
    const custom = (await input({
        message: 'Zone name:',
        default: suggested ?? '',
    })).trim();
    if (custom)
        return custom;
    return suggested;
};

const prompt_default_format = async(current: string|undefined): 
    Promise<string>=>{
    if (!is_tty)
        return current ?? 'markdown';
    const selected = await select({
        message: 'Choose default output format',
        choices: [
            {
                name: 'markdown (best for reading)',
                value: 'markdown',
            },
            {
                name: 'json (best for pipelines)',
                value: 'json',
            },
        ],
        default: current == 'json' ? 'json' : 'markdown',
    });
    return selected;
};

const resolve_initial_api_key = (flag_key: string|undefined): 
    string|undefined=>{
    if (flag_key)
        return flag_key;
    const stored = get_api_key();
    if (stored)
        return stored;
    return resolve_key(undefined);
};

const prompt_api_key = async(
    initial: string|undefined
): Promise<string|undefined>=>{
    if (!is_tty)
        return initial;
    if (initial)
    {
        const reuse = await confirm({
            message: `Use detected API key ${mask_key(initial)}?`,
            default: true,
        });
        if (reuse)
            return initial;
    }
    process.stderr.write(
        dim('Get your API key at: https://brightdata.com/cp/setting/users')+
        '\n'
    );
    const typed = (await password({
        message: 'Enter your Bright Data API key:',
        mask: '*',
    })).trim();
    if (typed)
        return typed;
    return undefined;
};

const validate_and_save_key = async(api_key: string)=>{
    const spinner = start_spinner('Validating API key...');
    const valid = await validate_key(api_key);
    spinner.stop();
    if (!valid)
    {
        fail(
            'Invalid API key.\n'
            +'  Check your key at https://brightdata.com/cp/setting/users'
        );
        return;
    }
    save_credentials({api_key});
    success(`Authenticated. Saved key ${mask_key(api_key)}.`);
};

const show_summary = (
    authenticated: boolean,
    unlocker_zone: string|undefined,
    serp_zone: string|undefined,
    default_format: string
)=>{
    process.stderr.write('\n');
    process.stderr.write(green('Setup Complete')+'\n');
    process.stderr.write(`  Authenticated: ${authenticated ? 'yes' : 'no'}\n`);
    process.stderr.write(`  Unlocker zone: ${unlocker_zone ?? '(not set)'}\n`);
    process.stderr.write(`  SERP zone: ${serp_zone ?? '(not set)'}\n`);
    process.stderr.write(`  Default format: ${default_format}\n`);
    process.stderr.write('\n');
};

const show_quick_start = (
    unlocker_zone: string|undefined,
    serp_zone: string|undefined
)=>{
    process.stderr.write(dim('Quick start examples:')+'\n');
    const unlocker_flag = unlocker_zone ? '' : ' --zone <unlocker_zone>';
    const serp_flag = serp_zone ? '' : ' --zone <serp_zone>';
    process.stderr.write(
        `  brightdata scrape https://example.com${unlocker_flag}\n`
    );
    process.stderr.write(
        `  brightdata search "best proxy practices"${serp_flag}\n`
    );
    process.stderr.write(
        '  brightdata pipelines linkedin_person_profile '
        +'"https://www.linkedin.com/in/hello-agents"\n'
    );
};

const maybe_show_install_hint = async()=>{
    if (!is_tty)
        return;
    const show = await confirm({
        message: 'Show global install command?',
        default: false,
    });
    if (!show)
        return;
    process.stderr.write('\n');
    process.stderr.write(yellow('Install globally:')+'\n');
    process.stderr.write('  npm install -g @brightdata/cli\n\n');
};

const handle_init = async(opts: Init_opts)=>{
    print_banner();
    let api_key = resolve_initial_api_key(opts.apiKey);
    let authenticated = false;
    let zones: Zone[] = [];
    if (opts.skipAuth)
    {
        warn('Skipping authentication (--skip-auth).');
    } else {
        api_key = await prompt_api_key(api_key);
        if (!api_key)
        {
            fail(
                'No API key provided.\n'
                +'  Pass --api-key, run interactively, or use --skip-auth.'
            );
            return;
        }
        await validate_and_save_key(api_key);
        authenticated = true;
        zones = await fetch_active_zones(api_key);
    }
    const zone_names = zones
        .map(zone=>zone.name?.trim() ?? '')
        .filter(name=>name.length > 0)
        .sort();
    let unlocker_zone = resolve(
        undefined,
        'BRIGHTDATA_UNLOCKER_ZONE',
        'default_zone_unlocker'
    );
    let serp_zone = resolve(
        undefined,
        'BRIGHTDATA_SERP_ZONE',
        'default_zone_serp'
    );
    unlocker_zone = pick_best_zone(zone_names, unlocker_zone);
    serp_zone = pick_best_zone(zone_names, serp_zone ?? unlocker_zone);
    if (is_tty)
    {
        unlocker_zone = await prompt_zone(
            'Select default Web Unlocker zone',
            zone_names,
            unlocker_zone
        );
        const same_serp = await confirm({
            message: 'Use the same zone as default for SERP API?',
            default: true,
        });
        if (same_serp)
            serp_zone = unlocker_zone;
        else
        {
            serp_zone = await prompt_zone(
                'Select default SERP zone',
                zone_names,
                serp_zone ?? unlocker_zone
            );
        }
    }
    let default_format = get_config('default_format') ?? 'markdown';
    default_format = await prompt_default_format(default_format);
    if (unlocker_zone)
        set_config('default_zone_unlocker', unlocker_zone);
    if (serp_zone)
        set_config('default_zone_serp', serp_zone);
    set_config('default_format', default_format);
    await sleep(120);
    show_summary(authenticated, unlocker_zone, serp_zone, default_format);
    show_quick_start(unlocker_zone, serp_zone);
    await maybe_show_install_hint();
};

const init_command = new Command('init')
    .description('Interactive setup wizard for authentication and defaults')
    .option('--skip-auth', 'Skip authentication step')
    .option('-k, --api-key <key>', 'Provide API key directly')
    .action(handle_init);

export {init_command, handle_init};
