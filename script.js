/* ИСП: обычный автономный скрипт. Вычисления не зависят от DOM. */
function createPlannerCore() {
  'use strict';
  const PRODUCTS = [
    ['OPIF', 'ОПИФ', 'Открытые паевые фонды'], ['ZPIF', 'ЗПИФ', 'Закрытые паевые фонды'],
    ['ISZH', 'ИСЖ', 'Инвестиционное страхование жизни'], ['NSZH', 'НСЖ', 'Накопительное страхование жизни'],
    ['RDU', 'РДУ', 'Доверительное управление']
  ].map(([code, short, name]) => ({ code, short, name }));
  const KEYS = { data: 'ispPlanner.v1', preferences: 'ispPlanner.preferences.v1', drafts: 'ispPlanner.drafts.v1' };
  const MAX_AMOUNT = 999999999999;
  const BUDGET = 2 * 1024 * 1024;
  const SMALL_BUDGET = 256 * 1024;
  const RESERVED = ['__proto__', 'prototype', 'constructor'];
  const CODES = PRODUCTS.map(p => p.code);
  const fail = (message) => { throw new Error(message); };
  const atPath = (path,fn) => { try{return fn();}catch(error){fail(`${path}: ${error.message}`);} };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function dict(value, label) {
    if (!object(value)) fail(`${label}: нужен объект`);
    if (Object.keys(value).some(k => RESERVED.includes(k))) fail(`${label}: запрещённый служебный ключ`);
    return value;
  }
  function text(value, max, label, empty = false) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label}: неверный текст`);
    return value;
  }
  function identifier(value, label = 'ID сотрудника') {
    text(value, 64, label);
    if (!/^[A-Za-zА-Яа-яЁё0-9._-]+$/.test(value) || (label !== 'ID клиента' && RESERVED.includes(value))) fail(`${label}: используйте русские или латинские буквы, цифры, точку, дефис или подчёркивание`);
    return value;
  }
  function entityId(value) { return text(value, 64, 'Идентификатор записи'); }
  function dateValid(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function supportedDate(value) { return dateValid(value) && value >= '2000-01-01' && value <= '2099-12-31'; }
  function addDays(value, count) {
    if (!dateValid(value) || !Number.isInteger(count)) fail('Некорректная дата');
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }
  function weekday(value) { return new Date(`${value}T12:00:00Z`).getUTCDay(); }
  function workDate(value) { return supportedDate(value) && weekday(value) >= 1 && weekday(value) <= 5; }
  function weekStart(value) { return addDays(value, -((weekday(value) + 6) % 7)); }
  function weekValid(value) { return supportedDate(value) && weekday(value) === 1; }
  function businessDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) || !dateValid(value.slice(0,10)) || !Number.isFinite(Date.parse(value))) fail('Некорректная временная отметка');
    return new Date(value).toISOString();
  }
  function timestamps(value) {
    const createdAt = timestamp(value.createdAt), updatedAt = timestamp(value.updatedAt);
    if (updatedAt < createdAt) fail('Дата изменения раньше даты создания');
    return { createdAt, updatedAt };
  }
  function scaled(value, max = MAX_AMOUNT, emptyZero = false) {
    if (typeof value !== 'string') fail('Введите сумму');
    const trimmed = value.trim();
    if (!trimmed && emptyZero) return 0;
    const clean = trimmed.replace(/[ \u00a0\u202f]/g, '');
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(clean)) fail('Введите неотрицательное число, не более двух знаков после запятой');
    const [integer, fraction = ''] = clean.split(/[.,]/);
    const result = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (result > BigInt(max)) fail(`Максимум: ${plain(max)}`);
    return Number(result);
  }
  function money(value, label = 'Сумма', positive = false) {
    if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > MAX_AMOUNT) fail(`${label}: неверная сумма`);
    return value;
  }
  function plain(value) { const n=BigInt(value); return `${n/100n},${String(n%100n).padStart(2,'0')}`; }
  const rubleFormatter=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
  function moneyText(value) {
    if(!Number.isSafeInteger(value) || value<0)fail('Неверная итоговая сумма');
    const n=BigInt(value);return `${rubleFormatter.format(n/100n)},${String(n%100n).padStart(2,'0')} ₽`;
  }
  function commission(amount, rate) {
    money(amount);
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) fail('Ставка должна быть от 0 до 100%');
    const result = (BigInt(amount) * BigInt(rate) + 5000n) / 10000n;
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('Сумма не помещается в точный числовой диапазон');
    return Number(result);
  }
  function safeSum(values) {
    const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail('Итоговая сумма слишком велика');
    return Number(total);
  }
  function id() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  function emptyState(now = new Date().toISOString()) {
    return { schemaVersion: 1, revision: 0, ownPlanner: null, importedEmployees: {}, updatedAt: now };
  }
  function initialPreferences(today) {
    const week = weekStart(today), selectedDate = weekday(today) === 0 || weekday(today) === 6 ? addDays(week, 4) : today;
    return { schemaVersion: 1, ui: { mode: 'employee', employeeSection: 'overview', managerSection: 'team', weekKey: week, selectedDate, selectedEmployeeId: null, calendarView: 'day', managerPeriodMode: 'week', managerMonth: today.slice(0, 7) }, ownBackup: { employeeId: null, lastExportAt: null, hasChanges: true, snoozedUntil: null } };
  }
  function newPlanner(employee, ratesBps, today, now) {
    const blocks = [['09:00','09:30','Проверка почты','activity'],['09:30','10:00','Обзвон клиентов','activity'],['10:00','13:00','Встречи с клиентами','meetings'],['13:00','14:00','Обед','activity'],['14:00','17:00','Встречи с клиентами','meetings'],['17:00','18:00','Оформление продаж и итоги дня','activity']];
    const weekdays = Object.fromEntries(['mon','tue','wed','thu','fri'].map(day => [day, { workStart: '09:00', workEnd: '18:00', blocks: blocks.map(([start,end,title,kind]) => ({ id: id(), start,end,title,kind })) }]));
    const effectiveFrom = workDate(today) ? today : addDays(weekStart(today), 7);
    return { employee: { ...employee, createdAt: now, updatedAt: now }, ratesBps, plans: {}, meetings: [], sales: [], templateVersions: [{ id: id(), effectiveFrom, weekdays, createdAt: now }], daySchedules: {}, achievementNotifications: {} };
  }
  function emptyPlan() { return Object.fromEntries(CODES.map(code => [code, { volumeKopecks: 0, incomeKopecks: 0, incomeMode: 'auto' }])); }
  function validateProducts(products, rates) {
    dict(products, 'План');
    return Object.fromEntries(CODES.map(code => {
      const item = dict(products[code], `План ${code}`);
      const volumeKopecks = money(item.volumeKopecks), incomeKopecks = money(item.incomeKopecks);
      if (!['auto', 'manual'].includes(item.incomeMode)) fail('Неизвестный режим плана дохода');
      if (item.incomeMode === 'auto' && incomeKopecks !== commission(volumeKopecks, rates[code])) fail('Автоматический доход не соответствует ставке');
      return [code, { volumeKopecks, incomeKopecks, incomeMode: item.incomeMode }];
    }));
  }
  function timeValid(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function interval(start, end) { if (!timeValid(start) || !timeValid(end) || end <= start) fail('Некорректный временной интервал'); }
  function unique(list, label) {
    if (!Array.isArray(list)) fail(`${label}: нужен список`);
    if (new Set(list.map(item => item.id)).size !== list.length) fail(`${label}: повторяющиеся ID`);
    return list;
  }
  function schedule(value, individual) {
    dict(value, 'Тайминг'); interval(value.workStart, value.workEnd);
    const blocks = unique(value.blocks, 'Блоки тайминга').map(block => {
      dict(block, 'Блок'); interval(block.start, block.end);
      if (block.start < value.workStart || block.end > value.workEnd) fail('Блок выходит за рабочие часы');
      if (!['activity', 'meetings'].includes(block.kind)) fail('Неизвестный тип блока');
      const result = { id: entityId(block.id), title: text(block.title, 100, 'Название блока'), kind: block.kind, start: block.start, end: block.end };
      if (individual) result.completedAt = block.completedAt === null ? null : timestamp(block.completedAt);
      return result;
    });
    const sorted = [...blocks].sort((a,b) => a.start.localeCompare(b.start));
    if (sorted.some((b,i) => i > 0 && b.start < sorted[i-1].end)) fail('Блоки тайминга пересекаются');
    return { workStart: value.workStart, workEnd: value.workEnd, blocks, ...(individual ? timestamps(value) : {}) };
  }
  function validatePlanner(value) {
    dict(value, 'Планировщик'); const employee = dict(value.employee, 'Сотрудник');
    const result = { employee: { id: identifier(employee.id), name: text(employee.name,100,'Имя'), ...timestamps(employee) }, ratesBps: {}, plans: {}, meetings: [], sales: [], templateVersions: [], daySchedules: {}, achievementNotifications: {} };
    dict(value.ratesBps, 'Ставки');
    for (const code of CODES) { const rate = value.ratesBps[code]; commission(0, rate); result.ratesBps[code] = rate; }
    for (const [week, plan] of Object.entries(dict(value.plans,'Планы'))) {
      if (!weekValid(week)) fail('Некорректная неделя плана');
      result.plans[week] = { products: validateProducts(dict(plan,'План').products,result.ratesBps), ...timestamps(plan) };
    }
    result.meetings = unique(value.meetings,'Встречи').map((m,i) => atPath(`Встреча ${i+1}`,() => {
      dict(m,'Встреча'); if (!workDate(m.date)) fail('Неверная дата встречи'); interval(m.start,m.end);
      if (!['planned','completed','postponed','cancelled'].includes(m.status)) fail('Неизвестный статус встречи');
      const items = unique(m.items,'Продукты встречи').map(item => {
        if (!CODES.includes(item.productCode)) fail('Неизвестный продукт встречи');
        return { id: entityId(item.id), productCode: item.productCode, expectedKopecks: money(item.expectedKopecks) };
      });
      if (!items.length || items.length > 5 || new Set(items.map(i => i.productCode)).size !== items.length) fail('Неверный набор продуктов встречи');
      const transferHistory = unique(m.transferHistory,'Переносы').map(t => {
        if (!workDate(t.fromDate)) fail('Неверная прежняя дата переноса'); interval(t.fromStart,t.fromEnd);
        if (t.toDate === null) { if (t.toStart !== null || t.toEnd !== null) fail('Неверный перенос без даты'); }
        else { if (!workDate(t.toDate)) fail('Неверная новая дата переноса'); interval(t.toStart,t.toEnd); }
        return { id: entityId(t.id), at: timestamp(t.at), fromDate: t.fromDate, fromStart: t.fromStart, fromEnd: t.fromEnd, toDate: t.toDate, toStart: t.toStart, toEnd: t.toEnd };
      });
      return { id: entityId(m.id), date: m.date, start: m.start, end: m.end, clientId: identifier(m.clientId,'ID клиента'), status: m.status, note: text(m.note,2000,'Заметка',true), items, transferHistory, ...timestamps(m) };
    }));
    result.sales = unique(value.sales,'Продажи').map((s,i) => atPath(`Продажа ${i+1}`,() => {
      if (!workDate(s.date) || !CODES.includes(s.productCode)) fail('Неверная дата или продукт продажи');
      const linked = s.meetingId !== null || s.meetingItemId !== null;
      if (linked) {
        const meeting = result.meetings.find(m => m.id === s.meetingId), item = meeting?.items.find(i => i.id === s.meetingItemId);
        if (!meeting || !item || item.productCode !== s.productCode || meeting.clientId !== s.clientId) fail('Неверная связь продажи');
      }
      return { id: entityId(s.id), date: s.date, clientId: identifier(s.clientId,'ID клиента'), productCode: s.productCode, amountKopecks: money(s.amountKopecks,'Продажа',true), meetingId: linked ? entityId(s.meetingId) : null, meetingItemId: linked ? entityId(s.meetingItemId) : null, ...timestamps(s) };
    }));
    result.templateVersions = unique(value.templateVersions,'Версии тайминга').map((v,i) => atPath(`Шаблон ${i+1}`,() => {
      if (!workDate(v.effectiveFrom)) fail('Неверная дата шаблона'); dict(v.weekdays,'Дни шаблона');
      return { id: entityId(v.id), effectiveFrom: v.effectiveFrom, createdAt: timestamp(v.createdAt), weekdays: Object.fromEntries(['mon','tue','wed','thu','fri'].map(d => [d,schedule(v.weekdays[d],false)])) };
    }));
    if (new Set(result.templateVersions.map(v => v.effectiveFrom)).size !== result.templateVersions.length) fail('Повтор даты версии тайминга');
    for (const [date, day] of Object.entries(dict(value.daySchedules,'Расписания дней'))) { if (!workDate(date)) fail('Неверная дата расписания'); result.daySchedules[date] = schedule(day,true); }
    for (const [week, notifications] of Object.entries(dict(value.achievementNotifications,'Достижения'))) {
      if (!weekValid(week)) fail('Неверная неделя достижения'); dict(notifications,'Достижения недели');
      result.achievementNotifications[week] = Object.fromEntries(Object.entries(notifications).map(([code,at]) => { if (!CODES.includes(code)) fail('Неизвестный продукт достижения'); return [code,timestamp(at)]; }));
    }
    return result;
  }
  function validateState(value,referenceDate=null) {
    dict(value,'Состояние');
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('Неподдерживаемая версия сохранения');
    const importedEmployees = {};
    for (const [employeeId, record] of Object.entries(dict(value.importedEmployees,'Снимки сотрудников'))) {
      identifier(employeeId); dict(record,'Снимок'); const s = dict(record.snapshot,'Снимок');
      if (s.format !== 'isp-planner-snapshot' || s.schemaVersion !== 1 || s.timeZone !== 'Europe/Moscow' || !supportedDate(s.asOfDate) || businessDate(new Date(timestamp(s.exportedAt))) !== s.asOfDate) fail('Неверный формат снимка');
      const snapshot = validateSnapshot(s,s.asOfDate,false), planner = snapshot.planner;
      if (planner.employee.id !== employeeId) fail('ID снимка не соответствует ключу');
      importedEmployees[employeeId] = { snapshot, importedAt: timestamp(record.importedAt) };
    }
    const result={ schemaVersion: 1, revision: value.revision, ownPlanner: value.ownPlanner === null ? null : validatePlanner(value.ownPlanner), importedEmployees, updatedAt: timestamp(value.updatedAt) };
    validateFinancialState(result,referenceDate ?? businessDate(new Date(result.updatedAt)));return result;
  }
  function checkSize(raw, limit = BUDGET, key = KEYS.data) {
    if (new TextEncoder().encode(raw).byteLength > limit || (raw.length + key.length) * 2 > limit) fail(`Превышен лимит хранения ${limit === BUDGET ? '2 МиБ' : '256 КиБ'}`);
  }
  function checkObjectBudget(value,limit) {
    // Ограниченный режим: оцениваем размер до сериализации всей коллекции.
    let units=KEYS.data.length,bytes=0;const stack=[value];
    const count=raw=>{units+=raw.length;bytes+=new TextEncoder().encode(raw).byteLength;if(units*2>limit || bytes>limit)fail('Превышен лимит хранения 256 КиБ без фоновой обработки');};
    while(stack.length){const v=stack.pop();if(Array.isArray(v)){count('[]'+','.repeat(Math.max(0,v.length-1)));stack.push(...v);}else if(object(v)){const entries=Object.entries(v);count('{}'+','.repeat(Math.max(0,entries.length-1)));for(const [key,child] of entries){count(JSON.stringify(key)+':');stack.push(child);}}else count(JSON.stringify(v));}
  }
  function nextWorkDate(date) { let next=addDays(date,1); while (supportedDate(next) && !workDate(next)) next=addDays(next,1); if (!workDate(next)) fail('Следующая рабочая дата выходит за разрешённый диапазон'); return next; }
  function linkedSalesIndex(planner) {
    const index=new Map();for(const s of planner.sales)if(s.meetingId!==null){const key=JSON.stringify([s.meetingId,s.meetingItemId]);index.set(key,safeSum([index.get(key) ?? 0,s.amountKopecks]));}return index;
  }
  function remaining(planner,meeting,item,index=null) { return Math.max(item.expectedKopecks-(index?index.get(JSON.stringify([meeting.id,item.id])) ?? 0:safeSum(planner.sales.filter(s=>s.meetingId===meeting.id && s.meetingItemId===item.id).map(s=>s.amountKopecks))),0); }
  function measure(plan,fact,forecast) { return {plan,fact,forecast,percent:plan>0?fact/plan*100:null,forecastPercent:plan>0?forecast/plan*100:null,remaining:Math.max(plan-fact,0),deficit:Math.max(plan-forecast,0),over:plan>0?Math.max(fact-plan,0):0,expectedOver:plan>0?Math.max(forecast-plan,0):0}; }
  function weekMetrics(planner,week,referenceDate) {
    if (!weekValid(week) || !supportedDate(referenceDate)) fail('Некорректный период расчёта');
    return periodMetrics(planner,week,addDays(week,4),planner.plans[week]?.products ?? emptyPlan(),referenceDate);
  }
  function periodMetrics(planner,week,end,plan,referenceDate) {
    const completed=end<referenceDate;
    const fact=Object.fromEntries(CODES.map(c=>[c,{volume:[],income:[]}])) , future=Object.fromEntries(CODES.map(c=>[c,{volume:[],income:[]}])) ;
    const sold=new Map();
    for (const s of planner.sales) {
      if (s.date>=week && s.date<=end) { fact[s.productCode].volume.push(s.amountKopecks); fact[s.productCode].income.push(commission(s.amountKopecks,planner.ratesBps[s.productCode])); }
      if (s.meetingId!==null) { const key=JSON.stringify([s.meetingId,s.meetingItemId]); sold.set(key,safeSum([sold.get(key)||0,s.amountKopecks])); }
    }
    if (!completed) for (const m of planner.meetings) if (m.status==='planned' && m.date>=week && m.date>=referenceDate && m.date<=end) for (const item of m.items) {
      const left=Math.max(item.expectedKopecks-(sold.get(JSON.stringify([m.id,item.id]))||0),0);
      future[item.productCode].volume.push(left); future[item.productCode].income.push(commission(left,planner.ratesBps[item.productCode]));
    }
    const products=Object.fromEntries(CODES.map(code=>{
      const volumeFact=safeSum(fact[code].volume), incomeFact=safeSum(fact[code].income);
      const volume=measure(plan[code].volumeKopecks,volumeFact,safeSum([volumeFact,...future[code].volume]));
      const income=measure(plan[code].incomeKopecks,incomeFact,safeSum([incomeFact,...future[code].income]));
      return [code,{volume,income,goal:volume.plan>0 && income.plan>0 && volume.fact>=volume.plan && income.fact>=income.plan}];
    }));
    const aggregate=kind=>{
      const rows=CODES.map(c=>products[c][kind]);
      const result=measure(safeSum(rows.map(r=>r.plan)),safeSum(rows.map(r=>r.fact)),safeSum(rows.map(r=>r.forecast)));
      for (const key of ['remaining','deficit','over','expectedOver']) result[key]=safeSum(rows.map(r=>r[key]));
      return result;
    };
    return {completed,products,volume:aggregate('volume'),income:aggregate('income')};
  }
  function monthValid(month) { return typeof month==='string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && month>='2000-01' && month<='2099-12'; }
  function monthDates(month) {
    if(!monthValid(month))fail('Месяц должен быть в диапазоне 2000–2099 годов');
    const start=`${month}-01`, end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0,12)).toISOString().slice(0,10), dates=[];
    for(let d=start;d<=end;d=addDays(d,1))if(workDate(d))dates.push(d);
    return {start,end,dates,weeks:[...new Set(dates.map(weekStart))]};
  }
  function monthMetrics(planner,month,referenceDate) {
    const period=monthDates(month), products=emptyPlan();
    for(const code of CODES)for(const [field,key] of [['volumeKopecks','volumeKopecks'],['incomeKopecks','incomeKopecks']]) {
      products[code][field]=safeSum(period.dates.map(date=>{
        const amount=planner.plans[weekStart(date)]?.products[code][key] ?? 0;
        return Math.floor(amount/5)+(weekday(date)-1<amount%5?1:0);
      }));
    }
    const result=periodMetrics(planner,period.start,period.dates.at(-1),products,referenceDate);
    result.coverage={filled:period.weeks.filter(w=>Object.values(planner.plans[w]?.products ?? {}).some(p=>p.volumeKopecks>0 || p.incomeKopecks>0)).length,total:period.weeks.length};
    result.goals=period.weeks.filter(w=>addDays(w,4)>=period.start && addDays(w,4)<=period.end).reduce((n,w)=>n+CODES.filter(c=>weekMetrics(planner,w,referenceDate).products[c].goal).length,0);
    return result;
  }
  function teamMetrics(records,mode,period) {
    const employees=Object.fromEntries(Object.entries(records).map(([key,r])=>[key,mode==='month'?monthMetrics(r.snapshot.planner,period,r.snapshot.asOfDate):weekMetrics(r.snapshot.planner,period,r.snapshot.asOfDate)]));
    const rows=Object.values(employees), sumMeasures=values=>{
      const result=measure(safeSum(values.map(v=>v.plan)),safeSum(values.map(v=>v.fact)),safeSum(values.map(v=>v.forecast)));
      for(const key of ['remaining','deficit','over','expectedOver'])result[key]=safeSum(values.map(v=>v[key]));return result;
    };
    return {employees,volume:sumMeasures(rows.map(r=>r.volume)),income:sumMeasures(rows.map(r=>r.income)),products:Object.fromEntries(CODES.map(c=>[c,{volume:sumMeasures(rows.map(r=>r.products[c].volume)),income:sumMeasures(rows.map(r=>r.products[c].income))}])),withoutPlan:rows.filter(r=>r.volume.plan===0 && r.income.plan===0).length,coverage:mode==='month'?{filled:safeSum(rows.map(r=>r.coverage.filled)),total:safeSum(rows.map(r=>r.coverage.total))}:null};
  }
  function financialPeriods(planner) {
    const weeks=new Set(Object.keys(planner.plans)),months=new Set();
    for(const row of [...planner.sales,...planner.meetings]){weeks.add(weekStart(row.date));months.add(row.date.slice(0,7));}
    for(const week of Object.keys(planner.plans))for(let i=0;i<5;i++){const date=addDays(week,i);if(supportedDate(date))months.add(date.slice(0,7));}
    return {weeks,months};
  }
  function validateFinancialPlanner(planner,referenceDate,collect=null) {
    const periods=financialPeriods(planner);
    for(const [mode,keys] of [['week',periods.weeks],['month',periods.months]])for(const period of keys){
      const metric=atPath(`Сотрудник ${planner.employee.id}, ${mode==='week'?'неделя':'месяц'} ${period}`,()=>mode==='week'?weekMetrics(planner,period,referenceDate):monthMetrics(planner,period,referenceDate));
      if(collect)collect(mode,period,metric);
    }
  }
  function validateFinancialState(state,referenceDate) {
    if(state.ownPlanner)validateFinancialPlanner(state.ownPlanner,referenceDate);
    // Все величины неотрицательны: допустимый полный состав гарантирует безопасность любого подмножества.
    const totals=new Map(),fields=['plan','fact','forecast','remaining','deficit','over','expectedOver'];
    for(const {snapshot:s} of Object.values(state.importedEmployees))validateFinancialPlanner(s.planner,s.asOfDate,(mode,period,metric)=>{
      const key=`${mode}:${period}`,sums=totals.get(key) ?? new Map();totals.set(key,sums);
      for(const [code,row] of [['total',metric],...Object.entries(metric.products)])for(const kind of ['volume','income'])for(const field of fields){
        const name=`${code}:${kind}:${field}`;
        sums.set(name,atPath(`Команда, ${mode==='week'?'неделя':'месяц'} ${period}`,()=>safeSum([sums.get(name) ?? 0,row[kind][field]])));
      }
    });
  }
  // Выгрузки: числа форматируются из копеек, текст защищается до CSV-экранирования.
  const SALES_HEADERS=['ID сотрудника','Имя сотрудника','Дата продажи','ID клиента','Продукт','Объём, ₽','Комиссия, %','Комиссионный доход, ₽','ID встречи','Данные на дату'];
  const MEASURE_KEYS=['plan','fact','forecast','percent','remaining','deficit','over','expectedOver'];
  const SUMMARY_HEADERS=['ID сотрудника','Имя сотрудника','Тип периода','Начало периода','Конец периода','Продукт','Ставка, %',
    ...['объёма','дохода'].flatMap(kind=>[`План ${kind}, ₽`,`Факт ${kind}, ₽`,`Прогноз ${kind}, ₽`,`Выполнение ${kind}, %`,`Остаток ${kind}, ₽`,`Прогнозный дефицит ${kind}, ₽`,`Перевыполнение ${kind}, ₽`,`Прогнозное превышение ${kind}, ₽`]),
    'Недельная цель достигнута','Опорная дата','Дата экспорта снимка','Покрытие недельного плана'];
  function csvCell(value,forceText=false) {
    let text=String(value ?? '');
    if(forceText || /^\s*[=+\-@]/u.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function csvDocument(headers,rows,idColumns=[0]) {
    return '\uFEFF'+[headers.map(h=>csvCell(h)).join(';'),...rows.map(row=>row.map((v,i)=>csvCell(v,idColumns.includes(i))).join(';'))].join('\r\n')+'\r\n';
  }
  function salesRows(entries) {
    return entries.map(({planner,sale,asOfDate})=>[planner.employee.id,planner.employee.name,sale.date,sale.clientId,PRODUCTS.find(p=>p.code===sale.productCode).short,plain(sale.amountKopecks),plain(planner.ratesBps[sale.productCode]),plain(commission(sale.amountKopecks,planner.ratesBps[sale.productCode])),sale.meetingId ?? '',asOfDate]);
  }
  function summaryRows(contexts,mode,period) {
    const dates=mode==='month'?monthDates(period):{start:period,end:addDays(period,4)};
    return contexts.flatMap(({planner,asOfDate,exportedAt=''})=>{
      const metrics=mode==='month'?monthMetrics(planner,period,asOfDate):weekMetrics(planner,period,asOfDate);
      return PRODUCTS.map(p=>{
        const data=metrics.products[p.code];
        const values=kind=>MEASURE_KEYS.map(key=>key==='percent'?(data[kind][key]===null?'':data[kind][key].toFixed(1).replace('.',',')):plain(data[kind][key]));
        return [planner.employee.id,planner.employee.name,mode==='month'?'Месяц':'Неделя',dates.start,dates.end,p.short,plain(planner.ratesBps[p.code]),...values('volume'),...values('income'),mode==='month'?'':data.goal?'Да':'Нет',asOfDate,exportedAt,mode==='month'?`${metrics.coverage.filled}/${metrics.coverage.total}`:''];
      });
    });
  }
  function validateSnapshot(value,referenceDate,financial=true) {
    const nodes=[{value,path:'Файл'}];
    while(nodes.length) {
      const node=nodes.pop();if(!object(node.value) && !Array.isArray(node.value))continue;
      for(const [key,child] of Object.entries(node.value)){if(RESERVED.includes(key))fail(`${node.path}: запрещённый ключ ${key}`);if(child!==null && typeof child==='object')nodes.push({value:child,path:`${node.path}.${key}`});}
    }
    dict(value,'Снимок');
    if(value.format!=='isp-planner-snapshot' || value.schemaVersion!==1 || value.timeZone!=='Europe/Moscow')fail('Снимок: неподдерживаемые format, schemaVersion или timeZone');
    const exportedAt=timestamp(value.exportedAt);
    if(!supportedDate(value.asOfDate) || businessDate(new Date(exportedAt))!==value.asOfDate || value.asOfDate>referenceDate)fail('Снимок.asOfDate: дата не соответствует экспорту или позже сегодняшней');
    const p=value.planner;
    const planner=validatePlanner(p);
    const before=(instant,path)=>{if(instant>exportedAt)fail(`${path}: время позже exportedAt`);};
    const stamp=(entity,path)=>{before(entity.createdAt,`${path}.createdAt`);before(entity.updatedAt,`${path}.updatedAt`);};
    stamp(planner.employee,'Сотрудник');for(const [w,plan] of Object.entries(planner.plans))stamp(plan,`План ${w}`);
    planner.meetings.forEach((m,i)=>{stamp(m,`Встреча ${i+1}`);if(m.status==='completed' && m.date>value.asOfDate)fail(`Встреча ${i+1}: проведена позже asOfDate`);m.transferHistory.forEach((h,j)=>before(h.at,`Встреча ${i+1}, перенос ${j+1}`));});
    planner.sales.forEach((s,i)=>{stamp(s,`Продажа ${i+1}`);if(s.date>value.asOfDate)fail(`Продажа ${i+1}: дата позже asOfDate`);});
    planner.templateVersions.forEach((v,i)=>before(v.createdAt,`Шаблон ${i+1}.createdAt`));
    for(const [date,day] of Object.entries(planner.daySchedules)){stamp(day,`Тайминг ${date}`);for(const b of day.blocks)if(b.completedAt){if(date>value.asOfDate)fail(`Тайминг ${date}: отметка будущего дня`);before(b.completedAt,`Тайминг ${date}, блок ${b.title}`);}}
    for(const [w,goals] of Object.entries(planner.achievementNotifications))for(const [code,at] of Object.entries(goals))before(at,`Достижение ${w}.${code}`);
    if(financial)validateFinancialPlanner(planner,value.asOfDate);
    return {format:'isp-planner-snapshot',schemaVersion:1,timeZone:'Europe/Moscow',exportedAt,asOfDate:value.asOfDate,planner};
  }
  async function processJob(type,value,limit,referenceDate=null) {
    if(type==='parse'){checkSize(value,limit);return {data:validateState(JSON.parse(value),referenceDate),raw:value};}
    if(type==='stringify'){if(limit===SMALL_BUDGET)checkObjectBudget(value,limit);const data=validateState(value,referenceDate),raw=JSON.stringify(data);checkSize(raw,limit);return {data,raw};}
    if(type==='import') {
      if(value.file.size>limit)fail('Файл превышает лимит доступной обработки');
      const raw=await value.file.text();if(new TextEncoder().encode(raw).byteLength>limit)fail('Файл превышает лимит');
      let parsed;try{parsed=JSON.parse(raw);}catch{fail('Файл: некорректный JSON');}
      return {data:validateSnapshot(parsed,value.referenceDate)};
    }
    if(type==='export') {
      if(limit===SMALL_BUDGET)checkObjectBudget(value.snapshot,limit);
      const data=validateSnapshot(value.snapshot,value.referenceDate),raw=JSON.stringify(data);
      if(new TextEncoder().encode(raw).byteLength>limit)fail('Снимок превышает лимит файла');
      return {data,raw};
    }
    if(type==='team'){if(limit===SMALL_BUDGET)checkObjectBudget(value.records,limit);return {data:teamMetrics(value.records,value.mode,value.period)};}
    if(type==='csv'){
      if(limit===SMALL_BUDGET)checkObjectBudget(value,limit);
      const rows=value.kind==='sales'?salesRows(value.entries):summaryRows(value.contexts,value.mode,value.period);
      return {raw:csvDocument(value.kind==='sales'?SALES_HEADERS:SUMMARY_HEADERS,rows,value.kind==='sales'?[0,3]:[0]),count:rows.length};
    }
    fail('Неизвестная фоновая операция');
  }
  function dayTiming(planner,date) {
    if (planner.daySchedules[date]) return structuredClone(planner.daySchedules[date]);
    const version=planner.templateVersions.filter(v=>v.effectiveFrom<=date).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
    const day=version?.weekdays[['sun','mon','tue','wed','thu','fri','sat'][weekday(date)]];
    return day ? {...structuredClone(day),blocks:day.blocks.map(b=>({...b,completedAt:null}))} : {workStart:'09:00',workEnd:'18:00',blocks:[]};
  }
  const overlaps=(a,b)=>a.start<b.end && b.start<a.end;
  function meetingConflicts(planner,meeting) {
    if (!['planned','completed'].includes(meeting.status)) return [];
    const messages=[];
    for (const other of planner.meetings) if(other.id!==meeting.id && other.date===meeting.date && ['planned','completed'].includes(other.status) && overlaps(meeting,other)) messages.push(`Пересечение со встречей ${other.clientId} (${other.start}–${other.end})`);
    const day=dayTiming(planner,meeting.date);
    if(meeting.start<day.workStart || meeting.end>day.workEnd) messages.push(`Вне рабочего дня ${day.workStart}–${day.workEnd}`);
    for(const block of day.blocks) if(block.kind!=='meetings' && overlaps(meeting,block)) messages.push(`Пересечение с действием «${block.title}»`);
    return messages;
  }
  function upsertMeeting(planner,input,referenceDate,at) {
    const previous=planner.meetings.find(m=>m.id===input.id);
    if (!workDate(input.date)) fail('Дата встречи должна быть рабочей: понедельник–пятница'); interval(input.start,input.end);
    if(!['planned','completed','postponed','cancelled'].includes(input.status)) fail('Выберите статус встречи');
    if(input.status==='completed' && input.date>referenceDate) fail('Будущую встречу нельзя отметить проведённой');
    const clientId=identifier(input.clientId.trim(),'ID клиента');
    text(input.note,2000,'Заметка',true);
    const items=unique(input.items,'Продукты встречи').map(i=>{if(!CODES.includes(i.productCode))fail('Неизвестный продукт');return {id:entityId(i.id),productCode:i.productCode,expectedKopecks:money(i.expectedKopecks)};});
    if(!items.length || items.length>5 || new Set(items.map(i=>i.productCode)).size!==items.length) fail('Укажите от одного до пяти разных продуктов');
    if(previous) for(const sale of planner.sales.filter(s=>s.meetingId===previous.id)) {
      const item=items.find(i=>i.id===sale.meetingItemId);
      if(clientId!==previous.clientId || !item || item.productCode!==sale.productCode) fail('Сначала отвяжите связанные продажи: нельзя менять клиента или удалять/менять их строку продукта');
    }
    const moved=previous && (previous.date!==input.date || previous.start!==input.start || previous.end!==input.end);
    if(previous && input.status==='postponed' && moved) fail('Для назначения новой даты выберите статус «Запланирована»');
    const meeting={id:previous?.id ?? input.id ?? id(),date:input.date,start:input.start,end:input.end,clientId,status:input.status,note:input.note,items,transferHistory:structuredClone(previous?.transferHistory ?? []),createdAt:previous?.createdAt ?? at,updatedAt:at};
    if(previous && (input.recordTransfer || moved || (input.status==='postponed' && previous.status!=='postponed') || (previous.status!=='planned' && input.status==='planned'))) meeting.transferHistory.push({id:id(),at,fromDate:previous.date,fromStart:previous.start,fromEnd:previous.end,toDate:input.status==='postponed'?null:input.date,toStart:input.status==='postponed'?null:input.start,toEnd:input.status==='postponed'?null:input.end});
    const index=planner.meetings.findIndex(m=>m.id===meeting.id); if(index<0) planner.meetings.push(meeting); else planner.meetings[index]=meeting;
    return meeting;
  }
  function deleteMeeting(planner,meetingId,at=new Date().toISOString()) { if(!planner.meetings.some(m=>m.id===meetingId))fail('Встреча уже удалена'); planner.meetings=planner.meetings.filter(m=>m.id!==meetingId); for(const s of planner.sales)if(s.meetingId===meetingId){s.meetingId=null;s.meetingItemId=null;s.updatedAt=at;} }
  function upsertSale(planner,input,referenceDate,at) {
    if(!workDate(input.date) || input.date>referenceDate) fail('Продажа должна быть в рабочий день и не позже сегодняшней даты');
    const clientId=identifier(input.clientId.trim(),'ID клиента'); if(!CODES.includes(input.productCode)) fail('Выберите продукт'); money(input.amountKopecks,'Продажа',true);
    const previous=planner.sales.find(s=>s.id===input.id), linked=input.meetingId!==null || input.meetingItemId!==null;
    if(linked) {const m=planner.meetings.find(m=>m.id===input.meetingId), item=m?.items.find(i=>i.id===input.meetingItemId);if(!m || !item || m.clientId!==clientId || item.productCode!==input.productCode)fail('Связь не соответствует клиенту или продукту продажи');}
    const sale={id:previous?.id ?? input.id ?? id(),date:input.date,clientId,productCode:input.productCode,amountKopecks:input.amountKopecks,meetingId:linked?input.meetingId:null,meetingItemId:linked?input.meetingItemId:null,createdAt:previous?.createdAt ?? at,updatedAt:at};
    const index=planner.sales.findIndex(s=>s.id===sale.id);if(index<0)planner.sales.push(sale);else planner.sales[index]=sale;return sale;
  }
  function deleteSale(planner,saleId) {if(!planner.sales.some(s=>s.id===saleId))fail('Продажа уже удалена');planner.sales=planner.sales.filter(s=>s.id!==saleId);}
  function saveTemplate(planner,weekdays,referenceDate,at) {
    const effectiveFrom=nextWorkDate(referenceDate), old=planner.templateVersions.find(v=>v.effectiveFrom===effectiveFrom);
    const version={id:old?.id ?? id(),effectiveFrom,createdAt:old?.createdAt ?? at,weekdays:Object.fromEntries(['mon','tue','wed','thu','fri'].map(d=>[d,schedule(weekdays[d],false)]))};
    planner.templateVersions=planner.templateVersions.filter(v=>v.effectiveFrom!==effectiveFrom);planner.templateVersions.push(version);return version;
  }
  function saveDay(planner,date,input,referenceDate,at) {
    if(!workDate(date))fail('Тайминг доступен только для рабочих дат');
    const original=dayTiming(planner,date), old=planner.daySchedules[date];
    const blocks=input.blocks.map(b=>({...b,completedAt:original.blocks.find(o=>o.id===b.id)?.completedAt ?? null}));
    if(date>referenceDate && blocks.some(b=>b.completedAt))fail('Будущие действия нельзя отмечать выполненными');
    planner.daySchedules[date]={...schedule({...input,blocks,createdAt:old?.createdAt ?? at,updatedAt:at},true)};
  }
  function toggleBlock(planner,date,blockId,referenceDate,at) {
    if(!workDate(date) || date>referenceDate) fail('Отметки доступны только для сегодняшних и прошлых рабочих дней');
    const day=dayTiming(planner,date), block=day.blocks.find(b=>b.id===blockId); if(!block) fail('Блок действия не найден');
    block.completedAt=block.completedAt?null:at;planner.daySchedules[date]={...day,createdAt:planner.daySchedules[date]?.createdAt ?? at,updatedAt:at};
  }
  return { PRODUCTS, CODES, KEYS, MAX_AMOUNT, BUDGET, SMALL_BUDGET, RESERVED, identifier, dateValid, supportedDate, addDays, weekday, workDate, weekStart, weekValid, businessDate, scaled, money, plain, moneyText, commission, safeSum, id, emptyState, initialPreferences, newPlanner, emptyPlan, validateProducts, validatePlanner, validateState, checkSize, timeValid, interval, nextWorkDate, remaining, linkedSalesIndex, weekMetrics, dayTiming, meetingConflicts, upsertMeeting, deleteMeeting, upsertSale, deleteSale, saveTemplate, saveDay, toggleBlock, monthValid, monthDates, monthMetrics, teamMetrics, validateSnapshot, processJob, SALES_HEADERS, SUMMARY_HEADERS, csvCell, csvDocument, salesRows, summaryRows, validateFinancialPlanner, validateFinancialState };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createPlannerCore();

if (typeof document !== 'undefined') {
  (async function startPlanner() {
    'use strict';
    const Core = createPlannerCore();
    const { PRODUCTS, KEYS } = Core;
    const app = document.getElementById('app'), editor = document.getElementById('editor'), confirmation = document.getElementById('confirmation');
    let state = Core.emptyState(), preferences = Core.initialPreferences(Core.businessDate()), originalRaw = null;
    let fatal = null, conflict = false, busy = false, activeForm = null, savedFocus = null, preferencesWarning = null;
    let draftTimer = null, toastTimer = null;
    let operation=null, preparedFile=null, shareBusy=false, backupNeedsRecovery=false;
    let suspendedForm=null;
    let teamSelection=null, teamSearch='', teamSort='volumeDeficit', teamDirection='desc', employeeView='overview';
    let teamCache=null, teamRequest=null, employeePickerOpen=false;
    const formatMoney = Core.moneyText;
    const today = () => Core.businessDate();
    const now = () => new Date().toISOString();
    const displayDate = date => new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
    const weekLabel = week => `${displayDate(week)} — ${displayDate(Core.addDays(week,4))}`;
    const shortWeek = week => `${week.slice(8)}.${week.slice(5,7)} — ${Core.addDays(week,4).slice(8)}.${Core.addDays(week,4).slice(5,7)}`;
    function el(tag, attributes = {}, ...children) {
      const node = document.createElement(tag);
      for (const [key,value] of Object.entries(attributes)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
        else if (key === 'value') node.value = value;
        else if (key === 'disabled') node.disabled = !!value;
        else node.setAttribute(key,String(value));
      }
      for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) appendNodes(node,child instanceof Node ? child : document.createTextNode(String(child)));
      return node;
    }
    function appendNodes(parent,...nodes) { parent.append(...nodes.flat(Infinity).filter(n=>n!==null && n!==undefined && n!==false)); }
    const btn = (label, click, style = '', attrs = {}) => el('button',{type:'button',class:`btn ${style}`,...attrs,onclick:click},label);
    function notify(message, error = false) {
      clearTimeout(toastTimer);
      document.getElementById('notifications').replaceChildren(el('div',{class:`toast${error ? ' error' : ''}`},message));
      if (error && editor.open && activeForm?.shell) activeForm.shell.fail(message);
      toastTimer = setTimeout(() => document.getElementById('notifications').replaceChildren(),error ? 9000 : 4500);
    }
    class Background {
      constructor() { this.worker = null; this.url = null; this.jobs = new Map(); this.sequence = 0; this.available = false; }
      async init() {
        if (typeof Worker === 'undefined') return;
        try {
          const source = `const core=(${createPlannerCore.toString()})(); self.onmessage=async e=>{const {id,type,value,limit,referenceDate}=e.data;try{self.postMessage({id,...await core.processJob(type,value,limit,referenceDate)});}catch(error){self.postMessage({id,error:error.message});}};self.postMessage({ready:true});`;
          this.url = URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
          this.worker = new Worker(this.url);
          await new Promise((resolve,reject) => {
            const timer = setTimeout(() => reject(new Error('Worker не отвечает')),3000);
            this.worker.onmessage = event => { if (event.data.ready) { clearTimeout(timer); resolve(); } else this.receive(event.data); };
            this.worker.onerror = () => { clearTimeout(timer); reject(new Error('Фоновая обработка недоступна')); this.close();render(); };
          });
          this.available = true;
        } catch { this.close(); }
      }
      receive(message) {
        const job = this.jobs.get(message.id); if (!job) return;
        clearTimeout(job.timer); job.cleanup(); this.jobs.delete(message.id);
        message.error ? job.reject(new Error(message.error)) : job.resolve(message);
      }
      rejectAll(message) { for (const job of this.jobs.values()) { clearTimeout(job.timer); job.cleanup(); job.reject(new Error(message)); } this.jobs.clear(); }
      async run(type,value,signal=null) {
        const limit = this.available ? Core.BUDGET : Core.SMALL_BUDGET;
        if(signal?.aborted)throw new DOMException('Операция отменена','AbortError');
        if(type==='import' && value.file.size>limit)throw new Error(this.available ? 'Файл превышает лимит 2 МиБ' : 'Фоновая обработка недоступна: файл больше 256 КиБ отклонён до разбора');
        if (!this.available) {
          const result=await Core.processJob(type,value,limit,today());
          if(signal?.aborted)throw new DOMException('Операция отменена','AbortError');return result;
        }
        return new Promise((resolve,reject) => {
          const id = ++this.sequence;
          const abort=()=>{clearTimeout(timer);cleanup();this.jobs.delete(id);reject(new DOMException('Операция отменена','AbortError'));};
          const cleanup=()=>signal?.removeEventListener('abort',abort);
          const timer = setTimeout(() => { cleanup();this.jobs.delete(id); reject(new Error('Фоновая обработка превысила 30 секунд')); this.close();render(); },30000);
          this.jobs.set(id,{resolve,reject,timer,cleanup});signal?.addEventListener('abort',abort,{once:true});
          try { this.worker.postMessage({id,type,value,limit,referenceDate:today()}); } catch (error) { clearTimeout(timer);cleanup(); this.jobs.delete(id); reject(error); }
        });
      }
      close() { this.available = false; this.rejectAll('Фоновая обработка остановлена'); this.worker?.terminate(); this.worker = null; if (this.url) URL.revokeObjectURL(this.url); this.url = null; }
    }
    const background = new Background();
    function readPreferences() {
      const defaults = Core.initialPreferences(today());
      try {
        const raw = localStorage.getItem(KEYS.preferences);
        if (!raw) return defaults;
        if (raw.length * 2 > 64 * 1024) throw new Error();
        const p = JSON.parse(raw);
        if (p.schemaVersion !== 1 || !p.ui || !p.ownBackup) throw new Error();
        const b=p.ownBackup;
        if(typeof b.hasChanges!=='boolean' || b.employeeId!==null && typeof b.employeeId!=='string')throw new Error();
        for(const key of ['lastExportAt','snoozedUntil'])if(b[key]!==null && (typeof b[key]!=='string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(b[key]) || !Core.dateValid(b[key].slice(0,10)) || !Number.isFinite(Date.parse(b[key]))))throw new Error();
        if (['employee','manager'].includes(p.ui.mode)) defaults.ui.mode = p.ui.mode;
        if (['overview','calendar','sales','settings'].includes(p.ui.employeeSection)) defaults.ui.employeeSection = p.ui.employeeSection;
        if (['team','employee','sales','settings'].includes(p.ui.managerSection)) defaults.ui.managerSection = p.ui.managerSection;
        if (['day','week'].includes(p.ui.calendarView)) defaults.ui.calendarView = p.ui.calendarView;
        if (typeof p.ui.selectedEmployeeId === 'string') defaults.ui.selectedEmployeeId = p.ui.selectedEmployeeId;
        if (['week','month'].includes(p.ui.managerPeriodMode)) defaults.ui.managerPeriodMode = p.ui.managerPeriodMode;
        if (Core.monthValid(p.ui.managerMonth)) defaults.ui.managerMonth = p.ui.managerMonth;
        defaults.ownBackup = { employeeId: typeof p.ownBackup.employeeId === 'string' ? p.ownBackup.employeeId : null, lastExportAt: typeof p.ownBackup.lastExportAt === 'string' ? p.ownBackup.lastExportAt : null, hasChanges: p.ownBackup.hasChanges !== false, snoozedUntil: typeof p.ownBackup.snoozedUntil === 'string' ? p.ownBackup.snoozedUntil : null };
      } catch { notify('Настройки интерфейса восстановлены. Бизнес-данные не изменены.',true); }
      return defaults;
    }
    function savePreferences() {
      try { const raw = JSON.stringify(preferences); if (raw.length * 2 > 64*1024) throw new Error(); localStorage.setItem(KEYS.preferences,raw); preferencesWarning = null; }
      catch { preferencesWarning = 'Не удалось сохранить настройки экрана. Подтверждённые бизнес-данные в сохранности; проверьте доступное место.'; notify(preferencesWarning,true); }
    }
    async function load() {
      fatal = null; conflict = false;backupNeedsRecovery=false;
      try {
        const probe = `${KEYS.data}.probe.${Core.id()}`;
        localStorage.setItem(probe,'1'); if (localStorage.getItem(probe) !== '1') throw new Error('Хранилище не отвечает'); localStorage.removeItem(probe);
        originalRaw = localStorage.getItem(KEYS.data);
        state = originalRaw === null ? Core.emptyState() : (await background.run('parse',originalRaw)).data;
        preferences = readPreferences();
        if (preferences.ownBackup.employeeId !== (state.ownPlanner?.employee.id ?? null)) preferences.ownBackup = {employeeId:state.ownPlanner?.employee.id ?? null,lastExportAt:null,hasChanges:true,snoozedUntil:null};
        else if(state.ownPlanner && !preferences.ownBackup.hasChanges && preferences.ownBackup.lastExportAt && state.ownPlanner.employee.updatedAt>preferences.ownBackup.lastExportAt){preferences.ownBackup.hasChanges=true;backupNeedsRecovery=true;}
        if (!Object.hasOwn(state.importedEmployees,preferences.ui.selectedEmployeeId)) preferences.ui.selectedEmployeeId = null;
      } catch (error) { fatal = error.message; }
      render();
    }
    async function commit(change,rewards=false,options={}) {
      if (busy || fatal) throw new Error('Сохранение сейчас недоступно');
      if(conflict)throw new Error('Данные изменились. Перечитайте их перед сохранением.');
      if(operation && options.operation!==operation)throw new Error('Подготовка данных уже выполняется. Завершите или отмените её.');
      if(options.signal?.aborted)throw new DOMException('Операция отменена','AbortError');
      if(!background.available && originalRaw!==null)Core.checkSize(originalRaw,Core.SMALL_BUDGET);
      if (localStorage.getItem(KEYS.data) !== originalRaw) { conflict = true; renderConflict(); throw new Error('Данные изменены в другой вкладке. Перечитайте их перед сохранением.'); }
      const base = originalRaw;
      const ownOperation=!options.operation;
      const op=options.operation ?? {kind:'commit',controller:new AbortController(),base,revision:state.revision,shell:activeForm?.shell};
      if(ownOperation)operation=op;
      const signal=options.signal ?? op.controller.signal;
      busy = true;
      const controls = [...editor.querySelectorAll('button:not([data-operation-cancel]),input,select,textarea')].map(node => ({node,disabled:node.disabled}));
      controls.forEach(({node}) => node.disabled = true);
      if(ownOperation)appendNodes(op.shell?.footer ?? document.getElementById('main-content'),commitProgress());
      try {
        const next = structuredClone(state), week = Core.weekStart(today());
        const before = state.ownPlanner ? Core.weekMetrics(state.ownPlanner,week,today()) : null;
        change(next); next.revision = state.revision + 1; next.updatedAt = now();
        if(options.ownChanged!==false && options.stampOwn!==false && next.ownPlanner)next.ownPlanner.employee.updatedAt=next.updatedAt;
        const awards = [];
        if (rewards && before && next.ownPlanner?.employee.id === state.ownPlanner.employee.id) {
          const after = Core.weekMetrics(next.ownPlanner,week,today());
          for (const p of PRODUCTS) if (!before.products[p.code].goal && after.products[p.code].goal && !next.ownPlanner.achievementNotifications[week]?.[p.code]) {
            (next.ownPlanner.achievementNotifications[week] ||= {})[p.code] = now(); awards.push(p.short);
          }
        }
        const result = await background.run('stringify',next,signal);
        if(signal.aborted)throw new DOMException('Подготовка отменена. Форма сохранена.','AbortError');
        if (localStorage.getItem(KEYS.data) !== base) { conflict = true; renderConflict(); throw new Error('Другая вкладка изменила данные во время подготовки. Перечитайте их.'); }
        localStorage.setItem(KEYS.data,result.raw);
        state = result.data; originalRaw = result.raw;
        if(suspendedForm && options.quotaRecovery && options.ownChanged===false && suspendedForm.revision===op.revision)suspendedForm.revision=state.revision;
        preparedFile=null;teamCache=null;
        if(options.ownChanged!==false)preferences.ownBackup = {employeeId:state.ownPlanner?.employee.id ?? null,lastExportAt:preferences.ownBackup.lastExportAt,hasChanges:true,snoozedUntil:preferences.ownBackup.snoozedUntil};
        savePreferences();
        if (awards.length) setTimeout(() => showAward(awards),100);
      } catch (error) {
        if (error.name === 'QuotaExceededError') {showQuotaActions(op.shell);throw new Error('Недостаточно места. Не удалось сохранить: экспортируйте резервную копию и освободите место. Форма сохранена.');}
        if(error.name==='AbortError')throw new DOMException('Подготовка отменена. Форма сохранена.','AbortError');
        if (error.name === 'SecurityError') throw new Error('Браузер не разрешает сохранение данных. Форма не потеряна.');
        throw error;
      } finally { busy = false;if(ownOperation && operation===op)operation=null;document.querySelectorAll('[data-commit-progress]').forEach(n=>n.remove()); controls.forEach(({node,disabled}) => node.disabled = disabled); }
    }
    function commitProgress(){return el('div',{class:'commit-progress','data-commit-progress':'true'},el('p',{role:'status'},'Подготовка данных…'),btn('Отменить подготовку',cancelOperation,'ghost',{'data-operation-cancel':'true'}));}
    function downloadRaw() {
      const blob = new Blob([originalRaw ?? ''],{type:'text/plain;charset=utf-8'}), url = URL.createObjectURL(blob);
      const a = el('a',{href:url,download:`isp-recovery-${today()}.txt`}); appendNodes(document.body,a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }
    function field(label, attributes = {}, note = '', control = 'input') {
      const id = attributes.id || Core.id(), input = el(control,{id,...attributes});
      const error = el('span',{class:'field-error',id:`${id}-error`});
      const noteNode = note ? el('span',{class:'field-note',id:`${id}-note`},note) : null;
      input.setAttribute('aria-describedby',`${id}-error${note ? ` ${id}-note` : ''}`);
      const wrapper = el('label',{class:'field',for:id},el('span',{class:'field-label'},label),input,noteNode,error);
      return {wrapper,input,error,setError(message) { error.textContent = message || ''; input.setAttribute('aria-invalid',message ? 'true' : 'false'); }};
    }
    function checkFields(shell,checks) {
      for(const f of new Set(checks.map(([f])=>f)))f.setError('');
      let first=null;
      for(const [f,check] of checks)try{check();}catch(error){f.setError(error.message);first ||= f.input;}
      if(!first)return true;
      shell.fail('Проверьте отмеченные поля. '+first.closest('.field').querySelector('.field-error').textContent);
      let parent=first.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
      first.focus();return false;
    }
    function timeChecks(start,end) {
      return [[start,()=>{if(!Core.timeValid(start.input.value))throw new Error('Введите время HH:mm');}],[end,()=>Core.interval(start.input.value,end.input.value)]];
    }
    function workDateCheck(f,future=false) {
      if(!Core.workDate(f.input.value))throw new Error('Дата должна быть рабочей: понедельник–пятница в диапазоне 2000–2099');
      if(!future && f.input.value>today())throw new Error('Дата должна быть не позже сегодняшней');
    }
    function suspendForQuota(action) {
      flushDraft();suspendedForm={form:activeForm,focus:savedFocus,nodes:[...editor.childNodes],revision:state.revision};
      activeForm=null;savedFocus=null;editor.close();editor.replaceChildren();action();
    }
    function showQuotaActions(shell) {
      if(suspendedForm)return;
      if(!shell){
        activeForm={kind:'quota-error',dirty:false};shell=formShell('Не удалось сохранить',()=>{});activeForm.shell=shell;
        appendNodes(shell.body,el('p',{},'Недостаточно места. Подтверждённые данные сохранены. После освобождения места повторите действие.'));
        appendNodes(shell.footer,btn('Закрыть',finishForm,'ghost'));
      }
      if(shell.body.querySelector('.quota-actions'))return;
      const records=Object.entries(state.importedEmployees),box=el('div',{class:'quota-actions'},el('p',{class:'small'},'Можно сохранить копию или удалить ненужный снимок. Введённая форма вернётся без потери полей.'));
      const exportId=readOnly()?records[0]?.[0]:state.ownPlanner?null:undefined;
      if(exportId!==undefined)appendNodes(box,btn('Экспортировать резервную копию',()=>suspendForQuota(()=>prepareSnapshot(exportId,true)),'secondary'));
      if(records.length)appendNodes(box,btn('Удалить ненужный снимок',()=>suspendForQuota(()=>{
        activeForm={kind:'quota-recovery',dirty:false};const recovery=formShell('Освободить место',()=>{});activeForm.shell=recovery;
        const pick=selectField('Снимок для удаления','quota-snapshot',records.map(([id,r])=>[id,`${r.snapshot.planner.employee.name} · ID ${id}`]),records[0][0]);
        appendNodes(recovery.body,pick.wrapper,el('p',{},'Собственный профиль и введённая форма сохранятся. Перед удалением можно скачать снимок.'));
        appendNodes(recovery.footer,btn('Вернуться к форме',finishForm,'ghost'),btn('Скачать снимок',()=>prepareSnapshot(pick.input.value,true),'secondary'),btn('Удалить выбранный снимок',async()=>{await deleteSnapshots(pick.input.value,true);finishForm();},'danger'));
      }),'ghost'));
      shell.error.after(box);
      requestAnimationFrame(()=>box.querySelector('button')?.focus());
    }
    function formShell(title, onSubmit) {
      if (!editor.open) savedFocus = document.activeElement;
      editor.replaceChildren();
      const form = el('form',{novalidate:true,onsubmit: async event => { event.preventDefault(); if (!busy) await onSubmit(); }});
      const error = el('div',{class:'error-message',role:'alert',tabindex:'-1'});
      const body = el('div',{class:'dialog-body'},error);
      const footer = el('div',{class:'dialog-footer'});
      appendNodes(form,el('div',{class:'dialog-header'},el('h2',{id:'editor-title'},title),btn('×',requestClose,'ghost icon',{'aria-label':'Закрыть форму'})),body,footer);
      appendNodes(editor,form);
      if (!editor.open) editor.showModal();
      return {body,footer,error,fail(message) {
        error.textContent = message;
        if(body.querySelector('.quota-actions')){footer.querySelector('.dialog-notice')?.remove();if(conflict)renderConflict();return;}
        let notice = footer.querySelector('.dialog-notice');
        if (!notice) { notice = el('p',{class:'dialog-notice','aria-hidden':'true'}); footer.prepend(notice); }
        notice.textContent = message;
        if (conflict) renderConflict();
      }};
    }
    function finishForm() {
      clearTimeout(draftTimer); activeForm = null; editor.close(); editor.replaceChildren();
      if(suspendedForm){
        const held=suspendedForm;suspendedForm=null;activeForm=held.form;savedFocus=held.focus;appendNodes(editor,...held.nodes);editor.showModal();
        if(state.revision!==held.revision || localStorage.getItem(KEYS.data)!==originalRaw){conflict=true;renderConflict();}
        else {if(activeForm?.baseRevision!==undefined)activeForm.baseRevision=state.revision;activeForm?.refreshBase?.();}
        editor.querySelector('button[type="submit"]')?.focus();return;
      }
      const target = savedFocus; savedFocus = null;
      requestAnimationFrame(() => {
        if (editor.open) return;
        if (target?.isConnected) { target.focus(); return; }
        const match = target?.id ? document.getElementById(target.id) : [...app.querySelectorAll('button')].find(b => b.textContent === target?.textContent);
        (match || document.getElementById('main-content'))?.focus();
      });
    }
    function ask(title,message,options = {}) {
      return new Promise(resolve => {
        confirmation.replaceChildren();
        const body = el('div',{class:'dialog-body'},el('p',{},message));
        let guard = null;
        const yes = btn(options.yes || 'Подтвердить',() => done(true),options.danger ? 'danger' : '',{id:'confirm-yes'});
        const no = btn(options.no || 'Отмена',() => done(false),'ghost');
        if (options.word) { guard = field(`Введите «${options.word}»`,{id:'confirmation-word',autocomplete:'off'}); appendNodes(body,guard.wrapper); yes.disabled = true; guard.input.addEventListener('input',() => yes.disabled = guard.input.value.trim() !== options.word); }
        const done = result => { confirmation.close(); confirmation.oncancel = null; resolve(result); };
        appendNodes(confirmation,el('div',{class:'dialog-header'},el('h2',{id:'confirmation-title'},title)),body,el('div',{class:'dialog-footer'},options.exportAction?btn('Сначала скачать снимок',()=>{done(false);options.exportAction();},'secondary'):null,no,yes));
        confirmation.oncancel = event => { event.preventDefault(); done(false); };
        confirmation.showModal(); (guard?.input || no).focus();
      });
    }
    async function requestClose() {
      if(operation){cancelOperation();return;}
      if (busy) return;
      if (activeForm?.dirty && !await ask('Несохранённые изменения','Изменения формы ещё не сохранены.',{yes:'Не сохранять',no:'Продолжить редактирование'})) return;
      const cached = activeForm?.kind === 'plan' || !!activeForm?.getFields;
      if (cached) removeDraft(activeForm.week || activeForm.targetKey,false,activeForm.kind);
      finishForm(); if (cached) render();
    }
    editor.addEventListener('cancel',event => { event.preventDefault(); requestClose(); });
    function readDrafts() {
      try {
        const raw = sessionStorage.getItem(KEYS.drafts); if (!raw) return [];
        if (raw.length * 2 > 128*1024) throw new Error(); const data = JSON.parse(raw);
        if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error();
        return data.entries.filter(d => ['plan','meeting','sale','template','day'].includes(d.formType) && typeof d.employeeId === 'string' && typeof d.targetKey === 'string' && Number.isSafeInteger(d.baseRevision) && d.fields && typeof d.savedAt === 'string');
      } catch { notify('Черновик не сохраняется: хранилище черновиков недоступно или повреждено.',true); return []; }
    }
    function planFields() {
      return Object.fromEntries(PRODUCTS.map(p => { const row = activeForm.rows[p.code]; return [p.code,{volume:row.volume.input.value,income:row.income.input.value,mode:row.mode}]; }));
    }
    function flushDraft() {
      clearTimeout(draftTimer);
      if (!activeForm || !(activeForm.kind === 'plan' || activeForm.getFields) || !activeForm.dirty || !state.ownPlanner) return;
      try {
        const record = {employeeId:state.ownPlanner.employee.id,formType:activeForm.kind,targetKey:activeForm.week || activeForm.targetKey,baseRevision:activeForm.baseRevision,savedAt:now(),fields:activeForm.kind === 'plan' ? planFields() : activeForm.getFields()};
        if (JSON.stringify(record).length * 2 > 64*1024) throw new Error();
        const entries = readDrafts().filter(d => !(d.employeeId === record.employeeId && d.formType === record.formType && d.targetKey === record.targetKey)); entries.push(record);
        const raw = JSON.stringify({schemaVersion:1,entries}); if (raw.length * 2 > 128*1024) throw new Error();
        sessionStorage.setItem(KEYS.drafts,raw);
      } catch { notify('Черновик не сохраняется. Сохраните данные кнопкой в форме.',true); }
    }
    function removeDraft(target, all = false, kind = 'plan') {
      try { const entries = readDrafts().filter(d => !(d.employeeId === state.ownPlanner?.employee.id && (all || d.targetKey === target && d.formType === kind))); if (entries.length) sessionStorage.setItem(KEYS.drafts,JSON.stringify({schemaVersion:1,entries})); else sessionStorage.removeItem(KEYS.drafts); } catch { notify('Не удалось удалить черновик.',true); }
    }
    function dirty() { if (!activeForm) return; activeForm.dirty = true; if (activeForm.kind === 'plan' || activeForm.getFields) { clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft,300); } }
    window.addEventListener('pagehide',flushDraft);
    document.addEventListener('visibilitychange',() => { if (document.hidden) flushDraft(); else refreshDay(); });
    editor.addEventListener('focusout',flushDraft);
    window.addEventListener('beforeunload',event => { if (activeForm?.dirty) { flushDraft(); event.preventDefault(); event.returnValue = ''; } });

    function profileForm(values = {id:'',name:'',rates:{}}) {
      activeForm = {kind:'profile',dirty:false};
      const shell = formShell('Настройка сотрудника',submit);
      activeForm.shell = shell;
      const employeeId = field('ID сотрудника',{id:'employee-id',value:values.id,autocomplete:'off',maxlength:64},'ID сохраняет ведущие нули и не меняется после подтверждения.');
      const employeeName = field('Имя сотрудника',{id:'employee-name',value:values.name,autocomplete:'name',maxlength:100});
      const fields = Object.fromEntries(PRODUCTS.map(p => [p.code,field(`${p.short}: ставка, %`,{id:`rate-${p.code}`,value:values.rates[p.code] ?? '',inputmode:'decimal',autocomplete:'off'},p.name)]));
      appendNodes(shell.body,el('p',{class:'muted small'},'Укажите фиксированные ставки. Проверьте значения перед окончательным сохранением.'),employeeId.wrapper,employeeName.wrapper,...PRODUCTS.map(p => fields[p.code].wrapper));
      appendNodes(shell.footer,btn('Отмена',requestClose,'ghost'),btn('Проверить данные',null,'',{type:'submit'}));
      shell.body.addEventListener('input',dirty);
      async function submit() {
        let first = null; shell.error.textContent = '';
        const data = {id:employeeId.input.value.trim(),name:employeeName.input.value.trim(),rates:{}};
        const checked = (f,fn) => { try { f.setError(''); return fn(); } catch(error) { f.setError(error.message); first ||= f.input; return null; } };
        checked(employeeId,() => Core.identifier(data.id));
        checked(employeeName,() => { if (!data.name || data.name.length > 100) throw new Error('Введите имя длиной от 1 до 100 символов'); });
        for (const p of PRODUCTS) data.rates[p.code] = checked(fields[p.code],() => Core.scaled(fields[p.code].input.value,10000));
        if (first) { shell.fail('Проверьте отмеченные поля.'); first.focus(); return; }
        profileReview(data);
      }
      employeeId.input.focus();
    }
    function profileReview(data) {
      activeForm = {kind:'profile',dirty:true};
      const shell = formShell('Проверьте профиль',async () => {
        try {
          const instant = now(), planner = Core.newPlanner({id:data.id,name:data.name},data.rates,today(),instant);
          await commit(next => { next.ownPlanner = planner; });
          preferences.ownBackup = {employeeId:data.id,lastExportAt:null,hasChanges:true,snoozedUntil:null};
          preferences.ui.mode = 'employee'; preferences.ui.employeeSection = 'overview'; savePreferences();
          finishForm(); render(); notify('Профиль создан. Можно задать план недели.');
        } catch(error) { shell.fail(error.message); }
      });
      activeForm.shell = shell;
      appendNodes(shell.body,el('p',{class:'banner'},'После подтверждения ID и ставки будут зафиксированы. Имя можно будет исправить.'),el('div',{class:'review-row'},'Сотрудник',el('strong',{},data.name)),el('div',{class:'review-row'},'ID',el('strong',{},data.id)),...PRODUCTS.map(p => el('div',{class:'review-row'},`${p.short} · ${p.name}`,el('strong',{},`${Core.plain(data.rates[p.code])}%`))));
      appendNodes(shell.footer,btn('Вернуться',() => profileForm({id:data.id,name:data.name,rates:Object.fromEntries(PRODUCTS.map(p => [p.code,Core.plain(data.rates[p.code])]))}),'ghost'),btn('Подтвердить и начать',null,'',{type:'submit',id:'profile-confirm'}));
    }
    function planEditor(week = preferences.ui.weekKey, draft = null) {
      if (!state.ownPlanner || fatal) return;
      const existing = state.ownPlanner.plans[week]?.products ?? Core.emptyPlan();
      activeForm = {kind:'plan',week,baseRevision:state.revision,dirty:!!draft,rows:{}};
      const shell = formShell('План недели',submit); activeForm.shell = shell;
      appendNodes(shell.body,el('p',{class:'muted small'},weekLabel(week)),btn('Скопировать план прошлой недели',copyPrevious,'secondary',{id:'copy-plan'}));
      for (const p of PRODUCTS) {
        const source = draft?.[p.code];
        const row = {
          mode: source?.mode === 'manual' ? 'manual' : source?.mode === 'auto' ? 'auto' : existing[p.code].incomeMode,
          volume:field('План объёма, ₽',{id:`plan-${p.code}-volume`,value:source ? String(source.volume ?? '') : Core.plain(existing[p.code].volumeKopecks),inputmode:'decimal',autocomplete:'off'}),
          income:field('План дохода, ₽',{id:`plan-${p.code}-income`,value:source ? String(source.income ?? '') : Core.plain(existing[p.code].incomeKopecks),inputmode:'decimal',autocomplete:'off'}),
          note:el('p',{class:'mode-note'})
        };
        activeForm.rows[p.code] = row;
        const update = () => {
          let calculated = null;
          try { calculated = Core.commission(Core.scaled(row.volume.input.value,Core.MAX_AMOUNT,true),state.ownPlanner.ratesBps[p.code]); } catch { /* Поле проверяется при сохранении. */ }
          if (row.mode === 'auto') row.income.input.value = calculated === null ? '' : Core.plain(calculated);
          row.note.textContent = row.mode === 'auto' ? `Автоматически по ставке ${Core.plain(state.ownPlanner.ratesBps[p.code])}%` : `План дохода задан вручную.${calculated === null ? '' : ` Расчёт по ставке: ${formatMoney(calculated)}`}`;
        };
        row.update = update;
        row.volume.input.addEventListener('input',() => { update(); dirty(); });
        row.income.input.addEventListener('input',() => { row.mode = 'manual'; update(); dirty(); });
        appendNodes(shell.body,el('section',{class:'form-product','data-product':p.code},el('h3',{},p.short),el('p',{class:'product-name'},p.name),el('div',{class:'form-row'},row.volume.wrapper,row.income.wrapper),row.note,btn('Рассчитать по ставке',() => { row.mode = 'auto'; update(); dirty(); },'ghost',{'aria-label':`${p.short}: рассчитать доход по ставке`}))); update();
      }
      appendNodes(shell.footer,btn('Отмена',requestClose,'ghost'),btn('Сохранить план',null,'',{type:'submit',id:'save-plan'}));
      async function copyPrevious() {
        const source = state.ownPlanner.plans[Core.addDays(week,-7)];
        if (!source) { notify('В предыдущей неделе план не задан.'); return; }
        const nonzero = Object.values(planFields()).some(r => { try { return Core.scaled(r.volume,Core.MAX_AMOUNT,true) > 0 || Core.scaled(r.income,Core.MAX_AMOUNT,true) > 0; } catch { return true; } });
        if (nonzero && !await ask('Заменить план?','Значения в редакторе будут заменены планом предыдущей недели. Запись в хранилище произойдёт только после сохранения.',{yes:'Заменить в форме'})) return;
        for (const p of PRODUCTS) { const row = activeForm.rows[p.code], item = source.products[p.code]; row.mode = item.incomeMode; row.volume.input.value = Core.plain(item.volumeKopecks); row.income.input.value = Core.plain(item.incomeKopecks); row.update(); }
        dirty(); notify('План скопирован в форму. Проверьте и сохраните.');
      }
      async function submit() {
        const products = {}; let first = null; shell.error.textContent = '';
        for (const p of PRODUCTS) {
          const row = activeForm.rows[p.code]; let volume = null, income = null;
          for (const [kind,f] of [['volume',row.volume],['income',row.income]]) {
            try { f.setError(''); const value = Core.scaled(f.input.value,Core.MAX_AMOUNT,true); if (kind === 'volume') volume = value; else income = value; }
            catch(error) { f.setError(error.message); first ||= f.input; }
          }
          if (volume !== null && income !== null) products[p.code] = {volumeKopecks:volume,incomeKopecks:row.mode === 'auto' ? Core.commission(volume,state.ownPlanner.ratesBps[p.code]) : income,incomeMode:row.mode};
        }
        if (first) { shell.fail('Проверьте отмеченные суммы.'); first.focus(); return; }
        if (Core.addDays(week,4) < today() && !await ask('Изменить прошлую неделю?',`${weekLabel(week)}. Показатели прошлой недели будут пересчитаны.`,{yes:'Сохранить изменения'})) return;
        try {
          await commit(next => { const previous = next.ownPlanner.plans[week]; next.ownPlanner.plans[week] = {products,createdAt:previous?.createdAt ?? now(),updatedAt:now()}; },week === Core.weekStart(today()));
          removeDraft(week); finishForm(); render(); notify('План недели сохранён.');
        } catch(error) { shell.fail(error.message); if (conflict) renderConflict(); }
      }
      activeForm.rows.OPIF.volume.input.focus();
      if (draft) dirty();
    }
    function beginOperation(title) {
      if(operation || busy || shareBusy){notify('Другая операция ещё выполняется.',true);return null;}
      const controller=new AbortController(), op={controller,base:originalRaw,revision:state.revision};operation=op;
      activeForm={kind:'operation',dirty:false};const shell=formShell(title,()=>{});op.shell=shell;activeForm.shell=shell;
      appendNodes(shell.body,el('p',{role:'status',class:'loading'},'Подготовка данных…'),el('p',{class:'muted small'},'Можно прокручивать страницу или отменить операцию до записи.'));
      appendNodes(shell.footer,btn('Отменить операцию',cancelOperation,'ghost'));return op;
    }
    function cancelOperation() {
      const op=operation;if(!op)return;op.controller.abort();operation=null;
      if(op.kind==='commit'){notify('Подготовка отменена. Форма сохранена.');return;}
      finishForm();render();notify('Операция отменена. Данные не изменены.');
    }
    function checkOperation(op) {
      if(operation!==op || op.controller.signal.aborted)throw new DOMException('Операция отменена','AbortError');
      if(localStorage.getItem(KEYS.data)!==op.base || state.revision!==op.revision){conflict=true;throw new Error('Данные изменились в другой вкладке. Перечитайте их перед продолжением.');}
    }
    function operationError(op,error) {
      if(operation!==op || error.name==='AbortError')return;
      operation=null;op.shell.fail(error.message);op.shell.footer.replaceChildren(btn('Закрыть',finishForm,'ghost'),btn('Перечитать данные',reloadData,'secondary'));
    }
    const displayInstant=value=>new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',hourCycle:'h23'});
    function snapshotName(snapshot) {
      const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(snapshot.exportedAt)).replace(':','-');
      return `isp-planner_${snapshot.planner.employee.id.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}_${snapshot.asOfDate}_${time}.json`;
    }
    function preparedValid(file) { return preparedFile===file && file.revision===state.revision && file.base===localStorage.getItem(KEYS.data) && (file.quota && suspendedForm || (file.employeeId===null ? preferences.ui.mode==='employee' : preferences.ui.mode==='manager' && preferences.ui.selectedEmployeeId===file.selection)); }
    function downloadFile(file) {
      const url=URL.createObjectURL(file),a=el('a',{href:url,download:file.name});
      try{appendNodes(document.body,a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }
    async function prepareSnapshot(employeeId=null,quota=false) {
      const own=employeeId===null,planner=own?state.ownPlanner:state.importedEmployees[employeeId]?.snapshot.planner;
      if(!planner)return notify('Планировщик не выбран.',true);
      const op=beginOperation('Подготовка снимка');if(!op)return;
      try {
        const exportedAt=now(),snapshot=own?{format:'isp-planner-snapshot',schemaVersion:1,timeZone:'Europe/Moscow',exportedAt,asOfDate:Core.businessDate(new Date(exportedAt)),planner}:state.importedEmployees[employeeId].snapshot;
        const result=await background.run('export',{snapshot,referenceDate:today()},op.controller.signal);checkOperation(op);
        const file=new File([result.raw],snapshotName(result.data),{type:'application/json'}),textFile=new File([result.raw],file.name.replace(/\.json$/,'.txt'),{type:'text/plain'});
        let shareFile=null;
        if(window.isSecureContext && typeof navigator.share==='function' && typeof navigator.canShare==='function')try{shareFile=navigator.canShare({files:[file]})?file:navigator.canShare({files:[textFile]})?textFile:null;}catch{/* Остаётся скачивание. */}
        preparedFile={file,shareFile,snapshot:result.data,employeeId,selection:preferences.ui.selectedEmployeeId,revision:state.revision,base:originalRaw,quota};operation=null;showPrepared(preparedFile);
      }catch(error){operationError(op,error);}
    }
    function showPrepared(ready) {
      activeForm={kind:'export',dirty:false};const shell=formShell('Снимок готов',()=>{});activeForm.shell=shell;
      appendNodes(shell.body,el('p',{class:'intro-name'},`${ready.snapshot.planner.employee.name} · ID ${ready.snapshot.planner.employee.id}`),el('p',{},`Данные на ${displayInstant(ready.snapshot.exportedAt)}`),el('p',{class:'small muted'},ready.employeeId===null?'Файл содержит весь ваш планировщик. Проверьте сохранение резервной копии после скачивания.':'Дата исходного снимка сохранена.'),el('p',{class:'small muted'},ready.shareFile?'Получателя выбираете вы в системном меню. Передача не подтверждает получение или импорт руководителем.':'Можно сохранить файл и передать вручную'));
      const download=btn('Скачать JSON',()=>{
        if(!preparedValid(ready)){shell.fail('Данные изменились. Подготовьте новый снимок.');return;}
        try{downloadFile(ready.file);if(ready.employeeId===null){preferences.ownBackup={employeeId:ready.snapshot.planner.employee.id,lastExportAt:now(),hasChanges:false,snoozedUntil:null};backupNeedsRecovery=false;savePreferences();render();}notify(ready.employeeId===null?'Скачивание резервной копии начато — проверьте сохранение файла':'Скачивание снимка начато — проверьте сохранение файла');}catch(error){shell.fail(`Не удалось начать скачивание: ${error.message}`);}
      });
      const share=btn('Поделиться снимком',async()=>{
        if(shareBusy)return;if(!preparedValid(ready)){shell.fail('Данные изменились. Подготовьте новый снимок.');return;}
        shareBusy=true;share.disabled=true;
        try{await navigator.share({files:[ready.shareFile],title:'Планировщик продаж ИСП'});notify('Системное меню завершило передачу файла');}
        catch(error){if(error.name==='AbortError')notify('Передача отменена. Можно скачать JSON.');else shell.fail(`Передача не завершена: ${error.message}. Можно скачать JSON.`);}
        finally{shareBusy=false;share.disabled=!ready.shareFile;}
      },'secondary',{disabled:!ready.shareFile});
      appendNodes(shell.footer,btn('Закрыть',finishForm,'ghost'),download,share);
    }
    function chooseSnapshot(mode) {
      if(operation || busy){notify('Другая операция ещё выполняется.',true);return;}
      const input=el('input',{type:'file',accept:'.json,.txt,application/json,text/plain','aria-label':mode==='manager'?'Файл сотрудника':'Резервный файл планировщика',onchange:()=>{const file=input.files[0];input.remove();if(file)importSnapshot(file,mode);}});
      appendNodes(document.body,input);input.hidden=true;input.click();input.addEventListener('cancel',()=>input.remove(),{once:true});
    }
    async function importSnapshot(file,mode) {
      const op=beginOperation(mode==='manager'?'Проверка снимка сотрудника':'Проверка резервной копии');if(!op)return;
      try {
        const result=await background.run('import',{file,referenceDate:today()},op.controller.signal);checkOperation(op);operation=null;
        importReview(result.data,mode,op.base,op.revision);
      }catch(error){operationError(op,error);}
    }
    function snapshotSummary(snapshot) {
      const p=snapshot.planner,dates=[...Object.keys(p.plans),...p.meetings.map(m=>Core.weekStart(m.date)),...p.sales.map(s=>Core.weekStart(s.date))].sort();
      return el('div',{},el('p',{class:'intro-name'},`${p.employee.name} · ID ${p.employee.id}`),el('p',{},`Экспорт: ${displayInstant(snapshot.exportedAt)}`),el('p',{class:'small'},dates.length?`Недели: ${shortWeek(dates[0])} — ${shortWeek(dates.at(-1))}`:'Недельных записей нет'),el('p',{class:'small'},`Планы: ${Object.keys(p.plans).length} · Встречи: ${p.meetings.length} · Продажи: ${p.sales.length}`),el('dl',{},...PRODUCTS.map(product=>metric(`Ставка ${product.short}`,`${Core.plain(p.ratesBps[product.code])}%`))));
    }
    function importReview(snapshot,mode,base,revision) {
      const id=snapshot.planner.employee.id,old=mode==='manager'?state.importedEmployees[id]?.snapshot:null,previous=state.ownPlanner;
      activeForm={kind:'import-review',dirty:true,refreshBase:()=>{base=originalRaw;revision=state.revision;}};const shell=formShell(mode==='manager'?'Проверенные данные сотрудника':'Восстановление собственного профиля',submit);activeForm.shell=shell;
      appendNodes(shell.body,snapshotSummary(snapshot));
      if(old)appendNodes(shell.body,el('section',{class:'banner'},el('p',{},`Текущий снимок: ${displayInstant(old.exportedAt)}`),el('p',{},`Новый файл: ${displayInstant(snapshot.exportedAt)}`),old.planner.employee.name!==snapshot.planner.employee.name?el('p',{},`Имя: ${old.planner.employee.name} → ${snapshot.planner.employee.name}`):null,...PRODUCTS.filter(p=>old.planner.ratesBps[p.code]!==snapshot.planner.ratesBps[p.code]).map(p=>el('p',{},`Ставка ${p.short}: ${Core.plain(old.planner.ratesBps[p.code])}% → ${Core.plain(snapshot.planner.ratesBps[p.code])}%`)),el('p',{},'Замена целиком, без объединения записей.'),btn('Скачать прежний снимок',()=>{finishForm();prepareSnapshot(id);},'secondary')));
      if(mode==='employee')appendNodes(shell.body,el('p',{class:'banner'},previous && previous.employee.id!==id?`Будет заменён профиль ${previous.employee.id} на ${id}. Ставки и вся история будут заменены; коллекция руководителя сохранится.`:'Собственный профиль, ставки и вся история будут заменены. Коллекция руководителя сохранится.'),previous?btn('Сначала экспортировать текущий профиль',()=>{finishForm();prepareSnapshot();},'secondary'):null);
      const label=mode==='employee'?'Восстановить профиль':old?'Заменить снимок':'Добавить сотрудника';
      appendNodes(shell.footer,btn('Отмена',()=>{finishForm();render();},'ghost'),btn(label,null,'',{type:'submit',id:'confirm-import'}));
      async function submit() {
        if(state.revision!==revision || localStorage.getItem(KEYS.data)!==base){conflict=true;shell.fail('Данные изменились. Перечитайте их и проверьте файл заново.');return;}
        if(old && snapshot.exportedAt<old.exportedAt && !await ask('Этот файл старше текущего снимка','Более свежие сведения сотрудника будут заменены старым файлом.',{yes:'Заменить старым файлом'}))return;
        const op=beginImportCommit(shell,base,revision);
        try {
          await commit(next=>{if(mode==='manager')next.importedEmployees[id]={snapshot,importedAt:now()};else next.ownPlanner=structuredClone(snapshot.planner);},false,{ownChanged:mode==='employee',stampOwn:false,operation:op,signal:op.controller.signal});
          operation=null;
          if(mode==='employee'){
            preferences.ownBackup={employeeId:id,lastExportAt:null,hasChanges:true,snoozedUntil:null};Object.assign(preferences.ui,Core.initialPreferences(today()).ui,{mode:'employee',employeeSection:'overview'});
            try{const entries=readDrafts().filter(d=>d.employeeId!==previous?.employee.id && d.employeeId!==id);if(entries.length)sessionStorage.setItem(KEYS.drafts,JSON.stringify({schemaVersion:1,entries}));else sessionStorage.removeItem(KEYS.drafts);}catch{notify('Не удалось удалить прежние черновики.',true);}
          }else{preferences.ui.mode='manager';preferences.ui.managerSection='team';}
          savePreferences();finishForm();render();notify(mode==='manager'?'Снимок сотрудника сохранён.':'Профиль восстановлен.');
        }catch(error){if(operation===op){operation=null;shell.body.querySelector('.loading')?.remove();shell.footer.querySelector('[data-operation-cancel]')?.remove();shell.fail(error.message);} }
      }
    }
    function beginImportCommit(shell,base,revision) {
      const op={controller:new AbortController(),base,revision,shell};operation=op;
      appendNodes(shell.body,el('p',{class:'loading',role:'status'},'Подготовка данных…'));
      // Кнопка отмены остаётся доступной, пока Worker готовит окончательную строку.
      const cancel=btn('Отменить операцию',cancelOperation,'ghost',{'data-operation-cancel':'true'});appendNodes(shell.footer,cancel);return op;
    }
    function backupBanner() {
      const p=state.ownPlanner,b=preferences.ownBackup,instant=Date.now();
      const important=p && (p.meetings.length || p.sales.length || Object.values(p.plans).some(plan=>Object.values(plan.products).some(v=>v.volumeKopecks || v.incomeKopecks)) || Object.values(p.daySchedules).some(d=>d.blocks.some(v=>v.completedAt)));
      if(preferences.ui.mode!=='employee' || !important || !b.hasChanges || !backupNeedsRecovery && b.lastExportAt && instant-Date.parse(b.lastExportAt)<7*86400000 || b.snoozedUntil && Date.parse(b.snoozedUntil)>instant)return null;
      const snooze=()=>{b.snoozedUntil=new Date(Date.now()+86400000).toISOString();savePreferences();render();};
      return el('section',{class:'banner backup-banner','aria-label':'Резервная копия'},el('p',{},'Есть изменения без свежей резервной копии. Сохраните файл планировщика'),el('div',{class:'actions'},btn('Сделать копию',()=>prepareSnapshot(),'secondary'),btn('Напомнить завтра',snooze,'ghost'),btn('×',snooze,'ghost icon',{'aria-label':'Закрыть напоминание о копии'})));
    }
    async function deleteSnapshots(employeeId=null,quotaRecovery=false) {
      const ids=employeeId===null?Object.keys(state.importedEmployees):[employeeId];if(!ids.length)return;
      const count=ids.reduce((n,id)=>n+state.importedEmployees[id].snapshot.planner.sales.length+state.importedEmployees[id].snapshot.planner.meetings.length,0);
      if(!await ask(employeeId===null?'Очистить все снимки?':'Удалить снимок сотрудника?',`Снимков: ${ids.length}; встреч и продаж: ${count}. Собственный профиль сохраняется. При необходимости сначала скачайте снимок.`,{yes:'Удалить снимки',danger:true,word:employeeId===null?'УДАЛИТЬ':null,exportAction:employeeId?()=>prepareSnapshot(employeeId,quotaRecovery):null}))return;
      try{await commit(next=>{ids.forEach(id=>delete next.importedEmployees[id]);},false,{ownChanged:false,quotaRecovery});if(ids.includes(preferences.ui.selectedEmployeeId))preferences.ui.selectedEmployeeId=null;resetContextFilters();savePreferences();render();notify('Снимки удалены.');}catch(error){notify(error.message,true);}
    }
    function readOnly() { return preferences.ui.mode==='manager'; }
    function viewPlanner() { return readOnly()?state.importedEmployees[preferences.ui.selectedEmployeeId]?.snapshot.planner:state.ownPlanner; }
    function referenceDate() { return readOnly()?state.importedEmployees[preferences.ui.selectedEmployeeId]?.snapshot.asOfDate:today(); }
    function referenceTime() {const instant=readOnly()?new Date(state.importedEmployees[preferences.ui.selectedEmployeeId].snapshot.exportedAt):new Date();return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);}
    const STATUS = {planned:'Запланирована',completed:'Проведена',postponed:'Перенесена',cancelled:'Отменена'};
    const filters = {calendar:{product:'',status:'',client:''},sales:{product:'',client:'',scope:'week'}};
    let saleLimit = 50, attentionLimit = 5;
    const dayLimits=new Map();let presentationCache=null;
    function resetContextFilters(){
      Object.assign(filters.calendar,{product:'',status:'',client:''});Object.assign(filters.sales,{product:'',client:'',scope:'week'});
      managerSaleEmployee='';managerSaleSearch='';saleLimit=50;attentionLimit=5;dayLimits.clear();presentationCache=null;
    }
    function presentationData(){
      const planner=viewPlanner(),key=`${state.revision}:${preferences.ui.mode}:${planner.employee.id}:${referenceDate()}`;
      if(presentationCache?.key!==key)presentationCache={key,sold:Core.linkedSalesIndex(planner),days:new Map(),conflicts:new Map()};return presentationCache;
    }
    function presentationDay(date){const cache=presentationData();if(!cache.days.has(date))cache.days.set(date,Core.dayTiming(viewPlanner(),date));return cache.days.get(date);}
    const shortProduct = code => PRODUCTS.find(p => p.code === code).short;
    function selectField(label,id,choices,value,note='') {
      const f = field(label,{id},note,'select');
      appendNodes(f.input,...choices.map(([v,text]) => el('option',{value:v},text))); f.input.value = value; return f;
    }
    function moneyField(label,id,value) { return field(label,{id,value,inputmode:'decimal',autocomplete:'off'}); }
    async function pastDates(dates) {
      const weeks = [...new Set(dates.filter(Boolean).map(Core.weekStart))].filter(w => Core.addDays(w,4) < today());
      return !weeks.length || await ask('Изменить прошлые данные?',`Будут пересчитаны недели: ${weeks.map(shortWeek).join('; ')}.`,{yes:'Сохранить изменения'});
    }
    function completeEdit(message) {
      removeDraft(activeForm.week || activeForm.targetKey,false,activeForm.kind); finishForm(); render(); notify(message);
    }
    function trackForm(kind,targetKey,shell,getFields,draft) {
      activeForm = {kind,targetKey,shell,getFields,baseRevision:state.revision,dirty:!!draft};
      shell.body.addEventListener('input',dirty); shell.body.addEventListener('change',dirty);
      if (draft) dirty();
    }
    function suggestedTime(date) {
      const day = Core.dayTiming(state.ownPlanner,date);
      if (date === today()) {
        const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
        const minutes = Math.ceil((Number(time.slice(0,2))*60 + Number(time.slice(3)))/15)*15;
        const start = minutes >= 1440 ? '' : `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
        return start && start < day.workEnd ? (start < day.workStart ? day.workStart : start) : '';
      }
      return day.blocks.find(b => b.kind === 'meetings')?.start || day.workStart;
    }
    function endTime(start) {
      if (!Core.timeValid(start)) return '';
      const n = Number(start.slice(0,2))*60+Number(start.slice(3))+30;
      return n < 1440 ? `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}` : '';
    }
    function meetingEditor(id=null,draft=null) {
      const planner = state.ownPlanner, old = id ? planner.meetings.find(m => m.id === id) : null;
      if (id && !old) return notify('Встреча уже удалена.',true);
      const key = id || draft?._target || 'new';
      const dateValue = draft?.date ?? old?.date ?? preferences.ui.selectedDate;
      const startValue = draft?.start ?? old?.start ?? suggestedTime(dateValue);
      const shell = formShell(old ? 'Изменить встречу' : 'Новая встреча',submit);
      const date = field('Дата встречи',{id:'meeting-date',type:'date',value:dateValue,min:'2000-01-01',max:'2099-12-31'});
      const start = field('Начало',{id:'meeting-start',type:'time',value:startValue});
      const end = field('Окончание',{id:'meeting-end',type:'time',value:draft?.end ?? old?.end ?? endTime(startValue)});
      const linked = !!old && planner.sales.some(s => s.meetingId === old.id);
      const client = field('ID клиента',{id:'meeting-client',value:draft?.clientId ?? old?.clientId ?? '',maxlength:64,autocomplete:'off',readonly:linked},linked ? 'Есть связанные продажи. Для изменения ID сначала снимите связи в продажах.' : 'Текстовый ID, включая ведущие нули.');
      const status = selectField('Статус','meeting-status',Object.entries(STATUS),draft?.status ?? old?.status ?? (dateValue < today() ? 'completed' : 'planned'));
      const note = field('Заметки',{id:'meeting-note',value:draft?.note ?? old?.note ?? '',maxlength:2000,rows:4},'До 2000 символов.','textarea');
      const rows = [], list = el('div',{class:'meeting-products'}), totals = el('p',{class:'mode-note'}),itemsError=el('p',{class:'field-error',id:'meeting-items-error'});
      function updateExpected() {
        try {
          const amounts = rows.map(r => Core.scaled(r.amount.input.value,Core.MAX_AMOUNT,true)), incomes = rows.map((r,i) => Core.commission(amounts[i],planner.ratesBps[r.product.input.value]));
          rows.forEach((r,i) => r.income.textContent = `Доход: ${formatMoney(incomes[i])}`);
          totals.textContent = `Итого: ${formatMoney(Core.safeSum(amounts))} · доход ${formatMoney(Core.safeSum(incomes))}`;
        } catch { rows.forEach(r => r.income.textContent = 'Доход будет рассчитан после проверки сумм.'); totals.textContent = 'Проверьте ожидаемые суммы.'; }
      }
      function addItem(source={}) {
        if (rows.length >= 5) return;
        const rowId = source.id || Core.id();
        const bound = !!old && planner.sales.some(s => s.meetingId === old.id && s.meetingItemId === rowId);
        const product = selectField('Продукт',`item-${rowId}-product`,PRODUCTS.map(p => [p.code,p.short]),source.productCode || PRODUCTS.find(p => !rows.some(r => r.product.input.value === p.code))?.code || 'OPIF');
        product.input.disabled = bound;
        const amount = moneyField('Ожидаемая сумма, ₽',`item-${rowId}-amount`,source.amount ?? Core.plain(source.expectedKopecks ?? 0));
        const row = {id:rowId,product,amount,income:el('p',{class:'mode-note'})}; rows.push(row);
        const card = el('section',{class:'form-product'},el('div',{class:'form-row'},product.wrapper,amount.wrapper),row.income,bound ? el('p',{class:'small muted'},'Продукт связан с продажами; сумму ожидания можно изменить.') : null,btn('Убрать продукт',() => { rows.splice(rows.indexOf(row),1); card.remove(); updateExpected(); dirty(); },'ghost',{disabled:bound})); appendNodes(list,card);
        amount.input.addEventListener('input',updateExpected); product.input.addEventListener('change',updateExpected); updateExpected();
      }
      for (const source of draft?.items ?? old?.items ?? [{}]) addItem(source);
      appendNodes(shell.body,date.wrapper,el('div',{class:'form-row'},start.wrapper,end.wrapper),client.wrapper,status.wrapper,el('h3',{},'Продукты встречи'),list,itemsError,btn('Добавить продукт',() => { addItem(); dirty(); },'secondary',{id:'meeting-add-product'}),totals,note.wrapper);
      appendNodes(shell.footer,btn('Отмена',requestClose,'ghost'),btn('Сохранить встречу',null,'',{type:'submit',id:'save-meeting'}));
      const getFields = () => ({_target:key,date:date.input.value,start:start.input.value,end:end.input.value,clientId:client.input.value,status:status.input.value,note:note.input.value,items:rows.map(r => ({id:r.id,productCode:r.product.input.value,amount:r.amount.input.value}))});
      trackForm('meeting',key,shell,getFields,draft);
      let automaticEnd = !old && !draft;
      end.input.addEventListener('input',() => automaticEnd = false);
      start.input.addEventListener('change',() => { if (automaticEnd || !end.input.value) end.input.value = endTime(start.input.value); dirty(); });
      date.input.addEventListener('change',() => { if (!old && !draft) status.input.value = date.input.value < today() ? 'completed' : 'planned'; });
      date.input.focus();
      async function submit() {
        try {
          itemsError.textContent='';if(!rows.length){itemsError.textContent='Укажите от одного до пяти разных продуктов';shell.fail(itemsError.textContent);document.getElementById('meeting-add-product').focus();return;}
          if(!checkFields(shell,[[date,()=>workDateCheck(date,true)],...timeChecks(start,end),[client,()=>Core.identifier(client.input.value.trim(),'ID клиента')],[status,()=>{if(status.input.value==='completed' && date.input.value>today())throw new Error('Будущую встречу нельзя отметить проведённой');}],
            ...rows.flatMap(r=>[[r.amount,()=>Core.scaled(r.amount.input.value,Core.MAX_AMOUNT,true)],[r.product,()=>{if(rows.some(other=>other!==r && other.product.input.value===r.product.input.value))throw new Error('Укажите от одного до пяти разных продуктов');}]]),[note,()=>{if(note.input.value.length>2000)throw new Error('Не более 2000 символов');}]]))return;
          const raw = getFields(), input = {...raw,id:old?.id,items:raw.items.map(r => ({id:r.id,productCode:r.productCode,expectedKopecks:Core.scaled(r.amount,Core.MAX_AMOUNT,true)}))};
          const test = structuredClone(planner), candidate = Core.upsertMeeting(test,input,today(),now());
          const warnings = Core.meetingConflicts(test,candidate);
          if (warnings.length && !await ask('Пересечение в расписании',warnings.join('\n'),{yes:'Сохранить с пересечением'})) return;
          if (!await pastDates([old?.date,input.date])) return;
          await commit(next => Core.upsertMeeting(next.ownPlanner,input,today(),now())); completeEdit('Встреча сохранена.');
        } catch(error) { shell.fail(error.message); }
      }
    }
    function transferEditor(id,draft=null) {
      const meeting = state.ownPlanner.meetings.find(m => m.id === id); if (!meeting) return;
      const shell = formShell('Перенести встречу',submit);
      const mode = selectField('Вариант переноса','transfer-mode',[['dated','На другую дату'],['undated','Без новой даты']],draft?.mode || 'dated');
      const date = field('Новая дата',{id:'transfer-date',type:'date',value:draft?.date ?? meeting.date,min:'2000-01-01',max:'2099-12-31'});
      const start = field('Начало',{id:'transfer-start',type:'time',value:draft?.start ?? meeting.start});
      const end = field('Окончание',{id:'transfer-end',type:'time',value:draft?.end ?? meeting.end});
      appendNodes(shell.body,el('p',{class:'muted'},'Встреча сохраняет ID и связанные продажи. Без даты она исключается из календаря и прогноза.'),mode.wrapper,date.wrapper,el('div',{class:'form-row'},start.wrapper,end.wrapper));
      const update = () => { date.input.disabled = start.input.disabled = end.input.disabled = mode.input.value === 'undated'; }; update(); mode.input.addEventListener('change',update);
      appendNodes(shell.footer,btn('Отмена',requestClose,'ghost'),btn('Сохранить перенос',null,'',{type:'submit'}));
      trackForm('meeting',id,shell,() => ({_view:'transfer',mode:mode.input.value,date:date.input.value,start:start.input.value,end:end.input.value}),draft);
      async function submit() {
        try {
          const dated = mode.input.value === 'dated';
          if(dated && !checkFields(shell,[[date,()=>workDateCheck(date,true)],...timeChecks(start,end)]))return;
          const input = {...meeting,date:dated ? date.input.value : meeting.date,start:dated ? start.input.value : meeting.start,end:dated ? end.input.value : meeting.end,status:dated ? 'planned' : 'postponed',recordTransfer:true};
          const test = structuredClone(state.ownPlanner), candidate = Core.upsertMeeting(test,input,today(),now());
          const warnings = Core.meetingConflicts(test,candidate);
          if (warnings.length && !await ask('Пересечение в расписании',warnings.join('\n'),{yes:'Сохранить с пересечением'})) return;
          if (!await pastDates([meeting.date,input.date])) return;
          await commit(next => Core.upsertMeeting(next.ownPlanner,input,today(),now())); completeEdit('Встреча перенесена.');
        } catch(error) { shell.fail(error.message); }
      }
    }
    function meetingDetails(id,offerSale=false) {
      const meeting = viewPlanner().meetings.find(m => m.id === id); if (!meeting) return;
      activeForm = {kind:'details',dirty:false}; const shell = formShell('Встреча с клиентом',finishForm);activeForm.shell=shell;
      if(readOnly())appendNodes(shell.body,snapshotBanner());
      appendNodes(shell.body,el('p',{class:'intro-name'},`ID ${meeting.clientId}`),el('p',{},`${displayDate(meeting.date)} · ${meeting.status === 'postponed' ? 'прежний интервал: ' : ''}${meeting.start}–${meeting.end}`),el('span',{class:`badge status-${meeting.status}`},STATUS[meeting.status]),el('dl',{},...meeting.items.flatMap(item => [metric(`${shortProduct(item.productCode)} · ожидание`,formatMoney(item.expectedKopecks)),metric('Ожидаемый доход',formatMoney(Core.commission(item.expectedKopecks,viewPlanner().ratesBps[item.productCode]))),metric('Остаток ожидания',formatMoney(Core.remaining(viewPlanner(),meeting,item)))])),meeting.note ? el('p',{class:'note-text'},meeting.note) : null);
      if (offerSale) appendNodes(shell.body,el('p',{class:'banner'},'Встреча проведена. Фактическая продажа появится только после отдельной записи.'));
      if(!readOnly()) for (const item of meeting.items) appendNodes(shell.body,btn(`Записать продажу ${shortProduct(item.productCode)}`,() => saleEditor(null,null,{meeting,item}),'secondary'));
      const sales = viewPlanner().sales.filter(s => s.meetingId === id);
      if (sales.length) appendNodes(shell.body,el('h3',{},'Связанные продажи'),...sales.map(s => btn(`${displayDate(s.date)} · ${shortProduct(s.productCode)} · ${formatMoney(s.amountKopecks)}`,() => readOnly() ? saleDetails(s,viewPlanner()) : saleEditor(s.id),'ghost')));
      if (meeting.transferHistory.length) appendNodes(shell.body,el('details',{class:'details'},el('summary',{},'История переносов'),...meeting.transferHistory.map(h => el('p',{class:'small'},`${displayDate(h.fromDate)} ${h.fromStart}–${h.fromEnd} → ${h.toDate ? `${displayDate(h.toDate)} ${h.toStart}–${h.toEnd}` : 'без новой даты'}`))));
      if(!readOnly()) appendNodes(shell.body,el('div',{class:'actions',style:'margin-top:16px'},btn('Изменить встречу',() => meetingEditor(id),'secondary'),meeting.status !== 'completed' ? btn('Провести встречу',() => updateStatus('completed'),'',{disabled:meeting.date > today()}) : null,meeting.status !== 'cancelled' ? btn('Отменить встречу',() => updateStatus('cancelled'),'ghost') : null,btn(['completed','cancelled'].includes(meeting.status) ? 'Запланировать снова' : 'Перенести встречу',() => transferEditor(id),'ghost'),btn('Удалить встречу',remove,'danger')));
      appendNodes(shell.footer,btn(offerSale ? 'Готово' : 'Закрыть',finishForm,'ghost'));
      async function updateStatus(status) {
        try {
          if (status === 'cancelled' && !await ask('Отменить встречу?','Встреча останется в истории, но не войдёт в прогноз.')) return;
          if (!await pastDates([meeting.date])) return;
          await commit(next => Core.upsertMeeting(next.ownPlanner,{...meeting,status},today(),now())); render(); meetingDetails(id,status === 'completed');
        } catch(error) { shell.fail(error.message); }
      }
      async function remove() {
        if (!await ask('Удалить встречу?',`Связанные продажи (${sales.length}) сохранятся. Их ссылки на встречу будут сняты.`,{yes:'Удалить',danger:true}) || !await pastDates([meeting.date])) return;
        try { await commit(next => Core.deleteMeeting(next.ownPlanner,id,now())); finishForm(); render(); notify('Встреча удалена. Продажи сохранены.'); } catch(error) { shell.fail(error.message); }
      }
    }
    function saleEditor(id=null,draft=null,source=null) {
      const planner = state.ownPlanner, old = id ? planner.sales.find(s => s.id === id) : null;
      if (id && !old) return notify('Продажа уже удалена.',true);
      const key = id || draft?._target || 'new';
      const selected = preferences.ui.selectedDate, fallback = Core.weekday(today()) > 5 ? Core.addDays(today(),5-Core.weekday(today())) : Core.weekday(today()) === 0 ? Core.addDays(today(),-2) : today();
      const shell = formShell(old ? 'Изменить продажу' : 'Новая продажа',submit);
      const date = field('Дата продажи',{id:'sale-date',type:'date',value:draft?.date ?? old?.date ?? (selected <= today() ? selected : fallback),min:'2000-01-01',max:today()});
      const client = field('ID клиента',{id:'sale-client',value:draft?.clientId ?? old?.clientId ?? source?.meeting.clientId ?? '',maxlength:64,autocomplete:'off'});
      const product = selectField('Продукт','sale-product',PRODUCTS.map(p => [p.code,p.short]),draft?.productCode ?? old?.productCode ?? source?.item.productCode ?? 'OPIF');
      const amount = moneyField('Сумма продажи, ₽','sale-amount',draft?.amount ?? (old ? Core.plain(old.amountKopecks) : source ? Core.plain(Core.remaining(planner,source.meeting,source.item)) : ''));
      const initialLink = draft?.link ?? (old?.meetingId ? JSON.stringify([old.meetingId,old.meetingItemId]) : source ? JSON.stringify([source.meeting.id,source.item.id]) : '');
      const link = selectField('Связь со встречей','sale-link',[],'','Связь выбирается явно. Совпадение ID и продукта само по себе её не создаёт.');
      const income = el('p',{class:'mode-note'});
      function links(wanted=link.input.value) {
        const options = [['','Без связи со встречей']];
        for (const m of planner.meetings.filter(m => m.clientId === client.input.value.trim())) for (const item of m.items.filter(i => i.productCode === product.input.value)) options.push([JSON.stringify([m.id,item.id]),`${displayDate(m.date)} ${m.start} · ${shortProduct(item.productCode)} · остаток ${formatMoney(Core.remaining(planner,m,item))}`]);
        if (wanted && !options.some(([v]) => v === wanted)) options.push([wanted,'Прежняя связь несовместима — будет снята после подтверждения']);
        link.input.replaceChildren(...options.map(([value,text]) => el('option',{value},text))); link.input.value = wanted;
      }
      function updateIncome() { try { income.textContent = `Комиссионный доход: ${formatMoney(Core.commission(Core.scaled(amount.input.value,Core.MAX_AMOUNT,true),planner.ratesBps[product.input.value]))}`; } catch { income.textContent = 'Введите сумму продажи.'; } }
      links(initialLink); updateIncome();
      client.input.addEventListener('input',() => links()); product.input.addEventListener('change',() => { links(); updateIncome(); }); amount.input.addEventListener('input',updateIncome);
      appendNodes(shell.body,date.wrapper,client.wrapper,product.wrapper,amount.wrapper,income,link.wrapper);
      appendNodes(shell.footer,old ? btn('Удалить продажу',remove,'danger') : btn('Отмена',requestClose,'ghost'),btn('Сохранить продажу',null,'',{type:'submit',id:'save-sale'}));
      const getFields = () => ({_target:key,date:date.input.value,clientId:client.input.value,productCode:product.input.value,amount:amount.input.value,link:link.input.value});
      trackForm('sale',key,shell,getFields,draft); client.input.focus();
      async function submit() {
        try {
          if(!checkFields(shell,[[date,()=>workDateCheck(date)],[client,()=>Core.identifier(client.input.value.trim(),'ID клиента')],[product,()=>{if(!Core.CODES.includes(product.input.value))throw new Error('Выберите продукт');}],[amount,()=>Core.money(Core.scaled(amount.input.value,Core.MAX_AMOUNT),'Продажа',true)]]))return;
          const raw = getFields(), pair = raw.link ? JSON.parse(raw.link) : [null,null];
          let [meetingId,meetingItemId] = pair;
          const bound = planner.meetings.find(m => m.id === meetingId), item = bound?.items.find(i => i.id === meetingItemId);
          const incompatible = meetingId && (!bound || !item || bound.clientId !== raw.clientId.trim() || item.productCode !== raw.productCode);
          if (incompatible || old?.meetingId && !meetingId) {
            if (!await ask('Снять связь со встречей?','Изменение сохранит фактическую продажу отдельно и пересчитает остаток ожидания встречи.',{yes:'Снять связь и сохранить'})) return;
            meetingId = meetingItemId = null;
          }
          const input = {...raw,id:old?.id,amountKopecks:Core.scaled(raw.amount,Core.MAX_AMOUNT),meetingId,meetingItemId};
          Core.upsertSale(structuredClone(planner),input,today(),now());
          if (planner.sales.some(s => s.id !== old?.id && s.date === input.date && s.clientId === input.clientId.trim() && s.productCode === input.productCode && s.amountKopecks === input.amountKopecks) && !await ask('Возможный дубль продажи','Уже есть продажа с той же датой, ID, продуктом и суммой.',{yes:'Сохранить ещё одну'})) return;
          if (!await pastDates([old?.date,input.date])) return;
          await commit(next => Core.upsertSale(next.ownPlanner,input,today(),now()),Core.weekStart(input.date) === Core.weekStart(today())); completeEdit('Продажа сохранена.');
        } catch(error) { shell.fail(error.message); }
      }
      async function remove() {
        if (!await ask('Удалить продажу?','Факт уменьшится, а остаток связанной встречи будет пересчитан.',{yes:'Удалить',danger:true}) || !await pastDates([old.date])) return;
        try { await commit(next => Core.deleteSale(next.ownPlanner,old.id)); completeEdit('Продажа удалена.'); } catch(error) { shell.fail(error.message); }
      }
    }
    function timingEditor(date=null,draft=null) {
      const planner = state.ownPlanner, effective = Core.nextWorkDate(today()), target = date || effective;
      const latest = planner.templateVersions.filter(v => v.effectiveFrom <= effective).sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
      const shell = formShell(date ? 'Тайминг дня' : 'Шаблон рабочей недели',submit), groups = {};
      appendNodes(shell.body,el('p',{class:'muted small'},date ? `${displayDate(date)}. Индивидуальный день не изменяется будущими шаблонами.` : `Новая версия действует с ${displayDate(effective)}. Исторический тайминг сохраняется.`));
      for (const [key,label] of date ? [['day',displayDate(date)]] : [['mon','Понедельник'],['tue','Вторник'],['wed','Среда'],['thu','Четверг'],['fri','Пятница']]) {
        const source = draft?.[key] ?? (date ? Core.dayTiming(planner,date) : latest?.weekdays[key]) ?? {workStart:'09:00',workEnd:'18:00',blocks:[]};
        const group = el('details',{class:'timing-group',open:!!date || key === 'mon'},el('summary',{},label));
        const workStart = field('Начало дня',{id:`timing-${key}-start`,type:'time',value:source.workStart});
        const workEnd = field('Конец дня',{id:`timing-${key}-end`,type:'time',value:source.workEnd});
        const list = el('div'), rows = []; groups[key] = {workStart,workEnd,rows};
        function addBlock(source={}) {
          const row = {id:source.id || Core.id(),completedAt:source.completedAt ?? null};
          row.title = field('Название действия',{id:`block-${row.id}-title`,value:source.title ?? '',maxlength:100});
          row.kind = selectField('Тип блока',`block-${row.id}-kind`,[['activity','Действие'],['meetings','Встречи']],source.kind ?? 'activity');
          row.start = field('Начало',{id:`block-${row.id}-start`,type:'time',value:source.start ?? ''});
          row.end = field('Окончание',{id:`block-${row.id}-end`,type:'time',value:source.end ?? ''});
          const card = el('section',{class:'form-product'},row.title.wrapper,row.kind.wrapper,el('div',{class:'form-row'},row.start.wrapper,row.end.wrapper),btn('Удалить блок',async () => {
            if (row.completedAt && !await ask('Удалить выполненное действие?','Отметка выполнения будет удалена вместе с блоком.',{yes:'Удалить блок'})) return;
            rows.splice(rows.indexOf(row),1); card.remove(); dirty();
          },'ghost')); rows.push(row); appendNodes(list,card);
        }
        source.blocks.forEach(addBlock); appendNodes(group,el('div',{class:'form-row'},workStart.wrapper,workEnd.wrapper),list,btn('Добавить блок',() => { addBlock(); dirty(); },'secondary')); appendNodes(shell.body,group);
      }
      const getFields = () => Object.fromEntries(Object.entries(groups).map(([key,g]) => [key,{workStart:g.workStart.input.value,workEnd:g.workEnd.input.value,blocks:g.rows.map(r => ({id:r.id,title:r.title.input.value,kind:r.kind.input.value,start:r.start.input.value,end:r.end.input.value,completedAt:r.completedAt}))}]));
      trackForm(date ? 'day' : 'template',target,shell,getFields,draft);
      appendNodes(shell.footer,btn('Отмена',requestClose,'ghost'),btn('Сохранить тайминг',null,'',{type:'submit',id:'save-timing'}));
      if (date && planner.daySchedules[date]) appendNodes(shell.body,btn('Вернуться к шаблону',async () => {
        if (!await ask('Вернуться к шаблону?','Индивидуальные изменения и отметки этого дня будут удалены.',{yes:'Вернуться к шаблону',danger:true}) || !await pastDates([date])) return;
        try { await commit(next => { delete next.ownPlanner.daySchedules[date]; }); completeEdit('День возвращён к шаблону.'); } catch(error) { shell.fail(error.message); }
      },'danger'));
      async function submit() {
        try {
          const checks=[];
          for(const g of Object.values(groups)){
            checks.push(...timeChecks(g.workStart,g.workEnd));
            for(const r of g.rows)checks.push([r.title,()=>{if(!r.title.input.value.trim() || r.title.input.value.length>100)throw new Error('Введите название длиной от 1 до 100 символов');}],...timeChecks(r.start,r.end),[r.start,()=>{if(r.start.input.value<g.workStart.input.value)throw new Error('Блок выходит за рабочие часы');}],[r.end,()=>{if(r.end.input.value>g.workEnd.input.value)throw new Error('Блок выходит за рабочие часы');}]);
            const sorted=[...g.rows].sort((a,b)=>a.start.input.value.localeCompare(b.start.input.value));
            for(let i=1;i<sorted.length;i++)checks.push([sorted[i].start,()=>{if(sorted[i].start.input.value<sorted[i-1].end.input.value)throw new Error('Блоки тайминга пересекаются');}]);
          }
          if(!checkFields(shell,checks))return;
          const fields = getFields();
          const apply = own => date ? Core.saveDay(own,date,fields.day,today(),now()) : Core.saveTemplate(own,fields,today(),now());
          apply(structuredClone(planner));
          if (date && !await pastDates([date])) return;
          if (!date && planner.templateVersions.some(v => v.effectiveFrom === effective) && !await ask('Заменить будущий шаблон?',`Уже есть версия с ${displayDate(effective)}. Более ранние версии сохранятся.`,{yes:'Заменить версию'})) return;
          await commit(next => apply(next.ownPlanner)); completeEdit('Тайминг сохранён.');
        } catch(error) { shell.fail(error.message); }
      }
    }
    async function markBlock(date,id) {
      try {
        if (!await pastDates([date])) return;
        await commit(next => Core.toggleBlock(next.ownPlanner,date,id,today(),now())); render();
      } catch(error) { notify(error.message,true); }
    }
    const awardQueue = [];
    function showAward(products=[]) {
      awardQueue.push(...products); if (document.querySelector('.award') || !awardQueue.length) return;
      const product = awardQueue.shift();
      const award = el('div',{class:'award',role:'status'},el('strong',{},`Цель достигнута — ${product}`),el('span',{},'100% объёма и дохода'),...Array.from({length:6},(_,i) => el('i',{class:'award-spark',style:`--i:${i}`,'aria-hidden':'true'})));
      appendNodes(document.body,award); setTimeout(() => { award.remove(); showAward(); },1950);
    }
    function editName() {
      activeForm = {kind:'name',dirty:false}; const f = field('Имя сотрудника',{id:'new-name',value:state.ownPlanner.employee.name,maxlength:100,autocomplete:'name'});
      const shell = formShell('Изменить имя',async () => {
        const value = f.input.value.trim(); f.setError('');
        if (!value || value.length > 100) { f.setError('Введите имя длиной от 1 до 100 символов');shell.fail('Проверьте имя сотрудника.'); f.input.focus(); return; }
        try { await commit(next => { next.ownPlanner.employee.name = value; next.ownPlanner.employee.updatedAt = now(); }); finishForm(); render(); notify('Имя сохранено.'); } catch(error) { shell.fail(error.message); }
      });
      activeForm.shell = shell;
      appendNodes(shell.body,f.wrapper); appendNodes(shell.footer,btn('Отмена',requestClose,'ghost'),btn('Сохранить имя',null,'',{type:'submit'})); f.input.addEventListener('input',dirty); f.input.focus();
    }
    async function clearOwn() {
      const p = state.ownPlanner;
      if (!p || !await ask('Очистить собственный профиль?',`Будут удалены профиль ${p.employee.id}, планы (${Object.keys(p.plans).length}), встречи (${p.meetings.length}) и продажи (${p.sales.length}). Снимки руководителя сохранятся.`,{yes:'Удалить профиль',danger:true,word:'УДАЛИТЬ',exportAction:()=>prepareSnapshot()})) return;
      try {
        await commit(next => { next.ownPlanner = null; });
        try { const entries = readDrafts().filter(d => d.employeeId !== p.employee.id); if (entries.length) sessionStorage.setItem(KEYS.drafts,JSON.stringify({schemaVersion:1,entries})); else sessionStorage.removeItem(KEYS.drafts); } catch { notify('Не удалось очистить черновики.',true); }
        preferences.ownBackup = {employeeId:null,lastExportAt:null,hasChanges:true,snoozedUntil:null}; preferences.ui.employeeSection = 'overview'; savePreferences(); render(); notify('Собственный профиль удалён.');
      } catch(error) { notify(error.message,true); }
    }
    async function reloadData() { flushDraft(); if (editor.open) finishForm();if(editor.open){flushDraft();finishForm();} await load(); notify('Данные перечитаны.'); }
    function renderConflict() {
      if (!conflict) return;
      const message = el('div',{class:'banner',id:'conflict-banner'},el('p',{},'Данные изменены в другой вкладке. Старая форма не будет сохранена поверх новых данных.'),btn('Перечитать данные',reloadData,'secondary'));
      const previous = document.getElementById('conflict-banner');
      if (previous) previous.replaceWith(message); else app.querySelector('.container')?.prepend(message);
      if (activeForm?.shell) activeForm.shell.error.replaceChildren(el('p',{},'Данные изменены в другой вкладке.'),btn('Перечитать данные',reloadData,'secondary'));
    }
    function changeWeek(week) {
      if (!Core.weekValid(week)) { notify('Выберите неделю в диапазоне 2000–2099 годов.',true); return; }
      preferences.ui.weekKey = week; preferences.ui.selectedDate = week; savePreferences(); render();
    }
    function header() {
      const select = el('select',{class:'role-select','aria-label':'Режим работы',onchange:event => { preferences.ui.mode = event.target.value; resetContextFilters();savePreferences(); render(); if (preferences.ui.mode === 'employee' && !state.ownPlanner && !fatal) profileForm(); }},el('option',{value:'employee'},'Сотрудник'),el('option',{value:'manager'},'Руководитель')); select.value = preferences.ui.mode;
      return el('header',{class:'topbar'},el('div',{class:'topbar-inner'},el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},'ИСП'),el('div',{},el('div',{class:'brand-name'},'Планировщик продаж'),el('div',{class:'brand-note'},'Недельный ритм · Инвестиционные продукты'))),select));
    }
    function weekBar() {
      const week = preferences.ui.weekKey;
      const picker = el('input',{type:'date',class:'date-control',value:week,min:'2000-01-01',max:'2099-12-31','aria-label':'Перейти к дате',onchange:event => { if (!Core.supportedDate(event.target.value)) { notify('Дата должна быть в диапазоне 2000–2099 годов.',true); event.target.value = week; return; } changeWeek(Core.weekStart(event.target.value)); }});
      return el('section',{class:'weekbar','aria-label':'Выбор недели'},el('div',{class:'week-controls'},btn('‹',() => changeWeek(Core.addDays(week,-7)),'ghost icon',{'aria-label':'Предыдущая неделя',disabled:!Core.weekValid(Core.addDays(week,-7))}),el('span',{class:'week-range'},shortWeek(week)),btn('›',() => changeWeek(Core.addDays(week,7)),'ghost icon',{'aria-label':'Следующая неделя',disabled:!Core.weekValid(Core.addDays(week,7))})),el('div',{class:'actions'},btn('Текущая неделя',() => { const current = Core.initialPreferences(today()); preferences.ui.selectedDate = current.ui.selectedDate; preferences.ui.weekKey = current.ui.weekKey; savePreferences(); render(); },'ghost'),picker));
    }
    function navigation() {
      const manager = preferences.ui.mode === 'manager';
      const sections = manager ? [['team','◫','Команда'],['employee','▦','Сотрудник'],['sales','↗','Продажи'],['settings','⚙','Настройки']] : [['overview','◫','Обзор'],['calendar','▦','Календарь'],['sales','↗','Продажи'],['settings','⚙','Настройки']];
      const current = manager ? preferences.ui.managerSection : preferences.ui.employeeSection;
      return el('nav',{class:'nav','aria-label':'Основные разделы'},el('div',{class:'nav-inner'},...sections.map(([key,symbol,label]) => el('button',{type:'button','aria-current':current === key ? 'page' : null,onclick:() => { if (manager) preferences.ui.managerSection = key; else preferences.ui.employeeSection = key; savePreferences(); render(); }},el('span',{class:'nav-symbol','aria-hidden':'true'},symbol),label))));
    }
    function empty(title,message,symbol='○') { return el('section',{class:'card empty'},el('div',{class:'empty-icon','aria-hidden':'true'},symbol),el('h2',{},title),el('p',{class:'muted'},message)); }
    function welcome() {
      return el('div',{class:'welcome'},el('section',{class:'card'},el('p',{class:'eyebrow'},'Каждая неделя — понятная цель'),el('h1',{},'Ваш план. Ваш результат.'),el('p',{class:'muted'},'Планируйте объём продаж и комиссионный доход по пяти инвестиционным продуктам.'),el('div',{class:'actions'},btn('Я сотрудник',() => { preferences.ui.mode = 'employee'; savePreferences(); profileForm(); }),btn('Я руководитель',() => { preferences.ui.mode = 'manager'; savePreferences(); render(); },'secondary'),btn('Восстановить JSON',()=>chooseSnapshot('employee'),'ghost')),el('p',{class:'small muted',style:'margin-top:20px;margin-bottom:0'},'Данные сохраняются в этом браузере.')));
    }
    function metric(label,value) { return el('div',{class:'metric-row'},el('dt',{},label),el('dd',{},value)); }
    function plannedMoney(data,key,plain=false) { return data.plan ? (plain ? Core.plain(data[key])+' ₽' : formatMoney(data[key])) : 'План не задан'; }
    function moneyButton(value,label) { return btn(formatMoney(value),() => ask(label,formatMoney(value),{yes:'Понятно',no:'Закрыть'}),'value',{'aria-label':`${label}: ${formatMoney(value)}`}); }
    function percent(value) { return value === null ? 'План не задан' : `${value.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%`; }
    function overview() {
      const planner = viewPlanner(), totals = Core.weekMetrics(planner,preferences.ui.weekKey,referenceDate());
      const hero = (label,data,kind) => el('section',{class:`card hero${kind === 'income' ? ' alt' : ''}`,'data-total':kind},el('p',{class:'eyebrow'},label),moneyButton(data.forecast,label),el('p',{class:'muted small'},totals.completed ? 'Итог недели' : 'Факт + остатки запланированных встреч'),el('dl',{},metric('План',formatMoney(data.plan)),metric('Факт',formatMoney(data.fact)),metric('Выполнение',percent(data.percent))));
      const cards = PRODUCTS.map(p => {
        const data = totals.products[p.code];
        const progress = (label,m) => el('div',{class:'progress-item'},el('div',{class:'progress-label'},label,el('span',{},percent(m.percent))),el('div',{class:'progress-track',role:'progressbar','aria-label':`${p.short}: ${label}`,'aria-valuemin':'0','aria-valuemax':'100','aria-valuenow':String(Math.min(m.percent || 0,100)),'aria-valuetext':percent(m.percent)},el('div',{class:'progress-fill',style:`width:${Math.min(m.percent || 0,100)}%`})),el('p',{class:'small muted'},`Прогноз выполнения: ${percent(m.forecastPercent)}`));
        const details = kind => {
          const m = data[kind], suffix = kind === 'volume' ? 'объёма' : 'дохода';
          return [metric(`До плана ${suffix}`,m.plan ? formatMoney(m.remaining) : 'План не задан'),metric(`Прогнозный дефицит ${suffix}`,m.plan ? formatMoney(m.deficit) : 'План не задан'),metric(`Перевыполнение ${suffix}`,m.plan ? formatMoney(m.over) : 'План не задан'),metric(`Прогнозное превышение ${suffix}`,m.plan ? formatMoney(m.expectedOver) : 'План не задан')];
        };
        return el('article',{class:`card${data.goal ? ' goal-card' : ''}`,'data-product':p.code},el('div',{class:'product-head'},el('h3',{},p.short),el('span',{class:'badge'},`${Core.plain(planner.ratesBps[p.code])}%`)),data.goal ? el('p',{class:'goal-badge'},'✓ Цель достигнута') : null,el('p',{class:'product-name'},p.name),el('div',{class:'product-forecast'},el('div',{},el('span',{},totals.completed ? 'Итог объёма' : 'Прогноз объёма'),el('strong',{'data-value':'volume-forecast'},formatMoney(data.volume.forecast))),el('div',{},el('span',{},totals.completed ? 'Итог дохода' : 'Прогноз дохода'),el('strong',{'data-value':'income-forecast'},formatMoney(data.income.forecast)))),el('dl',{},metric('План объёма',formatMoney(data.volume.plan)),metric('План дохода',formatMoney(data.income.plan)),metric('Факт объёма / дохода',`${formatMoney(data.volume.fact)} / ${formatMoney(data.income.fact)}`)),progress('Объём',data.volume),progress('Доход',data.income),el('details',{class:'details'},el('summary',{},'Остаток и дефицит'),el('dl',{},...details('volume'),...details('income'))));
      });
      const fragment = document.createDocumentFragment();
      appendNodes(fragment,el('div',{class:'grid hero-grid'},hero(totals.completed ? 'Итог объёма' : 'Прогноз объёма',totals.volume,'volume'),hero(totals.completed ? 'Итог дохода' : 'Прогноз дохода',totals.income,'income')),el('div',{class:'section-heading'},el('h2',{},'Планы по продуктам')),el('p',{class:'muted small'},`План объёма задан: ${PRODUCTS.filter(p => totals.products[p.code].volume.plan > 0).length} из 5 · Дохода: ${PRODUCTS.filter(p => totals.products[p.code].income.plan > 0).length} из 5 · Целей достигнуто: ${PRODUCTS.filter(p => totals.products[p.code].goal).length} из ${PRODUCTS.filter(p => totals.products[p.code].volume.plan > 0 && totals.products[p.code].income.plan > 0).length}`),el('div',{class:'grid product-grid'},cards),el('section',{class:'card',style:'margin-top:16px'},el('h3',{},'Сумма дефицитов по продуктам'),el('p',{class:'small muted'},'Перевыполнение одного продукта не закрывает дефицит другого.'),el('dl',{},metric('До плана объёма',plannedMoney(totals.volume,'remaining')),metric('До плана дохода',plannedMoney(totals.income,'remaining')),metric('Дефицит прогноза объёма',plannedMoney(totals.volume,'deficit')),metric('Дефицит прогноза дохода',plannedMoney(totals.income,'deficit')))));
      const current = preferences.ui.weekKey === Core.weekStart(referenceDate()), time = referenceTime();
      const nearest = planner.meetings.filter(m => m.status === 'planned' && Core.weekStart(m.date) === preferences.ui.weekKey && (!current || m.date > referenceDate() || m.date === referenceDate() && m.start >= time)).sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))[0];
      appendNodes(fragment,el('div',{class:'section-heading'},el('h2',{},'Рабочий день')),dayAgenda(preferences.ui.selectedDate),el('div',{class:'section-heading'},el('h2',{},current ? (readOnly() ? 'Ближайшая на дату экспорта' : 'Ближайшая встреча') : 'Первая встреча выбранной недели')),nearest ? meetingCard(nearest) : el('p',{class:'muted'},current ? 'Предстоящих встреч на этой неделе нет.' : 'Запланированных встреч нет.'),readOnly() ? null : el('div',{class:'quick-actions'},btn('Добавить встречу',() => meetingEditor()),btn('Добавить продажу',() => saleEditor(),'secondary'),btn('Изменить план',() => planEditor(),'ghost',{id:'edit-plan'})),attention()); return fragment;
    }
    function matchesMeeting(m) {
      const f = filters.calendar;
      return (!f.product || m.items.some(i => i.productCode === f.product)) && (!f.status || m.status === f.status) && m.clientId.toLocaleLowerCase('ru').includes(f.client.trim().toLocaleLowerCase('ru'));
    }
    function meetingCard(m) {
      const cache=presentationData(),initial = Core.safeSum(m.items.map(i => i.expectedKopecks)), left = Core.safeSum(m.items.map(i => Core.remaining(viewPlanner(),m,i,cache.sold))), income = Core.safeSum(m.items.map(i => Core.commission(i.expectedKopecks,viewPlanner().ratesBps[i.productCode])));
      const day = presentationDay(m.date), target = day.blocks.find(b => b.kind === 'meetings' && b.start <= m.start && b.end >= m.end);
      if(!cache.conflicts.has(m.id))cache.conflicts.set(m.id,Core.meetingConflicts(viewPlanner(),m).length>0);
      const conflicts = cache.conflicts.get(m.id);
      return el('button',{type:'button',class:`meeting-card status-${m.status}${target && m.status !== 'postponed' ? ' within-block' : ''}`,'data-meeting':m.id,onclick:() => meetingDetails(m.id)},el('span',{class:'meeting-top'},el('strong',{},`${m.status === 'postponed' ? 'Прежде ' : ''}${m.start}–${m.end} · ID ${m.clientId}`),el('span',{class:'badge'},STATUS[m.status])),el('span',{class:'small'},`${displayDate(m.date)} · ${m.items.map(i => shortProduct(i.productCode)).join(', ')}`),el('span',{class:'small'},`Ожидание ${formatMoney(initial)} · доход ${formatMoney(income)}`),el('span',{class:'small'},`Остаток ${formatMoney(left)}`),target && m.status !== 'postponed' ? el('span',{class:'small muted'},`Блок: ${target.title}`) : null,conflicts ? el('span',{class:'conflict-label small'},'⚠ Пересечение расписания') : null,m.transferHistory.length ? el('span',{class:'small muted'},'Есть переносы') : null,m.note ? el('span',{class:'small muted'},'▤ Есть заметка') : null);
    }
    function attention(filtered=false) {
      const fragment = document.createDocumentFragment();
      for (const [kind,label,predicate] of [['overdue','Требуют обновления — просроченные встречи',m => m.status === 'planned' && m.date < referenceDate()],['postponed','Нужно перепланировать — перенесены без даты',m => m.status === 'postponed']]) {
        const all = viewPlanner().meetings.filter(predicate), meetings = all.filter(m => !filtered || matchesMeeting(m)).sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
        if (!all.length) continue;
        appendNodes(fragment,el('section',{class:'card attention',style:'margin-top:16px','data-attention':kind},el('h3',{},`${label} · ${meetings.length}${filtered ? ` / ${all.length}` : ''}`),el('p',{class:'small muted'},'Эти ожидания не входят в прогноз. Назначьте новую дату или обновите статус.'),...meetings.slice(0,attentionLimit).map(meetingCard),meetings.length > attentionLimit ? btn('Показать все встречи',() => { attentionLimit = Number.MAX_SAFE_INTEGER; render(); },'ghost') : null));
      } return fragment;
    }
    function dayAgenda(date,filtered=false) {
      const day = presentationDay(date), all = viewPlanner().meetings.filter(m => m.date === date && m.status !== 'postponed'), meetings = all.filter(m => !filtered || matchesMeeting(m)).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
      const limit=dayLimits.get(date) ?? 50;
      const entries = [...day.blocks.map(b => ({start:b.start,block:b})),...meetings.slice(0,limit).map(m => ({start:m.start,meeting:m}))].sort((a,b) => a.start.localeCompare(b.start) || (a.block ? -1 : 1));
      const active = all.filter(m => ['planned','completed'].includes(m.status)), start = [day.workStart,...active.map(m => m.start)].sort()[0], end = [day.workEnd,...active.map(m => m.end)].sort().at(-1);
      return el('section',{class:'card agenda','data-day':date,tabindex:'-1'},el('div',{class:'section-heading'},el('h3',{},displayDate(date)),readOnly() ? null : btn(day.blocks.length ? 'Изменить день' : 'Добавить тайминг',() => timingEditor(date),'ghost',{'aria-label':`Изменить тайминг ${date}`})),el('p',{class:'small muted'},`${start}–${end} · Действия: ${day.blocks.filter(b => b.completedAt).length} из ${day.blocks.length}${filtered ? ` · Встречи: ${meetings.length} / ${all.length}` : ''}`),!day.blocks.length ? el('p',{class:'muted'},'Тайминг не задан.') : null,...entries.map(entry => entry.meeting ? meetingCard(entry.meeting) : el('div',{class:`time-block${entry.block.completedAt ? ' is-done' : ''}`},el('time',{},`${entry.block.start}–${entry.block.end}`),el('div',{},el('strong',{},entry.block.title),el('p',{class:'small muted'},entry.block.kind === 'meetings' ? 'Блок встреч' : 'Действие')),readOnly() ? el('span',{class:'completion-label'},entry.block.completedAt ? '✓ Выполнено' : 'Не выполнено') : btn(entry.block.completedAt ? '✓' : '○',() => markBlock(date,entry.block.id),'ghost icon',{'aria-label':`${entry.block.completedAt ? 'Снять отметку' : 'Выполнить'}: ${entry.block.title}`,'aria-pressed':!!entry.block.completedAt,disabled:date > referenceDate()}))),meetings.length>limit ? btn('Показать ещё 50 встреч',()=>{dayLimits.set(date,limit+50);render();document.getElementById(`more-meetings-${date}`)?.focus();},'secondary',{id:`more-meetings-${date}`}) : null,el('p',{class:'small muted'},`Показано встреч: ${Math.min(limit,meetings.length)} из ${meetings.length}`),!meetings.length ? el('p',{class:'muted small'},all.length && filtered ? 'По выбранным фильтрам ничего не найдено' : 'Встреч на этот день нет.') : null,readOnly() ? null : btn('Добавить встречу в этот день',() => { preferences.ui.selectedDate=date; savePreferences(); meetingEditor(); },'secondary',{'aria-label':`Добавить встречу ${date}`}));
    }
    function keepInput(id) {
      const input = document.getElementById(id), position = input?.selectionStart;
      render(); const next = document.getElementById(id); next?.focus(); if (typeof position === 'number') next.setSelectionRange(position,position);
    }
    function filterBar(kind) {
      const f = filters[kind], product = selectField('Продукт',`${kind}-filter-product`,[['','Все продукты'],...PRODUCTS.map(p => [p.code,p.short])],f.product);
      const client = field('Поиск по ID клиента',{id:`${kind}-filter-client`,value:f.client,autocomplete:'off'});
      const fields = [product,client];
      if (kind === 'calendar') fields.push(selectField('Статус','calendar-filter-status',[['','Все статусы'],...Object.entries(STATUS)],f.status));
      else fields.push(selectField('Период','sales-filter-scope',[['week','Выбранная неделя'],['all','Все недели']],f.scope));
      product.input.addEventListener('change',() => { f.product = product.input.value; saleLimit=50;dayLimits.clear(); render(); });
      client.input.addEventListener('input',() => { f.client = client.input.value; saleLimit=50;dayLimits.clear(); keepInput(client.input.id); });
      fields[2].input.addEventListener('change',() => { f[kind === 'calendar' ? 'status' : 'scope'] = fields[2].input.value; saleLimit=50;dayLimits.clear(); render(); });
      return el('section',{class:'card filters'},el('div',{class:'filter-fields'},...fields.map(v => v.wrapper)),btn('Сбросить фильтры',() => { f.product=f.client=''; if (kind === 'calendar') f.status=''; else {f.scope='week';managerSaleEmployee='';} managerSaleSearch='';dayLimits.clear();saleLimit=50; render(); },'ghost'),el('p',{class:'small muted'},'Фильтры не меняют финансовые показатели'));
    }
    function calendar() {
      const week = preferences.ui.weekKey, view = preferences.ui.calendarView;
      const days = el('div',{class:'calendar-days'},...['Пн','Вт','Ср','Чт','Пт'].map((label,i) => {
        const date = Core.addDays(week,i), count = viewPlanner().meetings.filter(m => m.date === date && ['planned','completed'].includes(m.status)).length;
        return el('button',{type:'button','aria-label':`${label}, ${displayDate(date)}`,'aria-pressed':preferences.ui.selectedDate === date,disabled:!Core.supportedDate(date),onclick:() => { preferences.ui.selectedDate=date; savePreferences(); render(); }},label,el('strong',{},date.slice(8)),el('span',{class:'small'},`${count} встреч`));
      }));
      return el('div',{},readOnly() ? null : el('div',{class:'quick-actions'},btn('Добавить встречу',() => meetingEditor()),btn('Добавить продажу',() => saleEditor(),'secondary')),filterBar('calendar'),el('div',{class:'view-controls'},...[['day','День'],['week','Неделя']].map(([key,label]) => btn(label,() => { preferences.ui.calendarView=key; savePreferences(); render(); },'ghost',{'aria-pressed':view===key}))),days,...(view === 'day' ? [preferences.ui.selectedDate] : Array.from({length:5},(_,i) => Core.addDays(week,i)).filter(Core.workDate)).map(date => dayAgenda(date,true)),attention(true));
    }
    function salesList() {
      const f=filters.sales, all=viewPlanner().sales.filter(s => f.scope === 'all' || Core.weekStart(s.date) === preferences.ui.weekKey);
      const sales=all.filter(s => (!f.product || s.productCode===f.product) && s.clientId.toLocaleLowerCase('ru').includes(f.client.trim().toLocaleLowerCase('ru'))).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      return el('div',{},readOnly() ? null : el('div',{class:'quick-actions'},btn('Добавить продажу',() => saleEditor())),filterBar('sales'),csvSalesButton(sales.map(sale=>({planner:viewPlanner(),sale,asOfDate:referenceDate()}))),el('p',{class:'small muted'},`Найдено: ${sales.length} из ${all.length} · Показано: ${Math.min(saleLimit,sales.length)}`),!sales.length ? empty(all.length?'По выбранным фильтрам ничего не найдено':'Продаж пока нет',all.length?'Сбросьте или измените фильтры.':'Запишите продажу.','↗') : el('div',{class:'sales-list'},...sales.slice(0,saleLimit).map(s => el('button',{type:'button',class:'sale-card','data-sale':s.id,onclick:() => readOnly() ? saleDetails(s,viewPlanner()) : saleEditor(s.id)},el('div',{class:'meeting-top'},el('strong',{},`ID ${s.clientId} · ${shortProduct(s.productCode)}`),el('strong',{},formatMoney(s.amountKopecks))),el('span',{class:'small'},displayDate(s.date)),el('span',{class:'small muted'},`Доход ${formatMoney(Core.commission(s.amountKopecks,viewPlanner().ratesBps[s.productCode]))} · ставка ${Core.plain(viewPlanner().ratesBps[s.productCode])}%`),el('span',{class:'small muted'},s.meetingId ? 'Связана со встречей' : 'Без связи со встречей')))),sales.length>saleLimit ? btn('Показать ещё 50',() => { saleLimit+=50; render(); },'secondary') : null);
    }
    function selectedRecords() { return Object.fromEntries(Object.entries(state.importedEmployees).filter(([id])=>teamSelection===null || teamSelection.has(id))); }
    function monthBar() {
      const month=preferences.ui.managerMonth;
      const shift=delta=>{const d=new Date(`${month}-15T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta);const next=d.toISOString().slice(0,7);if(Core.monthValid(next)){preferences.ui.managerMonth=next;savePreferences();render();}};
      const input=field('Месяц сводки',{id:'manager-month',type:'month',value:month,min:'2000-01',max:'2099-12'});input.input.addEventListener('change',()=>{if(Core.monthValid(input.input.value)){preferences.ui.managerMonth=input.input.value;savePreferences();render();}else input.input.value=month;});
      return el('section',{class:'card month-bar'},el('div',{class:'actions'},btn('‹',()=>shift(-1),'ghost icon',{'aria-label':'Предыдущий месяц',disabled:month==='2000-01'}),input.wrapper,btn('›',()=>shift(1),'ghost icon',{'aria-label':'Следующий месяц',disabled:month==='2099-12'}),btn('Текущий месяц',()=>{preferences.ui.managerMonth=today().slice(0,7);savePreferences();render();},'ghost')));
    }
    function teamData() {
      const records=selectedRecords(),mode=preferences.ui.managerPeriodMode,period=mode==='month'?preferences.ui.managerMonth:preferences.ui.weekKey;
      const key=JSON.stringify([state.revision,mode,period,Object.keys(records).sort()]);
      if(teamCache?.key===key)return teamCache;
      if(teamRequest?.key!==key) {
        teamRequest?.controller.abort();const request={key,controller:new AbortController()};teamRequest=request;
        background.run('team',{records,mode,period},request.controller.signal).then(result=>{if(teamRequest===request){teamCache={key,data:result.data};teamRequest=null;render();}}).catch(error=>{if(teamRequest===request && error.name!=='AbortError'){teamCache={key,error:error.message};teamRequest=null;render();}});
      }
      return {pending:true};
    }
    function periodSwitcher() {
      return el('div',{class:'view-controls'},...[['week','Неделя'],['month','Месяц']].map(([key,label])=>btn(label,()=>{preferences.ui.managerPeriodMode=key;savePreferences();render();},'ghost',{'aria-pressed':preferences.ui.managerPeriodMode===key})));
    }
    function employeeSelector() {
      const records=Object.entries(state.importedEmployees), selected=Object.keys(selectedRecords());
      const picker=el('details',{class:'card employee-picker',open:employeePickerOpen,ontoggle:event=>employeePickerOpen=event.target.open},el('summary',{},`Состав сводки: ${selected.length} из ${records.length} сотрудников`),btn('Все сотрудники',()=>{teamSelection=null;render();},'secondary'));
      for(const [id,record] of records.sort((a,b)=>a[1].snapshot.planner.employee.name.localeCompare(b[1].snapshot.planner.employee.name,'ru') || a[0].localeCompare(b[0],'ru'))) {
        const checkbox=el('input',{type:'checkbox',checked:selected.includes(id),'data-select-employee':id,onchange:event=>{if(teamSelection===null)teamSelection=new Set(Object.keys(state.importedEmployees));if(event.target.checked)teamSelection.add(id);else teamSelection.delete(id);render();[...document.querySelectorAll('[data-select-employee]')].find(n=>n.dataset.selectEmployee===id)?.focus();}});
        // checked — свойство, чтобы состояние чекбокса оставалось булевым.
        checkbox.checked=selected.includes(id);appendNodes(picker,el('label',{class:'employee-choice'},checkbox,`${record.snapshot.planner.employee.name} · ID ${id}`));
      }return picker;
    }
    function financialSummary(label,data,kind) {
      return el('section',{class:`card hero${kind==='income'?' alt':''}`,'data-team-total':kind},el('p',{class:'eyebrow'},label),moneyButton(data.forecast,label),el('dl',{},metric('План',formatMoney(data.plan)),metric('Факт',formatMoney(data.fact)),metric('Выполнение',percent(data.percent)),metric('Прогноз выполнения',percent(data.forecastPercent)),metric('До плана',plannedMoney(data,'remaining')),metric('Дефицит прогноза',plannedMoney(data,'deficit')),metric('Перевыполнение',plannedMoney(data,'over')),metric('Прогнозное превышение',plannedMoney(data,'expectedOver'))));
    }
    function teamView() {
      const panel=el('div',{class:'team-view'},periodSwitcher(),preferences.ui.managerPeriodMode==='month'?monthBar():null,btn('Импортировать сотрудника',()=>chooseSnapshot('manager'),'secondary'));
      if(!Object.keys(state.importedEmployees).length){appendNodes(panel,empty('Снимков сотрудников пока нет','Импортируйте JSON или текстовый JSON-файл от сотрудника.'));return panel;}
      appendNodes(panel,employeeSelector());const cache=teamData();
      if(cache.pending){appendNodes(panel,el('p',{class:'loading',role:'status'},'Подготовка данных…'));return panel;}
      if(cache.error){appendNodes(panel,el('p',{class:'error-message'},cache.error),btn('Повторить расчёт',()=>{teamCache=null;render();},'secondary'));return panel;}
      const data=cache.data,records=selectedRecords(),monthly=preferences.ui.managerPeriodMode==='month',exports=Object.values(records).map(r=>r.snapshot.exportedAt).sort();
      appendNodes(panel,reportActions(true));
      appendNodes(panel,el('div',{class:'grid hero-grid'},financialSummary('Сумма прогнозов объёма из снимков',data.volume,'volume'),financialSummary('Сумма прогнозов дохода из снимков',data.income,'income')),el('p',{class:'small muted'},exports.length?`Экспорты: ${displayInstant(exports[0])} — ${displayInstant(exports.at(-1))}. Свежесть данных может различаться.`:'Сотрудники не выбраны.'),el('p',{class:'small muted'},`Без плана: ${data.withoutPlan} · Сумма дефицитов сотрудников: ${formatMoney(data.volume.deficit)} объёма / ${formatMoney(data.income.deficit)} дохода`));
      if(monthly)appendNodes(panel,el('section',{class:'banner'},el('p',{},'План месяца рассчитан из недельных планов'),el('p',{},`Планы сотрудников: ${data.coverage.filled} из ${data.coverage.total} недельных записей`),el('details',{},el('summary',{},'Как распределяется план'),el('p',{class:'small'},'Каждая сумма делится на пять рабочих дней. Остаток копеек добавляется по одной в первые дни недели с понедельника. В месяц входят только доли его рабочих дней; пограничная неделя не удваивается. Дефициты считаются по месяцу отдельно для каждого продукта и сотрудника.'))));
      appendNodes(panel,el('div',{class:'grid product-grid'},...PRODUCTS.map(p=>{
        const row=data.products[p.code];return el('section',{class:'card','data-team-product':p.code},el('h3',{},p.short),el('p',{class:'product-name'},p.name),...['volume','income'].map(kind=>el('div',{class:'team-product-metric'},el('h4',{},kind==='volume'?'Объём':'Доход'),el('dl',{},metric('План',row[kind].plan?formatMoney(row[kind].plan):'План не задан'),metric('Факт',formatMoney(row[kind].fact)),metric('Прогноз',formatMoney(row[kind].forecast)),metric('Выполнение',percent(row[kind].percent)),metric('Прогноз выполнения',percent(row[kind].forecastPercent)),metric('Остаток',plannedMoney(row[kind],'remaining')),metric('Дефицит',row[kind].plan?plannedMoney(row[kind],'deficit'):'План не задан'),metric('Перевыполнение',row[kind].plan?plannedMoney(row[kind],'over'):'План не задан'),metric('Прогнозное превышение',row[kind].plan?plannedMoney(row[kind],'expectedOver'):'План не задан')))));
      })));
      const search=field('Поиск сотрудника',{id:'team-search',value:teamSearch,autocomplete:'off'},'Имя или ID. Поиск не меняет состав сводки.');search.input.addEventListener('input',()=>{teamSearch=search.input.value;keepInput('team-search');});
      const sort=selectField('Сортировка','team-sort',[['name','Имя'],['volumeDeficit','Дефицит объёма'],['incomeDeficit','Дефицит дохода'],['volumePercent','Выполнение объёма'],['incomePercent','Выполнение дохода'],['exportedAt','Дата экспорта']],teamSort);sort.input.addEventListener('change',()=>{teamSort=sort.input.value;render();});
      appendNodes(panel,el('section',{class:'card filters'},el('div',{class:'filter-fields'},search.wrapper,sort.wrapper,btn(teamDirection==='desc'?'По убыванию':'По возрастанию',()=>{teamDirection=teamDirection==='desc'?'asc':'desc';render();},'ghost',{id:'team-direction'}))));
      const list=Object.keys(records).filter(id=>`${records[id].snapshot.planner.employee.name} ${id}`.toLocaleLowerCase('ru').includes(teamSearch.trim().toLocaleLowerCase('ru')));
      const sortValue=id=>teamSort==='name'?records[id].snapshot.planner.employee.name:teamSort==='exportedAt'?records[id].snapshot.exportedAt:teamSort==='volumeDeficit'?data.employees[id].volume.deficit:teamSort==='incomeDeficit'?data.employees[id].income.deficit:teamSort==='volumePercent'?data.employees[id].volume.percent:data.employees[id].income.percent;
      list.sort((a,b)=>{const av=sortValue(a),bv=sortValue(b);if(av===null && bv!==null)return 1;if(bv===null && av!==null)return -1;const compared=av===null?0:typeof av==='number'?av-bv:av.localeCompare(bv,'ru');return (teamDirection==='desc'?-compared:compared) || records[a].snapshot.planner.employee.name.localeCompare(records[b].snapshot.planner.employee.name,'ru') || a.localeCompare(b,'ru');});
      appendNodes(panel,el('div',{class:'section-heading'},el('h2',{},`Сотрудники · ${list.length}`)),...list.map(id=>employeeCard(id,data.employees[id],monthly)),!list.length?el('p',{class:'muted'},'По выбранным фильтрам ничего не найдено'):null);return panel;
    }
    function employeeCard(id,data,monthly) {
      const record=state.importedEmployees[id],employee=record.snapshot.planner.employee;
      return el('section',{class:'card employee-card','data-employee':id},el('div',{class:'section-heading'},el('h3',{},employee.name),el('span',{class:'badge'},`ID ${id}`)),el('p',{class:'small muted'},`Экспорт: ${displayInstant(record.snapshot.exportedAt)} · Импорт: ${displayInstant(record.importedAt)}`),el('div',{class:'grid'},...['volume','income'].map(kind=>el('div',{},el('h4',{},kind==='volume'?'Объём':'Доход'),el('dl',{},metric('План',formatMoney(data[kind].plan)),metric('Факт',formatMoney(data[kind].fact)),metric(data.completed?monthly?'Итог месяца':'Итог недели':'Прогноз',formatMoney(data[kind].forecast)),metric('Выполнение',percent(data[kind].percent)),metric('Дефицит прогноза',data[kind].plan?plannedMoney(data[kind],'deficit'):'План не задан'))))),el('p',{class:'small'},`Недельных целей достигнуто: ${monthly?data.goals:PRODUCTS.filter(p=>data.products[p.code].goal).length}`),monthly?el('p',{class:'small'},data.coverage.filled<data.coverage.total?`План месяца неполный: заполнено ${data.coverage.filled} из ${data.coverage.total} недель`:`План месяца: ${data.coverage.filled} из ${data.coverage.total} недель`):null,el('div',{class:'actions'},btn('Открыть планировщик',()=>openEmployee(id),'secondary'),btn('Скачать снимок',()=>prepareSnapshot(id),'ghost'),btn('Поделиться снимком',()=>prepareSnapshot(id),'ghost'),btn('Удалить снимок',()=>deleteSnapshots(id),'danger')));
    }
    function openEmployee(id) {
      const record=state.importedEmployees[id];if(!record)return;
      if(preferences.ui.selectedEmployeeId!==id)resetContextFilters();
      preferences.ui.selectedEmployeeId=id;preferences.ui.managerSection='employee';employeeView='overview';preparedFile=null;
      if(preferences.ui.managerPeriodMode==='month'){
        const period=Core.monthDates(preferences.ui.managerMonth),date=record.snapshot.asOfDate.slice(0,7)===preferences.ui.managerMonth?Core.initialPreferences(record.snapshot.asOfDate).ui.selectedDate:period.dates[0];preferences.ui.weekKey=Core.weekStart(date);preferences.ui.selectedDate=date;
      }
      savePreferences();render();
    }
    function snapshotBanner(id=preferences.ui.selectedEmployeeId) {
      const snapshot=state.importedEmployees[id]?.snapshot;if(!snapshot)return null;
      const age=Math.max(0,Math.round((Date.parse(`${today()}T12:00:00Z`)-Date.parse(`${snapshot.asOfDate}T12:00:00Z`))/86400000));
      return el('section',{class:'snapshot-info'},el('strong',{},`Данные на ${displayInstant(snapshot.exportedAt)}`),el('span',{class:'small'},`Возраст снимка: ${age} календарных дней. Расчёт на дату экспорта.`));
    }
    function employeeViewPanel() {
      const options=Object.entries(state.importedEmployees).map(([id,r])=>[id,`${r.snapshot.planner.employee.name} · ${id}`]);
      const picker=selectField('Сотрудник для просмотра','view-employee',[['','Выберите сотрудника'],...options],preferences.ui.selectedEmployeeId || '');picker.input.addEventListener('change',()=>openEmployee(picker.input.value));
      const panel=el('div',{class:'readonly'},picker.wrapper);const p=viewPlanner();if(!p){appendNodes(panel,empty('Выберите сотрудника','Полученные снимки доступны только для просмотра.'));return panel;}
      appendNodes(panel,snapshotBanner(),el('p',{class:'identity'},`${p.employee.name} · ID ${p.employee.id} · Неделя ${weekLabel(preferences.ui.weekKey)}`),reportActions(false),el('div',{class:'view-controls employee-tabs'},...[['overview','Обзор'],['calendar','Календарь'],['sales','Продажи'],['plan','План'],['timing','Тайминг']].map(([key,label])=>btn(label,()=>{employeeView=key;render();},'ghost',{'aria-pressed':employeeView===key}))));
      if(employeeView==='overview')appendNodes(panel,overview());else if(employeeView==='calendar')appendNodes(panel,calendar());else if(employeeView==='sales')appendNodes(panel,salesList());else if(employeeView==='timing')appendNodes(panel,...Array.from({length:5},(_,i)=>Core.addDays(preferences.ui.weekKey,i)).filter(Core.workDate).map(d=>dayAgenda(d)));else{
        const plans=p.plans[preferences.ui.weekKey]?.products || Core.emptyPlan();appendNodes(panel,el('div',{class:'grid product-grid'},...PRODUCTS.map(product=>el('section',{class:'card'},el('h3',{},product.short),el('dl',{},metric('План объёма',formatMoney(plans[product.code].volumeKopecks)),metric('План дохода',formatMoney(plans[product.code].incomeKopecks)),metric('Режим дохода',plans[product.code].incomeMode==='auto'?'По ставке':'Вручную'),metric('Ставка',`${Core.plain(p.ratesBps[product.code])}%`))))));
      }return panel;
    }
    function saleDetails(s,planner,snapshotId=planner.employee.id) {
      activeForm={kind:'sale-details',dirty:false};const shell=formShell('Продажа из снимка',finishForm);activeForm.shell=shell;
      appendNodes(shell.body,snapshotBanner(snapshotId),el('p',{},`${planner.employee.name} · ID ${planner.employee.id}`),el('dl',{},metric('Дата',displayDate(s.date)),metric('ID клиента',s.clientId),metric('Продукт',shortProduct(s.productCode)),metric('Объём',formatMoney(s.amountKopecks)),metric('Доход',formatMoney(Core.commission(s.amountKopecks,planner.ratesBps[s.productCode]))),metric('Связь со встречей',s.meetingId || 'Нет')));appendNodes(shell.footer,btn('Закрыть',finishForm,'ghost'));
    }
    let managerSaleEmployee='',managerSaleSearch='';
    function teamSales() {
      const records=selectedRecords();if(managerSaleEmployee && !Object.hasOwn(records,managerSaleEmployee))managerSaleEmployee='';
      const search=field('Поиск сотрудника по имени или ID',{id:'sales-employee-search',type:'search',value:managerSaleSearch,autocomplete:'off'},'Поиск меняет список выбора. Продажи фильтруются после выбора сотрудника.');
      search.input.addEventListener('input',()=>{managerSaleSearch=search.input.value;keepInput(search.input.id);});
      const options=Object.entries(records).filter(([id,r])=>id===managerSaleEmployee || `${r.snapshot.planner.employee.name} ${id}`.toLocaleLowerCase('ru').includes(managerSaleSearch.trim().toLocaleLowerCase('ru')));
      const chooser=selectField('Сотрудник','sales-filter-employee',[['','Все сотрудники'],...options.map(([id,r])=>[id,`${r.snapshot.planner.employee.name} · ${id}`])],managerSaleEmployee);
      chooser.input.addEventListener('change',()=>{managerSaleEmployee=chooser.input.value;saleLimit=50;render();});
      const f=filters.sales,entries=Object.entries(records).flatMap(([id,r])=>r.snapshot.planner.sales.map(s=>({id,record:r,sale:s}))).filter(e=>(!managerSaleEmployee || e.id===managerSaleEmployee) && (f.scope==='all' || Core.weekStart(e.sale.date)===preferences.ui.weekKey));
      const found=entries.filter(e=>(!f.product || e.sale.productCode===f.product) && e.sale.clientId.toLocaleLowerCase('ru').includes(f.client.trim().toLocaleLowerCase('ru'))).sort((a,b)=>b.sale.date.localeCompare(a.sale.date) || b.sale.createdAt.localeCompare(a.sale.createdAt));
      const panel=el('div',{class:'readonly'},search.wrapper,chooser.wrapper,filterBar('sales'),csvSalesButton(found.map(e=>({planner:e.record.snapshot.planner,sale:e.sale,asOfDate:e.record.snapshot.asOfDate}))),el('p',{class:'small muted'},`Найдено: ${found.length} из ${entries.length} · Показано: ${Math.min(saleLimit,found.length)}`));
      appendNodes(panel,...found.slice(0,saleLimit).map(e=>el('button',{type:'button',class:'sale-card','data-manager-sale':e.sale.id,onclick:()=>saleDetails(e.sale,e.record.snapshot.planner,e.id)},el('strong',{},`${e.record.snapshot.planner.employee.name} · ID ${e.id}`),el('span',{},`${displayDate(e.sale.date)} · ID клиента ${e.sale.clientId} · ${shortProduct(e.sale.productCode)}`),el('span',{},`${formatMoney(e.sale.amountKopecks)} · доход ${formatMoney(Core.commission(e.sale.amountKopecks,e.record.snapshot.planner.ratesBps[e.sale.productCode]))}`),el('span',{class:'small muted'},e.sale.meetingId?'Связана со встречей':'Без связи со встречей'),el('span',{class:'small muted'},`Данные на ${displayInstant(e.record.snapshot.exportedAt)}`))),found.length>saleLimit?btn('Показать ещё 50',()=>{saleLimit+=50;render();},'secondary'):null,!found.length?empty(entries.length?'По выбранным фильтрам ничего не найдено':'Продаж для просмотра пока нет',entries.length?'Сбросьте или измените фильтры.':'Импортируйте снимки или измените период.'):null);return panel;
    }
    function csvSalesButton(entries) {
      return el('div',{class:'actions report-actions'},btn(`CSV продаж · ${entries.length} записей`,()=>{
        if(!entries.length)return notify('Нет продаж для выгрузки');
        const compact=entries.map(e=>({...e,planner:{employee:e.planner.employee,ratesBps:e.planner.ratesBps}}));
        exportCsv({kind:'sales',entries:compact},`isp-sales_${today()}.csv`);
      },'secondary',{id:'export-sales-csv'}));
    }
    function reportContexts(team) {
      if(team)return Object.values(selectedRecords()).map(r=>r.snapshot);
      const planner=viewPlanner();return planner?[{planner,asOfDate:referenceDate(),exportedAt:readOnly()?state.importedEmployees[planner.employee.id].snapshot.exportedAt:''}]:[];
    }
    function reportActions(team) {
      return el('div',{class:'actions report-actions'},btn('CSV сводки',()=>{
        const contexts=reportContexts(team);if(!contexts.length)return notify('Сотрудники для выгрузки не выбраны');
        const mode=team?preferences.ui.managerPeriodMode:'week',period=mode==='month'?preferences.ui.managerMonth:preferences.ui.weekKey;
        exportCsv({kind:'summary',contexts,mode,period},mode==='month'?`isp-month_${period}.csv`:`isp-week_${period}.csv`);
      },'secondary',{id:'export-summary-csv'}),btn(team?'Печатать период':'Печатать неделю',()=>printReport(team),'ghost',{id:'print-period'}));
    }
    async function exportCsv(value,name) {
      const op=beginOperation('Подготовка CSV');if(!op)return;
      try {
        const result=await background.run('csv',value,op.controller.signal);checkOperation(op);
        downloadFile(new File([result.raw],name,{type:'text/csv;charset=utf-8'}));
        operation=null;finishForm();
        notify(`Скачивание CSV инициировано. Записей: ${result.count}. CSV не заменяет резервную копию JSON.`);
      }catch(error){operationError(op,error);}
    }
    function printTable(title,headers,rows) {
      return el('section',{class:'report-section'},el('h2',{},title),rows.length?el('table',{'aria-label':title,class:rows.length<=10?'compact-report-table':''},el('thead',{},el('tr',{},...headers.map(h=>el('th',{scope:'col'},h)))),el('tbody',{},...rows.map(row=>el('tr',{},...row.map(value=>el('td',{},value)))))):el('p',{},'Нет записей.'));
    }
    function printFinancial(products) {
      const money=value=>`${Core.plain(value)} ₽`;
      return ['volume','income'].flatMap(kind=>{
        const label=kind==='volume'?'Объём продаж':'Комиссионный доход';
        return [printTable(label,['Продукт','План','Факт','Прогноз','Выполнение'],PRODUCTS.map(p=>{const m=products[p.code][kind];return [p.short,money(m.plan),money(m.fact),money(m.forecast),percent(m.percent)];})),
          printTable(`${label}: остатки и превышение`,['Продукт','До плана','Дефицит прогноза','Перевыполнение','Прогнозное превышение'],PRODUCTS.map(p=>{const m=products[p.code][kind];return [p.short,...['remaining','deficit','over','expectedOver'].map(k=>plannedMoney(m,k,true))];}))];
      });
    }
    function reportHeader(title,range) {
      return [el('h1',{},title),el('p',{},`Период: ${range}`),el('p',{},`Сформировано: ${displayInstant(now())} (Москва)`),el('p',{class:'report-caption'},'ИСП · Планировщик продаж. Суммы указаны до копейки.')];
    }
    function employeeReport(context,week) {
      const {planner:p,asOfDate,exportedAt}=context,totals=Core.weekMetrics(p,week,asOfDate),dates=Array.from({length:5},(_,i)=>Core.addDays(week,i));
      const node=el('article',{'data-report-kind':'employee'},...reportHeader('Недельный отчёт сотрудника',weekLabel(week)),el('p',{},`${p.employee.name} · ID ${p.employee.id}`),el('p',{},`Опорная дата: ${asOfDate}${exportedAt?` · Экспорт снимка: ${displayInstant(exportedAt)} · Расчёт на дату экспорта`:''}`),el('p',{},totals.completed?'Завершённая неделя: прогноз равен факту.':'Прогноз: факт и остатки запланированных встреч.'),...printFinancial(totals.products),
        printTable('Недельные цели',['Продукт','Цель достигнута'],PRODUCTS.map(pr=>[pr.short,totals.products[pr.code].goal?'Да':'Нет'])));
      const meetings=p.meetings.filter(m=>dates.includes(m.date)).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
      appendNodes(node,printTable('Встречи недели',['Дата / время','ID клиента','Статус','Продукт','Ожидаемый объём / доход'],meetings.flatMap(m=>m.items.map(item=>[`${m.date} ${m.start}–${m.end}`,m.clientId,STATUS[m.status],shortProduct(item.productCode),`${Core.plain(item.expectedKopecks)} ₽ / ${Core.plain(Core.commission(item.expectedKopecks,p.ratesBps[item.productCode]))} ₽`]))));
      const sales=p.sales.filter(s=>dates.includes(s.date)).sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));
      appendNodes(node,printTable('Продажи недели',['Дата','ID клиента','Продукт','Объём','Доход'],sales.map(s=>[s.date,s.clientId,shortProduct(s.productCode),`${Core.plain(s.amountKopecks)} ₽`,`${Core.plain(Core.commission(s.amountKopecks,p.ratesBps[s.productCode]))} ₽`])));
      for(const date of dates.filter(Core.workDate)){
        const day=Core.dayTiming(p,date);
        appendNodes(node,printTable(`Тайминг ${displayDate(date)} · ${day.workStart}–${day.workEnd}`,['Время','Действие','Тип','Выполнение'],day.blocks.map(b=>[`${b.start}–${b.end}`,b.title,b.kind==='meetings'?'Блок встреч':'Действие',b.completedAt?'Выполнено':'Не выполнено'])));
      }return node;
    }
    function teamReport(records,data,mode,period) {
      const range=mode==='month'?Core.monthDates(period):{start:period,end:Core.addDays(period,4)};
      const node=el('article',{'data-report-kind':'team'},...reportHeader(`Отчёт команды · ${mode==='month'?'Месяц':'Неделя'}`,`${range.start} — ${range.end}`),el('p',{},'Данные получены из снимков. У каждого сотрудника своя опорная дата и фиксированная ставка. Дефициты суммируются без компенсации между сотрудниками и продуктами.'),el('p',{},`Сотрудников: ${Object.keys(records).length} · Без плана: ${data.withoutPlan}`));
      if(mode==='month')appendNodes(node,el('p',{},`План месяца рассчитан из недельных планов. Каждая сумма распределяется по пяти рабочим дням; остаток копеек добавляется с понедельника. В месяц входят доли его рабочих дней. Покрытие: ${data.coverage.filled}/${data.coverage.total} записей сотрудник–неделя; отсутствующие планы не подставляются.`));
      appendNodes(node,printTable('Общие показатели',['Показатель','План','Факт','Прогноз','Выполнение'],['volume','income'].map(k=>[k==='volume'?'Объём':'Доход',...['plan','fact','forecast'].map(f=>`${Core.plain(data[k][f])} ₽`),percent(data[k].percent)])),...printFinancial(data.products));
      appendNodes(node,printTable('Общие остатки и превышение',['Показатель','До плана','Дефицит прогноза','Перевыполнение','Прогнозное превышение'],['volume','income'].map(k=>[k==='volume'?'Объём':'Доход',...['remaining','deficit','over','expectedOver'].map(f=>plannedMoney(data[k],f,true))])));
      const ids=Object.keys(records).sort((a,b)=>records[a].snapshot.planner.employee.name.localeCompare(records[b].snapshot.planner.employee.name,'ru')||a.localeCompare(b,'ru'));
      appendNodes(node,printTable('Даты снимков выбранных сотрудников',['Имя / ID','Опорная дата','Экспорт (Москва)','Покрытие плана'],ids.map(id=>[`${records[id].snapshot.planner.employee.name} · ${id}`,records[id].snapshot.asOfDate,displayInstant(records[id].snapshot.exportedAt),mode==='month'?`${data.employees[id].coverage.filled}/${data.employees[id].coverage.total}`:'Неделя'])));
      for(const kind of ['volume','income']){
        appendNodes(node,printTable(`Сравнение сотрудников: ${kind==='volume'?'объём':'доход'}`,['Имя / ID','План','Факт','Прогноз','Выполнение'],ids.map(id=>{const m=data.employees[id][kind];return [`${records[id].snapshot.planner.employee.name} · ${id}`,...['plan','fact','forecast'].map(k=>`${Core.plain(m[k])} ₽`),percent(m.percent)];})),printTable(`Дефициты сотрудников: ${kind==='volume'?'объём':'доход'}`,['Имя / ID','До плана','Дефицит прогноза','Перевыполнение','Прогнозное превышение'],ids.map(id=>{const m=data.employees[id][kind];return [`${records[id].snapshot.planner.employee.name} · ${id}`,...['remaining','deficit','over','expectedOver'].map(k=>plannedMoney(m,k,true))];})));
      }return node;
    }
    function printReport(team) {
      try{
        if(editor.open || busy || operation)return notify('Сначала завершите текущую операцию.',true);
        const area=document.getElementById('print-report');
        if(team){
          const records=selectedRecords();if(!Object.keys(records).length)return notify('Сотрудники для печати не выбраны');
          const cache=teamData();if(!cache.data)return notify('Дождитесь подготовки сводки.',true);
          const mode=preferences.ui.managerPeriodMode,period=mode==='month'?preferences.ui.managerMonth:preferences.ui.weekKey;
          area.replaceChildren(teamReport(records,cache.data,mode,period));
        }else{const contexts=reportContexts(false);if(!contexts.length)return notify('Планировщик не выбран.',true);area.replaceChildren(employeeReport(contexts[0],preferences.ui.weekKey));}
        window.print();
      }catch(error){notify(`Не удалось открыть печать: ${error.message}`,true);}
    }
    function settings() {
      const own = preferences.ui.mode === 'employee' && state.ownPlanner;
      const area = el('div',{class:'settings'});
      if (own) appendNodes(area,el('section',{class:'card'},el('h2',{},'Профиль сотрудника'),el('p',{class:'intro-name'},el('strong',{},own.employee.name)),el('p',{class:'identity'},`ID: ${own.employee.id}`),btn('Изменить имя',editName,'secondary'),el('p',{class:'muted small',style:'margin-top:16px;margin-bottom:0'},'ID и ставки зафиксированы при настройке.')),el('section',{class:'card'},el('h2',{},'Фиксированные ставки'),el('table',{'aria-label':'Ставки комиссий'},el('tbody',{},...PRODUCTS.map(p => el('tr',{},el('td',{},`${p.short} · ${p.name}`),el('td',{},`${Core.plain(own.ratesBps[p.code])}%`)))))));
      if (own) appendNodes(area,el('section',{class:'card'},el('h2',{},'Целевой тайминг'),el('p',{class:'muted'},'Шаблон задаёт рабочую неделю. Новая версия действует со следующего рабочего дня; любой отдельный день можно изменить в календаре.'),btn('Изменить шаблон недели',() => timingEditor(),'secondary')));
      appendNodes(area,el('section',{class:'card'},el('h2',{},'Отчёты'),el('p',{class:'muted'},readOnly()?`Команда · ${preferences.ui.managerPeriodMode==='month'?`Месяц ${preferences.ui.managerMonth}`:`Неделя ${weekLabel(preferences.ui.weekKey)}`} · Выбрано сотрудников: ${Object.keys(selectedRecords()).length}`:`Неделя ${weekLabel(preferences.ui.weekKey)}`),reportActions(readOnly()),el('p',{class:'small muted'},'CSV продаж доступен в разделе «Продажи» с учётом поиска и фильтров. Отчёты не заменяют резервную копию JSON.')));
      appendNodes(area,el('section',{class:'card'},el('h2',{},'Хранение данных'),el('p',{class:'muted'},'Данные находятся в этом браузере. Открывайте страницу в браузере и храните резервные копии. Перемещение файлов, смена браузера или адреса страницы может потребовать восстановления JSON.'),el('p',{class:'small muted'},background.available ? 'Фоновая обработка доступна. Лимит бизнес-данных всей коллекции: 2 МиБ.' : 'Ограниченный режим: без фоновой обработки, лимит 256 КиБ.'),el('p',{class:'small muted'},'Руководитель просматривает вручную полученные снимки. Автоматической синхронизации и удалённого доступа к устройству сотрудника нет.'),el('div',{class:'actions'},readOnly()?btn('Импортировать сотрудника',()=>chooseSnapshot('manager'),'secondary'):btn('Экспорт JSON',()=>prepareSnapshot(),'secondary'),!readOnly()?btn('Восстановление JSON',()=>chooseSnapshot('employee'),'ghost'):null),!readOnly()?el('p',{class:'small muted'},preferences.ownBackup.lastExportAt?`Последнее инициированное скачивание копии: ${displayInstant(preferences.ownBackup.lastExportAt)}`:'Резервное скачивание ещё не инициировалось.'):null));
      if(readOnly())appendNodes(area,el('section',{class:'card'},el('h2',{},'Полученные снимки'),...Object.entries(state.importedEmployees).map(([id,r])=>el('section',{class:'snapshot-row'},el('strong',{},`${r.snapshot.planner.employee.name} · ID ${id}`),el('p',{class:'small muted'},`Экспорт: ${displayInstant(r.snapshot.exportedAt)} · Импорт: ${displayInstant(r.importedAt)}`),el('div',{class:'actions'},btn('Скачать снимок',()=>prepareSnapshot(id),'ghost'),btn('Поделиться снимком',()=>prepareSnapshot(id),'ghost'),btn('Удалить снимок',()=>deleteSnapshots(id),'danger')))),!Object.keys(state.importedEmployees).length?el('p',{class:'muted'},'Снимков сотрудников пока нет'):btn('Очистить все снимки',()=>deleteSnapshots(),'danger')));
      if (own) appendNodes(area,el('section',{class:'card'},el('h2',{},'Очистка собственного профиля'),el('p',{class:'muted'},'Удаляет ваши планы и настройки. Полученные снимки руководителя остаются в браузере.'),btn('Очистить профиль',clearOwn,'danger',{id:'clear-profile'})));
      return area;
    }
    function draftBanner() {
      if (!state.ownPlanner || preferences.ui.mode !== 'employee') return null;
      const drafts = readDrafts();
      if (!drafts.length) return null;
      const d = drafts.sort((a,b) => b.savedAt.localeCompare(a.savedAt))[0];
      const names = {plan:'плана',meeting:'встречи',sale:'продажи',template:'шаблона',day:'тайминга дня'};
      const targetExists = d.formType === 'plan' ? Core.weekValid(d.targetKey) : d.formType === 'template' ? d.targetKey === Core.nextWorkDate(today()) : d.formType === 'day' ? Core.workDate(d.targetKey) : d.targetKey === 'new' || d.targetKey.startsWith('new-') || state.ownPlanner[d.formType === 'meeting' ? 'meetings' : 'sales'].some(v => v.id === d.targetKey);
      const discard = () => {
        try { const entries = readDrafts().filter(v => !(v.employeeId === d.employeeId && v.formType === d.formType && v.targetKey === d.targetKey)); if (entries.length) sessionStorage.setItem(KEYS.drafts,JSON.stringify({schemaVersion:1,entries})); else sessionStorage.removeItem(KEYS.drafts); } catch { notify('Не удалось удалить черновик.',true); }
      };
      return el('section',{class:'banner','aria-label':'Несохранённый черновик'},el('p',{},`Есть несохранённые изменения ${names[d.formType]}.`),el('p',{class:'small'},`Черновик от ${new Date(d.savedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}`),el('div',{class:'actions'},btn('Восстановить черновик',() => {
        if (d.baseRevision !== state.revision || d.employeeId !== state.ownPlanner.employee.id || !targetExists) {
          activeForm = {kind:'draft-view',dirty:false}; const shell = formShell('Устаревший черновик',finishForm);
          appendNodes(shell.body,el('p',{},'Данные изменились после создания черновика. Можно скопировать значения, но нельзя перезаписать ими текущий план автоматически.'),el('pre',{style:'white-space:pre-wrap;overflow-wrap:anywhere'},JSON.stringify(d.fields,null,2)));
          appendNodes(shell.footer,btn('Закрыть',finishForm,'ghost'),btn('Удалить черновик',() => { discard(); finishForm(); render(); },'danger'));
        } else if (d.formType === 'plan') { preferences.ui.weekKey = d.targetKey; preferences.ui.selectedDate = d.targetKey; savePreferences(); render(); planEditor(d.targetKey,d.fields); }
        else if (d.formType === 'day' || d.formType === 'template') timingEditor(d.formType === 'day' ? d.targetKey : null,d.fields);
        else if (d.fields._view === 'transfer') transferEditor(d.targetKey,d.fields);
        else (d.formType === 'meeting' ? meetingEditor : saleEditor)(d.targetKey === 'new' || d.targetKey.startsWith('new-') ? null : d.targetKey,{...d.fields,_target:d.targetKey});
      },'secondary'),btn('Удалить черновик',() => { discard(); render(); },'ghost')));
    }
    function recoveryScreen() {
      const input = el('input',{type:'file',accept:'.json,.txt,application/json,text/plain','aria-label':'Техническая копия JSON',onchange:async event => {
        const file = event.target.files[0]; if (!file) return;
        const expectedRaw = originalRaw;
        try {
          if (file.size > (background.available ? Core.BUDGET : Core.SMALL_BUDGET)) throw new Error('Файл превышает лимит доступной обработки');
          const parsed = await background.run('parse',await file.text());
          if (!await ask('Восстановить техническую копию?','Содержимое повреждённого бизнес-хранилища будет полностью заменено выбранной копией.')) return;
          if (localStorage.getItem(KEYS.data) !== expectedRaw) throw new Error('Другая вкладка изменила хранилище. Сначала перечитайте данные.');
          const prepared = await background.run('stringify',parsed.data);
          if (localStorage.getItem(KEYS.data) !== expectedRaw) throw new Error('Хранилище изменилось во время подготовки. Повторите проверку.');
          localStorage.setItem(KEYS.data,prepared.raw);
          preferences.ownBackup = {employeeId:prepared.data.ownPlanner?.employee.id ?? null,lastExportAt:null,hasChanges:true,snoozedUntil:null}; savePreferences();
          await load(); notify('Техническая копия восстановлена.');
        } catch(error) { notify(error.message,true); }
      }});
      return el('section',{class:'card'},el('h1',{},'Нужна проверка хранилища'),el('p',{class:'error-message'},fatal),el('p',{class:'muted'},'Сохранённые данные не заменены пустыми. Можно повторить проверку, сохранить исходный текст или восстановить техническую копию состояния.'),el('div',{class:'actions'},btn('Повторить проверку',reloadData,'secondary'),btn('Скачать исходные данные',downloadRaw,'ghost',{disabled:originalRaw === null}),btn('Очистить данные приложения',async () => {
        const expectedRaw = originalRaw;
        if (!await ask('Удалить данные приложения?','Будет удалено повреждённое состояние целиком, включая собственный профиль и снимки сотрудников. Сначала сохраните исходный текст.',{yes:'Очистить',danger:true,word:'УДАЛИТЬ'})) return;
        try {
          if (localStorage.getItem(KEYS.data) !== expectedRaw) throw new Error('Хранилище изменилось. Повторите проверку.');
          const prepared = await background.run('stringify',Core.emptyState());
          if (localStorage.getItem(KEYS.data) !== expectedRaw) throw new Error('Хранилище изменилось во время подготовки. Повторите проверку.');
          localStorage.setItem(KEYS.data,prepared.raw);
          try { sessionStorage.removeItem(KEYS.drafts); } catch { notify('Не удалось очистить временные черновики.',true); }
          await load();
        } catch(error) { notify(error.message,true); }
      },'danger')),el('label',{class:'field',style:'margin-top:20px'},el('span',{class:'field-label'},'Восстановить техническую копию JSON состояния'),input),el('p',{class:'small muted'},'Это технический файл AppState, а не обычный снимок сотрудника.'));
    }
    function render() {
      document.getElementById('print-report').replaceChildren();
      if(!background.available && originalRaw!==null)try{Core.checkSize(originalRaw,Core.SMALL_BUDGET);}catch{fatal='Фоновая обработка недоступна. Большое сохранение доступно только как исходный диагностический JSON; откройте страницу в среде с Worker.';}
      const content = el('main',{class:'container',id:'main-content',tabindex:'-1'});
      app.replaceChildren(header(),content);
      if (fatal) { appendNodes(content,recoveryScreen()); return; }
      if (preferencesWarning) appendNodes(content,el('p',{class:'banner',role:'alert'},preferencesWarning));
      const manager = preferences.ui.mode === 'manager';
      if (!manager && !state.ownPlanner) { appendNodes(content,welcome()); return; }
      const section = manager ? preferences.ui.managerSection : preferences.ui.employeeSection;
      const titles = {overview:'План на неделю',calendar:'Календарь',sales:'Продажи',settings:'Настройки',team:'Команда',employee:'Планировщик сотрудника'};
      appendNodes(content,el('section',{class:'intro'},el('div',{},el('p',{class:'eyebrow'},manager ? 'Руководитель · Вся команда' : 'Сотрудник · Рабочая неделя'),el('h1',{},titles[section]),el('p',{class:'identity'},manager ? 'Полученные снимки сотрудников' : `${state.ownPlanner.employee.name} · ID ${state.ownPlanner.employee.id}`)),el('span',{class:'badge'},el('span',{class:'status-dot','aria-hidden':'true'}),'Данные в браузере')));
      if(!(manager && section==='team' && preferences.ui.managerPeriodMode==='month'))appendNodes(content,weekBar());
      const backup=backupBanner();if(backup)appendNodes(content,backup);
      const draft = draftBanner(); if (draft) appendNodes(content,draft);
      if(!manager && section==='overview')appendNodes(content,reportActions(false));
      if(busy && operation?.kind==='commit' && !editor.open)appendNodes(content,commitProgress());
      if (section === 'settings') appendNodes(content,settings());
      else if (manager) appendNodes(content,section==='team'?teamView():section==='employee'?employeeViewPanel():teamSales());
      else if (section === 'overview') appendNodes(content,overview());
      else if (section === 'calendar') appendNodes(content,calendar());
      else appendNodes(content,salesList());
      appendNodes(app,navigation()); if (conflict) renderConflict();
    }
    let displayedToday = today();
    function refreshDay() { const fresh = today(); if (fresh !== displayedToday && !editor.open && !busy) { displayedToday = fresh; render(); } }
    window.addEventListener('storage',event => {
      if (event.key !== KEYS.data && event.key !== null) return;
      preparedFile=null;teamCache=null;
      if (suspendedForm || activeForm?.dirty || busy || operation || shareBusy) { flushDraft(); conflict = true; renderConflict(); }
      else { if (editor.open) finishForm(); load(); }
    });
    setInterval(refreshDay,60000);
    setInterval(()=>{if(!editor.open && !busy && !operation)render();},3600000);
    window.addEventListener('pagehide',() => background.close());
    window.addEventListener('pageshow',event => { if (event.persisted) background.init().then(refreshDay); });
    await background.init();
    await load();
  })().catch(error => {
    document.getElementById('app').textContent = `Не удалось открыть планировщик: ${error.message}`;
  });
}
