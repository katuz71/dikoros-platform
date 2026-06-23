# UI Header/Footer Handoff

Дата фиксации: 2026-06-17
Последняя актуализация: 2026-06-22

Документ фиксирует изменения по унификации хедера, футера, меню, карточки товара, баннеров каталога, Android back-навигации, app icons и подготовке Android internal testing build.

## Цель

Привести приложение к единой навигационной и визуальной системе:

- один общий верхний хедер на основных экранах;
- единый нижний футер с корректной видимостью по маршрутам;
- автоскрытие футера при скролле вниз и возврат при скролле вверх;
- пункт `Меню` в футере с каталогом, акциями, категориями и сервисными разделами;
- корректная работа главной, категорий, корзины, избранного, профиля, заказов, карточки товара, чекаута и акций;
- баннеры категорий должны использовать свои `category.banner_items`, но визуально рендериться тем же карточным форматом, что и баннеры главной;
- Android system back должен возвращать на предыдущий экран приложения, а если истории нет — оставлять пользователя на текущем экране;
- плавающая кнопка чата должна стоять на одной высоте во всем приложении и не перекрывать товарные действия.

## Основные файлы

- `components/AppHeader.tsx`
- `components/AppFooter.tsx`
- `components/FloatingChatButton.tsx`
- `components/ProductDetailsView.tsx`
- `components/GlobalSearchModal.tsx`
- `context/AppFooterVisibilityContext.tsx`
- `hooks/use-app-footer-auto-hide.ts`
- `app/_layout.tsx`
- `app/(tabs)/_layout.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/cart.tsx`
- `app/(tabs)/favorites.tsx`
- `app/(tabs)/profile.tsx`
- `app/(tabs)/orders.tsx`
- `app/checkout.tsx`
- `app/news.tsx`
- `app/news-detail.tsx`
- `app/blog.tsx`
- `app/blog-detail.tsx`
- `app/about.tsx`
- `app/policies.tsx`
- `app.json`
- `assets/images/icon.png`
- `assets/images/android-icon-foreground.png`
- `assets/images/splash-icon.png`
- `assets/images/google-play-icon-512.png`

## Верхний хедер

Создан и внедрен единый `AppHeader`.

Что важно:

- логотип Dikoros расположен по центру;
- лупа в режиме главного хедера перенесена в левую часть;
- справа могут быть избранное, корзина, фильтр, шаринг, удаление, выход;
- `showCart` работает: при `showCart={true}` в хедере появляется кнопка корзины с переходом в `/(tabs)/cart`;
- логотип ведет на главную через `router.replace('/(tabs)' as any)` или вызывает `onLogoPress`;
- хедер использует safe-area через `useSafeAreaInsets`;
- счетчик корзины берется из `CartContext`;
- глобальный поиск открывается через `GlobalSearchContext`.

## Экраны с единым хедером

Единый хедер внедрен на основных экранах:

- главная и категории: `app/(tabs)/index.tsx`;
- корзина: `app/(tabs)/cart.tsx`;
- избранное: `app/(tabs)/favorites.tsx`;
- профиль: `app/(tabs)/profile.tsx`;
- заказы: `app/(tabs)/orders.tsx`;
- чат: `app/(tabs)/chat.tsx`;
- чекаут: `app/checkout.tsx`;
- акции: `app/news.tsx`;
- детальная акция: `app/news-detail.tsx`;
- блог: `app/blog.tsx`;
- детальная статья блога: `app/blog-detail.tsx`;
- страница `Про нас`: `app/about.tsx`;
- юридические страницы: `app/policies.tsx`.

Карточка товара по верхнему хедеру специально не переводилась на `AppHeader`: там оставлен отдельный floating header карточки товара.

## Title-row под хедером

На экранах, где раньше был старый title-header, схема приведена к виду:

```text
общий хедер с логотипом
строка названия экрана
контент
```

Так сделано для:

- `Кошик`;
- `Обране`;
- `Профіль`;
- `Оформлення замовлення`;
- `Акції`;
- `Блог`;
- категорий.

В категориях старый локальный хедер удален. Под основным хедером остается только строка с названием категории по центру и кнопкой назад слева.

## Главная как старт приложения

Главная восстановлена как стартовый экран приложения.

Изменения:

- после биометрии/инициализации приложение ведет на `/(tabs)`, а не сразу в профиль;
- нажатие по логотипу вызывает сброс в главную;
- нажатие на вкладку `Головна` также сбрасывает состояние главной;
- `showHomeScreen()` закрывает категорию, очищает поиск, фильтры, сортировку и скроллит вверх.

В `app/(tabs)/index.tsx` добавлена обработка `homeReset`.

## Категории

Категории открываются внутри главной через состояние:

- `selectedCategory`;
- `categoryViewOpen`.

Для открытия категории из глобального футера используется route params:

- `category`;
- `categoryOpen`.

Главная слушает эти параметры и открывает нужную категорию.

## Баннеры категорий

Текущая логика после актуализации 2026-06-22:

- баннеры категорий снова берутся только из `category.banner_items` через `selectedCategoryBanners`;
- нельзя подменять category banners массивом `banners` с главной;
- home banners не изменены и продолжают брать свои данные из `banners` / `data.banners`;
- общий `BannerImage` используется для home/category banner cards;
- `BannerImage` построен как rounded wrapper с `overflow: hidden`, белым фоном и `Image` через `StyleSheet.absoluteFillObject` + `resizeMode="cover"`;
- category carousel имеет тот же `BANNER_WIDTH = width - 16` и `BANNER_HEIGHT = Math.round(BANNER_WIDTH * 0.30)`, что и главная;
- root-проблема с обрезанием категории была не в картинке, а в layout: category carousel сжимался соседним `FlatList`;
- исправление: category carousel получил фиксированную высоту и запрет сжатия (`height: BANNER_HEIGHT`, `flexGrow: 0`, `flexShrink: 0`, `marginBottom: 14`).

Ключевые коммиты:

```text
a43e45b Fix category banner card rendering
4145053 Fix category carousel layout squeeze
```

Проверено руками: category banners используют правильные свои картинки и больше не обрезаются соседним `FlatList`.

## Баг с корзиной в категориях

Исправлено поведение кнопки корзины в карточках товаров внутри категорий.

Раньше при наличии нескольких вариантов товарной позиции кнопка корзины редиректила в карточку товара.

Сейчас:

- редирект убран;
- выбирается дефолтный вариант через `_pickDefaultVariant(item)`;
- товар добавляется в корзину напрямую;
- показывается toast `Товар додано в кошик`.

## Акции и блог

Экраны акций и блога приведены к общей логике:

- `app/news.tsx` — общий хедер с логотипом, ниже title-row `Акції`;
- `app/news-detail.tsx` — общий хедер с логотипом, ниже title-row `Акція`;
- `app/blog.tsx` — общий хедер с логотипом, ниже title-row `Блог`;
- `app/blog-detail.tsx` — детальная статья блога;
- кнопка назад на списке акций и блога использует безопасный `router.back()` с fallback на главную;
- детальные страницы используют обычное возвращение назад по stack history.

## Глобальный футер

Создан `components/AppFooter.tsx`.

Футер подключен глобально в `app/_layout.tsx`, native Expo tabbar скрыт в `app/(tabs)/_layout.tsx`, чтобы не было двух футеров одновременно:

```tsx
tabBarStyle: { display: 'none' }
```

Текущие маршруты, где глобальный футер может отображаться:

- `/(tabs)`;
- `/(tabs)/index`;
- `/(tabs)/favorites`;
- `/(tabs)/cart`;
- `/(tabs)/profile`;
- `/(tabs)/orders`;
- `product/[id]`.

Футер скрыт на экранах, где он мешает контенту или действиям:

- `checkout`;
- `news`;
- `news-detail`;
- `blog`;
- `blog-detail`;
- `policies`;
- `about`;
- `login`;
- `profile-info`;
- `profile-cashback`;
- `profile-reviews`;
- `oauthredirect`;
- `chat`.

## Автоскрытие футера при скролле

Добавлены:

- `context/AppFooterVisibilityContext.tsx`;
- `hooks/use-app-footer-auto-hide.ts`.

Поведение:

- при скролле вниз футер скрывается;
- при скролле вверх футер появляется;
- при возврате наверх футер показывается;
- при смене route видимость футера сбрасывается в `true`;
- работает в каталоге, категориях, избранном, корзине, профиле, заказах и карточке товара.

Ключевой коммит:

```text
8bb1223 Add footer auto-hide on scroll
```

## Пункты футера

Текущий футер содержит 5 пунктов:

- `Головна`;
- `Меню`;
- `Категорії`;
- `Кошик`;
- `Профіль`.

Футер сделан на всю ширину экрана и учитывает safe-area через нижний padding.

## Меню футера

Пункт `Меню` открывает модалку снизу.

В модалке есть блоки `Каталог`, `Сервіс` и `Юридична інформація`.

### Каталог

- `Усі товари`;
- `Акції`;
- `Блог`;
- реальные категории из товаров.

Категории строятся из `OrdersContext.products` по корневой категории.

Приоритетный порядок категорий:

```ts
[
  'Мікродозінг',
  'Сушені гриби',
  'CBD',
  'Адаптогени та суперфуди',
  'Мазі',
  'Настоянки',
  'Трави та ягоди',
  'Ваги',
  'Консервація та мед',
]
```

Если появляются новые категории вне списка, они добавляются в конец по алфавиту.

Нажатие на категорию вызывает переход на главную с параметрами `category` и `categoryOpen`, после чего главная открывает нужную категорию.

### Сервис

- `Про нас`;
- `Пошук`;
- `Обране`;
- `Кошик`;
- `Профіль`;
- `Замовлення`;
- `Підтримка`.

Поиск открывается через `openSearch` из `GlobalSearchContext`.

### Юридична інформація

Юридический блок больше не спрятан за dropdown `Юридичні сторінки`. Ссылки видны сразу и оформлены в едином стиле с иконкой слева, текстом и стрелкой справа.

Порядок ссылок:

- `Оплата і доставка`;
- `Обмін та повернення`;
- `Міжнародні відправки`;
- `Контактна інформація`;
- `Договір оферти`;
- `Політика конфіденційності`;
- `Видалення акаунта`;
- `Часті питання`.

## Профиль и информационные ссылки

В `app/(tabs)/profile.tsx` порядок информационных ссылок у гостя и авторизованного пользователя унифицирован:

- `Про нас`;
- `Блог`;
- `Оплата і доставка`;
- `Обмін та повернення`;
- `Міжнародні відправки`;
- `Контактна інформація`;
- `Договір оферти`;
- `Політика конфіденційності`;
- `Часті питання`.

Статусы заказов в профиле локализованы. Например backend-статус `pending` отображается как `Очікує обробки`.

## Глобальный поиск

`components/GlobalSearchModal.tsx` ищет по:

- товарам из `OrdersContext.products`;
- акциям из `API_ENDPOINTS.newsPage`;
- статьям блога из `API_ENDPOINTS.blogPage`.

Для контентных результатов хранится тип материала:

- `news` открывается через `/news-detail`;
- `blog` открывается через `/blog-detail`.

## Карточка товара и липкая кнопка

В `components/ProductDetailsView.tsx` нижняя кнопка `В кошик` оставлена как отдельная sticky action bar.

После актуализации 2026-06-22 глобальный футер может отображаться на карточке товара и управляется через общий механизм автоскрытия. Sticky-кнопка товара должна проверяться отдельно, чтобы футер и чат не перекрывали товарные действия.

## Плавающая кнопка чата

`components/FloatingChatButton.tsx` обновлен.

Что сделано:

- кнопка чата сама учитывает safe-area через `useSafeAreaInsets`;
- базовая высота задается через `bottomOffset = 142`;
- фактический bottom считается так:

```tsx
bottom: bottomOffset + Math.max(insets.bottom, 4)
```

В `app/_layout.tsx` кнопка подключена один раз глобально:

```tsx
{showFloatingChat && <FloatingChatButton bottomOffset={142} />}
```

Плавающая кнопка чата скрывается на:

- `chat`;
- `checkout`;
- `product/[id]`;
- `news-detail`;
- `blog-detail`;
- `policies`;
- `login`;
- `oauthredirect`.

## Android system back

Добавлена собственная история путей в `app/_layout.tsx`:

- `navigationHistoryRef` хранит последние пути приложения;
- `isHistoryBackRef` защищает от повторной записи пути при программном back;
- Android `BackHandler` берет предыдущий путь из истории и делает `router.replace(previousPath as any)`;
- если истории нет, текущий экран остается открытым, приложение не закрывается;
- проверено: переходы, включая сценарий product -> cart -> system back, возвращают пользователя назад по app history, а не всегда на главную.

Ключевой коммит / update message:

```text
Use app history for Android back
```

## Текущая структура root layout

В `app/_layout.tsx` глобально подключены:

- `Stack` без нативных хедеров;
- `FloatingChatButton`;
- `AppFooter`;
- `GlobalSearchModal`;
- `WelcomeBonusModal`;
- `AppFooterVisibilityProvider`.

`AppFooter` и `FloatingChatButton` управляются по текущему route/pathname. Их нельзя просто показывать на всех экранах без проверки overlap с checkout, detail, legal и auth-страницами.

## App icons / splash / Google Play internal build

Актуализация 2026-06-22:

- обновлены `assets/images/icon.png`;
- обновлен `assets/images/android-icon-foreground.png`;
- обновлен `assets/images/splash-icon.png`;
- добавлен `assets/images/google-play-icon-512.png`;
- `app.json` поднят до `version: 1.0.10`;
- Android `versionCode` поднят с `43` до `44`;
- `runtimeVersion` использует policy `appVersion`, поэтому новый `version` создает новый runtime `1.0.10`;
- `google-services.json` не включался в icon commit;
- исходный архив `icons.zip` не должен попадать в git.

Ключевой коммит:

```text
f0c1971 Update app icons and splash assets
```

`eas.json` production profile собирает Android `app-bundle`, а `submit.production.android.track` настроен на `internal`.

Команды для Android internal testing:

```powershell
eas build -p android --profile production --clear-cache
eas submit -p android --profile production --latest
```

## Последние production-изменения

### 2026-06-20: навигационный пакет

Коммит:

```text
04da247 Fix app navigation consistency
```

Что вошло:

- visibility footer/chat настроена по маршрутам;
- cart добавлен в `AppHeader`;
- `news.tsx` и `blog.tsx` используют безопасный back;
- глобальный поиск включает товары, акции и блог;
- юридические ссылки и профиль упорядочены;
- `npx tsc --noEmit` прошел успешно;
- `git diff --check` прошел успешно;
- EAS production update: `637a5ff6-69b0-436d-8093-e42b70f1f3de`.

### 2026-06-20: Android internal testing build

Коммит:

```text
86a7197 Bump Android versionCode to 43
```

Что важно:

- `app.json` был оставлен на `version: 1.0.9`, потому что `runtimeVersion` использует policy `appVersion`;
- Android `versionCode` поднят с `42` до `43`;
- `eas.json` production profile собирает Android `app-bundle`;
- `submit.production.android.track` настроен на `internal`.

### 2026-06-22: UI/category/footer/icons пакет

Коммиты:

```text
a43e45b Fix category banner card rendering
4145053 Fix category carousel layout squeeze
8bb1223 Add footer auto-hide on scroll
f0c1971 Update app icons and splash assets
```

Что вошло:

- category banners восстановлены на свои `category.banner_items`;
- card rendering home/category унифицирован через общий `BannerImage`;
- category carousel больше не сжимается соседним `FlatList`;
- футер скрывается при скролле вниз и появляется при скролле вверх;
- автоскрытие футера подключено на каталог, категории, избранное, корзину, профиль, заказы и карточку товара;
- обновлены app icons / splash assets;
- `app.json` поднят до `version: 1.0.10`, Android `versionCode: 44`;
- проверки `npx tsc --noEmit` и `git diff --check` проходили перед коммитами.

## Проверка после правок

Для dev build после UI-правок запускать Expo с очисткой кэша:

```powershell
npx expo start --dev-client -c
```

Для production update без native-изменений:

```powershell
eas update --branch production --message "Fix category banners and footer scroll behavior"
```

Для нового Android internal testing build после изменения icons/versionCode:

```powershell
eas build -p android --profile production --clear-cache
eas submit -p android --profile production --latest
```

Проверить вручную:

1. Главная открывается первой.
2. Логотип в хедере возвращает на главную.
3. Home banners выглядят как раньше.
4. Category banners используют свои картинки из категории, не баннеры главной.
5. Category banners не обрезаются и не сжимаются соседним `FlatList`.
6. Футер скрывается при скролле вниз и появляется при скролле вверх.
7. Футер не перекрывает карточки товаров, корзину, профиль, заказы и карточку товара.
8. В футере пункт `Меню` открывает модалку.
9. В модалке есть `Усі товари`, `Акції`, `Блог`, реальные категории, сервисные и юридические пункты.
10. Нажатие на категорию из меню открывает соответствующую категорию.
11. Поиск находит товары, акции и статьи блога.
12. Контент из поиска открывается в правильный detail screen: акции в `news-detail`, блог в `blog-detail`.
13. Android system back возвращает на предыдущий экран приложения, а если истории нет — не закрывает приложение.
14. На экране чата плавающей кнопки чата нет.
15. App icon, adaptive icon и splash отображаются корректно в Android build.

## Важные ограничения

- Верхний хедер карточки товара намеренно не унифицировался через `AppHeader`.
- Глобальный футер подключен через root layout, а не отдельно на каждом экране.
- Native Expo tabbar должен оставаться скрытым, иначе появятся два футера.
- Для изменения высоты нижней навигации нужно синхронно проверять:
  - `AppFooter`;
  - sticky-кнопку в `ProductDetailsView`;
  - `FloatingChatButton`;
  - `use-app-footer-auto-hide`;
  - экраны с `FlatList` / `ScrollView`.
- Для category banners нельзя подменять `selectedCategoryBanners` на home `banners`.
- Перед новым Google Play internal build Android `versionCode` должен быть выше предыдущего загруженного build.
- `google-services.json` не трогать и не включать в коммиты без отдельной необходимости.
- В git не добавлять временные архивы вроде `icons.zip`.
