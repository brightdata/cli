import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(()=>({
    skills: [
        {
            name: 'search',
            description: 'Search Google and get structured JSON results',
            skillMdUrl: 'https://example.com/search/SKILL.md',
            githubPath: 'brightdata/skills/search',
            repoPath: 'skills/search',
        },
        {
            name: 'bright-data-mcp',
            description: 'Orchestrate Bright Data MCP tools',
            skillMdUrl: 'https://example.com/mcp/SKILL.md',
            githubPath: 'brightdata/skills/bright-data-mcp',
            repoPath: 'skills/bright-data-mcp',
        },
    ],
    run_skill_add: vi.fn(),
    dim: vi.fn((msg: string)=>msg),
    green: vi.fn((msg: string)=>msg),
}))

vi.mock('../../commands/skill-add', ()=>({
    run_skill_add: mocks.run_skill_add,
}))

vi.mock('../../utils/skill-installer/brightdata-skills', ()=>({
    BRIGHTDATA_SKILLS: mocks.skills,
}))

vi.mock('../../utils/output', ()=>({
    dim: mocks.dim,
    green: mocks.green,
}))

import {handle_skill_list} from '../../commands/skill'

describe('commands/skill list', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks()
    })

    afterEach(()=>{
        vi.restoreAllMocks()
    })

    it('prints aligned Bright Data skills and install hint', ()=>{
        let output = ''
        vi.spyOn(process.stdout, 'write').mockImplementation(text=>{
            output += String(text)
            return true
        })

        handle_skill_list()

        expect(output).toBe(
            'Available Bright Data Skills\n\n'
            +'  search           Search Google and get structured JSON '
            +'results\n'
            +'  bright-data-mcp  Orchestrate Bright Data MCP tools\n'
            +'\n'
            +'Install a skill:  brightdata skill add <name>\n'
        )
    })
})
