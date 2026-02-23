#!/usr/bin/env python3
"""
Run locally (where shaketopay.com.ua is accessible):
  python3 fetch_and_patch.py

Fetches real Dom Jamon menu → patches app.js inline data with:
  - Correct 9-tab main category structure
  - Subcategory bold headings within each tab
  - Real descriptions (HTML stripped, newlines preserved)
  - Real thumbnail image URLs
"""

import json, re, html as html_mod, urllib.request, sys, os

API_URL = "https://static.shaketopay.com.ua/menu/prod/cache/menu/c2778cba-60f1-42d2-b394-3965c7f561d8/uk/menu.json?cache=1771775451773"

MAIN_CATS = [
    ("wine",     "Винна Карта", [
        (148458, "Вина в келихах"),
        (81518,  "Білі"),
        (83341,  "Рожеві"),
        (81519,  "Червоні"),
        (148457, "Шампанське"),
        (148683, "Просеко"),
        (81520,  "Ігристі"),
    ]),
    ("cocktails","Коктейлі", [(81819, "Коктейлі")]),
    ("spirits",  "Міцний алкоголь", [
        (92889,  "Віскі"),
        (148700, "Коньяк / Бренді / Портвейн / Мадейра / Херес / Граппа"),
        (148768, "Ром"),
        (108992, "Горілка / Джин"),
    ]),
    ("beer",     "Пиво", [
        (84343,  "Пиво"),
        (150583, "Сікера"),
    ]),
    ("drinks",   "Напої", [
        (148724, "Глінтвейн"),
        (81967,  "Кава"),
        (81969,  "Чай"),
        (82123,  "Прохолодне"),
        (84341,  "Газовані напої / вода"),
    ]),
    ("food",     "Поїсти", [
        (162091, "Сніданки"),
        (162093, "Стартери"),
        (163643, "Пінчо"),
        (161930, "Салати"),
        (163163, "Супи"),
        (162088, "Основні страви"),
    ]),
    ("buffet",   "Фуршетні Бокси", [(81732, "Фуршетні Бокси")]),
    ("icecream", "Морозиво",        [(100736, "Морозиво")]),
    ("other",    "Інше",            [(108997, "Інше")]),
]

TAG_MAP = {
    318000: "Ігристе",      317997: "Напівсухе",    322013: "Солодке",
    323562: "По бокалу",    318060: "Безалкогольне", 322689: "Вина України",
    317926: "Напівсолодке", 317925: "Сухе",          323724: "Декантування",
    323729: "Витримане",    323730: "Десертне",       323780: "Торф/Дим",
    323781: "Сабраж",       323597: "Рек. Юлія",     323598: "Рек. Катерина",
    323599: "Аперитив",
}

def strip_html(text):
    if not text: return ''
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'</p>\s*<p[^>]*>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html_mod.unescape(text).strip()
    return re.sub(r'\n{3,}', '\n\n', text)

def fetch_menu():
    print(f"Fetching menu API...")
    req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def build_menu(raw):
    dishes_by_cat = {}
    for d in raw.get("dishes", []):
        if not d.get("active", True): continue
        dishes_by_cat.setdefault(d["categoryId"], []).append(d)

    def variant_label(v):
        if v.get("description"): return v["description"]
        if v.get("unit") and v.get("amount"):
            amt = int(v["amount"]) if float(v["amount"]) == int(float(v["amount"])) else v["amount"]
            return f"{amt} {v['unit']}"
        return ""

    def make_item(d):
        img = d.get("thumbnailUrl") or d.get("imageUrl") or None
        if img and ("emptyDishImage" in img or not img.strip()): img = None
        variants = [v for v in d.get("dishVariants", []) if v.get("active", True)]
        if not variants: variants = d.get("dishVariants", [])
        tags = [TAG_MAP[t["id"] if isinstance(t,dict) else t]
                for t in d.get("tags", [])
                if (t["id"] if isinstance(t,dict) else t) in TAG_MAP]
        item = {
            "id":    d["id"],
            "name":  d["title"],
            "desc":  strip_html(d.get("description", "")),
            "tags":  tags,
            "image": img,
        }
        if len(variants) == 1:
            item["price"] = int(float(variants[0]["price"]))
        else:
            choices = [{"label": variant_label(v), "price": int(float(v["price"]))} for v in variants]
            item["price"]   = min(c["price"] for c in choices)
            item["options"] = {"label": "Розмір / Об'єм", "choices": choices}
        return item

    categories = []
    for main_id, main_name, subs in MAIN_CATS:
        subs_with_items = [(cid, sname) for cid, sname in subs if dishes_by_cat.get(cid)]
        flat = []
        for cat_id, sub_name in subs:
            items = dishes_by_cat.get(cat_id, [])
            if not items: continue
            if len(subs_with_items) > 1:
                flat.append({"_heading": sub_name})
            flat.extend(make_item(d) for d in items)
        if flat:
            categories.append({"id": main_id, "name": main_name, "items": flat})

    return {"categories": categories}

def patch_appjs(menu_data, appjs_path):
    with open(appjs_path, "r", encoding="utf-8") as f:
        content = f.read()
    menu_json = json.dumps(menu_data, ensure_ascii=False)
    new_content, n = re.compile(r'const data = \{.*?\};', re.DOTALL).subn(
        f'const data = {menu_json};', content, count=1)
    if not n:
        print("ERROR: 'const data = {...}' not found in app.js"); return False
    with open(appjs_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    total = sum(1 for c in menu_data["categories"] for i in c["items"] if not i.get("_heading"))
    imgs  = sum(1 for c in menu_data["categories"] for i in c["items"] if not i.get("_heading") and i.get("image"))
    print(f"✅ Patched {appjs_path}: {len(menu_data['categories'])} tabs, {total} items, {imgs} images")
    return True

if __name__ == "__main__":
    appjs = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.js")
    if not os.path.exists(appjs):
        print(f"ERROR: app.js not found at {appjs}"); sys.exit(1)
    try:
        raw = fetch_menu()
    except Exception as e:
        print(f"ERROR fetching menu: {e}"); sys.exit(1)
    menu = build_menu(raw)
    patch_appjs(menu, appjs)