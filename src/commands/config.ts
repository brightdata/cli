import {Command} from 'commander';
import {
    load as load_config,
    get as get_config,
    set as set_config,
} from '../utils/config';
import {print, fail, success} from '../utils/output';
import type {Config} from '../utils/config';

type Config_key = keyof Config;

const CONFIG_KEYS: Config_key[] = [
    'default_zone_unlocker',
    'default_zone_serp',
    'default_format',
    'api_url',
];

const format_keys = ()=>CONFIG_KEYS.join(', ');

const ensure_valid_key = (key: string): Config_key=>{
    if (CONFIG_KEYS.includes(key as Config_key))
        return key as Config_key;
    fail(
        `Unknown config key "${key}".\n`
        +`  Available keys: ${format_keys()}`
    );
    return 'default_format';
};

type Show_opts = {
    json?: boolean;
    pretty?: boolean;
    output?: string;
};

const handle_show_config = (opts: Show_opts)=>{
    const config = load_config();
    print(config, {json: opts.json, pretty: opts.pretty, output: opts.output});
};

const handle_get_config = (key: string)=>{
    const valid_key = ensure_valid_key(key);
    const value = get_config(valid_key);
    if (value === undefined)
    {
        fail(
            `Config key "${valid_key}" is not set.\n`
            +'  Use \'brightdata config set <key> <value>\' to set it.'
        );
        return;
    }
    process.stdout.write(value+'\n');
};

const handle_set_config = (key: string, value: string)=>{
    const valid_key = ensure_valid_key(key);
    set_config(valid_key, value);
    success(`Config updated: ${valid_key}=${value}`);
};

const config_command = new Command('config')
    .description('View and edit CLI configuration')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('-o, --output <path>', 'Write output to file')
    .action(handle_show_config);

config_command
    .addCommand(
        new Command('get')
            .description('Get a configuration value')
            .argument('<key>', `Key (${format_keys()})`)
            .action(handle_get_config)
    )
    .addCommand(
        new Command('set')
            .description('Set a configuration value')
            .argument('<key>', `Key (${format_keys()})`)
            .argument('<value>', 'Value to store')
            .action(handle_set_config)
    );

export {config_command, handle_show_config, handle_get_config,
     handle_set_config};
