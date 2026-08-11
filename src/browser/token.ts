import crypto from 'crypto';
import fs from 'fs';

const DAEMON_TOKEN_BYTES = 32;

const create_daemon_token = (): string=>
    crypto.randomBytes(DAEMON_TOKEN_BYTES).toString('hex');

const write_daemon_token = (token_path: string, token: string)=>{
    fs.writeFileSync(token_path, token, {encoding: 'utf8', mode: 0o600});
    // writeFileSync only applies "mode" when it creates the file.
    fs.chmodSync(token_path, 0o600);
};

const read_daemon_token = (token_path: string): string|undefined=>{
    try {
        return fs.readFileSync(token_path, 'utf8').trim() || undefined;
    } catch(_error) {
        return undefined;
    }
};

const is_daemon_token_valid = (expected: string, received: unknown): boolean=>{
    if (typeof received != 'string' || !received)
        return false;
    const expected_bytes = Buffer.from(expected, 'utf8');
    const received_bytes = Buffer.from(received, 'utf8');
    if (expected_bytes.length != received_bytes.length)
        return false;
    return crypto.timingSafeEqual(expected_bytes, received_bytes);
};

export {
    DAEMON_TOKEN_BYTES,
    create_daemon_token,
    is_daemon_token_valid,
    read_daemon_token,
    write_daemon_token,
};
