import {Command} from 'commander';
import {ensure_authenticated} from '../utils/auth';
import {get} from '../utils/client';
import {start as start_spinner} from '../utils/spinner';
import {print, print_table, dim} from '../utils/output';

type Zones_opts = {
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

type Zone_summary = {
    name?: string;
    type?: string;
};

const add_common_options = (cmd: Command): Command=>{
    cmd.option('-o, --output <path>', 'Write output to file');
    cmd.option('--json', 'Force JSON output');
    cmd.option('--pretty', 'Pretty-print JSON output');
    cmd.option('--timing', 'Show request timing');
    cmd.option('-k, --api-key <key>', 'Override API key');
    return cmd;
};

const handle_list_zones = async(opts: Zones_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const spinner = start_spinner('Fetching active zones...');
    try {
        const zones = await get<Zone_summary[]>(
            api_key,
            '/zone/get_active_zones',
            {timing: opts.timing}
        );
        spinner.stop();
        if (opts.output || opts.json || opts.pretty)
        {
            print(zones, {json: opts.json, pretty: opts.pretty, 
                output: opts.output});
            return;
        }
        if (!zones.length)
        {
            console.log(dim('No active zones found.'));
            return;
        }
        const rows = zones.map(zone=>({
            name: zone.name ?? '',
            type: zone.type ?? '',
        }));
        print_table(rows, ['name', 'type']);
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const handle_zone_info = async(name: string, opts: Zones_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const spinner = start_spinner(`Fetching zone info for "${name}"...`);
    try {
        const endpoint = `/zone?zone=${encodeURIComponent(name)}`;
        const info = await get<unknown>(
            api_key,
            endpoint,
            {timing: opts.timing}
        );
        spinner.stop();
        print(info, {json: opts.json, pretty: opts.pretty, 
            output: opts.output});
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const zones_command = add_common_options(
    new Command('zones')
        .description('List and inspect Bright Data zones')
        .action(handle_list_zones)
);

zones_command.addCommand(
    add_common_options(
        new Command('info')
            .description('Show details for a single zone')
            .argument('<name>', 'Zone name')
            .action(handle_zone_info)
    )
);

export {zones_command, handle_list_zones, handle_zone_info};
