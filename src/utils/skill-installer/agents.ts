import {existsSync} from 'fs'
import {homedir} from 'os'
import {join} from 'path'

type Agent_type =
    | 'amp'
    | 'antigravity'
    | 'augment'
    | 'claude-code'
    | 'openclaw'
    | 'cline'
    | 'codebuddy'
    | 'codex'
    | 'command-code'
    | 'continue'
    | 'cortex'
    | 'crush'
    | 'cursor'
    | 'droid'
    | 'gemini-cli'
    | 'github-copilot'
    | 'goose'
    | 'iflow-cli'
    | 'junie'
    | 'kilo'
    | 'kimi-cli'
    | 'kiro-cli'
    | 'kode'
    | 'mcpjam'
    | 'mistral-vibe'
    | 'mux'
    | 'neovate'
    | 'opencode'
    | 'openhands'
    | 'pi'
    | 'qoder'
    | 'qwen-code'
    | 'replit'
    | 'roo'
    | 'trae'
    | 'trae-cn'
    | 'windsurf'
    | 'zencoder'
    | 'pochi'
    | 'adal'
    | 'universal'

type Agent_config = {
    name: Agent_type;
    displayName: string;
    skillsDir: string;
    globalSkillsDir: string|undefined;
    detectInstalled: ()=>Promise<boolean>;
    showInUniversalList?: boolean;
}

const home = homedir()
const config_home = process.env['XDG_CONFIG_HOME']?.trim()
    || join(home, '.config')
const codex_home = process.env['CODEX_HOME']?.trim() || join(home, '.codex')
const claude_home = process.env['CLAUDE_CONFIG_DIR']?.trim()
    || join(home, '.claude')

const getOpenClawGlobalSkillsDir = (
    home_dir = home,
    path_exists: (path: string)=>boolean = existsSync
)=>{
    if (path_exists(join(home_dir, '.openclaw')))
        return join(home_dir, '.openclaw/skills')
    if (path_exists(join(home_dir, '.clawdbot')))
        return join(home_dir, '.clawdbot/skills')
    if (path_exists(join(home_dir, '.moltbot')))
        return join(home_dir, '.moltbot/skills')
    return join(home_dir, '.openclaw/skills')
}

const agents: Record<Agent_type, Agent_config> = {
    amp: {
        name: 'amp',
        displayName: 'Amp',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(config_home, 'agents/skills'),
        detectInstalled: async()=>existsSync(join(config_home, 'amp')),
    },
    antigravity: {
        name: 'antigravity',
        displayName: 'Antigravity',
        skillsDir: '.agent/skills',
        globalSkillsDir: join(home, '.gemini/antigravity/skills'),
        detectInstalled: async()=>existsSync(join(home, '.gemini/antigravity')),
    },
    augment: {
        name: 'augment',
        displayName: 'Augment',
        skillsDir: '.augment/skills',
        globalSkillsDir: join(home, '.augment/skills'),
        detectInstalled: async()=>existsSync(join(home, '.augment')),
    },
    'claude-code': {
        name: 'claude-code',
        displayName: 'Claude Code',
        skillsDir: '.claude/skills',
        globalSkillsDir: join(claude_home, 'skills'),
        detectInstalled: async()=>existsSync(claude_home),
    },
    openclaw: {
        name: 'openclaw',
        displayName: 'OpenClaw',
        skillsDir: 'skills',
        globalSkillsDir: getOpenClawGlobalSkillsDir(),
        detectInstalled: async()=>existsSync(join(home, '.openclaw'))
            || existsSync(join(home, '.clawdbot'))
            || existsSync(join(home, '.moltbot')),
    },
    cline: {
        name: 'cline',
        displayName: 'Cline',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(home, '.agents', 'skills'),
        detectInstalled: async()=>existsSync(join(home, '.cline')),
    },
    codebuddy: {
        name: 'codebuddy',
        displayName: 'CodeBuddy',
        skillsDir: '.codebuddy/skills',
        globalSkillsDir: join(home, '.codebuddy/skills'),
        detectInstalled: async()=>existsSync(join(process.cwd(), '.codebuddy'))
            || existsSync(join(home, '.codebuddy')),
    },
    codex: {
        name: 'codex',
        displayName: 'Codex',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(codex_home, 'skills'),
        detectInstalled: async()=>existsSync(codex_home)
            || existsSync('/etc/codex'),
    },
    'command-code': {
        name: 'command-code',
        displayName: 'Command Code',
        skillsDir: '.commandcode/skills',
        globalSkillsDir: join(home, '.commandcode/skills'),
        detectInstalled: async()=>existsSync(join(home, '.commandcode')),
    },
    continue: {
        name: 'continue',
        displayName: 'Continue',
        skillsDir: '.continue/skills',
        globalSkillsDir: join(home, '.continue/skills'),
        detectInstalled: async()=>existsSync(join(process.cwd(), '.continue'))
            || existsSync(join(home, '.continue')),
    },
    cortex: {
        name: 'cortex',
        displayName: 'Cortex Code',
        skillsDir: '.cortex/skills',
        globalSkillsDir: join(home, '.snowflake/cortex/skills'),
        detectInstalled: async()=>existsSync(join(home, '.snowflake/cortex')),
    },
    crush: {
        name: 'crush',
        displayName: 'Crush',
        skillsDir: '.crush/skills',
        globalSkillsDir: join(home, '.config/crush/skills'),
        detectInstalled: async()=>existsSync(join(home, '.config/crush')),
    },
    cursor: {
        name: 'cursor',
        displayName: 'Cursor',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(home, '.cursor/skills'),
        detectInstalled: async()=>existsSync(join(home, '.cursor')),
    },
    droid: {
        name: 'droid',
        displayName: 'Droid',
        skillsDir: '.factory/skills',
        globalSkillsDir: join(home, '.factory/skills'),
        detectInstalled: async()=>existsSync(join(home, '.factory')),
    },
    'gemini-cli': {
        name: 'gemini-cli',
        displayName: 'Gemini CLI',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(home, '.gemini/skills'),
        detectInstalled: async()=>existsSync(join(home, '.gemini')),
    },
    'github-copilot': {
        name: 'github-copilot',
        displayName: 'GitHub Copilot',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(home, '.copilot/skills'),
        detectInstalled: async()=>existsSync(join(home, '.copilot')),
    },
    goose: {
        name: 'goose',
        displayName: 'Goose',
        skillsDir: '.goose/skills',
        globalSkillsDir: join(config_home, 'goose/skills'),
        detectInstalled: async()=>existsSync(join(config_home, 'goose')),
    },
    junie: {
        name: 'junie',
        displayName: 'Junie',
        skillsDir: '.junie/skills',
        globalSkillsDir: join(home, '.junie/skills'),
        detectInstalled: async()=>existsSync(join(home, '.junie')),
    },
    'iflow-cli': {
        name: 'iflow-cli',
        displayName: 'iFlow CLI',
        skillsDir: '.iflow/skills',
        globalSkillsDir: join(home, '.iflow/skills'),
        detectInstalled: async()=>existsSync(join(home, '.iflow')),
    },
    kilo: {
        name: 'kilo',
        displayName: 'Kilo Code',
        skillsDir: '.kilocode/skills',
        globalSkillsDir: join(home, '.kilocode/skills'),
        detectInstalled: async()=>existsSync(join(home, '.kilocode')),
    },
    'kimi-cli': {
        name: 'kimi-cli',
        displayName: 'Kimi Code CLI',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(home, '.config/agents/skills'),
        detectInstalled: async()=>existsSync(join(home, '.kimi')),
    },
    'kiro-cli': {
        name: 'kiro-cli',
        displayName: 'Kiro CLI',
        skillsDir: '.kiro/skills',
        globalSkillsDir: join(home, '.kiro/skills'),
        detectInstalled: async()=>existsSync(join(home, '.kiro')),
    },
    kode: {
        name: 'kode',
        displayName: 'Kode',
        skillsDir: '.kode/skills',
        globalSkillsDir: join(home, '.kode/skills'),
        detectInstalled: async()=>existsSync(join(home, '.kode')),
    },
    mcpjam: {
        name: 'mcpjam',
        displayName: 'MCPJam',
        skillsDir: '.mcpjam/skills',
        globalSkillsDir: join(home, '.mcpjam/skills'),
        detectInstalled: async()=>existsSync(join(home, '.mcpjam')),
    },
    'mistral-vibe': {
        name: 'mistral-vibe',
        displayName: 'Mistral Vibe',
        skillsDir: '.vibe/skills',
        globalSkillsDir: join(home, '.vibe/skills'),
        detectInstalled: async()=>existsSync(join(home, '.vibe')),
    },
    mux: {
        name: 'mux',
        displayName: 'Mux',
        skillsDir: '.mux/skills',
        globalSkillsDir: join(home, '.mux/skills'),
        detectInstalled: async()=>existsSync(join(home, '.mux')),
    },
    opencode: {
        name: 'opencode',
        displayName: 'OpenCode',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(config_home, 'opencode/skills'),
        detectInstalled: async()=>existsSync(join(config_home, 'opencode')),
    },
    openhands: {
        name: 'openhands',
        displayName: 'OpenHands',
        skillsDir: '.openhands/skills',
        globalSkillsDir: join(home, '.openhands/skills'),
        detectInstalled: async()=>existsSync(join(home, '.openhands')),
    },
    pi: {
        name: 'pi',
        displayName: 'Pi',
        skillsDir: '.pi/skills',
        globalSkillsDir: join(home, '.pi/agent/skills'),
        detectInstalled: async()=>existsSync(join(home, '.pi/agent')),
    },
    qoder: {
        name: 'qoder',
        displayName: 'Qoder',
        skillsDir: '.qoder/skills',
        globalSkillsDir: join(home, '.qoder/skills'),
        detectInstalled: async()=>existsSync(join(home, '.qoder')),
    },
    'qwen-code': {
        name: 'qwen-code',
        displayName: 'Qwen Code',
        skillsDir: '.qwen/skills',
        globalSkillsDir: join(home, '.qwen/skills'),
        detectInstalled: async()=>existsSync(join(home, '.qwen')),
    },
    replit: {
        name: 'replit',
        displayName: 'Replit',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(config_home, 'agents/skills'),
        showInUniversalList: false,
        detectInstalled: async()=>existsSync(join(process.cwd(), '.replit')),
    },
    roo: {
        name: 'roo',
        displayName: 'Roo Code',
        skillsDir: '.roo/skills',
        globalSkillsDir: join(home, '.roo/skills'),
        detectInstalled: async()=>existsSync(join(home, '.roo')),
    },
    trae: {
        name: 'trae',
        displayName: 'Trae',
        skillsDir: '.trae/skills',
        globalSkillsDir: join(home, '.trae/skills'),
        detectInstalled: async()=>existsSync(join(home, '.trae')),
    },
    'trae-cn': {
        name: 'trae-cn',
        displayName: 'Trae CN',
        skillsDir: '.trae/skills',
        globalSkillsDir: join(home, '.trae-cn/skills'),
        detectInstalled: async()=>existsSync(join(home, '.trae-cn')),
    },
    windsurf: {
        name: 'windsurf',
        displayName: 'Windsurf',
        skillsDir: '.windsurf/skills',
        globalSkillsDir: join(home, '.codeium/windsurf/skills'),
        detectInstalled: async()=>existsSync(join(home, '.codeium/windsurf')),
    },
    zencoder: {
        name: 'zencoder',
        displayName: 'Zencoder',
        skillsDir: '.zencoder/skills',
        globalSkillsDir: join(home, '.zencoder/skills'),
        detectInstalled: async()=>existsSync(join(home, '.zencoder')),
    },
    neovate: {
        name: 'neovate',
        displayName: 'Neovate',
        skillsDir: '.neovate/skills',
        globalSkillsDir: join(home, '.neovate/skills'),
        detectInstalled: async()=>existsSync(join(home, '.neovate')),
    },
    pochi: {
        name: 'pochi',
        displayName: 'Pochi',
        skillsDir: '.pochi/skills',
        globalSkillsDir: join(home, '.pochi/skills'),
        detectInstalled: async()=>existsSync(join(home, '.pochi')),
    },
    adal: {
        name: 'adal',
        displayName: 'AdaL',
        skillsDir: '.adal/skills',
        globalSkillsDir: join(home, '.adal/skills'),
        detectInstalled: async()=>existsSync(join(home, '.adal')),
    },
    universal: {
        name: 'universal',
        displayName: 'Universal',
        skillsDir: '.agents/skills',
        globalSkillsDir: join(config_home, 'agents/skills'),
        showInUniversalList: false,
        detectInstalled: async()=>false,
    },
}

const detectInstalledAgents = async(): Promise<Agent_type[]>=>{
    const results = await Promise.all(
        Object.entries(agents).map(async([type, config])=>({
            type: type as Agent_type,
            installed: await config.detectInstalled(),
        }))
    )
    return results.filter(result=>result.installed).map(result=>result.type)
}

const getAgentConfig = (type: Agent_type): Agent_config=>agents[type]

const getUniversalAgents = (): Agent_type[]=>{
    return (Object.entries(agents) as [Agent_type, Agent_config][])
        .filter(([_, config])=>
            config.skillsDir == '.agents/skills'
            && config.showInUniversalList !== false)
        .map(([type])=>type)
}

const getNonUniversalAgents = (): Agent_type[]=>{
    return (Object.entries(agents) as [Agent_type, Agent_config][])
        .filter(([_, config])=>config.skillsDir != '.agents/skills')
        .map(([type])=>type)
}

const isUniversalAgent = (type: Agent_type): boolean=>
    agents[type].skillsDir == '.agents/skills'

export {
    agents,
    detectInstalledAgents,
    getAgentConfig,
    getNonUniversalAgents,
    getOpenClawGlobalSkillsDir,
    getUniversalAgents,
    isUniversalAgent,
}
export type {Agent_type, Agent_config}
