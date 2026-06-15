import type {Command} from 'commander';

// Propagate a program-level (global) option down to the leaf command that
// actually runs, unless that command already received the option explicitly.
//
// Commander only passes a command's *own* parsed options to its action. When
// the same option is declared on both the program and a subcommand (e.g.
// `-k/--api-key`), passing it in the global position
// (`brightdata -k KEY scrape <url>`) stores it on the program, leaving the
// subcommand's local value undefined — so the flag is silently dropped and the
// command falls back to env/stored credentials. That is a correctness and
// security footgun: a bogus `-k` "succeeds" using a stored login credential.
//
// This copies the global value onto the leaf command when (and only when) the
// leaf did not receive its own. An explicit local flag always wins.
const inherit_global_option = (
    global_command: Command,
    action_command: Command,
    name: string,
): void=>{
    const global_val = global_command.opts()[name];
    if (global_val !== undefined
        && action_command.getOptionValue(name) === undefined)
    {
        action_command.setOptionValue(name, global_val);
    }
};

// Names are commander's camelCased option keys (`--api-key` -> `apiKey`).
const GLOBAL_OPTION_NAMES = ['apiKey', 'timing'];

const register_global_option_propagation = (program: Command): void=>{
    program.hook('preAction', (thisCommand, actionCommand)=>{
        for (const name of GLOBAL_OPTION_NAMES)
            inherit_global_option(thisCommand, actionCommand, name);
    });
};

export {inherit_global_option, register_global_option_propagation,
    GLOBAL_OPTION_NAMES};
