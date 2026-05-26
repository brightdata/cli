import {Command} from 'commander';

type Example = {
    description: string;
    command: string;
};

const format_examples = (examples: Example[]): string=>{
    if (!examples.length)
        return '';
    const blocks = examples.map(ex=>
        `  # ${ex.description}\n  $ ${ex.command}`).join('\n\n');
    return '\nExamples:\n'+blocks+'\n';
};

const add_examples = (cmd: Command, examples: Example[]): Command=>
    cmd.addHelpText('after', format_examples(examples));

export {add_examples, format_examples};
export type {Example};
