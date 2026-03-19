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
    {
        name: 'brightdata-cli',
        description: 'Use the Bright Data CLI to scrape websites, search '
            +'engines, and extract structured data from the terminal',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/brightdata-cli/SKILL.md',
        githubPath: 'brightdata/skills/brightdata-cli',
        repoPath: 'skills/brightdata-cli',
    },
    {
        name: 'design-mirror',
        description: 'Extract design tokens from any website and apply '
            +'colors, typography, and spacing to your codebase',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/design-mirror/SKILL.md',
        githubPath: 'brightdata/skills/design-mirror',
        repoPath: 'skills/design-mirror',
    },
    {
        name: 'python-sdk-best-practices',
        description: 'Best practices for writing Bright Data Python SDK '
            +'code with async/await patterns',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/python-sdk-best-practices/SKILL.md',
        githubPath: 'brightdata/skills/python-sdk-best-practices',
        repoPath: 'skills/python-sdk-best-practices',
    },
    {
        name: 'scraper-builder',
        description: 'Build production-ready web scrapers using Bright Data '
            +'APIs with site analysis and pagination handling',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/scraper-builder/SKILL.md',
        githubPath: 'brightdata/skills/scraper-builder',
        repoPath: 'skills/scraper-builder',
    },
]

export {BRIGHTDATA_SKILLS}
export type {BrightDataSkill}
