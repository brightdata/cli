import fs from 'fs';
import path from 'path';
import os from 'os';

const get_config_dir = ()=>{
    const platform = process.platform;
    if (platform == 'darwin')
    {
        return path.join(os.homedir(), 'Library', 'Application Support',
            'brightdata-cli');
    }
    if (platform == 'win32')
        return path.join(os.homedir(), 'AppData', 'Roaming', 'brightdata-cli');
    return path.join(os.homedir(), '.config', 'brightdata-cli');
};

const get_credentials_path = ()=>path.join(get_config_dir(), 
    'credentials.json');

type Credentials = {
    api_key: string;
};

const load = (): Credentials|null=>{
    const cred_path = get_credentials_path();
    if (!fs.existsSync(cred_path))
        return null;
    try {
        const raw = fs.readFileSync(cred_path, 'utf8');
        return JSON.parse(raw) as Credentials;
    } catch(e) {
        return null;
    }
};

const save = (creds: Credentials)=>{
    const dir = get_config_dir();
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(get_credentials_path(), JSON.stringify(creds, null, 4),
        {mode: 0o600});
};

const clear = ()=>{
    const cred_path = get_credentials_path();
    if (fs.existsSync(cred_path))
        fs.unlinkSync(cred_path);
};

const get_api_key = (): string|undefined=>{
    const creds = load();
    return creds?.api_key;
};

export {get_config_dir, load, save, clear, get_api_key};
export type {Credentials};
