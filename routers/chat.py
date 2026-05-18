"""Chat routes and chat search helpers."""

from __future__ import annotations

import json
import os
import re
from typing import List

from fastapi import APIRouter
from models.schemas import ChatRequest, ChatResponse
from db import get_db_connection
from services.products import get_products_by_ids


router = APIRouter()


openai_client = None
api_key = os.getenv("OPENAI_API_KEY")
if api_key:
    try:
        from openai import AsyncOpenAI

        openai_client = AsyncOpenAI(api_key=api_key)
    except ImportError:
        openai_client = None
# --- CHAT SEARCH HELPERS ---
_CHAT_STOPWORDS = {
    # UA
    "і", "й", "та", "або", "але", "не", "ні", "так", "це", "ця", "цей", "ці",
    "я", "ти", "він", "вона", "воно", "вони", "ми", "ви", "мені", "тобі", "йому", "їй",
    "у", "в", "на", "до", "від", "з", "із", "зі", "за", "для", "про", "по", "над", "під",
    "що", "як", "де", "коли", "чи", "щоб", "аби", "бо", "тому", "томущо",
    "будь", "ласка", "будьласка", "порадь", "поради", "підкажи", "підкажіть",
    "хочу", "потрібно", "треба", "можна", "можете", "можеш", "допоможи", "допоможіть",
    "мені", "нам", "вам", "його", "її", "їх",
    # RU
    "и", "й", "или", "но", "а", "не", "ни", "да", "нет", "это", "эта", "этот", "эти",
    "я", "ты", "он", "она", "оно", "они", "мы", "вы", "мне", "тебе", "ему", "ей",
    "в", "во", "на", "до", "от", "из", "за", "для", "про", "по", "над", "под",
    "что", "как", "где", "когда", "ли", "чтобы", "потому", "почему",
    "пожалуйста", "посоветуйте", "посоветуй", "подскажи", "подскажите",
    "хочу", "нужно", "надо", "можно", "можете", "можешь", "помоги", "помогите",
}


def _chat_normalize_text(text: str) -> str:
    if not text:
        return ""
    t = str(text).lower().strip()
    # Normalize some UA/RU chars to improve cross-language matching
    t = (
        t.replace("ё", "е")
        .replace("’", "'")
        .replace("ʼ", "'")
        .replace("`", "'")
        .replace("ґ", "г")
        .replace("є", "е")
        .replace("і", "и")
        .replace("ї", "и")
    )
    return t


def _chat_tokenize(text: str) -> List[str]:
    import re

    t = _chat_normalize_text(text)
    raw = re.findall(r"[a-zа-я0-9']{2,}", t, flags=re.IGNORECASE)
    tokens: List[str] = []
    for tok in raw:
        tok = tok.strip("'")
        if len(tok) < 2:
            continue
        if tok in _CHAT_STOPWORDS:
            continue
        tokens.append(tok)
    return tokens


def _chat_stem_token(token: str) -> str:
    # Very light stemming for UA/RU declensions; avoids heavy NLP deps.
    t = token
    if len(t) < 5:
        return t

    suffixes = [
        # common plural/case endings
        "ями", "ами", "ими", "ого", "ому", "ему", "ого", "ого", "ами", "ями",
        "ах", "ях", "ам", "ям", "ом", "ем", "ою", "ею",
        "ів", "ев", "ов", "ей", "ий", "ый", "ая", "яя", "ое", "ее",
        "у", "ю", "а", "я", "і", "и", "е", "о",
    ]
    for suf in suffixes:
        if len(t) - len(suf) >= 4 and t.endswith(suf):
            return t[: -len(suf)]
    return t


_CHAT_INTENTS = {
    "sleep": ["сон", "сну", "sleep", "insomnia", "безсон", "бессон", "засин", "пробуджен"],
    "immunity": ["иммун", "имун", "застуд", "простуд", "грип", "вирус", "вірус"],
    "stress": ["стрес", "тривог", "тревог", "нерв", "паник", "депрес", "вигоран", "выгоран"],
    "energy": ["енерг", "энерг", "втом", "устал", "витрив", "спорт", "либид", "лібід"],
    "focus": ["памят", "пам'", "памятт", "фокус", "уваг", "вниман", "мозок", "мозг"],
    "digest": ["шлунк", "желуд", "киш", "травлен", "печен", "печін", "детокс", "detox"],
}


_CHAT_FAMILY_BOOSTS = {
    # Intent -> [(keywords_in_product_name, boost)]
    "sleep": [(["рейш", "reishi"], 14)],
    "stress": [(["рейш", "reishi"], 12), (["ашваганд"], 12)],
    "immunity": [(["чаг", "chaga"], 14), (["рейш", "reishi"], 10)],
    "energy": [(["кордицеп", "cordyceps"], 14), (["женьшен", "женьш", "ginseng"], 10)],
    "focus": [(["ижовик", "ежовик", "lion", "mane"], 14)],
}


def _chat_detect_intents(normalized_text: str) -> List[str]:
    intents: List[str] = []
    for intent, needles in _CHAT_INTENTS.items():
        if any(n in normalized_text for n in needles):
            intents.append(intent)
    return intents


def _chat_score_product(product: dict, token_patterns: List[tuple], intents: List[str]) -> float:
    # token_patterns: List[(token, compiled_regex)]
    import re

    name = _chat_normalize_text(product.get("name") or "")
    category = _chat_normalize_text(product.get("category") or "")
    desc = _chat_normalize_text(product.get("description") or "")
    usage = _chat_normalize_text(product.get("usage") or "")
    comp = _chat_normalize_text(product.get("composition") or "")
    full = " ".join([name, category, desc, usage, comp])

    score = 0.0
    for token, pattern in token_patterns:
        # Prefer exact-ish word matches, but allow substring for Latin part of names.
        if pattern.search(name):
            score += 9
        elif token in name:
            score += 7

        if pattern.search(category):
            score += 4
        if pattern.search(usage):
            score += 3
        if pattern.search(desc):
            score += 2
        if pattern.search(comp):
            score += 1.5

    # Light bigram/phrase bonus
    tokens_only = [t for t, _ in token_patterns]
    if len(tokens_only) >= 2:
        for a, b in zip(tokens_only, tokens_only[1:]):
            phrase = f"{a} {b}"
            if phrase in name:
                score += 8
            elif phrase in desc or phrase in usage:
                score += 4

    # Intent boosts (only when product name contains strong family keywords)
    for intent in intents:
        for keywords, boost in _CHAT_FAMILY_BOOSTS.get(intent, []):
            if any(k in name for k in keywords):
                score += float(boost)

    # Small penalty for ultra-generic matches (helps reduce irrelevant results)
    if score > 0 and len(full) > 0:
        generic_hits = 0
        for token, pattern in token_patterns:
            if token in {"здоров", "организм", "організм", "тонус", "сила"} and pattern.search(full):
                generic_hits += 1
        if generic_hits >= 2:
            score -= 4

    return score



@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """Умный эндпоинт чата с поддержкой GPT и поиска товаров"""
    try:
        user_message = request.messages[-1].content
        user_message_lower = user_message.lower()
        normalized_message = _chat_normalize_text(user_message)
        intents = _chat_detect_intents(normalized_message)

        # 1. Поиск товаров (Улучшенный: Python-фильтрация для поддержки кириллицы и поиска в описании)
        conn = get_db_connection()

        # Загружаем только нужные поля (быстрее и меньше памяти)
        all_products_rows = conn.execute(
            """
            SELECT id, name, category, price, old_price, image, images,
                   description, usage, composition
            FROM products
            """
        ).fetchall()
        all_products = [dict(r) for r in all_products_rows]
        conn.close()

        # Токены запроса (со стоп-словами и нормализацией)
        words = _chat_tokenize(user_message_lower)
        words = [_chat_stem_token(w) for w in words]
        # Убираем повторы, сохраняя порядок
        seen = set()
        words = [w for w in words if not (w in seen or seen.add(w))]

        found_products = []

        if words:
            import re

            token_patterns: List[tuple] = []
            for w in words:
                # \b works fine for unicode letters in python regex.
                token_patterns.append((w, re.compile(rf"\\b{re.escape(w)}\\b", flags=re.IGNORECASE)))

            scored_products: List[tuple] = []
            for p in all_products:
                score = _chat_score_product(p, token_patterns, intents)
                if score > 0:
                    scored_products.append((score, p))

            scored_products.sort(key=lambda x: x[0], reverse=True)

            # Жёсткий отбор релевантности: оставляем только то, что реально подходит
            if scored_products:
                top_score = float(scored_products[0][0])
                min_abs = 10.0
                min_rel = top_score * 0.45
                threshold = max(min_abs, min_rel)
                filtered = [(s, p) for s, p in scored_products if float(s) >= threshold]

                # Если фильтр слишком строгий (например, короткий запрос), слегка смягчаем
                if len(filtered) < 2:
                    threshold = max(8.0, top_score * 0.30)
                    filtered = [(s, p) for s, p in scored_products if float(s) >= threshold]

                # Итог: до 2–3 карточек, чтобы не перегружать экран
                found_products = [p for _, p in filtered[:3]]

        # 2. GPT Генерация ответа
        if openai_client:
            # Формируем расширенный контекст товаров для бота
            products_context = ""
            if found_products:
                products_list = []
                for p in found_products:
                    product_info = (
                        f"ID: {p.get('id')} | {p.get('name')} | {p.get('price')} грн\n"
                        f"Коротко: {(p.get('description') or '')[:160]}"
                    )
                    products_list.append(product_info)

                products_context = (
                    "ДОСТУПНІ ТОВАРИ (рекомендуй ТІЛЬКИ їх, не вигадуй інших):\n"
                    + "\n\n".join(products_list)
                )
            else:
                products_context = (
                    "Товарів за цим запитом не знайдено або впевненість низька. "
                    "Не вигадуй конкретні товари. Запитай 1 уточнення (ціль/симптом/для кого/форма) "
                    "і запропонуй категорії: лікарські гриби, трави, CBD, мікродозинг."
                )

            # Системна інструкція чат-бота DikorosUA: читабельне форматування, карточки через API
            system_prompt = f"""
ОСОБИСТІСТЬ І ТОН
Ти — експерт-консультант магазину DikorosUA. Тон: професійний, дружній, орієнтований на біохакінг та здоров'я. Акцентуй на користі та активних речовинах. Відповіді мають бути візуально приємними та легко читабельними.

МОВНА ПОЛІТИКА (строго)
Завжди відповідай строго тією мовою, якою звернувся користувач (українська або російська). Ніколи не перемикайся на іншу мову самовільно.

ЛОГІКА ВІДПОВІДІ Й КАРТОЧКИ ТОВАРІВ
Пиши текст з описом користі та порадою. Не вставляй у текст посилання. Згадуй рівно 3 товари зі списку нижче — обовʼязково повною назвою, як у списку (наприклад: «Мікродозінг Brain & Sleep Їжовик гребінчастий»), щоб під повідомленням зʼявились три карточки з фото.

РЕЛЕВАНТНІ ТОВАРИ ЗА ПОТОЧНИМ ЗАПИТОМ (рекомендуй лише з них, рівно 3):
{products_context}

АКТУАЛЬНА БАЗА ТОВАРІВ (назви для згадки в тексті):
{CHAT_PRODUCTS_BASE}

ПРАВИЛО ТРЬОХ (обовʼязково)
У кожній відповіді ти зобовʼязаний порекомендувати рівно 3 релевантні товари з наданого списку.
* Контекст: Якщо запит вузький (наприклад, лише про «Чагу») — підбери 3 різні види або форми цього товару (наприклад: капсули, порошок, чай). Якщо запит широкий («для імунітету») — обери 3 різні підходящі гриби або продукти.
* Згадка: Назви всіх трьох товарів мають бути органічно вписані в текст відповіді та виділені жирним шрифтом (**назва**).
* В кінці відповіді: обовʼязково додай окремий рядок у форматі IDs: [ID1, ID2, ID3], де замість ID1, ID2, ID3 — реальні артикули (числові id) трьох рекомендованих товарів з наданого списку (з блоку «РЕЛЕВАНТНІ ТОВАРИ» / «ID: ...»). Це технічний рядок для карточок; користувач його не побачить.

ПРАВИЛА
1) Рекомендуй завжди рівно 3 товари під запит, коротко поясни чому саме вони. Не вигадуй товари поза списком.
2) Якщо товарів за запитом немає — постав одне уточнююче питання та запропонуй категорії (гриби, трави, CBD, мікродозинг).
3) Формулюй обережно: «підтримує», «може допомогти», без обіцянок лікування.
4) Якщо не можеш підібрати три товари — все одно відповідь користувачу ввічливо його мовою та запропонуй найближчі варіанти.

ФОРМАТУВАННЯ (обовʼязково дотримуйся):
Текст обовʼязково має бути розбитий на абзаци (подвійний перенос рядка), містити емодзі та бути структурованим — це критично для читабельності.
* Структура: Ніколи не пиши суцільним текстом. Діли відповідь на короткі абзаци, розділяючи їх подвійним переносом рядка.
* Акценти: Виділяй жирним назви товарів, ключові переваги та важливі рекомендації (синтаксис **текст**).
* Списки: Якщо перераховуєш кілька властивостей або товарів — використовуй марковані списки (рядок починай з * ).
* Емодзі: Обовʼязково додавай тематичні емодзі на початку абзаців або списків для дружньої атмосфери (наприклад: 🍄, 🌿, ⚡, 🧘, 🛡️).
* Привітання й прощання: Роби їх короткими та теплими.

ПРИКЛАД ІДЕАЛЬНОГО ФОРМАТУ (завжди рівно 3 товари):
«Привіт! 😊 Для твоїх цілей чудово підійдуть такі продукти:

🍄 **Чага березова (Імунітет+)** — це потужний природний захист. Вона допомагає організму чинити опір вірусам.

⚡ **Мікродозінг Power+** — дасть необхідний заряд енергії на весь день.

🌿 **Кордицепс військовий сушений** — підтримує витривалість і відновлення.

Чи є в тебе ще питання по цих грибах? 👇

IDs: [39151, 39206, 39202]»
"""

            history = [{"role": "system", "content": system_prompt}]
            # Добавляем последние 3 сообщения для контекста разговора
            for msg in request.messages[-3:]:
                role = "user" if msg.role == "user" else "assistant"
                history.append({"role": role, "content": msg.content})

            completion = await openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=history,
                temperature=0.8,
                max_tokens=500
            )
            response_text = completion.choices[0].message.content
            print(f"DEBUG GPT RESPONSE: {response_text}")
        else:
            # Fallback (если нет ключа API)
            if found_products:
                response_text = "Ось що я знайшов за вашим запитом. Перегляньте ці товари:"
            else:
                response_text = "Вибачте, я не знайшов товарів за вашим запитом. Спробуйте змінити пошук (наприклад 'Їжовик' або 'Кордицепс')."

        # Підбір карточок: спочатку рядок IDs: [id1, id2, id3], інакше — згадки товарів у тексті (max_count=3)
        mentioned_ids = _extract_product_ids_from_text(response_text, max_count=3)
        if mentioned_ids:
            chat_products = get_products_by_ids(mentioned_ids)
        elif found_products:
            # Fallback: якщо GPT не використав — показуємо до 3 товарів із пошуку
            chat_products = get_products_by_ids([p.get("id") for p in found_products[:3] if p.get("id")])
        else:
            chat_products = []

        # Прибираємо технічний рядок IDs: [...] з відповіді перед відправкою на фронт
        response_text = _strip_ids_line_from_response(response_text)

        def _as_chat_product(p: dict) -> dict:
            image = p.get("image")
            if not image:
                try:
                    images = json.loads(p.get("images") or "[]")
                    if isinstance(images, list) and images:
                        image = images[0]
                except Exception:
                    image = None

            return {
                "id": p.get("id"),
                "name": p.get("name"),
                "price": p.get("price") or 0,
                "old_price": p.get("old_price") or 0,
                "image": image,
                "description": (p.get("description") or "")[:280],
            }

        final_products = [_as_chat_product(p) for p in chat_products]
        return ChatResponse(message=response_text, products=final_products)

    except Exception as e:
        print(f"CHAT ERROR: {e}")
        return ChatResponse(
            message="ОШИБКА СЕРВЕРА 500",  # диагностика: уникальное сообщение при ошибке
            products=[],
        )


@router.post("/api/chat")
async def chat_endpoint_api(request: ChatRequest):
    return await chat_endpoint(request)


@router.post("/api/v1/chat")
async def chat_endpoint_api_v1(request: ChatRequest):
    return await chat_endpoint(request)
