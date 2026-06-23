# Cashback Status Rules - 2026-06-23

This addendum documents the production cashback status behavior changed on 2026-06-23.

## Source of truth

Runtime source of truth is backend code:

- `routers/orders.py`
- `main.py`
- `services/order_cancellation.py`
- `services/cashback.py`

`docs/REFERRAL_CASHBACK_HANDOFF.md` remains the primary cashback/referral handoff. New chats must also account for this status-rules addendum when working on order statuses, cashback, cancellation, or payment callbacks.

## Card / Monobank payments

Card / Monobank payment is no longer an active payment flow.

Backend middleware in `main.py` blocks:

- `POST /api/payment/callback` with HTTP `410`;
- `POST /create_order` when `payment_method` is `card`, `monobank`, or `mono`.

Reason: cashback must be credited only after a final order status, not after card payment confirmation.

## Cashback crediting

Cashback is credited only when an order status is changed to a final successful status through the order status endpoint.

Current final statuses in `routers/orders.py`:

```text
Completed
Delivered
Доставлен
Виконано
Выполнен
```

When the new status is one of these values, `_apply_completed_order_rewards()` runs.

The function:

1. checks `orders.cashback_applied`;
2. calculates cashback from order items/product cashback percent;
3. adds cashback to `users.bonus_balance`;
4. adds paid order total to `users.total_spent`;
5. recalculates `users.cashback_percent` as the legacy cumulative discount alias;
6. stores `orders.cashback_earned`;
7. sets `orders.cashback_applied = TRUE`.

`orders.cashback_applied` is the idempotency guard. Repeating the same final status must not credit cashback or total spent twice.

Production verification on 2026-06-23:

```text
order 154 before final status:
status=Pending, total_price=8500, cashback_earned=0, cashback_applied=false,
bonus_balance=27, total_spent=545

order 154 after Completed:
status=Completed, total_price=8500, cashback_earned=425, cashback_applied=true,
bonus_balance=452, total_spent=9045

repeating Completed did not change these values.
```

## Cancellation rollback

Cancellation statuses are intercepted before normal status processing.

Current cancellation statuses in `services/order_cancellation.py`:

```text
Отменен
Отменён
Скасовано
Cancelled
Canceled
```

When a cancellation status is received, `cancel_order_and_revert_rewards()` runs.

If `orders.cashback_applied = TRUE`, it:

1. subtracts `orders.cashback_earned` from `users.bonus_balance`, clamped at zero;
2. subtracts `orders.total_price` from `users.total_spent`, clamped at zero;
3. recalculates `users.cashback_percent` as the legacy cumulative discount alias;
4. updates order status;
5. sets `orders.cashback_earned = 0`;
6. sets `orders.cashback_applied = FALSE`.

Production verification on 2026-06-23:

```text
order 156 before rollback:
status=Отменен, total_price=540, cashback_earned=30, cashback_applied=true

repeat status update to Отменен returned:
cashback_reverted=true

order 156 after rollback:
status=Отменен, total_price=540, cashback_earned=0, cashback_applied=false
```

## Deployment commands

```bash
cd /opt/dikoros-platform
git pull origin main
docker restart fastapi_app
sleep 10
docker logs fastapi_app --tail 120
```

## Smoke checks

```bash
curl -i https://app.dikoros.ua/health

curl -i -X POST https://app.dikoros.ua/api/payment/callback \
  -H 'Content-Type: application/json' \
  -d '{"status":"success","reference":"1"}'
```

Expected callback response: HTTP `410`.

Use `X-Admin-Key` for successful final status checks:

```bash
ADMIN_KEY="$(docker exec fastapi_app printenv ADMIN_API_KEY)"

curl -s -X PUT http://localhost:8000/api/orders/<ORDER_ID>/status \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -d '{"new_status":"Completed"}' | python3 -m json.tool
```
