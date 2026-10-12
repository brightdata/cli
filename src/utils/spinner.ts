import {is_tty} from './output';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

type Spinner = {
    stop: (final_msg?: string)=>void;
    update: (msg: string)=>void;
};

const start = (msg: string): Spinner=>{
    if (!is_tty())
    {
        process.stderr.write(msg+'\n');
        return {stop: ()=>{}, update: ()=>{}};
    }
    let frame = 0;
    let current = msg;
    const timer = setInterval(()=>{
        process.stderr.write(`\r\x1b[36m${FRAMES[frame % FRAMES.length]}`+
            `\x1b[0m ${current}`);
        frame++;
    }, INTERVAL_MS);
    const stop = (final_msg?: string)=>{
        clearInterval(timer);
        process.stderr.write('\r\x1b[2K');
        if (final_msg)
            process.stderr.write(final_msg+'\n');
    };
    const update = (next: string)=>{
        current = next;
        process.stderr.write('\r\x1b[2K');
    };
    return {stop, update};
};

export {start};
export type {Spinner};
