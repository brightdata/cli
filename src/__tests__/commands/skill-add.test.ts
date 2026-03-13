import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(()=>({
    skills: [
        {
            name: 'search',
            description: 'Search Google and get structured JSON results',
            skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
                +'main/skills/search/SKILL.md',
            githubPath: 'brightdata/skills/search',
            repoPath: 'skills/search',
        },
    ],
    agents: {
        amp: {
            displayName: 'Amp',
            skillsDir: '.agents/skills',
        },
        codex: {
            displayName: 'Codex',
            skillsDir: '.agents/skills',
        },
    },
    start: vi.fn(),
    stop: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`) }),
    info: vi.fn(),
    red: vi.fn((msg: string)=>msg),
    green: vi.fn((msg: string)=>msg),
    dim: vi.fn((msg: string)=>msg),
    detectInstalledAgents: vi.fn(),
    getUniversalAgents: vi.fn(),
    isUniversalAgent: vi.fn(),
    searchMultiselect: vi.fn(),
    installSkillForAgent: vi.fn(),
    fetch: vi.fn(),
}))

vi.mock('../../utils/output', ()=>({
    fail: mocks.fail,
    info: mocks.info,
    red: mocks.red,
    green: mocks.green,
    dim: mocks.dim,
}))

vi.mock('../../utils/spinner', ()=>({
    start: mocks.start,
}))

vi.mock('../../utils/skill-installer/brightdata-skills', ()=>({
    BRIGHTDATA_SKILLS: mocks.skills,
}))

vi.mock('../../utils/skill-installer/agents', ()=>({
    agents: mocks.agents,
    detectInstalledAgents: mocks.detectInstalledAgents,
    getUniversalAgents: mocks.getUniversalAgents,
    isUniversalAgent: mocks.isUniversalAgent,
}))

vi.mock('../../utils/skill-installer/prompts/search-multiselect', ()=>({
    searchMultiselect: mocks.searchMultiselect,
    cancelSymbol: Symbol('cancel'),
}))

vi.mock('../../utils/skill-installer/installer', ()=>({
    installSkillForAgent: mocks.installSkillForAgent,
}))

import {run_skill_add} from '../../commands/skill-add'

const json_response = (body: unknown)=>({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
})

const text_response = (body: string)=>({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(body),
})

describe('commands/skill-add', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks()
        vi.stubGlobal('fetch', mocks.fetch)
        mocks.start.mockReturnValue({stop: mocks.stop})
        mocks.detectInstalledAgents.mockResolvedValue(['codex'])
        mocks.getUniversalAgents.mockReturnValue(['amp'])
        mocks.isUniversalAgent.mockImplementation((agent: string)=>
            agent == 'amp')
        mocks.installSkillForAgent.mockResolvedValue({
            success: true,
            path: '/tmp/.agents/skills/search',
            mode: 'symlink',
        })
    })

    afterEach(()=>{
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('fails early when the requested skill name is invalid', async()=>{
        await expect(run_skill_add('missing-skill'))
            .rejects.toThrow(
                'fail:Unknown skill "missing-skill".\n'
                +'  Available skills: search'
            )

        expect(mocks.detectInstalledAgents).not.toHaveBeenCalled()
        expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('fetches nested skill files and prints one success line per skill',
        async()=>{
            let stderr = ''
            vi.spyOn(process.stderr, 'write').mockImplementation(text=>{
                stderr += String(text)
                return true
            })

            mocks.fetch
                .mockResolvedValueOnce(json_response([
                    {
                        type: 'file',
                        name: 'SKILL.md',
                        path: 'skills/search/SKILL.md',
                        download_url: 'https://example.com/search/SKILL.md',
                    },
                    {
                        type: 'dir',
                        name: 'scripts',
                        path: 'skills/search/scripts',
                    },
                ]))
                .mockResolvedValueOnce(text_response('# Search skill'))
                .mockResolvedValueOnce(json_response([
                    {
                        type: 'file',
                        name: 'search.sh',
                        path: 'skills/search/scripts/search.sh',
                        download_url: 'https://example.com/search/scripts/'
                            +'search.sh',
                    },
                ]))
                .mockResolvedValueOnce(text_response('#!/bin/bash\necho test\n'))

            await run_skill_add('search')

            expect(mocks.installSkillForAgent).toHaveBeenCalledTimes(2)
            expect(mocks.installSkillForAgent).toHaveBeenNthCalledWith(
                1,
                {
                    name: 'search',
                    files: {
                        'SKILL.md': '# Search skill',
                        'scripts/search.sh': '#!/bin/bash\necho test\n',
                    },
                },
                'amp'
            )
            expect(mocks.installSkillForAgent).toHaveBeenNthCalledWith(
                2,
                {
                    name: 'search',
                    files: {
                        'SKILL.md': '# Search skill',
                        'scripts/search.sh': '#!/bin/bash\necho test\n',
                    },
                },
                'codex'
            )
            expect(stderr.match(/✓ Installed search/g)?.length).toBe(1)
            expect(stderr).toContain(
                'Summary: 2 installations across 1 skill and 2 agents.'
            )
        })

    it('prints fetch details when skill download fails', async()=>{
        let stderr = ''
        vi.spyOn(process.stderr, 'write').mockImplementation(text=>{
            stderr += String(text)
            return true
        })

        const error = new Error('fetch failed') as Error & {cause?: unknown}
        error.cause = {
            code: 'ETIMEDOUT',
            message: 'connect timeout',
        }
        mocks.fetch.mockRejectedValue(error)

        await run_skill_add('search')

        expect(mocks.installSkillForAgent).not.toHaveBeenCalled()
        expect(stderr).toContain("Could not fetch skill 'search'.")
        expect(stderr).toContain(
            'URL: https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/search/SKILL.md'
        )
        expect(stderr).toContain(
            'Details: fetch failed | ETIMEDOUT | connect timeout'
        )
        expect(stderr).toContain(
            "✗ search: Could not fetch skill 'search'. fetch failed "
            +'| ETIMEDOUT | connect timeout'
        )
    })
})
