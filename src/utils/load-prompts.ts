// Full module type, erased at compile time (no runtime require emitted).
type Prompts_module = typeof import('@inquirer/prompts');

let prompts_promise: Promise<Prompts_module>|undefined;

// @inquirer/prompts is ESM-only. Under tsconfig `module: commonjs`, a literal
// import('@inquirer/prompts') is down-compiled by tsc back into require(), which
// throws ERR_REQUIRE_ESM on Node < 22.12 / < 20.19. Wrapping import() in
// new Function() hides it from the compiler so it is emitted as a genuine native
// dynamic import. Same technique as load_open() in utils/browser_auth.ts.
const load_prompts = (): Promise<Prompts_module>=>{
    if (!prompts_promise)
    {
        const dynamic_import = new Function(
            'specifier',
            'return import(specifier);'
        ) as (specifier: string)=>Promise<Prompts_module>;
        prompts_promise = dynamic_import('@inquirer/prompts');
    }
    return prompts_promise;
};

export {load_prompts};
export type {Prompts_module};
