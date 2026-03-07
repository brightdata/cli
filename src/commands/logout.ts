import {Command} from 'commander';
import {clear, get_api_key} from '../utils/credentials';

const handle_logout = ()=>{
    const key = get_api_key();
    if (!key)
    {
        console.log('Not logged in.');
        return;
    }
    clear();
    console.log('Logged out. Credentials cleared.');
};

const logout_command = new Command('logout')
    .description('Clear stored Bright Data credentials')
    .action(handle_logout);

export {logout_command, handle_logout};
