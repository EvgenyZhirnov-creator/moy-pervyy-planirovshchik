/* Проверка опубликованной версии в отдельном профиле, без данных пользователя.
   NODE_PATH указывает на Playwright; ISP_PAGES_URL / ISP_BROWSER_PATH необязательны. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require('playwright'),C=require('../script.js');
const url=process.env.ISP_PAGES_URL || 'https://evgenyzhirnov-creator.github.io/moy-pervyy-planirovshchik/';
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'isp-pages-')),profile=path.join(artifacts,'profile'),errors=[],passes=[];
const options={executablePath:process.env.ISP_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:360,height:780},isMobile:true,hasTouch:true,locale:'ru-RU',timezoneId:'Europe/Moscow'};
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const pass=name=>{passes.push(name);process.stdout.write('PASS '+name+'\n');};
const read=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),C.KEYS.data);
const closed=page=>page.waitForFunction(()=>!document.querySelector('#editor').open);
function watch(page){page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()) && new URL(r.url()).origin!==new URL(url).origin)errors.push('Unexpected request: '+r.url());});}
async function run(){let context=await chromium.launchPersistentContext(profile,options);try{
  for(const file of ['index.html','style.css','script.js']){const response=await context.request.get(new URL(file,url).href);assert.equal(response.status(),200,file);assert.equal(hash(await response.body()),hash(fs.readFileSync(path.resolve(__dirname,'..',file))),file+' content');}
  pass('HTTPS: all three runtime files return 200 and exactly match local SHA-256');
  let page=await context.newPage();watch(page);const response=await page.goto(url);assert.equal(response.status(),200);await page.getByRole('heading',{name:'Ваш план. Ваш результат.'}).waitFor();assert.equal(await read(page),null);
  for(const width of [320,360,390,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:360,height:780});await page.screenshot({path:path.join(artifacts,'published-site.png')});
  await page.getByRole('button',{name:'Я сотрудник',exact:true}).tap();await page.locator('#employee-id').fill('QA-PAGES');await page.locator('#employee-name').fill('Проверка публикации');for(const code of C.CODES)await page.locator('#rate-'+code).fill(code==='OPIF'?'1':'0');await page.getByRole('button',{name:'Проверить данные',exact:true}).tap();await page.getByRole('button',{name:'Подтвердить и начать',exact:true}).tap();await page.locator('#edit-plan').waitFor();assert.equal((await read(page)).ownPlanner.employee.id,'QA-PAGES');
  pass('First launch, five widths, touch buttons and profile creation work on the published origin');
  await page.locator('#edit-plan').tap();await page.locator('#plan-OPIF-volume').fill('1000');assert.equal(await page.locator('#plan-OPIF-income').inputValue(),'10,00');await page.locator('#save-plan').tap();await closed(page);
  await page.locator('.nav').getByRole('button',{name:'Продажи',exact:true}).tap();await page.getByRole('button',{name:'Добавить продажу',exact:true}).tap();await page.locator('#sale-client').fill('0007');await page.locator('#sale-amount').fill('123,45');await page.locator('#save-sale').tap();await closed(page);const state=await read(page),sale=state.ownPlanner.sales[0],week=C.weekStart(sale.date),metrics=C.weekMetrics(state.ownPlanner,week,sale.date);assert.equal(sale.clientId,'0007');assert.equal(sale.amountKopecks,12345);assert.equal(metrics.volume.plan,100000);assert.equal(metrics.volume.fact,12345);assert.equal(metrics.income.fact,123);assert.equal(metrics.volume.deficit,87655);await page.reload();await page.locator('[data-sale]').waitFor();assert.deepEqual(await read(page),state);
  pass('Plan, automatic income, decimal sale, forecast/deficit and reload persistence work over HTTPS');
  await context.close();context=null;context=await chromium.launchPersistentContext(profile,options);page=await context.newPage();watch(page);await page.goto(url);await page.locator('#main-content h1').waitFor();assert.deepEqual(await read(page),state);assert.deepEqual(errors,[]);
  pass('Data survives full isolated-browser shutdown/relaunch; no JavaScript errors or external service calls');
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({url,browser:context.browser().version(),physicalPhoneTested:false,passes,errors},null,2));process.stdout.write('ARTIFACTS '+artifacts+'\nTOTAL '+passes.length+' groups passed\n');
}finally{await context?.close();}}
run().catch(e=>{process.stderr.write(e.stack+'\nARTIFACTS '+artifacts+'\n');process.exitCode=1;});
