import re
from pathlib import Path

CHAT = Path('/mnt/data/work_v31_fullsettings/templates/chat.html')
text = CHAT.read_text(encoding='utf-8')

def repl_page(page, inner_html):
    global text
    pattern = re.compile(rf"(<div class=\"nc-settings-page\" data-page=\"{re.escape(page)}\">)(.*?)(</div>)\n", re.S)
    m = pattern.search(text)
    if not m:
        raise SystemExit(f'Page {page} not found')
    text = text[:m.start(2)] + "\n" + inner_html.strip('\n') + "\n" + text[m.end(2):]

# Common snippets
switch = lambda skey, aria: f'''<button class="nc-switch" type="button" data-skey="{skey}" aria-pressed="false" aria-label="{aria}"><span class="nc-switch-knob" aria-hidden="true"></span></button>'''

privacy_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Данные и конфиденциальность</h2>
    <div class="nc-settings-muted">Настройте, кто может писать вам, добавлять в друзья и видеть активность. Настройки сохраняются локально в браузере.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Личные сообщения</h3>

    <div class="nc-set-row">
      <div class="nc-set-left">
        <div class="nc-set-title">Разрешить ЛС от участников общих серверов</div>
        <div class="nc-set-sub">Если выключить — открыть ЛС с не-друзьями будет нельзя.</div>
      </div>
      {switch('privacy.dmFromServers','ЛС от участников серверов')}
    </div>

    <div class="nc-set-row">
      <div class="nc-set-left">
        <div class="nc-set-title">Запросы общения</div>
        <div class="nc-set-sub">Показывать входящие запросы вместо автоматического открытия чатов.</div>
      </div>
      {switch('privacy.messageRequests','Запросы общения')}
    </div>

    <div class="nc-set-row">
      <div class="nc-set-left">
        <div class="nc-set-title">Фильтровать подозрительные сообщения</div>
        <div class="nc-set-sub">Мягкая фильтрация спама в личных сообщениях.</div>
      </div>
      {switch('privacy.dmSpamFilter','Фильтр спама')}
    </div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Запросы дружбы</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Все</div><div class="nc-set-sub">Разрешать запросы дружбы от любых пользователей.</div></div>{switch('privacy.friendReqAll','Запросы дружбы: все')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Друзья друзей</div><div class="nc-set-sub">Разрешать запросы дружбы от друзей ваших друзей.</div></div>{switch('privacy.friendReqFoF','Запросы дружбы: друзья друзей')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Участники серверов</div><div class="nc-set-sub">Разрешать запросы дружбы от участников общих серверов.</div></div>{switch('privacy.friendReqServers','Запросы дружбы: участники серверов')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Активность</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать статус «в сети»</div><div class="nc-set-sub">Отображать индикатор присутствия и статус в списках.</div></div>{switch('privacy.showPresence','Показывать статус')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать «Печатает…»</div><div class="nc-set-sub">Если выключить — вы не будете отправлять события набора текста.</div></div>{switch('privacy.showTyping','Показывать печатает')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Данные</h3>
    <div class="nc-set-row">
      <div class="nc-set-left">
        <div class="nc-set-title">Экспортировать мои данные</div>
        <div class="nc-set-sub">Создаст локальный JSON со всеми настройками интерфейса и «чёрными списками» браузера.</div>
      </div>
      <button class="nc-btn ghost" type="button" data-action="export-settings">Экспорт</button>
    </div>
    <div class="nc-set-row">
      <div class="nc-set-left">
        <div class="nc-set-title">Импортировать настройки</div>
        <div class="nc-set-sub">Загрузите ранее экспортированный JSON.</div>
      </div>
      <label class="nc-btn ghost nc-file-btn">
        Импорт
        <input type="file" accept="application/json" id="nc-import-settings" hidden>
      </label>
    </div>
  </div>
'''

family_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Семейный центр</h2>
    <div class="nc-settings-muted">Родительский контроль и безопасный режим. Здесь — интерфейс, приближенный к Discord (локальная имитация).</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Безопасный режим</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Ограничить контент 18+</div><div class="nc-set-sub">Скрывать пометки 18+ и блокировать предпросмотр «шок-контента».</div></div>{switch('family.safeMode','Безопасный режим')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Запретить сообщения от незнакомых</div><div class="nc-set-sub">Автоматически выключает ЛС от участников серверов (если они не друзья).</div></div>{switch('family.blockStrangers','Запретить незнакомых')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Ограничения времени</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Напоминание о перерыве</div><div class="nc-set-sub">Показывать напоминание каждые N минут.</div></div>
      <select class="nc-set-select" data-skey="family.breakEvery">
        <option value="0">Выключено</option>
        <option value="30">Каждые 30 минут</option>
        <option value="60">Каждый час</option>
        <option value="90">Каждые 90 минут</option>
      </select>
    </div>
    <div class="nc-settings-muted">Важно: это локальные настройки интерфейса и не влияют на серверные правила.</div>
  </div>
'''

authorized_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Авторизованные приложения</h2>
    <div class="nc-settings-muted">Список приложений, которым вы давали доступ. Здесь — аккуратная таблица как у Discord (локально).</div>
  </div>

  <div class="nc-settings-section">
    <div class="nc-table-head">
      <h3 class="nc-settings-h3">Подключенные приложения</h3>
      <button class="nc-btn vv" type="button" data-action="authapp-add">Добавить</button>
    </div>

    <div class="nc-table" id="nc-authapps-table" data-table="authapps">
      <div class="nc-table-empty">Нет авторизованных приложений.</div>
    </div>
  </div>
'''

devices_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Устройства</h2>
    <div class="nc-settings-muted">Сеансы входа и устройства. Для безопасности можно завершить все сеансы (локальная имитация интерфейса).</div>
  </div>

  <div class="nc-settings-section">
    <div class="nc-table-head">
      <h3 class="nc-settings-h3">Активные сеансы</h3>
      <button class="nc-btn danger" type="button" data-action="sessions-logout-all">Выйти везде</button>
    </div>

    <div class="nc-table" id="nc-sessions-table" data-table="sessions">
      <div class="nc-table-row">
        <div class="nc-table-main">
          <div class="nc-table-title">Текущий браузер</div>
          <div class="nc-table-sub" id="nc-session-meta">Этот ПК • текущая сессия</div>
        </div>
        <div class="nc-table-actions">
          <button class="nc-btn ghost" type="button" data-action="sessions-copy">Копировать данные</button>
        </div>
      </div>
    </div>
  </div>
'''

integrations_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Интеграции</h2>
    <div class="nc-settings-muted">Подключайте сервисы и управляйте связями. Сейчас — UI как у Discord + локальное сохранение.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Сервисы</h3>

    <div class="nc-cards">
      <div class="nc-card">
        <div class="nc-card-left">
          <div class="nc-card-title">Twitch</div>
          <div class="nc-card-sub">Статус стрима и бейджи подписки.</div>
        </div>
        <div class="nc-card-right">
          <button class="nc-btn vv" type="button" data-action="integrations-connect" data-provider="twitch">Подключить</button>
        </div>
      </div>
      <div class="nc-card">
        <div class="nc-card-left">
          <div class="nc-card-title">YouTube</div>
          <div class="nc-card-sub">Уведомления о новых видео и стримах.</div>
        </div>
        <div class="nc-card-right">
          <button class="nc-btn vv" type="button" data-action="integrations-connect" data-provider="youtube">Подключить</button>
        </div>
      </div>
      <div class="nc-card">
        <div class="nc-card-left">
          <div class="nc-card-title">Spotify</div>
          <div class="nc-card-sub">Показывать, что вы слушаете (локально).</div>
        </div>
        <div class="nc-card-right">
          <button class="nc-btn vv" type="button" data-action="integrations-connect" data-provider="spotify">Подключить</button>
        </div>
      </div>
    </div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Интеграции интерфейса</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать бейджи интеграций</div><div class="nc-set-sub">Добавляет маленькие метки в профиле.</div></div>{switch('integrations.showBadges','Показывать бейджи')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Авто-статус по активности</div><div class="nc-set-sub">Отображать активность в статусе (локально).</div></div>{switch('integrations.autoStatus','Авто-статус')}</div>
  </div>
'''

clips_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Видеонарезки</h2>
    <div class="nc-settings-muted">Настройки клипов (UI как у Discord). Пока клипы не пишем на сервере — это подготовка интерфейса.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Клипы</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Разрешить клипы</div><div class="nc-set-sub">Показывает кнопки клипов и панель управления.</div></div>{switch('clips.enabled','Клипы')}</div>
    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Длина клипа</div><div class="nc-set-sub">Сколько секунд сохранять.</div></div>
      <select class="nc-set-select" data-skey="clips.length">
        <option value="10">10 секунд</option>
        <option value="30">30 секунд</option>
        <option value="60">60 секунд</option>
      </select>
    </div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Звук клипа</div><div class="nc-set-sub">Включить звук при записи клипа.</div></div>{switch('clips.withAudio','Звук')}</div>
  </div>
'''

billing_card = lambda title, sub, action, btn: f'''
  <div class="nc-card nc-card-hero">
    <div class="nc-card-left">
      <div class="nc-card-title">{title}</div>
      <div class="nc-card-sub">{sub}</div>
    </div>
    <div class="nc-card-right">
      <button class="nc-btn primary" type="button" data-action="{action}">{btn}</button>
    </div>
  </div>
'''

nitro_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Pulsar+</h2>
    <div class="nc-settings-muted">Кастомизация, ускорение и плюшки. Это интерфейсный прототип под ваш стиль.</div>
  </div>
  {billing_card('Создайте свою тему','Больше цветов, градиенты, анимации и пресеты.','open-theme-preview','Открыть предпросмотр')}
  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Плюшки Pulsar+</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Анимированные аватары</div><div class="nc-set-sub">Включает анимации (если загружены GIF/WebP).</div></div>{switch('nitro.animatedAvatars','Анимированные аватары')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Градиентные подсветки</div><div class="nc-set-sub">Усиливает glow/акценты интерфейса.</div></div>{switch('nitro.extraGlow','Градиентные подсветки')}</div>
  </div>
'''

boost_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Буст сервера</h2>
    <div class="nc-settings-muted">UI как у Discord: прогресс, уровни, награды. Пока без серверной логики — красиво и понятно.</div>
  </div>
  <div class="nc-settings-section">
    <div class="nc-boost">
      <div class="nc-boost-top">
        <div>
          <div class="nc-boost-title">NEON PULSAR</div>
          <div class="nc-boost-sub">Уровень буста: <b id="nc-boost-level">1</b></div>
        </div>
        <button class="nc-btn vv" type="button" data-action="boost-add">Поддержать сервер</button>
      </div>
      <div class="nc-boost-bar"><span id="nc-boost-bar-fill"></span></div>
      <div class="nc-boost-hint" id="nc-boost-hint">0 / 2 бустов до уровня 2</div>
    </div>
  </div>
'''

subscriptions_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Подписки</h2>
    <div class="nc-settings-muted">Управление подписками и планами (UI прототип).</div>
  </div>
  <div class="nc-settings-section">
    <div class="nc-table" id="nc-subs-table" data-table="subs">
      <div class="nc-table-empty">Нет активных подписок.</div>
    </div>
  </div>
'''

gifts_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Склад подарков</h2>
    <div class="nc-settings-muted">Подарки, промокоды, бусты — удобный список (UI прототип).</div>
  </div>
  <div class="nc-settings-section">
    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Активировать код</div><div class="nc-set-sub">Введите промокод или ссылку подарка.</div></div>
      <div class="nc-inline">
        <input class="nc-set-input" id="nc-gift-code" placeholder="NEON-XXXX-XXXX">
        <button class="nc-btn vv" type="button" data-action="gift-apply">Активировать</button>
      </div>
    </div>
    <div class="nc-table" id="nc-gifts-table" data-table="gifts"><div class="nc-table-empty">Подарков пока нет.</div></div>
  </div>
'''

billing_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Выставление счетов</h2>
    <div class="nc-settings-muted">Платежные методы и история. UI прототип под Neon-стиль.</div>
  </div>
  <div class="nc-settings-section">
    <div class="nc-table-head">
      <h3 class="nc-settings-h3">Платежные методы</h3>
      <button class="nc-btn vv" type="button" data-action="billing-add">Добавить</button>
    </div>
    <div class="nc-table" id="nc-billing-table" data-table="billing">
      <div class="nc-table-empty">Нет сохранённых платежных методов.</div>
    </div>
  </div>
  <div class="nc-settings-section">
    <div class="nc-table-head">
      <h3 class="nc-settings-h3">История платежей</h3>
      <button class="nc-btn ghost" type="button" data-action="billing-export">Экспорт</button>
    </div>
    <div class="nc-table" id="nc-billing-history" data-table="billing_history">
      <div class="nc-table-empty">История пуста.</div>
    </div>
  </div>
'''

accessibility_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Специальные возможности</h2>
    <div class="nc-settings-muted">Доступность, читаемость и управление эффектами.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Визуальные эффекты</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Уменьшить анимации</div><div class="nc-set-sub">Отключает лишние переходы и анимацию glow.</div></div>{switch('accessibility.reduceMotion','Уменьшить анимации')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Повышенная контрастность</div><div class="nc-set-sub">Более четкие границы и текст.</div></div>{switch('accessibility.highContrast','Повышенная контрастность')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Цвет</h3>
    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Насыщенность интерфейса</div><div class="nc-set-sub">Меняет общий saturate().</div></div>
      <div class="nc-range-wrap">
        <input class="nc-set-range" type="range" min="50" max="150" step="1" data-skey="accessibility.saturation" data-out="#nc-acc-sat-val">
        <span class="nc-range-val" id="nc-acc-sat-val">100%</span>
      </div>
    </div>

    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Режим дальтонизма</div><div class="nc-set-sub">Подстройка акцентных цветов (мягко).</div></div>
      <select class="nc-set-select" data-skey="accessibility.colorblind">
        <option value="none">Нет</option>
        <option value="deuter">Deuteranopia</option>
        <option value="protan">Protanopia</option>
        <option value="tritan">Tritanopia</option>
      </select>
    </div>

    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Подсветка упоминаний</div><div class="nc-set-sub">Выделять @упоминания более заметно.</div></div>{switch('accessibility.mentionHighlight','Подсветка упоминаний')}</div>
  </div>
'''

chat_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Чат</h2>
    <div class="nc-settings-muted">Поведение сообщений, вложений и ввода (как в Discord, адаптировано под Neon).</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Отправка сообщений</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Enter отправляет сообщение</div><div class="nc-set-sub">Если выключить — Enter делает новую строку, а отправка: Ctrl+Enter.</div></div>{switch('chat.enterSends','Enter отправляет')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Авто-рост поля ввода</div><div class="nc-set-sub">Автоматически расширять поле ввода до 10 строк.</div></div>{switch('chat.autoGrow','Авто-рост')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Отображение</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Компактные сообщения</div><div class="nc-set-sub">Уменьшает вертикальные отступы, ближе к Discord compact.</div></div>{switch('chat.compact','Компактные сообщения')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать предпросмотр ссылок</div><div class="nc-set-sub">Разрешить embed-карточки ссылок.</div></div>{switch('chat.embeds','Предпросмотр ссылок')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Анимированные эмодзи</div><div class="nc-set-sub">Включает анимации для GIF/WebP эмодзи (если есть).</div></div>{switch('chat.animatedEmoji','Анимированные эмодзи')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Вложения</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Авто-сжатие изображений</div><div class="nc-set-sub">Если включено — оптимизируем большие картинки перед загрузкой (best-effort).</div></div>{switch('chat.compressImages','Сжатие изображений')}</div>
  </div>
'''

notifications_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Уведомления</h2>
    <div class="nc-settings-muted">Звук, всплывающие уведомления и тестирование.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Система</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Включить уведомления рабочего стола</div><div class="nc-set-sub">Запросит разрешение браузера. Если выключить — уведомления не показываем.</div></div>{switch('notifications.desktop','Уведомления рабочего стола')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Тестовое уведомление</div><div class="nc-set-sub">Проверить, что браузер показывает уведомления.</div></div><button class="nc-btn ghost" type="button" data-action="notify-test">Отправить</button></div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Звуки</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Звук сообщений</div><div class="nc-set-sub">Проигрывать звук при входящем сообщении.</div></div>{switch('notifications.soundMessages','Звук сообщений')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Звук звонков</div><div class="nc-set-sub">Проигрывать мелодию входящего звонка.</div></div>{switch('notifications.soundCalls','Звук звонков')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Громкость уведомлений</div><div class="nc-set-sub">Отдельная громкость для звуков уведомлений.</div></div>
      <div class="nc-range-wrap">
        <input class="nc-set-range" type="range" min="0" max="100" step="1" data-skey="notifications.volume" data-out="#nc-notif-vol-val">
        <span class="nc-range-val" id="nc-notif-vol-val">70%</span>
      </div>
    </div>
  </div>
'''

hotkeys_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Горячие клавиши</h2>
    <div class="nc-settings-muted">Назначайте бинды на действия (локально, как у Discord). Работает в приложении, когда фокус не в поле ввода.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Включение</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Включить горячие клавиши</div><div class="nc-set-sub">Если выключить — бинды не обрабатываются.</div></div>{switch('hotkeys.enabled','Горячие клавиши')}</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Бинды</h3>
    <div class="nc-hk-list" id="nc-hk-list">
      <div class="nc-hk-row" data-skey="hotkeys.mute">
        <div class="nc-hk-left"><div class="nc-hk-title">Mute / Unmute</div><div class="nc-hk-sub">Переключить микрофон.</div></div>
        <div class="nc-hk-right">
          <div class="nc-hk-chip" data-hk="hotkeys.mute">—</div>
          <button class="nc-btn ghost" type="button" data-action="hk-bind" data-skey="hotkeys.mute">Назначить</button>
          <button class="nc-btn ghost" type="button" data-action="hk-clear" data-skey="hotkeys.mute">Очистить</button>
        </div>
      </div>

      <div class="nc-hk-row" data-skey="hotkeys.deafen">
        <div class="nc-hk-left"><div class="nc-hk-title">Deafen / Undeafen</div><div class="nc-hk-sub">Переключить звук.</div></div>
        <div class="nc-hk-right">
          <div class="nc-hk-chip" data-hk="hotkeys.deafen">—</div>
          <button class="nc-btn ghost" type="button" data-action="hk-bind" data-skey="hotkeys.deafen">Назначить</button>
          <button class="nc-btn ghost" type="button" data-action="hk-clear" data-skey="hotkeys.deafen">Очистить</button>
        </div>
      </div>

      <div class="nc-hk-row" data-skey="hotkeys.ptt">
        <div class="nc-hk-left"><div class="nc-hk-title">Push-to-Talk</div><div class="nc-hk-sub">Говорить только при удержании клавиши.</div></div>
        <div class="nc-hk-right">
          <div class="nc-hk-chip" data-hk="hotkeys.ptt">—</div>
          <button class="nc-btn ghost" type="button" data-action="hk-bind" data-skey="hotkeys.ptt">Назначить</button>
          <button class="nc-btn ghost" type="button" data-action="hk-clear" data-skey="hotkeys.ptt">Очистить</button>
        </div>
      </div>
    </div>

    <div class="nc-settings-muted" id="nc-hk-capture-hint" style="display:none;">Нажмите комбинацию… (Esc — отмена)</div>
  </div>
'''

language_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Language &amp; Time</h2>
    <div class="nc-settings-muted">Язык интерфейса и формат времени (локально).</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Язык</h3>
    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Язык интерфейса</div><div class="nc-set-sub">Меняет подписи основных элементов. Требует перезагрузки страницы для полного применения.</div></div>
      <select class="nc-set-select" data-skey="language.lang">
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Время</h3>
    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Формат времени</div><div class="nc-set-sub">12-часовой или 24-часовой формат.</div></div>
      <select class="nc-set-select" data-skey="language.timeFormat">
        <option value="24">24-часовой</option>
        <option value="12">12-часовой</option>
      </select>
    </div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать секунды</div><div class="nc-set-sub">Добавляет секунды в отметках времени.</div></div>{switch('language.showSeconds','Показывать секунды')}</div>
  </div>
'''

streamer_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Режим стримера</h2>
    <div class="nc-settings-muted">Скрывает чувствительные данные и упрощает уведомления для стрима.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Режим стримера</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Включить режим стримера</div><div class="nc-set-sub">Скрывает почту/телефон, может прятать аватары и серверные названия.</div></div>{switch('streamer.enabled','Режим стримера')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Скрывать личные данные</div><div class="nc-set-sub">Почта, телефон и токены.</div></div>{switch('streamer.hidePersonal','Скрывать личные данные')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Скрывать превью сообщений на экране</div><div class="nc-set-sub">Заменяет текст на «Сообщение» в уведомлениях и подсказках.</div></div>{switch('streamer.hidePreviews','Скрывать превью')}</div>
  </div>
'''

advanced_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Расширенные</h2>
    <div class="nc-settings-muted">Для продвинутой настройки и диагностики.</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Разработка</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Developer Mode</div><div class="nc-set-sub">Показывает дополнительные действия и идентификаторы.</div></div>{switch('advanced.devMode','Developer Mode')}</div>
    <div class="nc-set-row">
      <div class="nc-set-left"><div class="nc-set-title">Уровень логов</div><div class="nc-set-sub">Влияет на подробность console.log.</div></div>
      <select class="nc-set-select" data-skey="advanced.logLevel">
        <option value="error">error</option>
        <option value="warn">warn</option>
        <option value="info">info</option>
        <option value="debug">debug</option>
      </select>
    </div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Сброс</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Сбросить настройки интерфейса</div><div class="nc-set-sub">Очистит localStorage (темы/настройки/бинды) и перезагрузит страницу.</div></div><button class="nc-btn danger" type="button" data-action="reset-ui">Сброс</button></div>
  </div>
'''

activity_html = f'''
  <div class="nc-settings-page-head">
    <h2 class="nc-settings-title">Конфиденциальность активности</h2>
    <div class="nc-settings-muted">Контроль статуса и отображения активности (локально).</div>
  </div>

  <div class="nc-settings-section">
    <h3 class="nc-settings-h3">Статус</h3>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать активность</div><div class="nc-set-sub">Показывать статус в профиле и списках.</div></div>{switch('activity.showActivity','Показывать активность')}</div>
    <div class="nc-set-row"><div class="nc-set-left"><div class="nc-set-title">Показывать «Печатает…» другим</div><div class="nc-set-sub">Если выключить — вы не отправляете typing события.</div></div>{switch('activity.showTyping','Показывать печатает')}</div>
  </div>
'''

# Apply replacements
repl_page('privacy', privacy_html)
repl_page('family', family_html)
repl_page('authorized', authorized_html)
repl_page('devices', devices_html)
repl_page('integrations', integrations_html)
repl_page('clips', clips_html)
repl_page('nitro', nitro_html)
repl_page('boost', boost_html)
repl_page('subscriptions', subscriptions_html)
repl_page('gifts', gifts_html)
repl_page('billing', billing_html)
repl_page('accessibility', accessibility_html)
repl_page('chat', chat_html)
repl_page('notifications', notifications_html)
repl_page('hotkeys', hotkeys_html)
repl_page('language', language_html)
repl_page('streamer', streamer_html)
repl_page('advanced', advanced_html)
repl_page('activity', activity_html)

# Patch voicevideo sub-tabs placeholders
# Replace content inside vv panes for video/soundboard/debug

def repl_vv_pane(tab, inner):
    global text
    pat = re.compile(rf"(<div class=\\\"nc-vv-pane\\\" data-vvtab=\\\"{re.escape(tab)}\\\" role=\\\"tabpanel\\\">)(.*?)(</div>\\n\\n          <!--)", re.S)
    m = pat.search(text)
    if not m:
        # try until closing of pane without <!-- marker
        pat = re.compile(rf"(<div class=\\\"nc-vv-pane\\\" data-vvtab=\\\"{re.escape(tab)}\\\" role=\\\"tabpanel\\\">)(.*?)(</div>\\n\\n)", re.S)
        m = pat.search(text)
        if not m:
            raise SystemExit(f'VV pane {tab} not found')
        text = text[:m.start(2)] + "\n" + inner.strip('\n') + "\n" + text[m.end(2):]
        return
    text = text[:m.start(2)] + "\n" + inner.strip('\n') + "\n" + text[m.end(2):]

video_inner = '''
            <div class="nc-vv-section">
              <div class="nc-vv-h3">Видео</div>
              <div class="nc-vv-muted">Выбор камеры, качество и эффекты (best-effort).</div>

              <div class="nc-vv-grid">
                <div class="nc-vv-col">
                  <div class="nc-vv-label">Камера</div>
                  <div class="nc-vv-select"><select id="nc-vv-camera-device"></select></div>

                  <div class="nc-vv-label" style="margin-top:12px;">Качество</div>
                  <div class="nc-vv-select">
                    <select id="nc-vv-video-quality">
                      <option value="auto">Авто</option>
                      <option value="480">480p</option>
                      <option value="720">720p</option>
                      <option value="1080">1080p</option>
                    </select>
                  </div>

                  <div class="nc-vv-toggle-row" style="margin-top:12px;">
                    <div>
                      <div class="nc-vv-toggle-title">Размытие фона</div>
                      <div class="nc-vv-muted">Лёгкий blur на видео (если поддерживается).</div>
                    </div>
                    <button class="nc-switch" type="button" data-skey="video.blur" aria-pressed="false" aria-label="Размытие фона"><span class="nc-switch-knob" aria-hidden="true"></span></button>
                  </div>

                </div>
                <div class="nc-vv-col">
                  <div class="nc-vv-label">Предпросмотр</div>
                  <div class="nc-vv-preview" id="nc-vv-video-preview">
                    <video id="nc-vv-preview-video" autoplay playsinline muted></video>
                    <div class="nc-vv-muted" id="nc-vv-preview-hint">Нажмите «Запустить предпросмотр»</div>
                  </div>
                  <div class="nc-vv-actions">
                    <button class="nc-btn vv" type="button" id="nc-vv-preview-start">Запустить предпросмотр</button>
                    <button class="nc-btn ghost" type="button" id="nc-vv-preview-stop">Остановить</button>
                  </div>
                </div>
              </div>
            </div>
'''

soundboard_inner = '''
            <div class="nc-vv-section">
              <div class="nc-vv-h3">Звуковая панель</div>
              <div class="nc-vv-muted">Набор быстрых звуков (локально) + громкость.</div>

              <div class="nc-set-row" style="margin-top:10px;">
                <div class="nc-set-left">
                  <div class="nc-set-title">Громкость звуковой панели</div>
                  <div class="nc-set-sub">Отдельная громкость, применяется сразу.</div>
                </div>
                <div class="nc-range-wrap">
                  <input class="nc-set-range" type="range" min="0" max="100" step="1" data-skey="soundboard.volume" data-out="#nc-sb-vol-val">
                  <span class="nc-range-val" id="nc-sb-vol-val">70%</span>
                </div>
              </div>

              <div class="nc-sb-grid" id="nc-sb-grid">
                <button class="nc-sb-item" type="button" data-sound="pop">Pop</button>
                <button class="nc-sb-item" type="button" data-sound="click">Click</button>
                <button class="nc-sb-item" type="button" data-sound="whoosh">Whoosh</button>
                <button class="nc-sb-item" type="button" data-sound="spark">Spark</button>
              </div>
            </div>
'''

debug_inner = '''
            <div class="nc-vv-section">
              <div class="nc-vv-h3">Отладка</div>
              <div class="nc-vv-muted">Диагностика устройств и быстрые проверки.</div>

              <div class="nc-table" id="nc-debug-table">
                <div class="nc-table-row">
                  <div class="nc-table-main">
                    <div class="nc-table-title">User Agent</div>
                    <div class="nc-table-sub" id="nc-debug-ua">—</div>
                  </div>
                  <div class="nc-table-actions">
                    <button class="nc-btn ghost" type="button" data-action="debug-copy-ua">Копировать</button>
                  </div>
                </div>
                <div class="nc-table-row">
                  <div class="nc-table-main">
                    <div class="nc-table-title">Media Devices</div>
                    <div class="nc-table-sub" id="nc-debug-devs">—</div>
                  </div>
                  <div class="nc-table-actions">
                    <button class="nc-btn ghost" type="button" data-action="debug-refresh-devs">Обновить</button>
                  </div>
                </div>
              </div>
            </div>
'''

repl_vv_pane('video', video_inner)
repl_vv_pane('soundboard', soundboard_inner)
repl_vv_pane('debug', debug_inner)

CHAT.write_text(text, encoding='utf-8')
print('patched chat.html')
