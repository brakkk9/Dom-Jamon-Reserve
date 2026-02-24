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
    const data = await fetch('./menu.json').then(r => r.json());
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