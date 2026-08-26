type BrightDataSkill = {
    name: string;
    description: string;
    skillMdUrl: string;
    githubPath: string;
    repoPath: string;
}

const BRIGHTDATA_SKILLS: BrightDataSkill[] = [
    {
        name: 'agent-onboarding',
        description: 'Start here - install the CLI and the skills, log in '
            +'once, and route to the right skill',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/agent-onboarding/SKILL.md',
        githubPath: 'brightdata/skills/agent-onboarding',
        repoPath: 'skills/agent-onboarding',
    },
    {
        name: 'scrape',
        description: 'Extract structured data from any site with ready '
            +'scrapers, Scraper Studio, and free discovery scripts',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/scrape/SKILL.md',
        githubPath: 'brightdata/skills/scrape',
        repoPath: 'skills/scrape',
    },
    {
        name: 'fetch',
        description: 'Fetch one URL through Web Unlocker as markdown, HTML, '
            +'or a screenshot',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/fetch/SKILL.md',
        githubPath: 'brightdata/skills/fetch',
        repoPath: 'skills/fetch',
    },
    {
        name: 'search',
        description: 'Search Google and other engines with SERP API, the '
            +'verticals, the top-100 job, and answer engines',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/search/SKILL.md',
        githubPath: 'brightdata/skills/search',
        repoPath: 'skills/search',
    },
    {
        name: 'browser',
        description: 'Point Playwright, Puppeteer, or Selenium at the Bright '
            +'Data cloud browser',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/browser/SKILL.md',
        githubPath: 'brightdata/skills/browser',
        repoPath: 'skills/browser',
    },
    {
        name: 'billing',
        description: 'Check balance, charges, and what a job will cost',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/billing/SKILL.md',
        githubPath: 'brightdata/skills/billing',
        repoPath: 'skills/billing',
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
        name: 'brightdata-mcp',
        description: 'Set up and route the Bright Data MCP server tools for '
            +'agents that decide at run time',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/brightdata-mcp/SKILL.md',
        githubPath: 'brightdata/skills/brightdata-mcp',
        repoPath: 'skills/brightdata-mcp',
    },
    {
        name: 'brightdata-sdk',
        description: 'Write code with the Bright Data SDK for scraping jobs '
            +'the user keeps',
        skillMdUrl: 'https://raw.githubusercontent.com/brightdata/skills/'
            +'main/skills/brightdata-sdk/SKILL.md',
        githubPath: 'brightdata/skills/brightdata-sdk',
        repoPath: 'skills/brightdata-sdk',
    },
];

export {BRIGHTDATA_SKILLS}
export type {BrightDataSkill}
