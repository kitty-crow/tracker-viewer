import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
if(process.platform!=='win32') {console.log('Windows EXE is built by npm run build on Windows, and in the Windows CI job.');process.exit(0);}
if(!existsSync(join(root,'dist','index.html')))throw new Error('Build the Vite site before packaging.');
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer is required for Windows SEA packaging.');
const output=join(root,'release');const temp=join(root,'.sea');mkdirSync(output,{recursive:true});mkdirSync(temp,{recursive:true});
function collect(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?collect(join(dir,entry.name)):[join(dir,entry.name)]);}
const assets=Object.fromEntries(collect(join(root,'dist')).map(file=>[relative(join(root,'dist'),file).replaceAll('\\','/'),file]));
const assetIndex=join(temp,'asset-index.json');writeFileSync(assetIndex,JSON.stringify(Object.keys(assets)));assets['__asset-index.json']=assetIndex;
const helper = readFileSync(join(root,'scripts','runtime-tracker.cjs'),'utf8');
const original = readFileSync(join(root,'scripts','standalone.cjs'),'utf8');
const injected = original.replace('null /*__RUNTIME_HELPER__*/', `(function(){const module={exports:{}};${helper}\nreturn module.exports;})()`);
if(injected===original)throw new Error('Missing embedded runtime helper marker');
const packagedServer=join(temp,'standalone-generated.cjs');writeFileSync(packagedServer,injected);
const blob=join(temp,'tracker.blob');
const config=join(temp,'sea-config.json');
writeFileSync(config,JSON.stringify({main:packagedServer,output:blob,disableExperimentalSEAWarning:true,useCodeCache:false,useSnapshot:false,assets},null,2));
function run(command,args){const child=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false});if(child.status!==0)throw new Error(`${command} failed with exit code ${child.status}`);}
run(process.execPath,['--experimental-sea-config',config]);
const target=join(output,'TrackerViewer.exe');copyFileSync(process.execPath,target);
const postject=join(root,'node_modules','postject','dist','cli.js');
if(!existsSync(postject))throw new Error('postject is not installed. Run npm install.');
run(process.execPath,[postject,target,'NODE_SEA_BLOB',blob,'--sentinel-fuse','NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);
console.log(`Standalone Windows executable built: ${target}`);
