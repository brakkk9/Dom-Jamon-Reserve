/* ============================================================
   Dom Jamon — Preorder WebApp · app.js
   ============================================================ */

// ---------------------------------------------------------------------------
// Telegram WebApp — with browser preview fallback
// ---------------------------------------------------------------------------

const tg = window.Telegram?.WebApp ?? {
  ready:    () => {},
  expand:   () => {},
  sendData: (data) => console.log('[tg.sendData]', JSON.parse(data)),
  close: () => {
    document.body.innerHTML = `
      <div style="
        height:100dvh; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:16px;
        background:#0e0a07; color:#c9a96e; padding:32px;
        font-family:'DM Sans',sans-serif; text-align:center;
      ">
        <div style="font-family:'Cormorant Garamond',serif;font-size:28px;font-style:italic;">
          Дякуємо!
        </div>
        <div style="font-size:13px;color:#7a6e63;line-height:1.7;">
          У реальному Telegram WebApp застосунок<br>
          закривається тут і бот продовжує розмову.
        </div>
      </div>`;
  },
};

tg.ready();
tg.expand();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'domjamon_cart_v1';

// cart[key] = { name, option, price, qty, itemId }
// key = "<itemId>" for plain items, "<itemId>:<optionLabel>" for items with options
const cart = {};

let popupItemId         = null;
let popupSelectedOption = null;

// ---------------------------------------------------------------------------
// Persistence — tg.CloudStorage with localStorage fallback
// ---------------------------------------------------------------------------

function saveCart() {
  const value = JSON.stringify(cart);
  try { tg.CloudStorage.setItem(STORAGE_KEY, value, () => {}); } catch (_) {}
  try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
}

function loadCart() {
  return new Promise(resolve => {
    // Priority 1: ?cart= URL param passed by bot when editing (pre-fills from saved preorder)
    const urlParam = new URLSearchParams(window.location.search).get('cart');
    if (urlParam) {
      try {
        const items = JSON.parse(urlParam);
        // Convert preorder items [{name, option, price, qty}] back into cart format
        items.forEach(item => {
          // Find the item id by matching name in MENU (MENU may not be loaded yet, store raw)
          const key = item.option ? `__named__:${item.name}:${item.option}` : `__named__:${item.name}`;
          cart[key] = {
            name:   item.name,
            option: item.option ?? null,
            price:  item.price,
            qty:    item.qty,
            itemId: null,  // resolved after menu loads
          };
        });
      } catch (_) {}
      resolve();
      return;
    }

    // Priority 2: tg.CloudStorage
    const fromLocal = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) Object.assign(cart, JSON.parse(raw));
      } catch (_) {}
      resolve();
    };

    try {
      tg.CloudStorage.getItem(STORAGE_KEY, (err, value) => {
        if (!err && value) {
          try { Object.assign(cart, JSON.parse(value)); } catch (_) {}
        }
        resolve();
      });
    } catch (_) {
      fromLocal();
    }
  });
}

// After menu is loaded, resolve __named__ keys to proper itemId-based keys
function resolveCartKeys() {
  const toResolve = Object.entries(cart).filter(([k]) => k.startsWith('__named__:'));
  if (!toResolve.length) return;

  toResolve.forEach(([key, v]) => {
    delete cart[key];
    // Find item in menu by name
    for (const cat of MENU.categories) {
      for (const item of cat.items) {
        if (item.name === v.name) {
          const newKey = v.option ? `${item.id}:${v.option}` : String(item.id);
          cart[newKey] = { ...v, itemId: item.id };
          break;
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Build UI
// ---------------------------------------------------------------------------

function buildUI(data) {
  const area  = document.getElementById('scroll-area');
  const strip = document.getElementById('cat-strip');
  area.innerHTML  = '';
  strip.innerHTML = '';

  data.categories.forEach((cat, ci) => {

    // Tab
    const tab       = document.createElement('div');
    tab.className   = 'cat-tab' + (ci === 0 ? ' active' : '');
    tab.textContent = cat.name;
    tab.dataset.id  = cat.id;
    tab.onclick     = () => switchCategory(cat.id);
    strip.appendChild(tab);

    // Block
    const blk         = document.createElement('div');
    blk.id            = 'blk-' + cat.id;
    blk.style.display = ci === 0 ? 'block' : 'none';

    cat.items.forEach((item, ii) => {
      const card              = document.createElement('div');
      card.className          = 'item-card';
      card.id                 = 'card-' + item.id;
      card.style.animationDelay = (ii * 40) + 'ms';

      const thumbHTML = item.image
        ? `<img class="item-thumb" src="${item.image}" alt="${item.name}" loading="lazy">`
        : `<div class="item-thumb-placeholder"></div>`;

      const fromPrice  = item.options
        ? Math.min(...item.options.choices.map(c => c.price))
        : item.price;
      const priceLabel = item.options ? 'від ' + fromPrice + ' ₴' : item.price + ' ₴';
      const optHint    = item.options
        ? `<span class="item-has-options">· ${item.options.label}</span>`
        : '';

      card.innerHTML = `
        ${thumbHTML}
        <div class="item-body">
          <div class="item-name">${item.name}</div>
          <div class="item-desc">${item.desc}</div>
          <div class="item-footer">
            <span class="item-price">${priceLabel}</span>
            ${optHint}
            ${item.tags.map(t => `<span class="item-tag">${t}</span>`).join('')}
          </div>
        </div>
        <div class="item-ctrl" id="ctrl-${item.id}">
          <button class="add-btn"
            onclick="event.stopPropagation(); handleAdd(${item.id})">+</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.item-ctrl')) return;
        openItemPopup(item.id);
      });

      blk.appendChild(card);
    });

    area.appendChild(blk);
  });
}

// ---------------------------------------------------------------------------
// Category switching
// ---------------------------------------------------------------------------

function switchCategory(id) {
  document.querySelectorAll('.cat-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.id === id),
  );

  document.querySelectorAll('[id^=blk-]').forEach(blk => {
    const visible = blk.id === 'blk-' + id;
    blk.style.display = visible ? 'block' : 'none';
    if (visible) {
      blk.querySelectorAll('.item-card').forEach((card, i) => {
        card.style.animation      = 'none';
        card.offsetHeight;
        card.style.animation      = '';
        card.style.animationDelay = (i * 40) + 'ms';
      });
    }
  });

  document.getElementById('scroll-area').scrollTop = 0;
  document.querySelector('.cat-tab.active')
    ?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Item popup
// ---------------------------------------------------------------------------

function openItemPopup(id) {
  const item = findItem(id);
  if (!item) return;

  popupItemId         = id;
  popupSelectedOption = item.options ? item.options.choices[0] : null;

  document.getElementById('popup-img-wrap').innerHTML = item.image
    ? `<img class="popup-img" src="${item.image}" alt="${item.name}">`
    : `<div class="popup-img-placeholder"></div>`;

  const optionsHTML = item.options ? `
    <div class="options-section">
      <div class="options-label">${item.options.label}</div>
      <div class="options-grid">
        ${item.options.choices.map((c, i) => `
          <button
            class="option-chip ${i === 0 ? 'selected' : ''}"
            id="opt-${id}-${i}"
            onclick="selectOption(${id}, ${i})"
          >${c.label}<span class="opt-price">${c.price} ₴</span></button>
        `).join('')}
      </div>
    </div>
  ` : '';

  document.getElementById('popup-body').innerHTML = `
    <div class="popup-name">${item.name}</div>
    <div class="popup-price" id="popup-price">
      ${popupSelectedOption?.price ?? item.price} ₴
    </div>
    <div class="popup-desc">${item.desc}</div>
    ${optionsHTML}
    <div class="popup-tags">
      ${item.tags.map(t => `<span class="popup-tag">${t}</span>`).join('')}
    </div>
  `;

  renderPopupCtrl();
  openOverlay('item-overlay');
}

function selectOption(itemId, idx) {
  const item          = findItem(itemId);
  popupSelectedOption = item.options.choices[idx];

  item.options.choices.forEach((_, i) =>
    document.getElementById(`opt-${itemId}-${i}`)
      ?.classList.toggle('selected', i === idx),
  );

  document.getElementById('popup-price').textContent =
    popupSelectedOption.price + ' ₴';

  renderPopupCtrl();
}

function renderPopupCtrl() {
  const ctrl = document.getElementById('popup-ctrl');
  const key  = cartKey(popupItemId, popupSelectedOption);
  const qty  = cart[key]?.qty ?? 0;

  if (qty === 0) {
    ctrl.innerHTML = `
      <button class="btn-primary" style="flex:1" onclick="popupAdd()">
        Додати до замовлення
      </button>`;
  } else {
    ctrl.innerHTML = `
      <div class="popup-qty-row">
        <button class="popup-qty-btn minus" onclick="popupRemove()">−</button>
        <span class="popup-qty-num">${qty}</span>
        <button class="popup-qty-btn plus"  onclick="popupAdd()">+</button>
      </div>`;
  }
}

function popupAdd() {
  const item  = findItem(popupItemId);
  const opt   = popupSelectedOption;
  const key   = cartKey(popupItemId, opt);
  const price = opt ? opt.price : item.price;

  if (!cart[key]) {
    cart[key] = {
      name:   item.name,
      option: opt?.label ?? null,
      price,
      qty:    0,
      itemId: popupItemId,
    };
  }

  cart[key].qty++;
  saveCart();
  renderPopupCtrl();
  renderCardCtrl(popupItemId);
  updateBar();
}

function popupRemove() {
  const key = cartKey(popupItemId, popupSelectedOption);
  if (!cart[key]) return;

  cart[key].qty = Math.max(0, cart[key].qty - 1);
  if (cart[key].qty === 0) delete cart[key];

  saveCart();
  renderPopupCtrl();
  renderCardCtrl(popupItemId);
  updateBar();
}

// ---------------------------------------------------------------------------
// Cart drawer
// ---------------------------------------------------------------------------

function openCartDrawer() {
  renderCartDrawer();
  openOverlay('cart-overlay');
}

function renderCartDrawer() {
  const body       = document.getElementById('drawer-body');
  const totalEl    = document.getElementById('drawer-total');
  const confirmBtn = document.getElementById('drawer-confirm-btn');
  const confirmSub = document.getElementById('drawer-confirm-sub');

  const entries    = Object.entries(cart).filter(([, v]) => v.qty > 0);
  const grandTotal = entries.reduce((s, [, v]) => s + v.qty * v.price, 0);
  const count      = entries.reduce((s, [, v]) => s + v.qty, 0);

  totalEl.textContent    = grandTotal > 0 ? grandTotal + ' ₴' : '';
  confirmBtn.disabled    = count === 0;
  confirmSub.textContent = count > 0 ? 'Разом: ' + grandTotal + ' ₴' : '';

  if (entries.length === 0) {
    body.innerHTML = `<div class="cart-empty">Кошик порожній</div>`;
    return;
  }

  body.innerHTML = entries.map(([key, v]) => `
    <div class="cart-line">
      <div class="cart-line-info">
        <div class="cart-line-name">${v.name}</div>
        ${v.option ? `<div class="cart-line-option">${v.option}</div>` : ''}
        <div class="cart-line-price">
          ${v.price * v.qty} ₴
          <span class="unit">${v.price} ₴ × ${v.qty}</span>
        </div>
      </div>
      <div class="cart-line-ctrl">
        <button class="cart-qty-btn minus"
          onclick="cartChangeQty('${key}', -1)">−</button>
        <span class="cart-qty-num">${v.qty}</span>
        <button class="cart-qty-btn plus"
          onclick="cartChangeQty('${key}', +1)">+</button>
      </div>
    </div>
  `).join('');
}

function cartChangeQty(key, delta) {
  if (!cart[key]) return;

  const itemId = cart[key].itemId ?? parseInt(key.split(':')[0], 10);
  cart[key].qty = Math.max(0, cart[key].qty + delta);
  if (cart[key].qty === 0) delete cart[key];

  saveCart();
  renderCardCtrl(itemId);
  updateBar();
  renderCartDrawer();
}

// ---------------------------------------------------------------------------
// Card controls
// ---------------------------------------------------------------------------

function handleAdd(id) {
  findItem(id).options ? openItemPopup(id) : addSimple(id);
}

function addSimple(id) {
  const item = findItem(id);
  const key  = String(id);
  if (!cart[key]) {
    cart[key] = { name: item.name, option: null, price: item.price, qty: 0, itemId: id };
  }
  cart[key].qty++;
  saveCart();
  renderCardCtrl(id);
  updateBar();
}

function removeSimple(id) {
  const key = String(id);
  if (!cart[key]) return;
  cart[key].qty = Math.max(0, cart[key].qty - 1);
  if (cart[key].qty === 0) delete cart[key];
  saveCart();
  renderCardCtrl(id);
  updateBar();
}

function renderCardCtrl(id) {
  const ctrl = document.getElementById('ctrl-' + id);
  const card = document.getElementById('card-' + id);
  if (!ctrl) return;

  const item     = findItem(id);
  const totalQty = Object.entries(cart)
    .filter(([k]) => k === String(id) || k.startsWith(id + ':'))
    .reduce((s, [, v]) => s + v.qty, 0);

  card.classList.toggle('in-cart', totalQty > 0);

  if (item.options) {
    ctrl.innerHTML = totalQty === 0
      ? `<button class="add-btn"
           onclick="event.stopPropagation(); openItemPopup(${id})">+</button>`
      : `<div class="qty-row">
           <button class="qty-btn plus"
             style="width:auto;padding:0 10px;border-radius:100px;font-size:12px;font-weight:600;"
             onclick="event.stopPropagation(); openItemPopup(${id})">
             ${totalQty} змінити
           </button>
         </div>`;
  } else {
    ctrl.innerHTML = totalQty === 0
      ? `<button class="add-btn"
           onclick="event.stopPropagation(); addSimple(${id})">+</button>`
      : `<div class="qty-row">
           <button class="qty-btn minus"
             onclick="event.stopPropagation(); removeSimple(${id})">−</button>
           <span class="qty-num">${totalQty}</span>
           <button class="qty-btn plus"
             onclick="event.stopPropagation(); addSimple(${id})">+</button>
         </div>`;
  }
}

// ---------------------------------------------------------------------------
// Bottom bar
// ---------------------------------------------------------------------------

function updateBar() {
  const vals  = Object.values(cart);
  const count = vals.reduce((s, i) => s + i.qty, 0);
  const total = vals.reduce((s, i) => s + i.qty * i.price, 0);

  document.getElementById('cart-pill').classList.toggle('has-items', count > 0);
  document.getElementById('pill-label').textContent = count > 0
    ? count + ' ' + plural(count, 'позиція', 'позиції', 'позицій')
    : 'Кошик порожній';

  document.getElementById('confirm-btn').disabled = count === 0;
  document.getElementById('confirm-sub').textContent =
    count > 0 ? 'Разом: ' + total + ' ₴' : '';
}

// ---------------------------------------------------------------------------
// Confirm & skip
// ---------------------------------------------------------------------------

function confirmOrder() {
  const vals = Object.values(cart).filter(i => i.qty > 0);
  if (!vals.length) return;

  const payload = JSON.stringify({
    action: 'preorder',
    items:  vals.map(i => ({ name: i.name, option: i.option, qty: i.qty, price: i.price })),
    total:  vals.reduce((s, i) => s + i.qty * i.price, 0),
  });

  try { tg.sendData(payload); } catch (_) {}
  try { tg.CloudStorage.removeItem(STORAGE_KEY, () => {}); } catch (_) {}
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}

  tg.close();
}

function skip() {
  const vals = Object.values(cart).filter(i => i.qty > 0);

  // If there are items in the cart, send them (user kept/modified selection)
  // If cart is empty but we were pre-filled via ?cart= param, send the original back
  const urlParam = new URLSearchParams(window.location.search).get('cart');

  if (vals.length > 0) {
    // Cart has items — send them as a preorder (not skip)
    try {
      tg.sendData(JSON.stringify({
        action: 'preorder',
        items:  vals.map(i => ({ name: i.name, option: i.option, qty: i.qty, price: i.price })),
        total:  vals.reduce((s, i) => s + i.qty * i.price, 0),
      }));
    } catch (_) {}
  } else if (urlParam) {
    // Editing mode, cart cleared to empty — user explicitly removed everything
    try { tg.sendData(JSON.stringify({ action: 'preorder', items: [], total: 0 })); } catch (_) {}
  } else {
    // Fresh flow, no items — genuine skip
    try { tg.sendData(JSON.stringify({ action: 'skip' })); } catch (_) {}
  }

  tg.close();
}

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------

function openOverlay(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeOverlay(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

function handleOverlayClick(e, id) {
  if (e.target === document.getElementById(id)) closeOverlay(id);
}

function closeItemPopup() {
  closeOverlay('item-overlay');
  popupItemId         = null;
  popupSelectedOption = null;
}

function closeCartDrawer() {
  closeOverlay('cart-overlay');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function cartKey(id, opt) {
  return opt ? `${id}:${opt.label}` : String(id);
}

function findItem(id) {
  for (const cat of MENU.categories) {
    for (const item of cat.items) {
      if (item.id === id) return item;
    }
  }
  return null;
}

function plural(n, one, few, many) {
  const m10  = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11)                                 return one;
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return few;
  return many;
}

// ---------------------------------------------------------------------------
// Boot — fetch menu.json then restore cart
// ---------------------------------------------------------------------------

(async () => {
  try {
    const data = {"categories": [{"id": "mulled", "name": "Глінтвейн", "items": [{"id": 981626, "name": "Глінтвейн", "desc": "Каберне Совіньйон та натуральний мед, кориця, гвоздика, апельсин. Теплий, оксамитовий букет.", "tags": [], "image": null, "price": 135}]}, {"id": "wines_glass", "name": "Вина в келихах", "items": [{"id": 569680, "name": "Фрізанте Бьянко Глера 100%", "desc": "Італія · Глера 100% · 11% · Сухе ігристе з ніжними бульбашками та квітковими нотами.", "tags": ["Сухе", "Ігристе"], "image": null, "price": 60, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "100 мл", "price": 60}, {"label": "700 мл", "price": 420}]}}, {"id": 628758, "name": "Pinot Noir 46 Parallel", "desc": "Україна (Одеська обл.) · Піно нуар · 12,6% · Делікатний, свіжий, чистий, нюанси стиглих ягід.", "tags": ["Сухе", "Україна"], "image": null, "price": 135}, {"id": 560245, "name": "Souvignon Blanc Marlborough Sun", "desc": "Нова Зеландія (Мальборо) · Совіньйон Блан · 13% · Аромат маракуї, аґрусу, листків смородини.", "tags": ["Сухе", "По бокалу"], "image": null, "price": 145}, {"id": 560746, "name": "Juan Gil Moscatel", "desc": "Іспанія (Мурсія) · Москатель · 13% · Аромат персика, тропічних фруктів та цитрусових.", "tags": ["Сухе", "По бокалу"], "image": null, "price": 145}, {"id": 560757, "name": "Callia Pinot Grigio", "desc": "Аргентина (Сан Хуан) · Піно Гриджо · 11,5% · М'який смак, баланс фруктів та свіжості.", "tags": ["Сухе", "По бокалу"], "image": null, "price": 115}, {"id": 560759, "name": "Leleka Wines Semi-Sweet", "desc": "Україна (Одеська обл.) · Піно грі · 12% · Пряний аромат з мандарином та солодким печеним яблуком.", "tags": ["Напівсолодке", "Україна"], "image": null, "price": 115}, {"id": 567632, "name": "Laya Monastrel", "desc": "Іспанія (Альманса) · Монастрель/Гарнача/Тинторера · 14% · Стигла слива, темна вишня, малиновий вибух.", "tags": ["Сухе"], "image": null, "price": 145}, {"id": 567634, "name": "La Vieille Ferme", "desc": "Франція (Долина Рони) · Сира/Гренаш/Кариньян · 13% · Аромат стиглих фруктів та спецій.", "tags": ["Сухе"], "image": null, "price": 145}, {"id": 567635, "name": "Essere Bardolino", "desc": "Італія (Венето) · Неграра/Корвина · 11,5% · Аромат фіалок, червоної та чорної смородини.", "tags": ["Сухе"], "image": null, "price": 115}]}, {"id": "wines_white", "name": "Білі вина 🥂", "items": [{"id": 569697, "name": "Canti Pinot Grigio Veneto", "desc": "Італія (Венето) · Піно Гриджо · 12% · Свіжий, ненав'язливий. Ідеально до легких закусок.", "tags": ["Сухе"], "image": null, "price": 215, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "200 мл", "price": 215}, {"label": "750 мл", "price": 430}]}}, {"id": 568745, "name": "Gazela Vihno Verde", "desc": "Португалія (Виньо Верде) · Педерна/Азал · 9% · Відтінки тропічних фруктів та цитрусу.", "tags": ["Напівсухе"], "image": null, "price": 395}, {"id": 918998, "name": "Dr. L Riesling Trocken", "desc": "Німеччина (Мозель) · Рислинг · 12% · Аромат грейпфрута, мінералів і лайма. Чудовий аперитив.", "tags": ["Сухе"], "image": null, "price": 503}, {"id": 919001, "name": "Dr. L Riesling Feinherb", "desc": "Німеччина (Мозель) · Рислинг · 10,5% · Аромат польових квітів, лайма, цитрусу і яблук.", "tags": ["Напівсолодке"], "image": null, "price": 503}, {"id": 919003, "name": "Dr. L Riesling", "desc": "Німеччина (Мозель) · Рислинг · 8,5% · Солодкий Рислінг з елегантними характеристиками Мозеля.", "tags": ["Солодке"], "image": null, "price": 503}, {"id": 919005, "name": "Gewurztraminer Villa Wolf", "desc": "Німеччина (Пфальц) · Гевюрцтраминер · 11,5% · Яскравий аромат троянд та прянощів.", "tags": ["Напівсолодке"], "image": null, "price": 515}, {"id": 919007, "name": "Riesling Marlborough Sun", "desc": "Нова Зеландія (Мальборо) · Рислінг · 10,5% · Напівсухий. Мандарин, зелене яблуко, лайм.", "tags": ["Напівсухе"], "image": null, "price": 683}, {"id": 927095, "name": "Barista Chardonnay", "desc": "ПАР (Робертсон) · Шардоне · 13% · Яскравий аромат цитрусових, персиків, аґрусу.", "tags": ["Сухе"], "image": null, "price": 653}, {"id": 927119, "name": "Sauvignon Blanc Savanha", "desc": "ПАР (Вестерн Кейп) · Шенен Блан · 13% · Аромат тропічних фруктів та зеленого перцю.", "tags": ["Сухе"], "image": null, "price": 407}, {"id": 927123, "name": "Pete's Pure Pinot Grigio", "desc": "Австралія (Долина Баросса) · Піно Гріджо · 12,5% · Аромат гуави, маракуї, зеленої груші.", "tags": ["Сухе"], "image": null, "price": 587}, {"id": 927127, "name": "Montes Sauvignon Blanc Limited Selection", "desc": "Чилі (Лейда) · Совіньйон Блан · Аромат свіжоскошеної трави, аґрусу та тропічних фруктів.", "tags": ["Сухе"], "image": null, "price": 623}, {"id": 928826, "name": "Tarapaca Santa Cecilia Semi Sweet White", "desc": "Чилі · Педро Хименес · 10,5% · Напівсолодке легке вино з ароматом стиглих фруктів.", "tags": ["Напівсолодке"], "image": null, "price": 383}, {"id": 986320, "name": "Stakhovsky Wines Шардоне", "desc": "Україна · Шардоне · 11,5% · Аромат польових квітів із відтінком весняного меду.", "tags": ["Сухе", "Україна"], "image": null, "price": 683}, {"id": 986324, "name": "Stakhovsky Wines Трамінер", "desc": "Україна (Закарпаття) · Траминер · 12,9% · Яскравий аромат білих квітів, цитрусу та тропічних фруктів.", "tags": ["Сухе", "Україна"], "image": null, "price": 683}, {"id": 986375, "name": "Muscat Natureo Torres", "desc": "Іспанія · Мускат · Безалкогольне. Вишуканий квітковий та фруктовий аромат.", "tags": ["Напівсолодке", "Безалкогольне"], "image": null, "price": 587}, {"id": 986399, "name": "WIN Verdejo безалкогольне", "desc": "Іспанія · Вердехо · Безалкогольне. Аромат зеленого яблука та весняних квітів.", "tags": ["Сухе", "Безалкогольне"], "image": null, "price": 743}, {"id": 1072834, "name": "Soave DOC Essere", "desc": "Італія (Венето) · Гарганега/Требиано · 11,5% · Легке, свіже, приємний букет стиглих фруктів.", "tags": ["Сухе"], "image": null, "price": 460}, {"id": 1072838, "name": "Pinot Grigio Delle Venezie DOC Essere", "desc": "Італія (Венето) · Піно Гриджо · 12% · Аромат білих фруктів та ароматних квітів.", "tags": ["Сухе"], "image": null, "price": 460}, {"id": 1072851, "name": "Sancerre Fournier Pere & Fils", "desc": "Франція (Долина Луари) · Совіньйон Блан · 13% · Мінеральний та свіжий, з нотами лимонного сорбету. Рек. Юлія.", "tags": ["Сухе"], "image": null, "price": 1919}, {"id": 1092061, "name": "Hunawihr Gewurztraminer Reserve", "desc": "Франція (Ельзас) · Гевюрцтрамінер · 13,5% · Аромат лічі та маракуї з тонами троянд.", "tags": ["Напівсухе"], "image": null, "price": 779}, {"id": 1092068, "name": "Casa Lunardi Pinot Grigio", "desc": "Італія (Венето) · Піно Гріджіо 100% · 12% · Квіткові аромати з тонами яблук, груш і лимона.", "tags": ["Сухе"], "image": null, "price": 407}, {"id": 1092089, "name": "Casa Lunardi Chardonnay", "desc": "Італія (Венето) · Шардоне 100% · 12% · Аромат лічі й жовтих яблук. Делікатне, питке, свіже.", "tags": ["Сухе"], "image": null, "price": 407}, {"id": 1092125, "name": "Casa Lunardi Soave", "desc": "Італія (Венето) · Гарганега 100% · 12% · Зелені яблука, цитрусові плоди і відтінки мигдалю.", "tags": ["Сухе"], "image": null, "price": 407}, {"id": 1092365, "name": "Casa Lunardi Sauvignon Blanc", "desc": "Італія (Венето) · Совіньйон Блан 100% · 12% · Яскравий, свіжий, з цитрусовими нотами.", "tags": ["Сухе"], "image": null, "price": 407}, {"id": 1092366, "name": "Cappo Moscato", "desc": "Іспанія (Мурсія) · Мускат · 12% · Аромат лемонграсу, цитрусів, зелених яблук і дині.", "tags": ["Сухе"], "image": null, "price": 305}, {"id": 1092384, "name": "Vina Esmeralda", "desc": "Іспанія · Гевюрцтраминер/Москатель · 11,5% · Аромат тропічних фруктів, жасмину та троянди.", "tags": ["Сухе"], "image": null, "price": 598}, {"id": 1092388, "name": "Chateau Lafon Sauternes", "desc": "Франція (Бордо) · Семильон/Совіньйон Блан · 13% · Мармелад, абрикоси, мед і цитрус. Десертне.", "tags": ["Витримане", "Десертне"], "image": null, "price": 1391}, {"id": 1092392, "name": "The Grinder Chenin Blanc", "desc": "ПАР · Шенен Блан · 13% · Тони персика, абрикоса, цитрусів, мигдалю та меду.", "tags": ["Сухе"], "image": null, "price": 503}, {"id": 1092395, "name": "La Vieille Ferme Blanc", "desc": "Франція (Долина Рони) · Верментино/Уньї Блан · 13% · Делікатне, м'яке, аромат білих фруктів.", "tags": ["Сухе"], "image": null, "price": 563}, {"id": 1092413, "name": "Portillo Sauvignon Blanc", "desc": "Аргентина (Мендоза) · Совіньйон Блан · 12% · Аромат рожевого грейпфрута, зрілого персика.", "tags": ["Сухе"], "image": null, "price": 587}, {"id": 1092504, "name": "Вино Фрумушика-Нова Нефільтроване", "desc": "Україна · Шардоне · 11,5% · Помаранчеве вино. Аромат вершків, масла, сіна, зеленого чаю.", "tags": ["Сухе", "Україна"], "image": null, "price": 683}, {"id": 1092513, "name": "Baron d'Arignac Chardonnay", "desc": "Франція · Шардоне · 11,5% · Аромат цвітіння акації, ананасу, тропічних та цитрусових фруктів.", "tags": ["Сухе"], "image": null, "price": 383}, {"id": 1092524, "name": "Baron d'Arignac Muscat", "desc": "Франція · Мускат · 11% · Напівсолодке. Аромат цвітіння акації, ананаса, тропічних фруктів.", "tags": ["Напівсолодке"], "image": null, "price": 358}, {"id": 1172140, "name": "Laporte Pouilly-Fumé Les Duchesses", "desc": "Франція (Долина Луари) · Совіньйон Блан · 13,5% · Мінеральний аромат зі збалансованою свіжістю.", "tags": ["Сухе"], "image": null, "price": 1809}, {"id": 1172143, "name": "Domaine Laporte Sancerre Rosé", "desc": "Франція (Долина Луари) · Піно Нуар 100% · 12,5% · Аромат персика, малини, цитрусових квітів.", "tags": ["Сухе"], "image": null, "price": 1606}]}, {"id": "wines_rose", "name": "Рожеві вина 🥂", "items": [{"id": 568763, "name": "Mateus Rose", "desc": "Португалія · Бага/Тинта Баррока · 11% · Яскраве рожеве з ягідними тонами та легким ігристим послясмаком.", "tags": ["Напівсухе"], "image": null, "price": 383}, {"id": 568784, "name": "Mateus Rose Medium Sweet", "desc": "Португалія · Бленд · 10,5% · Напівсолодке. Свіжий насичений аромат з ягідними тонами.", "tags": ["Напівсолодке"], "image": null, "price": 383}, {"id": 568789, "name": "Rose d'Anjou", "desc": "Франція (Долина Луари) · Гролло/Піно д'Онис · 10% · Приємне, свіже, легкий фруктовий аромат.", "tags": ["Напівсолодке"], "image": null, "price": 419}, {"id": 919008, "name": "Sauvignon Rose Marlborough Sun", "desc": "Нова Зеландія (Мальборо) · Совіньйон Блан 85%/Піно Нуар 15% · 12,5% · Аромат аґрусу, рожевого грейпфрута, маракуї.", "tags": ["Сухе"], "image": null, "price": 683}, {"id": 919012, "name": "The Grinder Rose", "desc": "ПАР · Сенсо · 13% · Хрумке, соковите. Фіалки та полуниця, збалансована кислотність.", "tags": ["Сухе"], "image": null, "price": 479}, {"id": 1092370, "name": "Cappo Rose", "desc": "Іспанія (Ла-Манча) · Темпранільйо · 12% · Легке й освіжаюче. Аромат полуниці та квітів.", "tags": ["Напівсухе"], "image": null, "price": 299}]}, {"id": "wines_red", "name": "Червоні вина 🍷", "items": [{"id": 1107549, "name": "Kurni 2021", "desc": "Італія (Марке) · Монтепульчано · 14,5% · Культове вино. Чорні ягоди, спеції, гіркий шоколад і ваніль.", "tags": ["Декантування", "Витримане"], "image": null, "price": 7399}, {"id": 1107582, "name": "Casalforte Amarone della Valpolicella DOCG", "desc": "Італія · Корвіна 70%/Корвіноне 25%/Рондінелла 5% · 15,5% · Вишневий джем, ваніль та лакриця.", "tags": ["Декантування", "Витримане"], "image": null, "price": 1979}, {"id": 1107597, "name": "Langhe Nebbiolo", "desc": "Італія (П'ємонт) · Неббіоло · 14,5% · Лісові ягоди, троянди і лакриця. Легший брат Бароло.", "tags": ["Декантування", "Витримане"], "image": null, "price": 1452}, {"id": 1107607, "name": "Giacomo Fenocchio Бароло", "desc": "Італія (П'ємонт) · Неббіоло · 14,5% · Вино королів і король вин. Сухофрукти, квіти, смажені трави.", "tags": ["Декантування", "Витримане"], "image": null, "price": 2783}, {"id": 1107627, "name": "Vincent Girardin Bourgogne Pinot Noir", "desc": "Франція (Бургундія) · Піно нуар 100% · 13% · М'який аромат стиглих червоних фруктів. Малина, смородина.", "tags": ["Витримане"], "image": null, "price": 2063}, {"id": 1107635, "name": "Brancaia Chianti Classico", "desc": "Італія (Тоскана) · Санджовезе · 14% · Тони свіжих фруктів, солодкої вишні та дуба.", "tags": [], "image": null, "price": 1163}, {"id": 1107904, "name": "de Fournier Pinot Noir", "desc": "Франція (Долина Луари) · Піно нуар 100% · 11,5% · Вишня, малина і смородина з відтінками трав.", "tags": [], "image": null, "price": 911}, {"id": 1108491, "name": "Medoc Chateau Les Grand Chenes", "desc": "Франція (Бордо) · Каберне Фран/Каберне Совіньйон/Мерло · 13% · Кедр, чорна смородина, підлісок.", "tags": ["Декантування", "Витримане"], "image": null, "price": 1895}, {"id": 1152302, "name": "Barista Pinotage", "desc": "ПАР (Робертсон) · Пінотаж · 13% · Виразний кавово-шоколадний аромат, шовковиця, сливи.", "tags": ["Сухе"], "image": null, "price": 750}, {"id": 1152435, "name": "Gourmet Pere & Fils Entrecote", "desc": "Франція (Лангедок) · Каберне Совіньйон/Сіра/Мерло · 14% · Темні ягоди, чорний перець. Напівсухе.", "tags": ["Напівсухе"], "image": null, "price": 527}, {"id": 1152468, "name": "Gourmet Pere & Fils Camembert", "desc": "Франція · Сіра/Марселан · 14,5% · Аромат чорних фруктів, ванілі та тостів. Напівсухе.", "tags": ["Напівсухе"], "image": null, "price": 527}, {"id": 1152649, "name": "Pinot Noir Marlborough Sun", "desc": "Нова Зеландія · Піно Нуар · 12,5% · Стигла слива, полуниця, дикі червоні ягоди. Гладкі таніни.", "tags": ["Сухе"], "image": null, "price": 743}, {"id": 1152679, "name": "Bodegas Ateca Honoro Vera", "desc": "Іспанія (Калатаюд) · Гарнача 100% · 14% · Фрукти, трави та чорні фрукти. Виноградники 700-1000 м.", "tags": ["Сухе"], "image": null, "price": 479}, {"id": 1152701, "name": "Bonacchi Chianti Riserva", "desc": "Італія (Тоскана) · Санджовезе · 13% · Тони вишні та фіалки. М'які таніни з легким ванільним відтінком.", "tags": ["Сухе"], "image": null, "price": 467}, {"id": 1152720, "name": "Sogrape Vinhos Silk & Spice Red", "desc": "Португалія · Алікант Буше/Бага/Турига · 13,5% · Аромат стиглих ягід, сливи, ожини. Ваніль, перець.", "tags": ["Напівсухе"], "image": null, "price": 515}, {"id": 1152759, "name": "Cesari Bardolino", "desc": "Італія (Венето) · Неграра/Корвіна/Молінара · 11,5% · Ноти фіалок, червоної та чорної смородини.", "tags": ["Сухе"], "image": null, "price": 431}]}, {"id": "cocktails", "name": "Коктейлі 🍹", "items": [{"id": 556647, "name": "Tropical Spritz", "desc": "На основі джину та ігристого. Освіжаючий і фруктовий напій з екзотичними смаками.", "tags": [], "image": null, "price": 190}, {"id": 556767, "name": "Strawberry Spritz", "desc": "Ігристе вино та фруктовий сироп. Легкий та фруктовий смак для літніх вечорів.", "tags": [], "image": null, "price": 190}, {"id": 556973, "name": "Венеціанський Спрітц", "desc": "Лікер Кампарі, ігристе вино, содова. Легкий і освіжаючий класичний Spritz.", "tags": [], "image": null, "price": 190}, {"id": 557019, "name": "HUGO", "desc": "Ігристе, сироп бузини та м'ята. Дуже свіжий та приємний Hugo Spritz.", "tags": [], "image": null, "price": 219}, {"id": 557217, "name": "Cucumber Gin", "desc": "Джин, содова та сироп огірка. Освіжаючий літній коктейль.", "tags": [], "image": null, "price": 180}, {"id": 557224, "name": "Маргарита", "desc": "Текіла, лимонний фреш та куантро. Класичний освіжаючий коктейль.", "tags": [], "image": null, "price": 180}, {"id": 557225, "name": "Сангрія", "desc": "Червоне вино, апельсиновий сік, фрукти. Іспанський фруктовий коктейль для компанії.", "tags": [], "image": null, "price": 180}, {"id": 557238, "name": "Негроні", "desc": "Джин, вермут та бітер Кампарі, цедра апельсинів. Класичний елегантний коктейль.", "tags": [], "image": null, "price": 195}, {"id": 557241, "name": "Бульвардье", "desc": "Бурбон, червоний вермут та лікер Негроні. Яскравий з характерною гіркуватістю.", "tags": [], "image": null, "price": 195}, {"id": 557488, "name": "Віскі Сауер", "desc": "На основі бурбону. Кисло-солодкий, бадьорячий коктейль.", "tags": [], "image": null, "price": 210}, {"id": 557493, "name": "Гарібальді", "desc": "На основі бітеру та апельсинового соку. Для сильних духом.", "tags": [], "image": null, "price": 180}]}, {"id": "whiskey", "name": "Віскі 🥃", "items": [{"id": 637472, "name": "West Cork Bourbon Cask", "desc": "Ірландія · 40% · Аромат цитрусів, яблук, чорного перцю. Солодкі тони карамелі та ванілі.", "tags": [], "image": null, "price": 95, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 95}, {"label": "Пляшка", "price": 959}]}}, {"id": 637485, "name": "Loch Lomond Original", "desc": "Великобританія (Шотландія) · 40% · Карамель, маслянистий горіх і відтінок курної дубової копченості.", "tags": [], "image": null, "price": 139, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 139}, {"label": "Пляшка", "price": 1499}]}}, {"id": 766629, "name": "Glenfiddich 12 y.o.", "desc": "Великобританія (Шотландія) · 40% · Найпопулярніший односолодовий у світі. Фруктовий, трав'янистий, медовий.", "tags": ["Витримане"], "image": null, "price": 259, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 259}, {"label": "Пляшка 750 мл", "price": 3599}]}}, {"id": 1091969, "name": "Poli SEGRETARIO DI STATO", "desc": "Італія (Венето) · Солодовий віскі · 43% · 5 років витримки у бочках від Amarone. Горіхи, родзинки, шоколад.", "tags": ["Витримане", "Торф/Дим"], "image": null, "price": 2999}, {"id": 1091976, "name": "West Cork IPA Cask", "desc": "Ірландія · 40% · Витримка у бочках з-під бурбона та IPA. Горіхи, смажений солод, солодкуватість.", "tags": ["Витримане"], "image": null, "price": 1439}, {"id": 1097998, "name": "Loch Lomond Single Grain Single Malt Scotch", "desc": "Великобританія (Шотландія) · 46% · М'які фрукти, вершкова ваніль з відтінком диму та торфу.", "tags": ["Витримане", "Торф/Дим"], "image": null, "price": 1499}]}, {"id": "cognac", "name": "Коньяк / Бренді / Портвейн / Граппа", "items": [{"id": 1092016, "name": "Sandeman Porto Ruby", "desc": "Португалія (Доуро) · 19,5% · Портвейн. Аромат червоних фруктів, слив та полуниці. Цукор 95 г/л.", "tags": ["Солодке"], "image": null, "price": 695}, {"id": 1092026, "name": "Бренді Imperial", "desc": "Іспанія (Херес) · 40% · Насичений аромат з дубовими та ванільними відтінками. Багаті хересні тони.", "tags": [], "image": null, "price": 707}, {"id": 1097988, "name": "Коньяк A.E.Dor VS", "desc": "Франція (Коньяк) · 40% · Свіжий, фруктовий VS. Квітковий аромат з медовими відтінками.", "tags": ["Витримане"], "image": null, "price": 1979}, {"id": 1098011, "name": "Граппа Poli Grappa Bassano Classica", "desc": "Італія · 40% · Кришталево чиста. Аромат гортензії, зеленого яблука, персика, кави.", "tags": [], "image": null, "price": 1175}]}, {"id": "rum", "name": "Ром", "items": [{"id": 1092022, "name": "Tanduay Asian Rum Silver", "desc": "Філіппіни · 40% · Витриманий у бочках з-під бурбону. Відтінки мандаринової шкірки, смаженого кокосу й ванілі.", "tags": [], "image": null, "price": 743}]}, {"id": "vodka_gin", "name": "Горілка / Джин", "items": [{"id": 766632, "name": "Горілка Staritsky & Levitsky", "desc": "Україна (Прикарпаття) · 40% · П'ятиразова дистиляція. Легкий, сухий, делікатний смак.", "tags": [], "image": null, "price": 120, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 120}, {"label": "Пляшка 0.5 л", "price": 755}]}}, {"id": 1091612, "name": "Горілка Esbjaerg", "desc": "Нідерланди · 40% · Данська горілка. М'яка, гладка, кристально чиста.", "tags": [], "image": null, "price": 419}, {"id": 1098009, "name": "Джин Larios 12", "desc": "Іспанія (Малага) · 40% · Преміум. 12 ботанікалів. Ноти апельсинових квітів, цитрусових. 5-разова перегонка.", "tags": [], "image": null, "price": 755}]}, {"id": "beer", "name": "Пиво 🍺", "items": [{"id": 578910, "name": "Пиво Ottakringer", "desc": "Австрія · Напівтемне/Світле. Свіжа і тонка фруктовість разом із легкою терпкістю.", "tags": [], "image": null, "price": 72}, {"id": 580546, "name": "MakarBeer IPA 0,33", "desc": "Хмельове IPA. Яскравий смак з тонами хвої, цитрусу, ананасу та тропічних фруктів.", "tags": [], "image": null, "price": 89}, {"id": 580677, "name": "MakarBeer Pilsner 0,33", "desc": "Класичний преміальний пілснер. Традиційна гірчинка, довгий гіркий післясмак.", "tags": [], "image": null, "price": 89}, {"id": 580679, "name": "MakarBeer Amber Ale 0,33", "desc": "Напівтемне ALE. М'який смак з присмаком свіжого хмелю та карамелі.", "tags": [], "image": null, "price": 89}, {"id": 605768, "name": "MakarBeer Lager double hop 0.33", "desc": "Світле нефільтроване непастеризоване. Хмельова гіркота середня, хмельовий аромат помірно сильний.", "tags": [], "image": null, "price": 59}]}, {"id": "cider", "name": "Сікера", "items": [{"id": 1107513, "name": "Pet-Cat Rose", "desc": "Україна · 8% · Мед питний ігристий. Природне бродіння липового меду та соку яблук, ожини, смородини.", "tags": ["Сухе"], "image": null, "price": 443}]}, {"id": "coffee", "name": "Кава ☕", "items": [{"id": 557494, "name": "Еспресо/Espresso", "desc": "", "tags": [], "image": null, "price": 45}, {"id": 557515, "name": "Допіо/Doppio", "desc": "", "tags": [], "image": null, "price": 90}, {"id": 557500, "name": "Американо/Americano", "desc": "", "tags": [], "image": null, "price": 45}, {"id": 557496, "name": "Американо з молоком", "desc": "", "tags": [], "image": null, "price": 60}, {"id": 557514, "name": "Капучино", "desc": "", "tags": [], "image": null, "price": 65, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "250 мл", "price": 65}, {"label": "350 мл", "price": 78}]}}, {"id": 557511, "name": "Латте/Latte", "desc": "", "tags": [], "image": null, "price": 78, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "350 мл", "price": 78}, {"label": "450 мл", "price": 135}]}}, {"id": 557516, "name": "Флет Уайт", "desc": "", "tags": [], "image": null, "price": 110}, {"id": 568790, "name": "Альтернативне молоко", "desc": "Безлактозне.", "tags": [], "image": null, "price": 35}]}, {"id": "tea", "name": "Чай / Какао", "items": [{"id": 557517, "name": "Какао", "desc": "", "tags": [], "image": null, "price": 70}, {"id": 557521, "name": "Чай заварний", "desc": "Чорний, чорний з бергамотом, саусеп, альпійський луг, бризки шампанського.", "tags": [], "image": null, "price": 50, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "300 мл", "price": 50}, {"label": "500 мл", "price": 75}]}}, {"id": 558571, "name": "Чай натуральний фруктовий", "desc": "", "tags": [], "image": null, "price": 65, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "300 мл", "price": 65}, {"label": "500 мл", "price": 95}]}}]}, {"id": "cold", "name": "Прохолодні напої", "items": [{"id": 558771, "name": "Айс Латте", "desc": "", "tags": [], "image": null, "price": 110}, {"id": 558772, "name": "Бамбл", "desc": "", "tags": [], "image": null, "price": 120}, {"id": 558774, "name": "Еспресо Тонік", "desc": "", "tags": [], "image": null, "price": 125}, {"id": 559003, "name": "Лимонад", "desc": "", "tags": [], "image": null, "price": 110, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "400 мл", "price": 110}, {"label": "1 л", "price": 179}]}}]}, {"id": "breakfast", "name": "Сніданки 🍳", "items": [{"id": 1205208, "name": "Ніжні сирники з маракуйєвим сабайоном", "desc": "Золотисті сирники з маракуєвим кремом сабайон і кулькою морозива.", "tags": [], "image": null, "price": 230}, {"id": 1205213, "name": "Крок Мадам", "desc": "Тост з хліба, ніжної шинки та сиру гауда, запечений під соусом бешамель зі смаженим яйцем.", "tags": [], "image": null, "price": 285}, {"id": 1205218, "name": "Скремблер з креветкою в сирному соусі на круасані", "desc": "Повітряний яєчний скрембл у сирному соусі з соковитими креветками на хрусткому круасані.", "tags": [], "image": null, "price": 320}, {"id": 1205221, "name": "Яйця пашот з прошутто та соусом дор блю", "desc": "Яйця пашот на пухкій булці з соусом бешамель, пікантним дор блю та тонко нарізаним прошутто.", "tags": [], "image": null, "price": 250}]}, {"id": "starters", "name": "Стартери", "items": [{"id": 559008, "name": "Антипасті", "desc": "Витриманий сир, сир з блакитною пліснявою, оливки Гордаль, хамон, грисіні.", "tags": [], "image": null, "price": 299}, {"id": 1205227, "name": "Камамбер з грушею у червоному вині", "desc": "Запечений камамбер з карамелізованою грушею в ароматному винному соусі.", "tags": [], "image": null, "price": 270}, {"id": 1205229, "name": "Камамбер з мармеладом із чорізо", "desc": "Запечений камамбер з пряною солодко-гострою пастою з чорізо. Ідеально до вина.", "tags": [], "image": null, "price": 270}, {"id": 1205232, "name": "Тартар з тунця з круасаном", "desc": "Тартар із тунця з мусом авокадо та філе апельсина. Зернова гірчиця, свіжа зелень.", "tags": [], "image": null, "price": 360}, {"id": 1205234, "name": "Тартар з телятини з мусом шевру", "desc": "Соковита телятина з трюфельною пастою та зернистою гірчицею. Мус із витриманого шевру.", "tags": [], "image": null, "price": 340}, {"id": 1216579, "name": "Тапінада з маслин та оливок", "desc": "Хрусткий багет з двома видами тапенади — з маслин і оливок. Олія з копченої паприки.", "tags": [], "image": null, "price": 210}, {"id": 1222172, "name": "Соте з морепродуктів в соусі Шампань", "desc": "Креветки, мідії та кальмари в вершково-винному соусі Шампань з тертим пармезаном.", "tags": [], "image": null, "price": 290}, {"id": 1512980, "name": "Креветки Темпура", "desc": "Ніжні креветки у хрусткому клярі, обсмажені до золотистої скоринки. Подаються з соусом айолі.", "tags": [], "image": null, "price": 295}, {"id": 1512982, "name": "Картопля Фрі з пармезаном", "desc": "Хрустка золотиста картопля, посипана ароматним пармезаном, подана з насиченим кетчупом.", "tags": [], "image": null, "price": 119}, {"id": 1519173, "name": "Цибулеві кільця фрі", "desc": "", "tags": [], "image": null, "price": 119}]}, {"id": "pincho", "name": "Пінчо", "items": [{"id": 559018, "name": "Камамбер та грушевий джем", "desc": "Камамбер з пряним грушевим джемом та мигдальними чіпсами.", "tags": [], "image": null, "price": 149}, {"id": 559034, "name": "Грильований перець та анчоус", "desc": "Поєднання крем сиру, болгарського перцю та анчоусів.", "tags": [], "image": null, "price": 149}, {"id": 559048, "name": "Сальса з артишоків та хамон", "desc": "Хрустки багет, мариновані артишоки та хамон Серано.", "tags": [], "image": null, "price": 149}, {"id": 559060, "name": "Гуакамоле та креветки", "desc": "Хрустка основа з ніжним гуакамоле й соковитими креветками.", "tags": [], "image": null, "price": 179}, {"id": 688932, "name": "В'ялені томати та крем сир", "desc": "Ніжний крем-сир на хрусткому багеті з в'яленими томатами середземноморського смаку.", "tags": [], "image": null, "price": 149}, {"id": 824330, "name": "Пінчо Крем Чіз/Чорізо", "desc": "Іспанське чорізо на подушці з крем чізу та трюфельної олії, мікрогрін, хрустка чіабата.", "tags": [], "image": null, "price": 169}, {"id": 824393, "name": "Пінчо хамон/свіжі томати", "desc": "Іспанський хамон на подушці з грецького йогурту зі свіжим томатом та мікрогріном.", "tags": [], "image": null, "price": 169}]}, {"id": "icecream", "name": "Морозиво 🍦", "items": [{"id": 695648, "name": "Морозиво Gelamo", "desc": "Пломбір.", "tags": [], "image": null, "price": 60}]}, {"id": "other", "name": "Інше", "items": [{"id": 766648, "name": "Розбитий келих", "desc": "", "tags": [], "image": null, "price": 250}, {"id": 766649, "name": "КОРК ФРІ", "desc": "", "tags": [], "image": null, "price": 500}, {"id": 1218553, "name": "Crazy menu", "desc": "Ви можете продовжити ваш вечір після закриття закладу на годину.", "tags": [], "image": null, "price": 1000}]}]};
    window.MENU = data;
    await loadCart();
    resolveCartKeys();
    buildUI(MENU);
    MENU.categories.forEach(cat =>
      cat.items.forEach(item => renderCardCtrl(item.id)),
    );
    updateBar();
  } catch (err) {
    document.getElementById('scroll-area').innerHTML = `
      <div style="
        display:flex; flex-direction:column; align-items:center;
        justify-content:center; height:55vh; gap:12px;
        color:var(--smoke); font-size:13px; text-align:center; padding:24px;
      ">
        <div style="font-family:var(--serif);font-size:20px;font-style:italic;color:var(--ink);">
          Меню недоступне
        </div>
        Не вдалось завантажити меню.<br>Спробуйте пізніше або пропустіть цей крок.
      </div>`;
    console.error(err);
  }
})();