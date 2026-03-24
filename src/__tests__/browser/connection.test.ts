import {EventEmitter} from 'events';
import {describe, expect, it, vi} from 'vitest';
import type {Browser, BrowserContext, Page} from 'playwright-core';
import {
    clear_connection_state,
    connect_browser,
    ensure_connected,
} from '../../browser/connection';
import type {
    Browser_connection_hooks,
    Browser_connection_state,
} from '../../browser/connection';

class Mock_page extends EventEmitter {
    private closed = false;

    isClosed(){
        return this.closed;
    }

    close_page(){
        this.closed = true;
        this.emit('close');
    }
}

class Mock_context extends EventEmitter {
    private readonly mock_pages: Mock_page[];

    constructor(mock_pages: Mock_page[] = [new Mock_page()]){
        super();
        this.mock_pages = mock_pages;
    }

    async newPage(){
        const page = new Mock_page();
        this.mock_pages.push(page);
        this.emit('page', page as unknown as Page);
        return page as unknown as Page;
    }

    pages(){
        return this.mock_pages as unknown as Page[];
    }

    first_page(){
        return this.mock_pages[0];
    }
}

class Mock_browser extends EventEmitter {
    private contexts_error: Error|null = null;
    private readonly mock_contexts: Mock_context[];

    constructor(mock_contexts: Mock_context[] = [new Mock_context()]){
        super();
        this.mock_contexts = mock_contexts;
    }

    contexts(){
        if (this.contexts_error)
            throw this.contexts_error;
        return this.mock_contexts as unknown as BrowserContext[];
    }

    async newContext(){
        const context = new Mock_context([]);
        this.mock_contexts.push(context);
        return context as unknown as BrowserContext;
    }

    break_health_check(message = 'stale browser'){
        this.contexts_error = new Error(message);
    }

    disconnect(){
        this.emit('disconnected');
    }

    first_context(){
        return this.mock_contexts[0];
    }
}

const create_state = (): Browser_connection_state=>({
    browser: null,
    cdp_endpoint: 'wss://example.test',
    connected: false,
    dom_refs: new Map<string, string>(),
    page: null,
});

const create_hooks = ()=>{
    const hooks: Browser_connection_hooks = {
        on_context: vi.fn(),
        on_page: vi.fn(),
    };
    return hooks;
};

describe('browser/connection', ()=>{
    it('connects and reuses the first existing page', async()=>{
        const state = create_state();
        const hooks = create_hooks();
        const browser = new Mock_browser();

        const result = await connect_browser(state, {
            connect_over_cdp: vi.fn(async()=>browser as unknown as Browser),
        }, hooks);

        expect(result.browser).toBe(browser);
        expect(result.page).toBe(browser.first_context().first_page());
        expect(hooks.on_context).toHaveBeenCalledTimes(1);
        expect(hooks.on_page).toHaveBeenCalledWith(result.page);
    });

    it('clears connection state when the active browser disconnects', async()=>{
        const state = create_state();
        state.dom_refs.set('r1', '#hero');
        const browser = new Mock_browser();
        const {page} = await connect_browser(state, {
            connect_over_cdp: vi.fn(async()=>browser as unknown as Browser),
        });

        state.browser = browser as unknown as Browser;
        state.page = page;
        state.connected = true;

        browser.disconnect();

        expect(state.browser).toBe(null);
        expect(state.page).toBe(null);
        expect(state.connected).toBe(false);
        expect(state.dom_refs.size).toBe(0);
    });

    it('reconnects when the current browser fails the health check', async()=>{
        const state = create_state();
        const first_browser = new Mock_browser();
        const second_browser = new Mock_browser();
        state.browser = first_browser as unknown as Browser;
        state.page = first_browser.first_context().first_page() as unknown as Page;
        state.connected = true;
        state.dom_refs.set('r2', '#signup');
        first_browser.break_health_check();

        const connect_over_cdp = vi.fn()
            .mockResolvedValueOnce(second_browser as unknown as Browser);
        const hooks = create_hooks();
        const page = await ensure_connected(state, {connect_over_cdp}, hooks);

        expect(connect_over_cdp).toHaveBeenCalledTimes(1);
        expect(state.browser).toBe(second_browser);
        expect(state.page).toBe(page);
        expect(state.connected).toBe(true);
        expect(state.dom_refs.size).toBe(0);
        expect(hooks.on_page).toHaveBeenCalledWith(page);
    });

    it('reuses a healthy browser connection without reconnecting', async()=>{
        const browser = new Mock_browser();
        const state = create_state();
        state.browser = browser as unknown as Browser;
        state.page = browser.first_context().first_page() as unknown as Page;
        state.connected = false;

        const connect_over_cdp = vi.fn();
        const page = await ensure_connected(state, {
            connect_over_cdp: connect_over_cdp as unknown as (cdp_endpoint: string)=>Promise<Browser>,
        });

        expect(page).toBe(state.page);
        expect(state.connected).toBe(true);
        expect(connect_over_cdp).not.toHaveBeenCalled();
    });

    it('creates a new page when the current page is closed', async()=>{
        const browser = new Mock_browser([new Mock_context([])]);
        const state = create_state();
        state.browser = browser as unknown as Browser;
        const closed_page = new Mock_page();
        closed_page.close_page();
        state.page = closed_page as unknown as Page;
        state.connected = true;

        const hooks = create_hooks();
        const page = await ensure_connected(state, {
            connect_over_cdp: vi.fn() as unknown as (cdp_endpoint: string)=>Promise<Browser>,
        }, hooks);

        expect(page).toBe(browser.first_context().first_page());
        expect(state.page).toBe(page);
        expect(hooks.on_page).toHaveBeenCalledWith(page);
    });

    it('can clear connection state explicitly', ()=>{
        const state = create_state();
        state.browser = {} as Browser;
        state.page = {} as Page;
        state.connected = true;
        state.dom_refs.set('r3', '#footer');

        clear_connection_state(state);

        expect(state.browser).toBe(null);
        expect(state.page).toBe(null);
        expect(state.connected).toBe(false);
        expect(state.dom_refs.size).toBe(0);
    });
});
