import type {Locator, Page} from 'playwright-core';
import {DOM_REF_ATTRIBUTE} from './snapshot';

const LOCATE_TIMEOUT_MS = 5_000;

type Interaction_result = {
    ref: string;
    action: string;
};

type Scroll_direction = 'up'|'down'|'left'|'right';

type Scroll_params = {
    direction?: Scroll_direction;
    distance?: number;
    ref?: string;
};

const SCROLL_DISTANCE_DEFAULT = 300;

const friendly_error = (error: string): string=>{
    if (error.includes('strict mode violation'))
        return 'Element matched multiple results. Take a new snapshot and use the correct ref.';
    if (error.includes('not visible') || error.includes('hidden'))
        return 'Element exists but is hidden. Try scrolling or waiting.';
    if (error.includes('intercept'))
        return 'Another element is covering the target. Close overlays or scroll.';
    if (error.includes('timeout') || error.includes('Timeout'))
        return 'Operation timed out. The page may still be loading.';
    return error;
};

const wrap_interaction_error = (error: unknown): never=>{
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(friendly_error(message));
};

const normalize_ref = (ref: unknown): string=>{
    if (typeof ref != 'string' || !ref.trim())
        throw new Error('Interaction requires a non-empty "ref" parameter.');
    return ref.trim();
};

const locate_by_ref = (page: Page, ref: string): Locator=>{
    return page.locator(`[${DOM_REF_ATTRIBUTE}="${ref}"]`);
};

const assert_ref_visible = async(locator: Locator, ref: string): Promise<void>=>{
    try {
        await locator.waitFor({state: 'visible', timeout: LOCATE_TIMEOUT_MS});
    } catch(error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('timeout') || message.includes('Timeout'))
        {
            throw new Error(
                `Element "${ref}" not found or not visible. `
                +'Take a new snapshot to refresh element refs.'
            );
        }
        throw error;
    }
};

const handle_click = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Interaction_result>=>{
    const ref = normalize_ref(params?.['ref']);
    const locator = locate_by_ref(page, ref);
    try {
        await assert_ref_visible(locator, ref);
        await locator.click();
    } catch(error) {
        wrap_interaction_error(error);
    }
    return {ref, action: 'click'};
};

const handle_type = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Interaction_result>=>{
    const ref = normalize_ref(params?.['ref']);
    const text = params?.['text'];
    if (typeof text != 'string')
        throw new Error('Type requires a "text" parameter.');

    const append = params?.['append'] === true;
    const submit = params?.['submit'] === true;
    const locator = locate_by_ref(page, ref);

    try {
        await assert_ref_visible(locator, ref);
        if (append)
            await locator.pressSequentially(text);
        else
            await locator.fill(text);
        if (submit)
            await locator.press('Enter');
    } catch(error) {
        wrap_interaction_error(error);
    }
    return {ref, action: 'type'};
};

const handle_select = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Interaction_result>=>{
    const ref = normalize_ref(params?.['ref']);
    const value = params?.['value'];
    if (typeof value != 'string')
        throw new Error('Select requires a "value" parameter.');

    const locator = locate_by_ref(page, ref);
    try {
        await assert_ref_visible(locator, ref);
        await locator.selectOption({label: value});
    } catch(error) {
        wrap_interaction_error(error);
    }
    return {ref, action: 'select'};
};

const handle_check = async(
    page: Page,
    params: Record<string, unknown>|undefined,
    checked: boolean,
): Promise<Interaction_result>=>{
    const ref = normalize_ref(params?.['ref']);
    const locator = locate_by_ref(page, ref);
    try {
        await assert_ref_visible(locator, ref);
        await locator.setChecked(checked);
    } catch(error) {
        wrap_interaction_error(error);
    }
    return {ref, action: checked ? 'check' : 'uncheck'};
};

const handle_hover = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Interaction_result>=>{
    const ref = normalize_ref(params?.['ref']);
    const locator = locate_by_ref(page, ref);
    try {
        await assert_ref_visible(locator, ref);
        await locator.hover();
    } catch(error) {
        wrap_interaction_error(error);
    }
    return {ref, action: 'hover'};
};

const normalize_scroll_direction = (
    value: unknown,
): Scroll_direction=>{
    if (value === undefined || value === null)
        return 'down';
    if (value !== 'up' && value !== 'down' && value !== 'left' && value !== 'right')
    {
        throw new Error(
            'Scroll direction must be "up", "down", "left", or "right".'
        );
    }
    return value;
};

const normalize_scroll_distance = (value: unknown): number=>{
    if (value === undefined || value === null)
        return SCROLL_DISTANCE_DEFAULT;
    if (typeof value != 'number' || !Number.isFinite(value) || value <= 0)
        throw new Error('Scroll distance must be a positive number.');
    return Math.floor(value);
};

const handle_fill = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Interaction_result>=>{
    const ref = normalize_ref(params?.['ref']);
    const value = params?.['value'];
    if (typeof value != 'string')
        throw new Error('Fill requires a "value" parameter.');

    const locator = locate_by_ref(page, ref);
    try {
        await assert_ref_visible(locator, ref);
        await locator.fill(value);
    } catch(error) {
        wrap_interaction_error(error);
    }
    return {ref, action: 'fill'};
};

type Get_content_result = {
    selector?: string;
    text: string;
};

const handle_get_text = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Get_content_result>=>{
    const selector = typeof params?.['selector'] == 'string'
        ? params['selector'].trim()
        : undefined;
    if (selector !== undefined && !selector)
        throw new Error('Get text selector cannot be empty.');

    try {
        if (selector)
        {
            const text = await page.locator(selector).first().innerText();
            return {selector, text};
        }
        const text = await page.evaluate(()=>document.body?.innerText ?? '');
        return {text};
    } catch(error) {
        return wrap_interaction_error(error);
    }
};

type Get_html_result = {
    selector?: string;
    html: string;
};

const handle_get_html = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<Get_html_result>=>{
    const selector = typeof params?.['selector'] == 'string'
        ? params['selector'].trim()
        : undefined;
    if (selector !== undefined && !selector)
        throw new Error('Get HTML selector cannot be empty.');

    try {
        if (selector)
        {
            const html = await page.locator(selector).first().innerHTML();
            return {selector, html};
        }
        const html = await page.evaluate(
            ()=>document.documentElement?.outerHTML ?? ''
        );
        return {html};
    } catch(error) {
        return wrap_interaction_error(error);
    }
};

const handle_scroll = async(
    page: Page,
    params: Record<string, unknown>|undefined,
): Promise<{action: string; ref?: string; direction?: string; distance?: number}>=>{
    const scroll_params: Scroll_params = {
        direction: normalize_scroll_direction(params?.['direction']),
        distance: normalize_scroll_distance(params?.['distance']),
        ref: typeof params?.['ref'] == 'string' ? params['ref'].trim() : undefined,
    };

    try {
        if (scroll_params.ref)
        {
            const locator = locate_by_ref(page, scroll_params.ref);
            await locator.scrollIntoViewIfNeeded({timeout: LOCATE_TIMEOUT_MS});
            return {action: 'scroll', ref: scroll_params.ref};
        }

        const dir = scroll_params.direction ?? 'down';
        const dist = scroll_params.distance ?? SCROLL_DISTANCE_DEFAULT;
        const delta_x = dir == 'left' ? -dist : dir == 'right' ? dist : 0;
        const delta_y = dir == 'up' ? -dist : dir == 'down' ? dist : 0;
        await page.evaluate(
            ({dx, dy}: {dx: number; dy: number})=>window.scrollBy(dx, dy),
            {dx: delta_x, dy: delta_y},
        );
        return {action: 'scroll', direction: dir, distance: dist};
    } catch(error) {
        return wrap_interaction_error(error);
    }
};

export {
    handle_check,
    handle_click,
    handle_fill,
    handle_get_html,
    handle_get_text,
    handle_hover,
    handle_scroll,
    handle_select,
    handle_type,
    locate_by_ref,
};
export type {
    Get_content_result,
    Get_html_result,
    Interaction_result,
    Scroll_direction,
};
