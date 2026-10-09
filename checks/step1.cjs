/* Вспомогательные проверки; не нужны для запуска трёх файлов страницы.
   Запуск: NODE_PATH указывает на каталог с playwright, затем node checks/step1.cjs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const Core = require('../script.js');
const DATA = Core.KEYS.data, PREFS = Core.KEYS.preferences, DRAFTS = Core.KEYS.drafts;
const appUrl = pathToFileURL(path.resolve(__dirname,'../index.html')).href;
const executable = process.env.ISP_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(),'isp-step1-'));
const results = [];
const errors = [];
function record(name) { results.push(name); process.stdout.write(`PASS ${name}\n`); }
function unitChecks() {
  assert.equal(Core.scaled('1 234 567,89'),123456789);
  assert.equal(Core.scaled('0.01'),1);
  assert.equal(Core.scaled('',Core.MAX_AMOUNT,true),0);
  assert.equal(Core.scaled('9 999 999 999,99'),999999999999);
  for (const v of ['-1','1e6','1.001','1,2.3','10000000000','abc','']) assert.throws(() => Core.scaled(v));
  assert.equal(Core.scaled('100',10000),10000); assert.throws(() => Core.scaled('100.01',10000));
  assert.equal(Core.commission(1,5000),1); assert.equal(Core.commission(1,5000)+Core.commission(1,5000),2);
  assert.equal(Core.commission(999999999999,10000),999999999999);
  assert.equal(Core.identifier('00125'),'00125'); assert.throws(() => Core.identifier('__proto__'));
  assert.throws(() => Core.identifier('员工'));
  assert.equal(Core.weekStart('2026-10-09'),'2026-10-05');
  assert.equal(Core.weekStart('2026-10-11'),'2026-10-05');
  assert.equal(Core.weekStart('2027-01-01'),'2026-12-28');
  assert.equal(Core.dateValid('2026-02-29'),false); assert.equal(Core.dateValid('2024-02-29'),true);
  assert.equal(Core.supportedDate('1999-12-31'),false); assert.equal(Core.supportedDate('2100-01-01'),false);
  assert.equal(Core.businessDate(new Date('2026-10-09T22:30:00Z')),'2026-10-10');
  const p = Core.initialPreferences('2026-10-11'); assert.equal(p.ui.weekKey,'2026-10-05'); assert.equal(p.ui.selectedDate,'2026-10-09');
  assert.throws(() => Core.checkSize('x'.repeat(Core.BUDGET)));
  assert.throws(() => Core.validateState({schemaVersion:2}));
  assert.throws(() => Core.validateState({...Core.emptyState(),updatedAt:'2026-02-30T10:00:00Z'}));
  record('Money, commission rounding CALC-14, dates, Moscow midnight, limits');
}
async function readState(page) { return page.evaluate(k => JSON.parse(localStorage.getItem(k)),DATA); }
async function waitFor(page,predicate,arg) { await page.waitForFunction(predicate,arg,{timeout:10000}); }
async function opened(page) { await page.waitForFunction(() => !document.querySelector('#app .loading')); }
function watch(page) {
  page.on('pageerror',e => errors.push(e.message));
  page.on('request',r => { if (/^https?:/i.test(r.url())) errors.push(`External request: ${r.url()}`); });
  page.on('dialog',d => d.accept());
}
async function setup(page,id='00125',name='Тестовый сотрудник') {
  await page.getByRole('button',{name:'Я сотрудник',exact:true}).click();
  await page.locator('#employee-id').fill(id); await page.locator('#employee-name').fill(name);
  for (const p of Core.PRODUCTS) await page.locator(`#rate-${p.code}`).fill(p.code === 'OPIF' ? '1,25' : '0');
  await page.getByRole('button',{name:'Проверить данные',exact:true}).click();
  assert.equal(await page.getByRole('heading',{name:'Проверьте профиль'}).count(),1);
  assert.equal(await readState(page),null);
  await page.getByRole('button',{name:'Подтвердить и начать',exact:true}).click();
  await page.waitForSelector('#edit-plan');
  assert.equal((await readState(page)).ownPlanner.employee.id,id);
}
async function closePlan(page) {
  await page.locator('#editor').getByRole('button',{name:'Отмена',exact:true}).click();
  if (await page.locator('#confirmation').isVisible()) await page.getByRole('button',{name:'Не сохранять',exact:true}).click();
}
async function savePlan(page) {
  await page.locator('#save-plan').click();
  if (await page.locator('#confirmation').isVisible()) await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('#editor').open);
}
async function isolated(browser, init) {
  const context = await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});
  if (init) await context.addInitScript(init);
  const page = await context.newPage(); watch(page); await page.goto(appUrl); await opened(page);
  return {context,page};
}
async function run() {
  unitChecks();
  const browser = await chromium.launch({executablePath:executable,headless:true,args:['--disable-background-networking','--no-first-run']});
  const browserVersion = browser.version();
  try {
    const {context,page} = await isolated(browser);
    await page.getByRole('button',{name:'Я руководитель',exact:true}).click();
    assert.equal(await page.getByRole('heading',{name:'Снимков сотрудников пока нет'}).count(),1);
    assert.equal(await readState(page),null);
    await page.reload(); await opened(page);
    assert.equal(await page.getByRole('heading',{name:'Команда',exact:true}).count(),1);
    await page.getByRole('combobox',{name:'Режим работы'}).selectOption('employee');
    await page.locator('#employee-id').fill('constructor');
    await page.getByRole('button',{name:'Проверить данные'}).click();
    assert.equal(await page.locator('#employee-id').getAttribute('aria-invalid'),'true');
    assert.equal(await readState(page),null);
    await page.locator('#editor').getByRole('button',{name:'Отмена',exact:true}).click();
    await page.getByRole('button',{name:'Не сохранять',exact:true}).click();
    record('UC-02 manager first launch; profile validation and cancel');
    await setup(page);
    const initial = await readState(page), initialRaw = await page.evaluate(k => localStorage.getItem(k),DATA);
    assert.equal(initial.ownPlanner.ratesBps.OPIF,125); assert.equal(Object.keys(initial.ownPlanner.plans).length,0);
    assert.equal(initial.ownPlanner.meetings.length,0); assert.equal(initial.ownPlanner.sales.length,0);
    const week = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).ui.weekKey,PREFS);
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    assert.equal(await page.locator('input[id^="rate-"]').count(),0);
    assert.equal(await page.evaluate(k => localStorage.getItem(k),DATA),initialRaw);
    assert.match(await page.getByRole('main').innerText(),/2 МиБ/);
    await page.getByRole('button',{name:'Изменить имя',exact:true}).click();
    await page.locator('#new-name').fill('Новое имя'); await page.getByRole('button',{name:'Сохранить имя'}).click();
    await waitFor(page,k => JSON.parse(localStorage.getItem(k)).ownPlanner.employee.name === 'Новое имя',DATA);
    assert.equal((await readState(page)).ownPlanner.employee.id,'00125');
    assert.equal((await readState(page)).ownPlanner.ratesBps.OPIF,125);
    await page.getByRole('button',{name:'Обзор',exact:true}).click();
    assert.match(await page.getByRole('main').innerText(),/План не задан/);
    record('UC-01 profile review, fixed ID/rates, name edit, no fake data; CALC-11');
    await page.locator('#edit-plan').click();
    await page.locator('#plan-OPIF-volume').fill('1 000 000,00');
    assert.equal(await page.locator('#plan-OPIF-income').inputValue(),'12500,00');
    await page.locator('#plan-OPIF-income').fill('17000');
    await page.locator('#plan-OPIF-volume').fill('2000000');
    assert.equal(await page.locator('#plan-OPIF-income').inputValue(),'17000');
    await page.getByRole('button',{name:'ОПИФ: рассчитать доход по ставке',exact:true}).click();
    assert.equal(await page.locator('#plan-OPIF-income').inputValue(),'25000,00');
    await page.locator('#plan-ZPIF-volume').fill('-1'); await page.locator('#save-plan').click();
    assert.equal(await page.locator('#plan-ZPIF-volume').getAttribute('aria-invalid'),'true');
    await page.locator('#plan-ZPIF-volume').fill('');
    await savePlan(page);
    await waitFor(page,() => document.activeElement.id === 'edit-plan');
    const afterPlan = await readState(page); assert.equal(afterPlan.ownPlanner.plans[week].products.OPIF.volumeKopecks,200000000);
    assert.equal(afterPlan.ownPlanner.plans[week].products.OPIF.incomeKopecks,2500000);
    assert.equal(afterPlan.ownPlanner.plans[week].products.ZPIF.volumeKopecks,0);
    record('UC-03/04 plan auto/manual, validation, blank zero and exact persistence');
    await page.getByRole('button',{name:'Следующая неделя',exact:true}).click();
    const newWeek = Core.addDays(week,7), beforeCopy = await readState(page);
    await page.locator('#edit-plan').click(); await page.locator('#copy-plan').click();
    assert.equal(await page.locator('#plan-OPIF-volume').inputValue(),'2000000,00');
    assert.deepEqual(await readState(page),beforeCopy);
    await savePlan(page); assert.equal((await readState(page)).ownPlanner.plans[newWeek].products.OPIF.incomeMode,'auto');
    await page.locator('#edit-plan').click(); await page.locator('#plan-OPIF-volume').fill('3000000');
    await page.locator('#copy-plan').click(); await page.locator('#confirmation').getByRole('button',{name:'Отмена',exact:true}).click();
    assert.equal(await page.locator('#plan-OPIF-volume').inputValue(),'3000000'); await closePlan(page);
    await page.getByLabel('Перейти к дате').fill('2026-09-28');
    await page.locator('#edit-plan').click(); await page.locator('#plan-OPIF-volume').fill('100'); await page.locator('#save-plan').click();
    assert.equal(await page.getByRole('heading',{name:'Изменить прошлую неделю?'}).count(),1);
    await page.locator('#confirmation').getByRole('button',{name:'Отмена',exact:true}).click();
    assert.equal((await readState(page)).ownPlanner.plans['2026-09-28'],undefined);
    await savePlan(page); assert.equal((await readState(page)).ownPlanner.plans['2026-09-28'].products.OPIF.volumeKopecks,10000);
    await page.getByRole('button',{name:'Текущая неделя',exact:true}).click();
    record('UC-05 copy preview, overwrite cancel, past-week confirmation and dates');
    await page.locator('#edit-plan').click(); await page.locator('#plan-OPIF-volume').fill('3456789,01');
    await waitFor(page,k => JSON.parse(sessionStorage.getItem(k) || '{"entries":[]}').entries.length === 1,DRAFTS);
    assert.equal((await readState(page)).ownPlanner.plans[week].products.OPIF.volumeKopecks,200000000);
    await page.reload(); await opened(page);
    await page.getByRole('button',{name:'Восстановить черновик',exact:true}).click();
    assert.equal(await page.locator('#plan-OPIF-volume').inputValue(),'3456789,01');
    await closePlan(page); assert.equal(await page.evaluate(k => sessionStorage.getItem(k),DRAFTS),null);
    assert.equal(await page.getByRole('button',{name:'Восстановить черновик',exact:true}).count(),0);
    record('Plan draft reload, explicit restore, no business changes, discard');
    const baseRaw = await page.evaluate(k => localStorage.getItem(k),DATA);
    for (const width of [320,360,390,768,1280]) {
      await page.setViewportSize({width,height:900});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow,false,`Overview overflow at ${width}`);
      await page.locator('#edit-plan').click();
      assert.equal(await page.evaluate(() => document.querySelector('#editor').scrollWidth > document.querySelector('#editor').clientWidth),false,`Editor overflow at ${width}`);
      await page.screenshot({path:path.join(artifacts,`editor-${width}.png`)});
      await closePlan(page); await page.screenshot({path:path.join(artifacts,`overview-${width}.png`),fullPage:true});
    }
    assert.equal(await page.evaluate(k => localStorage.getItem(k),DATA),baseRaw);
    record('320/360/390/768/1280 layouts, editor, Preferences isolation');
    const smallControls = await page.evaluate(() => [...document.querySelectorAll('button,input,select')].filter(n => !n.disabled && n.getBoundingClientRect().height > 0).filter(n => {const r=n.getBoundingClientRect();return r.height < 44 || r.width < 44;}).map(n => n.textContent || n.id));
    assert.deepEqual(smallControls,[]);
    await page.locator('#edit-plan').click();
    await page.locator('#plan-OPIF-volume').fill('123456');
    await page.locator('#plan-OPIF-volume').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#editor').open);
    await waitFor(page,() => document.activeElement.id === 'edit-plan');
    record('Touch targets >=44px, Enter submission and restored keyboard focus');
    const second = await context.newPage(); watch(second); await second.goto(appUrl); await opened(second);
    await page.locator('#edit-plan').click(); await page.locator('#plan-OPIF-volume').fill('999');
    await second.locator('#edit-plan').click(); await second.locator('#plan-OPIF-volume').fill('777'); await savePlan(second);
    await page.waitForSelector('#conflict-banner'); await page.locator('#save-plan').click();
    assert.equal((await readState(second)).ownPlanner.plans[week].products.OPIF.volumeKopecks,77700);
    await page.locator('#editor').getByRole('button',{name:'Перечитать данные',exact:true}).click();
    await page.getByRole('button',{name:'Восстановить черновик',exact:true}).click();
    assert.equal(await page.getByRole('heading',{name:'Устаревший черновик'}).count(),1);
    await page.getByRole('button',{name:'Удалить черновик',exact:true}).last().click();
    await second.close(); record('UC-35 cross-tab stale form protection and stale draft');
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    await page.locator('#clear-profile').click();
    assert.equal(await page.locator('#confirm-yes').isDisabled(),true);
    await page.locator('#confirmation').getByRole('button',{name:'Отмена',exact:true}).click();
    assert.notEqual((await readState(page)).ownPlanner,null);
    await page.locator('#clear-profile').click(); await page.locator('#confirmation-word').fill('УДАЛИТЬ'); await page.locator('#confirm-yes').click();
    await page.waitForSelector('button:text-is("Я сотрудник")'); assert.equal((await readState(page)).ownPlanner,null);
    record('UC-33 own profile clear typed confirmation and cancel');
    await context.close();

    const preserve = await isolated(browser);
    const preserved = structuredClone(initial);
    const remotePlanner = structuredClone(initial.ownPlanner); remotePlanner.employee.id = 'remote-001';
    const exportedAt = new Date().toISOString();
    preserved.importedEmployees['remote-001'] = { snapshot:{format:'isp-planner-snapshot',schemaVersion:1,timeZone:'Europe/Moscow',exportedAt,asOfDate:Core.businessDate(new Date(exportedAt)),planner:remotePlanner},importedAt:exportedAt };
    await preserve.page.evaluate(({key,value}) => localStorage.setItem(key,JSON.stringify(value)),{key:DATA,value:preserved});
    await preserve.page.reload(); await opened(preserve.page);
    await preserve.page.getByRole('button',{name:'Настройки',exact:true}).click(); await preserve.page.locator('#clear-profile').click();
    await preserve.page.locator('#confirmation-word').fill('УДАЛИТЬ'); await preserve.page.locator('#confirm-yes').click();
    await waitFor(preserve.page,k => JSON.parse(localStorage.getItem(k)).ownPlanner === null,DATA);
    assert.deepEqual((await readState(preserve.page)).importedEmployees,preserved.importedEmployees);
    await preserve.context.close(); record('Own-profile deletion preserves imported snapshots');

    const draftFailure = await isolated(browser,() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) { if(k === 'ispPlanner.drafts.v1') throw new DOMException('draft full','QuotaExceededError'); return set.call(this,k,v); };
    });
    await setup(draftFailure.page,'draft-failure'); await draftFailure.page.locator('#edit-plan').click(); await draftFailure.page.locator('#plan-OPIF-volume').fill('321');
    await draftFailure.page.waitForFunction(() => document.querySelector('#notifications').textContent.includes('Черновик не сохраняется'));
    await savePlan(draftFailure.page);
    assert.equal((await readState(draftFailure.page)).ownPlanner.plans[week].products.OPIF.volumeKopecks,32100);
    await draftFailure.context.close(); record('SessionStorage draft failure does not block confirmed plan save');

    const prefFailure = await isolated(browser,() => {
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='ispPlanner.preferences.v1')throw new DOMException('preferences full','QuotaExceededError');return set.call(this,k,v);};
    });
    await setup(prefFailure.page,'pref-failure');
    assert.equal((await readState(prefFailure.page)).ownPlanner.employee.id,'pref-failure');
    assert.match(await prefFailure.page.getByRole('main').innerText(),/Не удалось сохранить настройки экрана/);
    await prefFailure.context.close(); record('Preferences failure retains business save and visible warning');

    const large = await isolated(browser,() => {
      const NativeWorker = window.Worker;
      window.ISP_WORKER_TASKS = [];
      window.Worker = function(...args) { const worker = new NativeWorker(...args); const post=worker.postMessage.bind(worker); worker.postMessage = (...params) => { window.ISP_WORKER_TASKS.push(params[0].type); return post(...params); }; return worker; };
      window.Worker.prototype = NativeWorker.prototype;
    });
    const nearLimit = structuredClone(initial), entry = {products:Core.emptyPlan(),createdAt:initial.updatedAt,updatedAt:initial.updatedAt};
    const entryLength = JSON.stringify({'2000-01-03':entry}).length - 1;
    const count = Math.floor((Core.BUDGET/2 - DATA.length - JSON.stringify(nearLimit).length + 1)/entryLength);
    let cursor = '2000-01-03';
    for(let i=0;i<count;i++) { while(cursor === week) cursor=Core.addDays(cursor,7); nearLimit.ownPlanner.plans[cursor]=entry; cursor=Core.addDays(cursor,7); }
    const largeRaw = JSON.stringify(nearLimit); Core.checkSize(largeRaw);
    assert.ok(largeRaw.length*2 > Core.SMALL_BUDGET);
    await large.page.evaluate(({key,value}) => localStorage.setItem(key,value),{key:DATA,value:largeRaw});
    await large.page.reload(); await opened(large.page);
    assert.ok((await large.page.evaluate(() => window.ISP_WORKER_TASKS)).includes('parse'));
    await large.page.locator('#edit-plan').click(); await large.page.locator('#plan-OPIF-volume').fill('1000'); await large.page.locator('#save-plan').click();
    await large.page.waitForFunction(() => document.querySelector('#editor .error-message').textContent.includes('лимит'));
    assert.equal(await large.page.evaluate(k => localStorage.getItem(k),DATA),largeRaw);
    assert.equal(await large.page.locator('#plan-OPIF-volume').inputValue(),'1000');
    assert.ok((await large.page.evaluate(() => window.ISP_WORKER_TASKS)).includes('stringify'));
    await large.context.close(); record('Near-2-MiB state parsed/serialized in Worker; over-budget commit preserves original');

    const noWorkerLarge = await isolated(browser,() => { window.Worker=undefined; });
    await noWorkerLarge.page.evaluate(({key,value}) => localStorage.setItem(key,value),{key:DATA,value:largeRaw});
    await noWorkerLarge.page.reload(); await opened(noWorkerLarge.page);
    assert.equal(await noWorkerLarge.page.getByRole('heading',{name:'Нужна проверка хранилища'}).count(),1);
    assert.equal(await noWorkerLarge.page.evaluate(k => localStorage.getItem(k),DATA),largeRaw);
    assert.equal(await noWorkerLarge.page.locator('#edit-plan').count(),0);
    await noWorkerLarge.context.close(); record('No Worker + large existing state: read-only recovery without reset');

    const fault = await isolated(browser,() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) {
        if (k === 'ispPlanner.v1' && window.ISP_FAIL) throw new DOMException('Injected failure',window.ISP_FAIL);
        return set.call(this,k,v);
      };
    });
    await setup(fault.page,'failure-test'); await fault.page.locator('#edit-plan').click(); await fault.page.locator('#plan-OPIF-volume').fill('1000');
    const originalFault = await readState(fault.page);
    for (const name of ['QuotaExceededError','SecurityError']) {
      await fault.page.evaluate(n => window.ISP_FAIL = n,name); await fault.page.locator('#save-plan').click();
      await fault.page.waitForSelector('#editor .error-message:not(:empty)');
      assert.deepEqual(await readState(fault.page),originalFault);
      assert.equal(await fault.page.locator('#plan-OPIF-volume').inputValue(),'1000');
    }
    await fault.page.evaluate(() => window.ISP_FAIL = null); await savePlan(fault.page);
    await fault.context.close(); record('UC-34 quota/security failures preserve state and form; retry succeeds');

    const unsupported = await isolated(browser,() => { window.Worker = undefined; });
    await setup(unsupported.page,'no-worker'); await unsupported.page.getByRole('button',{name:'Настройки',exact:true}).click();
    assert.match(await unsupported.page.getByRole('main').innerText(),/256 КиБ/);
    await unsupported.context.close(); record('Worker unavailable: usable limited mode');

    const corrupted = await isolated(browser);
    await corrupted.page.evaluate(k => localStorage.setItem(k,'{"broken":'),DATA); await corrupted.page.reload(); await opened(corrupted.page);
    assert.equal(await corrupted.page.getByRole('heading',{name:'Нужна проверка хранилища'}).count(),1);
    assert.equal(await corrupted.page.evaluate(k => localStorage.getItem(k),DATA),'{"broken":');
    const downloadPromise = corrupted.page.waitForEvent('download'); await corrupted.page.getByRole('button',{name:'Скачать исходные данные'}).click();
    const dl = await downloadPromise; await dl.saveAs(path.join(artifacts,'corrupted-original.txt'));
    assert.equal(fs.readFileSync(path.join(artifacts,'corrupted-original.txt'),'utf8'),'{"broken":');
    await corrupted.page.getByLabel('Техническая копия JSON').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(initial))});
    await corrupted.page.getByRole('button',{name:'Подтвердить',exact:true}).click();
    await corrupted.page.waitForSelector('#edit-plan');
    assert.deepEqual(await readState(corrupted.page),initial);
    await corrupted.context.close(); record('Corrupted storage not silently reset; original download preserved');
    record('Confirmed emergency AppState recovery validates and restores original state');

    const blocked = await isolated(browser,() => { Storage.prototype.setItem = function(){throw new DOMException('blocked','SecurityError');}; });
    assert.equal(await blocked.page.getByRole('heading',{name:'Нужна проверка хранилища'}).count(),1);
    assert.equal(await blocked.page.locator('#employee-id').count(),0);
    await blocked.context.close(); record('Blocked storage: no productive inputs or false save');
  } finally { await browser.close(); }
  assert.deepEqual(errors,[],'Unexpected page errors or external requests');
  const profilePath = path.join(artifacts,'persistent-profile');
  let persistent = await chromium.launchPersistentContext(profilePath,{executablePath:executable,headless:true,viewport:{width:390,height:844}});
  let page = persistent.pages()[0]; watch(page); await page.goto(appUrl); await opened(page); await setup(page,'persisted');
  await page.locator('#edit-plan').click(); await page.locator('#plan-OPIF-volume').fill('500'); await savePlan(page);
  const saved = await readState(page); await persistent.close();
  persistent = await chromium.launchPersistentContext(profilePath,{executablePath:executable,headless:true});
  page = persistent.pages()[0]; watch(page); await page.goto(appUrl); await opened(page);
  assert.deepEqual(await readState(page),saved); await persistent.close();
  record('Real browser close/relaunch preserves file: localStorage in isolated persistent profile');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({browser:'Microsoft Edge Chromium',version:browserVersion,node:process.version,appUrl,results,errors},null,2));
  process.stdout.write(`BROWSER Microsoft Edge ${browserVersion}\n`);
  process.stdout.write(`ARTIFACTS ${artifacts}\nTOTAL ${results.length} groups passed\n`);
}
run().catch(error => { process.stderr.write(`${error.stack}\nARTIFACTS ${artifacts}\n`); process.exitCode = 1; });
