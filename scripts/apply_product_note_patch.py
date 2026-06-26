from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"Missing pattern in {path}: {old[:160]!r}")
    write(path, text.replace(old, new, 1))


def regex_replace_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"Missing regex pattern in {path}: {pattern[:160]!r}")
    write(path, updated)


# --- DB schema ---
replace_once(
    "services/db_schema.py",
    """            description TEXT,
            usage TEXT,""",
    """            description TEXT,
            product_note TEXT,
            usage TEXT,""",
)
replace_once(
    "services/db_schema.py",
    """    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS return_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT")""",
    """    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS return_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS product_note TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT")""",
)

# --- API response fields ---
replace_once(
    "routers/products.py",
    """    old_price, unit, description, usage, composition, delivery_info, return_info,""",
    """    old_price, unit, description, product_note, usage, composition, delivery_info, return_info,""",
)

# --- Pydantic schemas ---
for _ in range(3):
    replace_once(
        "models/schemas.py",
        """    description: Optional[str] = None
    usage: Optional[str] = None""",
        """    description: Optional[str] = None
    product_note: Optional[str] = None
    usage: Optional[str] = None""",
    )

# --- Horoshop sync: note extraction and persistence ---
replace_once(
    "services/catalog_sync.py",
    """def _sanitize_description(value: object) -> str:
    text = _localized_value(value or {})
    text = str(text or "").strip()

    # Horoshop can sometimes return a whole product page/html dump instead of a clean tab.
    # Do not persist page dumps into product descriptions.
    if len(text) > 30000:
        return ""

    lower = text.casefold()
    garbage_markers = (
        "catalogtabs",
        "j-product-container",
        "specialoffers",
        "особистий кабінет",
        "кошик",
        "схожі товари",
        "переглянуті товари",
    )
    if sum(1 for marker in garbage_markers if marker in lower) >= 2:
        return ""

    return text
""",
    """def _sanitize_description(value: object) -> str:
    text = _localized_value(value or {})
    text = str(text or "").strip()

    # Horoshop can sometimes return a whole product page/html dump instead of a clean tab.
    # Do not persist page dumps into product descriptions.
    if len(text) > 30000:
        return ""

    lower = text.casefold()
    garbage_markers = (
        "catalogtabs",
        "j-product-container",
        "specialoffers",
        "особистий кабінет",
        "кошик",
        "схожі товари",
        "переглянуті товари",
    )
    if sum(1 for marker in garbage_markers if marker in lower) >= 2:
        return ""

    return text


PRODUCT_NOTE_KEY_TOKENS = (
    "product_note",
    "note",
    "notes",
    "notice",
    "remark",
    "remarks",
    "disclaimer",
    "warning",
    "prim",
    "prym",
    "прим",
)
PRODUCT_NOTE_HEADINGS = {"примітка", "примечание", "примітки", "примечания", "note", "notes"}
PRODUCT_NOTE_STOP_HEADINGS = {
    "опис",
    "огляд",
    "детальніше",
    "характеристики",
    "спосіб застосування",
    "спосіб застосування та протипоказання",
    "протипоказання",
    "застереження",
    "попередження",
    "доставка",
    "оплата",
    "повернення",
    "відгуки",
}


def _plain_text_from_html(value: object) -> str:
    text = _localized_value(value or {}) if isinstance(value, dict) else str(value or "")
    text = unescape(str(text or ""))
    text = re.sub(r"(?is)<script\b.*?</script>", " ", text)
    text = re.sub(r"(?is)<style\b.*?</style>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(?:p|div|li|h[1-6]|tr)>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalized_heading(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().casefold()).strip(" .:：")


def _extract_labeled_product_note(value: object) -> str:
    text = _plain_text_from_html(value)
    if not text:
        return ""

    active = False
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        heading = _normalized_heading(line)
        if heading in PRODUCT_NOTE_HEADINGS:
            active = True
            continue
        if active and heading in PRODUCT_NOTE_STOP_HEADINGS:
            break
        if active:
            lines.append(line)

    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()

    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _extract_product_note(item: dict, description: str = "") -> str:
    for key, value in item.items():
        lowered = str(key or "").casefold()
        if not any(token in lowered for token in PRODUCT_NOTE_KEY_TOKENS):
            continue
        text = _plain_text_from_html(value)
        if text:
            return _extract_labeled_product_note(text) or text

    return _extract_labeled_product_note(description)
""",
)
replace_once(
    "services/catalog_sync.py",
    """                description = _sanitize_description(item.get("description") or {})
                site_url = primary_product_url(item, domain)""",
    """                description = _sanitize_description(item.get("description") or {})
                product_note = _extract_product_note(item, description)
                site_url = primary_product_url(item, domain)""",
)
replace_once(
    "services/catalog_sync.py",
    """                            description = ?, image = ?, images = ?,
                            parent_sku = ?, variant_name = ?, variant_options = ?,""",
    """                            description = ?, product_note = ?, image = ?, images = ?,
                            parent_sku = ?, variant_name = ?, variant_options = ?,""",
)
replace_once(
    "services/catalog_sync.py",
    """                            description,
                            img,""",
    """                            description,
                            product_note,
                            img,""",
)
replace_once(
    "services/catalog_sync.py",
    """                            sku, name, price, category, status, description,
                            remains, image, images, parent_sku, variant_name, external_id,""",
    """                            sku, name, price, category, status, description, product_note,
                            remains, image, images, parent_sku, variant_name, external_id,""",
)
replace_once(
    "services/catalog_sync.py",
    """                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
    """                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
)
replace_once(
    "services/catalog_sync.py",
    """                            description,
                            remains,""",
    """                            description,
                            product_note,
                            remains,""",
)

# --- Product details UI ---
replace_once(
    "components/ProductDetailsView.tsx",
    """const splitHoroshopProductSections = (text: string): ProductTextSections => {
  const sections = emptyProductTextSections();
  const source = String(text || '').trim();
  if (!source) return sections;

  let activeKey: InfoModalKey = 'description';
  let foundExplicitSection = false;

  source.split(/\r?\n/).forEach((line) => {
    const headingKey = productSectionKeyFromHeading(line);
    if (headingKey) {
      activeKey = headingKey;
      foundExplicitSection = true;
      return;
    }

    sections[activeKey] = `${sections[activeKey]}\n${line}`.trim();
  });

  Object.keys(sections).forEach((key) => {
    const typedKey = key as InfoModalKey;
    sections[typedKey] = sections[typedKey]
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });

  if (!foundExplicitSection && !sections.description) {
    sections.description = source;
  }

  return sections;
};
""",
    """const splitHoroshopProductSections = (text: string): ProductTextSections => {
  const sections = emptyProductTextSections();
  const source = String(text || '').trim();
  if (!source) return sections;

  let activeKey: InfoModalKey = 'description';
  let foundExplicitSection = false;

  source.split(/\r?\n/).forEach((line) => {
    const headingKey = productSectionKeyFromHeading(line);
    if (headingKey) {
      activeKey = headingKey;
      foundExplicitSection = true;
      return;
    }

    sections[activeKey] = `${sections[activeKey]}\n${line}`.trim();
  });

  Object.keys(sections).forEach((key) => {
    const typedKey = key as InfoModalKey;
    sections[typedKey] = sections[typedKey]
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });

  if (!foundExplicitSection && !sections.description) {
    sections.description = source;
  }

  return sections;
};

const noteSectionHeadings = new Set(['примітка', 'примітки', 'примечание', 'примечания', 'note', 'notes']);
const noteStopSectionHeadings = new Set([
  'опис',
  'огляд',
  'детальніше',
  'характеристики',
  'інструкція',
  'інструкція із застосування',
  'спосіб застосування',
  'спосіб застосування та протипоказання',
  'застосування',
  'як приймати',
  'протипоказання',
  'застереження',
  'попередження',
  'доставка',
  'оплата',
  'повернення',
]);

const normalizedSectionHeading = (line: string) => String(line || '')
  .trim()
  .toLowerCase()
  .replace(/[.:：]+$/g, '')
  .replace(/\s+/g, ' ');

const extractProductNoteFromText = (text: string): string => {
  const lines = String(text || '').split(/\r?\n/);
  const out: string[] = [];
  let active = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const heading = normalizedSectionHeading(trimmed);
    if (noteSectionHeadings.has(heading)) {
      active = true;
      return;
    }
    if (active && noteStopSectionHeadings.has(heading)) {
      active = false;
      return;
    }
    if (active) out.push(trimmed);
  });

  while (out.length && !out[0]) out.shift();
  while (out.length && !out[out.length - 1]) out.pop();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
""",
)
replace_once(
    "components/ProductDetailsView.tsx",
    """  const [descriptionExpanded, setDescriptionExpanded] = React.useState(false);
""",
    "",
)
replace_once(
    "components/ProductDetailsView.tsx",
    """    setDescriptionExpanded(false);
    setInfoModalKey(null);""",
    """    setInfoModalKey(null);""",
)
replace_once(
    "components/ProductDetailsView.tsx",
    """  const productInfoDisplayText = productInfoText || 'Опис товару буде оновлено найближчим часом.';""",
    """  const productNoteText = React.useMemo(() => {
    const directNote = normalizeText(product?.product_note || product?.productNote || product?.note);
    if (directNote) return directNote;
    return extractProductNoteFromText(productInfoText);
  }, [normalizeText, product?.productNote, product?.product_note, product?.note, productInfoText]);

  const productInfoDisplayText = productNoteText;""",
)
regex_replace_once(
    "components/ProductDetailsView.tsx",
    r"  const renderProductInfo = \(text: string\) => \{[\s\S]*?\n  \};\n\n  const renderInfoRow",
    """  const renderProductInfo = (text: string) => {
    const noteLines = String(text || '')
      .split(/\n{2,}|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return (
      <View style={styles.productInfoBlock}>
        <Text style={styles.infoSectionTitle}>Інформація про продукт</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoHeaderRow}>
            <View style={styles.infoIconCircle}>
              <Ionicons name=\"leaf-outline\" size={23} color=\"#FFFFFF\" />
            </View>
            <View style={styles.infoHeaderText}>
              <Text style={styles.infoCardTitle}>Огляд продукту</Text>
              <Text style={styles.infoCardNote}>Коротка інформація. Не є медичною рекомендацією.</Text>
            </View>
          </View>

          <Text style={styles.infoHeading}>Примітка</Text>
          {noteLines.length > 0 ? (
            noteLines.map((item, index) => (
              <Text key={`note-${index}`} style={styles.infoText}>{item}</Text>
            ))
          ) : (
            <Text style={styles.infoText}>Примітка буде оновлена найближчим часом.</Text>
          )}
        </View>
      </View>
    );
  };

  const renderInfoRow""",
)

# --- Handoff ---
replace_once(
    "docs/PRODUCT_CATALOG_SYNC_HANDOFF.md",
    """- `description`
- `image`""",
    """- `description`
- `product_note`
- `image`""",
)
replace_once(
    "docs/PRODUCT_CATALOG_SYNC_HANDOFF.md",
    """- `sku`
- `status`""",
    """- `sku`
- `status`
- `product_note`""",
)
with Path("docs/PRODUCT_CATALOG_SYNC_HANDOFF.md").open("a", encoding="utf-8") as f:
    f.write(
        """

## Product note sync: 2026-06-26

Product detail `Огляд продукту` in the mobile app must show the website `Примітка` text instead of the product description blocks such as `Коротко про товар` / `Детальніше`.

Current required behavior:

- Horoshop / website remains the source of truth for the note text.
- Sync stores the extracted note in `products.product_note`.
- Product API responses include `product_note`.
- The mobile PDP displays `Примітка` inside `Огляд продукту` and does not render the long description in that card.
- The existing description/instruction modal rows may still use `description`, `usage`, `composition`, `delivery_info`, and `return_info`.
"""
    )

# Remove temporary patch machinery after the workflow has applied it.
Path(".github/workflows/apply-product-note-sync.yml").unlink(missing_ok=True)
Path("scripts/apply_product_note_patch.py").unlink(missing_ok=True)
