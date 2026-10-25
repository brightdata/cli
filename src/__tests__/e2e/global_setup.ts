import type {TestProject} from 'vitest/node';
import {build_cli} from './build';

declare module 'vitest' {
    export interface ProvidedContext {
        cli_entry: string;
    }
}

// Compile the CLI once per test run and share the entry path with every
// e2e file via inject('cli_entry').
export default (project: TestProject)=>{
    const {entry, cleanup} = build_cli();
    project.provide('cli_entry', entry);
    return cleanup;
};
