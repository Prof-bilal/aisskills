// Runs only inside Warden. All HTTP is fulfilled by the validated parent broker.
import {chromium} from 'playwright-core';
import {createInterface} from 'node:readline';
let next=0;
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
const input=createInterface({input:process.stdin});
input.on('line',line=>{const message=JSON.parse(line);const request=pending.get(message.id);if(request){pending.delete(message.id);if(message.error)request.reject(new Error(message.error));else request.resolve(message);}});
async function resource(url:string):Promise<any>{const id=++next;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});process.stdout.write(JSON.stringify({kind:'request',id,url})+'\n');});}
let browser;
try {
  browser=await chromium.launch({executablePath:process.argv[2],headless:true,chromiumSandbox:false,args:['--disable-dev-shm-usage','--disable-background-networking','--disable-extensions']});
  const context=await browser.newContext({viewport:{width:1440,height:1080},serviceWorkers:'block',acceptDownloads:false});
  await context.routeWebSocket('**/*',socket=>socket.close());
  await context.route('**/*',async route=>{
    try{if(route.request().method()!=='GET')return await route.abort();const response=await resource(route.request().url());
      if(response.url!==route.request().url())return await route.fulfill({status:302,headers:{location:response.url}});
      await route.fulfill({status:200,contentType:response.contentType,body:Buffer.from(response.body,'base64')});
    }catch{await route.abort();}
  });
  const page=await context.newPage();await page.goto(process.argv[3],{waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForTimeout(750);
  const text=(await page.locator('body').innerText({timeout:5000})).slice(0,16000);
  const snapshot=(await page.locator('body').ariaSnapshot({timeout:5000})).slice(0,16000);
  const screenshot=await page.screenshot({type:'png',fullPage:false,timeout:10000});
  if(screenshot.length>2*1024*1024)throw new Error('Screenshot exceeds 2 MiB');
  process.stdout.write(JSON.stringify({kind:'result',url:page.url(),title:(await page.title()).slice(0,300),text,snapshot,screenshot:screenshot.toString('base64')})+'\n');
}catch(error){process.stdout.write(JSON.stringify({kind:'error',error:error instanceof Error?error.message:String(error)})+'\n');process.exitCode=1;}
finally{await browser?.close();input.close();}
