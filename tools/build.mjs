import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const name of ['src','assets','THIRD_PARTY_NOTICES.md'])await cp(path.join(root,name),path.join(out,name),{recursive:true});
const html=(await readFile(path.join(root,'index.html'),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-static-site>').replaceAll('./node_modules/three/','./vendor/three/');
await writeFile(path.join(out,'index.html'),html);await writeFile(path.join(out,'.nojekyll'),'');
for(const name of ['build','examples/jsm','LICENSE'])await cp(path.join(root,'node_modules/three',name),path.join(out,'vendor/three',name),{recursive:true});
let bytes=0,count=0;
async function check(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await check(file);else{const data=await readFile(file);bytes+=data.length;count++;if(data.length>95*1024*1024)throw Error('Oversized file: '+path.relative(root,file));}}}
await check(out);console.log(`Built ${count} files, ${(bytes/1024/1024).toFixed(1)} MiB. Public build disables local QA, recording and telemetry.`);
