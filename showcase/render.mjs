import fs from 'node:fs';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia, renderStill} from '@remotion/renderer';

const root=process.cwd();
let browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE;
if(process.env.REMOTION_USE_SPARTICUZ==='1'){
 const {default:chromium}=await import('@sparticuz/chromium');
 browserExecutable=await chromium.executablePath();
}
const browserOptions={...(browserExecutable?{browserExecutable}:{}),chromiumOptions:{gl:'swangle'}};
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.tsx'),publicDir:path.join(root,'public'),outDir:path.join(root,'build')});
const composition=await selectComposition({serveUrl,id:'OpenAssetsShowcase',...browserOptions});
fs.mkdirSync('out/frames',{recursive:true});
const frames=[90,240,430,635,865,1015,1150];
for(const frame of frames){await renderStill({serveUrl,composition,frame,output:`out/frames/frame-${frame}.png`,...browserOptions});console.log(`Verified render frame ${frame}`);}
if(!process.argv.includes('--stills-only')){
 let last=-1;
 await renderMedia({serveUrl,composition,codec:'h264',outputLocation:'out/OpenAssets-Showcase.mp4',crf:18,pixelFormat:'yuv420p',audioCodec:'aac',audioBitrate:'192k',concurrency:4,logLevel:'warn',...browserOptions,onProgress:({progress})=>{const p=Math.floor(progress*10);if(p!==last){last=p;console.log(`Render ${p*10}%`);}}});
 console.log('Finished out/OpenAssets-Showcase.mp4');
}
