# Чек-лист релиза в App Store — AI Стилист

Обновлено 24.09.2026. Всё, что помечено «готово», уже сделано и задеплоено.
Осталось то, что требует аккаунта Apple, домена или решения владельца.

## Сделано на сервере и в приложении

- **Удаление аккаунта** (требование Apple 5.1.1): Профиль → «Удалить аккаунт».
  Сервер удаляет пользователя, сессии, результаты примерок и счётчики
  (`POST /auth/delete-account`), приложение стирает локальные данные.
- **Политика конфиденциальности**: https://62.60.238.183.nip.io/privacy
  (файл `ai-server/deploy/privacy.html`, ссылка есть в профиле). Эту ссылку
  указать в App Store Connect → App Privacy → Privacy Policy URL.
- **Лимиты по аккаунту**, а не по IP: `AI_TRYON_PER_MINUTE=6`,
  `AI_ANALYZE_PER_MINUTE=20`, дневная квота `AI_DEVICE_DAILY_QUOTA=20`
  операций (одна вещь = одна операция = 4 кредита FASHN). Лимиты nginx по
  IP оставлены как грубая защита.
- **Защита от пустого баланса FASHN**: при `FASHN_CREDITS_GUARD=1` сервер
  отказывает до списания квоты, если кредитов меньше, чем нужно образу.
  Каждый час баланс пишется в журнал (`journalctl -t wardrobe-credits`),
  ниже 24 кредитов — предупреждение.
- **Бэкапы**: ежедневно `/etc/cron.daily/wardrobe-backup` кладёт сжатые копии
  баз в `/var/backups/wardrobe/<дата>/`, хранится 14 дней.
- **Конфиг приложения**: версия 1.0.0, иконка и splash (`assets/`), только
  iPhone (`supportsTablet: false`), описания всех разрешений, OTA-обновления
  через EAS Update, профиль `production` в `eas.json`.
- **SDK 57**, тесты клиента и сервера зелёные.

## Нужно от владельца

1. **Apple Developer Program** (99 $/год): https://developer.apple.com/programs/enroll/
   Нужен Apple ID с двухфакторной защитой. Одобрение занимает 1–2 дня.
2. **Домен** для API (например `api.ai-stylist.ru`). Пока работает
   `62.60.238.183.nip.io`, но он привязан к IP сервера. После покупки домена:
   A-запись на `62.60.238.183`, затем на сервере
   `certbot --nginx -d <домен>`, поменять `EXPO_PUBLIC_AI_BASE_URL` в
   `eas.json` и `.env`, ссылку на политику в App Store Connect.
3. **Кредиты FASHN**: подписка или автопополнение на https://app.fashn.ai.
   Образ из трёх вещей стоит 12 кредитов. Решить, сколько примерок в день
   получает пользователь (`AI_DEVICE_DAILY_QUOTA`), и нужна ли оплата в
   приложении (тогда потребуется StoreKit/RevenueCat — отдельная задача).
4. **Секрет сборки**: на https://expo.dev → проект → Environment variables
   завести `EXPO_PUBLIC_AI_CLIENT_TOKEN` (значение из `AI_CLIENT_TOKENS` на
   сервере, `/etc/wardrobe-ai.env`) для профилей preview и production.
5. **Материалы для страницы приложения**: название, подзаголовок, описание,
   ключевые слова, категория (Lifestyle), возрастной рейтинг (4+ подходит),
   скриншоты iPhone 6.7" и 6.1" (минимум по три), email поддержки.

## Сборка и публикация (после пункта 1)

```bash
npm i -g eas-cli
eas login                      # аккаунт Expo, тот же, что у проекта
eas credentials                # один раз: даст EAS создать сертификаты Apple
eas build --platform ios --profile production
eas submit --platform ios --profile production   # загрузка в App Store Connect
```

Первую сборку сначала раздать через TestFlight (App Store Connect →
TestFlight → внутренние тестеры), проверить на реальных телефонах,
затем отправить на ревью. Обновления JS без пересборки:

```bash
eas update --channel production --message "что изменилось"
```

## Ответы для App Privacy в App Store Connect

- Собираем: **Contact Info → Name** (отображаемое имя), **User Content →
  Photos or Videos** (фото одежды и фото для примерки), **Identifiers → User ID**
  (логин), **Usage Data → Product Interaction** (счётчики генераций),
  **Location → Coarse/Precise Location** (только для погоды, не привязана к аккаунту).
- Цель: App Functionality. Не используется для трекинга и рекламы.
- Третьи стороны: FASHN AI (генерация примерки), Open-Meteo (погода).

## Проверка перед отправкой на ревью

- Регистрация → примерка из трёх вещей → «Сохранить в галерею» → удаление аккаунта.
- Ссылка на политику открывается из профиля.
- На сервере: `systemctl status wardrobe-ai nginx`, `journalctl -t wardrobe-credits -n 3`,
  свободная память (`free -m`), баланс FASHN ≥ 100 кредитов на первые дни.
