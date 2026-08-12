import {describe, it, expect} from 'vitest';
import {Command} from 'commander';
import {format_examples, add_examples} from '../../utils/help';
import type {Example} from '../../utils/help';
import {scraper_command} from '../../commands/scraper';
import {search_command} from '../../commands/search';
import {pipelines_command} from '../../commands/dataset';
import {scrape_command} from '../../commands/scrape';

describe('utils/help.format_examples', ()=>{
    it('returns empty string for no examples', ()=>{
        expect(format_examples([])).toBe('');
    });

    it('renders a single example with comment + dollar-prefixed command', ()=>{
        const exs: Example[] = [{description: 'Do a thing', command: 'cmd x'}];
        const out = format_examples(exs);
        expect(out).toContain('\nExamples:\n');
        expect(out).toContain('  # Do a thing');
        expect(out).toContain('  $ cmd x');
    });

    it('separates multiple examples with a blank line', ()=>{
        const exs: Example[] = [
            {description: 'A', command: 'cmd a'},
            {description: 'B', command: 'cmd b'},
        ];
        const out = format_examples(exs);
        expect(out).toMatch(/cmd a\n\n  # B/);
    });
});

describe('utils/help.add_examples attaches to a Commander command', ()=>{
    it('appears in the rendered --help output', ()=>{
        const cmd = new Command('demo')
            .description('A demo command')
            .argument('<thing>', 'The thing');
        add_examples(cmd, [
            {description: 'Demo this', command: 'demo widget'},
        ]);
        let captured = '';
        cmd.configureOutput({writeOut: (s)=>{ captured += s; }});
        cmd.outputHelp();
        expect(captured).toContain('Examples:');
        expect(captured).toContain('# Demo this');
        expect(captured).toContain('$ demo widget');
    });
});

const render_help = (cmd: Command): string=>{
    let captured = '';
    cmd.configureOutput({
        writeOut:  (s)=>{ captured += s; },
        writeErr:  (s)=>{ captured += s; },
    });
    cmd.outputHelp();
    return captured;
};

describe('every customer-facing command has Examples in --help', ()=>{
    const scraper_create =
        scraper_command.commands.find(c=>c.name() == 'create')!;
    const scraper_run =
        scraper_command.commands.find(c=>c.name() == 'run')!;

    const cases: [string, Command][] = [
        ['scraper create', scraper_create],
        ['scraper run',    scraper_run],
        ['search',         search_command],
        ['pipelines',      pipelines_command],
        ['scrape',         scrape_command],
    ];

    for (const [name, cmd] of cases)
    {
        it(`${name} --help includes an Examples section`, ()=>{
            const help = render_help(cmd);
            const examples_idx = help.indexOf('\nExamples:\n');
            expect(examples_idx, `${name} is missing the Examples section`)
                .toBeGreaterThan(-1);
            const examples_block = help.slice(examples_idx);
            expect(examples_block,
                `${name} Examples section has no $ brightdata command`)
                .toMatch(/\$\s+brightdata\s/);
            expect(examples_block,
                `${name} examples leak the fake example.com domain`)
                .not.toMatch(/https?:\/\/(www\.)?example\.com/);
        });
    }
});
