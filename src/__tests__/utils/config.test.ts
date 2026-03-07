import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
    load,
    get,
    set,
    resolve,
    resolve_api_key,
    DEFAULTS,
} from '../../utils/config';

const mk_tmp_home = ()=>{
    const stamp = `${Date.now()}-${Math.random()}`;
    return path.join(os.tmpdir(), `brightdata-cli-tests-${stamp}`);
};

describe('utils/config', ()=>{
    let original_home = '';
    let tmp_home = '';

    beforeEach(()=>{
        original_home = process.env['HOME'] ?? '';
        tmp_home = mk_tmp_home();
        fs.mkdirSync(tmp_home, {recursive: true});
        process.env['HOME'] = tmp_home;
        delete process.env['BRIGHTDATA_API_KEY'];
        delete process.env['TEST_ZONE_ENV'];
    });

    afterEach(()=>{
        process.env['HOME'] = original_home;
        fs.rmSync(tmp_home, {recursive: true, force: true});
    });

    it('loads defaults when config does not exist', ()=>{
        expect(load()).toEqual(DEFAULTS);
    });

    it('persists values with set/get', ()=>{
        set('default_zone_unlocker', 'cli_unlocker');
        set('default_zone_serp', 'cli_serp');
        set('default_format', 'json');
        expect(get('default_zone_unlocker')).toBe('cli_unlocker');
        expect(get('default_zone_serp')).toBe('cli_serp');
        expect(get('default_format')).toBe('json');
    });

    it('resolves value by cli then env then config', ()=>{
        set('default_zone_unlocker', 'from_config');
        process.env['TEST_ZONE_ENV'] = 'from_env';
        expect(resolve('from_cli', 'TEST_ZONE_ENV', 'default_zone_unlocker'))
            .toBe('from_cli');
        expect(resolve(undefined, 'TEST_ZONE_ENV', 'default_zone_unlocker'))
            .toBe('from_env');
        delete process.env['TEST_ZONE_ENV'];
        expect(resolve(undefined, 'TEST_ZONE_ENV', 'default_zone_unlocker'))
            .toBe('from_config');
    });

    it('resolve_api_key uses cli first, then env', ()=>{
        process.env['BRIGHTDATA_API_KEY'] = 'from_env_key';
        expect(resolve_api_key('from_cli_key')).toBe('from_cli_key');
        expect(resolve_api_key(undefined)).toBe('from_env_key');
    });
});
