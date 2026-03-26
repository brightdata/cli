import type {Browser, BrowserContext, Page} from 'playwright-core';

type Browser_connection_state = {
    browser: Browser|null;
    page: Page|null;
    connected: boolean;
    cdp_endpoint: string;
    dom_refs: Map<string, string>;
};

type Browser_connection_deps = {
    connect_over_cdp: (cdp_endpoint: string)=>Promise<Browser>;
};

type Browser_connection_hooks = {
    on_context?: (context: BrowserContext)=>void;
    on_page?: (page: Page)=>void;
};

const clear_connection_state = (state: Browser_connection_state)=>{
    state.browser = null;
    state.page = null;
    state.connected = false;
    state.dom_refs.clear();
};

const resolve_page = async(
    browser: Browser,
    hooks: Browser_connection_hooks = {}
): Promise<Page>=>{
    const contexts = browser.contexts();
    const context = contexts[0] ?? await browser.newContext();

    for (const existing_context of contexts)
        hooks.on_context?.(existing_context);
    if (!contexts.includes(context))
        hooks.on_context?.(context);

    const page = context.pages()[0] ?? await context.newPage();
    hooks.on_page?.(page);
    return page;
};

const connect_browser = async(
    state: Browser_connection_state,
    deps: Browser_connection_deps,
    hooks: Browser_connection_hooks = {}
): Promise<{browser: Browser; page: Page}>=>{
    const browser = await deps.connect_over_cdp(state.cdp_endpoint);
    browser.on('disconnected', ()=>{
        if (state.browser && state.browser != browser)
            return;
        clear_connection_state(state);
    });

    const page = await resolve_page(browser, hooks);
    return {browser, page};
};

const ensure_connected = async(
    state: Browser_connection_state,
    deps: Browser_connection_deps,
    hooks: Browser_connection_hooks = {}
): Promise<Page>=>{
    if (state.browser)
    {
        try {
            state.browser.contexts();
            state.connected = true;
        } catch(_error) {
            clear_connection_state(state);
        }
    }

    if (!state.browser)
    {
        const {browser, page} = await connect_browser(state, deps, hooks);
        state.browser = browser;
        state.page = page;
        state.connected = true;
        return page;
    }

    if (!state.page || state.page.isClosed())
        state.page = await resolve_page(state.browser, hooks);

    return state.page;
};

export {
    clear_connection_state,
    connect_browser,
    ensure_connected,
};
export type {
    Browser_connection_deps,
    Browser_connection_hooks,
    Browser_connection_state,
};
