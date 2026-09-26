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

## Проверка по правилам App Store (26.09.2026)

| Правило | Статус |
|---|---|
| 5.1.1(v) удаление аккаунта в приложении | Готово: Профиль → «Удалить аккаунт», сервер и устройство |
| 5.1.2(i) согласие перед передачей данных стороннему ИИ | Готово: экран согласия перед первым ИИ-анализом и примеркой, отзыв в профиле |
| 5.1.1(i) политика в App Store Connect и в приложении | Готово: /privacy, ссылки в профиле, на регистрации и в экране согласия |
| 5.1.1(ii)/(iii) разрешения только по делу, понятные тексты | Готово: только камера, фото, сохранение в галерею, геопозиция «при использовании»; микрофон, движение и фоновая геопозиция убраны |
| Манифест приватности (Required Reason APIs) | Готово: `ios.privacyManifests` в app.json |
| 4.8 Sign in with Apple | Не нужен: вход только по своему логину, без Google/Facebook |
| 5.1.1(v) регистрация только для функций на аккаунте | Обосновать в заметках для ревью (ниже). Риск средний |
| 2.1 полнота: демо-аккаунт и работающая генерация | Демо-аккаунт создан. Баланс FASHN перед ревью ≥ 100 кредитов |
| Экспортный контроль | Готово: `ITSAppUsesNonExemptEncryption = false` (только HTTPS) |
| Хранение данных = заявленному | Готово: изображения стираются по таймеру через 24 ч, записи через 90 дней, бэкапы без изображений, EXIF не уходит в FASHN |
| Страница поддержки | Готово: https://62.60.238.183.nip.io/support |

## Что вписать в App Store Connect

**Языки.** Приложение на русском, английском и китайском: выбор языка при первом запуске и в профиле,
системные окна разрешений и название на иконке тоже локализованы. В App Store Connect добавить
локализации Russian, English (U.S.) и Chinese (Simplified) с описаниями и скриншотами на каждом языке.

**URL для каждой локализации** (после покупки домена заменить адрес):

| Локализация | Privacy Policy | Support |
|---|---|---|
| Russian | `https://62.60.238.183.nip.io/privacy` | `https://62.60.238.183.nip.io/support` |
| English | `https://62.60.238.183.nip.io/privacy/en` | `https://62.60.238.183.nip.io/support/en` |
| Chinese (Simplified) | `https://62.60.238.183.nip.io/privacy/zh` | `https://62.60.238.183.nip.io/support/zh` |

**App Privacy («Data Used to Track You»: нет, ничего).** «Data Linked to You», цель везде App Functionality:
- Contact Info → Name (отображаемое имя)
- Identifiers → User ID (логин)
- User Content → Photos or Videos (фото вещей и фото для примерки)
- Usage Data → Product Interaction (счётчики генераций)

«Data Not Linked to You»: Location → Precise Location (только погода, уходит напрямую в Open-Meteo).

**Возрастной рейтинг.** Во всех пунктах «Нет»/«None»; в новых вопросах про ИИ отметить, что приложение
генерирует изображения пользователя в его же одежде, без чата и без обмена контентом между людьми.
Ожидаемый результат 4+ (или 9+/13+ по новой шкале — любой вариант приемлем).

**Sign-in required:** да. Демо-аккаунт: логин и пароль лежат на сервере в `/root/appstore-review.txt`
(доступ только root). В аккаунте уже есть лимит генераций на сегодня.

**Notes for Review (вставить как есть):**

> AI Stylist is a personal wardrobe app. Users add photos of their clothes; our server classifies each item
> and removes the background. The virtual try-on sends the user's full-body photo and selected garment photos
> to FASHN AI (fashn.ai) to generate the user wearing the outfit. Before any photo is sent to AI processing
> the app shows an explicit consent screen (guideline 5.1.2(i)); consent can be withdrawn in Profile.
> An account is required because AI processing is metered per user and each user's wardrobe is kept
> separately; account deletion is available in Profile → Delete account and removes all server data.
> To test: log in with the demo account, open Wardrobe → + to add a garment photo, then open the Fitting room,
> pick items and tap "Примерить". Generation takes 1–3 minutes; intermediate results are shown as they arrive.
> The app is available in Russian, English and Chinese; the language is chosen on first launch and can be changed in Profile.

## Остаётся на тебе / риски

1. **Баланс FASHN.** Сейчас его не хватает даже на один образ. Ревьюер, у которого примерка не заработала,
   отклонит приложение по 2.1. Пополнить минимум до 100 кредитов до отправки.
2. **Регистрация обязательна для всего приложения.** Apple иногда требует пускать без аккаунта в функции,
   которым он не нужен (локальный гардероб). Если отклонят по 5.1.1(v) — сделаем гостевой режим:
   гардероб без входа, аккаунт только для ИИ.
3. **Закон РФ о персональных данных (152-ФЗ).** Для пользователей из России требуется первичное хранение
   данных в РФ, уведомление Роскомнадзора и отдельное согласие на трансграничную передачу. Сервер в Австрии,
   FASHN за рубежом. Apple это не проверяет, но это юридический риск — стоит проконсультироваться
   с юристом до публичного запуска в России.
4. **Домен.** Ссылки на политику и API привязаны к IP сервера через nip.io.

## Проверка перед отправкой на ревью

- Регистрация → примерка из трёх вещей → «Сохранить в галерею» → удаление аккаунта.
- Ссылка на политику открывается из профиля.
- На сервере: `systemctl status wardrobe-ai nginx`, `journalctl -t wardrobe-credits -n 3`,
  свободная память (`free -m`), баланс FASHN ≥ 100 кредитов на первые дни.
