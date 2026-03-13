import dns from 'dns'
import {mkdir, readFile, writeFile} from 'fs/promises'
import net from 'net'
import {homedir} from 'os'
import {join} from 'path'
import {red, green, dim, fail, info} from '../utils/output'
import {start as start_spinner} from '../utils/spinner'
import {BRIGHTDATA_SKILLS} from '../utils/skill-installer/brightdata-skills'
import type {BrightDataSkill} from '../utils/skill-installer/brightdata-skills'
import {
    agents,
    detectInstalledAgents,
    getUniversalAgents,
    isUniversalAgent,
} from '../utils/skill-installer/agents'
import type {Agent_type} from '../utils/skill-installer/agents'
import {
    cancelSymbol,
    searchMultiselect,
} from '../utils/skill-installer/prompts/search-multiselect'
import {installSkillForAgent} from '../utils/skill-installer/installer'

type Last_selected_agents = {
    agents: string[];
}

type Skill_install_failure = {
    skill: string;
    agent?: string;
    reason: string;
}

type Github_content_entry = {
    type: 'file'|'dir';
    name: string;
    path: string;
    download_url?: string|null;
}

const LAST_SKILL_AGENTS_PATH = join(
    homedir(),
    '.brightdata',
    'last-skill-agents.json'
)
const GITHUB_CONTENTS_API = 'https://api.github.com/repos/brightdata/skills/'
    +'contents'

const shorten_path = (full_path: string): string=>{
    const home = homedir()
    const cwd = process.cwd()
    if (full_path == home || full_path.startsWith(home + '/'))
        return '~' + full_path.slice(home.length)
    if (full_path == cwd || full_path.startsWith(cwd + '/'))
        return '.' + full_path.slice(cwd.length)
    return full_path
}

const load_last_selected_agents = async(): Promise<Agent_type[]>=>{
    try {
        const raw = await readFile(LAST_SKILL_AGENTS_PATH, 'utf8')
        const parsed = JSON.parse(raw) as Last_selected_agents
        if (!parsed || !Array.isArray(parsed.agents))
            return []
        return parsed.agents.filter(agent=>agent in agents) as Agent_type[]
    } catch(_e) {
        return []
    }
}

const save_last_selected_agents = async(selected_agents: Agent_type[])=>{
    const dir = join(homedir(), '.brightdata')
    await mkdir(dir, {recursive: true})
    const body: Last_selected_agents = {agents: selected_agents}
    await writeFile(LAST_SKILL_AGENTS_PATH, JSON.stringify(body, null, 2),
        'utf8')
}

const list_skill_names = ()=>{
    return BRIGHTDATA_SKILLS.map(skill=>skill.name).join(', ')
}

const fetch_ipv4_first = async(url: string, init?: RequestInit)=>{
    const original_auto_select = net.getDefaultAutoSelectFamily()
    const original_dns_order = dns.getDefaultResultOrder()

    net.setDefaultAutoSelectFamily(false)
    dns.setDefaultResultOrder('ipv4first')

    try {
        return await fetch(url, init)
    } finally {
        dns.setDefaultResultOrder(original_dns_order)
        net.setDefaultAutoSelectFamily(original_auto_select)
    }
}

const fetch_text = async(url: string, headers: Record<string, string>)=>{
    const res = await fetch_ipv4_first(url, {headers})
    if (!res.ok)
    {
        const body = (await res.text()).trim()
        const body_hint = body ? ` - ${body.slice(0, 160)}` : ''
        throw new Error(`HTTP ${res.status} ${res.statusText}${body_hint}`)
    }
    return res.text()
}

const fetch_json = async<T>(url: string, headers: Record<string, string>)=>{
    const res = await fetch_ipv4_first(url, {headers})
    if (!res.ok)
    {
        const body = (await res.text()).trim()
        const body_hint = body ? ` - ${body.slice(0, 160)}` : ''
        throw new Error(`HTTP ${res.status} ${res.statusText}${body_hint}`)
    }
    return await res.json() as T
}

const format_error_detail = (error: unknown): string=>{
    if (!(error instanceof Error))
        return 'Unknown error'

    const parts = [error.message]
    const cause = error.cause

    if (cause && typeof cause == 'object')
    {
        const code = 'code' in cause && typeof cause.code == 'string'
            ? cause.code
            : undefined
        const host = 'hostname' in cause && typeof cause.hostname == 'string'
            ? cause.hostname
            : 'host' in cause && typeof cause.host == 'string'
            ? cause.host
            : undefined
        const cause_message = 'message' in cause
            && typeof cause.message == 'string'
            && cause.message != error.message
            ? cause.message
            : undefined

        if (code)
            parts.push(code)
        if (host)
            parts.push(host)
        if (cause_message)
            parts.push(cause_message)
    }

    return parts.join(' | ')
}

const resolve_selected_skills = async(
    skill_name?: string
): Promise<BrightDataSkill[]|symbol>=>{
    if (skill_name)
    {
        const selected_skill = BRIGHTDATA_SKILLS.find(skill=>
            skill.name == skill_name)
        if (!selected_skill)
        {
            fail(
                `Unknown skill "${skill_name}".\n`
                +`  Available skills: ${list_skill_names()}`
            )
            return []
        }
        return [selected_skill]
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY)
    {
        fail(
            'Interactive skill selection requires a TTY.\n'
            +'  Use: brightdata skill add <skill_name>'
        )
        return []
    }

    return searchMultiselect({
        message: 'Select Bright Data skills to install',
        items: BRIGHTDATA_SKILLS.map(skill=>({
            value: skill,
            label: skill.name,
            hint: skill.description,
        })),
        required: true,
    })
}

const resolve_selected_agents = async(): Promise<Agent_type[]|symbol>=>{
    const spinner = start_spinner('Detecting installed agents...')
    let installed_agents: Agent_type[] = []
    try {
        installed_agents = await detectInstalledAgents()
    } finally {
        spinner.stop()
    }

    const universal_agents = getUniversalAgents()
    const selectable_agents = installed_agents.filter(agent=>
        !isUniversalAgent(agent))
    const last_selected = await load_last_selected_agents()
    const initial_selected = last_selected.filter(agent=>
        selectable_agents.includes(agent))

    if (!process.stdin.isTTY || !process.stdout.isTTY)
    {
        const fallback_selected = initial_selected.length
            ? initial_selected
            : selectable_agents
        return [...universal_agents, ...fallback_selected]
    }

    const selected = await searchMultiselect({
        message: 'Which agents do you want to install to?',
        items: selectable_agents.map(agent=>({
            value: agent,
            label: agents[agent].displayName,
            hint: agents[agent].skillsDir,
        })),
        initialSelected: initial_selected,
        lockedSection: {
            title: 'Universal (.agents/skills)',
            items: universal_agents.map(agent=>({
                value: agent,
                label: agents[agent].displayName,
            })),
        },
    })

    if (selected !== cancelSymbol)
        await save_last_selected_agents(selected as Agent_type[])

    return selected
}

const fetch_skill_files = async(
    skill: BrightDataSkill
): Promise<Record<string, string>>=>{
    const api_headers = {
        'User-Agent': 'brightdata-cli',
        'Accept': 'application/vnd.github+json',
    }
    const raw_headers = {'User-Agent': 'brightdata-cli'}
    const pending_paths = [skill.repoPath]
    const files: Record<string, string> = {}

    while (pending_paths.length)
    {
        const current_path = pending_paths.pop()!
        const api_url = `${GITHUB_CONTENTS_API}/${current_path}?ref=main`
        const entries = await fetch_json<Github_content_entry[]|unknown>(
            api_url,
            api_headers
        )
        if (!Array.isArray(entries))
            throw new Error(`Unexpected GitHub API response for ${current_path}`)

        for (const entry of entries)
        {
            if (entry.type == 'dir')
            {
                pending_paths.push(entry.path)
                continue
            }
            if (entry.type != 'file' || !entry.download_url)
                continue

            const relative_path = entry.path.startsWith(skill.repoPath + '/')
                ? entry.path.slice(skill.repoPath.length + 1)
                : entry.name
            files[relative_path] = await fetch_text(entry.download_url,
                raw_headers)
        }
    }

    if (!Object.keys(files).length)
        throw new Error(`No files found for ${skill.name}`)

    return files
}

const print_summary = (
    success_count: number,
    selected_skills: BrightDataSkill[],
    selected_agents: Agent_type[],
    failures: Skill_install_failure[]
)=>{
    const skill_count = selected_skills.length
    const agent_count = selected_agents.length
    process.stderr.write('\n')
    process.stderr.write(
        dim(`Summary: ${success_count} installation`
            +`${success_count == 1 ? '' : 's'} across ${skill_count} `
            +`skill${skill_count == 1 ? '' : 's'} and ${agent_count} `
            +`agent${agent_count == 1 ? '' : 's'}.\n`)
    )
    if (failures.length)
    {
        process.stderr.write(
            red(`Failures: ${failures.length}\n`)
        )
        for (const failure of failures)
        {
            const agent_part = failure.agent ? ` → ${failure.agent}` : ''
            process.stderr.write(
                red(`✗ ${failure.skill}${agent_part}: ${failure.reason}\n`)
            )
        }
    }
}

const run_skill_add = async(skill_name?: string)=>{
    const selected_skills = await resolve_selected_skills(skill_name)
    if (selected_skills === cancelSymbol)
    {
        info('Skill installation cancelled.')
        return
    }

    const selected_agents = await resolve_selected_agents()
    if (selected_agents === cancelSymbol)
    {
        info('Skill installation cancelled.')
        return
    }

    const skills = selected_skills as BrightDataSkill[]
    const agents_to_install = selected_agents as Agent_type[]
    const failures: Skill_install_failure[] = []
    let success_count = 0

    for (const skill of skills)
    {
        const spinner = start_spinner(`Fetching skill "${skill.name}"...`)
        let files: Record<string, string> = {}
        try {
            files = await fetch_skill_files(skill)
            spinner.stop()
        } catch(error) {
            spinner.stop()
            const detail = format_error_detail(error)
            const reason = `Could not fetch skill '${skill.name}'.`
            process.stderr.write(red(`✗ ${reason}\n`))
            process.stderr.write(dim(`  URL: ${skill.skillMdUrl}\n`))
            process.stderr.write(dim(`  Details: ${detail}\n`))
            failures.push({
                skill: skill.name,
                reason: `${reason} ${detail}`,
            })
            process.exitCode = 1
            continue
        }

        let installed_skill = false
        for (const agent of agents_to_install)
        {
            const result = await installSkillForAgent({
                name: skill.name,
                files,
            }, agent)

            if (!result.success)
            {
                const reason = result.error || 'Installation failed.'
                failures.push({
                    skill: skill.name,
                    agent: agents[agent].displayName,
                    reason,
                })
                process.stderr.write(
                    red(`✗ Failed ${skill.name} → `
                        +`${agents[agent].displayName}: ${reason}\n`)
                )
                process.exitCode = 1
                continue
            }

            success_count++
            installed_skill = true
        }

        if (installed_skill)
        {
            process.stderr.write(green(`✓ Installed ${skill.name}`)+'\n')
        }
    }

    print_summary(success_count, skills, agents_to_install, failures)
}

export {run_skill_add}
