# DikorosUA chat architecture

Current production chat flow:

1. App chat:
   fastapi_app:8000/chat

2. Website widget chat:
   dikoros_chat:8085/chat
   proxies requests to:
   http://fastapi_app:8000/chat

Reason:
- Website widget still calls old /chat endpoint on dikoros_chat.
- To keep one source of truth, old chat endpoint proxies to main backend chat.
- Product card fields are normalized for old widget:
  title, price, old_price, currency, url, image_url, badges.

Important tested case:
"Мне нужно настойка мухомора 250 мл"
Expected product:
id 361, price 225 UAH
