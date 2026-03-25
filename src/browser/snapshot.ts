import type {Page} from 'playwright-core';

const DOM_REF_ATTRIBUTE = 'data-bd-ref';

type Snapshot_capture_opts = {
    compact?: boolean;
    depth?: number;
    interactive?: boolean;
    selector?: string;
};

type Snapshot_ref = {
    ref: string;
    selector: string;
};

type Snapshot_node = {
    children: Snapshot_node[];
    interactive?: boolean;
    level?: number;
    name?: string;
    placeholder?: string;
    ref?: string;
    role: string;
    value?: string;
};

type Snapshot_capture_payload = {
    nodes: Snapshot_node[];
    refs: Snapshot_ref[];
};

type Snapshot_capture_result = {
    compact: boolean;
    depth?: number;
    interactive: boolean;
    refs: Snapshot_ref[];
    selector?: string;
    snapshot: string;
    title: string;
    url: string;
};

type Snapshot_filter_opts = {
    compact: boolean;
    depth?: number;
    interactive: boolean;
};

type Snapshot_text_opts = {
    empty_label?: string;
    nodes: Snapshot_node[];
    title: string;
    url: string;
};

type Snapshot_evaluate_arg = {
    attr_name: string;
    selector?: string;
};

const normalize_text = (value: unknown): string|undefined=>{
    if (typeof value != 'string')
        return undefined;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
};

const quote_attr_value = (value: string)=>{
    return `"${value.replace(/"/g, '\\"')}"`;
};

const clone_snapshot_node = (
    node: Snapshot_node,
    children: Snapshot_node[],
): Snapshot_node=>({
    children,
    interactive: node.interactive,
    level: node.level,
    name: node.name,
    placeholder: node.placeholder,
    ref: node.ref,
    role: node.role,
    value: node.value,
});

const limit_snapshot_depth = (
    nodes: Snapshot_node[],
    max_depth: number,
    depth = 0,
): Snapshot_node[]=>{
    if (depth > max_depth)
        return [];

    return nodes.map(node=>clone_snapshot_node(
        node,
        depth == max_depth
            ? []
            : limit_snapshot_depth(node.children, max_depth, depth+1),
    ));
};

const filter_compact_nodes = (nodes: Snapshot_node[]): Snapshot_node[]=>{
    const filtered: Snapshot_node[] = [];

    for (const node of nodes)
    {
        const children = filter_compact_nodes(node.children);
        if (!node.interactive && children.length == 0)
            continue;
        filtered.push(clone_snapshot_node(node, children));
    }

    return filtered;
};

const flatten_interactive_nodes = (nodes: Snapshot_node[]): Snapshot_node[]=>{
    const flattened: Snapshot_node[] = [];

    const visit = (node: Snapshot_node)=>{
        if (node.interactive)
            flattened.push(clone_snapshot_node(node, []));
        for (const child of node.children)
            visit(child);
    };

    for (const node of nodes)
        visit(node);

    return flattened;
};

const apply_snapshot_filters = (
    nodes: Snapshot_node[],
    opts: Snapshot_filter_opts,
): Snapshot_node[]=>{
    const depth_limited = opts.depth === undefined
        ? nodes
        : limit_snapshot_depth(nodes, opts.depth);

    if (opts.interactive)
        return flatten_interactive_nodes(depth_limited);
    if (opts.compact)
        return filter_compact_nodes(depth_limited);
    return depth_limited;
};

const collect_ref_ids = (nodes: Snapshot_node[]): Set<string>=>{
    const ref_ids = new Set<string>();

    const visit = (node: Snapshot_node)=>{
        if (node.ref)
            ref_ids.add(node.ref);
        for (const child of node.children)
            visit(child);
    };

    for (const node of nodes)
        visit(node);

    return ref_ids;
};

const format_snapshot_line = (node: Snapshot_node, depth: number): string=>{
    const indent = '  '.repeat(depth);
    const role = normalize_text(node.role) ?? 'node';
    const name = normalize_text(node.name);
    const attrs: string[] = [];

    if (node.ref)
        attrs.push(`ref=${node.ref}`);
    if (node.level !== undefined)
        attrs.push(`level=${node.level}`);
    if (node.placeholder)
        attrs.push(`placeholder=${quote_attr_value(node.placeholder)}`);
    if (node.value)
        attrs.push(`value=${quote_attr_value(node.value)}`);

    const label = name ? `${role} ${quote_attr_value(name)}` : role;
    const suffix = attrs.length ? ` [${attrs.join(', ')}]` : '';
    return `${indent}- ${label}${suffix}`;
};

const format_snapshot_nodes = (
    nodes: Snapshot_node[],
    depth = 0,
): string[]=>{
    const lines: string[] = [];
    for (const node of nodes)
    {
        lines.push(format_snapshot_line(node, depth));
        lines.push(...format_snapshot_nodes(node.children, depth+1));
    }
    return lines;
};

const format_snapshot_text = (opts: Snapshot_text_opts): string=>{
    const lines = [
        `Page: ${normalize_text(opts.title) ?? 'Untitled'}`,
        `URL: ${normalize_text(opts.url) ?? 'about:blank'}`,
        '',
    ];
    const body = format_snapshot_nodes(opts.nodes);
    if (!body.length)
        body.push(opts.empty_label ?? '(empty)');
    return [...lines, ...body].join('\n');
};

const normalize_snapshot_depth = (depth: number|undefined): number|undefined=>{
    if (depth === undefined)
        return undefined;
    if (!Number.isInteger(depth) || depth < 0)
        throw new Error('Snapshot depth must be a non-negative integer.');
    return depth;
};

const normalize_snapshot_selector = (selector: string|undefined): string|undefined=>{
    if (selector === undefined)
        return undefined;
    const normalized = selector.trim();
    if (!normalized)
        throw new Error('Snapshot selector cannot be empty.');
    return normalized;
};

const read_page_title = async(page: Page): Promise<string>=>{
    try {
        return await page.title();
    } catch(_error) {
        return 'Untitled';
    }
};

const capture_snapshot = async(
    page: Page,
    opts: Snapshot_capture_opts = {},
): Promise<Snapshot_capture_result>=>{
    const compact = opts.compact === true;
    const depth = normalize_snapshot_depth(opts.depth);
    const interactive = opts.interactive === true;
    const selector = normalize_snapshot_selector(opts.selector);

    const payload = await page.evaluate((arg: Snapshot_evaluate_arg)=>{
        const browser_global = globalThis as unknown as {
            document?: {
                body?: unknown;
                documentElement?: unknown;
                getElementById?: (id: string)=>{textContent?: unknown}|null;
                querySelector?: (selector: string)=>unknown;
                querySelectorAll?: (selector: string)=>unknown[];
            };
            getComputedStyle?: (element: unknown)=>{
                display?: string;
                opacity?: string;
                visibility?: string;
            };
        };
        const doc = browser_global.document;
        const normalize = (value: unknown): string=>{
            return typeof value == 'string'
                ? value.replace(/\s+/g, ' ').trim()
                : '';
        };
        const to_array = (value: unknown): unknown[]=>{
            if (value == null)
                return [];
            return Array.isArray(value) ? value : Array.from(value as Iterable<unknown>);
        };

        if (!doc)
            return {nodes: [], refs: []};

        const explicit_role_map = new Set([
            'button',
            'checkbox',
            'combobox',
            'link',
            'menuitem',
            'option',
            'radio',
            'searchbox',
            'switch',
            'tab',
            'textbox',
        ]);
        const semantic_roles = new Set([
            'article',
            'banner',
            'blockquote',
            'cell',
            'code',
            'contentinfo',
            'definition',
            'form',
            'heading',
            'image',
            'list',
            'listitem',
            'main',
            'navigation',
            'paragraph',
            'region',
            'row',
            'table',
            'term',
        ]);
        let counter = 0;
        const refs: Snapshot_ref[] = [];

        const existing_refs = typeof doc.querySelectorAll == 'function'
            ? to_array(doc.querySelectorAll(`[${arg.attr_name}]`))
            : [];
        for (const element of existing_refs as Array<{removeAttribute?: (name: string)=>void}>)
        {
            element.removeAttribute?.(arg.attr_name);
        }

        const get_attr = (element: unknown, name: string): string=>{
            return normalize((element as {getAttribute?: (key: string)=>unknown})
                .getAttribute?.(name));
        };

        const get_direct_text = (element: unknown): string=>{
            const child_nodes = to_array((element as {childNodes?: unknown[]}).childNodes);
            return normalize(child_nodes
                .filter(node=>(node as {nodeType?: number}).nodeType == 3)
                .map(node=>(node as {textContent?: unknown}).textContent ?? '')
                .join(' '));
        };

        const is_visible = (element: unknown): boolean=>{
            if (!element)
                return false;
            if ((element as {getAttribute?: (name: string)=>unknown})
                .getAttribute?.('hidden') !== null)
            {
                return false;
            }
            if (get_attr(element, 'aria-hidden') == 'true')
                return false;
            const style = browser_global.getComputedStyle?.(element);
            if (style?.display == 'none' || style?.visibility == 'hidden'
                || style?.visibility == 'collapse')
            {
                return false;
            }
            if (style?.opacity !== undefined && Number(style.opacity) == 0)
                return false;
            const rect = (element as {
                getBoundingClientRect?: ()=>{height?: number; width?: number};
            }).getBoundingClientRect?.();
            if (rect && (rect.width ?? 0) <= 0 && (rect.height ?? 0) <= 0)
                return false;
            return true;
        };

        const get_role = (element: unknown): string=>{
            const explicit_role = get_attr(element, 'role').split(/\s+/)[0];
            if (explicit_role)
                return explicit_role;

            const tag = normalize((element as {tagName?: unknown}).tagName)
                .toLowerCase();
            if (/^h[1-6]$/.test(tag))
                return 'heading';
            if (tag == 'a' && get_attr(element, 'href'))
                return 'link';
            if (tag == 'button')
                return 'button';
            if (tag == 'img')
                return 'image';
            if (tag == 'main')
                return 'main';
            if (tag == 'nav')
                return 'navigation';
            if (tag == 'p')
                return 'paragraph';
            if (tag == 'header')
                return 'banner';
            if (tag == 'footer')
                return 'contentinfo';
            if (tag == 'section')
                return 'region';
            if (tag == 'article')
                return 'article';
            if (tag == 'form')
                return 'form';
            if (tag == 'ul' || tag == 'ol')
                return 'list';
            if (tag == 'li')
                return 'listitem';
            if (tag == 'table')
                return 'table';
            if (tag == 'tr')
                return 'row';
            if (tag == 'td' || tag == 'th')
                return 'cell';
            if (tag == 'code' || tag == 'pre')
                return 'code';
            if (tag == 'blockquote')
                return 'blockquote';
            if (tag == 'input')
            {
                const input_type = get_attr(element, 'type').toLowerCase();
                if (input_type == 'checkbox')
                    return 'checkbox';
                if (input_type == 'radio')
                    return 'radio';
                if (input_type == 'button' || input_type == 'submit'
                    || input_type == 'reset')
                {
                    return 'button';
                }
                if (input_type == 'search')
                    return 'searchbox';
                return 'textbox';
            }
            if (tag == 'textarea')
                return 'textbox';
            if (tag == 'select')
                return 'combobox';
            if (tag == 'option')
                return 'option';
            return tag || 'node';
        };

        const is_interactive = (element: unknown, role: string): boolean=>{
            if (explicit_role_map.has(role))
                return true;

            const tag = normalize((element as {tagName?: unknown}).tagName)
                .toLowerCase();
            if (tag == 'a' && get_attr(element, 'href'))
                return true;
            if (tag == 'button' || tag == 'select' || tag == 'textarea')
                return true;
            if (tag == 'input')
                return true;
            if ((element as {getAttribute?: (name: string)=>unknown})
                .getAttribute?.('onclick') !== null)
            {
                return true;
            }
            const tabindex = get_attr(element, 'tabindex');
            if (tabindex && !Number.isNaN(Number(tabindex)) && Number(tabindex) >= 0)
                return true;
            if (get_attr(element, 'contenteditable') == 'true')
                return true;
            return false;
        };

        const get_labelledby_text = (element: unknown): string=>{
            const labelledby = get_attr(element, 'aria-labelledby');
            if (!labelledby)
                return '';
            const ids = labelledby.split(/\s+/).filter(Boolean);
            const parts: string[] = [];
            for (const id of ids)
            {
                const labelled = doc.getElementById?.(id);
                const text = normalize(labelled?.textContent);
                if (text)
                    parts.push(text);
            }
            return parts.join(' ');
        };

        const get_name = (
            element: unknown,
            role: string,
            interactive: boolean,
        ): string=>{
            const labelled = get_attr(element, 'aria-label') || get_labelledby_text(element);
            if (labelled)
                return labelled;

            const alt = get_attr(element, 'alt');
            if (alt)
                return alt;

            const value = normalize((element as {value?: unknown}).value);
            if (value && (interactive || role == 'heading'))
                return value;

            const direct_text = get_direct_text(element);
            const full_text = normalize((element as {textContent?: unknown}).textContent);
            if (interactive || role == 'heading' || role == 'link' || role == 'button')
                return direct_text || full_text;
            return direct_text;
        };

        const visit = (element: unknown): Snapshot_node|null=>{
            if (!is_visible(element))
                return null;

            const children: Snapshot_node[] = [];
            const raw_children = to_array((element as {children?: unknown[]}).children);
            for (const child of raw_children)
            {
                const node = visit(child);
                if (node)
                    children.push(node);
            }

            const role = get_role(element);
            const interactive = is_interactive(element, role);
            const name = normalize(get_name(element, role, interactive)) || undefined;
            const placeholder = get_attr(element, 'placeholder') || undefined;
            const raw_value = normalize((element as {value?: unknown}).value);
            const value = raw_value && raw_value != name && raw_value != placeholder
                ? raw_value
                : undefined;
            const tag = normalize((element as {tagName?: unknown}).tagName)
                .toLowerCase();
            const heading_match = tag.match(/^h([1-6])$/);
            const level = heading_match ? Number(heading_match[1]) : undefined;

            let ref: string|undefined;
            if (interactive)
            {
                ref = `e${++counter}`;
                (element as {setAttribute?: (name: string, value: string)=>void})
                    .setAttribute?.(arg.attr_name, ref);
                refs.push({
                    ref,
                    selector: `[${arg.attr_name}="${ref}"]`,
                });
            }

            const meaningful = interactive || children.length > 0 || !!name
                || !!placeholder || !!value || semantic_roles.has(role);
            if (!meaningful)
                return null;

            return {
                children,
                interactive,
                level,
                name,
                placeholder,
                ref,
                role,
                value,
            };
        };

        const resolve_scope_root = (): unknown=>{
            const fallback_root = doc.body ?? doc.documentElement;
            if (!arg.selector)
                return fallback_root;
            if (typeof doc.querySelector != 'function')
            {
                throw new Error('Snapshot selector is not supported in this browser context.');
            }

            try {
                const scoped_root = doc.querySelector(arg.selector);
                if (!scoped_root)
                {
                    throw new Error(
                        `Snapshot selector "${arg.selector}" did not match any elements.`
                    );
                }
                return scoped_root;
            } catch(error) {
                if (error instanceof Error
                    && error.message.startsWith('Snapshot selector "'))
                {
                    throw error;
                }
                throw new Error(`Invalid snapshot selector "${arg.selector}".`);
            }
        };

        const root = resolve_scope_root();
        if (!root)
            return {nodes: [], refs};

        const root_tag = normalize((root as {tagName?: unknown}).tagName).toLowerCase();
        const nodes: Snapshot_node[] = [];

        if (root_tag == 'body' || root_tag == 'html')
        {
            for (const child of to_array((root as {children?: unknown[]}).children))
            {
                const node = visit(child);
                if (node)
                    nodes.push(node);
            }

            if (!nodes.length)
            {
                const fallback = visit(root);
                if (fallback)
                    nodes.push(fallback);
            }
        }
        else
        {
            const node = visit(root);
            if (node)
                nodes.push(node);
        }

        return {nodes, refs};
    }, {
        attr_name: DOM_REF_ATTRIBUTE,
        selector,
    }) as Snapshot_capture_payload;

    const nodes = apply_snapshot_filters(payload.nodes, {
        compact,
        depth,
        interactive,
    });
    const visible_ref_ids = collect_ref_ids(nodes);
    const refs = payload.refs.filter(entry=>visible_ref_ids.has(entry.ref));
    const title = await read_page_title(page);
    const url = page.url();

    return {
        compact,
        depth,
        interactive,
        refs,
        selector,
        snapshot: format_snapshot_text({
            empty_label: interactive ? '(no interactive elements)' : '(empty)',
            nodes,
            title,
            url,
        }),
        title,
        url,
    };
};

export {
    DOM_REF_ATTRIBUTE,
    capture_snapshot,
    format_snapshot_text,
};
export type {
    Snapshot_capture_opts,
    Snapshot_capture_result,
    Snapshot_node,
    Snapshot_ref,
    Snapshot_text_opts,
};
