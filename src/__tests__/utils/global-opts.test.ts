import {describe, it, expect} from 'vitest';
import {Command} from 'commander';
import {
    inherit_global_option,
    register_global_option_propagation,
} from '../../utils/global-opts';

// Build a minimal program mirroring index.ts: a global -k/--api-key plus a
// subcommand that also declares its own local -k. The action captures the
// api key the command would actually use.
const build = ()=>{
    let captured: {apiKey?: string; timing?: boolean} = {};
    const program = new Command();
    program
        .name('brightdata')
        .option('-k, --api-key <key>')
        .option('--timing')
        .exitOverride();
    const sub = new Command('scrape')
        .argument('[url]')
        .option('-k, --api-key <key>')
        .option('--timing')
        .action((_url, opts)=>{ captured = opts; });
    program.addCommand(sub);
    register_global_option_propagation(program);
    return {program, get_captured: ()=>captured};
};

describe('utils/global-opts', ()=>{
    it('honors -k passed in the global position (the bug fix)', async()=>{
        const {program, get_captured} = build();
        await program.parseAsync(['node', 'x', '-k', 'GLOBAL', 'scrape', 'u']);
        expect(get_captured().apiKey).toBe('GLOBAL');
    });

    it('honors -k passed in the local position', async()=>{
        const {program, get_captured} = build();
        await program.parseAsync(['node', 'x', 'scrape', 'u', '-k', 'LOCAL']);
        expect(get_captured().apiKey).toBe('LOCAL');
    });

    it('local -k wins over global -k', async()=>{
        const {program, get_captured} = build();
        await program.parseAsync(
            ['node', 'x', '-k', 'GLOBAL', 'scrape', 'u', '-k', 'LOCAL']);
        expect(get_captured().apiKey).toBe('LOCAL');
    });

    it('leaves api key undefined when no flag is given', async()=>{
        const {program, get_captured} = build();
        await program.parseAsync(['node', 'x', 'scrape', 'u']);
        expect(get_captured().apiKey).toBeUndefined();
    });

    it('propagates the global --timing flag too', async()=>{
        const {program, get_captured} = build();
        await program.parseAsync(['node', 'x', '--timing', 'scrape', 'u']);
        expect(get_captured().timing).toBe(true);
    });

    // Most subcommands intentionally do NOT declare their own -k; they rely on
    // the global option + this hook. Lock that in so nobody re-adds the
    // boilerplate thinking it is required for the post-command position.
    it('resolves global -k for a command with no local -k, both positions',
        async()=>{
            const build_no_local = ()=>{
                let captured: {apiKey?: string} = {};
                const program = new Command();
                program.name('brightdata').option('-k, --api-key <key>')
                    .exitOverride();
                const sub = new Command('scrape').argument('[url]')
                    .action((_url, opts)=>{ captured = opts; });
                program.addCommand(sub);
                register_global_option_propagation(program);
                return {program, get_captured: ()=>captured};
            };
            const a = build_no_local();
            await a.program.parseAsync(['node', 'x', '-k', 'PRE', 'scrape', 'u']);
            expect(a.get_captured().apiKey).toBe('PRE');

            const b = build_no_local();
            await b.program.parseAsync(['node', 'x', 'scrape', 'u', '-k', 'POST']);
            expect(b.get_captured().apiKey).toBe('POST');
        });

    it('inherit_global_option does not overwrite an explicit local value', ()=>{
        const program = new Command().option('-k, --api-key <key>');
        program.setOptionValue('apiKey', 'GLOBAL');
        const leaf = new Command('x').option('-k, --api-key <key>');
        leaf.setOptionValue('apiKey', 'LOCAL');
        inherit_global_option(program, leaf, 'apiKey');
        expect(leaf.getOptionValue('apiKey')).toBe('LOCAL');
    });
});
