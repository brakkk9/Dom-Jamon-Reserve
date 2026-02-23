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
          <div class="item-desc">${item.desc.replace(/\n/g, '<br>')}</div>
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
    <div class="popup-desc">${item.desc.replace(/\n/g, '<br>')}</div>
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
      if (item._heading) continue;
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
    const data = {"categories": [{"id": "wine", "name": "Винна Карта", "items": [{"_heading": "Вина в келихах"}, {"id": 569680, "name": "Фрізанте Бьянко Глера 100%", "desc": "Географія - Італія\nСортовий склад - Глера 100%\nМіцність - 11%\nЦукор - 12,8 г/л", "tags": ["Сухе", "Ігристе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-569680.jpg?t=1712670615186", "price": 60, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "100 мл", "price": 60}, {"label": "700 мл", "price": 420}]}}, {"id": 628758, "name": "Pinot Noir 46 Parallel", "desc": "Смак: делікатний, свіжий, чистий, переважають нюанси стиглих ягід, а в приємному післясмаку відчутна легка кислинка.\nГеографія - Україна (Одеська обл, Ізмаїльський район)\nСортовий склад - Піно нуар\nМіцність - 12,6%\nЦукор - 2,98 г/л", "tags": ["Сухе", "Вина України"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-628758.jpg?t=1714567789751", "price": 135}, {"id": 560245, "name": "Souvignon Blanc Marlborough Sun", "desc": "Свіжий збалансований Совіньйон Блан з Нової Зеландії. Географія - Нова Зеландія (Мальборо). Сортовий склад - Совіньйон Блан. Міцність - 13%. Цукор - 2,68 г/л.", "tags": ["Сухе", "По бокалу"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560245.jpg?t=1712239437900", "price": 145}, {"id": 560746, "name": "Juan Gil Moscatel", "desc": "Свіжий букет з ароматів персика, тропічних фруктів та цитрусових. Географія - Іспанія (Мурсія). Сортовий склад - Москатель. Міцність - 13%.", "tags": ["Сухе", "По бокалу"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560746.jpg?t=1712246221754", "price": 145}, {"id": 560757, "name": "Callia Pinot Grigio", "desc": "М'який смак, гарний баланс фруктів та свіжості. Географія - Аргентина (Сан Хуан). Сортовий склад - Піно Гриджо. Міцність - 11,5%.", "tags": ["Сухе", "По бокалу"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560757.jpg?t=1712246551875", "price": 115}, {"id": 560759, "name": "Leleka Wines Semi-Sweet", "desc": "Свіжий і повний з приємною кислотністю. Пряний аромат з мандарином та солодким печеним яблуком. Географія - Україна (Одеська обл). Сортовий склад - Піно грі. Міцність - 12%.", "tags": ["Напівсолодке", "Вина України"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560759.jpg?t=1712246739844", "price": 115}, {"id": 567635, "name": "Essere Bardolino", "desc": "Свіже, легке молоде вино. Фруктовий аромат з нотами фіалок, червоної та чорної смородини. Географія - Італія (Венето). Міцність - 11,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-567635.jpg?t=1712578793642", "price": 115}, {"id": 567634, "name": "La Vieille Ferme", "desc": "Червоне соковите вино з ароматом стиглих фруктів та спецій. Географія - Франція (Долина Рони). Міцність - 13%. Цукор - 0,4 г/л.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-567634.jpg?t=1712578502156", "price": 145}, {"id": 567632, "name": "Laya Monastrel", "desc": "Стигла слива, темна вишня, малиновий вибух. 4 місяці у французьких дубових бочках. Географія - Іспанія (Альманса). Міцність - 14%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-567632.jpg?t=1712578043439", "price": 145}, {"_heading": "Білі"}, {"id": 569697, "name": "Canti Pinot Grigio Veneto", "desc": "Свіжий, ненав'язливий смак. Ідеально до легких закусок. Географія - Італія (Венето). Сортовий склад - Піно Гриджо. Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-569697.jpg?t=1712672545035", "price": 215, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "750 мл", "price": 430}, {"label": "200 мл", "price": 215}]}}, {"id": 1072838, "name": "Pinot Grigio Delle Venezie DOC Essere", "desc": "Легке, свіже вино. Аромат білих фруктів та ароматних квітів. Географія - Італія (Венето). Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1072838.jpg?t=1740337411834", "price": 460}, {"id": 927123, "name": "Pete's Pure Pinot Grigio", "desc": "Аромат гуави, свіжої маракуї, зеленої груші. Географія - Австралія (Долина Баросса). Сортовий склад - Піно Гріджо. Міцність - 12,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927123.jpg?t=1732731388025", "price": 587}, {"id": 568745, "name": "Gazela Vihno Verde", "desc": "Приємне напівсухе вино. Відтінки тропічних фруктів та цитрусу. Географія - Португалія (Виньо Верде). Міцність - 9%.", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568745.jpg?t=1712658128802", "price": 395}, {"id": 918998, "name": "Dr. L Riesling Trocken", "desc": "Легке освіжаюче вино з ароматом грейпфрута, мінералів і лайма. Географія - Німеччина (Мозель). Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-918998.jpg?t=1732034221234", "price": 503}, {"id": 919001, "name": "Dr. L Riesling Feinherb", "desc": "Напівсолодкий рислінг. Аромат польових квітів, лайма, цитрусу і яблук. Географія - Німеччина (Мозель). Міцність - 10,5%.", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919001.jpg?t=1732034370202", "price": 503}, {"id": 919003, "name": "Dr. L Riesling", "desc": "Солодкий рислінг. Елегантні та пікантні характеристики виноградників Мозеля. Географія - Німеччина (Мозель). Міцність - 8,5%.", "tags": ["Солодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919003.jpg?t=1732034501927", "price": 503}, {"id": 919005, "name": "Gewurztraminer Villa Wolf", "desc": "Яскраве напівсолодке вино з ароматом троянд та прянощів. Географія - Німеччина (Пфальц). Міцність - 11,5%.", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919005.jpg?t=1732034685063", "price": 515}, {"id": 919007, "name": "Riesling Marlborough Sun", "desc": "Напівсухий Рислінг. Мандарин, зелене яблуко, лайм. Географія - Нова Зеландія (Мальборо). Міцність - 10,5%.", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919007.jpg?t=1732034989570", "price": 683}, {"id": 927095, "name": "Barista Chardonnay", "desc": "Яскравий аромат цитрусових, персиків, агрусу. Відмінне вино для аперитиву. Географія - ПАР (Робертсон). Міцність - 13%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927095.jpg?t=1732729022866", "price": 653}, {"id": 927119, "name": "Sauvignon Blanc Savanha", "desc": "Свіжий Совіньйон з ароматом тропічних фруктів та зеленого перцю. Географія - ПАР (Вестерн Кейп). Міцність - 13%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927119.jpg?t=1732731204063", "price": 407}, {"id": 927127, "name": "Montes Sauvignon Blanc Limited Selection", "desc": "100% Совіньйон Блан з Долини Лейда. Аромат свіжоскошеної трави, агрусу та тропічних фруктів. Географія - Чилі.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927127.jpg?t=1732731752749", "price": 623}, {"id": 928826, "name": "Tarapaca Santa Cecilia Semi Sweet White", "desc": "Напівсолодке легке вино з ароматом стиглих фруктів. Географія - Чилі. Сортовий склад - Педро Хименес. Міцність - 10,5%.", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-928826.jpg?t=1732819130583", "price": 383}, {"id": 986320, "name": "Stakhovsky Wines Шардоне", "desc": "Аромат польових квітів із відтінком весняного меду. Географія - Україна. Сортовий склад - Шардоне. Міцність - 11,5%.", "tags": ["Сухе", "Вина України"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986320.jpg?t=1736860399133", "price": 683}, {"id": 986324, "name": "Stakhovsky Wines Трамінер", "desc": "Яскравий аромат білих квітів, цитрусу та тропічних фруктів. Географія - Україна (Закарпатська обл). Міцність - 12,9%.", "tags": ["Сухе", "Вина України"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986324.jpg?t=1736860473282", "price": 683}, {"id": 986375, "name": "Muscat Natureo Torres", "desc": "Безалкогольне вино. Вишуканий квітковий та фруктовий аромат. Географія - Іспанія. Сортовий склад - Мускат.", "tags": ["Напівсолодке", "Безалкогольне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986375.jpg?t=1736861809161", "price": 587}, {"id": 986399, "name": "WIN Verdejo без алкогольне", "desc": "Освіжаючий аромат зеленого яблука та весняних квітів. Географія - Іспанія. Сортовий склад - Вердехо.", "tags": ["Сухе", "Безалкогольне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986399.jpg?t=1736862302839", "price": 743}, {"id": 1072834, "name": "Soave DOC Essere", "desc": "Легке, свіже вино. Приємний букет стиглих фруктів. Географія - Італія (Венето). Сортовий склад - Гарганега/Требиано. Міцність - 11,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1072834.jpg?t=1740337277955", "price": 460}, {"id": 1072851, "name": "Sancerre Fournier Pere & Fils", "desc": "Совіньйон Блан. Мінеральний та свіжий з нотами лимонного сорбету. Географія - Франція (Долина Луари). Міцність - 13%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1072851.jpg?t=1740338494454", "price": 1919}, {"id": 1092061, "name": "Hunawihr Gewurztraminer Reserve", "desc": "Складний аромат лічі та маракуї з тонами троянд. Географія - Франція (Ельзас). Сортовий склад - Гевюрцтрамінер. Міцність - 13,5%.", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092061.jpg?t=1741185729225", "price": 779}, {"id": 1092068, "name": "Casa Lunardi Pinot Grigio", "desc": "Легке й освіжаюче вино. Квіткові аромати з тонами яблук, груш і лимона. Географія - Італія (Венето). Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092068.jpg?t=1741186009980", "price": 407}, {"id": 1092089, "name": "Casa Lunardi Chardonnay", "desc": "Аромат лічі й жовтих яблук. Делікатне, питке, свіже. Географія - Італія (Венето). Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092089.jpg?t=1741186913639", "price": 407}, {"id": 1092125, "name": "Casa Lunardi Soave", "desc": "Зелені яблука, цитрусові плоди і відтінки мигдалю. Географія - Італія (Венето). Сортовий склад - Гарганега 100%. Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092125.jpg?t=1741187273150", "price": 407}, {"id": 1092365, "name": "Casa Lunardi Sauvignon Blanc", "desc": "Яскравий, свіжий, з хорошим рівнем кислотності та легкою трав'янистістю. Географія - Італія (Венето). Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092365.jpg?t=1741187495020", "price": 407}, {"id": 1092366, "name": "Cappo Moscato", "desc": "Яскравий аромат лемонграсу, цитрусів, зелених яблук і дині. Географія - Іспанія (Мурсія). Сортовий склад - Мускат. Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092366.jpg?t=1741187710497", "price": 305}, {"id": 1092384, "name": "Vina Esmeralda", "desc": "Інтенсивний аромат тропічних фруктів, жасмину, лілії та троянди. Географія - Іспанія. Сортовий склад - Гевюрцтраминер/Москатель. Міцність - 11,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092384.jpg?t=1741188676585", "price": 598}, {"id": 1092388, "name": "Chateau Lafon Sauternes", "desc": "Відтінки мармеладу, абрикосів, меду і цитруса. Географія - Франція (Бордо). Сортовий склад - Семильон/Совіньйон Блан. Міцність - 13%.", "tags": ["Витримане", "Десертне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092388.jpg?t=1741189120498", "price": 1391}, {"id": 1092392, "name": "The Grinder Chenin Blanc", "desc": "Тони персика, абрикоса, цитрусів, мигдалю та меду. Географія - ПАР. Сортовий склад - Шенен Блан. Міцність - 13%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092392.jpg?t=1741189325210", "price": 503}, {"id": 1092395, "name": "La Vieille Ferme Blanc", "desc": "Делікатне, м'яке, ароматне. Аромат білих фруктів та квітів. Географія - Франція (Долина Рони). Міцність - 13%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092395.jpg?t=1741189613060", "price": 563}, {"id": 1092413, "name": "Portillo Sauvignon Blanc", "desc": "Аромат рожевого грейпфрута, зрілого білого персика. Хрумкий, стійкий смак. Географія - Аргентина (Мендоза). Міцність - 12%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092413.jpg?t=1741190418608", "price": 587}, {"id": 1092504, "name": "Вино Фрумушика-Нова Нефільтроване", "desc": "Помаранчеве вино. Аромат вершків, масла, сіна, зеленого чаю. Географія - Україна. Сортовий склад - Шардоне. Міцність - 11,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092504.jpg?t=1741198136757", "price": 683}, {"id": 1092513, "name": "Baron d'Arignac Chardonnay", "desc": "Аромат цвітіння акації, ананасу, тропічних та цитрусових фруктів. Географія - Франція. Сортовий склад - Шардоне. Міцність - 11,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092513.jpg?t=1741198665380", "price": 383}, {"id": 1092524, "name": "Baron d'Arignac Muscat", "desc": "Аромат цвітіння акації, ананаса, тропічних фруктів. М'яке, гладке. Географія - Франція. Сортовий склад - Мускат. Міцність - 11%.", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092524.jpg?t=1741199086063", "price": 358}, {"id": 1172140, "name": "Laporte Pouilly-Fume Les Duchesses", "desc": "Мінеральний аромат зі збалансованою солодкістю і свіжістю. Географія - Франція (Долина Луари). Сортовий склад - Совіньйон блан. Міцність - 13,5%.", "tags": ["Сухе"], "image": null, "price": 1809}, {"id": 1172143, "name": "Domaine Laporte Sancerre Rosé", "desc": "Блідо-рожевий. Гармонійний аромат персика, малини, цитрусових та весняних квітів. Географія - Франція (Долина Луари). Сортовий склад - Піно Нуар 100%. Міцність - 12,5%.", "tags": ["Сухе"], "image": null, "price": 1606}, {"_heading": "Рожеві"}, {"id": 568763, "name": "Mateus Rose", "desc": "Яскраве рожеве з ягідними тонами. Гарний баланс і легкий ігристий післясмак. Географія - Португалія. Міцність - 11%. Цукор - 15 г/л.", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568763.jpg?t=1712659153749", "price": 383}, {"id": 568784, "name": "Mateus Rose Medium Sweet", "desc": "Легке, свіже, злегка ігристе вино. Свіжий, солодкий і насичений аромат з ягідними тонами. Географія - Португалія. Міцність - 10,5%. Цукор - 30 г/л.", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568784.jpg?t=1712660204358", "price": 383}, {"id": 568789, "name": "Rose d'Anjue", "desc": "Приємне, свіже рожеве вино. Легкий фруктовий аромат, солодкуватий смак. Географія - Франція (Долина Луари). Міцність - 10%. Цукор - 17,7 г/л.", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568789.jpg?t=1712660744755", "price": 419}, {"id": 919008, "name": "Sauvignon Rose Marlborough Sun", "desc": "Насичений аромат аґрусу, рожевого грейпфрута, маракуї. Географія - Нова Зеландія (Мальборо). Міцність - 12,5%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919008.jpg?t=1732035097110", "price": 683}, {"id": 919012, "name": "The Grinder Rose", "desc": "Хрумке, соковите розе зі сорту Сенсо. Фіалки та полуниця, збалансована кислотність. Географія - ПАР. Міцність - 13%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919012.jpg?t=1732035554911", "price": 479}, {"id": 1092370, "name": "Cappo Rose", "desc": "Легке й освіжаюче рожеве. Інтенсивний аромат полуниці та квітів. Географія - Іспанія (Ла-Манча). Сортовий склад - Темпранільйо. Міцність - 12%.", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092370.jpg?t=1741187892901", "price": 299}, {"_heading": "Червоні"}, {"id": 1107549, "name": "Kurni 2021", "desc": "100% Montepulciano від Oasi degli Angeli. Глибокий рубіновий. Чорні ягоди, спеції, гіркий шоколад і ваніль. Географія - Італія (Марке). Міцність - 14,5%.", "tags": ["Декантування", "Витримане"], "image": null, "price": 7399}, {"id": 1107582, "name": "Casalforte Amarone della Valpolicella DOCG", "desc": "Повнотіле елегантне вино. Вишневий джем, стигла вишня, ноти ванілі та лакриці. Географія - Італія. Сортовий склад - Корвіна 70%/Корвіноне 25%/Рондінелла 5%. Міцність - 15,5%.", "tags": ["Декантування", "Витримане"], "image": null, "price": 1979}, {"id": 1107597, "name": "Langhe Nebbiolo", "desc": "Легший характер Бароло. Лісові ягоди, троянди і лакриця. Географія - Італія (П'ємонт). Сортовий склад - Неббіоло. Міцність - 14,5%.", "tags": ["Декантування", "Витримане"], "image": null, "price": 1452}, {"id": 1107607, "name": "Giacomo Fenocchio Бароло", "desc": "Бароло традиційного стилю. Сухофрукти, чорна смородина, подрібнені квіти і смажені трави. Географія - Італія (П'ємонт). Сортовий склад - Неббіоло. Міцність - 14,5%.", "tags": ["Декантування", "Витримане"], "image": null, "price": 2783}, {"id": 1107627, "name": "Vincent Girardin Bourgogne Pinot Noir", "desc": "М'який аромат стиглих червоних фруктів. Ягідні тони, малина та чорна смородина. Географія - Франція (Бургундія). Сортовий склад - Піно нуар 100%. Міцність - 13%.", "tags": ["Витримане"], "image": null, "price": 2063}, {"id": 1107635, "name": "Brancaia Chianti Classico", "desc": "100% Санджовезе. Тони свіжих фруктів, солодкої вишні та дуба. Географія - Італія (Тоскана). Міцність - 14%.", "tags": [], "image": null, "price": 1163}, {"id": 1107904, "name": "de Fournier Pinot Noir", "desc": "Вишня, малина і чорна смородина з легкими відтінками солодки. Географія - Франція (Долина Луари). Сортовий склад - Піно нуар 100%. Міцність - 11,5%.", "tags": [], "image": null, "price": 911}, {"id": 1108491, "name": "Medoc Chateau Les Grand Chenes", "desc": "Кедр, чорна смородина, підлісок. Середня щільність, відносно м'яке і свіже. Географія - Франція (Бордо). Сортовий склад - Каберне Фран/Каберне Совиньйон/Мерло. Міцність - 13%.", "tags": ["Декантування", "Витримане"], "image": null, "price": 1895}, {"id": 1152302, "name": "Barista Pinotage", "desc": "Виразний кавово-шоколадний аромат з тонами шовковиці, слив. Географія - ПАР (Робертсон). Сортовий склад - Пінотаж. Міцність - 13%.", "tags": ["Сухе"], "image": null, "price": 750}, {"id": 1152435, "name": "Gourmet Pere & Fils Entrecote", "desc": "Темні ягоди, чорний перець і фруктові відтінки. Географія - Франція (Лангедок-Русійон). Сортовий склад - Каберне Совіньйон/Сіра/Мерло. Міцність - 14%.", "tags": ["Напівсухе"], "image": null, "price": 527}, {"id": 1152468, "name": "Gourmet Pere & Fils Camembert", "desc": "Насичений фруктовий смак з нотками ожини, червоної сливи. Географія - Франція. Сортовий склад - Сіра/Марселан. Міцність - 14,5%.", "tags": ["Напівсухе"], "image": null, "price": 527}, {"id": 1152649, "name": "Pinot Noir Marlborough Sun", "desc": "Стигла слива, полуниця, дикі червоні ягоди. Гладкі таніни. Географія - Нова Зеландія. Сортовий склад - Піно Нуар. Міцність - 12,5%.", "tags": ["Сухе"], "image": null, "price": 743}, {"id": 1152679, "name": "Bodegas Ateca Honoro Vera", "desc": "100% Гарнача з виноградників 700-1000 м. Фрукти, трави та чорні фрукти. Географія - Іспанія (Калатаюд). Міцність - 14%.", "tags": ["Сухе"], "image": null, "price": 479}, {"id": 1152701, "name": "Bonacchi Chianti Riserva", "desc": "Тони червоних фруктів, вишні та фіалки. М'які таніни з легким ванільним відтінком. Географія - Італія (Тоскана). Сортовий склад - Санджовезе. Міцність - 13%.", "tags": ["Сухе"], "image": null, "price": 467}, {"id": 1152720, "name": "Sogrape Vinhos Silk & Spice Red", "desc": "Аромат стиглих ягід, сливи, ожини. Спеції — ваніль, перець, мокка. Географія - Португалія. Сортовий склад - Алікант Буше/Бага/Турига. Міцність - 13,5%.", "tags": ["Напівсухе"], "image": null, "price": 515}, {"id": 1152759, "name": "Cesari Bardolino", "desc": "Свіже, легке молоде вино. Ноти фіалок, червоної та чорної смородини. Географія - Італія (Венето). Міцність - 11,5%.", "tags": ["Сухе"], "image": null, "price": 431}, {"_heading": "Шампанське"}, {"id": 1090192, "name": "Champagne Taittinger Brut Reserve", "desc": "Taittinger - один з найбільших та відомих Шампанських Будинків. Taittinger виробляє вина в витонченому стилі, спираючись на фруктову та квіткову палітру. Taittinger NV Brut Reserve - суміш більш ніж 35 різних виноградників. Шампанське має чистий, свіжий та бадьорий аромат свіжого яблука, лайма, цедри апельсина та яблучної кісточки. У смаку приємна кисло-солодка нота. Шампанське має легкість, елегантність і прекрасний баланс.\nВиноград пресують у спеціальних приміщеннях одразу на виноградниках, сусло ферментують за умов температурного контролю. Після відпочинку протягом зими, вино з`єднують і остаточне кюве піддається вторинної ферментації у пляшці у холодних підвалах Taittinger. Вино проводить на осаді майже чотири роки.\nГеографія - Франція (Шампань)\nСортовий склад - 40% Шардоне, 35% Піно Нуара та 25% Піно Меньє\nМіцність - 12,5%\nЦукор - 8,6 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090192.jpg?t=1741093369773", "price": 1883}, {"id": 1090133, "name": "Champagne Taittinger Brut Reserve", "desc": "Taittinger - один з найбільших та відомих Шампанських Будинків. Шампанське має чистий, свіжий та бадьорий аромат свіжого яблука, лайма, цедри апельсина та яблучної кісточки.\nГеографія - Франція (Шампань)\nСортовий склад - 40% Шардоне, 35% Піно Нуара та 25% Піно Меньє\nМіцність - 12,5%\nЦукор - 8,6 г/л", "tags": ["Аперитив", "Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090133.jpg?t=1741092582607", "price": 3359}, {"id": 1090195, "name": "Champagne Lamiable Terre D`Etoiles Brut Grand Cru", "desc": "Вишукане шампанське. Смак: Округлий та гармонійний фруктово-цитрусовий смак з освіжаючою кислотністю.\nАромат: Розкішний аромат з відтінками білих кісточкових фруктів, цитрусових, вершкового масла, випічки та квітів.\nГеографія - Франція (Шампань)\nСортовий склад - Шардоне/Піно Нуар\nМіцність - 12,5%\nЦукор - 7,8 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090195.jpg?t=1741093538590", "price": 2243}, {"id": 1090210, "name": "Cremant de Bourgogne Brut Pinot Noir", "desc": "Ігристе за технологією шампанського. Виразне рожеве ігристе на основі Піно Нуару, аромат червоних ягід, прянощів, цитрусів. Свіжий смак з тонами грейпфрута і полуниці.\nГеографія - Франція (Бургундія)\nСортовий склад - Гаме/Піно Нуар\nМіцність - 11%\nЦукор - 8 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090210.jpg?t=1741093939179", "price": 1043}, {"id": 1090215, "name": "Franciacorta Guido Berlucchi Cuvee Imperiale Brut", "desc": "Солом`яно-жовтого кольору. Інтенсивний аромат банану, ананасу, яблука, груші, грейпфруту, фундука, хлібної скоринки. Чистий, насичений смак з легкою кислинкою.\nГеографія - Італія (Ломбардія)\nСортовий склад - Шардоне/Піно Нуар\nМіцність - 12,5%\nЦукор - 8 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090215.jpg?t=1741094150798", "price": 1763}, {"id": 1090221, "name": "Cava Juve y Camps Reserva de la Familia Gran Reserva Brut Nature", "desc": "Дуже свіже та чисте вино, з легким ароматом ванілі, білих фруктів та квітів. Ноти смажених тостів та легкі тони цитрусових. Освіжаючий і надзвичайно гармонійний смак.\nГеографія - Іспанія (Пенедес)\nСортовий склад - Макабео/Шареллу/Парельяда\nМіцність - 12%\nЦукор - 0,8 г/л", "tags": ["Рек. Юлія", "Аперитив", "Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090221.jpg?t=1741094297947", "price": 1091}, {"id": 1090226, "name": "Cava Juve y Camps Reserva de la Familia Gran Reserva Brut Nature Magnum", "desc": "Дуже свіже та чисте вино, з легким ароматом ванілі, білих фруктів та квітів. Ноти смажених тостів та легкі тони цитрусових.\nГеографія - Іспанія (Пенедес)\nСортовий склад - Макабео/Шареллу/Парельяда\nМіцність - 12%\nЦукор - 0,8 г/л", "tags": ["Рек. Катерина", "Аперитив", "Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090226.jpg?t=1741094382206", "price": 2603}, {"id": 1090238, "name": "Cava Jaume Serra Brut Nature", "desc": "Блідо-жовтого кольору з тонкою грою бульбашок. Ароматний та інтенсивний букет, дуже свіжий та фруктовий з нотками витримки. Хороша структура, м`яке, чисте та збалансоване ігристе.\nГеографія - Іспанія (Каталонія)\nСортовий склад - Макабео/Шареллу/Парельяда\nМіцність - 11,5%\nЦукор - 1,5 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090238.jpg?t=1741095037639", "price": 467}, {"id": 1090237, "name": "Cava Jaume Serra Brut", "desc": "Свіжий аромат з відтінками хлібної скоринки, випічки та зеленого яблука. Чудовий баланс із легкими тонами випічки.\nГеографія - Іспанія (Каталонія)\nСортовий склад - Макабео/Ксерело/Парельяда\nМіцність - 11,5%\nЦукор - 7 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090237.jpg?t=1741094933071", "price": 467}, {"id": 1090234, "name": "Cava Jaume Serra Brut Rosado", "desc": "Стійкий потік бульбашок, яскравий аромат малини та полуниці. Повне, живе, з доброю кислотністю з нотками червоних ягід і вишень.\nГеографія - Іспанія (Каталонія)\nСортовий склад - Трепат/Піно Нуар\nМіцність - 11,5%\nЦукор - 9,5 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090234.jpg?t=1741094841149", "price": 515}, {"id": 1089668, "name": "Cava Jaume Serra Semi Seco", "desc": "Солом`яно-жовтого кольору із стійким потоком дрібних бульбашок. Насичений ароматний, свіжий фруктовий букет, щільний добре збалансований смак. Свіжий і чистий післясмак.\nГеографія - Іспанія (Каталонія)\nСортовий склад - Макабео/Парельяда\nМіцність - 11,5%\nЦукор - 35 г/л", "tags": ["Сабраж"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1089668.jpg?t=1741082728332", "price": 467}, {"id": 1090002, "name": "Біссер Колоніст біле брют", "desc": "Класична технологія шампанізації. Витримують на дріжджах в пляшках протягом 2 років.\nАромат: Благородні пахощі квітів, скоринки хліба і горіхів.\nГеографія - Україна (Придунайська Бессарабія, Одеська область)\nСортовий склад - Шардоне\nМіцність - 12%\nЦукор - 11,25 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090002.jpg?t=1741089534110", "price": 923}, {"id": 1090059, "name": "Pet Nat White Blend Biologist", "desc": "Біле сухе нефільтроване вино. Метод ансестраль. Складний аромат з нотками червоних ягід і трав.\nСмак яскравий, свіжий, насичений з хрумкими тонами ягід.\nГеографія - Україна (Київська обл. с Лісники)\nСортовий склад - Піно Нуар/Шардоне/Трамінер\nМіцність - 10%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090059.jpg?t=1741091186483", "price": 719}, {"_heading": "Просеко"}, {"id": 1078601, "name": "Miol Prosecco Treviso Extra-Dry", "desc": "Bortolomiol – одне з найпрестижніших Prosecco. Виноградники в гористій місцевості, збір врожаю ручний. Extra-Dry. Аромати персика, груші та зеленого яблука. Легке, свіже з переважанням фруктових тонів.\nГеографія - Італія (Венето)\nСортовий склад - Глера\nМіцність - 11%\nЦукор - 13 г/л", "tags": ["Аперитив"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078601.jpg?t=1740491225862", "price": 803}, {"id": 1078604, "name": "Miol Prosecco Treviso (frizzante)", "desc": "Простий, свіжий, легкий Prosecco для повсякденного вживання. Фруктові та квіткові тони, велика кількість свіжості.\nГеографія - Італія (Венето)\nСортовий склад - Глера 85%/Піно/Шардоне 15%\nМіцність - 11%\nЦукор - 10 г/л", "tags": ["Ігристе", "Аперитив"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078604.jpg?t=1740491874581", "price": 791}, {"id": 807835, "name": "Prosecco Villa Jolanda", "desc": "Запашний аромат, багатий на квіткові та фруктові відтінки. Приємний, свіжий, стійкий смак.\nГеографія - Італія (Венето)\nСортовий склад - Глера\nМіцність - 11,5%\nЦукор - 15 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-807835.jpg?t=1725204689652", "price": 671}, {"id": 1078738, "name": "Prosecco Soligo Treviso Extra Dry", "desc": "Делікатний аромат зеленого яблука, акації та білих квітів. Чудовий баланс і м`якість. Хороший аперитив з приємним цитрусовим слідом.\nГеографія - Італія (Венето)\nСортовий склад - Глера\nМіцність - 11%\nЦукор - 15 г/л", "tags": ["Аперитив"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078738.jpg?t=1740500357505", "price": 671}, {"id": 802932, "name": "Casalforte Prosecco", "desc": "Світло-солом'яний колір з тонкою грою бульбашок. Тони тропічних фруктів, персика та квітів акації. Освіжаюча кислотність, смак стиглого яблука, груші з цитрусовим фінішем.\nГеографія - Італія (Венето)\nСортовий склад - Глера\nМіцність - 11%\nЦукор - 11 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-802932.jpg?t=1724944089626", "price": 407, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "750 мл", "price": 650}, {"label": "375 мл", "price": 407}]}}, {"id": 807830, "name": "Canti Prosecco", "desc": "Дуже легке та ненав'язливе Просекко. Відтінки цитрусу, персика, жовтого яблука. Зелені яблука та груші у смаку, середня кислотність, сухий післясмак.\nГеографія - Італія (Венето)\nСортовий склад - Глера\nМіцність - 10,5%\nЦукор - 14 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-807830.jpg?t=1725202998024", "price": 263, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "750 мл", "price": 623}, {"label": "200 мл", "price": 263}]}}, {"id": 1078766, "name": "Canti Prosecco Frizzante", "desc": "Приємне, легке ігристе. Відтінки білих квітів, зеленого яблука і тонкий натяк на тости. Свіже та питке. Чудовий аперитив.\nГеографія - Італія (Венето)\nСортовий склад - Глера\nМіцність - 10,5%\nЦукор - 13 г/л", "tags": ["Аперитив"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078766.jpg?t=1740504572730", "price": 640}, {"_heading": "Ігристі"}, {"id": 1089912, "name": "Codorníu Zero", "desc": "Безалкогольне ігристе вино. Свіжі аромати цитрусових і тропічних фруктів. Дрібні бульбашки, фруктово-лимонадний характер і гармонійний баланс солодкості та свіжості.\nГеографія - Іспанія\nСортовий склад - Айрен\nЦукор - 44 г/л", "tags": ["Безалкогольне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1089912.jpg?t=1741084974538", "price": 683}, {"id": 1091488, "name": "Sauvignon Blanc Bubbles Marlborough Sun", "desc": "Незвичайне ігристе із Совіньйон Блан. Яскравий аромат нектарину, маракуї та цитрусових. Свіжий, легкий смак з відтінками лайма і грейпфрута.\nГеографія - Нова Зеландія (Мальборо)\nСортовий склад - Совіньйон Блан\nМіцність - 12,5%\nЦукор - 12,83 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091488.jpg?t=1741173815873", "price": 983}, {"id": 1080060, "name": "Pinot Grigio Brut Blanc", "desc": "Яскраве та гармонійне ігристе. Прекрасний баланс, відтінки лайма, зеленого яблука та легка квіткова нота. Дуже свіже.\nГеографія - Італія\nСортовий склад - Піно Гриджо\nМіцність - 11%\nЦукор - 10 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1080060.jpg?t=1740587964077", "price": 443}, {"id": 1080150, "name": "El Capitan Brut White", "desc": "46 Parallel - молодий український бренд. Смак приємний, гармонійний, фруктовий з живою кислотністю.\nАромат: тони весняних квітів, зелених і жовтих яблук, стиглого нектарина і персика.\nГеографія - Україна\nСортовий склад - Піно Блан і Шардоне\nМіцність - 11,9%\nЦукор - 0,9 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1080150.jpg?t=1740595412692", "price": 503}, {"id": 1091529, "name": "Lambrusco dell'Emilia Bianco Dry", "desc": "Chiarli - найстаріший виробник ламбруско. Делікатний квітково-фруктовий аромат, приємний і сухий смак. Відмінний вибір для аперитиву.\nГеографія - Італія (Емілія-Романья)\nСортовий склад - Ламбруско Дель Емілья\nМіцність - 10%\nЦукор - 12 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091529.jpg?t=1741174561514", "price": 335}, {"id": 1091553, "name": "Lambrusco dell'Emilia Bianco", "desc": "Легке і напівсолодке ламбруско. Делікатний квітково-фруктовий аромат, приємний напівсолодкий смак.\nГеографія - Італія (Емілія-Романья)\nСортовий склад - Ламбруско Дель Емілья\nМіцність - 7,5%\nЦукор - 50 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091553.jpg?t=1741175114580", "price": 335}, {"id": 1091568, "name": "Lambrusco dell'Emilia Rosato Dry", "desc": "Легке рожеве вино з приємною свіжістю, легкою ігристістю і чарівними ароматами суниці.\nГеографія - Італія (Емілія-Романья)\nСортовий склад - Ламбруско Дель Емілья\nМіцність - 10%\nЦукор - 12 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091568.jpg?t=1741175556974", "price": 335}, {"id": 1091582, "name": "Lambrusco dell'Emilia Rosato", "desc": "Легке рожеве вино приємно солодке, має легку ігристість і приємний аромат суниці.\nГеографія - Італія (Емілія-Романья)\nСортовий склад - Ламбруско Дель Емілья\nМіцність - 7,5%\nЦукор - 50 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091582.jpg?t=1741176042750", "price": 335}, {"id": 1091724, "name": "Leleka Wines Brut", "desc": "Смак: Багатий, збалансований, фруктовий з нотами маслянистості та делікатної кислотності.\nАромат: Тони польових квітів, жовтих яблук, груш та свіжого хліба й лимону.\nГеографія - Україна (Одеська обл. Південна Бессарабія)\nСортовий склад - Аліготе/Сухолиманський білий\nМіцність - 12%", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091724.jpg?t=1741178374028", "price": 383}, {"id": 1091730, "name": "Leleka Wines Semi-dry", "desc": "Смак: Гармонійний, делікатний з нотами білих фруктів, акацієвого меду та мінеральними штрихами.\nАромат: Екзотичні фрукти, мотиви ванільного штруделя та ананасу.\nГеографія - Україна (Одеська обл. Південна Бессарабія)\nСортовий склад - Аліготе/Сухолиманський білий\nМіцність - 11,5%", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091730.jpg?t=1741178557667", "price": 383}, {"id": 1091736, "name": "Leleka Wines Semi-sweet", "desc": "Смак: Чуттєвий, м'який, солодкі фруктові ноти, які плавно перетікають у живий післясмак з тонкою кислинкою.\nАромат: Тони стиглих кісточкових фруктів, запашних білих квітів й солодкої ванілі.\nГеографія - Україна (Одеська обл. Південна Бессарабія)\nСортовий склад - Аліготе/Сухолиманський білий\nМіцність - 12,5%", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091736.jpg?t=1741178679067", "price": 383}]}, {"id": "cocktails", "name": "Коктейлі", "items": [{"id": 556647, "name": "Tropical Spritz", "desc": "Освіжаючий і фруктовий напій, який поєднує в собі екзотичні смаки на основі джину та ігристого", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-556647.jpg?t=1711983465179", "price": 190}, {"id": 556767, "name": "Strawberry Spritz", "desc": "Освіжаючий коктейль з ігристого вина та фруктового сиропу.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-556767.jpg?t=1711983648962", "price": 190}, {"id": 556973, "name": "Венеціанський Спрiтц", "desc": "Легкий і освіжаючий напій. Основа лікер Кампарі, ігристе вино, содова.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-556973.jpg?t=1711984069283", "price": 190}, {"id": 557019, "name": "HUGO", "desc": "Hugo Spritz – освіжаючий та легкий напій з ігристого, сиропу бузини та м'яти.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557019.jpg?t=1711984429472", "price": 219}, {"id": 557217, "name": "Cucumber gin", "desc": "Освіжаючий літній коктейл на основі джину, содової та сиропу огірка.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557217.jpg?t=1711984909893", "price": 180}, {"id": 557224, "name": "Маргарита", "desc": "Класичний коктейль на основі текіли, лимонного фрешу та куантро.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557224.jpg?t=1711985870446", "price": 180}, {"id": 557225, "name": "Сангрiя", "desc": "Іспанський фруктовий коктейль з червоним вином та апельсиновим соком.", "tags": [], "image": null, "price": 180}, {"id": 557238, "name": "Негронi", "desc": "Коктейль на основі джину, вермуту та бітеру Кампарі, прикрашений цедрою апельсинів.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557238.jpg?t=1711986906429", "price": 195}, {"id": 557241, "name": "Бульвардье", "desc": "Яскравий напій на основі бурбона, червоного вермуту та лікеру Негроні.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557241.jpg?t=1711987057390", "price": 195}, {"id": 557488, "name": "Віскі Сауер", "desc": "Кисло-солодкий, бадьорячий на основі бурбону.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557488.jpg?t=1712061200853", "price": 210}, {"id": 557493, "name": "Гарібальді", "desc": "Для сильних духом. На основі бітеру та апельсинового соку.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557493.jpg?t=1712061861045", "price": 180}]}, {"id": "spirits", "name": "Міцний алкоголь", "items": [{"_heading": "Віскі"}, {"id": 637472, "name": "West Cork Bourbon Cask", "desc": "West Cork тричі дистилюють та витримують не менше трьох років у бочках з-під бурбона. Профіль віскі округлий, збалансований з ароматом цитрусів, яблук, чорного перцю та мускатного горіха.\nГеографія - Ірландія\nМіцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-637472.jpg?t=1715177931097", "price": 95, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "50 мл", "price": 95}, {"label": "Ціна за пляшку", "price": 959}]}}, {"id": 637485, "name": "Loch Lomond Original", "desc": "Карамель, маслянистий горіх і відтінок курної дубової копченості в ароматі. Географія - Великобританія (Шотландія). Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-637485.jpg?t=1715178342161", "price": 139, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "50 мл", "price": 139}, {"label": "1 шт", "price": 1499}]}}, {"id": 766629, "name": "Glenfiddich 12 y.o", "desc": "Односолодовий, найбільш продаваний у світі. Делікатний фруктовий, трав'янистий, медовий характер. Географія - Великобританія (Шотландія). Міцність - 40%.", "tags": ["Витримане"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-766629.jpg?t=1722263948622", "price": 259, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "50 мл", "price": 259}, {"label": "Ціна вказана за пляшку", "price": 3599}]}}, {"id": 1091969, "name": "Poli SEGRETARIO DI STATO", "desc": "Унікальний солодовий віскі, 5 років витримки у бочках від Amarone. Географія - Італія (Венето). Тип - Солодовий віскі. Міцність - 43%.", "tags": ["Витримане", "Торф/Дим"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091969.jpg?t=1741181951658", "price": 2999}, {"id": 1097998, "name": "Loch Lomond Single Grain Single Malt Scotch", "desc": "Елегантний і насичений. М'які фрукти, вершкова ваніль, відтінок диму та торфу. Географія - Великобританія (Шотландія). Міцність - 46%.", "tags": ["Витримане", "Торф/Дим"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1097998.jpg?t=1741610856190", "price": 1499}, {"id": 1091976, "name": "West Cork IPA Cask", "desc": "Купажований віскі у бочках з-під бурбона та IPA Blacks of Kinsale. Відтінки горіхів, смаженого солоду. Географія - Ірландія. Міцність - 40%.", "tags": ["Витримане"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091976.jpg?t=1741182483134", "price": 1439}, {"_heading": "Коньяк / Бренді / Портвейн / Мадейра / Херес / Граппа"}, {"id": 1092016, "name": "Sandeman Porto Ruby", "desc": "Яскравий рубіновий портвейн з ароматом червоних фруктів. Географія - Португалія (Доуро). Міцність - 19,5%.", "tags": ["Солодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092016.jpg?t=1741183924266", "price": 695}, {"id": 1092026, "name": "Бренді Imperial", "desc": "Насичений аромат з дубовими та ванільними відтінками. Багаті хересні тони. Географія - Іспанія (Херес). Міцність - 40%.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092026.jpg?t=1741184365727", "price": 707}, {"id": 1097988, "name": "Коньяк A.E.Dor VS", "desc": "Свіжий, фруктовий VS з регіонів Бордері та Фін Буа. Квітковий, фруктовий аромат з медовими відтінками. Географія - Франція (Коньяк). Міцність - 40%.", "tags": ["Витримане"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1097988.jpg?t=1741610209449", "price": 1979}, {"id": 1098011, "name": "Граппа Poli Grappa Bassano Classica", "desc": "Кришталево чиста молода граппа. Аромат гортензії, зеленого яблука, персика. Географія - Італія. Міцність - 40%.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1098011.jpg?t=1741612536012", "price": 1175}, {"_heading": "Ром"}, {"id": 1092022, "name": "Tanduay Asian Rum Silver", "desc": "Білий ром преміум-класу з Філіппін. Витриманий у бочках з-під бурбону. Відтінки мандаринової шкірки, смаженого кокосу й ванілі. Міцність - 40%.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092022.jpg?t=1741184095550", "price": 743}, {"_heading": "Горілка / Джин"}, {"id": 766632, "name": "Горілка Staritsky&Levitsky", "desc": "Преміальна горілка України. Вироблена в Прикарпатті. П'ятиразова дистиляція. Легкий, сухий, делікатний смак. Географія - Україна.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-766632.jpg?t=1722264109139", "price": 120, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "50 мл", "price": 120}, {"label": "Ціна вказана за пляшку 0,5", "price": 755}]}}, {"id": 1091612, "name": "Горілка Esbjaerg", "desc": "Популярна датська горілка, виробляється в Нідерландах. М'яка, гладка, кристально чиста. Географія - Нідерланди. Міцність - 40%.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091612.jpg?t=1741176538744", "price": 419}, {"id": 1098009, "name": "Джин Larios 12", "desc": "Іспанський преміум джин. 5-разова перегонка. Ноти трав, апельсинових квітів та цитрусових. Географія - Іспанія (Малага). Міцність - 40%.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1098009.jpg?t=1741612118155", "price": 755}]}, {"id": "beer", "name": "Пиво", "items": [{"_heading": "Пиво"}, {"id": 578910, "name": "Пиво Ottakringer", "desc": "Солод та хміль об`єдналися у цьому австрійському пиві. Свіжа і тонка фруктовість разом із легкою терпкістю роблять це класичне пиво справді вдалим та популярним.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-578910.jpg?t=1713287768455", "price": 72}, {"id": 580546, "name": "MakarBeer IPA 0,33", "desc": "Сильно охмелений різновид світлого елю. Яскраво виражений хмельовий смак з тонами хвої, цитрусу, ананасу.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-580546.jpg?t=1713360121814", "price": 89}, {"id": 580677, "name": "MakarBeer Pilsner 0,33", "desc": "Класичний преміальний пілснер. Традиційна гірчинка, довгий гіркий післясмак з невеликою квітковістю.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-580677.jpg?t=1713362900214", "price": 89}, {"id": 580679, "name": "MakarBeer Amber Ale 0,33", "desc": "Напівтемне пиво у стилі ALE. М'який смак з присмаком свіжого хмелю та карамелі.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-580679.jpg?t=1713363020808", "price": 89}, {"id": 605768, "name": "MakarBeer Lager double hop 0.33", "desc": "Світле нефільтроване непастеризоване. Хмельова гіркота середня, хмельовий аромат помірно сильний.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-605768.jpg?t=1713447412011", "price": 59}, {"_heading": "Сікера"}, {"id": 1107513, "name": "Pet-Cat Rose", "desc": "Мед питний ігристий. Природне бродіння липового меду та соку яблук, ожини, смородини. Без спирту та цукру. Географія - Україна. Міцність - 8%.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1107513.jpg?t=1742299098061", "price": 443}]}, {"id": "drinks", "name": "Напої", "items": [{"_heading": "Глінтвейн"}, {"id": 981626, "name": "Глінтвейн", "desc": "Поєднання Каберне Совіньйон та натурального меду з нотами кориці, гвоздики та апельсина.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-981626.jpg?t=1741177570918", "price": 135}, {"_heading": "Кава"}, {"id": 557494, "name": "Еспресо/Espresso", "desc": "", "tags": [], "image": null, "price": 45}, {"id": 557515, "name": "Допіо/Dopio", "desc": "", "tags": [], "image": null, "price": 90}, {"id": 557500, "name": "Американо/Americano", "desc": "", "tags": [], "image": null, "price": 45}, {"id": 557496, "name": "Американо з молоком", "desc": "", "tags": [], "image": null, "price": 60}, {"id": 557511, "name": "Латте/Latte", "desc": "", "tags": [], "image": null, "price": 78, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "350 мл", "price": 78}, {"label": "450 мл", "price": 135}]}}, {"id": 557514, "name": "Капучино", "desc": "", "tags": [], "image": null, "price": 65, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "250 мл", "price": 65}, {"label": "350 мл", "price": 78}]}}, {"id": 557516, "name": "Флет Уайт", "desc": "", "tags": [], "image": null, "price": 110}, {"id": 568790, "name": "Альтернативне молоко", "desc": "Безлактозне", "tags": [], "image": null, "price": 35}, {"_heading": "Чай"}, {"id": 557517, "name": "Какао", "desc": "", "tags": [], "image": null, "price": 70}, {"id": 557521, "name": "Чай заварний", "desc": "Чорний, чорний з бергамотом, саусеп, альпійський луг, бризки шампанського.", "tags": [], "image": null, "price": 50, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "300 мл", "price": 50}, {"label": "500 мл", "price": 75}]}}, {"id": 558571, "name": "Чай натуральний фруктовий", "desc": "", "tags": [], "image": null, "price": 65, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "", "price": 65}, {"label": "", "price": 95}]}}, {"_heading": "Прохолодне"}, {"id": 558771, "name": "Айс Латте", "desc": "", "tags": [], "image": null, "price": 110}, {"id": 558772, "name": "Бамбл", "desc": "", "tags": [], "image": null, "price": 120}, {"id": 558774, "name": "Еспресо Тонік", "desc": "", "tags": [], "image": null, "price": 125}, {"id": 559003, "name": "Лимонад", "desc": "", "tags": [], "image": null, "price": 110, "options": {"label": "Розмір / Об'єм", "choices": [{"label": "400 мл", "price": 110}, {"label": "1 л", "price": 179}]}}, {"_heading": "Газовані напої / вода"}, {"id": 84341001, "name": "Вода негазована", "desc": "", "tags": [], "image": null, "price": 55}, {"id": 84341002, "name": "Вода газована", "desc": "", "tags": [], "image": null, "price": 55}]}, {"id": "food", "name": "Поїсти", "items": [{"_heading": "Сніданки"}, {"id": 1205208, "name": "Ніжні сирники з маракуйєвим сабайоном", "desc": "Золотисті сирники з маракуєвим кремом сабайон і кулькою морозива. 280 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205208.jpg?t=1746880545741", "price": 230}, {"id": 1205213, "name": "Крок Мадам", "desc": "Тост з хліба, шинки та сиру гауда, запечений під соусом бешамель з смаженим яйцем. 300 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205213.jpg?t=1746880598616", "price": 285}, {"id": 1205218, "name": "Скремблер з креветкою в сирному соусі на круасані", "desc": "Повітряний яєчний скрембл у сирному соусі з креветками на круасані. 220/60 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205218.jpg?t=1746880683878", "price": 320}, {"id": 1205221, "name": "Яйця пашот з прошутто та соусом дор блю", "desc": "Яйця пашот на булці з соусом бешамель, дор блю та прошутто. 260 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205221.jpg?t=1746880716996", "price": 250}, {"_heading": "Стартери"}, {"id": 1205229, "name": "Камамбер з мармеладом із чорізо", "desc": "Запечений камамбер з пряною солодко-гострою пастою з чорізо. Ідеально до вина та хрусткого хліба.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205229.jpg?t=1746880844200", "price": 270}, {"id": 1205232, "name": "Тартар з тунця з круасаном", "desc": "Тартар із тунця з мусом авокадо та філе апельсина. З хрустким круасаном. 170/60 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205232.jpg?t=1746880907231", "price": 360}, {"id": 1205234, "name": "Тартар з телятини з мусом шевру", "desc": "Соковита телятина з трюфельною пастою та зернистою гірчицею. Мус із шевру. 170 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205234.jpg?t=1746880907538", "price": 340}, {"id": 1222172, "name": "Соте з морепродуктів в соусі Шампань", "desc": "Креветки, мідії та кальмари в вершково-винному соусі Шампань з пармезаном. 200 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1222172.jpg?t=1747848824928", "price": 290}, {"id": 1216579, "name": "Тапінада з маслин та оливок", "desc": "Хрусткий багет з двома видами тапенада — з маслин і оливок. Олія з копченої паприки та зелена олія. 100/60 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1216579.jpg?t=1747414511230", "price": 210}, {"id": 559008, "name": "Антипасті", "desc": "Витриманий сир, сир з блакитною пліснявою, оливки Гордаль, хамон, грисіні. 250 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559008.jpg?t=1712149789649", "price": 299}, {"id": 1512980, "name": "Креветки Темпура", "desc": "Ніжні креветки у хрусткому клярі з соусом айолі. 120г/30г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1512980.jpg?t=1762443470730", "price": 295}, {"id": 1512982, "name": "Картопля Фрі з пармезаном", "desc": "Хрустка золотиста картопля з пармезаном та кетчупом. 130г/40г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1512982.jpg?t=1762443537027", "price": 119}, {"id": 1519173, "name": "Цибулеві кільця фрі", "desc": "", "tags": [], "image": null, "price": 119}, {"id": 1205227, "name": "Камамбер з грушею у червоному вині", "desc": "Запечений камамбер з грушею в червоному вині з карамелізованою грушею та винним соусом.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205227.jpg?t=1746880839965", "price": 270}, {"_heading": "Пінчо"}, {"id": 559018, "name": "Камамбер та грушевий джем", "desc": "Камемер з пряним грушевим джемом та мигдальними чіпсами.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559018.jpg?t=1712150273987", "price": 149}, {"id": 559034, "name": "Грильований перець та анчоус", "desc": "Неймовірне поєднання крем сиру, болгарського перцю та анчоусів.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559034.jpg?t=1712150757577", "price": 149}, {"id": 559048, "name": "Сальса з артишоків та хамон", "desc": "Хрустки багет, мариновані артишоки та хамон Серано.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559048.jpg?t=1712151567902", "price": 149}, {"id": 559060, "name": "Гуакамоле та креветки", "desc": "Хрустка основа з ніжним гуакамоле й соковитими креветками.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559060.jpg?t=1712152258182", "price": 179}, {"id": 688932, "name": "В'ялені томати та крем сир", "desc": "Ніжний крем-сир на хрусткому багеті, доповнений в'яленими томатами.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-688932.jpg?t=1716901390292", "price": 149}, {"id": 824330, "name": "Пінчо Крем Чіз/Чорізо", "desc": "Іспанське чорізо на подушці з крем чізу та трюфельної олії, мікрогрін, хрустка чіабата.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-824330.jpg?t=1726671753007", "price": 169}, {"id": 824393, "name": "Пінчо хамон-свіжі томати", "desc": "Іспанський хамон на подушці з грецького йогурту зі свіжим томатом, мікрогрін, чіабата.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-824393.jpg?t=1726671846401", "price": 169}]}, {"id": "icecream", "name": "Морозиво", "items": [{"id": 695648, "name": "Морозиво Gelamo", "desc": "Пломбір.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-695648.jpg?t=1742230494508", "price": 60}]}, {"id": "other", "name": "Інше", "items": [{"id": 1218553, "name": "Crazy menu", "desc": "Ви можете продовжити ваш вечір після закриття закладу на годину", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1218553.jpg?t=1747587355618", "price": 1000}, {"id": 766648, "name": "Розбитий келих", "desc": "", "tags": [], "image": null, "price": 250}, {"id": 766649, "name": "КОРК ФРІ", "desc": "", "tags": [], "image": null, "price": 500}]}]};
    window.MENU = data;
    await loadCart();
    resolveCartKeys();
    buildUI(MENU);
    MENU.categories.forEach(cat =>
      cat.items.forEach(item => { if (!item._heading) renderCardCtrl(item.id); }),
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