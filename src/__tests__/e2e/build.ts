import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';

const ROOT = resolve(__dirname, '../../..');

const build_cli = (): {entry: string; cleanup: ()=>void}=>{
    const cache = join(ROOT, 'node_modules', '.cache');
    mkdirSync(cache, {recursive: true});
    const dir = mkdtempSync(join(cache, 'e2e-'));
    copyFileSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
    execFileSync(process.execPath, [
        join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p', ROOT, '--outDir', join(dir, 'dist'),
        '--declaration', 'false', '--declarationMap', 'false',
        '--sourceMap', 'false',
    ], {stdio: 'pipe'});
    return {entry: join(dir, 'dist', 'index.js'),
        cleanup: ()=>rmSync(dir, {recursive: true, force: true})};
};

export {build_cli};
