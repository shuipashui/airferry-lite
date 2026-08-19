import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, "vendor", "decimen", "decoder-worker.js");
const outputPath = path.join(root, "vendor", "decimen", "multi-decoder-worker.js");
let source = fs.readFileSync(sourcePath, "utf8");
const oldHandler = 'ct.onmessage=async f=>{const{id:p,buf:b,w:M,h:c}=f.data;try{const R=new ImageData(new Uint8ClampedArray(b),M,c),x=(await Jt(R,{formats:["QRCode"],maxNumberOfSymbols:1})).find(O=>O.isValid&&O.bytes.length>0);ct.postMessage({id:p,bytes:x?x.bytes:null})}catch{ct.postMessage({id:p,bytes:null})}}';
const newHandler = 'ct.onmessage=async f=>{const{id:p,buf:b,w:M,h:c}=f.data;try{const R=new ImageData(new Uint8ClampedArray(b),M,c),n=Math.max(1,Math.min(4,Number(f.data.maxSymbols)||1)),base={formats:["QRCode"],maxNumberOfSymbols:n,tryHarder:false,tryRotate:false,tryDownscale:false};let lastBin=self.__afBin||"LocalAverage",lastInv=!!self.__afInv;const hit=async(bin,inv)=>(await Jt(R,Object.assign({},base,{binarizer:bin,tryInvert:inv}))).filter(O=>O.isValid&&O.bytes.length>0).slice(0,4);let x=await hit(lastBin,lastInv);if(!x.length){const tries=[["LocalAverage",false],["GlobalHistogram",false],["LocalAverage",true],["GlobalHistogram",true]];for(const [bin,inv] of tries){if(bin===lastBin&&inv===lastInv)continue;x=await hit(bin,inv);if(x.length){lastBin=bin;lastInv=inv;break}}}if(x.length){self.__afBin=lastBin;self.__afInv=lastInv}ct.postMessage({id:p,bytes:x.map(O=>({bytes:O.bytes,position:O.position||null}))})}catch{ct.postMessage({id:p,bytes:null})}}';
if (!source.includes(oldHandler)) {
  throw new Error("Unexpected ZXing worker layout; multi-decoder patch was not applied");
}
source = source.replace(oldHandler, newHandler);
fs.writeFileSync(outputPath, source);
console.log(`Built ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
