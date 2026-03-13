type BrightDataSkill = {
    name: string;
    description: string;
    skillMdUrl: string;
    githubPath: string;
    repoPath: string;
}

const BRIGHTDATA_SKILLS: BrightDataSkill[] = [
    {
        name: 'search',
        description: 'Search Google and get structured JSON results with '
            +'titles, links, and descriptions',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/search/SKILL.md',
        githubPath: 'brightdata/skills/search',
        repoPath: 'skills/search',
    },
    {
        name: 'scrape',
        description: 'Scrape any webpage as clean markdown with automatic '
            +'bot detection bypass',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/scrape/SKILL.md',
        githubPath: 'brightdata/skills/scrape',
        repoPath: 'skills/scrape',
    },
    {
        name: 'data-feeds',
        description: 'Extract structured data from 40+ websites with '
            +'automatic polling',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/data-feeds/SKILL.md',
        githubPath: 'brightdata/skills/data-feeds',
        repoPath: 'skills/data-feeds',
    },
    {
        name: 'bright-data-mcp',
        description: 'Orchestrate 60+ Bright Data MCP tools for search, '
            +'scraping, and browser automation',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/bright-data-mcp/SKILL.md',
        githubPath: 'brightdata/skills/bright-data-mcp',
        repoPath: 'skills/bright-data-mcp',
    },
    {
        name: 'bright-data-best-practices',
        description: 'Reference knowledge base for Claude when writing '
            +'Bright Data code',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/bright-data-best-practices/SKILL.md',
        githubPath: 'brightdata/skills/bright-data-best-practices',
        repoPath: 'skills/bright-data-best-practices',
    },
]

export {BRIGHTDATA_SKILLS}
export type {BrightDataSkill}
