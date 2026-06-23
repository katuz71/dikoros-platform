"""Chat routes and chat search helpers."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import List

from fastapi import APIRouter
from models.schemas import ChatRequest, ChatResponse
from db import get_db_connection
from services.products import get_products_by_ids


router = APIRouter()
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()


async def _send_telegram_manager_message(text: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return

    try:
        import httpx

        text = (text or "").strip()
        text = text.replace("**", "").replace("__", "")
        if not text:
            return

        # Telegram limit is 4096 chars; keep safe margin.
        if len(text) > 3500:
            text = text[:3500] + "\n\n…"

        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": text,
                    "disable_web_page_preview": True,
                    "disable_notification": False,
                },
            )
    except Exception:
        logger.exception("TELEGRAM MANAGER NOTIFY ERROR")


def _format_telegram_products(products: list[dict]) -> str:
    if not products:
        return ""

    lines = ["", "🛒 Карточки:"]
    for idx, product in enumerate(products[:5], 1):
        title = product.get("title") or product.get("name") or "Без назви"
        url = product.get("url") or ""
        price = product.get("price")
        currency = product.get("currency") or "грн"

        line = f"{idx}. {title}"
        if price not in (None, "", 0):
            line += f" — {price} {currency}"
        if url:
            line += f"\n{url}"

        lines.append(line)

    return "\n".join(lines)




openai_client = None
api_key = os.getenv("OPENAI_API_KEY")
if api_key:
    try:
        from openai import AsyncOpenAI

        openai_client = AsyncOpenAI(api_key=api_key)
    except ImportError:
        openai_client = None
# --- CHAT BOT: фіксована база товарів для посилань (назва → ID) ---
CHAT_PRODUCTS_BASE = """
Іванчай (Chamaenerion angustifolium) сушений — 39168
Іванчай (Chamaenerion angustifolium) сушений ферментований — 39169
Їжовик гребінчастий (Герицій їжаковий) сушений — 39177
Ваги ювелірні — 39228
Ваги ювелірні — 39187
Ваги ювелірні до — 39211
Ваги-ложка кухонні до 500 г — 39192
Ваги-ложка кухонні до 800 г — 39197
Валеріана (Valeriána) сушена — 39156
Варення з волоських горіхів — 39239
Варення з малини (Rubus idaeus) — 39214
Варення з пелюсток троянд (Rósa) — 39219
Варення слива в шоколаді — 39238
Варення із смородини (Ribes nigrum) — 39203
Варення із соснових шишок (Pinus) — 39194
Варення із чорниці лісової (Vaccínium) — 39196
Глід (Crataegus) сушений — 39157
Гриб Веселка звичайна (Phallus impudicus) Антипухлина — 39152
Гриб Веселка, Панна сушений — 39189
Гриб білий (боровик) (Boletus edulis bulbosus) — 39172
Гриб "Чага" порошок в баночці — 39223
Желейні Ведмедики CBD з канабідіолом зі смаком вишні — 39242
Звіробій звичайний (Hypericum perforatum) сушений — 39164
Зморшкова шапинка (Verpa bohemica) сушена, 1 сорт — 39190
Зморшок конічний (Morchella conica) сушений — 39188
Кабачкове варення (Cucurbita pepo var. giraumontia) — 39216
Калган (Alpinia officinarum) корінь сушений — 39159
Калина червона (Viburnum opulus) сушена — 39154
Кордицепс військовий (Cordyceps) XL Power+ порошок — 39222
Кордицепс військовий (Cordyceps) сушений — 39202
Корінь лопуха (Arctium lappa) сушений — 39158
Липа (Tilia) сушена — 39163
Лисичка (Cantharellus cibarius) сушена — 39229
Лисичка справжня (Cantharellus cibarius) Stop Паразит — 39232
М'ята сушена (Mentha) — 39193
Мазь борсучий жир + мухомор — 39185
Мазь ведмежий жир + мухомор — 39184
Мазь мухоморна (вазилін + мухомор червоний) — 39183
Мазь прополісно-віскова 10% — 39204
Маринований білий гриб (Boletus edulis) — 39195
Мариновані зморшкові шапинки (Morchella esculenta Pers.) — 39220
Мариновані чорні грузді (Lactárius nécator) — 39217
Материнка душица (Oríganum vulgáre) сушена — 39160
Мед лугове різнотрав'я — 39236
Мед соняшниковий — 39221
Меліса лікарська (Melissa officinalis L) сушена — 39165
Мухомор червоний + мухомор пантерний + мухомор королівський 3в1 — 39227
Мухомор червоний + мухомор пантерний 2в1 — 39226
Мікродозінг XL Їжовик гребінчатий порошок — 39171
Мікродозінг ALL Inclusive Мухомор + Їжовик + Кордицепс — 39235
Мікродозінг Brain & Sleep Їжовик гребінчастий — 39186
Мікродозінг HARD Мухомор пантерний — 39153
Мікродозінг Head&Sleep Плодові тіла та міцелій їжовика — 39205
Мікродозінг Immunity activator Траметес + міцелій — 39212
Мікродозінг King Мухомор Королівський (Amaníta regális) — 39233
Мікродозінг King Мухомор Королівський порошок — 39224
Мікродозінг MIX Brain Booster Мікс їжовиків + міцелій — 39210
Мікродозінг MIX Brain Booster Мікс їжовиків + міцелій — 39209
Мікродозінг MIX Medium Мухомор королівський та Їжовик — 39243
Мікродозінг MIX Sport Мухомор червоний та Кордицепс — 39207
Мікродозінг MIX XL Мухомор червоний та Їжовик порошок — 39241
Мікродозінг MIX Мухомору червоного та Їжовика гребінчастого — 39182
Мікродозінг Power+ Кордицепс військовий — 39206
Мікродозінг Power++ Кордицепс військовий + міцелій — 39215
Мікродозінг Premium Мухомор червоний — 39208
Мікродозінг XL Мухомор червоний порошок — 39240
Мікродозінг XXL Траметес різнокольоровий + міцелій — 39213
Мікродозінг Стандарт Мухомор червоний — 39181
Настоянка Гриба Веселки — 39180
Настоянка Гриба Веселки з плодовими тілами — 39237
Настоянка воскової молі 20% "Вогнівка" — 39179
Настоянка на капелюшках Мухомору червоного — 39178
Настоянка прополісу 10% — 39198
Ніжки мухомору пантерного (сушені, різані) — 39176
Ніжки мухомору червоного (сушені, різані) — 39174
Олія CBD МСТ — 39231
Полин гіркий (Artemisia absinthium) сушений — 39162
Польський гриб маринований (Imleria badia) — 39218
Ромашка лікарська (Matricaria recutita) сушена — 39167
Сироп із кульбаб (Taraxacum) — 39199
Сироп із цвіту черемшини (Prunus padus) — 39200
Траметес різнобарвний (Trametes versicolor) сушений — 39225
Трутовик лакований (Рейші) (Ganoderma lucidum) — 39175
Трутовик сірчано-жовтий (Laetiporus sulphureus) сушений — 39170
Цмин пісковий (Helichrysum arenarium) сушені квіти — 39161
Чага (Inonotus obliquus) сушена — 39173
Чага березова (Inonotus obliquus) Імунітет+ — 39151
Чебрець (Thymus) сушений — 39166
Чорна Лисичка (Лійочник келиховидний) сушена — 39234
Чорнобривці (квітки) сушені — 39244
Шипшина звичайна (Rosa canina L.) сушена — 39155
Шляпки мухомору королівського (Amaníta regális) сушені — 39201
Шляпки мухомору пантерного (Amanita pantherina) сушені — 39230
Шляпки мухомору червоного (Amanita muscaria) сушені, сорт Еліт — 39191
"""


def _parse_chat_products_base() -> List[tuple]:
    """Парсить CHAT_PRODUCTS_BASE у список (назва, id), відсортований за спаданням довжини назви (для коректного матчу)."""
    out = []
    for line in CHAT_PRODUCTS_BASE.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if " — " in line:
            name, _, id_part = line.rpartition(" — ")
            name = name.strip()
            try:
                out.append((name, int(id_part.strip())))
            except ValueError:
                continue
    out.sort(key=lambda x: -len(x[0]))
    return out


_CHAT_PRODUCTS_NAME_TO_ID = _parse_chat_products_base()

def _load_chat_knowledge() -> dict:
    path = Path(__file__).resolve().parent.parent / "knowledge.json"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        logger.exception("CHAT KNOWLEDGE LOAD ERROR")
        return {}


def _format_chat_knowledge(knowledge: dict) -> str:
    if not knowledge:
        return ""

    blocks = [
        ("Philosophy", knowledge.get("philosophy", "")),
        ("Production", knowledge.get("production", "")),
        ("Quality control", knowledge.get("quality_control", "")),
        ("Shipping", knowledge.get("shipping", "")),
        ("Payment", knowledge.get("payment", "")),
        ("Returns", knowledge.get("returns", "")),
        ("Legal and contacts", knowledge.get("legal_and_contacts", "")),
        ("Product expertise", knowledge.get("product_expertise", "")),
    ]

    return "\n".join(f"{title}:\n{text}" for title, text in blocks if text)


CHAT_KNOWLEDGE = _load_chat_knowledge()
CHAT_KNOWLEDGE_TEXT = _format_chat_knowledge(CHAT_KNOWLEDGE)





def _chat_info_fallback_answer(user_message: str) -> str:
    t = _chat_normalize_text(user_message or "")

    if any(x in t for x in ["достав", "відправ", "отправ", "нова пошта", "новая почта"]):
        return CHAT_KNOWLEDGE.get("shipping") or "Доставка здійснюється службами доставки по Україні. Для уточнення деталей напишіть менеджеру."

    if any(x in t for x in ["оплат", "платеж", "оплата", "сплат"]):
        return CHAT_KNOWLEDGE.get("payment") or "Оплату можна уточнити під час оформлення замовлення або у менеджера."

    if any(x in t for x in ["повер", "возврат", "обмен", "обмін", "вернуть"]):
        return CHAT_KNOWLEDGE.get("returns") or "Питання повернення або обміну можна узгодити з менеджером згідно з умовами магазину."

    if any(x in t for x in ["контакт", "телефон", "менеджер", "зв'яз", "связ"]):
        return (
            "Для зв’язку з менеджером напишіть або зателефонуйте:\n\n"
            "📞 Телефон: (063) 25 26 8 24\n"
            "✉️ Email: dikorosua@gmail.com\n"
            "💬 Також можна написати через месенджери на сайті."
        )

    return (
        "Можу підказати по доставці, оплаті, поверненню або контактам. "
        "Уточніть, будь ласка, що саме вас цікавить."
    )


def _extract_ids_from_ids_line(text: str) -> List[int]:
    """Парсить рядок формату IDs: [ID1, ID2, ID3] і повертає список int id. Якщо не знайдено — порожній список."""
    match = re.search(r"IDs:\s*\[([^\]]+)\]", text, re.IGNORECASE)
    if not match:
        return []
    part = match.group(1)
    ids = []
    for s in re.split(r"[\s,]+", part.strip()):
        s = s.strip()
        if s.isdigit():
            ids.append(int(s))
    return ids[:3]


def _strip_ids_line_from_response(text: str) -> str:
    """Видаляє технічний рядок IDs: [ID1, ID2, ID3] з кінця відповіді, щоб користувач його не бачив."""
    if not text or "IDs:" not in text:
        return text.strip() if text else text
    # Видаляємо останній рядок, що містить IDs: [...]
    stripped = re.sub(r"\s*IDs:\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]\s*", "", text, flags=re.IGNORECASE)
    return stripped.strip()


def _extract_product_ids_from_text(text: str, max_count: int = 3) -> List[int]:
    """Спочатку шукає рядок IDs: [ID1, ID2, ID3] і повертає ці id (до max_count). Якщо немає — шукає назви товарів у тексті."""
    if not text:
        return []
    # 1) Пріоритет: явний рядок IDs: [...]
    ids_from_line = _extract_ids_from_ids_line(text)
    if ids_from_line:
        return ids_from_line[:max_count]
    # 2) Fallback: пошук за назвами товарів у тексті
    if not _CHAT_PRODUCTS_NAME_TO_ID:
        return []
    text_lower = text.lower()
    seen_ids = set()
    matches: List[tuple] = []
    for name, pid in _CHAT_PRODUCTS_NAME_TO_ID:
        if pid in seen_ids:
            continue
        name_lower = name.lower()
        pos = text_lower.find(name_lower)
        if pos != -1:
            seen_ids.add(pid)
            matches.append((pos, pid))
    matches.sort(key=lambda x: x[0])
    return [pid for _, pid in matches[:max_count]]

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

    # RU/UA synonym normalization for common product queries.
    t = (
        t.replace("ежовик", "ижовик")
        .replace("ежевик", "ижовик")
        .replace("гребенчат", "гребинчаст")
        .replace("микродозинг", "микродозинг")
        .replace("микродоз", "микродоз")
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



def _chat_is_info_question(text: str) -> bool:
    t = _chat_normalize_text(text or "")
    needles = [
        "що таке",
        "что такое",
        "розкажи",
        "расскажи",
        "поясни",
        "объясни",
        "як працює",
        "как работает",
        "що означає",
        "что означает",
        "\u0434\u043e\u0441\u0442\u0430\u0432",
        "\u043d\u043e\u0432\u0430 \u043f\u043e\u0448",
        "\u043d\u043e\u0432\u043e\u0439 \u043f\u043e\u0447\u0442",
        "\u0432\u0438\u0434\u043f\u0440\u0430\u0432",
        "\u0432\u0456\u0434\u043f\u0440\u0430\u0432",
        "\u043e\u0442\u043f\u0440\u0430\u0432",
        "\u043e\u043f\u043b\u0430\u0442",
        "\u043d\u0430\u043b\u043e\u0436",
        "\u043d\u0430\u043a\u043b\u0430\u0434",
        "\u0440\u0435\u043a\u0432\u0438\u0437",
        "\u0440\u0435\u043a\u0432\u0456\u0437",
        "\u043a\u0430\u0440\u0442\u0430",
        "\u043e\u043d\u043b\u0430\u0439\u043d",
        "\u043f\u043e\u0432\u0435\u0440\u043d\u0435\u043d",
        "\u0432\u043e\u0437\u0432\u0440\u0430\u0442",
        "\u043e\u0431\u043c\u0438\u043d",
        "\u043e\u0431\u043c\u0456\u043d",
        "\u043e\u0431\u043c\u0435\u043d",
        "\u0431\u0440\u0430\u043a",
        "\u043a\u043e\u043d\u0442\u0430\u043a\u0442",
        "\u0442\u0435\u043b\u0435\u0444\u043e\u043d",
        "email",
        "\u0435\u043c\u0435\u0439\u043b",
        "\u0430\u0434\u0440\u0435\u0441",
        "\u0432\u0438\u0440\u043e\u0431\u043d\u0438\u0446",
        "\u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434",
        "\u0441\u0435\u0440\u0442\u0438\u0444",
        "\u044f\u043a\u0438\u0441\u0442",
        "\u044f\u043a\u0456\u0441\u0442",
        "\u043a\u0430\u0447\u0435\u0441\u0442\u0432",
        "\u0433\u0440\u0430\u0444\u0438\u043a",
        "\u0433\u0440\u0430\u0444\u0456\u043a",
        "\u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440",
    ]
    return any(n in t for n in needles)


def _chat_info_quick_replies() -> list[str]:
    return [
        "\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430",
        "\u041e\u043f\u043b\u0430\u0442\u0430",
        "\u041f\u043e\u0432\u0435\u0440\u043d\u0435\u043d\u043d\u044f",
        "\u0417\u0432\u2019\u044f\u0437\u0430\u0442\u0438\u0441\u044f \u0437 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u043e\u043c",
    ]


def _chat_detect_button_context(text: str) -> dict:
    t = _chat_normalize_text(text or "")
    ctx = {
        "topic": None,
        "form": None,
        "goal": None,
        "budget": None,
        "experience": None,
    }

    # topic
    if any(k in t for k in [
        "\u043c\u0438\u043a\u0440\u043e\u0434\u043e\u0437", "\u043c\u0438\u043a\u0440\u043e", "\u043c\u0443\u0445\u043e\u043c", "micro"
    ]):
        ctx["topic"] = "microdosing"
    if any(k in t for k in [
        "\u0438\u0436\u043e\u0432\u0438\u043a", "\u0435\u0436\u043e\u0432\u0438\u043a", "\u0433\u0440\u0435\u0431\u0438\u043d\u0447\u0430\u0441\u0442", "\u0433\u0435\u0440\u0438\u0446\u0438"
    ]):
        ctx["topic"] = "hericium"
    if any(k in t for k in ["\u043a\u043e\u0440\u0434\u0438\u0446\u0435\u043f"]):
        ctx["topic"] = "cordyceps"
    if any(k in t for k in ["\u0447\u0430\u0433\u0430"]):
        ctx["topic"] = "chaga"
    if any(k in t for k in ["\u0440\u0435\u0438\u0448", "\u0442\u0440\u0443\u0442\u043e\u0432\u0438\u043a \u043b\u0430\u043a\u043e\u0432\u0430\u043d"]):
        ctx["topic"] = "reishi"

    # form
    if any(k in t for k in ["\u043a\u0430\u043f\u0441\u0443\u043b"]):
        ctx["form"] = "capsules"
    if any(k in t for k in ["\u043f\u043e\u0440\u043e\u0448", "\u0441\u0443\u0448\u0435\u043d", "\u0448\u043b\u044f\u043f", "\u0431\u0430\u043d\u043e\u0447"]):
        ctx["form"] = "powder"

    # goal
    if any(k in t for k in ["\u0444\u043e\u043a\u0443\u0441", "\u043f\u0430\u043c\u044f\u0442", "\u043c\u043e\u0437\u0433", "\u043c\u043e\u0437\u043e\u043a", "\u043a\u043e\u043d\u0446\u0435\u043d\u0442\u0440\u0430\u0446"]):
        ctx["goal"] = "focus"
    if any(k in t for k in ["\u0441\u043f\u043e\u043a", "\u0441\u0442\u0440\u0435\u0441", "\u0442\u0440\u0435\u0432\u043e\u0433", "\u0442\u0440\u0438\u0432\u043e\u0433", "\u0441\u043e\u043d", "\u0441\u043d\u0443"]):
        ctx["goal"] = "calm"
    if any(k in t for k in ["\u0435\u043d\u0435\u0440\u0433", "\u044d\u043d\u0435\u0440\u0433", "\u0432\u0442\u043e\u043c", "\u0443\u0441\u0442\u0430\u043b", "\u0441\u043f\u043e\u0440\u0442"]):
        ctx["goal"] = "energy"
    if any(k in t for k in ["\u0438\u043c\u043c\u0443\u043d", "\u0438\u043c\u0443\u043d", "\u0437\u0430\u0441\u0442\u0443\u0434", "\u043f\u0440\u043e\u0441\u0442\u0443\u0434"]):
        ctx["goal"] = "immunity"

    # budget
    if any(k in t for k in ["\u0434\u0435\u0448\u0435\u0432", "\u0431\u044e\u0434\u0436\u0435\u0442", "\u043d\u0435\u0434\u043e\u0440\u043e\u0433"]):
        ctx["budget"] = "low"
    if any(k in t for k in ["\u043f\u0440\u0435\u043c\u0438\u0443\u043c", "\u043f\u0440\u0435\u043c\u0456\u0443\u043c", "\u043b\u0443\u0447\u0448\u0435\u0435", "\u043d\u0430\u0438\u043a\u0440\u0430\u0449\u0435", "\u0442\u043e\u043f"]):
        ctx["budget"] = "high"

    # experience
    if any(k in t for k in ["\u0432\u043f\u0435\u0440\u0432\u044b\u0435", "\u0432\u043f\u0435\u0440\u0448\u0435", "\u043d\u043e\u0432\u0438\u0447", "\u043d\u043e\u0432\u0430\u0447", "\u0441\u0442\u0430\u0440\u0442"]):
        ctx["experience"] = "new"
    if any(k in t for k in ["\u0441\u0438\u043b\u044c\u043d", "hard", "\u043e\u043f\u044b\u0442", "\u0434\u043e\u0441\u0432\u0438\u0434", "\u0434\u043e\u0441\u0432\u0456\u0434"]):
        ctx["experience"] = "experienced"

    return ctx


def _chat_build_quick_replies(user_message: str, found_products: list | None = None) -> list[str]:
    ctx = _chat_detect_button_context(user_message)
    chips: list[str] = []

    found_products = found_products or []

    if not user_message.strip():
        return [
            "\u0429\u043e \u0442\u0430\u043a\u0435 \u043c\u0456\u043a\u0440\u043e\u0434\u043e\u0437\u0438\u043d\u0433?",
            "\u0414\u043b\u044f \u0444\u043e\u043a\u0443\u0441\u0443 \u0442\u0430 \u0435\u043d\u0435\u0440\u0433\u0456\u0457",
            "\u0414\u043b\u044f \u0441\u043f\u043e\u043a\u043e\u044e \u0442\u0430 \u0441\u043d\u0443",
            "\u041d\u0430\u0431\u043e\u0440\u0438 \u0434\u043b\u044f \u0441\u0442\u0430\u0440\u0442\u0443",
            "\u041c\u0456\u043a\u0441\u0438",
        ]

    if ctx["topic"] is None:
        chips += [
            "\u041c\u0443\u0445\u043e\u043c\u043e\u0440\u0438",
            "\u0407\u0436\u043e\u0432\u0438\u043a \u0433\u0440\u0435\u0431\u0456\u043d\u0447\u0430\u0441\u0442\u0438\u0439",
            "\u041a\u043e\u0440\u0434\u0438\u0446\u0435\u043f\u0441",
            "\u0427\u0430\u0433\u0430",
            "\u041c\u0456\u043a\u0441\u0438",
        ]

    if ctx["experience"] is None:
        chips += [
            "\u0414\u043b\u044f \u0441\u0442\u0430\u0440\u0442\u0443",
            "\u0421\u0438\u043b\u044c\u043d\u0456\u0448\u0438\u0439 \u0432\u0430\u0440\u0456\u0430\u043d\u0442",
        ]

    if ctx["form"] is None:
        chips += [
            "\u041a\u0430\u043f\u0441\u0443\u043b\u0438",
            "\u041f\u043e\u0440\u043e\u0448\u043e\u043a",
        ]

    if ctx["goal"] is None:
        chips += [
            "\u0424\u043e\u043a\u0443\u0441",
            "\u0421\u043f\u043e\u043a\u0456\u0439",
            "\u0415\u043d\u0435\u0440\u0433\u0456\u044f",
            "\u0406\u043c\u0443\u043d\u0456\u0442\u0435\u0442",
        ]

    if found_products:
        chips += [
            "\u0411\u044e\u0434\u0436\u0435\u0442\u043d\u043e",
            "\u041f\u0440\u0435\u043c\u0456\u0443\u043c",
        ]
    else:
        chips += [
            "\u041c\u0456\u043a\u0441\u0438",
            "\u0414\u043b\u044f \u0441\u0442\u0430\u0440\u0442\u0443",
            "\u0417\u0432\u2019\u044f\u0437\u0430\u0442\u0438\u0441\u044f \u0437 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u043e\u043c",
        ]

    seen = set()
    out = []
    for chip in chips:
        if chip not in seen:
            seen.add(chip)
            out.append(chip)

    return out[:6]


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






def _chat_normalize_code(text: str) -> str:
    if not text:
        return ""

    t = str(text).upper()
    mapping = {
        "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K",
        "\u041c": "M", "\u041d": "H", "\u041e": "O", "\u0420": "P",
        "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0427": "CH",
        "\u0406": "I", "\u0407": "I",
    }

    for src, dst in mapping.items():
        t = t.replace(src, dst)

    return "".join(ch for ch in t if ch.isalnum())


def _chat_direct_product_ids_by_sku_or_alias(user_message: str, products: list, max_count: int = 3) -> List[int]:
    t = _chat_normalize_text(user_message or "")
    query_code = _chat_normalize_code(user_message or "")

    # Manual aliases for known problematic web-chat requests.
    # Important: aliases must run BEFORE generic SKU search.
    alias_rules = [
        (
            [
                "настойк",
                "настоянк",
            ],
            ["мухом"],
            [361],
        ),
        (
            ["250"],
            [],
            [361],
        ),
        (
            ["MXMCH025H25", "MXM025H25"],
            [],
            [361],
        ),
        (
            ["микродоз", "мікродоз"],
            ["мухомор"],
            [23, 63, 50],
        ),
        (
            ["сон", "сна", "сну", "sleep", "спокий", "спокой"],
            [],
            [91, 15, 16],
        ),
    ]

    for must_any, also_any, ids in alias_rules:
        match_main = any(
            _chat_normalize_text(x) in t or _chat_normalize_code(x) in query_code
            for x in must_any
        )
        match_extra = True if not also_any else any(
            _chat_normalize_text(x) in t or _chat_normalize_code(x) in query_code
            for x in also_any
        )

        if match_main and match_extra:
            return ids[:max_count]

    scored: List[tuple] = []

    # SKU / external_id exact-ish matching.
    # Do NOT search by product id as substring: "250мл" must not match product id 250.
    if query_code:
        for p in products:
            fields = [
                p.get("sku"),
                p.get("external_id"),
            ]

            for field in fields:
                field_code = _chat_normalize_code(field)
                if field_code and len(field_code) >= 4 and (query_code in field_code or field_code in query_code):
                    scored.append((100, p.get("id")))
                    break

    # Conservative name matching only for meaningful text queries.
    if len(t) >= 5:
        for p in products:
            name = p.get("name")
            name_text = _chat_normalize_text(name)
            if name_text and (t in name_text or name_text in t):
                scored.append((70, p.get("id")))

    scored.sort(key=lambda x: x[0], reverse=True)

    out: List[int] = []
    seen = set()
    for _, pid in scored:
        if pid and pid not in seen:
            seen.add(pid)
            out.append(pid)
        if len(out) >= max_count:
            break

    return out

def _chat_fallback_product_ids_by_catalog_base(user_message: str, max_count: int = 3) -> List[int]:
    query_tokens = [_chat_stem_token(t) for t in _chat_tokenize(user_message)]
    query_tokens = [t for t in query_tokens if len(t) >= 3]

    if not query_tokens:
        return []

    scored: List[tuple] = []

    for name, pid in _CHAT_PRODUCTS_NAME_TO_ID:
        normalized_name = _chat_normalize_text(name)
        score = 0

        for token in query_tokens:
            if token in normalized_name:
                score += 10

        if score > 0:
            scored.append((score, pid))

    scored.sort(key=lambda x: x[0], reverse=True)

    out: List[int] = []
    seen = set()
    for _, pid in scored:
        if pid not in seen:
            seen.add(pid)
            out.append(pid)
        if len(out) >= max_count:
            break

    return out


def _chat_fallback_product_ids_by_intents(intents: List[str], normalized_text: str) -> List[int]:
    ids: List[int] = []

    if "focus" in intents:
        ids += [39186, 39171, 39210]

    if "energy" in intents:
        ids += [39206, 39202, 39222]

    if "immunity" in intents:
        ids += [39151, 39173, 39212]

    if "sleep" in intents or "stress" in intents:
        ids += [39186, 39205, 39175]

    if "digest" in intents:
        ids += [39162, 39159, 39158]

    if "\u043c\u0456\u043a\u0440\u043e\u0434\u043e\u0437" in normalized_text or "\u043c\u0438\u043a\u0440\u043e\u0434\u043e\u0437" in normalized_text:
        ids += [39181, 39208, 39235]

    seen = set()
    out: List[int] = []
    for pid in ids:
        if pid not in seen:
            seen.add(pid)
            out.append(pid)

    return out[:3]


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """Умный эндпоинт чата с поддержкой GPT и поиска товаров"""
    try:
        if request.message:
            user_message = request.message
        elif request.messages:
            user_message = request.messages[-1].content
        else:
            user_message = ""

        session_id = (request.session_id or "anon").strip() or "anon"

        if not (user_message or "").strip():
            quick = [
                "Що таке мікродозинг?",
                "Для фокусу та енергії",
                "Для спокою та сну",
                "Набори для старту",
                "Мікси",
            ]
            return ChatResponse(
                message="",
                reply="",
                products=[],
                items=[],
                quick_replies=quick,
                session_id=session_id,
            )

        contact_raw = (user_message or "").lower()
        contact_norm = _chat_normalize_text(user_message or "")
        if (
            "менеджер" in contact_norm
            or "контакт" in contact_norm
            or "телефон" in contact_norm
            or "зв'яз" in contact_raw
            or "зв’яз" in contact_raw
            or "звʼяз" in contact_raw
            or "связ" in contact_norm
        ):
            text = (
                "Зв’язатися з менеджером можна так:\n\n"
                "📞 Телефон: (063) 25 26 8 24\n"
                "📲 Viber: viber://chat?number=%2B380632526824\n"
                "✈️ Telegram: https://t.me/Dikorosua\n"
                "✉️ Email: dikorosua@gmail.com"
            )
            quick = ["Доставка", "Оплата", "Повернення", "Мухомори", "Мікси", "Для старту"]
            await _send_telegram_manager_message(
                "💬 Клієнт просить зв’язатися з менеджером\n"
                f"Session: {session_id}\n\n"
                f"👤 Клієнт: {user_message}"
            )
            return ChatResponse(
                message=text,
                reply=text,
                products=[],
                items=[],
                quick_replies=quick,
                session_id=session_id,
            )

        user_message_lower = user_message.lower()
        normalized_message = _chat_normalize_text(user_message)
        intents = _chat_detect_intents(normalized_message)
        is_info_question = _chat_is_info_question(user_message)

        should_notify_manager = bool((user_message or "").strip())

        if should_notify_manager:
            await _send_telegram_manager_message(
                "💬 Нове повідомлення з сайту Dikoros\n"
                f"Session: {session_id}\n\n"
                f"👤 Клієнт: {user_message}"
            )

        if normalized_message.strip() in {
            "каталог", "catalog",
            "бюджетно",
            "преміум", "премиум",
            "сильніший варіант", "сильниший вариант",
            "сильніший", "сильниший", "сильнее"
        }:
            if normalized_message.strip() in {"бюджетно"}:
                text = "Щоб підібрати бюджетний варіант, обери спочатку напрямок:"
            elif normalized_message.strip() in {"преміум", "премиум"}:
                text = "Щоб підібрати преміум-варіант, обери спочатку категорію:"
            elif normalized_message.strip() in {"сильніший варіант", "сильниший вариант", "сильніший", "сильниший", "сильнее"}:
                text = "Щоб підібрати сильніший варіант без помилки, обери категорію:"
            else:
                text = (
                    "Я не відкриваю весь каталог одним списком, але можу швидко підібрати товари за напрямком. "
                    "Обери, що тебе цікавить:"
                )

            quick = ["Мухомори", "Їжовик гребінчастий", "Кордицепс", "Чага", "Мікси", "Для старту"]
            if should_notify_manager:
                await _send_telegram_manager_message(
                    "🤖 Відповідь бота Dikoros\n"
                    f"Session: {session_id}\n\n"
                    f"{text}"
                )
            return ChatResponse(message=text, reply=text, products=[], items=[], quick_replies=quick, session_id=session_id)

        greeting_words = {"привет", "привіт", "добрый день", "добрий день", "здравствуйте", "вітаю", "hello", "hi"}
        if normalized_message.strip() in greeting_words:
            text = "Привіт! 😊 Я консультант DikorosUA. Допоможу підібрати гриби, мікродозинг, трави або відповім по доставці й оплаті."
            await _send_telegram_manager_message(
                "🤖 Відповідь бота Dikoros\n"
                f"Session: {session_id}\n\n"
                f"{text}"
            )
            return ChatResponse(message=text, reply=text, products=[], items=[], quick_replies=["Мухомори", "Їжовик гребінчастий", "Кордицепс", "Чага", "Мікси", "Доставка", "Оплата"], session_id=session_id)

        # 1. Поиск товаров (Улучшенный: Python-фильтрация для поддержки кириллицы и поиска в описании)
        conn = get_db_connection()

        # Загружаем только нужные поля (быстрее и меньше памяти)
        all_products_rows = conn.execute(
            """
            SELECT id, name, category, price, old_price, image, images,
                   description, usage, composition, link_url, status, sku, external_id
            FROM products
            WHERE status = 'available'
              AND coalesce(trim(link_url), '') <> ''
            """
        ).fetchall()
        all_products = [dict(r) for r in all_products_rows]
        conn.close()

        def _topic_products_by_needles(needles: list[str], limit: int = 3, exclude_needles: list[str] | None = None) -> list[dict]:
            scored = []
            exclude_needles = exclude_needles or []

            for product in all_products:
                name = (product.get("name") or "").strip()
                if not name:
                    continue

                norm_name = _chat_normalize_text(name)
                raw_name = name.lower()

                if "без назви" in norm_name:
                    continue

                if any(n in norm_name or n in raw_name for n in exclude_needles):
                    continue

                if not any(n in norm_name or n in raw_name for n in needles):
                    continue

                score = 0

                for needle in needles:
                    if needle in norm_name or needle in raw_name:
                        score += 30

                if "капсул" in norm_name:
                    score += 8
                if "порош" in norm_name or "баноч" in norm_name:
                    score += 6
                if "мікродоз" in raw_name or "микродоз" in raw_name:
                    score += 5
                if "1 грам" in norm_name or "1грам" in norm_name:
                    score -= 6

                price = product.get("price")
                try:
                    if price is not None and float(price) <= 10:
                        score -= 5
                except Exception:
                    pass

                scored.append((score, int(product.get("id") or 0), product))

            scored.sort(key=lambda x: (x[0], x[1]), reverse=True)

            out = []
            seen_keys = set()

            for _, _, product in scored:
                key = _chat_normalize_text((product.get("name") or "").strip())
                if key in seen_keys:
                    continue

                seen_keys.add(key)
                out.append(product)

                if len(out) >= limit:
                    break

            return out

        def _exact_quick_reply_products(normalized_text: str) -> list[dict]:
            t = (normalized_text or "").strip()

            if "чага" in t or "chaga" in t:
                return _topic_products_by_needles(["чаг", "chaga"], 3)

            if "кордицеп" in t or "cordyceps" in t:
                return _topic_products_by_needles(
                    ["кордицеп", "cordyceps"],
                    3,
                    ["мухомор", "amanita", "mix", "мікс", "микс"]
                )

            if (
                "іжовик" in t
                or "їжовик" in t
                or "ижовик" in t
                or "ежовик" in t
                or "hericium" in t
                or "lion" in t
                or "mane" in t
            ):
                return _topic_products_by_needles(
                    ["іжовик", "їжовик", "ижовик", "ежовик", "hericium", "lion", "mane"],
                    3,
                    ["мухомор", "amanita", "mix", "мікс", "микс"]
                )

            if (
                ("настойк" in t or "настоянк" in t or "250" in t)
                and ("мухомор" in t or "amanita" in t)
            ):
                tincture_products = get_products_by_ids([361])
                if tincture_products:
                    return tincture_products

            if "мухомор" in t or "amanita" in t:
                return _topic_products_by_needles(
                    ["мухомор", "amanita"],
                    3,
                    ["mix", "мікс", "микс", "кордицеп", "cordyceps", "їжовик", "іжовик", "ежовик", "hericium"]
                )

            if "лисич" in t or "cantharellus" in t:
                return _topic_products_by_needles(["лисич", "cantharellus"], 3)

            return []

        # Токены запроса (со стоп-словами и нормализацией)
        words = _chat_tokenize(user_message_lower)
        words = [_chat_stem_token(w) for w in words]
        # Убираем повторы, сохраняя порядок
        seen = set()
        words = [w for w in words if not (w in seen or seen.add(w))]

        if is_info_question:
            words = []

        found_products = []

        exact_quick_reply_products = _exact_quick_reply_products(normalized_message)
        if not is_info_question and exact_quick_reply_products:
            found_products = exact_quick_reply_products

        # Hard route for energy intent: prefer pure cordyceps products, not amanita mixes.
        if not is_info_question and not found_products and "energy" in intents:
            found_products = _topic_products_by_needles(
                ["кордицеп", "cordyceps"],
                3,
                ["мухомор", "amanita", "mix", "мікс", "микс"]
            )

        # Hard route for sleep/calm intent: avoid random "сон..." matches like honey/sunflower.
        if (
            not is_info_question
            and (
                "sleep" in intents
                or "stress" in intents
                or "для спокою та сну" in normalized_message
                or "сон" in normalized_message
                or "сна" in normalized_message
                or "сну" in normalized_message
                or "спок" in normalized_message
                or "спокой" in normalized_message
            )
        ):
            found_products = get_products_by_ids([15, 16, 55])

        if not is_info_question and "набори для старту" in normalized_message:
            found_products = get_products_by_ids([11, 69, 65])

        if not is_info_question and normalized_message.strip() in ("мікси", "микси"):
            found_products = get_products_by_ids([11, 58, 69])

        if not is_info_question and not found_products:
            direct_ids = _chat_direct_product_ids_by_sku_or_alias(user_message, all_products)
            if direct_ids:
                found_products = get_products_by_ids(direct_ids)

        if not is_info_question and not found_products and ("лисич" in normalized_message or "cantharellus" in normalized_message):
            found_products = _topic_products_by_needles(["лисич", "cantharellus"], 3)

        if words and not found_products:
            import re

            token_patterns: List[tuple] = []
            for w in words:
                # \b works fine for unicode letters in python regex.
                token_patterns.append((w, re.compile(rf"\b{re.escape(w)}\b", flags=re.IGNORECASE)))

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
        if not is_info_question and not found_products:
            fallback_ids = _chat_fallback_product_ids_by_catalog_base(user_message)
            if not fallback_ids:
                fallback_ids = _chat_fallback_product_ids_by_intents(intents, normalized_message)
            if fallback_ids:
                found_products = get_products_by_ids(fallback_ids)

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
CHAT KNOWLEDGE BASE DIKOROS\nUse this block for company, production, quality, shipping, payment, returns and contacts:\n{CHAT_KNOWLEDGE_TEXT}\n\nINFO_MODE: {is_info_question}\nIf INFO_MODE is True, answer only from CHAT KNOWLEDGE BASE DIKOROS, do not recommend products, do not add IDs, and do not mention product cards.\n\n{products_context}

ВАЖЛИВО ПРО ТОВАРИ
Якщо в блоці "ДОСТУПНІ ТОВАРИ" є товари — описуй і рекомендуй тільки їх. Не бери товари з загального каталогу, не вигадуй назви, не додавай товари без ID.

ПРАВИЛО КАРТОЧОК (обовʼязково)
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
* Привітання: Не починай кожну відповідь з "Привіт", "Вітаю", "Доброго дня". Вітайся тільки якщо користувач сам привітався.

ПРИКЛАД ІДЕАЛЬНОГО ФОРМАТУ (завжди рівно 3 товари):
«😊 Для твоїх цілей підійдуть такі продукти:

🍄 **Чага березова (Імунітет+)** — це потужний природний захист. Вона допомагає організму чинити опір вірусам.

⚡ **Мікродозінг Power+** — дасть необхідний заряд енергії на весь день.

🌿 **Кордицепс військовий сушений** — підтримує витривалість і відновлення.

Чи є в тебе ще питання по цих грибах? 👇

IDs: [39151, 39206, 39202]»
"""

            history = [{"role": "system", "content": system_prompt}]
            # Supports both formats: legacy messages[] and shopbot-compatible message/session_id.
            if request.messages:
                for msg in request.messages[-3:]:
                    role = "user" if msg.role == "user" else "assistant"
                    history.append({"role": role, "content": msg.content})
            else:
                history.append({"role": "user", "content": user_message})

            try:
                completion = await openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=history,
                    temperature=0.3,
                    max_tokens=500
                )
                response_text = completion.choices[0].message.content
            except Exception:
                logger.exception("CHAT OPENAI ERROR")
                if is_info_question:
                    response_text = _chat_info_fallback_answer(user_message)
                elif found_products:
                    names = [p.get("name") for p in found_products[:3] if p.get("name")]
                    response_text = (
                        "Знайшов відповідні товари за вашим запитом:\n\n"
                        + "\n".join(f"* **{name}**" for name in names)
                    )
                else:
                    response_text = "Вибачте, я не знайшов товарів за вашим запитом. Спробуйте уточнити назву або артикул."
        else:
            # Fallback (если нет ключа API)
            if found_products:
                response_text = "Ось що я знайшов за вашим запитом. Перегляньте ці товари:"
            else:
                response_text = "Вибачте, я не знайшов товарів за вашим запитом. Спробуйте змінити пошук (наприклад 'Їжовик' або 'Кордицепс')."

        # Підбір карточок: спочатку рядок IDs: [id1, id2, id3], інакше — згадки товарів у тексті (max_count=3)
        # Info questions: cards disabled.
        if is_info_question:
            response_text = _strip_ids_line_from_response(response_text)
            chat_products = []
        else:
            mentioned_ids = _extract_product_ids_from_text(response_text, max_count=3)

            # Keep only product IDs that came from current search results.
            # This prevents GPT from attaching random catalog items/cards.
            if mentioned_ids and found_products:
                allowed_ids = {
                    int(p.get("id"))
                    for p in found_products
                    if p.get("id") is not None
                }
                mentioned_ids = [
                    int(pid)
                    for pid in mentioned_ids
                    if int(pid) in allowed_ids
                ]

            if mentioned_ids:
                chat_products = get_products_by_ids(mentioned_ids)

                # Safety fallback: if extracted ids are stale/wrong and DB returns no cards,
                # use already found products from the current search.
                if not chat_products and found_products:
                    fallback_ids = []
                    seen_ids = set()
                    for p in found_products:
                        pid = p.get("id")
                        if pid and pid not in seen_ids:
                            seen_ids.add(pid)
                            fallback_ids.append(pid)
                        if len(fallback_ids) >= 3:
                            break
                    chat_products = get_products_by_ids(fallback_ids)
            elif found_products:
                fallback_ids = []
                seen_ids = set()
                for p in found_products:
                    pid = p.get("id")
                    if pid and pid not in seen_ids:
                        seen_ids.add(pid)
                        fallback_ids.append(pid)
                    if len(fallback_ids) >= 3:
                        break
                chat_products = get_products_by_ids(fallback_ids)
            else:
                chat_products = []

        # Strip technical IDs line before sending to frontend
        response_text = _strip_ids_line_from_response(response_text)

        if is_info_question and any(x in (user_message or "").lower() for x in ["мікродоз", "микродоз", "microdos", "microdose"]):
            response_text = (
                "Мікродозинг — це підхід, коли продукт вживають у дуже малих кількостях, "
                "щоб м’яко підтримати фокус, настрій або загальне самопочуття без різкого ефекту.\n\n"
                "🍄 У контексті Dikoros найчастіше мають на увазі грибні продукти у капсулах або порошку.\n\n"
                "🌿 Якщо хочеш, я можу допомогти підібрати варіант під конкретну ціль: фокус, енергія, спокій або старт."
            )
            chat_products = []

        def _is_russian_request(text: str) -> bool:
            t = (text or "").lower()
            return any(ch in t for ch in "ыэъё") or any(w in t for w in ["что", "посовет", "для", "энерг", "фокус", "можно", "нужно", "подбери", "есть"])

        def _build_grounded_products_reply(products: list[dict], user_text: str) -> str:
            if not products:
                return response_text

            intro = (
                "😊 За твоїм запитом я б запропонував цей варіант:" if len(products[:3]) == 1
                else "😊 За твоїм запитом я б запропонував ці варіанти:"
            )
            outro = (
                "Нижче прикріпив картку — можна відкрити товар і подивитися деталі. 👇"
                if len(products[:3]) == 1
                else "Нижче прикріпив карточки — можна відкрити товар і подивитися деталі. 👇"
            )

            lines = [intro, ""]
            icons = ["🍄", "⚡", "🌿"]
            for i, product in enumerate(products[:3]):
                name = (product.get("name") or product.get("title") or "").strip()
                desc = "підходить під цей запит і може бути корисним для обраної цілі"
                lines.append(f"{icons[i % len(icons)]} **{name}** — {desc}.")
                lines.append("")
            lines.append(outro)
            return "\n".join(lines).strip()

        def _as_chat_product(p: dict) -> dict:
            image = p.get("image")
            pictures = []

            if not image:
                try:
                    images = json.loads(p.get("images") or "[]")
                    if isinstance(images, list):
                        pictures = [str(x).strip() for x in images if x and str(x).strip()]
                        if pictures:
                            image = pictures[0]
                except Exception:
                    image = None

            if image and not pictures:
                pictures = [image]

            name = (p.get("name") or "").strip()
            link_url = (p.get("link_url") or "").strip()

            return {
                "id": p.get("id"),

                # App format
                "name": name,
                "image": image,

                # Website widget compatibility format
                "title": name,
                "image_url": image,
                "pictures": pictures,
                "url": link_url,
                "currency": "грн",

                "price": p.get("price") or 0,
                "old_price": p.get("old_price") or 0,
                "description": (p.get("description") or "")[:280],
            }

        def _dedupe_product_key(product: dict) -> str:
            name = _chat_normalize_text(product.get("name") or "")
            # Remove common variant/packaging words so near-duplicates collapse.
            noise_words = [
                "60", "120", "150", "капсул", "капсули", "капсула",
                "грам", "грама", "гр", "0", "5", "баночц", "баночк",
                "порошок", "мелений", "сушений"
            ]
            for word in noise_words:
                name = name.replace(word, " ")
            name = " ".join(name.split()).strip()
            return name[:90]

        unique_chat_products = []
        seen_keys = set()

        for product in chat_products:
            key = _dedupe_product_key(product)
            if key and key in seen_keys:
                continue
            seen_keys.add(key)
            unique_chat_products.append(product)

        # If dedupe removed too much, fill from found_products with next unique items.
        if len(unique_chat_products) < 3 and found_products:
            existing_ids = {p.get("id") for p in unique_chat_products}
            for product in found_products:
                pid = product.get("id")
                key = _dedupe_product_key(product)
                if not pid or pid in existing_ids or key in seen_keys:
                    continue
                seen_keys.add(key)
                existing_ids.add(pid)
                unique_chat_products.append(product)
                if len(unique_chat_products) >= 3:
                    break

        exact_quick_reply_products = _exact_quick_reply_products(normalized_message)
        if exact_quick_reply_products:
            unique_chat_products = exact_quick_reply_products
            seen_keys = {_dedupe_product_key(p) for p in unique_chat_products}

        if "для спокою та сну" in normalized_message:
            unique_chat_products = get_products_by_ids([196])
            seen_keys = {_dedupe_product_key(p) for p in unique_chat_products}

        if "набори для старту" in normalized_message:
            unique_chat_products = get_products_by_ids([11, 69, 65])
            seen_keys = {_dedupe_product_key(p) for p in unique_chat_products}

        if normalized_message.strip() in ("мікси", "микси"):
            unique_chat_products = get_products_by_ids([11, 58, 69])
            seen_keys = {_dedupe_product_key(p) for p in unique_chat_products}

        # If search produced less than 3 cards, fill with linked available products by detected intents.
        if len(unique_chat_products) < 3 and all_products and intents:
            intent_needles = {
                "focus": ["їжовик", "ежовик", "lion", "mane", "фокус"],
                "energy": ["кордицеп", "cordyceps", "енергі", "энерг"],
                "immunity": ["чага", "chaga", "рейш", "reishi", "імун", "иммун"],
                "sleep": ["рейш", "reishi"],
                "stress": ["рейш", "reishi", "ашваганд", "спок", "стрес"],
            }

            existing_ids = {p.get("id") for p in unique_chat_products}
            scored_fill = []

            for product in all_products:
                pid = product.get("id")
                if not pid or pid in existing_ids:
                    continue

                name_text = _chat_normalize_text(product.get("name") or "")
                score = 0

                for intent in intents:
                    for needle in intent_needles.get(intent, []):
                        if needle in name_text:
                            score += 20

                if score > 0:
                    scored_fill.append((score, product))

            scored_fill.sort(key=lambda x: x[0], reverse=True)

            for _, product in scored_fill:
                key = _dedupe_product_key(product)
                pid = product.get("id")
                if not pid or pid in existing_ids or key in seen_keys:
                    continue

                seen_keys.add(key)
                existing_ids.add(pid)
                unique_chat_products.append(product)

                if len(unique_chat_products) >= 3:
                    break

        final_products = [_as_chat_product(p) for p in unique_chat_products[:3]]

        if final_products and not is_info_question:
            response_text = _build_grounded_products_reply(unique_chat_products[:3], user_message)

        quick_replies = _chat_info_quick_replies() if is_info_question else _chat_build_quick_replies(user_message, final_products)

        if should_notify_manager:
            await _send_telegram_manager_message(
                "🤖 Відповідь бота Dikoros\n"
                f"Session: {session_id}\n\n"
                f"{response_text}"
                + _format_telegram_products(final_products)
            )

        return ChatResponse(
            message=response_text,
            products=final_products,
            reply=response_text,
            items=final_products,
            quick_replies=quick_replies,
            session_id=session_id,
        )

    except Exception as e:
        logger.exception("CHAT ERROR")
        error_text = "\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430. \u0421\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437."
        return ChatResponse(
            message=error_text,
            products=[],
            reply=error_text,
            items=[],
            quick_replies=[
                "\u041a\u0430\u0442\u0430\u043b\u043e\u0433",
                "\u0417\u0432\u2019\u044f\u0437\u0430\u0442\u0438\u0441\u044f \u0437 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u043e\u043c",
            ],
            session_id=(getattr(request, "session_id", None) or "anon"),
        )

@router.post("/api/chat")
async def chat_endpoint_api(request: ChatRequest):
    return await chat_endpoint(request)


@router.post("/api/v1/chat")
async def chat_endpoint_api_v1(request: ChatRequest):
    return await chat_endpoint(request)
