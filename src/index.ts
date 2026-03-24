#!/usr/bin/env node
import {Command} from 'commander';
import {maybe_run_browser_daemon} from './browser/entrypoint';
import {login_command} from './commands/login';
import {logout_command} from './commands/logout';
import {scrape_command} from './commands/scrape';
import {search_command} from './commands/search';
import {pipelines_command} from './commands/dataset';
import {status_command} from './commands/status';
import {zones_command} from './commands/zones';
import {config_command} from './commands/config';
import {init_command} from './commands/init';
import {version_command} from './commands/version';
import {skill_command} from './commands/skill';
import {budget_command} from './commands/budget';
import {browser_command} from './commands/browser';
import {add_mcp_command} from './commands/add-mcp';
import packageJson from '../package.json';

const build_program = ()=>{
    const program = new Command();
    const add_command = new Command('add')
        .description('Add Bright Data integrations to supported coding agents')
        .addCommand(add_mcp_command);

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
    program.addCommand(pipelines_command);
    program.addCommand(status_command);
    program.addCommand(zones_command);
    program.addCommand(config_command);
    program.addCommand(init_command);
    program.addCommand(version_command);
    program.addCommand(skill_command);
    program.addCommand(budget_command);
    program.addCommand(browser_command);
    program.addCommand(add_command);

    return program;
};

const main = async()=>{
    if (await maybe_run_browser_daemon())
        return;
    build_program().parse(process.argv);
};

void main().catch(error=>{
    console.error(error);
    process.exit(1);
});
