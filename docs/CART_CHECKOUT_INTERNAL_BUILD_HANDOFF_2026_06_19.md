# Cart / Checkout / Internal Build Handoff — 2026-06-19

Этот документ фиксирует все правки и проверки, выполненные в текущем чате перед Android build для Google Play Internal testing.

Основной handoff-документ также обновлен:

```text
docs/PROFILE_QA_HANDOFF.md
```

## Статус на конец чата

- Корзина визуально зафиксирована.
- Checkout визуально зафиксирован.
- OneBox-flow проверен тестовым заказом.
- Checkout-профиль сохраняется на сервере и подтягивается при следующем открытии checkout.
- Backend обновлен на сервере и перезапущен.
- Android build для Internal testing запущен.
- `app.json` поднят до:
  - `expo.version`: `1.0.9`;
  - `android.versionCode`: `42`.

## Правило фикса

Без реальной ошибки больше не менять:

- визуал корзины;
- визуал checkout;
- footer/header под эти экраны;
- OneBox payload;
- `/create_order`;
- retry duplicate-phone flow;
- второй OneBox update.

Разрешены только точечные bugfix-правки по фактическому тесту.

---

## 1. Корзина

Файл:

```text
app/(tabs)/cart.tsx
```

### Сделано

- Переработан экран корзины в iHerb-style.
- Заголовок `Кошик (n)` выровнен по центру.
- Карточка товара очищена от лишнего:
  - убран бренд/категория;
  - убран текст про промокод внутри товара;
  - убран `Детальніше`;
  - оставлены фото, название, вариант, количество, удалить, `Відкласти`, цена.
- Количество выбирается через bottom sheet.
- Промокод поднят сразу под товарами и сделан компактнее.
- `Відкласти` работает внутри корзины:
  - товар переносится в `postponedItems`;
  - из активной корзины удаляется;
  - перехода на другую страницу нет.
- `Мої списки` показывает favorites прямо внутри корзины.
- Фото/названия в корзине и списках не уводят на product page.
- Фейковые звездочки удалены.
- Реальные рейтинги показываются только при наличии реальных `rating/reviews` полей.
- Добавлен блок `Це може вас зацікавити`.
- Логика рекомендаций персональная:
  - корзина — главный сигнал;
  - отложенные — второй сигнал;
  - избранное — третий сигнал;
  - учитываются категория, слова в названии, похожая цена, скидка, реальные отзывы;
  - товары из корзины/отложенных/избранного не дублируются.

### Важный статус

Корзина зафиксирована. В нее больше не лезть без реальной ошибки.

---

## 2. Checkout

Файл:

```text
app/checkout.tsx
```

### Сделано

Checkout переделан в iHerb-style:

- основной экран больше не длинная анкета;
- редактирование вынесено в отдельные нижние окна;
- блоки на основном экране:
  - `Контакт`;
  - `Доставка`;
  - `Отримувач`;
  - `Оплата`;
  - `Ваше замовлення`;
  - `Коментар`;
  - `Підсумок`;
  - sticky footer с суммой и кнопкой `Підтвердити`.

### Модалки

- Модалки стали выше.
- Кнопки `Готово` подняты, чтобы их не перекрывал footer.
- Окно выбора города/отделения получило нижний запас.
- Город/отделение НП/Укрпошты выбираются отдельным окном поиска.

### Summary / кнопка заказа

- В `Підсумок` добавлены товары:
  - фото;
  - название;
  - вариант;
  - количество;
  - цена.
- Sticky кнопка `Підтвердити` поднята над footer.
- У скролла checkout добавлен большой нижний отступ, чтобы итог и кнопка не перекрывались.

### Сохранение данных

- Галочка `Зберегти дані для наступних замовлень` включена по умолчанию.
- Локально в телефоне сохраняются checkout-данные в `AsyncStorage`.
- Для авторизованных пользователей данные также сохраняются на сервере в checkout-профиль.

### Телефонная маска

Добавлена маска:

```text
+380 XX XXX XX XX
```

Применяется к:

- телефону покупателя;
- телефону получателя, если получает другой человек.

Поведение:

- при фокусе поле подставляет `+380`;
- ввод ограничен нужным количеством цифр;
- сохраненный телефон отображается в маске;
- перед отправкой идет проверка полного номера;
- в заказ/OneBox уходит очищенный номер через `canonicalizePhone`.

### Текст do-not-call

Текст переключателя изменен на:

```text
Не звонити, тільки повідомлення
```

В заказ уходит как:

```ts
do_not_call
```

В OneBox уходит как:

```text
customorder_Neperezvanivat = 1
```

### Важный статус

Checkout визуально зафиксирован. В него больше не лезть без реальной ошибки.

---

## 3. Checkout-профиль клиента

### Backend-файлы

Добавлены/изменены:

```text
routers/checkout_profile.py
main.py
services/db_schema.py
app/checkout.tsx
```

### Новый API

Добавлен безопасный JWT API:

```text
GET /api/user/checkout-profile/me
PUT /api/user/checkout-profile/me
```

Router зарегистрирован в `main.py`.

### Новые поля users

В `services/db_schema.py` добавлены idempotent migrations для `users`:

```text
last_name
middle_name
city_ref
warehouse_ref
recipient_name
recipient_phone
is_different_recipient
do_not_call
delivery_method
payment_method
checkout_comment
```

На startup backend вызывает `fix_db_schema()`, поэтому после `git pull` и `docker restart fastapi_app` поля добавляются автоматически.

### Что сохраняется в профиль

При успешном заказе и включенной галочке сохраняется:

- имя;
- фамилия;
- отчество;
- email;
- способ связи;
- город;
- `city_ref`;
- отделение;
- `warehouse_ref`;
- ПІБ получателя;
- телефон получателя;
- получает ли другой человек;
- `do_not_call`;
- способ доставки;
- способ оплаты;
- комментарий checkout.

Сохранение checkout-профиля не блокирует заказ и OneBox. Если профиль не сохранится, заказ все равно должен оформиться.

### Что подтягивается в checkout

Для авторизованного пользователя checkout грузит:

```text
GET /api/user/me
GET /api/user/checkout-profile/me
```

Данные checkout-профиля перезаполняют форму checkout.

---

## 4. OneBox и тестовый заказ

### Цепочка заказа

```text
Checkout -> POST /create_order -> наша БД -> background task -> OneBox /api/orders/add -> OneBox update/set
```

### Важно

OneBox payload не менялся при визуальных правках checkout.

`orderData` в `app/checkout.tsx` продолжает отправлять:

```text
name
last_name
middle_name
client_full_name
recipient_name
recipient_phone
do_not_call
user_phone
phone
email
contact_preference
city
cityRef / city_ref
warehouse
warehouseRef / warehouse_ref
delivery_method
items
totalPrice
payment_method
comment / comments
bonus_used
bonus_balance
use_bonuses
promo_code
promo_discount_percent
promo_discount_amount
save_user_data
guest_checkout
```

### Проверенный заказ

Проведен тестовый заказ после внедрения checkout-профиля.

Логи показали:

```text
POST /create_order HTTP/1.1 200 OK
```

Наш заказ:

```text
#152
```

OneBox заказ:

```text
#82806
```

OneBox сначала вернул duplicate phone:

```text
Такой номер телефона уже зарегистрирован #12903
```

Retry сработал:

```text
[OneBox] Retry Response: {"result":"ok","orderId":82806}
```

Второй update OneBox успешный:

```text
[OneBox] Official recipient update response: {"status":1,"dataArray":[82806]}
```

Checkout-профиль сохранился:

```text
PUT /api/user/checkout-profile/me HTTP/1.1 200 OK
GET /api/user/checkout-profile/me HTTP/1.1 200 OK
```

Итог:

```text
Наш заказ #152 создан
OneBox заказ #82806 создан
checkout-profile сохранен
OneBox update успешный
```

---

## 5. Server deploy в этом чате

На сервере выполнено:

```bash
cd /opt/dikoros-platform
git pull
docker restart fastapi_app
```

Проверка логов:

```bash
docker logs fastapi_app --since=2m --tail=100
```

Backend поднялся нормально:

```text
Application startup complete.
Server started successfully
```

Первый `GET /api/user/checkout-profile/me` дал `404` до сохранения профиля/в момент reload, после тестового заказа endpoint отдавал `200 OK`.

---

## 6. Internal testing build

`app.json` обновлен:

```text
version: 1.0.9
android.versionCode: 42
```

Команда билда:

```powershell
cd C:\work\dikoros-platform
git pull
npx tsc --noEmit
eas build --platform android --profile production
```

Отправка в Google Play Internal testing после успешного build:

```powershell
eas submit --platform android --profile production --latest
```

`eas.json` уже настроен на `track: internal`.

---

## 7. Коммиты этого чата

Ключевые коммиты:

```text
fc7f11c Personalize cart recommendations
a821347 Redesign checkout with editable sections
7c175ed Raise checkout edit modal actions
da79ce3 Show checkout summary items and raise submit bar
1b17b9f Add checkout phone input mask
ea36c6d Add checkout profile fields to users table
6796506 Add checkout profile API
a5f7ec6 Register checkout profile router
1b89765 Save extended checkout profile data
c906a76 Bump Android build for internal testing
e414b2f Document cart checkout and internal build handoff
```

Плюс этот документ создан отдельным коммитом.

---

## 8. Manual QA после установки internal build

Минимальный чеклист:

1. Открыть приложение авторизованным пользователем.
2. Проверить корзину:
   - quantity picker;
   - удалить;
   - отложить;
   - мои списки;
   - рекомендации.
3. Добавить товар в корзину.
4. Перейти в checkout.
5. Открыть `Контакт`.
6. Проверить маску телефона `+380 XX XXX XX XX`.
7. Заполнить контактные данные.
8. Открыть `Доставка`, выбрать город и отделение.
9. Открыть `Отримувач`, проверить покупатель сам / другой получатель.
10. Открыть `Оплата`, выбрать способ.
11. Проверить `Підсумок`: товар, количество, цена, итог.
12. Убедиться, что кнопка `Підтвердити` видна над footer.
13. Оформить тестовый заказ.
14. Проверить OneBox: заказ создан, товар/количество/сумма/доставка/оплата корректные.
15. Вернуться в checkout и проверить подтягивание данных из checkout-профиля.
16. Проверить профиль и историю заказов.

---

## 9. Следующий чат

Начинать с:

```text
docs/PROFILE_QA_HANDOFF.md
docs/CART_CHECKOUT_INTERNAL_BUILD_HANDOFF_2026_06_19.md
```

Порядок:

1. Проверить статус EAS build.
2. Если build успешный — выполнить submit в Google Play Internal testing.
3. После установки internal build пройти manual QA.
4. Не делать визуальные правки корзины/checkout без фактической ошибки.
