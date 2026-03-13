import {Command} from 'commander'
import {run_skill_add} from './skill-add'
import {BRIGHTDATA_SKILLS} from '../utils/skill-installer/brightdata-skills'
import {dim, green} from '../utils/output'

const handle_skill_list = ()=>{
    const name_width = BRIGHTDATA_SKILLS.reduce((max, skill)=>
        Math.max(max, skill.name.length), 0)

    process.stdout.write('Available Bright Data Skills\n\n')
    for (const skill of BRIGHTDATA_SKILLS)
    {
        process.stdout.write(
            `  ${skill.name.padEnd(name_width)}  ${skill.description}\n`
        )
    }
    process.stdout.write('\n')
    process.stdout.write(
        `${dim('Install a skill:')}  `
        +`${green('brightdata skill add <name>')}\n`
    )
}

const skill_command = new Command('skill')
    .description('Manage Bright Data agent skills')
    .addCommand(
        new Command('add')
            .description('Add a Bright Data skill to your coding agent')
            .argument('[skill_name]',
                'Name of the skill to install (omit for interactive picker)')
            .action(async(skill_name?: string)=>{
                await run_skill_add(skill_name)
            })
    )
    .addCommand(
        new Command('list')
            .description('List available Bright Data skills')
            .action(handle_skill_list)
    )

export {skill_command, handle_skill_list}
