(()=>{
'use strict';
const $=s=>document.querySelector(s);
let photos=[],filter='all';
const status=t=>{$('#status').textContent=t};
async function api(action,data){
 const r=await fetch('/.netlify/functions/api?action='+encodeURIComponent(action),{
  method:data?'POST':'GET',headers:{'content-type':'application/json'},
  ...(data?{body:JSON.stringify(data)}:{})
 });
 const j=await r.json();
 if(!r.ok)throw Error(j.error||'Request failed');
 return j;
}
// Cloudinary serves JPEG gallery previews, including for HEIC/HEIF originals.
// The stored original remains available via its original URL.
function thumbnail(url){
 try{
  const u=new URL(url);
 if(u.protocol!=='https:'||!(u.hostname==='res.cloudinary.com'||u.hostname.endsWith('.res.cloudinary.com')))return url;
  if(!u.pathname.includes('/image/upload/'))return url;
  u.pathname=u.pathname.replace('/image/upload/','/image/upload/f_jpg,q_auto,w_900,c_limit/');
  return u.toString();
 }catch{return url;}
}
function render(){
 const root=$('#photos');root.replaceChildren();
 const items=photos.filter(p=>filter==='all'||p.team===filter);
 if(!items.length){const p=document.createElement('p');p.className='note';p.textContent='No photos for this team yet.';root.append(p);return;}
 for(const p of items){
  const card=document.createElement('div');card.className='photo';card.dataset.team=p.team;
  const link=document.createElement('a');link.href=p.url;link.target='_blank';link.rel='noopener noreferrer';link.title='Open full-size photo';
  const img=document.createElement('img');img.src=thumbnail(p.url);img.alt=p.team+' football season photo';img.loading='lazy';img.decoding='async';
  img.onerror=()=>{img.alt='Preview unavailable — open original photo';};
  const caption=document.createElement('span');caption.textContent=p.team.toUpperCase();
  link.append(img);card.append(link,caption);root.append(card);
 }
}
async function refresh(){
 const data=await api('list');photos=data.photos||[];render();
 if(data.more)status('Showing the newest 500 photos. Contact the organizer for older photos.');
}
// Compress on the visitor's device before sending anything to Cloudinary.
// The upload is capped at 2000 px and saved as JPEG at 82% quality.
async function optimize(file){
 const supported=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
 if(!supported.includes(file.type))throw Error('Unsupported photo format: '+file.name);
 if(file.size>30*1024*1024)throw Error(file.name+' exceeds 30 MB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file);}catch{
  throw Error('Your browser cannot read '+file.name+'. If this is an HEIC photo, please export it as JPEG and try again.');
 }
 try{
  const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale));
  const height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Image processing is unavailable in this browser.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height); // Flatten PNG transparency for JPEG.
  ctx.drawImage(bitmap,0,0,width,height);
  const image=canvas.toDataURL('image/jpeg',0.82);
  if(!image.startsWith('data:image/jpeg;base64,'))throw Error('Could not convert '+file.name+' to JPEG.');
  if(image.length>9_000_000)throw Error(file.name+' is still too large after compression.');
  return image;
 }finally{bitmap.close?.();}
}
// HEIC/HEIF cannot be decoded by every browser. Send the original directly to
// Cloudinary with a short-lived server-generated signature instead of decoding
// it on the phone or passing a large base64 payload through Netlify Functions.
function isHighEfficiency(file){
 return /\.(heic|heif)$/i.test(file.name)||/image\/(heic|heif)/i.test(file.type);
}
async function uploadOriginal(file,team){
 if(file.size>30*1024*1024)throw Error(file.name+' exceeds 30 MB.');
 const signed=await api('sign-upload',{team});
 const form=new FormData();
 form.append('file',file,file.name);
 for(const [key,value] of Object.entries(signed.params))form.append(key,String(value));
 form.append('api_key',signed.apiKey);
 form.append('signature',signed.signature);
 let response;
 try{response=await fetch('https://api.cloudinary.com/v1_1/'+encodeURIComponent(signed.cloud)+'/image/upload',{method:'POST',body:form});}
 catch{throw Error('Could not reach the photo service. Check your connection and try again.');}
 let result={};try{result=await response.json();}catch{}
 if(!response.ok)throw Error(result.error?.message||'The photo service rejected this file.');
 if(!result.public_id)throw Error('The photo service did not confirm the upload.');
}
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));
 filter=b.dataset.filter;render();
}));
$('#send').onclick=async()=>{
 const files=[...$('#files').files];
 if(!$('#consent').checked)return status('Please confirm permission to share.');
 if(!files.length||files.length>10)return status('Select 1–10 photos.');
 $('#send').disabled=true;let n=0;const failures=[];
 try{
  for(let i=0;i<files.length;i++){
   const file=files[i];
   try{
    status('Preparing photo '+(i+1)+' of '+files.length+'...');
    if(isHighEfficiency(file)){
     status('Uploading high-efficiency photo '+(i+1)+' of '+files.length+'...');
     await uploadOriginal(file,$('#team').value);
    }else{
     const image=await optimize(file);
     status('Uploading photo '+(i+1)+' of '+files.length+'...');
     await api('upload',{team:$('#team').value,image});
    }
    n++;
   }catch(e){failures.push(file.name+': '+e.message);}
  }
  try{await refresh();}catch(e){failures.push('Gallery refresh: '+e.message);}
  status(failures.length?n+' of '+files.length+' photos uploaded. Problems: '+failures.join(' | '):n+' photos uploaded successfully.');
  if(!failures.length)$('#files').value='';
 }finally{$('#send').disabled=false;}
};
refresh().catch(e=>status('Gallery could not load: '+e.message));
})();
