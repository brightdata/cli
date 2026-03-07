#!/usr/bin/env node
import {Command} from 'commander';
import {login_command} from './commands/login';
import {logout_command} from './commands/logout';
import {scrape_command} from './commands/scrape';
import {search_command} from './commands/search';
import {webdata_command} from './commands/dataset';
import {status_command} from './commands/status';
import {zones_command} from './commands/zones';
import {config_command} from './commands/config';
import {init_command} from './commands/init';
import {version_command} from './commands/version';
import packageJson from '../package.json';

const program = new Command();

program
    .name('brightdata')
    .description(
        'Command-line interface for Bright Data. Scrape, search, '
        +'extract structured data, and automate browsers from your terminal.'
    )
    .version(packageJson.version, '-v, --version')
    .option('-k, --api-key <key>', 'Bright Data API key (overrides env/config)')
    .option('--timing', 'Show request timing');

program.addCommand(login_command);
program.addCommand(logout_command);
program.addCommand(scrape_command);
program.addCommand(search_command);
program.addCommand(webdata_command);
program.addCommand(status_command);
program.addCommand(zones_command);
program.addCommand(config_command);
program.addCommand(init_command);
program.addCommand(version_command);


program.parse(process.argv);
