import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.md':'text/plain; charset=utf-8'};
const prefix='/sands-of-the-absent/';
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}if(url.pathname==='/'){res.writeHead(302,{Location:prefix}).end();return;}if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}const relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';const file=path.resolve(root,relative);if(!file.startsWith(root)||!(await stat(file)).isFile()){res.writeHead(404).end();return;}const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404).end();}}).listen(8768,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8768'+prefix));
