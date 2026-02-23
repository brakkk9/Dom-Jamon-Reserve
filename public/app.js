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
    const data = {"categories": [{"id": "drinks", "name": "Напої", "items": [{"_heading": "Глінтвейн"}, {"id": 981626, "name": "Глінтвейн", "desc": "Наш глінтвейн – це витончене поєднання класичного французького Каберне Совіньйон та натурального меду, що надає напою ніжну солодкість і глибину смаку. Ми доповнили його пряними нотами кориці, гвоздики та ароматного апельсина, створюючи теплий, оксамитовий букет, що огортає затишком із першого ковтка.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-981626.jpg?t=1741177570918", "price": 135}, {"_heading": "Вина в келихах"}, {"id": 569680, "name": "Фрізанте Бьянко Глера 100%", "desc": "Географія - Італія Сортовий склад - Глера 100% Міцність - 11% Цукор - 12,8 г/л", "tags": ["Сухе", "Ігристе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-569680.jpg?t=1712670615186", "price": 60, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "100 мл", "price": 60}, {"label": "700 мл", "price": 420}]}}, {"id": 628758, "name": "Pinot Noir 46 Parallel", "desc": "Смак: делікатний, свіжий, чистий, переважають нюанси стиглих ягід, а в приємному післясмаку відчутна легка кислинка. Географія - Україна (Одеська обл, Ізмаїльський район) Сортовий склад - Піно нуар Мицність - 12,6 % Цукор - 2,98 г/л", "tags": ["Сухе", "Україна"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-628758.jpg?t=1714567789751", "price": 135}, {"id": 560245, "name": "Souvignon Blanc Marlborough Sun", "desc": "Ви напевно чули про цей крутий Sauvignon Blanc з Нової Зеландії, Marlborough Sun. А ті, хто пробував, знають, що варто брати про запас. Взагалі, це вино - пряме попадання! Смак супер свіжий, збалансована кислотність, просто проникає в душу. Marlborough Sun - доступне і водночас надзвичайно стильне новозеландське вино. Тут немає ніякої пафосності, просто гарне вино, яке сподобається ароматами маракуї, аґрусу, листків чорної смородини і рожевого грейпфрута! Ви точно не пошкодуєте, обіцяємо! Географія - Нова Зеландія (Мальборо) Сортовий склад - Совиньйон Блан Міцність - 13% Цукор - 2,68 г/л", "tags": ["Сухе", "По бокалу"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560245.jpg?t=1712239437900", "price": 145}, {"id": 560746, "name": "Juan Gil Moscatel", "desc": "Яскравого солом`яно-жовтого кольору із зеленим відливом. Свіжий букет з широким спектром ароматів кісточкових (насамперед персика), тропічних фруктів та цитрусових. Елегантна квіткова основа з нотками апельсинового цвітіння та жасмину. У смаку освіжаюче, з нотками фруктів та вираженим відтінком цитрусових. Гармонійне і бархатисте зі збалансованою кислотністю та тривалим приємним післясмаком. Географія - Іспанія (Мурсія) Сортовий склад - Москатель Міцність - 13% Цукор - 5 г/л", "tags": ["Сухе", "По бокалу"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560746.jpg?t=1712246221754", "price": 145}, {"id": 560757, "name": "Callia Pinot Grigio", "desc": "Це Піно Гріджо для тих, хто не любить надмірно кислотних і насичених вин, тут ви знайдете їжу, фруктовість і легкість. В ароматі тона квітів, білих фруктів та абрикосу типові для вина з аргентинської Долини Тулума, смак м'який з гарним балансом фруктів та свіжості, приємне вино без зайвої експресії. Географія - Аргентина (Сан Хуан) Сортовий склад - Піно Гриджо Міцність - 11,5% Цукор - 4,11 г/л", "tags": ["Сухе", "По бокалу"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560757.jpg?t=1712246551875", "price": 115}, {"id": 560759, "name": "Leleka Wines Semi-Sweet", "desc": "Колір: солом'яний Смак: свіжий і повний з приємною кислотністю та майстерно вплетеними солодощами, які переходять у медовий присмак Аромат: пряний, з мандарином та солодким печеним яблуком, обрамлений ажурними нотами евкаліпта та естрагону Географія - Україна (Одеська обл, Південна Бессарабія) Сортовий склад - Піно грі Міцність - 12% Цукор - 15,25 - 18,5 г/л", "tags": ["Напівсолодке", "Україна"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-560759.jpg?t=1712246739844", "price": 115}, {"id": 567635, "name": "Essere Bardolino", "desc": "Свіже, легке молоде вино гранатового кольору з пурпуровими відблисками. Має фруктовий аромат з нотами фіалок, червоної та чорної смородини. Смак фруктовий, гармонійний, соковитий, м`який. Географія - Італія (Венето) Сортовий склад - Неграра/Корвина/Молинара/Рондинелла/Росиньйола; Міцність - 11,5% Цукор - 5 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-567635.jpg?t=1712578793642", "price": 115}, {"id": 567634, "name": "La Vieille Ferme", "desc": "Вина La Vieille Ferme – свіжі, фруктові вина на щодень з Долини Рони, виробляються у регіоні Кот Дю Венту. Це червоне соковите вино з ароматом стиглих фруктів та спецій. У смаку червоні ягоди, чорна смородина та ожина, спеції, плавно перетікають у свіжий смак. Географія - Франція (Долина Рони) Сортовий склад - Сира/Гренаш/Кариньян/Сенсо Міцність - 13% Цукор - 0,4 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-567634.jpg?t=1712578502156", "price": 145}, {"id": 567632, "name": "Laya Monastrel", "desc": "Laya - це союз Гарначі та Монастреля з виноградників, розташованих в Альмансі, на висоті від 700 до 1000 метрів. Завдяки 4 місяцям витримки у французьких дубових бочках вино збагатилося відтінками дуба. Тепер про аромати - тут у нас стиглі фрукти і дуб! Додайте в цей мікс ще трохи спецій - і ось воно, наше вино з зухвалим характером! У смаку щільне і сміливе: стигла слива, темна вишня, малиновий вибух. Навіть із твердими сирами вони знайшли спільну мову! Географія - Іспанія (Альманса) Сортовий склад - Монастрель/Гарнача/Тинторера Міцність - 14% Цукор - 5 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-567632.jpg?t=1712578043439", "price": 145}, {"_heading": "Білі вина"}, {"id": 569697, "name": "Canti Pinot Grigio Veneto", "desc": "Аромат розкривається тонами зеленого яблука з цитрусовими нюансами. Смак дуже свіжий, ненав`язливий. Вино ідеально підійде до легких закусок, пасті, або послужить гарним аперитивом. Географія - Італія (Венето) Сортовий склад - Пино Гриджо Міцність - 12% Цукор - 5 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-569697.jpg?t=1712672545035", "price": 215, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "750 мл", "price": 430}, {"label": "200 мл", "price": 215}]}}, {"id": 1072838, "name": "Pinot Grigio Delle Venezie DOC Essere", "desc": "Легке, свіже вино, має приємний аромат білих фруктів та ароматних квітів. У смаку питне, в ньому багато свіжості та гарний баланс. Географія - Італія (Венето) Сортовий склад - Піно Гриджо Міцність - 12% Цукор - 4,5 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1072838.jpg?t=1740337411834", "price": 460}, {"id": 927123, "name": "Pete`s Pure  Pinot Grigio біле сухе", "desc": "Прекрасне освіжаюче Піно Гріджо, такі вина називають ціна/якість. Тут аромат розкривається тонами гуави, свіжої маракуї, з легким відтінком зеленої груші. У смаку легке, з приємною свіжістю. Тут фруктова складова виходить на перший план, і лише потім слідує ледь помітні квіткові ноти. Післясмак легкий і ненав`язливий. Географія - Австралія (Долина Баросса) Сортовий склад - Піно Гріджо Міцність - 12,5% Цукор - 8,2 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927123.jpg?t=1732731388025", "price": 587}, {"id": 568745, "name": "Gazela Vihno Verde", "desc": "Приємне напівсухе вино, відтінки тропічних фруктів та цитрусу чудово доповнюється збалансованою кислотністю та легкою присутністю залишкового цукру. Ненав'язливе та універсальне, чудово охолодженим як аперитив або з різними овочевими стравами та фруктами. Географія - Португалія (Виньо Верде) Сортовий склад - Педерна/Азал/Лурейро/Тражадура Міцність - 9% Цукор - 12 г/л", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568745.jpg?t=1712658128802", "price": 395}, {"id": 918998, "name": "Dr. L  Riesling Trocken", "desc": "Легке освіжаюче вино з ароматом грейпфрута, мінералів і лайма. Елегантне, питуще смак, з гарним балансом і яскравою свіжістю. Чудовий аперитив. Вино добре поєднується з салатами, стравами з риби, курки та свинини. Географія - Німеччина (Мозель) Сортовий склад - Рислинг Міцність - 12% Цукор - 8,9 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-918998.jpg?t=1732034221234", "price": 503}, {"id": 919001, "name": "Dr. L  Riesling Feinherb", "desc": "Перед вами напівсолодкий рислінг початкового рівня, який є виразом елегантного та колоритного стилю рислінгу з Мозеля. Вино володіє ароматом польових квітів, лайма, цитрусу і яблук. У смаку відчуваються відтінки стиглих фруктів, солодкого персика. Географія - Німеччина (Мозель) Сортовий склад - Рислинг Міцність - 10,5% Цукор - 22,7 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919001.jpg?t=1732034370202", "price": 503}, {"id": 919003, "name": "Dr. L Riesling", "desc": "Цей Рислінг солодкий доктора Лузена початкового рівня втілює елегантні та пікантні характеристики виноградників Мозеля зі сланцевими ґрунтами. Завдяки своїм яскравим характеристикам. Географія - Німеччина (Мозель) Сортовий склад - Рислинг Міцність - 8,5% Цукор - 41 г/л", "tags": ["Солодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919003.jpg?t=1732034501927", "price": 503}, {"id": 919005, "name": "Gewurztraminer Villa Wolf", "desc": "Яскраве, напівсолодке вино з інтенсивним ароматом троянд та прянощів. У смаку відчувається чудовий баланс між насолодою та свіжістю. Географія - Німеччина (Пфальц) Сортовий склад - Гевюрцтраминер Міцність - 11,5% Цукор - 18 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919005.jpg?t=1732034685063", "price": 515}, {"id": 919007, "name": "Riesling Marlborough Sun", "desc": "Напівсухий Рислінг має достатньо свіжості та кислотності, щоб не здаватися солодким - прямо кайф! Мандарин, зелене яблуко, лайм, трохи тропічних фруктів в ароматі. У смаку освіжаюче, те, що потрібно в спеку або якщо нерви вередують, цей Riesling - просто порятунок! Географія - Нова Зеландія (Мальборо) Сортовий склад - Рислінг Міцність - 10,5% Цукор - 17,61 г/л", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919007.jpg?t=1732034989570", "price": 683}, {"id": 927095, "name": "Barista Chardonnay", "desc": "В ароматі яскравий вибух цитрусових тонів та персиків, агрусу та мандарин в обрамленні м`яких тонів ванілі від контакту з бочкою. Смак свіжий і структурний, з м`яким цитрусовим присмаком. Відмінне вино для аперитиву. Географія - ПАР (Робертсон) Сортовий склад - Шардоне Міцність - 13% Цукор - 6,7 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927095.jpg?t=1732729022866", "price": 653}, {"id": 927119, "name": "Sauvignon Blanc Savanha", "desc": "Свіжий, хрумкий Совіньйон блідо-жовтого кольору із середнім тілом та ароматом тропічних фруктів в обрамленні легких пряних тонів зеленого перцю та трави. Ці свіжі тони виявляються й у смаку, що характеризується відмінним балансом та структурою. Географія - ПАР (Вестерн Кейп) Сортовий склад - Шенен Блан Міцність - 13% Цукор - 2 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927119.jpg?t=1732731204063", "price": 407}, {"id": 927127, "name": "Montes  Sauvignon Blanc Limited Selection біле сухе", "desc": "Долина Лейда - регіон з прохолодним кліматом, який знаходиться під впливом холодної течії Гумбольдта в Тихому океані і, отже, виробляє яскраві, свіжі вина. Лінійка «Limited Selection» - чудові повсякденні вина, які ніколи не підведуть. Перед вами 100% Совіньйон Блан, з виразним ароматом свіжоскошеної трави, агрусу та тропічних фруктів. Вино середньої насиченості з великою кількістю свіжості.", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-927127.jpg?t=1732731752749", "price": 623}, {"id": 928826, "name": "Tarapaca Santa Cecilia Semi Sweet White", "desc": "Перед нами напівсолодке легке біле вино з ароматом стиглих фруктів. У смаку приємна, ненав'язлива солодкість. Вино, яке підкуповує своєю простотою. Географія - Чилі Сортовий склад - Педро Хименес Міцність - 10,5% Цукор - 21,05 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-928826.jpg?t=1732819130583", "price": 383}, {"id": 986320, "name": "Stakhovsky Wines Шардоне", "desc": "Аромат: польові квіти із відтінком весняного меду. Смак чистий, збалансований із цитрусовою кислинкою та тонами зрілого абрикосу. Географія - Україна Сортовий склад - Шардоне Міцність - 11,5% Цукор - 3 г/л", "tags": ["Сухе", "Україна"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986320.jpg?t=1736860399133", "price": 683}, {"id": 986324, "name": "Stakhovsky Wines Трамінер", "desc": "Український тенісист Сергій Стаховський творить вина під брендом Stakhovsky. В основі концепції – виробництво якісного вина, для цього було обрано перспективний терруар Закарпатської області в районі Берегове. Вина виробляються за контрактним виноробством на потужностях Котнар. Вино має яскравий аромат білих квітів, цитрусу та тропічних фруктів. Географія - Україна Сортовий склад - Траминер Міцність - 12,9% Цукор - 0,2 г/л", "tags": ["Сухе", "Україна"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986324.jpg?t=1736860473282", "price": 683}, {"id": 986375, "name": "Muscat Natureo Torres", "desc": "Прекрасне безалкогольне вино, яке призначене для тих, хто прагне вживати якнайменше алкоголю і не любить кислотні вина. Вишуканий квітковий та фруктовий аромат, який набувається завдяки сортовій особливості винограду. Смак легкий, хрумкий з тонким цитрусовим післясмаком. Географія - Іспанія Сортовий склад - Мускат Цукор - 38,6 г/л", "tags": ["Напівсолодке", "Безалкогольне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986375.jpg?t=1736861809161", "price": 587}, {"id": 986399, "name": "WIN Verdejo без алкогольне", "desc": "Вино має освіжаючий аромат з домінуючими відтінками зеленого яблука та весняних квітів. Смак вина м'який, гармонійний, з фруктово-квітковими відтінками та приємною кислинкою у післясмаку. Географія - Іспанія Сортовий склад - Вердехо Цукор - 0,5", "tags": ["Сухе", "Безалкогольне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-986399.jpg?t=1736862302839", "price": 743}, {"id": 1072834, "name": "Soave DOC Essere біле сухе", "desc": "Легке, свіже вино блідого солом`яного кольору із приємним букетом стиглих фруктів. Смак сухий, збалансований. Географія - Італія (Венето) Сортовий склад - Гарганега/Требиано ди Соаве Міцність - 11,5% Цукор - 5,5 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1072834.jpg?t=1740337277955", "price": 460}, {"id": 1072851, "name": "Sancerre Fournier Pere & Fils", "desc": "Cправжній шедевр виноробства, що вражає своєю елегантністю та вишуканістю. Виготовлене біле сухе вино з винограду сорту Совіньйон Блан. Виноградники бренду розташовані у прохолодному регіоні Сансер в Долині Луари, а урожай збирають зі старих лоз віком 15-20 років. Мінеральний та свіжий, вишукано доповнений тонким звучанням лимонного сорбету. Витриманий та стійкий аромат, із яскравими нотами лимона та смородинових бруньок. Блідо-золотий колір із елегантним відблиском. Географія - Франція (Долина Луари) Апелласьон - Sancerre Міцність - 13%", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1072851.jpg?t=1740338494454", "price": 1919}, {"id": 1092061, "name": "Hunawihr Gewurztraminer Reserve", "desc": "Яскраве, виразне вино має складний аромат екзотичних фруктів, таких як лічі і маракуйя, в обрамленні характерних сортових тонів троянд, які стають все наполегливішими з аерацією. Смак тривалий і щедрий із доброю кислотністю та свіжістю, переважанням екзотичних фруктів, незважаючи на досить високу залишкову насолоду, вино не перевантажене. Географія - Франція (Ельзас) Сортовий склад - Гевюрцтрамінер Міцність - 13,5% Цукор - 11,2 г/л", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092061.jpg?t=1741185729225", "price": 779}, {"id": 1092068, "name": "Casa Lunardi Pinot Grigio", "desc": "Легке й освіжаюче вино з квітковими ароматами, в які вплетені тони яблук, груш і лимона. У смаку стиглий ананас, соковиті зелені яблука, персик і цитрусові. Питке вино з помірною кислотністю. Географія - Італія (Венето) Сортовий скад - Піно Гріджіо 100% Міцність - 12% Цукор - 3 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092068.jpg?t=1741186009980", "price": 407}, {"id": 1092089, "name": "Casa Lunardi Chardonnay", "desc": "Світло-жовте вино з ароматом лічі й жовтих яблук. Делікатне, питке, легке, свіже із м'яко кислотністю й цитрусовим післясмаком. Географія - Італія (Венето) Сортовий склад - Шардоне 100% Міцність - 12% Цукор - 4 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092089.jpg?t=1741186913639", "price": 407}, {"id": 1092125, "name": "Casa Lunardi Soave", "desc": "У кольорі Соаве світло-солом'яне, його аромат розкривається зеленими яблуками, цитрусовими плодами і відтінками мигдалю. Свіже й питке, радує смакові рецептори збалансованої кислотністю, нюансами дині, яблук та квітів. Географія - Італія (Венето) Сортовий склад - Гарганега 100% Міцність - 12% Цукор - 4 г\л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092125.jpg?t=1741187273150", "price": 407}, {"id": 1092365, "name": "Casa Lunardi Sauvignon Blanc", "desc": "Солом'яно-жовте в кольорі. В ароматі чутні тони квітів глоду, тонкі відтінки шавлії та грейпфрута. Смак яскравий, свіжий, з хорошим рівнем кислотності, фруктовими, цитрусовими нотами та легкою трав'янистістю. Географія - Італія (Венето) Сортовий склад - Совіньйон Блан 100% Міцність - 12% Цукор - 4 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092365.jpg?t=1741187495020", "price": 407}, {"id": 1092366, "name": "Cappo Moscato", "desc": "Освіжаючий і питкий смак з яскравим ароматом лемонграсу, цитрусів, зелених яблук і дині, приємне вино без зайвої експресії, яке освіжає і не навантажує, краще пити добре охолодженим. Сподобається тим, хто не любить надто насичений, кислотний та строгий стиль. Географія - Іспанія (Мурсія) Сортовий склад - Мускат Міцність - 12% Цукор - 6 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092366.jpg?t=1741187710497", "price": 305}, {"id": 1092384, "name": "Vina Esmeralda", "desc": "Спокусливо легке вино з інтенсивним ароматом тропічних фруктів, білих квітів, жасмину, лілії та ноти троянди. Глибокий і трохи солодкуватий смак ідеально підійде для людей, яким не подобаються кислотні вина. Затяжний післясмак додасть пікантності даному зразку, а легкий тропічний відтінок не залишить вас байдужим. Географія - Іспанія Сортовий склад - Гевюрцтраминер/Москатель Міцність - 11,5% Цукор - 8,1 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092384.jpg?t=1741188676585", "price": 598}, {"id": 1092388, "name": "Chateau Lafon Sauternes (Сотерн)", "desc": "Шато Лафон - унікальне місце в Сотерні. Шато розташоване в самому серці Сотерну, посеред знаменитих виноградників Ікем, з лозами віком понад 50 років. Варто зазначити, що Лафон один із найкращих представників співвідношення ціна/якість із цього відомого апелласьйону. В ароматі домінують відтінки мармеладу, абрикосів, меду і цитруса. Смак має прекрасний баланс, приємну свіжість, яка допомагає вину не бути приторним. Вино добре поєднується з десертами та солодкими фруктами. Географія - Франція (Бордо) Сортовий склад - Семильон/Совіньйон Блан Міцність - 13% Цукор - 123 г/л", "tags": ["Витримане", "Десертне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092388.jpg?t=1741189120498", "price": 1391}, {"id": 1092392, "name": "The Grinder Chenin Blanc", "desc": "Елегантний Шенен Блан із витонченим, добре збалансованим смаком, тонами персика, абрикоса, цитрусів, мигдалю та меду на задньому фоні. Географія - ПАР Сортовий склад - Шенен Блан Міцність - 13% Цукор - 4,6 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092392.jpg?t=1741189325210", "price": 503}, {"id": 1092395, "name": "La Vieille Ferme Blanc", "desc": "Це біле вино делікатне, м`яке, ароматне, приємне та питке у смаку з ароматом білих фруктів та квітів. Ідеально підходить як аперитив і для любителів легких вин. Географія - Франція/Долина Рони (Кот Дю Венту) Сортовий склад - Верментино/Уньі Блан/Бурбуленк/Гренаш/Руссан Міцність - 13% Цукор - 0,4 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092395.jpg?t=1741189613060", "price": 563}, {"id": 1092413, "name": "Portillo Sauvignon Blanc", "desc": "Зеленувато-жовтий колір із золотими відтінками. Вино з податливими ароматами, що нагадують цитрусові, такі як рожевий грейпфрут, найбільш помітним ароматом зрілого білого персика, змішаного з рутою. Хрумкий, стійкий смак, з кислотністю, що відзначається. Географія - Аргентина (Мендоза) Сортовий склад - Совіньйон Блан Міцність - 12% Цукор - 1,8 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092413.jpg?t=1741190418608", "price": 587}, {"id": 1092504, "name": "Вино Фрумушика-Нова Нефільтроване на м'яззі", "desc": "Фрумушика-Нова являє собою ідеальне місце для шанувальників сільського зеленого туризму та українського вина. Сімейне господарство Фрумушика-Нова розташоване в однойменній сільській місцевості, за 200 кілометрів від Одеси. Площа виноградників становить майже 10 гектарів і включає різні сорти, як-от Каберне Совіньйон, Цитронний Магарача, Піно Нуар, Совіньйон Блан, Мерло, Одеський Чорний, Ркацителі та інші. Річний обсяг виробництва невеликий, сягає 35 тисяч пляшок. При виробництві вина Фрумушика-Нова дотримуються принципів органічного підходу. Перед нами помаранчеве вино. В ароматі вершки, масло, сіно, зелений чай. На смак середньо-висока кислотність, ледве відчутний танін. Географія - Україна Сортовий скад - Шардоне Міцність - 11,5%", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092504.jpg?t=1741198136757", "price": 683}, {"id": 1092513, "name": "Baron d'Arignac Chardonnay", "desc": "Приємне, питке вино з виразним ароматом цвітіння акації, ананасу, тропічно та цитрусових фруктів. У смаку округле, гладке, добре збалансоване з м`якими нюансами лимона. Географія - Франція Сортовий склад - Шардоне Міцність - 11,5% Цукор - 4 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092513.jpg?t=1741198665380", "price": 383}, {"id": 1092524, "name": "Baron d'Arignac Muscat", "desc": "Запашне, питке вино з виразним ароматом цвітіння акації, ананаса, тропічних фруктів. У смаку м`яке, гладке, добре збалансоване з м`якими нюансами білого цвітіння. Географія - Франція Сортовий склад - Мускат Міцність - 11% Цукор - 30,7 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092524.jpg?t=1741199086063", "price": 358}, {"id": 1172140, "name": "Laporte Pouilly-Fume Les Duchesses", "desc": "Аромат з вираженими мінеральними нюансами, збалансованою солодкістю і свіжістю. Смак чистий, легкий, округлий, свіжий, з цитрусовими нотами. Витримка 5 місяців на осаді Географія - Франція (Долина Луари) Сортовий склад - Совіньйон блан Цукор - 0,42 г/л Міцність - 13,5 %", "tags": ["Сухе"], "image": null, "price": 1809}, {"id": 1172143, "name": "Domaine Laporte Sancerre Rosé", "desc": "Колір: блідо-рожевий Аромат: гармонійний, свіжий, який складається з відтінків персика, малини, цитрусових та весняних квітів Смак: м’який, збалансований з цитрусово-ягідними акцентами та пікантною кислинкою в стриманому післясмаку Ручний збір винограду; 24 години передферментаційна мацерація; 6 місяців витримка на тонкому дріжджовому осаді; Географія - Франція (Долина Луари) Сортовий склад - Піно Нуар 100% Міцність - 12,5%", "tags": ["Сухе"], "image": null, "price": 1606}, {"_heading": "Рожеві вина"}, {"id": 568763, "name": "Mateus Rose", "desc": "Привабливого, яскравого рожевого кольору зі свіжим, витонченим та насиченим букетом, повним ягідних тонів. У смаку відчувається хороший баланс і енергія, чудово доповнена м`яким і злегка ігристим післясмаком. Його унікальні освіжаючі якості роблять його ідеальним. Географія - Португалія Сортовий склад - Бага/Тинта Баррока/Руфете/Турига Франка Міцність - 11% Цукор - 15 г/л", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568763.jpg?t=1712659153749", "price": 383}, {"id": 568784, "name": "Mateus Rose Medium Sweet", "desc": "Легке, свіже, молоде і злегка ігристе вино, розливається в особливі пляшки, багато в чому повторюючи франконські боксбойтелі, які використовували солдати під час Першої Світової Війни. Має свіжий, солодкий і насичений аромат, наповнений ягідними тонами. У смаку відчувається гарний баланс і енергія, чудово доповнена м`яким і солодким смаком, Чудовий дижестив. Географія - Португалія Сортовий склад - Бленд/Бага/Темпранильо/Шираз Міцність - 10,5% Цукор - 30 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568784.jpg?t=1712660204358", "price": 383}, {"id": 568789, "name": "Rose d'Anjue", "desc": "Приємне, свіже рожеве вино з легким фруктовим ароматом, солодкуватим, свіжим смаком. Географія - Франція (Долина Луари) Сортовий склад - Гролло/Піно д'Онис/Гаме Міцність - 10% Цукор - 17,7 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-568789.jpg?t=1712660744755", "price": 419}, {"id": 919008, "name": "Sauvignon Rose Marlborough Sun", "desc": "Яскраве вино характеризується насиченим ароматом червоного стиглого аґрусу, рожевого грейпфрута, маракуї та червоної смородини. Смак соковитий, освіжаючий з легким таніном та м`якою текстурою. Географія - Нова Зеландія (Мальборо) Сортовий склад - Совіньйон Блан 85%/Піно Нуар 15% Міцність - 12,5% Цукор - 2,86 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919008.jpg?t=1732035097110", "price": 683}, {"id": 919012, "name": "The Grinder Rose", "desc": "Хрумке, соковите розе зроблена з сорту Сенсо у французькому стилі. В ароматі фіалки та полуниці, стиглий рожевий грейпфрут, у смаку збалансована кислотність та вагома структурність. Географія - ПАР Сортовий склад - Сенсо Міцність - 13% Цукор - 4,6 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-919012.jpg?t=1732035554911", "price": 479}, {"id": 1092370, "name": "Cappo Rose", "desc": "Зроблене в легкому й освіжаючому стилі. Це вино має інтенсивний аромат червоних фруктів, таких як полуниця, у поєднанні з квітами. У смаку багато свіжості з ненав'язливим характером. Географія - Іспанія (Ла-Манча) Сортовий склад - Темпранільйо Міцність - 12% Цукор - 8 г/л", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092370.jpg?t=1741187892901", "price": 299}, {"_heading": "Червоні вина"}, {"id": 1107549, "name": "Kurni 2021", "desc": "Kurni 2021 — культове італійське вино від Oasi degli Angeli, створене зі 100% Montepulciano, що втілює енергію виноградників Марке. Його глибокий рубіновий колір натякає на розкіш і силу. У букеті — стиглі чорні ягоди, спеції, гіркий шоколад і ваніль, які зливаються в гармонійну композицію. Смак оксамитовий і насичений, із вишуканими танінами та довгим, теплим післясмаком. Kurni 2021 має високий потенціал витримки, розкриваючи з роками ще більше благородства. Це не просто вино — це емоція у кожній краплі, створена для справжніх поціновувачів. Чому воно таке особливе: Марко Казоланетті втілений уважним вивченням особливостей терруару Марке і розробив власний, неповторний метод вирощування сорту \"монтепульчано\", який гарантує високу якість винограду та видатне вино. На його 10 гектарах, переважно на вапнякових ґрунтах з глинистими включеннями, він застосував високу щільність посадки, використовуючи традиційну систему формування лози, і значно знизив врожайність. Це означає, що щорічно з 10 гектарів він отримує лише 6 тисяч пляшок вина - результат докладної роботи та ретельного догляду за кожним кущем, щоб вирощувати виноград найвищої якості. Географія - Італія (Марке) Сортовий склад - Монтепульчано Міцність - 14,5% Цукор - 3 г/л", "tags": ["Декантування", "Витримане"], "image": null, "price": 7399}, {"id": 1107582, "name": "Casalforte Amarone della Valpolicella DOCG", "desc": "Це елегантне повнотіле вино, яке підійде для творчих моментів. Смак: соковитий, добре структурований, зі свіжим фруктовим посмаком Аромат: вишневий джем, стигла вишня, пряні ноти ванілі та лакриці Географія - Італія Сортовий склад - Корвіна 70%/Корвіноне 25%/Рондінелла 5% Міцність - 15,5 Цукор -", "tags": ["Декантування", "Витримане"], "image": null, "price": 1979}, {"id": 1107597, "name": "Langhe Nebbiolo", "desc": "Langhe Nebbiolo, як і велике Бароло, виробляється з одного сорту винограду, але має легший характер і готове до вживання швидше, що дає змогу насолоджуватися вином \"тут і зараз\". Це вино народжується на виноградниках Монфорте д'Альба в П'ємонті, в зоні Буссія. Вино являє собою загальний портрет винограду з відтінками лісових ягід, троянди і лакриці. Неформальність, притаманна цьому Langhe Nebbiolo. Середній обсяг виробництва невеликий, близько 9000 пляшок на рік. Географія - Італія (П'ємонт) Сортовий склад - Неббіоло Міцність - 14,5% Цукор - 0,77 г/л", "tags": ["Декантування", "Витримане"], "image": null, "price": 1452}, {"id": 1107607, "name": "Giacomo Fenocchio Бароло", "desc": "Бароло - вино королів і король вин, воно належить до обмеженого кола найстаріших і найблагородніших італійських вин. Виноробня Giacomo Fenocchio, заснована у 1864 році, є одним з яскравих представників цього типу вин і завжди виготовляла Бароло в традиційному стилі, з ферментацією на диких дріжджах, довгою мацерацією і витримкою у великих дубових бочках. Вино демонструє міцні аромати сухофруктів і чорної смородини з нотами подрібнених квітів і смажених трав. Географія - Італія (П'ємонт) Сортовий склад - Неббіоло Міцність - 14,5% Цукор - 0,72 г/л", "tags": ["Декантування", "Витримане"], "image": null, "price": 2783}, {"id": 1107627, "name": "Vincent Girardin Bourgogne Pinot Noir Cuvee Saint-Vincent", "desc": "Піно Нуар світло-рубінового кольору з м'яким ароматом стиглих червоних фруктів. Елегантна танінна структура, свіжий, фруктовий смак із нотками трав, малини та чорної смородини. Витримка10 місяців у 500-літрових бочках із французького дуба (10% — нові) bio - біодинаміка та органіка Географія - Франція (Бургундія) Сортовий склад - Піно нуар 100% Міцність -13%", "tags": ["Витримане"], "image": null, "price": 2063}, {"id": 1107635, "name": "Brancaia Chianti Classico", "desc": "Останнім часом «Brancaia» здобула безліч міжнародних нагород і сьогодні є одним із провідних виробників вин у Тоскані. А допомагає господарству знаменитий енолог Карло Ферріні. Chianti Classico – це 100% Cанджовезе. Аромат наповнений тонами свіжих фруктів, солодкої вишні та дуба. У смаку відчувається гарний баланс, питкість і приємна свіжість. Географія - Італія (Тоскана) Сортовий склад - Санджовезе Міцність - 14% Цукор - 2,7 г/л", "tags": [], "image": null, "price": 1163}, {"id": 1107904, "name": "de Fournier Pinot Noir", "desc": "Колір молодого граната. В ароматі відкривається вишнею, малиною і чорною смородиною, відчуваються легкі відтінки солодки й тютюну. Средньотільне вино з легким, елегантним смаком, в якому домінують ягідні тони, ноти спецій і трав. Витримка - 4-6 місяців у нейтральних резервуарах Географія - Франція (Долина Луари) Сортовий склад - Піно нуар 100% Міцність - 11,5%", "tags": [], "image": null, "price": 911}, {"id": 1108491, "name": "Medoc Chateau Les Grand Chenes", "desc": "Chateau Les Grands Chenes - провідне Шато престижної категорії Cru Bourgeois, розташоване в Медоку. Виноградні лози висаджено навколо колишньої фортеці XVI століття. 2005 року під час сліпого конкурсу вин Бордо і Каліфорнії, організованого Європейським Великим Журі (Grand Jury Européen), кюве Les Grands Chenes фінішувало першим перед багатьма відомими іменами. В ароматі відтінки кедрового дерева, чорної смородини, підліска і лісової підстилки. Вино середньої щільності, відносно м'яке і свіже, з великою концентрацією фруктів у довгому післясмаку. Географія - Франція (Бордо) Сортовий склад - Каберне Фран/Каберне Совиньйон/Мерло Міцність - 13% Цукор - 0,2 г/л", "tags": ["Декантування", "Витримане"], "image": null, "price": 1895}, {"id": 1152302, "name": "Barista Pinotage", "desc": "Це вино зі знакового південноафриканського сорту Пінотаж має чіткий кавовий профіль, має виразний, насичений, багатий кавовий і шоколадний аромат з тонами стиглої шовковиці, слив і вишень. У смаку виявляються м`які тони банана, ванілі із соковитими, стиглими танінами. Післясмак м`який і гармонійний. Це вино було названо на честь кавових гуру – бариста, оскільки має унікальний кавово-шоколадний смак. Географія - ПАР (Робертсон) Сортовий склад - Пінотаж Міцність - 13% Цукор - 6,5 г/л", "tags": ["Сухе"], "image": null, "price": 750}, {"id": 1152435, "name": "Gourmet Pere & Fils Entrecote", "desc": "Entrecôte — напівсухе вино з купажу Каберне Совіньйон, Сіри та Мерло, що поєднує темні ягоди, чорний перець і фруктові відтінки. Гармонійний баланс між м’якістю та свіжістю підкреслюється м’якими танінами й солодкуватим післясмаком, що робить вино легким для сприйняття та підходящим для щоденного вживання. Особливо сподобається тим, хто віддає перевагу винам із помірною кислотністю. Географія - Франція (Лангедок-Русійон) Сортовий склад - Каберне Совіньйон/Сіра/Мерло Міцність - 14% Цукор - 14 г/л", "tags": ["Напівсухе"], "image": null, "price": 527}, {"id": 1152468, "name": "Gourmet Pere & Fils Camembert", "desc": "Має насичений, фруктовий, солодкуватий смак з приємною кислотністю та м'якими танінами, нотками ожини, червоної сливи та яблука. Післясмак тривалий, інтенсивний, з нюансами карамелі та кориці. Аромат: у дуже інтенсивному ароматі вина тонами чорних фруктів та чорної смородини доповнюються нотками ванілі та тостів Географія - Франція Сортовий склад - Сіра/Марселан Міцність - 14,5% Цукор - 10 г/л", "tags": ["Напівсухе"], "image": null, "price": 527}, {"id": 1152649, "name": "Pinot Noir Marlborough Sun", "desc": "Ви напевно чули про Sauvignon Blanc з Нової Зеландії, Marlborough Sun. Так ось - це його \"брат\" - інтелігентний новозеландський Піно Нуар, більш стриманий порівняно з Sauvignon Blanc. В ароматі стигла слива, полуниця, дикі червоні ягоди. У смаку гармонія між тонкою структурою, гладкими танінами. Якщо ти хочеш урізноманітнити свій винний досвід і випити влітку червоного вина, то цей Піно Нуар саме для тебе! Географія - Нова Зеландія Сортовий склад - Піно Нуар Міцність - 12,5% Цукор - 0,4 г/л", "tags": ["Сухе"], "image": null, "price": 743}, {"id": 1152679, "name": "Bodegas Ateca Honoro Vera", "desc": "Це 100% Гарнача із виноградників, висота яких 700-1000 метрів над рівнем моря. Завдяки двом місяцям витримки у французьких дубових бочках вино збагатилося відтінками дуба. На перший план виходить фруктова палітра, з акцентом на трави та чорні фрукти. У смаку відчувається насиченість та стиглі таніні. Географія - Іспанія (Калатаюд) Сортовий склад - Гарнача Міцність - 14% Цукор - 3,1 г/л", "tags": ["Сухе"], "image": null, "price": 479}, {"id": 1152701, "name": "Bonacchi Chianti Riserva", "desc": "Тоскана в уяві більшості поціновувачів вина є столицею виноробної Італії. Одне з найвідоміших імен у цій галузі - Кьянті. Перед нами чудово збалансоване вино, в ароматі якого відчувається тона червоних фруктів, вишні та фіалки. Тонкі, м'які таніни чудово гармонують із легким ванільним відтінком і додають ще більше інтересу. Смак не здасться вам важким, а післясмак залишить приємну свіжість. Надзвичайно гастрономічне вино. Географія - Італія (Тоскана) Сортовий склад - Санджовезе Міцність - 13% Цукор - 0,5 г/л", "tags": ["Сухе"], "image": null, "price": 467}, {"id": 1152720, "name": "Sogrape Vinhos Silk & Spice Red", "desc": "Назва і етикетка вина є відсилкою до епохи Великих географічних відкриттів – найважливішого відтинку історії Португалії. Звичайно ж у пляшці ви знайдете відображення унікального португальського терруару, а також деякі спеції, які колись возили Шовковим шляхом. Вино характеризується насиченим ароматом стиглих червоних та синіх ягід, таких як слива, ожини, вишня. Пряний характер відтінений ваніллю, чорним та рожевим перцем, мокка. У смаку повнотіле, збалансоване, з м`якими танінами та тривалим післясмаком. Географія - Португалія Сортовий склад - Алікант Буше/Бага/Турига Міцність - 13,5% Цукор - 1,5 г/л", "tags": ["Напівсухе"], "image": null, "price": 515}, {"id": 1152759, "name": "Cesari Bardolino", "desc": "Свіже, легке молоде вино гранатового кольору з пурпуровими відблисками. Має фруктовий аромат з нотами фіалок, червоної та чорної смородини. Смак фруктовий, гармонійний, соковитий, м`який. Географія - Італія (Венето) Сортовий склад - Неграра/Корвіна/Молінара/Рондінелла/Росіньйола Міцність - 11,5% Цукор - 5 г/л", "tags": ["Сухе"], "image": null, "price": 431}, {"id": 1152786, "name": "Pete`s Pure Pinot Noir", "desc": "Витончений Піно Нуар. Аромат розкривається тонами стиглої вишні, свіжої полуниці, з легким відтінком ванілі. У смаку вино середньої густини, з м`якими танінами. Тут фруктова складова виходить на перший план, і лише потім слідує ледь помітна солодкувата нота. Післясмак вражає своєю свіжістю та довжиною. Географія - Австралія Сортовий склад - Рубіред/Піно Нуар Міцність - 12,5% Цукор - 6,7 г/л", "tags": ["Сухе"], "image": null, "price": 611}, {"id": 1152809, "name": "Canti Merlot Terre Siciliane", "desc": "Аромат розкривається тонами вишні, сливи та малини. Смак дуже свіжий, ненав`язливий. Вино ідеально підійде до легких закусок, а також буде добрим супроводом страв під час усієї трапези. Географія - Італія (Сицилія) Сортовий склад - Мерло Міцність - 13% Цукор - 5 г/л", "tags": ["Сухе"], "image": null, "price": 431}, {"id": 1152822, "name": "Marques de Riscal Vina Collada", "desc": "Маркіз де Ріскаль - одне з найстаріших та найвідоміших виноробних господарств Ріохи. Тут виробляють низку традиційних вин Ріохи. Аромат розкривається відтінками вишні та полуниці. У смаку гарний баланс та фруктовий характер. Гармонійний присмак залишає спокусливу свіжість. Географія - Іспанія (Ріоха) Сортовий склад - Темпранільо Міцність - 14% Цукор - 1 г/л", "tags": ["Сухе"], "image": null, "price": 479}, {"id": 1152844, "name": "Montepulciano D’Abruzzo", "desc": "Представники біодинамічної філософії, які проживають у серці Абруццо. Ми усвідомлюємо, що це не завжди просто, але наші зусилля і наші сім'ї завжди прагнуть жити відповідно до біодинаміки\" - Камілло Зуллі. Компанію Cantina Orsogna було засновано у 1964 році як кооператив 500 фермерів, яких об'єднувала одна мета - збереження природи та шанування органічного й біодинамічного виноробства. Перед нами 100% Монтепульчіано. Глибокий пурпурний колір. Аромат - вишня з ожиною, материнка і чебрець. Смак - прямі чорні фрукти з лавровим листом і апельсиновою цедрою. Вино має збалансовану кислотність, середнє тіло, помірний вміст алкоголю і середню інтенсивність, приносячи задоволення поціновувачам біодинаміки. Географія - Італія (Абруццо) Сортовий склад - Монтепульчіано Міцність - 14% Цукор - 7 г/л", "tags": ["Сухе"], "image": null, "price": 731}, {"id": 1152850, "name": "Firriato  Roccaperciata Nero d'Avola", "desc": "Вино насиченого рубінового кольору із збалансованою кислотністю. В ароматі нотки червоних фруктів та спецій, смак гармонійний та м`який. Географія - Італія (Сицилія) Сортовий склад - Неро д'Авола Міцність - 13,5% Цукор - 0,37 г/л", "tags": ["Сухе"], "image": null, "price": 419}, {"id": 1152863, "name": "Bodegas Olarra  La Catedral", "desc": "Як вино категорії \"Cosecha\", воно створене, щоб підкреслити свіжі фруктові аромати з мінімальною витримкою в дубі. В ароматі присутні відтінки болгарського перцю, стиглої вишні, квітково-трав'яні відтінки. Смак легкий і фруктовий, дуже питкий. Це вино ідеально підходить для тих, хто шукає просте, але збалансоване вино. Географія - Іспанія (Ріоха) Сортовий склад - Темпранільо/Грасіано/Гренаш/Мазуело Міцність - 13,5% Цукор - 4 г/л", "tags": ["Сухе"], "image": null, "price": 407}, {"id": 1152904, "name": "Chateau Bellevue Rouge", "desc": "Глибокий пурпуровий колір із гарним блиском. Аромат трохи стриманий, квітковий із безліччю стиглих червоних ягід, дотиком кориці та чорнильного пирога. У смаку щільне, округле та делікатне з добре структурованими танінами, які відмінно балансують із фруктовістю вина. Географія - Франція (Бордо) Сортовий склад - Каберне Фран/Каберне Совіньйон/Мальбек/Мерло Міцність - 12,5% Цукор - 0,54 г/л", "tags": ["Сухе"], "image": null, "price": 647}, {"id": 1155551, "name": "Manon Tempranillo", "desc": "Для багатьох Mano Tempranillo може стати одним із найнесподіваніших вин із Темпранільо, річ у тім, що це вино з дуже легким тілом і мінімальною кислотністю. Дуже глибокий колір і фруктовий аромат. Географія - Іспанія (Кастилія ла-Манча) Сортовий склад - Темпранильо Міцність - 13,5% Цукор - 0,73 г/л", "tags": ["Сухе"], "image": null, "price": 431}, {"id": 1155563, "name": "Колоніст Мерло", "desc": "Витримка в оригінальних французьких бариках із столітнього дуба дозволяє «Колоністу» наситити Мерло тонами вишні, смажених кавових зерен та надати легкого ванільного відтінку. Смак збалансований і м`який, з округлими танінами та тривалим ванільним післясмаком. Географія - Україна (Одеська область) Сортовий склад - Мерло Міцність - 13%", "tags": ["Сухе"], "image": null, "price": 371}, {"id": 1155568, "name": "Колоніст Каберне", "desc": "Соковите, виразне з характерним сортовим ароматом чорної смородини, ожини та шовковиці, має збалансований, м`який смак, що плавно перетікає у наполегливий фруктовий післясмак. Географія - Україна (Одеська область) Сортовий склад - Каберне Совіньйон Міцність - 13%", "tags": ["Сухе"], "image": null, "price": 419}, {"id": 1155574, "name": "Stakhovsky Wines Асе", "desc": "Український тенісист Сергій Стаховський творить вина під брендом ACE by Stakhovsky. В основі концепції – виробництво якісного вина, для цього було обрано перспективного терруару Закарпатської області в районі Берегове. Вина виробляються за контрактним виноробством на потужностях Котнар. Географія - Україна Сортовий склад - Каберне Совіньйон Міцність - 13,5% Цукор - 0,4 г/л", "tags": ["Сухе"], "image": null, "price": 683}, {"id": 1155645, "name": "Robert Mondavi Zinfandel", "desc": "Це червоне сухе вино з Каліфорнії від відомого виробника Robert Mondavi створене для тих, хто шукає м'яке червоне вино з насиченим характером. Воно має яскраві аромати сливи, сушеної вишні та малини, які плавно переходять у відтінки ожинового джему, мокко та карамелі в смаку. Географія - США (Каліфорнія) Сортовий склад - Пті Сіра/Зінфандель/Дюріф Міцність - 13,4% Цукор - 4,7 г/л", "tags": ["Сухе"], "image": null, "price": 899}, {"id": 1155686, "name": "Zeni Bardolino Classico", "desc": "Популярне італійське вино Бардоліно з однойменної області, яка є домом виноробні Дзені. Вино питке і соковите, середньої повноти з легкими квітковими нотами в ароматі та округлим, збалансованим смаком з оксамитовими танінами. Географія - Італія (Венето) Сортовий склад - Корвіна/Молінара/Рондінелла Міцність - 12,5% Цукор - 6 г/л", "tags": ["Сухе"], "image": null, "price": 443}, {"id": 1155710, "name": "Wrongo Dongo", "desc": "Проходить мацерацію і ферментацію у величезних ємностях з нержавіючої сталі, при температурі не вище 27°C. Колір: насичений пурпуровий Смак: переважає вишня з нотками сливи та малини, післясмак має приємний фруктовий присмак Аромат: відтінки чорного шоколаду, стиглих фруктів та прянощів. Географія - Іспанія (Мурсія) Сортовий склад - Монастрель Міцність - 14% Цукор - 2,95 г/л", "tags": ["Сухе"], "image": null, "price": 455}, {"id": 1155791, "name": "Matarromera WIN Tempranillo Alcohol-free", "desc": "Виготовляється з винограду сорту Темпранільйо без витримки, ферментується в резервуарах з нержавіючої сталі. Етиловий спирт витягується за допомогою складного методу із збереженням кращих смакових якостей. Смак: середній танін з цікавою структурою та солодкими дубильними речовинами Аромат: землі із відчутною присутністю червоних ягід Географія - Іспанія Сортовий склад - Темпранільо", "tags": ["Сухе", "Безалкогольне"], "image": null, "price": 827}, {"id": 1155829, "name": "PINOT NOIR ordinary VINOMAN", "desc": "Вино сортове ординарне натуральне сухе червоне. Виготовлене із сорту винограду Піно Нуар. Чудовий Піно Нуар з нотами малини та вишні в ароматі, що своєю легкістю та фруктовістю прекрасно доповнює твої улюблені страви. Не витримувалось в авторській українській бочці із скельного дубу, зробили його делікатним та приємним. Найвишуканіший та водночас найскладніший сорт вина з винограду Піно Нуар є визитівкою виноробні VINOMAN", "tags": ["Сухе", "Україна"], "image": null, "price": 1019}, {"id": 1155865, "name": "Cesari Valpolicella DOC", "desc": "Молоде питке вино насиченого червоного кольору з фіолетовими відблисками. Смак з тонами вишні, збалансованою кислотністю та приємним післясмаком. Географія - Італія (Венето) Сортовий склад - Корвіна/Молінара/Рондінелла Міцність - 12% Цукор - 4,5 г/л", "tags": ["Сухе"], "image": null, "price": 539}, {"id": 1155913, "name": "Natureo Garnacha Syrah", "desc": "Дуже висока якість червоного вина з вмістом алкоголю 0.0 та винятковим ароматом, Natureo Syrah є першим де-алкоголізованим червоним вином в Іспанії. Аромат відкривається фруктовими тонами. Смак трохи солодкуватий, а післясмак затяжний. Географія - Іспанія Сортовий склад - Сіра/Гарнача Цукор - 33,5 г/л", "tags": ["Напівсолодке"], "image": null, "price": 551}, {"id": 1155915, "name": "The Grinder Pinotage", "desc": "Яскравий, соковитий Пінотаж має виразний аромат моко і кави, у смаку насичений, питний, ягідний з тонами зацукрованих вишень присмачених спеціями. Відмінно поєднується зі смаженим філе, різними м`ясними барбекю та пряними стравами індійської кухні. Географія - ПАР Сортовий склад - Пінотаж Міцність - 14% Цукор - 3,8 г/л", "tags": ["Сухе"], "image": null, "price": 527}, {"id": 1155933, "name": "The Grinder  Blue Moose", "desc": "Сподобається любителям неординарних уподобань. Виготовляється з винограду, вирощеного у Свартланді, що має яскравий аромат. Колір, смак, аромат: рубінового кольору, в ароматі гармонійно поєднуються фруктово-ягідні та пряні нотки, у смаку вина тона ягід та тушкованих фруктів доповнюються нотами спецій, нюансами сигарної коробки, шкіри та горіхів. Післясмак щедрий, тривалий. Географія - ПАР Сортовий склад - Каберне Совіньйон/Шираз Міцність - 14% Цукор - 4,6 г/л", "tags": ["Сухе"], "image": null, "price": 539}, {"_heading": "Ігристі вина"}, {"id": 1089912, "name": "Codorníu Zero", "desc": "Приємне безалкогольне ігристе вино, виготовлене з білого винограду і отримане в процесі деалкоголізації вина. Його свіжі аромати цитрусових і тропічних фруктів чудово поєднуються з будь-якою подією, що вимагає альтернативного задоволення. Дрібні бульбашки, фруктово-лимонадний характер і гармонійний баланс солодкості та свіжості. Географія - Іспанія Сортовий склад - Айрен Цукор - 44 г/л", "tags": ["Безалкогольне"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1089912.jpg?t=1741084974538", "price": 683}, {"id": 1091488, "name": "Sauvignon Blanc Bubbles Marlborough Sun", "desc": "Незвичайне і яскраве ігристе із сорту Совіньйон Блан - яскравий аромат розкривається відтінками нектарину, маракуї та цитрусових. Вино має свіжий, легкий, приємний смак, з відтінками лайма і грейпфрута. Післясмак довгий, освіжаючий. Географія - Нова Зеландія (Мальборо) Сортовий склад - Совіньйон Блан Міцність - 12,5% Цукор - 12,83 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091488.jpg?t=1741173815873", "price": 983}, {"id": 1080060, "name": "Pinot Grigio Brut Blanc", "desc": "Яскраве та гармонійне ігристе. Має прекрасний баланс і ненав`язливий аромат. Тут ви знайдете відтінки лайма, зеленого яблука та легку квіткову ноту. У смаку дуже свіже. Географія - Італія Сортовий склад - Пино Гриджо Міцність - 11% Цукор - 10 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1080060.jpg?t=1740587964077", "price": 443}, {"id": 1080150, "name": "El Capitan Brut White", "desc": "46 Parallel - молодий український бренд, який завоював серця не лише споживачів з України, але і далеко за її межами. Смак приємний, гармонійний, наповнений яскравою фруктовістю і живою кислотністю. Баланс ігристого захоплює, а тонкий перляж красиво грає в келиху. Колір: світло-солом'яний. Аромат: вишуканий і витончений, наповнений тонами весняних квітів, зелених і жовтих яблук, стиглого нектарина і персика. Географія - Україна Сортовий склад - Піно Блан і Шардоне Міцність - 11,9% Цукор - 0,9 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1080150.jpg?t=1740595412692", "price": 503}, {"id": 1091529, "name": "Lambrusco dell 'Emilia Bianco Dry", "desc": "Chiarli - найстаріший і найшанованіший виробник ламбруско в Емілії-Романьї, без перебільшення одного з найпопулярніших італійських вин. Основою характеристикою ігристих вин ламбруско є високий рівень кислотності. Це легке і свіже ламбруско має делікатний квітково-фруктовий аромат, приємний і сухий смак, стане відмінним вибором для аперитиву. Географія - Італія (Емілія - Романья) Сортовий склад - Ламбруско Дель Емілья Міцність - 10% Цукор - 12 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091529.jpg?t=1741174561514", "price": 335}, {"id": 1091553, "name": "Lambrusco dell 'Emilia Bianco", "desc": "Chiarli - найстаріший і найшанованіший виробник ламбруско в Емілії-Романьї, без перебільшення одного з найпопулярніших італійських вин. Це легке і напівсолодке ламбруско має делікатний квітково - фруктовий аромат, приємний, напівсолодкий смак. Географія - Італія (Емілія - Романья) Сортовий склад - Ламбруско Дель Емілья Міцність - 7,5% Цукор - 50 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091553.jpg?t=1741175114580", "price": 335}, {"id": 1091568, "name": "Lambrusco dell 'Emilia Rosato Dry", "desc": "Chiarli - найстаріший і найшанованіший виробник ламбруско в Емілії-Романьї, без перебільшення одного з найпопулярніших італійських вин. Основою характеристикою ігристих вин ламбруско є високий рівень кислотності. Це легке рожеве вино має приємну свіжість, легку ігристість і чарівні аромати суниці. Географія - Італія (Емілія - Романья) Сортовий склад - Ламбруско Дель Емілья; Міцність - 10% Цукор - 12 г/л", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091568.jpg?t=1741175556974", "price": 335}, {"id": 1091582, "name": "Lambrusco dell 'Emilia Rosato", "desc": "Chiarli - найстаріший і найшанованіший виробник ламбруско в Емілії-Романьї, без перебільшення одного з найпопулярніших італійських вин. Ламбруско, що відмінно відображає дух регіону. Це легке рожеве вино приємно солодке, має легку ігристість і приємний аромат суниці. Географія - Італія (Емілія - Романья) Сортовий склад - Ламбруско Дель Eмілья Міцність - 7,5% Цукор - 50 г/л", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091582.jpg?t=1741176042750", "price": 335}, {"id": 1091724, "name": "Leleka Wines Brut", "desc": "Смак: Багатий, збалансований, фруктовий смак з нотами маслянистості та делікатної кислотності. Аромат: Букет тішить тонами польових квітів, жовтих яблук, груш та інтонаціями свіжого хліба й лимону. Колір: Світло-золотистий з тонким, стійким перляжем. Географія - Україна (Одеська обл. Південна Бессарабія) Сортовий склад - Аліготе/Сухолиманський білий Міцність - 12%", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091724.jpg?t=1741178374028", "price": 383}, {"id": 1091730, "name": "Leleka Wines Semi-dry", "desc": "Смак: Гармонійний, делікатний смак з виразними нотами білих фруктів, акацієвого меду та мінеральними штрихами у фініші. Аромат: В ароматі відчутні екзотичні фрукти, мотиви ванільного штруделя та ананасу. Колір: Світло-солом'яний з тривалою грою бульбашок. Географія - Україна (Одеська обл. Південна Бессарабія) Сортовий склад - Аліготе/Сухолиманський білий Міцність - 11,5%", "tags": ["Напівсухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091730.jpg?t=1741178557667", "price": 383}, {"id": 1091736, "name": "Leleka Wines Semi-sweet", "desc": "Смак: Чуттєвий, м'який смак розкривається солодкими фруктовими нотами, які плавно перетікають у живий післясмак з тонкою кислинкою. Аромат: Відчутні тони стиглих кісточкових фруктів, запашних білих квітів й солодкої ванілі. Колір: Світло-золотистийГеографія - Україна (Одеська обл. Південна Бессарабія) Сортовий склад - Аліготе/Сухолиманський білий Міцність - 12,5%", "tags": ["Напівсолодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091736.jpg?t=1741178679067", "price": 383}, {"id": 1090192, "name": "Champagne Taittinger Brut Reserve", "desc": "Taittinger - один з найбільших та відомих Шампанських Будинків. Taittinger виробляє вина в витонченому стилі, спираючись на фруктову та квіткову палітру. Taittinger NV Brut Reserve - суміш більш ніж 35 різних виноградників. Шампанське має чистий, свіжий та бадьорий аромат свіжого яблука, лайма, цедри апельсина та яблучної кісточки. У смаку приємна кисло-солодка нота. Шампанське має легкість, елегантність і прекрасний баланс. Виноград пресують у спеціальних приміщеннях одразу на виноградниках, сусло ферментують за умов температурного контролю. Після відпочинку протягом зими, вино з`єднують і остаточне кюве піддається вторинної ферментації у пляшці у холодних підвалах Taittinger. Вино проводить на осаді майже чотири роки, більше ніж у два рази, ніж визначені законодавчо 15 місяців. Географія - Франція (Шампань) Сортовий склад - 40% Шардоне, 35% Піно Нуара та 25% Піно Меньє Міцність - 12,5% Цукор - 8,6 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090192.jpg?t=1741093369773", "price": 1883}, {"id": 1090133, "name": "Champagne Taittinger Brut Reserve", "desc": "Taittinger - один з найбільших та відомих Шампанських Будинків. Taittinger виробляє вина в витонченому стилі, спираючись на фруктову та квіткову палітру. Taittinger NV Brut Reserve - суміш більш ніж 35 різних виноградників. Шампанське має чистий, свіжий та бадьорий аромат свіжого яблука, лайма, цедри апельсина та яблучної кісточки. У смаку приємна кисло-солодка нота. Шампанське має легкість, елегантність і прекрасний баланс. Виноград пресують у спеціальних приміщеннях одразу на виноградниках, сусло ферментують за умов температурного контролю. Після відпочинку протягом зими, вино з`єднують і остаточне кюве піддається вторинної ферментації у пляшці у холодних підвалах Taittinger. Вино проводить на осаді майже чотири роки, більше ніж у два рази, ніж визначені законодавчо 15 місяців. Географія - Франція (Шампань) Сортовий склад - 40% Шардоне, 35% Піно Нуара та 25% Піно Меньє Міцність - 12,5% Цукор - 8,6 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090133.jpg?t=1741092582607", "price": 3359}, {"id": 1090195, "name": "Champagne Lamiable Terre D`Etoiles Brut Grand Cru", "desc": "Вишукане шампанське, яке втілює традиції регіону. Напій демонструє ідеальний баланс. Смак: Округлий та гармонійний фруктово-цитрусовий смак з освіжаючою кислотністю. Завершується стійким солодким післясмаком. Аромат: Розкішний аромат з відтінками білих кісточкових фруктів, цитрусових, вершкового масла, випічки та квітів. Колір: Солом'яно-золотий з тонким перляжем. Географія - Франція (Шампань) Сортовий склад - Шардоне\Піно Нуар Міцність - 12,5% Цукор - 7,8 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090195.jpg?t=1741093538590", "price": 2243}, {"id": 1090210, "name": "Cremant de Bourgogne Brut Pinot Noir", "desc": "Креман – це серйозне, якісне, витримане ігристе, зроблене за тією ж технологією, що й шампанське, але поза регіоном Шампань. Перед нами виразне рожеве ігристе на основі Піно Нуару, має затятий, свіжий аромат червоних ягід, прянощів, цитрусів і цукатів. Свіжий смак, сповнений енергії з тонами грейпфрута і полуниці. Географія - Франція (Бургундія) Сортовий склад - Гаме/Піоно Нуар Міцність - 11% Цукор - 8 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090210.jpg?t=1741093939179", "price": 1043}, {"id": 1090215, "name": "Franciacorta Guido Berlucchi Cuvee Imperiale Brut", "desc": "Прекрасне вино солом`яно-жовтого кольору із блідо-зеленим відтінком. Має інтенсивний аромат фруктів, банану, ананасу, яблука, груші, грейпфруту, фундука, хлібної скоринки, квітів акації та чистий, насичений, яскраво виражений смак з легкою кислинкою. Компанія Berlucchi вважається одним з найвідоміших італійських виробників ігристих вин, виготовлених за класичним «шампанським» методом. Виноград збирається виключно ручним способом у невеликі коробки. Це дозволяє ягодам зберегтися неушкодженими. Географія - Італія (Ломбардія) Сортовий склад - Шардоне\Піно Нуар Міцність - 12,5% Цукор - 8 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090215.jpg?t=1741094150798", "price": 1763}, {"id": 1090221, "name": "Cava Juve y Camps Reserva de la Familia Gran Reserva Brut Nature", "desc": "Світло-жовтого кольору із стійким перляжем. Дуже свіже та чисте вино, з легким ароматом ванілі, білих фруктів та квітів. Згодом аромат вина розкривається в келиху, і з`являються ноти смажених тостів та легкі тони цитрусових. У смаку освіжаючий і надзвичайно гармонійний. Географія - Іспанія (Пенедес) Сортовий склад - Макабео\Шареллу\Парельяда Міцність - 12% Цукор - 0,8 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090221.jpg?t=1741094297947", "price": 1091}, {"id": 1090226, "name": "Cava Juve y Camps Reserva de la Familia Gran Reserva Brut Nature", "desc": "Світло-жовтого кольору із стійким перляжем. Дуже свіже та чисте вино, з легким ароматом ванілі, білих фруктів та квітів. Згодом аромат вина розкривається в келиху, і з`являються ноти смажених тостів та легкі тони цитрусових. У смаку освіжаючий і надзвичайно гармонійний. Географія - Іспанія (Пенедес) Сортовий склад - Макабео\Шареллу\Парельяда Міцність - 12% Цукор - 0,8 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090226.jpg?t=1741094382206", "price": 2603}, {"id": 1090238, "name": "Cava Jaume Serra Brut Nature", "desc": "Вино блідо-жовтого кольору із зеленим відтінком, кристально чисте з тонкою грою бульбашок. Букет ароматний та інтенсивний, дуже свіжий та фруктовий з нотками витримки. У смаку відчувається хороша структура, м`яке, чисте та збалансоване ігристе. Географія - Іспанія (Каталонія) Сортовий склад - Макабео/Шареллу/Парельяда Міцність - 11,5% Цукор - 1,5 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090238.jpg?t=1741095037639", "price": 467}, {"id": 1090237, "name": "Cava Jaume Serra Brut", "desc": "Свіжий аромат з відтінками хлібної скоринки, випічки та зеленого яблука. У смаку чудовий баланс із легкими тонами випічки. Географія - Іспанія (Каталонія) Сортовий склад - Макабео/Ксерело/Парельяда Міцність - 11,5% Цукор - 7 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090237.jpg?t=1741094933071", "price": 467}, {"id": 1090234, "name": "Cava Jaume Serra Brut Rosado", "desc": "Стійкий потік бульбашок, яскравий, інтенсивний аромат характеризують це дуже свіже та фруктове ігристе вино з ароматами малини та полуниці. У смаку повне, живе, з доброю кислотністю з нотками червоних ягід і вишень. Географія - Іспанія (Каталонія) Сортовий склад - Трепат/Піно Нуар Міцність - 11,5% Цукор - 9,5 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090234.jpg?t=1741094841149", "price": 515}, {"id": 1089668, "name": "Cava Jaume Serra Semi Seco", "desc": "Вино солом`яно-жовтого кольору із зеленуватими відблисками із стійким потоком дрібних бульбашок. Вино має досить насичений ароматний, свіжий фруктовий букет і щільний, добре збалансований смак, шовковистий і м`який. Свіжий і чистий післясмак. Географія - Іспанія (Каталонія) Сортовий склад - Макабео/Парельяда Міцність - 11,5% Цукор - 35 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1089668.jpg?t=1741082728332", "price": 467}, {"id": 1090002, "name": "Біссер, Колоніст, біле брют", "desc": "Територія, де вирощують виноградники для вина Колоніст Біссер, має м'який середземноморський клімат, завдяки цим умовам створюється велике вино України. Класична технологія шампанізації використовується при виготовленні вина. Напій витримують на дріжджах в пляшках протягом 2 років. Смак: Доповнюється приємною нотою свіжоспеченої булочки. Аромат: Благородні пахощі, в яких чітко відчуваються квіти, скоринка хліба і горіхи. Колір: Світлий солом'яний забарвлення із золотистим відтінком. Географія - Україна (Придунайська Бессарабія, Одеська область) Сортовий склад - Шардоне Міцність - 12% Цукор - 11,25 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090002.jpg?t=1741089534110", "price": 923}, {"id": 1090059, "name": "Pet Nat  White Blend Biologist", "desc": "Біле сухе нефільтроване вино. Зроблено за методом ансестраль. Вино має складний і приємний аромат з нотками червоних ягід і трав, надає вину глибини та елегантності. Смак яскравий, свіжий і насичений, який розкривається хрумкими тонами ягід. Метод “ансестраль”, коли вино розливають в кінці бродіння, при цьому пляшки зазвичай закривають «пивними» кришками. Таким чином, бродіння вуглекислого газу у вині продовжується разом з бродінням дріжджів. А саме вино не потребує додавання сірки, адже воно залишається стабільним завдяки вуглекислому газу, що міститься в ньому. Географія - Україна (Київська обл. с Лісники) Сортовий склад - Піно Нуар/Шардоне/Трамінер Міцність - 10%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1090059.jpg?t=1741091186483", "price": 719}, {"id": 1078601, "name": "Miol Prosecco Treviso Extra-Dry біле", "desc": "Bortolomiol – це одне з найпрестижніших Prosecco. Виноградники розташовані в гористій місцевості, тому для збору врожаю використовують виключно ручну працю. Належить до категорії Extra-Dry, що, безперечно, сподобається шанувальникам не кислотних вин. У цьому простому та питому Prosecco чудово поєднуються аромати персика, груші та зеленого яблука. Легке, свіже смак з переважанням фруктових тонів. Географія - Італія (Венето) Сортовий склад - Глера Міцність - 11% Цукор - 13 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078601.jpg?t=1740491225862", "price": 803}, {"id": 1078604, "name": "Miol Prosecco Treviso (frizzante)", "desc": "З пагорбів провінції Тревізо походить простий, свіжий, легкий Prosecco, призначений для повсякденного вживання. Смаковий профіль наповнений фруктовими та квітковими тонами, з великою кількістю свіжості. Географія - Італія (Венето) Сортовий склад - Глера 85% Піно/Шардоне 15% Міцність - 11% Цукор - 10 г/л", "tags": ["Ігристе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078604.jpg?t=1740491874581", "price": 791}, {"id": 807835, "name": "Prosecco Villa Jolanda", "desc": "Характерний, запашний аромат, багатий на квіткові та фруктові відтінки. Приємний, свіжий, стійкий смак. Підходить до дуже багатьох закусок, особливо до рибних та вегетаріанських, супів, легких перших страв, різотто та пасти. Географія - Італія (Венето) Сортовий склад - Глера Міцність - 11,5% Цукор - 15 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-807835.jpg?t=1725204689652", "price": 671}, {"id": 1078738, "name": "Prosecco Soligo Treviso Extra Dry", "desc": "Делікатний та інтенсивний аромат просекко розкривається відтінками зеленого яблука, акації та легким натяком на білі квіти. У смаку відчувається чудовий баланс і м`якість. Це ігристе стане хорошим аперитивом, і залишить приємний цитрусовий слід. Географія - Італія (Венето) Сортовий склад - Глера Міцність - 11% Цукор - 15 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078738.jpg?t=1740500357505", "price": 671}, {"id": 802932, "name": "Casalforte Prosecco", "desc": "Ігристе вино Casalforte Prosecco Spumante DOC Extra Dry має світло-солом'яний колір з тонкою грою бульбашок. В ароматі Prosecco Castelforte спокушає тонами тропічних фруктів, персика та квітів акації. Освіжаюча кислотність, смак стиглого яблука, груші з легкими квітковими, мінеральними відтінками та цитрусовим фінішем. Географія - Італія (Венето) Сортовий склад - Глера Міцність - 11% Цукор - 11 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-802932.jpg?t=1724944089626", "price": 407, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "750 мл", "price": 650}, {"label": "375 мл", "price": 407}]}}, {"id": 807830, "name": "Canti Prosecco", "desc": "Перед вами дуже легке та ненав'язливе Просекко.Класичний стиль цього італійського вина відкривається відтінками цитрусу, персика, жовтого яблука. Зелені яблука та груші у смаку, середня кислотність, гарна гра бульбашок та сухий післясмак. Географія - Італія (Венето) Сортовий склад - Глера Міцність - 10,5% Цукор - 14 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-807830.jpg?t=1725202998024", "price": 263, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "750 мл", "price": 623}, {"label": "200 мл", "price": 263}]}}, {"id": 1078766, "name": "Canti Prosecco Frizzante", "desc": "Приємне, легке ігристе. Тут ви знайдете відтінки білих квітів, зеленого яблука і тонкий натяк на тости. У смаку свіже та питке. Вино на кожен день, чудовий аперитив, а також супровід страв під час усієї трапези. Географія - Італія (Венето) Сортовий склад - Глера Міцність - 10,5% Цукор - 13 г/л", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1078766.jpg?t=1740504572730", "price": 640}, {"_heading": "Коктейлі"}, {"id": 556647, "name": "Tropical Spritz", "desc": "Освіжаючий і фруктовий напій, який поєднує в собі екзотичні смаки на основі джину та ігристого", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-556647.jpg?t=1711983465179", "price": 190}, {"id": 556767, "name": "Strawberry Spritz", "desc": "Strawberry Spritz - це освіжаючий коктейль, який складається з ігристого вина, фруктового сиропу. Цей напій має легкий та фруктовий смак, ідеально підходить для літніх вечорів", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-556767.jpg?t=1711983648962", "price": 190}, {"id": 556973, "name": "Венеціанський Спрiтц", "desc": "Легкий і освіжаючий напій, який походить з Італії. Основа лікер Кампарі, ігристе вино, содова. Венеціанський шпріц ідеально підходить для спекотного літнього дня або як аперитив перед обідом.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-556973.jpg?t=1711984069283", "price": 190}, {"id": 557019, "name": "HUGO", "desc": "Hugo Spritz – це освіжаючий та легкий напій, який користується величезною популярністю в Італії та інших країнах Європи. Напій складається з ігристого, сиропу бузини та м'яти, що робить його дуже свіжим та максимально приємним!", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557019.jpg?t=1711984429472", "price": 219}, {"id": 557217, "name": "Cucumber gin", "desc": "Освіжаючий літній коктейл на основі джину, содової та сиропу огірка", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557217.jpg?t=1711984909893", "price": 180}, {"id": 557224, "name": "Маргарита", "desc": "Класичний освіжаючий коктейль на основі текіли, лимонного фрешу та куантро Символ підтримки відпочинку", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557224.jpg?t=1711985870446", "price": 180}, {"id": 557225, "name": "Сангрiя", "desc": "Іспанський фруктовий коктейль, який включає червоне вино, апельсиновий сік відмінно підходить для вечірок та вечірнього відпочинку з друзями.", "tags": [], "image": null, "price": 180}, {"id": 557238, "name": "Негронi", "desc": "Коктейль на основі джину, вермуту та бітеру Кампарі, прикрашений цедрою апельсинів", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557238.jpg?t=1711986906429", "price": 195}, {"id": 557241, "name": "Бульвардье", "desc": "Яскравий напій на основі бурбона, червоного вермуту та лікеру Негроні, з оригінальним насиченим смаком і характерною гіркуватістю", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557241.jpg?t=1711987057390", "price": 195}, {"id": 557488, "name": "Віскі Сауер", "desc": "Кисло-солодкий, бадьорячий на основі бурбону", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557488.jpg?t=1712061200853", "price": 210}, {"id": 557493, "name": "Гарібальді", "desc": "Для сильних духом. На основі бітеру та апельсинового соку", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-557493.jpg?t=1712061861045", "price": 180}, {"_heading": "Віскі"}, {"id": 637472, "name": "West Cork Bourbon Cask", "desc": "West Cork тричі дистилюють та витримують не менше трьох років у бочках з-під бурбона. В основі бленд зернових (75%) та солодових спиртів (25%). Профіль віскі округлий, збалансований з ароматом цитрусів, яблук, чорного перцю та мускатного горіха. У смаку даються взнаки солодкі тони цукатів, карамелі та ванілі. Географія - Ірландія Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-637472.jpg?t=1715177931097", "price": 95, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 95}, {"label": "Ціна за пляшку", "price": 959}]}}, {"id": 637485, "name": "Loch Lomond Original", "desc": "Найкласніше - ледь помітний димний аромат, просто якраз, щоб додати інтересу! Ця винокурня майстри у своїй справі, вони створюють віскі різних стилів, від односолодових (як той, що у вас перед очима) до однозернових і купажів - навіть не сумнівайтеся, тут усе смачно! Карамель, маслянистий горіх і, звісно, відтінок курної дубової копченості в ароматі. У смаку уявіть печиво і підсмажений солод. Географія - Великобританія (Шотландія) Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-637485.jpg?t=1715178342161", "price": 139, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 139}, {"label": "1 шт", "price": 1499}]}}, {"id": 766629, "name": "Glenfiddich 12 y.o", "desc": "Glenfiddich – односолодовий віскі найбільш продаваний в світі, а унікальна трикутна форма його пляшки добре впізнавана в усьому світі. Цей розлив - наймолодший прояв спиртів Glenfiddich, з делікатним фруктовим, трав'янистим, медовим характером. В ароматі переважають легкі квіткові, цитрусові та пряні тони. Смак округлий, легкий, фруктовий. Фініш відрізняється м'якою солодкістю та маслянистістю. Географія - Великобританія (Шотландія) Міцність - 40%", "tags": ["Витримане"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-766629.jpg?t=1722263948622", "price": 259, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 259}, {"label": "Ціна вказана за пляшку", "price": 3599}]}}, {"id": 1091969, "name": "Poli SEGRETARIO DI STATO", "desc": "Унікальний у своєму роді продукт, чистий солодовий віскі, 5 років витримки, а перед розливом витримується у бочках від Amarone. Його аромат нагадує тарілку підсмажених горіхів, родзинок, слив, шоколаду та копчених спецій. Смак чистий, приємний і торф'яний. Рекомендуємо споживати: У чистому вигляді, з охолоджуючим камінням. Географія - Італія (Венето) Тип - Солодовий віскі Міцність - 43 %", "tags": ["Витримане", "Торф/Дим"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091969.jpg?t=1741181951658", "price": 2999}, {"id": 1097998, "name": "Loch Lomond Single Grain Single Malt Scotch", "desc": "Loch Lomond Single Grain — це елегантний і насичений однозерновий напій із м’якістю, що робить його надзвичайно легким для вживання. Це шотландський віскі, виготовлений виключно з найкращого солодового ячменю з характерним фоном м’яких фруктів і вершкової ванілі з відтінком диму та торфу. Географія - Великобританія (Шотландія) Міцність - 46%", "tags": ["Витримане", "Торф/Дим"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1097998.jpg?t=1741610856190", "price": 1499}, {"id": 1091976, "name": "West Cork IPA Cask", "desc": "Купажований віскі, що складається на 75% із зерна і 25% солоду, спочатку витримувався в бочках з-під бурбона, а потім у бочках, у яких раніше містився IPA Blacks of Kinsale. В результаті вийшов яскравий віскі з відтінками горіхів, смаженого солоду та солодкуватими нюансами. Географія - Ірландія Міцність - 40%", "tags": ["Витримане"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091976.jpg?t=1741182483134", "price": 1439}, {"_heading": "Коньяк / Бренді / Портвейн"}, {"id": 1092016, "name": "Sandeman Porto Ruby", "desc": "Яскравого червоно-рубінового кольору з чистим ароматом червоних фруктів, слив та полуниці, з багатим смаком, наповненим різними відтінками червоних фруктів та слив, з відмінним балансом усіх елементів. Багатий, округлий, збалансований портвейн, зроблений у традиційному стилі заснованому Джоржем Сандеманом в 1790 році, набуває особливої глибини завдяки вмісту різних вин. Географія - Португалія (Доуро) Сортовий склад - Тинта Баррока/Турига/Тинта Рориз/Тинто Као/Турига Франсеза Міцність - 19,5% Цукор - 95 г/л", "tags": ["Солодке"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092016.jpg?t=1741183924266", "price": 695}, {"id": 1092026, "name": "Бренді Imperial", "desc": "Кольори осіннього золота, має насичений, складний аромат з дубовими та ванільними відтінками. У смаку добре збалансований, округлий і повнотілий із багатими хересними тонами та витонченістю гарного Бренді де Херес. В результаті дозрівання в дубових бочках з-під хересу він набуває добре збалансованого, округлого і насиченого характеру. Географія - Іспанія (Херес) Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092026.jpg?t=1741184365727", "price": 707}, {"id": 1097988, "name": "Коньяк A.E.Dor VS", "desc": "AEDOR – відомий коньячний дім із багатою історією створення вишуканих французьких дистилятів. Цей свіжий, фруктовий VS походить із регіонів Бордері та Фін Буа, що надає йому квіткового, фруктового аромату з делікатними медовими відтінками. Смак витончений і гармонійний, із гарною структурою та зрілістю. Географія - Франція (Коньяк) Міцність - 40%", "tags": ["Витримане"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1097988.jpg?t=1741610209449", "price": 1979}, {"id": 1098011, "name": "Граппа Poli Grappa Bassano Classica Museo della", "desc": "Демонструє кришталево чистий колір. У стійкому ароматі переплетені відтінки гортензії, зеленого яблука, персика, яблучного пюре, айви та сушених слив із підсмаженим хлібом, какао та кавою. Смак гармонійний, елегантний і живий з легким та тривалим фруктовим післясмаком. Особливості: \"Grappa Bassano Classica\" - це молода граппа, яка одержує від дистиляції кюве сортів винограду, характерних для регіону Бассано-дель-Граппа області Breganze DOC. Сировина для виробництва цієї граппи є сумішшю місцевих червоних сортів винограду. Дистилюється безперервно у мідних казанах невеликими партіями без подальшої витримки. Географія - Італія Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1098011.jpg?t=1741612536012", "price": 1175}, {"_heading": "Ром"}, {"id": 1092022, "name": "Tanduay Asian Rum Silver", "desc": "Білий ром преміум-класу з Філіппін, створений компанією Tanduay Distillers, яка веде свою історію з 1854 року. Напій є сумішшю спиртів, витриманих до п'яти років у діжках з-під бурбону, що надає йому світло-солом'яного кольору та багатогранного смакового профілю. У смаку відчуваються аромати мандаринової та грейпфрутової шкірки, які гармонійно поєднуються з тонами смаженого кокосу й ванілі. Географія - Філіппіни Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1092022.jpg?t=1741184095550", "price": 743}, {"_heading": "Горілка / Джин"}, {"id": 766632, "name": "Горілка Staritsky&Levitsky", "desc": "Преміальна горілка України, вироблена в Прикарпатті - регіоні, що володіє унікальною природою, кліматом і екологією. Вперше напій був представлений широкій публіці в 2010 році, вдалося відродити не тільки автентичні технології, а й популяризувати українську культуру. «Старицький і Левицький» експортують в США, Голландію, Великобританію, Польщу, Латвію, Бельгію, Азербайджан та інші країни. Унікальність горілки полягає в тому, що вона виготовляється практично ремісничими методами, випускаючись вкрай невеликими тиражами. Основними секретами Staritsky Levitsky Reserve є збагачена кварцом вода Карпатських джерел, вирощене на чорноземі і зібране в серпні добірне зерно і незмінна столітня рецептура. П'ятиразова дистиляція і чотириразова очистка дозволяють досягти абсолютно незвичайної чистоти і легкості, а тридцятиденний «відпочинок» в нержавіючій сталі додає повноти аромату. Смак: Легкий, сухий, делікатний, з м'якими інтонаціями пшениці, зігріваючим післясмаком середньої складності і тривалості. Аромат: Делікатний, м'який, чистий, з легкою зерновий солодкістю і тонкою зігріваючою пряністю. Географія - Україна", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-766632.jpg?t=1722264109139", "price": 120, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "50 мл", "price": 120}, {"label": "Ціна вказана за пляшку 0,5", "price": 755}]}}, {"id": 1091612, "name": "Горілка Esbjaerg", "desc": "Esbjaerg – популярна датська горілка, зараз виробляється в Нідерландах. Горілка має бути м'якою, гладкою і кристально чистою – така концепція бренду, тому Esbjaerg виготовляють із найкращої пшениці та води, і фільтрують через активоване вугілля. Згідно з легендою, рибалки з Гренландії привезли лід, який розтопили і розбавляли ним горілку, так з'явився унікальний смак горілки Esbjaerg. Сьогодні той же результат досягається за рахунок сучасних методів та використання найкращих інгредієнтів. Географія - Нідерланди Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1091612.jpg?t=1741176538744", "price": 419}, {"id": 1098009, "name": "Джин Larios 12", "desc": "Larios 12 — іспанський джин преміумкласу, створений за фантастичною рецептурою XIX століття, що передає всю неординарність місцевих напоїв. Цікаво, що цифра 12 в назві вказує не на роки витримки, а на число рослин, які використовують при формуванні напою. Рецептура включає дикий ялівець, коріандр, мускатний горіх, цвіт апельсина, лайм та інші ботанікали. При виробництві джин проходить 5-разову перегонку, щоб зберегти неймовірну чистоту та усі рецепторні характеристики алкоголю. Фінальну дистиляцію проводять із додаванням цвіту апельсина, що дарує легкий цитрусовий аромат. Смак: Гладкий, м'який, освіжаючий смак з нотками трав, апельсинових квітів та цитрусових. Післясмак теплий, пікантний зі сухими акордами. Аромат: Дуже бадьорі відтінки середземноморських лимонів та апельсинів, кавуна з нотками лайма, доповненого мускатним горіхом й коренем ангеліки. Колір: Кришталево-прозорий Географія - Іспанія (Малага) Міцність - 40%", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1098009.jpg?t=1741612118155", "price": 755}, {"_heading": "Пиво"}, {"id": 578910, "name": "Пиво Ottakringer", "desc": "Солод та хміль об`єдналися у цьому австрійському пиві. Свіжа і тонка фруктовість разом із легкою терпкістю роблять це класичне пиво справді вдалим та популярним.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-578910.jpg?t=1713287768455", "price": 72}, {"id": 580546, "name": "MakarBeer IPA 0,33", "desc": "Сильно охмелений різновид світлого елю. Яскраво виражений хмельовий смак з тонами хвої, цитрусу, ананасу, тропічних фруктів та цедри. Післясмак довгий з м'якою хмельовою гіркотою. Карамельный, яскраво виражений хмельовий аромат. Має світлий, злегка мутний колір з білою пінною шапкою.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-580546.jpg?t=1713360121814", "price": 89}, {"id": 580677, "name": "MakarBeer Pilsner 0,33", "desc": "Світле нефільтроване непастеризоване пиво низового бродіння. Класичний преміальний пілснер. Завдяки глибокій хмельовій основі, має смак з традиційною для пілснерів гірчинкою, має довгий гіркий післясмак з невеликою квітковістю і солодовим присмаком. Має благородний свіжий трав'яниста-квітковий аромат. Глибокий золотистий колір зі стійкою пінною шапкою.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-580677.jpg?t=1713362900214", "price": 89}, {"id": 580679, "name": "MakarBeer Amber Ale 0,33", "desc": "Напівтемне нефільтроване непастеризоване пиво верхового бродіння. Пиво у традиційно англійському стилі ALE, верхового бродіння. Смак м'який з приємним присмаком свіжого хмелю та карамелі. Післясмак довгий, солодкуватий з ледь відчутною гірчинкою. Має яскраво виражений хмельовий аромат з нотками карамелі. Додавання карамельного солоду надає пиву інтенсивного бурштинового кольору.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-580679.jpg?t=1713363020808", "price": 89}, {"id": 605768, "name": "MakarBeer Lager double hop 0.33", "desc": "Світле нефільтроване непастеризоване. Пиво низового бродіння, легкотіле з невеликим вмістом алкоголю та ароматно-хмельовим характером. Хмельова гіркота середня, домінує та зберігається до післясмаку. Солодовий аромат слабкий, але хмельовий аромат помірно сильний. Колір світло-солом'яний", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-605768.jpg?t=1713447412011", "price": 59}, {"id": 1107513, "name": "Pet-Cat Rose", "desc": "Мед питний ігристий Pet-Cat Rose - слабоалкогольний напій природного бродіння липового меду та соку прямого віджиму яблук, ожини, червоної та чорної смородини. Без додавання спирту та цукру, зі стриманим перляжем та хрусткою кислотністю. Ця версія продовжує яскраву фруктово-ягідну спрямованість. Післясмак залишає відтінки червоних ягід та зелених яблук. Pet-Сat створена за допомогою пре-шампанського методу \"ансестраль\", що виник задовго до винаходу вторинної ферментації, яку використовують для створення шампанського - років п'ятсот тому. На відміну від класичного методу, що включає 2 етапи бродіння, тут напій бродить лише один раз. Бродіння продовжується у пляшці: вуглекислий газ виділяється та залишається під пробкою, доки її не відкривають. Градус алкоголю нижче, ніж в інших вин із бульбашками. Тиск теж низький, тому перляж ніжний і менш настирливий. Найчастіше його не фільтрують, у келиху ігристе буде непрозорим, з дріжджовим осадом. Натомість смак у нього яскравий. Післясмак залишає свіжі ноти яблук і нагадує про квітучі сади. Географія - Україна Міцність - 8%", "tags": ["Сухе"], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1107513.jpg?t=1742299098061", "price": 443}, {"_heading": "Кава"}, {"id": 557494, "name": "Еспрессо/Espresso", "desc": "", "tags": [], "image": null, "price": 45}, {"id": 557515, "name": "Допіо/Dopio", "desc": "", "tags": [], "image": null, "price": 90}, {"id": 557500, "name": "Американо/Americano", "desc": "", "tags": [], "image": null, "price": 45}, {"id": 557496, "name": "Американо з молоком", "desc": "", "tags": [], "image": null, "price": 60}, {"id": 557511, "name": "Латте/Latte", "desc": "", "tags": [], "image": null, "price": 78, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "350 мл", "price": 78}, {"label": "450 мл", "price": 135}]}}, {"id": 557514, "name": "Капучино 250 мл", "desc": "", "tags": [], "image": null, "price": 65, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "250 мл", "price": 65}, {"label": "350 мл", "price": 78}]}}, {"id": 557516, "name": "Флет Уайт", "desc": "", "tags": [], "image": null, "price": 110}, {"id": 568790, "name": "Альтернативне молоко", "desc": "-безлактозне", "tags": [], "image": null, "price": 35}, {"_heading": "Чай / Какао"}, {"id": 557517, "name": "Какао", "desc": "", "tags": [], "image": null, "price": 70}, {"id": 557521, "name": "Чай заварний", "desc": "-чорний -чорний з бергамотом -саусеп -альпійський луг -бризки шампанського", "tags": [], "image": null, "price": 50, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "300 мл", "price": 50}, {"label": "500 мл", "price": 75}]}}, {"id": 558571, "name": "Чай натуральний фруктовий", "desc": "", "tags": [], "image": null, "price": 65, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "", "price": 65}, {"label": "", "price": 95}]}}, {"_heading": "Прохолодні напої"}, {"id": 558771, "name": "Айс Латте", "desc": "", "tags": [], "image": null, "price": 110}, {"id": 558772, "name": "Бамбл", "desc": "", "tags": [], "image": null, "price": 120}, {"id": 558774, "name": "Еспресо Тонік", "desc": "", "tags": [], "image": null, "price": 125}, {"id": 559003, "name": "Лимонад", "desc": "", "tags": [], "image": null, "price": 110, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "400 мл", "price": 110}, {"label": "1 л", "price": 179}]}}, {"id": 578608, "name": "Coca Cola 0,330", "desc": "-класична -без цукру", "tags": [], "image": null, "price": 50}, {"id": 578609, "name": "Тонік Schweppes", "desc": "", "tags": [], "image": null, "price": 40, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "330 мл", "price": 40}, {"label": "750 мл", "price": 60}]}}, {"id": 578610, "name": "Вода моршинська", "desc": "-газована -слабо газована", "tags": [], "image": null, "price": 35}, {"id": 578611, "name": "Вода Поляна Квасова сильно газована", "desc": "", "tags": [], "image": null, "price": 69}, {"id": 578612, "name": "Fentimans Курйозіті Кола", "desc": "Особливість коли Fentimans – використання перевіреної годиною технології приготування напоїв найвищої якості з використанням комбінації настою, майстерного змішування та ферментації найкращих рослинних інгредієнтів. Мало що змінилося у виробництві Fentimans за останні сто років, тому ми набуваємо натурального та автентичного смаку колись минулої епохи.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-578612.jpg?t=1713269913928", "price": 119}]}, {"id": "food", "name": "Їжа", "items": [{"_heading": "Сніданки"}, {"id": 1205208, "name": "Ніжні сирники з маракуйєвим сабайоном", "desc": "Золотисті сирники з легким, шовковистим маракуєвим кремом сабайон і кулькою морозива — гармонія солодкого, кислуватого та вершкового смаку, пікантності та свіжості. Це справжня насолода для поціновувачів десертів. 280 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205208.jpg?t=1746880545741", "price": 230}, {"id": 1205213, "name": "Крок Мадам", "desc": "Ідеальний сніданок із французьким характером. Це апетитний тост із рум’яного хліба, ніжної шинки та тягучого сиру гауда, запечений під вершковим соусом бешамель і доповнений смаженим яйцем. Соковиті томати чері та свіжа зелень додають яскравих акцентів. 300 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205213.jpg?t=1746880598616", "price": 285}, {"id": 1205218, "name": "Скремблер з креветкою в сирному соусі на круасані", "desc": "Повітряний яєчний скрембл у ніжному сирному соусі з соковитими креветками подається на хрусткому круасані зі свіжою зеленню. Теплий, вершковий, ароматний — ідеальний сніданок, що поєднує делікатність морепродуктів і витонченість французької випічки. 220/60 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205218.jpg?t=1746880683878", "price": 320}, {"id": 1205221, "name": "Яйця пашот з прошутто та соусом дор блю", "desc": "Витончений сніданок, що поєднує ніжні яйця пашот на пухкій булці, щедро вкриті вершковим соусом бешамель і пікантним дор блю. Тонко нарізане прошутто збагачує страву м’ясною ноткою, а свіжа зелень завершує композицію яскравим акцентом. 260 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205221.jpg?t=1746880716996", "price": 250}, {"_heading": "Стартери"}, {"id": 1205227, "name": "Камамбер з грушею у червоному вині", "desc": "Запечений камамбер з грушею в червоному вині — вишукана закуска з ніжного сиру з хрусткою скоринкою, доповнена карамелізованою грушею в ароматному винному соусі.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205227.jpg?t=1746880839965", "price": 270}, {"id": 1205229, "name": "Камамбер з мармеладом із чорізо", "desc": "Запечений камамбер з мармеладом із чорізо — пікантна й ароматна закуска, де ніжний сир поєднується з пряною солодко-гострою пастою з чорізо. Ідеально до вина та хрусткого хліба.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205229.jpg?t=1746880844200", "price": 270}, {"id": 1205232, "name": "Тартар з тунця з круасаном", "desc": "Свіжий тартар із ніжного тунця в поєднанні з мусом із стиглого авокадо та соковитими філе апельсина. Зерниста гірчиця додає пікантності, а свіжа зелень — легкості й аромату. Подається з хрустким круасаном. Легка, свіжа та елегантна страва для вибагливого смаку. 170/60 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205232.jpg?t=1746880907231", "price": 360}, {"id": 1205234, "name": "Тартар з телятини з мусом шевру", "desc": "Соковита телятина, делікатно приправлена трюфельною пастою та зернистою гірчицею, розкриває глибокий м’ясний смак. Мус із витриманого шевру додає ніжний вершковий присмак, а ароматна зелень освіжає кожен шматочок. Це страва з \"характером\" — тонка, виразна й вишукана. 170 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205234.jpg?t=1746880907538", "price": 340}, {"id": 1222172, "name": "Соте з морепродуктів в соусі Шампань", "desc": "Соковиті креветки, м’ясисті мідії та ніжні кальмари обсмажені до ідеальної текстури й подані в ароматному вершково-винному соусі Шампань. Тертий пармезан додає глибини, а свіжа зелень завершує страву яскравим ароматним акцентом. Це вишукана морська насолода з ігристим характером. 200 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1222172.jpg?t=1747848824928", "price": 290}, {"id": 1216579, "name": "Тапінада з маслин та оливок", "desc": "Хрусткий багет із двома видами тапенада — з маслин і оливок — кожна з яких має свій яскравий характер. Ароматна олія з копченої паприки надає глибини, а зелена олія додає свіжих трав’яних нот. Гармонія хрумкості й ніжності в кожному шматочку. 100/60 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1216579.jpg?t=1747414511230", "price": 210}, {"id": 559008, "name": "Антипасті", "desc": "-витриманий сир -сир з блакитною пліснявою -оливки Гордаль -хамон -грисіні", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559008.jpg?t=1712149789649", "price": 299}, {"id": 1512980, "name": "Креветки Темпура", "desc": "Ніжні, соковиті креветки у хрусткому легкому клярі, обсмажені до золотистої скоринки. Подаються з ароматним пікантним соусом айолі, який додає страві свіжості й пікантності. 120г/30г", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1512980.jpg?t=1762443470730", "price": 295}, {"id": 1512982, "name": "Картопля Фрі з пармезаном", "desc": "Картопля фрі з кетчупом та пармезаном — це апетитна класика у новому виконанні: хрустка золотиста картопля, посипана ароматним пармезаном і подана з насиченим кетчупом. Ідеальна закуска до будь-якої страви або як самостійний перекус. 130г/40г", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1512982.jpg?t=1762443537027", "price": 119}, {"id": 1519173, "name": "Цибулеві кільця фрі", "desc": "", "tags": [], "image": null, "price": 119}, {"_heading": "Пінчо"}, {"id": 559018, "name": "Камамбер та грушевий джем", "desc": "Камембер з пряним грушевим джемом та мигдальними чіпсами.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559018.jpg?t=1712150273987", "price": 149}, {"id": 559034, "name": "Грильований перець та анчоус", "desc": "Неймовірне поєднання крем сиру, болгарського перцю та анчоусів.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559034.jpg?t=1712150757577", "price": 149}, {"id": 559048, "name": "Сальса з артишоків та хамон", "desc": "Хрусткий багет, мариновані артишоки та хамон Серано.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559048.jpg?t=1712151567902", "price": 149}, {"id": 559060, "name": "Гуакамоле та креветки", "desc": "Хрустка основа з ніжним гуакамоле й соковитими креветками.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559060.jpg?t=1712152258182", "price": 179}, {"id": 688932, "name": "В'ялені томати та крем сир", "desc": "Ніжний крем-сир на обсмаженому хрусткому багеті, доповнений в’яленими томатами з насиченим середземноморським смаком.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-688932.jpg?t=1716901390292", "price": 149}, {"id": 824330, "name": "Пінчо Крем Чіз\Чорізо", "desc": "Іспанське чорізо на подушці з крем чізу та запашної трюфельної олії, мікро грін, хрустка чіабата.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-824330.jpg?t=1726671753007", "price": 169}, {"id": 824393, "name": "Пінчо хамон- свіжі томати", "desc": "Іспанський хамон на подушці з грецького йогурту зі свіжим йогуртом, мікрогрін, хрустка чіабата.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-824393.jpg?t=1726671846401", "price": 169}, {"_heading": "Салати"}, {"id": 1203551, "name": "Салат з тунцем", "desc": "Основним інгредієнтом є делікатно обсмажене філе тунеця, смак якого ідеально доповнюють мікс зелені, яйце, помідори чері, авокадо, кунжут та лимонний дресінг. 250 г", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1203551.jpg?t=1746801860946", "price": 320}, {"id": 1203553, "name": "Салат з прошутто та дор блю", "desc": "Що для Вас означає поєднання ніжного та ароматного прошутто, томленої у червоному вині соковитої груші, пікантного дор блю, міксу зелені, кунжуту, мигдалевих пластівці і лимонного дресінгу? Бо для нас - це смак Італії. 200 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1203553.jpg?t=1746801892697", "price": 260}, {"id": 1203558, "name": "Салат з морепродуктів", "desc": "Для поціновувачів морепродуктів підійде саме цей салат. Ніжне асорті із соковитих креветок, м'ясистих мідій та делікатних кільець кальмарів, які тануть у роті, дарує витончену свіжість моря. А додавання міксу зелені, огірка, лайма, кунжуту, соєвого соусу та лимонного дресінгу доповнює цей неймовірний смак. 220 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1203558.jpg?t=1746801949363", "price": 320}, {"id": 1203569, "name": "Салат з камамбером та виноградом", "desc": "Це вишукане поєднання вершкового камамберу, солодкого винограду, свіжої зелені, кунжуту та мигдалевих пластівців. А легкий лимонний дресінг підкреслює контраст смаків, створюючи гармонію ніжності й легкої пікантності. Ідеальний вибір для гурманів, що цінують витончені смаки. 200 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1203569.jpg?t=1746802077731", "price": 245}, {"id": 1221983, "name": "Салат з ростбіфом та соусом дор блю", "desc": "Головна роль — за соковитим, тонко нарізаним ростбіфом із насиченим м’ясним смаком. Ароматні огірки, томати чері та зелень додають легкості, а пікантний соус із Дор Блю гармонійно підкреслює благородність яловичини. Вишукана страва з балансом ніжності, свіжості та благородної сирної гостроти. 200 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1221983.jpg?t=1747836239446", "price": 285}, {"_heading": "Супи"}, {"id": 1214109, "name": "Марсельський суп", "desc": "Марсельський суп — це ароматний середземноморський суп з риби та морепродуктів, приправлений часником, помідорами, спеціями та шафраном. Подається з грінками та соусом айолі 300/50/50", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1214109.jpg?t=1747582186825", "price": 285}, {"_heading": "Основні страви"}, {"id": 1205186, "name": "Орзо 4 сири", "desc": "Ніжна паста орзо у вершковому соусі з чотирьох сирів - пармезану, дор блю, гауди та камамберу. Кожен сир розкриває свій характер, а краплина білого вина додає витонченого аромату. Свіжа зелень - для балансу й легкості. Справжнє задоволення для поціновувачів сиру. 300 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205186.jpg?t=1746880284908", "price": 260}, {"id": 1205189, "name": "Трюфельне тальятеле з ростбіфом", "desc": "Класична італійська паста тальятеле, що подається у кремовому вершковому соусі з нотками білого вина та трюфеля. Соковитий ростбіф додає глибини смаку, а тертий пармезан і зелень завершують страву в найкращих традиціях італійської кухні. Витончене, ароматне, автентичне. 300 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205189.jpg?t=1746880295756", "price": 320}, {"id": 1205199, "name": "Фетучіні з морепродуктами", "desc": "Тальятеле у ніжному вершково-винному соусі з додаванням соковитих креветок, м’ясистих мідій і делікатних кальмарів. Солодкі помідори чері додають свіжості та яскравого акценту, а зелень завершує страву легкою ароматною ноткою. Класика середземноморського смаку. 330 г.", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1205199.jpg?t=1746880429293", "price": 325}, {"_heading": "Морозиво"}, {"id": 695648, "name": "Морозиво Gelamo", "desc": "Морозиво Gelamo - пломбір", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-695648.jpg?t=1742230494508", "price": 60}]}, {"id": "other", "name": "Інше", "items": [{"id": 766648, "name": "Розбитий келих", "desc": "", "tags": [], "image": null, "price": 250}, {"id": 766649, "name": "КОРК ФРІ", "desc": "", "tags": [], "image": null, "price": 500}, {"id": 1218553, "name": "Crazy menu", "desc": "Ви можете продовжити ваш вечір після закриття заладу на годину", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-1218553.jpg?t=1747587355618", "price": 1000}, {"id": 559085, "name": "Фуршетний набір", "desc": "Ідеальний подарунок Наповнення: -два хамона -дві салямі -чотири видів сирів -горішки -грисіні Можна додати оливки та джем", "tags": [], "image": "https://static.shaketopay.com.ua/menu/prod/thumbnails/dish-559085.jpg?t=1712153564948", "price": 1400, "options": {"label": "Розмір/Об'єм", "choices": [{"label": "800 г", "price": 1400}, {"label": "1200 г", "price": 1800}]}}]}]};
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