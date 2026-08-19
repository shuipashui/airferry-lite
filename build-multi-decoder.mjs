import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, "vendor", "decimen", "decoder-worker.js");
const outputPath = path.join(root, "vendor", "decimen", "multi-decoder-worker.js");
let source = fs.readFileSync(sourcePath, "utf8");
const oldHandler = 'ct.onmessage=async f=>{const{id:p,buf:b,w:M,h:c}=f.data;try{const R=new ImageData(new Uint8ClampedArray(b),M,c),x=(await Jt(R,{formats:["QRCode"],maxNumberOfSymbols:1})).find(O=>O.isValid&&O.bytes.length>0);ct.postMessage({id:p,bytes:x?x.bytes:null})}catch{ct.postMessage({id:p,bytes:null})}}';
const newHandler = 'ct.onmessage=async f=>{const d=f.data,{id:p,w:M,h:c}=d;try{let R;if(d.lum){const y=new Uint8Array(d.lum),rgba=new Uint8ClampedArray(M*c*4);for(let i=0,j=0;i<y.length;++i,j+=4){const v=y[i];rgba[j]=v;rgba[j+1]=v;rgba[j+2]=v;rgba[j+3]=255}R=new ImageData(rgba,M,c)}else R=new ImageData(new Uint8ClampedArray(d.buf),M,c);const n=Math.max(1,Math.min(4,Number(d.maxSymbols)||1)),retry=d.retryBinarizer!==false,base={formats:["QRCode"],maxNumberOfSymbols:n,tryHarder:false,tryRotate:false,tryDownscale:false,tryInvert:false};let lastBin=self.__afBin||"LocalAverage";const hit=async bin=>(await Jt(R,Object.assign({},base,{binarizer:bin}))).filter(O=>O.isValid&&O.bytes.length>0).slice(0,4);let x=await hit(lastBin);if(!x.length&&retry){const alt=lastBin==="GlobalHistogram"?"LocalAverage":"GlobalHistogram";x=await hit(alt);if(x.length)lastBin=alt}if(x.length)self.__afBin=lastBin;ct.postMessage({id:p,bytes:x.map(O=>({bytes:O.bytes,position:O.position||null}))})}catch{ct.postMessage({id:p,bytes:null})}}';
if (!source.includes(oldHandler)) {
  throw new Error("Unexpected ZXing worker layout; multi-decoder patch was not applied");
}
source = source.replace(oldHandler, newHandler);
fs.writeFileSync(outputPath, source);
console.log(`Built ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
