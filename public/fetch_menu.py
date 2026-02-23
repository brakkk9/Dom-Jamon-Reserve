#!/usr/bin/env python3
"""
Run this script locally:
  python3 fetch_and_patch.py

It fetches the real Dom Jamon menu from shaketopay API,
then patches app.js in-place with:
  - Real descriptions (stripped HTML)
  - Real thumbnail image URLs
  - Restructured into main categories with subcategory headings
  - No emojis in category tabs
"""

import json, re, html as html_mod, urllib.request, sys, os

API_URL = "https://static.shaketopay.com.ua/menu/prod/cache/menu/c2778cba-60f1-42d2-b394-3965c7f561d8/uk/menu.json?cache=1771775451773"

# ---------------------------------------------------------------------------
# STRUCTURE: main tabs → list of (sub_id, sub_label)
# ---------------------------------------------------------------------------
MAIN_CATEGORIES = [
    ("drinks",   "Напої", [
        ("mulled",       "Глінтвейн",                   [148724]),
        ("wines_glass",  "Вина в келихах",               [148458]),
        ("wines_white",  "Білі вина",                    [81518]),
        ("wines_rose",   "Рожеві вина",                  [83341]),
        ("wines_red",    "Червоні вина",                 [81519]),
        ("wines_spark",  "Ігристі вина",                 [81520, 148457, 148683]),
        ("cocktails",    "Коктейлі",                     [81819]),
        ("whiskey",      "Віскі",                        [92889]),
        ("spirits",      "Коньяк / Бренді / Портвейн",   [148700]),
        ("rum",          "Ром",                          [148768]),
        ("vodka_gin",    "Горілка / Джин",               [108992]),
        ("beer",         "Пиво",                         [84343, 150583]),
        ("coffee",       "Кава",                         [81967]),
        ("tea",          "Чай / Какао",                  [81969]),
        ("cold",         "Прохолодні напої",             [82123, 84341]),
    ]),
    ("food",     "Їжа", [
        ("breakfast",    "Сніданки",                     [162091]),
        ("starters",     "Стартери",                     [162093]),
        ("pincho",       "Пінчо",                        [163643]),
        ("salads",       "Салати",                       [161930]),
        ("soups",        "Супи",                         [163163]),
        ("mains",        "Основні страви",               [162088]),
        ("icecream",     "Морозиво",                     [100736]),
    ]),
    ("other",    "Інше", [
        ("other",        "Інше",                         [108997, 81732]),
    ]),
]

TAG_MAP = {
    318000: "Ігристе",   317997: "Напівсухе",  322013: "Солодке",
    323562: "По бокалу", 318060: "Безалкогольне", 322689: "Україна",
    317926: "Напівсолодке", 317925: "Сухе",    323724: "Декантування",
    323729: "Витримане", 323730: "Десертне",   323780: "Торф/Дим",
}

def strip_html(text):
    if not text: return ''
    text = re.sub(r'<br\s*/?>', ' ', text)
    text = re.sub(r'</p>\s*<p[^>]*>', ' ', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html_mod.unescape(text)
    return re.sub(r'\s+', ' ', text).strip()

def fetch_menu():
    print(f"Fetching {API_URL} ...")
    req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def build_menu(raw):
    dishes_by_cat = {}
    for d in raw["dishes"]:
        if not d.get("active", True):
            continue
        cid = d["categoryId"]
        dishes_by_cat.setdefault(cid, []).append(d)

    def make_item(d):
        tags = [TAG_MAP[t["id"]] for t in d.get("tags", []) if t["id"] in TAG_MAP]
        img = d.get("thumbnailUrl") or d.get("imageUrl") or None
        # empty image = default placeholder URL → null it
        if img and "emptyDishImage" in img:
            img = None

        variants = [v for v in d.get("dishVariants", []) if v.get("active", True)]
        if not variants:
            variants = d.get("dishVariants", [])

        item = {
            "id":    d["id"],
            "name":  d["title"],
            "desc":  strip_html(d.get("description", "")),
            "tags":  tags,
            "image": img,
        }

        if len(variants) == 1:
            item["price"] = int(variants[0]["price"])
        else:
            choices = []
            for v in variants:
                label = v.get("description") or (
                    f"{int(v['amount'])} {v['unit']}" if v.get("unit") and v.get("amount") else ""
                )
                choices.append({"label": label, "price": int(v["price"])})
            item["price"] = min(c["price"] for c in choices)
            item["options"] = {"label": "Розмір/Об'єм", "choices": choices}

        return item

    categories = []
    for main_id, main_name, subs in MAIN_CATEGORIES:
        sub_sections = []
        for sub_id, sub_name, cat_ids in subs:
            items = []
            for cid in cat_ids:
                for d in dishes_by_cat.get(cid, []):
                    items.append(make_item(d))
            if items:
                sub_sections.append({"id": sub_id, "name": sub_name, "items": items})

        if sub_sections:
            # Flatten all items into one list, but add a _heading marker per subsection
            flat_items = []
            for s in sub_sections:
                # Only add heading if there are multiple subsections
                if len(sub_sections) > 1:
                    flat_items.append({"_heading": s["name"]})
                flat_items.extend(s["items"])

            categories.append({
                "id":    main_id,
                "name":  main_name,
                "items": flat_items,
            })

    return {"categories": categories}

def patch_appjs(menu_data, appjs_path="app.js"):
    with open(appjs_path, "r", encoding="utf-8") as f:
        content = f.read()

    menu_json = json.dumps(menu_data, ensure_ascii=False)

    # Replace the inline const data = {...};
    old_pat = re.compile(r'const data = \{.*?\};', re.DOTALL)
    new_data = f"const data = {menu_json};"
    new_content, n = old_pat.subn(new_data, content, count=1)
    if not n:
        print("ERROR: could not find 'const data = {...}' in app.js")
        return False

    with open(appjs_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"✅ Patched {appjs_path} with {len(menu_data['categories'])} main categories")
    return True

def patch_buildui(appjs_path="app.js"):
    """
    Patch buildUI to handle _heading items (bold subcategory dividers)
    and skip emojis in tab names.
    """
    with open(appjs_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Patch the item rendering loop inside buildUI to handle _heading
    old_item_loop = """    cat.items.forEach((item, ii) => {
      const card              = document.createElement('div');
      card.className          = 'item-card';
      card.id                 = 'card-' + item.id;
      card.style.animationDelay = (ii * 40) + 'ms';"""

    new_item_loop = """    cat.items.forEach((item, ii) => {
      // Subcategory heading divider
      if (item._heading) {
        const h = document.createElement('div');
        h.className = 'sub-heading';
        h.textContent = item._heading;
        blk.appendChild(h);
        return;
      }

      const card              = document.createElement('div');
      card.className          = 'item-card';
      card.id                 = 'card-' + item.id;
      card.style.animationDelay = (ii * 40) + 'ms';"""

    if old_item_loop not in content:
        print("WARNING: item loop pattern not found, skipping buildUI patch")
    else:
        content = content.replace(old_item_loop, new_item_loop, 1)
        print("✅ Patched buildUI item loop for _heading support")

    # Also fix findItem to skip _heading entries
    old_find = """function findItem(id) {
  for (const cat of MENU.categories) {
    for (const item of cat.items) {
      if (item.id === id) return item;"""
    new_find = """function findItem(id) {
  for (const cat of MENU.categories) {
    for (const item of cat.items) {
      if (item._heading) continue;
      if (item.id === id) return item;"""

    if old_find not in content:
        print("WARNING: findItem pattern not found")
    else:
        content = content.replace(old_find, new_find, 1)
        print("✅ Patched findItem to skip _heading entries")

    # Fix renderCardCtrl loop too
    old_render = """  MENU.categories.forEach(cat =>
      cat.items.forEach(item => renderCardCtrl(item.id)),"""
    new_render = """  MENU.categories.forEach(cat =>
      cat.items.forEach(item => { if (!item._heading) renderCardCtrl(item.id); }),"""

    if old_render in content:
        content = content.replace(old_render, new_render, 1)
        print("✅ Patched boot loop to skip _heading entries")

    with open(appjs_path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    appjs = os.path.join(script_dir, "app.js")

    if not os.path.exists(appjs):
        print(f"ERROR: app.js not found at {appjs}")
        sys.exit(1)

    try:
        raw = fetch_menu()
    except Exception as e:
        print(f"ERROR fetching menu: {e}")
        sys.exit(1)

    menu_data = build_menu(raw)

    total = sum(
        sum(1 for i in c["items"] if not i.get("_heading"))
        for c in menu_data["categories"]
    )
    print(f"Built menu: {len(menu_data['categories'])} main tabs, {total} items")

    patch_appjs(menu_data, appjs)
    patch_buildui(appjs)

    print("\nDone! Now also add this CSS to style.css:\n")
    print("""/* Subcategory heading inside a menu block */
.sub-heading {
  font-family: var(--serif);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.03em;
  padding: 18px 16px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
""")