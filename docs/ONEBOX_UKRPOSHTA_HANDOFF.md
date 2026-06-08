# OneBox + Ukrposhta handoff

Новый чат должен сначала прочитать этот документ и только потом продолжать работу. Это текущий source of truth по последнему этапу интеграции.

## Текущее состояние `main`

Последний проверенный `main` на момент handoff:

- `a91c093 fix: restore OneBox order creation payload`

Этот коммит вернул создание заказов OneBox в рабочий режим после неудачного теста `setorderclientphone=phone_active_0`.

Перед любым тестом на сервере выполнить:

```bash
cd /opt/dikoros-platform
git pull --ff-only origin main
docker compose up -d --build app
```

Проверить код в контейнере:

```bash
docker exec fastapi_app grep -nE "setorderclientphone|phone_active_0|order_clientname|order_clientphone" /app/services/onebox_api.py
```

Ожидаемый безопасный режим сейчас:

```python
"setorderclientphone": "1",
"order_clientname": recipient_name,
"order_clientphone": recipient_phone_onebox,
```

Не оставлять на сервере вариант:

```python
"setorderclientphone": "phone_active_0",
"phone_active_0": "1",
```

Он ломает создание заказа через `/api/orders/add` с ошибкой OneBox про уже зарегистрированный телефон.

## Что уже сделано

### Checkout / доставка

В `app/checkout.tsx`:

- Убраны `Meest` и `Самовивіз` из checkout.
- Убрана оплата `pickup_cash` / `Готівкою при отриманні самовивозом`.
- Остались способы доставки:
  - `ukrposhta_branch` — `Укрпошта до відділення (Безкоштовно від 1000 грн)`
  - `nova_poshta` — `Новою поштою (Безкоштовно від 1500грн)`
  - `nova_poshta_international` — `Нова пошта, закордонна доставка`
- Укрпошта подключена в UI так же, как Нова Пошта:
  - отдельная модалка выбора города;
  - кнопки популярных городов;
  - отдельная модалка выбора отделения;
  - `searchCity()` выбирает endpoint по `deliveryMethod`;
  - `loadWarehouses()` выбирает endpoint по `deliveryMethod`.

Проверка локально:

```powershell
Select-String -Path app/checkout.tsx -Pattern "pickup_chernihiv|pickup_cash|meest|Meest|Самовивіз|Готівкою"
```

Ожидание: ничего не найдено.

### Ukrposhta backend

В `routers/delivery.py` добавлены endpoints:

```text
/api/delivery/ukrposhta/popular-cities
/api/delivery/ukrposhta/cities?q=Київ
/api/delivery/ukrposhta/warehouses?city_ref=...
```

Для Укрпошты используется backend-only env:

```env
UKRPOSHTA_BEARER_ECOM=...
UKRPOSHTA_API_KEY=... # alias на bearer eCom
UKRPOSHTA_COUNTERPARTY_TOKEN=...
UKRPOSHTA_BEARER_STATUS_TRACKING=...
```

В коде для address-classifier используется `UKRPOSHTA_BEARER_ECOM` или fallback `UKRPOSHTA_API_KEY`.

Важно: ключи не переносить во frontend и не делать `EXPO_PUBLIC_*`.

Укрпошта API проверена на сервере, bearer eCom работает:

```bash
docker exec -i fastapi_app python - <<'PY'
import os, httpx
r = httpx.get(
    "https://www.ukrposhta.ua/address-classifier-ws/get_postoffices_by_postindex?pi=01001",
    headers={
        "Authorization": f"Bearer {os.getenv('UKRPOSHTA_BEARER_ECOM')}",
        "Accept": "application/json",
    },
    timeout=15,
)
print("STATUS =", r.status_code)
print(r.text[:500])
PY
```

Ожидание: `STATUS = 200`.

Публичные endpoints уже тестировались и отдавали данные:

```bash
curl -G -s "https://app.dikoros.ua/api/delivery/ukrposhta/cities" \
  --data-urlencode "q=Київ" | head -c 1500

curl -s "https://app.dikoros.ua/api/delivery/ukrposhta/popular-cities" | head -c 1500

curl -G -s "https://app.dikoros.ua/api/delivery/ukrposhta/warehouses" \
  --data-urlencode "city_ref=29713|412|286" | head -c 2000
```

### OneBox: источник / оплата / доставка / номер заказа

OneBox payload сейчас мапит:

- `source`: `Mobile App`
- `sourceid`: env `ONEBOX_SOURCE_ID`
- app order number:
  - `ordercode`: app order id
  - `externalid`: app order id
  - `name`: `{app_order_number} / {client_full_name} / Mobile App`

Пример успешного лога:

```json
"ordercode": "128",
"name": "128 / Тестовый Клиент Додаток / Mobile App",
"externalid": "128"
```

Оплата/доставка проверены:

Nova Poshta + postpaid:

```json
"paymentid": "17",
"deliveryid": "12",
"customorder_Sposoboplatidp": "Післяплата на пошті (Контроль оплати )",
"customorder_sposobdostavkidp": "Новою поштою (Безкоштовно від 1500грн)"
```

Ukrposhta + postpaid:

```json
"paymentid": "10",
"deliveryid": "13",
"customorder_Sposoboplatidp": "Післяплата на пошті (Наложений платіж)",
"customorder_sposobdostavkidp": "Укрпошта до відділення (Безкоштовно від 1000 грн)"
```

### OneBox: покупатель и получатель

Была проблема: OneBox смешивал покупателя и получателя. Сейчас payload разделён так:

Покупатель в стандартных client fields:

```python
"clientnamefirst": buyer_first_for_onebox,
"clientnamelast": buyer_last_for_onebox,
"clientnamemiddle": buyer_middle_for_onebox,
"clientphone": client_phone_onebox,
"clientemail": email,
```

Получатель:

```python
"order_clientname": recipient_name,
"order_clientphone": recipient_phone_onebox,
"customorder_Otrimuvachmya": recipient_first_for_onebox,
"customorder_OtrimuvachPrizvsche": recipient_last_for_onebox,
```

Лог после фикса показывал правильный payload:

```json
"clientphone": "380997776655",
"clientemail": "onebox@example.com",
"setorderclientphone": "1",
"order_clientname": "Другой получатель 1",
"order_clientphone": "380981111111"
```

Но визуально в OneBox в поле `Телефон получателя` всё равно показывался телефон клиента. Это НЕ исправлено.

## Текущая открытая проблема

### Проблема

OneBox `/api/orders/add` принимает правильный payload:

```text
clientphone = телефон покупателя
order_clientname = имя получателя
order_clientphone = телефон получателя
```

но в интерфейсе OneBox поле `Телефон получателя` остаётся равно телефону клиента.

### Что уже пробовали и что НЕ работает

Из браузерного сохранения OneBox был снят payload, где форма передаёт:

```text
setorderclientphone = phone_active_0
phone_active_0 = 1
order_clientphone = 380981111111
```

Попытка отправлять это прямо в `/api/orders/add` привела к ошибке:

```text
result: fail
errors: Такой номер телефона уже зарегистрирован #12903
```

Поэтому этот вариант был откатан коммитом:

```text
a91c093 fix: restore OneBox order creation payload
```

## Что должен сделать новый чат

### Шаг 1. Не ломать создание заказов

Сначала убедиться, что сервер на `a91c093` или новее и что в контейнере нет `phone_active_0` в `/api/orders/add` payload:

```bash
cd /opt/dikoros-platform
git pull --ff-only origin main
docker compose up -d --build app
docker exec fastapi_app grep -nE "setorderclientphone|phone_active_0|order_clientname|order_clientphone" /app/services/onebox_api.py
```

Ожидание:

```python
"setorderclientphone": "1",
"order_clientname": recipient_name,
"order_clientphone": recipient_phone_onebox,
```

### Шаг 2. Найти endpoint браузерного сохранения OneBox

У пользователя уже есть payload браузерного сохранения формы заказа, но нет `Request URL`.

Нужно попросить пользователя открыть заказ OneBox, вручную поменять `Телефон получателя`, открыть DevTools → Network → Fetch/XHR, нажать сохранить и прислать:

- Request URL
- Method
- Query String Parameters
- Form Data / Payload
- Response

Известный payload браузерного сохранения содержал:

```text
oldorderstatusid_82187=62
setorderclientphone=phone_active_0
phone_active_0=1
order_clientphone=380981111111
orderadd=82187
linkkeyorderadd=82187
ok=1
ajax=1
orderid=82187
isOrderControl=1
custom_status_menu=copyOrder
doprocedure=
tabid=0
reloadMenu=1
```

### Шаг 3. Реализовать второй запрос после создания заказа

Правильная схема, скорее всего:

1. Создать заказ через `/api/orders/add` в безопасном payload.
2. Получить `orderId` из ответа OneBox.
3. Сделать отдельный запрос на тот же endpoint, который использует браузерное сохранение заказа.
4. В этом втором запросе обновить только recipient fields:

```text
orderid={orderId}
orderadd={orderId}
linkkeyorderadd={orderId}
setorderclientphone=phone_active_0
phone_active_0=1
order_clientname={recipient_name}
order_clientphone={recipient_phone_onebox}
ok=1
ajax=1
isOrderControl=1
```

Второй запрос делать только после успешного создания заказа.

Нельзя менять `/api/orders/add` обратно на `setorderclientphone=phone_active_0`, потому что это ломает создание заказа.

### Шаг 4. Email

Есть отдельный нюанс по email: OneBox показывает много email в карточке клиента, если тестировать на телефоне, который уже был в OneBox. Это не обязательно ошибка текущего заказа — OneBox подтягивает старую карточку клиента по телефону.

Для проверки email использовать новый телефон покупателя, которого ещё нет в OneBox.

Если нужно прекратить накопление email в карточке клиента, возможный следующий фикс:

```python
# убрать clientemail из стандартной карточки клиента
# оставить email только в customorder_email
```

Но это решение принять отдельно, после фикса телефона получателя.

## Проверочные команды

Логи OneBox payload:

```bash
docker logs fastapi_app --since=10m 2>&1 | grep -E "Official /api/orders/add params|ordercode|externalid|\"name\"|clientnamefirst|clientnamelast|clientnamemiddle|clientphone|clientemail|setorderclientphone|phone_active_0|order_clientname|order_clientphone|customorder_Otrimuvach|paymentid|deliveryid|customorder_Sposoboplatidp|customorder_sposobdostavkidp|Response|orderId"
```

Проверка Python syntax:

```powershell
python -m py_compile services/onebox_api.py routers/delivery.py
```

Проверка frontend lint:

```powershell
npm run lint
```

## Android build

`app.json` уже поднят:

```json
"version": "1.0.5",
"versionCode": 32
```

Не запускать новый Android production build, пока не будет закрыта проблема `Телефон получателя` в OneBox.
