import * as readline from 'readline'
import {Writable} from 'stream'

const is_tty = process.stdout.isTTY === true

const ansi = (code: string, text: string)=>
    is_tty ? `\x1b[${code}m${text}\x1b[0m` : text

const bold = (text: string)=>ansi('1', text)
const dim = (text: string)=>ansi('2', text)
const underline = (text: string)=>ansi('4', text)
const inverse = (text: string)=>ansi('7', text)
const strikethrough = (text: string)=>ansi('9', text)
const red = (text: string)=>ansi('31', text)
const green = (text: string)=>ansi('32', text)
const cyan = (text: string)=>ansi('36', text)

const silent_output = new Writable({
    write(_chunk, _encoding, callback)
    {
        callback()
    },
})

type Search_item<T> = {
    value: T;
    label: string;
    hint?: string;
}

type Locked_section<T> = {
    title: string;
    items: Search_item<T>[];
}

type Search_multiselect_options<T> = {
    message: string;
    items: Search_item<T>[];
    maxVisible?: number;
    initialSelected?: T[];
    required?: boolean;
    lockedSection?: Locked_section<T>;
}

const S_STEP_ACTIVE = green('◆')
const S_STEP_CANCEL = red('■')
const S_STEP_SUBMIT = green('◇')
const S_RADIO_ACTIVE = green('●')
const S_RADIO_INACTIVE = dim('○')
const S_BULLET = green('•')
const S_BAR = dim('│')
const S_BAR_H = dim('─')

const cancelSymbol = Symbol('cancel')

const filter_item = <T>(item: Search_item<T>, query: string): boolean=>{
    if (!query)
        return true
    const lower_query = query.toLowerCase()
    return item.label.toLowerCase().includes(lower_query)
        || String(item.value).toLowerCase().includes(lower_query)
}

const clear_render = (height: number)=>{
    if (height <= 0)
        return
    process.stdout.write(`\x1b[${height}A`)
    for (let i = 0; i < height; i++)
        process.stdout.write('\x1b[2K\x1b[1B')
    process.stdout.write(`\x1b[${height}A`)
}

const searchMultiselect = async<T>(
    options: Search_multiselect_options<T>
): Promise<T[]|symbol>=>new Promise(resolve=>{
    const {
        message,
        items,
        maxVisible = 8,
        initialSelected = [],
        required = false,
        lockedSection,
    } = options
    const rl = readline.createInterface({
        input: process.stdin,
        output: silent_output,
        terminal: false,
    })

    if (process.stdin.isTTY)
        process.stdin.setRawMode(true)
    readline.emitKeypressEvents(process.stdin, rl)

    let query = ''
    let cursor = 0
    let last_render_height = 0
    const selected = new Set<T>(initialSelected)
    const locked_values = lockedSection
        ? lockedSection.items.map(item=>item.value)
        : []

    const get_filtered = ()=>{
        return items.filter(item=>filter_item(item, query))
    }

    const render = (state: 'active'|'submit'|'cancel' = 'active')=>{
        clear_render(last_render_height)
        const lines: string[] = []
        const filtered = get_filtered()
        const icon = state == 'active' ? S_STEP_ACTIVE :
            state == 'cancel' ? S_STEP_CANCEL : S_STEP_SUBMIT
        lines.push(`${icon}  ${bold(message)}`)

        if (state == 'active')
        {
            if (lockedSection && lockedSection.items.length > 0)
            {
                lines.push(`${S_BAR}`)
                lines.push(
                    `${S_BAR}  ${S_BAR_H}${S_BAR_H} `
                    +`${bold(lockedSection.title)} `
                    +`${dim('── always included')} `
                    +`${S_BAR_H.repeat(12)}`
                )
                for (const item of lockedSection.items)
                    lines.push(`${S_BAR}    ${S_BULLET} ${bold(item.label)}`)
                lines.push(`${S_BAR}`)
                lines.push(
                    `${S_BAR}  ${S_BAR_H}${S_BAR_H} `
                    +`${bold('Additional agents')} `
                    +`${S_BAR_H.repeat(29)}`
                )
            }

            lines.push(
                `${S_BAR}  ${dim('Search:')} ${query}${inverse(' ')}`
            )
            lines.push(
                `${S_BAR}  ${dim('↑↓ move, space select, enter confirm')}`
            )
            lines.push(`${S_BAR}`)

            const visible_start = Math.max(
                0,
                Math.min(
                    cursor - Math.floor(maxVisible/2),
                    filtered.length - maxVisible
                )
            )
            const visible_end = Math.min(filtered.length,
                visible_start + maxVisible)
            const visible_items = filtered.slice(visible_start, visible_end)

            if (!filtered.length)
                lines.push(`${S_BAR}  ${dim('No matches found')}`)
            else
            {
                for (let i = 0; i < visible_items.length; i++)
                {
                    const item = visible_items[i]!
                    const actual_index = visible_start + i
                    const is_selected = selected.has(item.value)
                    const is_cursor = actual_index == cursor
                    const radio = is_selected ? S_RADIO_ACTIVE :
                        S_RADIO_INACTIVE
                    const label = is_cursor ? underline(item.label) :
                        item.label
                    const hint = item.hint ? dim(` (${item.hint})`) : ''
                    const prefix = is_cursor ? cyan('❯') : ' '
                    lines.push(`${S_BAR} ${prefix} ${radio} ${label}${hint}`)
                }
                const hidden_before = visible_start
                const hidden_after = filtered.length - visible_end
                if (hidden_before > 0 || hidden_after > 0)
                {
                    const parts: string[] = []
                    if (hidden_before > 0)
                        parts.push(`↑ ${hidden_before} more`)
                    if (hidden_after > 0)
                        parts.push(`↓ ${hidden_after} more`)
                    lines.push(`${S_BAR}  ${dim(parts.join('  '))}`)
                }
            }

            lines.push(`${S_BAR}`)
            const all_selected_labels = [
                ...(lockedSection
                    ? lockedSection.items.map(item=>item.label)
                    : []),
                ...items.filter(item=>selected.has(item.value))
                    .map(item=>item.label),
            ]
            if (!all_selected_labels.length)
                lines.push(`${S_BAR}  ${dim('Selected: (none)')}`)
            else
            {
                const summary = all_selected_labels.length <= 3
                    ? all_selected_labels.join(', ')
                    : `${all_selected_labels.slice(0, 3).join(', ')} `
                        +`+${all_selected_labels.length - 3} more`
                lines.push(`${S_BAR}  ${green('Selected:')} ${summary}`)
            }
            lines.push(`${dim('└')}`)
        }
        else if (state == 'submit')
        {
            const all_selected_labels = [
                ...(lockedSection
                    ? lockedSection.items.map(item=>item.label)
                    : []),
                ...items.filter(item=>selected.has(item.value))
                    .map(item=>item.label),
            ]
            lines.push(`${S_BAR}  ${dim(all_selected_labels.join(', '))}`)
        }
        else
            lines.push(`${S_BAR}  ${strikethrough(dim('Cancelled'))}`)

        process.stdout.write(lines.join('\n')+'\n')
        last_render_height = lines.length
    }

    const cleanup = ()=>{
        process.stdin.removeListener('keypress', keypress_handler)
        if (process.stdin.isTTY)
            process.stdin.setRawMode(false)
        rl.close()
    }

    const submit = ()=>{
        if (required && !selected.size && !locked_values.length)
            return
        render('submit')
        cleanup()
        resolve([...locked_values, ...Array.from(selected)])
    }

    const cancel = ()=>{
        render('cancel')
        cleanup()
        resolve(cancelSymbol)
    }

    const keypress_handler = (_str: string, key: readline.Key)=>{
        if (!key)
            return
        const filtered = get_filtered()
        if (key.name == 'return')
            return submit()
        if (key.name == 'escape' || key.ctrl && key.name == 'c')
            return cancel()
        if (key.name == 'up')
        {
            cursor = Math.max(0, cursor - 1)
            render()
            return
        }
        if (key.name == 'down')
        {
            cursor = Math.min(filtered.length - 1, cursor + 1)
            render()
            return
        }
        if (key.name == 'space')
        {
            const item = filtered[cursor]
            if (item)
            {
                if (selected.has(item.value))
                    selected.delete(item.value)
                else
                    selected.add(item.value)
            }
            render()
            return
        }
        if (key.name == 'backspace')
        {
            query = query.slice(0, -1)
            cursor = 0
            render()
            return
        }
        if (key.sequence && !key.ctrl && !key.meta
            && key.sequence.length == 1)
        {
            query += key.sequence
            cursor = 0
            render()
        }
    }

    process.stdin.on('keypress', keypress_handler)
    render()
})

export {searchMultiselect, cancelSymbol}
export type {
    Search_item,
    Locked_section,
    Search_multiselect_options,
}
