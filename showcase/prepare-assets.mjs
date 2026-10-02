import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
fs.mkdirSync('public',{recursive:true});
if(!fs.existsSync('public/openassets-logo.png')){
 fs.copyFileSync('../frontend/public/assets/logo.png','public/openassets-logo.png');
}
if(!fs.existsSync('public/soundtrack.wav')) execFileSync('python3',['make_audio.py'],{stdio:'inherit'});
