import os from 'os';
import {Command} from 'commander';
import {print} from '../utils/output';
import packageJson from '../../package.json';

type Version_opts = {
    json?: boolean;
    pretty?: boolean;
    output?: string;
};

type Version_info = {
    name: string;
    version: string;
    node: string;
    platform: string;
    arch: string;
};

const get_version_info = (): Version_info=>({
    name: packageJson.name,
    version: packageJson.version,
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
});

const handle_version = (opts: Version_opts)=>{
    const info = get_version_info();
    if (!opts.json && !opts.pretty && !opts.output)
    {
        process.stdout.write(`${info.name} v${info.version}\n`);
        return;
    }
    print(info, {json: opts.json, pretty: opts.pretty, output: opts.output});
};

const version_command = new Command('version')
    .description('Display CLI version information')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('-o, --output <path>', 'Write output to file')
    .action(handle_version);

export {version_command, handle_version, get_version_info};
