# LA2Speak — Android-приложение

Нативная оболочка вокруг веб-клиента: тот же сервер, тот же интерфейс, но голос
продолжает работать при заблокированном экране, а личные сообщения приходят
push-уведомлениями через FCM.

## Как устроено

Приложение открывает выбранный сервер в `WebView` и добавляет к странице
JavaScript-мост `La2speakAndroid`. Веб-клиент сам определяет мост
(`web/src/lib/mobile.ts`) и начинает сообщать состояние звонка; нативные события
приходят обратно через `window.__la2speakNative`.

| Файл | Назначение |
| --- | --- |
| `MainActivity.kt` | выбор сервера, список посещённых |
| `WebAppActivity.kt` | WebView, разрешения, жизненный цикл, мост |
| `MobileBridge.kt` | `@JavascriptInterface` для команд из веба |
| `NativeEvents.kt` | доставка событий в WebView из служб |
| `VoiceService.kt` | foreground-служба звонка: микрофон, wakelock, звук |
| `NotificationHelper.kt` | уведомление звонка с кнопками, канал личных сообщений |
| `PushService.kt` | приём FCM-сообщений |
| `PushRouterActivity.kt` | переход к переписке по нажатию на уведомление |
| `PowerHelper.kt` | запрос исключения из оптимизации батареи |
| `AppPrefs.kt` | серверы, токен FCM, отложенный переход |
| `ServerUrl.kt` | нормализация адреса сервера |

## Почему голос не обрывается при блокировке

Пока идёт звонок, `VoiceService` работает как foreground-служба с типами
`microphone|mediaPlayback` и держит:

- `PARTIAL_WAKE_LOCK` — процессор не засыпает;
- `WifiLock` — Wi-Fi не отключается в режиме экономии;
- аудиофокус и активную аудиосессию — звук не глушится системой;
- постоянное уведомление с кнопками «Микрофон» и «Выйти из канала».

WebView не ставится на паузу, поэтому сокет и WebRTC-соединение живут дальше.
Экран гаснет, звук идёт.

Android 14+ разрешает запуск микрофонной foreground-службы только из видимого
приложения — служба стартует в момент подключения к каналу, пока интерфейс
открыт. Это штатное поведение.

### Что нужно сделать на телефоне

- Разрешить уведомления (Android 13+) и доступ к микрофону.
- По кнопке в настройках веб-клиента отключить оптимизацию батареи
  (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
- На Xiaomi/Redmi, Huawei/Honor, Oppo, Vivo включить автозапуск приложения и
  снять ограничение фоновой активности: прошивки этих производителей убивают
  службы агрессивнее стандартного Android.

## Сборка

Требования:

- JDK 17;
- Android SDK Platform 35 и Build Tools 35;
- Gradle 8.9 (в репозитории есть `gradle/wrapper/gradle-wrapper.properties`, но
  без `gradlew`; проще всего открыть папку `mobile/` в Android Studio — она
  сама скачает Gradle и сгенерирует wrapper, либо один раз выполнить
  `gradle wrapper --gradle-version 8.9`).

Сборка debug-версии:

```bash
cd mobile
./gradlew assembleDebug   # в Android Studio: Run ▶
```

APK: `mobile/app/build/outputs/apk/debug/app-debug.apk`.

Release-сборку подписывайте через Android Studio
(**Build → Generate Signed App Bundle / APK**) или добавьте `signingConfig`
в `app/build.gradle.kts`. Файлы ключей и `keystore.properties` уже исключены
через `.gitignore`.

## Push-уведомления (FCM)

Без Firebase приложение собирается и работает, просто без пушей
(`app/build.gradle.kts` подключает плагин только при наличии
`google-services.json`).

1. В Firebase Console создайте проект и Android-приложение с пакетом
   `ru.la2speak.mobile`.
2. Скачайте `google-services.json` в `mobile/app/` (шаблон структуры —
   `app/google-services.json.example`).
3. На сервере, который раздаёт этот APK, задайте переменные окружения
   сервисного аккаунта Firebase:
   - `FCM_PROJECT_ID`
   - `FCM_CLIENT_EMAIL`
   - `FCM_PRIVATE_KEY` (одной строкой, переводы строк как `\n`)

   Сервер сам подменяет `\n` на переносы (`server/src/fcm.ts`). Если ключа нет,
   сервер просто не отправляет пуши.
4. После входа токен устройства уходит на сервер (`api.pushFcm`), при выходе —
   отвязывается. Токен хранится в `localStorage` веб-клиента и в
   `SharedPreferences` приложения.

Нажатие на уведомление о личном сообщении открывает приложение на нужной
переписке (`click_action=ru.la2speak.mobile.OPEN_DM`).

## Ограничения

- Глобальных горячих клавиш и PTT мышью на Android нет — переключение
  микрофона и вещание доступны кнопками в интерфейсе и из уведомления.
- Демонстрация экрана работает средствами системного диалога Android.
- Для голоса нужен HTTPS-сервер: Chromium/WebView отдаёт микрофон только
  защищённому origin. `usesCleartextTraffic` включён, но `http://`-адрес на
  телефоне приведёт к отказу `getUserMedia` — используйте домен с TLS
  (или `localhost` при отладке через `adb reverse`).
- Код не собирался на машине разработки (нет JDK и Android SDK), поэтому при
  первой сборке возможны правки под конкретные версии зависимостей.
