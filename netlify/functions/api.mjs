import crypto from 'node:crypto';
const json=(status,data)=>({statusCode:status,headers:{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'same-origin'},body:JSON.stringify(data)});
const teams=['freshman','sophomore','varsity'];
const folder='maine-south-football-2027';
export async function handler(event){
 try{
 const env=process.env; const {CLOUDINARY_CLOUD_NAME:cloud,CLOUDINARY_API_KEY:key,CLOUDINARY_API_SECRET:secret,ADMIN_TOKEN:admin}=env;
 if(!cloud||!key||!secret) return json(503,{error:'Site setup incomplete. Add Cloudinary credentials in Netlify.'});
 const qs=event.queryStringParameters||{}; const action=qs.action||'list';
 const auth='Basic '+Buffer.from(key+':'+secret).toString('base64');
 if(action==='admin-check' && event.httpMethod==='GET'){
  if(!admin||event.headers['x-admin-token']!==admin)return json(403,{error:'Incorrect organizer password.'});
  return json(200,{ok:true});
 }
 if(action==='list' && event.httpMethod==='GET'){
  const response=await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/search`,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify({expression:`asset_folder="${folder}" AND resource_type=image`,max_results:500,sort_by:[{created_at:'desc'}],with_field:['context','tags']})});
  const result=await response.json();if(!response.ok)return json(502,{error:'Gallery could not load.'});
  return json(200,{photos:(result.resources||[]).filter(x=>teams.some(t=>(x.tags||[]).includes('ms2027_'+t))).map(x=>({id:x.public_id,url:x.secure_url,team:teams.find(t=>(x.tags||[]).includes('ms2027_'+t)),created:x.created_at})),more:!!result.next_cursor});
 }
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 const data=JSON.parse(event.body||'{}');
 if(action==='sign-upload'){
  if(env.UPLOADS_ENABLED!=='true')return json(403,{error:'Uploads are currently disabled.'});
  if(!teams.includes(data.team))return json(400,{error:'Invalid team.'});
  const params={timestamp:Math.floor(Date.now()/1000),asset_folder:folder,tags:'ms2027_'+data.team};
  const sign=Object.keys(params).sort().map(k=>`${k}=${params[k]}`).join('&');
  const signature=crypto.createHash('sha1').update(sign+secret).digest('hex');
  return json(200,{cloud,apiKey:key,params,signature});
 }
 if(action==='upload'){
  if(env.UPLOADS_ENABLED!=='true')return json(403,{error:'Uploads are currently disabled.'});
  if(!teams.includes(data.team)||typeof data.image!=='string'||data.image.length>9_000_000||!/^data:image\/(jpeg|png|webp|heic|heif);base64,/.test(data.image))return json(400,{error:'Invalid photo, format, or file size.'});
  
  const form = new URLSearchParams({
    upload_preset: 'maine_south_2027',
    tags: 'ms2027_' + data.team,
    file: data.image
  });

  const r = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
    { method: 'POST', body: form }
  );

  const out = await r.json();

  if (!r.ok) {
    console.error(
      'Cloudinary upload failed:',
      r.status,
      JSON.stringify(out.error || {})
    );
    return json(502, {
      error: 'Photo upload failed. Please try again.'
    });
  }

  return json(200, { ok: true, id: out.public_id });
 }

 if(action==='delete'){
  // Organizer deletion is disabled until Supabase committee-role authorization is connected.
  return json(403,{error:'Organizer deletion is not yet enabled.'});
  if(!admin||event.headers['x-admin-token']!==admin)return json(403,{error:'Invalid organizer token.'});
  if(typeof data.id!=='string'||data.id.length>250)return json(400,{error:'Invalid photo ID.'});
  const timestamp=Math.floor(Date.now()/1000);const signature=crypto.createHash('sha1').update(`public_id=${data.id}&timestamp=${timestamp}`+secret).digest('hex');
  const form=new URLSearchParams({public_id:data.id,timestamp:String(timestamp),api_key:key,signature});
  const r=await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`,{method:'POST',body:form});const out=await r.json();
  if(!r.ok||out.result!=='ok')return json(502,{error:'Could not delete photo.'});return json(200,{ok:true});
 }
 return json(404,{error:'Unknown action'});
 }catch(e){return json(500,{error:'Unexpected error. Please try again.'});}
}
