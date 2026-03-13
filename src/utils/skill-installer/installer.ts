import {
    access,
    lstat,
    mkdir,
    readlink,
    realpath,
    rm,
    symlink,
    writeFile,
} from 'fs/promises'
import {homedir, platform} from 'os'
import {basename, dirname, join, normalize, relative, resolve, sep}
    from 'path'
import {agents, isUniversalAgent} from './agents'
import type {Agent_type} from './agents'

const AGENTS_DIR = '.agents'
const SKILLS_SUBDIR = 'skills'

type Skill_to_install = {
    name: string;
    files: Record<string, string>;
}

type Install_mode = 'symlink'|'copy'

type Install_result = {
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: Install_mode;
    symlinkFailed?: boolean;
    error?: string;
}

const sanitizeName = (name: string): string=>{
    const sanitized = name
        .toLowerCase()
        .replace(/[^a-z0-9._]+/g, '-')
        .replace(/^[.\-]+|[.\-]+$/g, '')
    return sanitized.substring(0, 255) || 'unnamed-skill'
}

const isPathSafe = (base_path: string, target_path: string): boolean=>{
    const normalized_base = normalize(resolve(base_path))
    const normalized_target = normalize(resolve(target_path))
    return normalized_target.startsWith(normalized_base + sep)
        || normalized_target == normalized_base
}

const getCanonicalSkillsDir = (global: boolean, cwd?: string): string=>{
    const base_dir = global ? homedir() : cwd || process.cwd()
    return join(base_dir, AGENTS_DIR, SKILLS_SUBDIR)
}

const getAgentBaseDir = (
    agent_type: Agent_type,
    global: boolean,
    cwd?: string
): string=>{
    if (isUniversalAgent(agent_type))
        return getCanonicalSkillsDir(global, cwd)

    const agent = agents[agent_type]
    const base_dir = global ? homedir() : cwd || process.cwd()

    if (global)
    {
        if (agent.globalSkillsDir === undefined)
            return join(base_dir, agent.skillsDir)
        return agent.globalSkillsDir
    }
    return join(base_dir, agent.skillsDir)
}

const cleanAndCreateDirectory = async(path: string): Promise<void>=>{
    try {
        await rm(path, {recursive: true, force: true})
    } catch(_e) {}
    await mkdir(path, {recursive: true})
}

const resolveSymlinkTarget = (link_path: string, link_target: string): string=>
    resolve(dirname(link_path), link_target)

const resolveParentSymlinks = async(path: string): Promise<string>=>{
    const resolved = resolve(path)
    const dir = dirname(resolved)
    const base = basename(resolved)
    try {
        const real_dir = await realpath(dir)
        return join(real_dir, base)
    } catch(_e) {
        return resolved
    }
}

const createSymlink = async(
    target: string,
    link_path: string
): Promise<boolean>=>{
    try {
        const resolved_target = resolve(target)
        const resolved_link_path = resolve(link_path)
        const [real_target, real_link_path] = await Promise.all([
            realpath(resolved_target).catch(()=>resolved_target),
            realpath(resolved_link_path).catch(()=>resolved_link_path),
        ])

        if (real_target == real_link_path)
            return true

        const [real_target_with_parents, real_link_with_parents] =
            await Promise.all([
                resolveParentSymlinks(target),
                resolveParentSymlinks(link_path),
            ])

        if (real_target_with_parents == real_link_with_parents)
            return true

        try {
            const stats = await lstat(link_path)
            if (stats.isSymbolicLink())
            {
                const existing_target = await readlink(link_path)
                if (resolveSymlinkTarget(link_path, existing_target)
                    == resolved_target)
                {
                    return true
                }
                await rm(link_path)
            }
            else
                await rm(link_path, {recursive: true})
        } catch(err: unknown) {
            if (err && typeof err == 'object' && 'code' in err
                && err.code == 'ELOOP')
            {
                try {
                    await rm(link_path, {force: true})
                } catch(_e) {}
            }
        }

        const link_dir = dirname(link_path)
        await mkdir(link_dir, {recursive: true})
        const real_link_dir = await resolveParentSymlinks(link_dir)
        const relative_path = relative(real_link_dir, target)
        const symlink_type = platform() == 'win32' ? 'junction' : undefined
        await symlink(relative_path, link_path, symlink_type)
        return true
    } catch(_e) {
        return false
    }
}

const writeSkillFiles = async(
    target_dir: string,
    files: Record<string, string>
)=>{
    await mkdir(target_dir, {recursive: true})
    for (const [file_path, content] of Object.entries(files))
    {
        const full_path = join(target_dir, file_path)
        if (!isPathSafe(target_dir, full_path))
            continue
        const parent_dir = dirname(full_path)
        if (parent_dir != target_dir)
            await mkdir(parent_dir, {recursive: true})
        await writeFile(full_path, content, 'utf8')
    }
}

const installSkillForAgent = async(
    skill: Skill_to_install,
    agent_type: Agent_type,
    options: {global?: boolean; cwd?: string; mode?: Install_mode} = {}
): Promise<Install_result>=>{
    const agent = agents[agent_type]
    const is_global = options.global ?? false
    const cwd = options.cwd || process.cwd()
    const install_mode = options.mode ?? 'symlink'

    if (is_global && agent.globalSkillsDir === undefined)
    {
        return {
            success: false,
            path: '',
            mode: install_mode,
            error: `${agent.displayName} does not support `
                +`global skill installation`,
        }
    }

    const raw_skill_name = skill.name || basename(skill.name)
    const skill_name = sanitizeName(raw_skill_name)
    const canonical_base = getCanonicalSkillsDir(is_global, cwd)
    const canonical_dir = join(canonical_base, skill_name)
    const agent_base = getAgentBaseDir(agent_type, is_global, cwd)
    const agent_dir = join(agent_base, skill_name)

    if (!isPathSafe(canonical_base, canonical_dir))
    {
        return {
            success: false,
            path: agent_dir,
            mode: install_mode,
            error: 'Invalid skill name: potential path traversal detected',
        }
    }

    if (!isPathSafe(agent_base, agent_dir))
    {
        return {
            success: false,
            path: agent_dir,
            mode: install_mode,
            error: 'Invalid skill name: potential path traversal detected',
        }
    }

    try {
        if (install_mode == 'copy')
        {
            await cleanAndCreateDirectory(agent_dir)
            await writeSkillFiles(agent_dir, skill.files)
            return {
                success: true,
                path: agent_dir,
                mode: 'copy',
            }
        }

        await cleanAndCreateDirectory(canonical_dir)
        await writeSkillFiles(canonical_dir, skill.files)

        if (is_global && isUniversalAgent(agent_type))
        {
            return {
                success: true,
                path: canonical_dir,
                canonicalPath: canonical_dir,
                mode: 'symlink',
            }
        }

        const symlink_created = await createSymlink(canonical_dir, agent_dir)
        if (!symlink_created)
        {
            await cleanAndCreateDirectory(agent_dir)
            await writeSkillFiles(agent_dir, skill.files)
            return {
                success: true,
                path: agent_dir,
                canonicalPath: canonical_dir,
                mode: 'symlink',
                symlinkFailed: true,
            }
        }

        return {
            success: true,
            path: agent_dir,
            canonicalPath: canonical_dir,
            mode: 'symlink',
        }
    } catch(error) {
        return {
            success: false,
            path: agent_dir,
            mode: install_mode,
            error: error instanceof Error ? error.message : 'Unknown error',
        }
    }
}

const isSkillInstalled = async(
    skill_name: string,
    agent_type: Agent_type,
    options: {global?: boolean; cwd?: string} = {}
): Promise<boolean>=>{
    const agent = agents[agent_type]
    const sanitized = sanitizeName(skill_name)

    if (options.global && agent.globalSkillsDir === undefined)
        return false

    const target_base = getAgentBaseDir(
        agent_type,
        options.global ?? false,
        options.cwd
    )
    const skill_dir = join(target_base, sanitized)

    if (!isPathSafe(target_base, skill_dir))
        return false

    try {
        await access(skill_dir)
        return true
    } catch(_e) {
        return false
    }
}

const getInstallPath = (
    skill_name: string,
    agent_type: Agent_type,
    options: {global?: boolean; cwd?: string} = {}
): string=>{
    const target_base = getAgentBaseDir(
        agent_type,
        options.global ?? false,
        options.cwd
    )
    const install_path = join(target_base, sanitizeName(skill_name))

    if (!isPathSafe(target_base, install_path))
        throw new Error('Invalid skill name: potential path traversal detected')

    return install_path
}

const getCanonicalPath = (
    skill_name: string,
    options: {global?: boolean; cwd?: string} = {}
): string=>{
    const canonical_base = getCanonicalSkillsDir(
        options.global ?? false,
        options.cwd
    )
    const canonical_path = join(canonical_base, sanitizeName(skill_name))

    if (!isPathSafe(canonical_base, canonical_path))
        throw new Error('Invalid skill name: potential path traversal detected')

    return canonical_path
}

export {
    installSkillForAgent,
    isSkillInstalled,
    getInstallPath,
    getCanonicalPath,
}
export type {Skill_to_install, Install_mode, Install_result}
