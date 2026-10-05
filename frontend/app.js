// SALESTORM SysCrafters 2026 E-Commerce & Concurrency Engine Client

// ==========================================
// STATE MANAGEMENT
// ==========================================
let activeView = 'catalog';
let catalogProducts = [];
const productCatalogCache = new Map(); // id -> product
let currentCategory = 'All';
let currentSearch = '';
let currentSort = 'default';
let currentPage = 1;
let totalPages = 1;
const cart = new Map(); // productId -> { product, quantity }

let activeReservationToken = null;
let activeOrderId = null;
let countdownInterval = null;
let currentTtl = 300;
let ws = null;
let searchDebounceTimer = null;

const CATEGORY_ICONS = {
  Audio: '🎧',
  Gaming: '🎮',
  Peripherals: '⌨️',
  Electronics: '🖥️',
  Laptops: '💻',
  Smartphones: '📱',
  Wearables: '⌚',
  Cameras: '📷',
  Other: '📦',
};

// ==========================================
// 1. VIEW SWITCHER
// ==========================================
function switchView(viewName) {
  activeView = viewName;

  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tabs .tab-btn').forEach(el => el.classList.remove('active'));

  if (viewName === 'catalog') {
    const vc = document.getElementById('viewCatalog');
    const tb = document.getElementById('tabBtnCatalog');
    if (vc) vc.classList.add('active');
    if (tb) tb.classList.add('active');
    loadCatalogProducts();
  } else if (viewName === 'cart') {
    const vc = document.getElementById('viewCart');
    const tb = document.getElementById('tabBtnCart');
    if (vc) vc.classList.add('active');
    if (tb) tb.classList.add('active');
    renderCartPage();
  } else if (viewName === 'flashSale') {
    const vc = document.getElementById('viewFlashSale');
    const tb = document.getElementById('tabBtnFlashSale');
    if (vc) vc.classList.add('active');
    if (tb) tb.classList.add('active');
  } else if (viewName === 'cockpit') {
    const vc = document.getElementById('viewCockpit');
    const tb = document.getElementById('tabBtnCockpit');
    if (vc) vc.classList.add('active');
    if (tb) tb.classList.add('active');
  }
}

// ==========================================
// 2. STOREFRONT CATALOG LOGIC
// ==========================================
async function loadCatalogSummary() {
  try {
    const res = await fetch('/api/v1/catalog/summary');
    const data = await res.json();
    if (data.totalProducts) {
      const btp = document.getElementById('bannerTotalProducts');
      const bts = document.getElementById('bannerTotalStock');
      const bcc = document.getElementById('bannerCategoriesCount');
      if (btp) btp.innerText = data.totalProducts.toLocaleString();
      if (bts) bts.innerText = data.totalStock.toLocaleString();
      const catCount = Object.keys(data.byCategory || {}).length;
      if (bcc) bcc.innerText = catCount || 8;
    }
  } catch (err) {
    console.warn('Could not load catalog summary:', err);
  }
}

async function loadCatalogProducts() {
  const grid = document.getElementById('catalogProductsGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
      <div class="spinner" style="display: inline-block; width: 24px; height: 24px; margin-bottom: 8px;"></div>
      <p>Fetching real-time stock counters across 1,000 products...</p>
    </div>
  `;

  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: 36,
      category: currentCategory,
      q: currentSearch,
    });

    const res = await fetch(`/api/v1/catalog/products?${params.toString()}`);
    const data = await res.json();

    catalogProducts = data.products || [];
    totalPages = data.totalPages || 1;

    for (const p of catalogProducts) {
      productCatalogCache.set(p.id, p);
    }

    applySortToProducts();
    renderCatalogGrid();
    updatePaginationUI(data.total || 0);
  } catch (err) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--rose);">
        <p>Failed to load products: ${err.message}</p>
      </div>
    `;
  }
}

function applySortToProducts() {
  if (currentSort === 'price-asc') {
    catalogProducts.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (currentSort === 'price-desc') {
    catalogProducts.sort((a, b) => Number(b.price) - Number(a.price));
  } else if (currentSort === 'stock-asc') {
    catalogProducts.sort((a, b) => (a.inventory?.availableStock ?? 0) - (b.inventory?.availableStock ?? 0));
  } else if (currentSort === 'stock-desc') {
    catalogProducts.sort((a, b) => (b.inventory?.availableStock ?? 0) - (a.inventory?.availableStock ?? 0));
  }
}

function renderCatalogGrid() {
  const grid = document.getElementById('catalogProductsGrid');
  if (!grid) return;

  if (catalogProducts.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--text-muted);">
        <div style="font-size: 36px; margin-bottom: 8px;">🔍</div>
        <h3>No products found</h3>
        <p>Try searching with another keyword or selecting a different category.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = catalogProducts.map(p => {
    const icon = CATEGORY_ICONS[p.category] || '📦';
    const totalStock = p.inventory?.totalStock ?? 100;
    const availableStock = p.inventory?.availableStock ?? 0;
    const isSoldOut = availableStock <= 0;
    const pct = Math.max(0, Math.min(100, (availableStock / totalStock) * 100));
    const inCart = cart.get(p.id);
    const inCartQty = inCart ? inCart.quantity : 0;
    const hasImage = !!p.imageUrl;

    let stockClass = 'high';
    if (pct < 20) stockClass = 'low';
    else if (pct < 50) stockClass = 'medium';

    const imageBoxContent = hasImage
      ? `<img class="product-image" src="${p.imageUrl}" alt="${p.name}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<span style=\'font-size:40px\'>${icon}</span>'">`
      : `<span style="font-size: 44px;">${icon}</span>`;

    return `
      <div class="product-card ${isSoldOut ? 'sold-out' : ''}" id="card_${p.id}">
        <div class="product-image-box">
          ${imageBoxContent}
          <div class="category-floating-badge">
            <span>${icon}</span>
            <span>${p.category}</span>
          </div>
          ${isSoldOut ? '<div class="sold-out-overlay">SOLD OUT</div>' : ''}
        </div>

        <div class="product-card-body">
          <div class="product-meta-row">
            <span class="sku-tag">${p.sku}</span>
            <span class="stock-indicator" style="font-size:11px;">${availableStock} in stock</span>
          </div>

          <h3 class="product-card-title" title="${p.name}">${p.name}</h3>

          <div class="mini-stock-bar" style="margin: 6px 0 10px;">
            <div class="mini-stock-fill ${stockClass}" style="width: ${pct}%;"></div>
          </div>

          <div class="price-actions-row">
            <span class="product-price">$${Number(p.price).toFixed(2)}</span>
            <div class="card-actions" style="flex: 0;">
              <button class="btn-card cart ${inCartQty > 0 ? 'added' : ''}" onclick="addToCart('${p.id}')" ${isSoldOut ? 'disabled' : ''}>
                ${inCartQty > 0 ? `✓ (${inCartQty})` : '🛒'}
              </button>
              <button class="btn-card buy" onclick="instantBuy('${p.id}')" ${isSoldOut ? 'disabled' : ''}>
                ⚡ Buy Now
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function filterCategory(cat) {
  currentCategory = cat;
  currentPage = 1;

  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.classList.toggle('active', btn.innerText.includes(cat) || (cat === 'All' && btn.innerText.includes('All')));
  });

  loadCatalogProducts();
}

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    const input = document.getElementById('catalogSearchInput');
    currentSearch = input ? input.value.trim() : '';
    currentPage = 1;
    loadCatalogProducts();
  }, 300);
}

function handleSortChange() {
  const el = document.getElementById('sortFilter');
  if (el) currentSort = el.value;
  applySortToProducts();
  renderCatalogGrid();
}

function changePage(delta) {
  currentPage += delta;
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;
  loadCatalogProducts();
}

function updatePaginationUI(total) {
  const prev = document.getElementById('btnPrevPage');
  const next = document.getElementById('btnNextPage');
  const info = document.getElementById('pageInfoText');
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages;
  if (info) info.innerText = `Showing Page ${currentPage} of ${totalPages} (${total.toLocaleString()} Products)`;
}

// ==========================================
// 3. SHOPPING CART & ATOMIC CHECKOUT
// ==========================================
function toggleCartDrawer() {
  const overlay = document.getElementById('cartOverlay');
  if (overlay) {
    overlay.classList.toggle('open');
    renderCart();
  }
}

function closeCartOnBackdrop(event) {
  if (event.target && event.target.id === 'cartOverlay') {
    toggleCartDrawer();
  }
}

function addToCart(productId) {
  const product = catalogProducts.find(p => p.id === productId) || productCatalogCache.get(productId);
  if (!product) return;

  if (cart.has(productId)) {
    const item = cart.get(productId);
    item.quantity += 1;
  } else {
    cart.set(productId, { product, quantity: 1 });
  }

  updateNavCartBadge();
  renderCart();
  if (activeView === 'cart') renderCartPage();
  renderCatalogGrid();

  showToast(`🛒 Added "${product.name}" to cart`, 'Go to Cart &rarr;', () => switchView('cart'));
}

function showToast(msg, linkText = '', linkAction = null) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${msg}</span>`;

  if (linkText && linkAction) {
    const link = document.createElement('a');
    link.className = 'toast-link';
    link.innerHTML = linkText;
    link.onclick = (e) => {
      e.stopPropagation();
      linkAction();
      toast.remove();
    };
    toast.appendChild(link);
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function toggleDevTokenAccordion() {
  const el = document.getElementById('devTokenContent');
  if (el) el.classList.toggle('open');
}

function updateCartQty(productId, delta) {
  if (!cart.has(productId)) return;
  const item = cart.get(productId);
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart.delete(productId);
  }
  updateNavCartBadge();
  renderCart();
  if (activeView === 'cart') renderCartPage();
  renderCatalogGrid();
}

function removeFromCart(productId) {
  cart.delete(productId);
  updateNavCartBadge();
  renderCart();
  if (activeView === 'cart') renderCartPage();
  renderCatalogGrid();
}

function updateNavCartBadge() {
  let totalItems = 0;
  for (const item of cart.values()) {
    totalItems += item.quantity;
  }
  const ncc = document.getElementById('navCartCount');
  const cdc = document.getElementById('cartDrawerCount');
  const tcc = document.getElementById('tabCartCount');
  const bcc = document.getElementById('btnCheckoutCart');
  const pbc = document.getElementById('btnCartPageCheckout');

  if (ncc) ncc.innerText = totalItems;
  if (cdc) cdc.innerText = totalItems;
  if (tcc) tcc.innerText = totalItems;
  if (bcc) bcc.disabled = totalItems === 0;
  if (pbc) pbc.disabled = totalItems === 0;
}

// Drawer Cart Item HTML
function buildDrawerCartItemHtml(productId, item) {
  const p = item.product;
  const itemTotal = Number(p.price) * item.quantity;
  const icon = CATEGORY_ICONS[p.category] || '📦';
  const thumbHtml = p.imageUrl
    ? `<img src="${p.imageUrl}" alt="${p.name}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color);flex-shrink:0;" onerror="this.style.display='none'">`
    : `<div style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:26px;border-radius:8px;border:1px solid var(--border-color);flex-shrink:0;">${icon}</div>`;
  return `
    <div class="cart-item-row" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-color);">
      ${thumbHtml}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</div>
        <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${p.sku || p.id}</div>
        <div style="font-size:12px;color:var(--emerald);margin-top:2px;font-weight:600;">$${Number(p.price).toFixed(2)} each</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="qty-btn" onclick="updateCartQty('${productId}', -1)">&minus;</button>
        <span class="qty-val" style="min-width:24px;text-align:center;font-weight:700;">${item.quantity}</span>
        <button class="qty-btn" onclick="updateCartQty('${productId}', 1)">+</button>
        <button class="qty-btn" style="color:var(--rose);" onclick="removeFromCart('${productId}')">&#215;</button>
      </div>
      <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--text-main);min-width:70px;text-align:right;">$${itemTotal.toFixed(2)}</div>
    </div>
  `;
}

// Dedicated Cart Page Card HTML
function buildCartPageItemHtml(productId, item) {
  const p = item.product;
  const itemTotal = Number(p.price) * item.quantity;
  const icon = CATEGORY_ICONS[p.category] || '📦';
  const imgContent = p.imageUrl
    ? `<img src="${p.imageUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:32px;">${icon}</div>`
    : `<span style="font-size:32px;">${icon}</span>`;
  return `
    <div class="cart-page-item-card" id="cart_page_item_${productId}">
      <div class="cart-item-icon-box" style="overflow:hidden;padding:0;">
        ${imgContent}
      </div>
      <div class="cart-item-info">
        <h4>${p.name}</h4>
        <div class="meta-row">
          <span class="category-tag ${p.category}">${p.category}</span>
          <span>${p.sku || p.id}</span>
          <span style="color: var(--emerald); font-weight: 600;">✓ In Stock</span>
        </div>
      </div>
      <div class="cart-item-unit-price">
        $${Number(p.price).toFixed(2)} / unit
      </div>
      <div class="cart-item-qty-controls">
        <button class="qty-btn" onclick="updateCartQty('${productId}', -1)">&minus;</button>
        <span class="qty-val">${item.quantity}</span>
        <button class="qty-btn" onclick="updateCartQty('${productId}', 1)">+</button>
      </div>
      <div class="cart-page-total-price">
        $${itemTotal.toFixed(2)}
      </div>
      <button class="btn-remove-item" onclick="removeFromCart('${productId}')" title="Remove from cart">
        &times;
      </button>
    </div>
  `;
}

function renderCart() {
  const container = document.getElementById('cartItemsList');
  if (!container) return;

  if (cart.size === 0) {
    container.innerHTML = `
      <div class="cart-empty-state">
        <div class="icon">🛍️</div>
        <p>Your cart is empty.</p>
        <small>Browse the 1,000 catalog products and click "Add to Cart".</small>
      </div>
    `;
    const cs = document.getElementById('cartSubtotal');
    const ct = document.getElementById('cartTotal');
    if (cs) cs.innerText = '$0.00';
    if (ct) ct.innerText = '$0.00';
    return;
  }

  let subtotal = 0;
  let html = '';
  for (const [productId, item] of cart.entries()) {
    subtotal += Number(item.product.price) * item.quantity;
    html += buildDrawerCartItemHtml(productId, item);
  }

  container.innerHTML = html;
  const cs = document.getElementById('cartSubtotal');
  const ct = document.getElementById('cartTotal');
  if (cs) cs.innerText = `$${subtotal.toFixed(2)}`;
  if (ct) ct.innerText = `$${subtotal.toFixed(2)}`;
}

function renderCartPage() {
  const pageList = document.getElementById('cartPageItemsList');
  const emptyState = document.getElementById('cartPageEmptyState');
  const headerCount = document.getElementById('cartPageHeaderCount');
  const subtotalEl = document.getElementById('cartPageSubtotal');
  const totalEl = document.getElementById('cartPageTotal');
  const checkoutBtn = document.getElementById('btnCartPageCheckout');

  let totalItems = 0;
  for (const item of cart.values()) totalItems += item.quantity;
  if (headerCount) headerCount.innerText = totalItems;

  if (cart.size === 0) {
    if (pageList) pageList.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    if (subtotalEl) subtotalEl.innerText = '$0.00';
    if (totalEl) totalEl.innerText = '$0.00';
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  let subtotal = 0;
  let html = '';
  for (const [productId, item] of cart.entries()) {
    subtotal += Number(item.product.price) * item.quantity;
    html += buildCartPageItemHtml(productId, item);
  }

  if (pageList) pageList.innerHTML = html;
  if (subtotalEl) subtotalEl.innerText = `$${subtotal.toFixed(2)}`;
  if (totalEl) totalEl.innerText = `$${subtotal.toFixed(2)}`;
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function clearFullCart() {
  cart.clear();
  updateNavCartBadge();
  renderCart();
  renderCartPage();
  renderCatalogGrid();
  showToast('🗑️ Cart cleared.', '', null);
}

// Atomic Multi-Item Checkout (works from drawer and dedicated cart page)
async function checkoutCurrentCart() {
  if (cart.size === 0) return;

  const btn = document.getElementById('btnCheckoutCart');
  const pageBtn = document.getElementById('btnCartPageCheckout');
  const setBtnState = (disabled, text) => {
    if (btn) { btn.disabled = disabled; btn.innerText = text || '⚡ Atomic Multi-Item Checkout (Hold Stock)'; }
    if (pageBtn) { pageBtn.disabled = disabled; pageBtn.innerText = disabled ? '⚡ Holding Stock...' : '⚡ Proceed to Checkout'; }
  };
  setBtnState(true, '⚡ Holding Inventory Atomically...');

  const customerId = `cust_${Math.random().toString(36).substring(2, 9)}`;
  const items = Array.from(cart.values());
  const reservedTokens = [];
  let allReserved = true;

  try {
    for (const item of items) {
      for (let q = 0; q < item.quantity; q++) {
        const res = await fetch('/api/v1/reservations/reserve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: item.product.id,
            user_id: customerId,
            ttl_seconds: 300,
          }),
        });

        const data = await res.json();
        if (res.ok && data.reservation_token) {
          reservedTokens.push({ productId: item.product.id, token: data.reservation_token });
        } else {
          allReserved = false;
          break;
        }
      }
      if (!allReserved) break;
    }

    if (!allReserved) {
      for (const rev of reservedTokens) {
        await fetch(`/api/v1/reservations/${rev.token}/release`, { method: 'POST' });
      }
      showToast('⚠️ Some items sold out! All reservations rolled back safely.', '', null);
      setBtnState(false);
      loadCatalogProducts();
      return;
    }

    let totalSub = 0;
    for (const item of items) {
      totalSub += Number(item.product.price) * item.quantity;
    }
    const formattedTotal = `$${totalSub.toFixed(2)}`;

    cart.clear();
    updateNavCartBadge();
    renderCart();
    renderCartPage();
    renderCatalogGrid();

    const cartOverlay = document.getElementById('cartOverlay');
    if (cartOverlay && cartOverlay.classList.contains('open')) {
      toggleCartDrawer();
    }

    setBtnState(false);
    openOrderModal(reservedTokens[0].token, formattedTotal, 300, null, items);
    loadCatalogProducts();
  } catch (err) {
    alert('Checkout error: ' + err.message);
    setBtnState(false);
  }
}

// Instant Buy single item
async function instantBuy(productId) {
  const p = catalogProducts.find(x => x.id === productId) || productCatalogCache.get(productId);
  if (!p) return;

  const customerId = `cust_${Math.random().toString(36).substring(2, 9)}`;

  try {
    const res = await fetch('/api/v1/reservations/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId,
        user_id: customerId,
        ttl_seconds: 300,
      }),
    });

    const data = await res.json();
    if (res.ok && data.reservation_token) {
      openOrderModal(data.reservation_token, `$${Number(p.price).toFixed(2)}`, 300, p);
      loadCatalogProducts();
    } else {
      showToast(`⚠️ Item sold out: ${data.message || data.error}`, '', null);
    }
  } catch (err) {
    showToast(`Instant buy error: ${err.message}`, '', null);
  }
}

// ==========================================
// 4. PROFESSIONAL ORDER CONFIRMATION MODAL & PAYMENT
// ==========================================
function updateCountdownDisplay(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const el = document.getElementById('modalCountdown');
  if (el) el.innerText = formatted;
}

function openOrderModal(token, amount, ttl, product = null, cartItems = null) {
  activeReservationToken = token;
  const modal = document.getElementById('orderModal');
  const backdrop = document.getElementById('modalBackdrop');

  const cfv = document.getElementById('checkoutFormView');
  const csv = document.getElementById('checkoutSuccessView');
  if (cfv) cfv.style.display = 'block';
  if (csv) csv.style.display = 'none';

  const iconEl = document.getElementById('modalItemIcon');
  const titleEl = document.getElementById('modalItemTitle');
  const subEl = document.getElementById('modalItemSubtitle');

  if (product) {
    if (iconEl) iconEl.innerText = CATEGORY_ICONS[product.category] || '🛍️';
    if (titleEl) titleEl.innerText = product.name;
    if (subEl) subEl.innerText = `${product.sku} // Category: ${product.category}`;
  } else if (cartItems && cartItems.length > 0) {
    if (iconEl) iconEl.innerText = '🛒';
    if (titleEl) titleEl.innerText = `Shopping Cart (${cartItems.reduce((acc, x) => acc + x.quantity, 0)} Items)`;
    if (subEl) subEl.innerText = cartItems.map(x => `${x.product.name} (x${x.quantity})`).slice(0, 2).join(', ') + (cartItems.length > 2 ? ' ...' : '');
  } else {
    if (iconEl) iconEl.innerText = '🛒';
    if (titleEl) titleEl.innerText = 'Shopping Cart Order';
    if (subEl) subEl.innerText = 'Atomic Multi-Product Hold // Free Express Delivery';
  }

  const moa = document.getElementById('modalOrderAmount');
  const mst = document.getElementById('modalSubtotal');
  const mtd = document.getElementById('modalTotalDue');
  const bpa = document.getElementById('btnPayAmount');
  const mtk = document.getElementById('modalToken');

  if (moa) moa.innerText = amount;
  if (mst) mst.innerText = amount;
  if (mtd) mtd.innerText = amount;
  if (bpa) bpa.innerText = amount;
  if (mtk) mtk.innerText = token;

  if (modal) modal.classList.add('open');
  if (backdrop) backdrop.classList.add('open');

  currentTtl = ttl;
  clearInterval(countdownInterval);
  updateCountdownDisplay(currentTtl);

  countdownInterval = setInterval(() => {
    currentTtl--;
    if (currentTtl <= 0) {
      clearInterval(countdownInterval);
      const cd = document.getElementById('modalCountdown');
      if (cd) cd.innerText = '00:00 (EXPIRED)';
      showToast('⚠️ Reservation hold expired. Item returned to inventory.', '', null);
      closeOrderModal();
    } else {
      updateCountdownDisplay(currentTtl);
    }
  }, 1000);
}

function closeOrderModal() {
  const modal = document.getElementById('orderModal');
  const backdrop = document.getElementById('modalBackdrop');
  if (modal) modal.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  clearInterval(countdownInterval);
}

async function payModalOrder(simulateMode = 'SUCCESS') {
  if (!activeReservationToken) return;

  const btn = document.getElementById('btnPayOrder');
  if (btn) btn.classList.add('loading');

  try {
    const chkRes = await fetch('/api/v1/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_token: activeReservationToken }),
    });
    const chkData = await chkRes.json();
    if (!chkRes.ok) {
      alert(`Order creation failed: ${chkData.error}`);
      return;
    }

    const payRes = await fetch('/api/v1/payments/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: chkData.order.id,
        simulate_mode: simulateMode,
      }),
    });
    const payData = await payRes.json();

    if (payRes.ok && payData.order?.status === 'PAID') {
      const cfv = document.getElementById('checkoutFormView');
      const csv = document.getElementById('checkoutSuccessView');
      const sob = document.getElementById('successOrderBadge');
      const stp = document.getElementById('successTotalPaid');
      const mtd = document.getElementById('modalTotalDue');

      if (cfv) cfv.style.display = 'none';
      if (csv) csv.style.display = 'block';
      if (sob) sob.innerText = `ORDER #${chkData.order.id.toUpperCase()}`;
      if (stp && mtd) stp.innerText = mtd.innerText;

      showToast('🎉 Order Placed Successfully!', 'View Catalog', () => switchView('catalog'));
      loadCatalogProducts();
      loadCatalogSummary();
    } else {
      showToast('Payment declined: Item returned to store inventory.', '', null);
      closeOrderModal();
      loadCatalogProducts();
    }
  } catch (err) {
    alert(`Payment error: ${err.message}`);
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ==========================================
// 5. WEBSOCKET & TELEMETRY STREAM
// ==========================================
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const status = document.getElementById('wsStatus');
    if (status) status.innerText = 'LIVE WEBSOCKET CONNECTED';
    addLog('Connected to SALESTORM WebSocket stream.', 'accent');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'SNAPSHOT' || msg.type === 'METRICS_UPDATE') {
        updateTelemetryUI(msg.data);
      }
    } catch (e) {
      console.error('Error parsing WS message:', e);
    }
  };

  ws.onclose = () => {
    const status = document.getElementById('wsStatus');
    if (status) status.innerText = 'RECONNECTING...';
    setTimeout(initWebSocket, 2000);
  };
}

function updateTelemetryUI(metrics) {
  if (!metrics) return;

  const stock = metrics.currentRedisStock ?? 100;
  const initial = 100;
  const stockEl = document.getElementById('stockRemaining');
  if (stockEl) stockEl.innerText = stock;

  const pct = Math.max(0, Math.min(100, (stock / initial) * 100));
  const bar = document.getElementById('stockBar');
  if (bar) bar.style.width = `${pct}%`;

  const tag = document.getElementById('stockStatusTag');
  if (tag) {
    if (pct > 50) {
      tag.innerText = 'ACTIVE FLASH SALE';
      tag.className = 'tag text-emerald';
    } else if (pct > 15) {
      tag.innerText = 'SELLING FAST';
      tag.className = 'tag text-amber';
    } else if (pct > 0) {
      tag.innerText = 'CRITICAL STOCK';
      tag.className = 'tag text-rose';
    } else {
      tag.innerText = 'SOLD OUT';
      tag.className = 'tag text-rose';
    }
  }

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setVal('stockReservedTag', `${metrics.activeHoldsCount ?? 0} Units Held in Active TTL`);
  setVal('valTotalRequests', (metrics.totalRequests ?? 0).toLocaleString());
  setVal('valRps', `${metrics.rps ?? 0} req/sec`);
  setVal('valPaidOrders', metrics.paidOrdersCount ?? 0);
  setVal('valActiveHolds', metrics.activeHoldsCount ?? 0);
  setVal('valSoldOut', (metrics.soldOutRejections ?? 0).toLocaleString());
  setVal('valRestocked', metrics.restockedCount ?? 0);
  setVal('valOversold', metrics.oversoldCount ?? 0);

  const badge = document.getElementById('invariantBadge');
  if (badge) {
    if ((metrics.oversoldCount ?? 0) === 0) {
      badge.className = 'invariant-badge';
      badge.innerHTML = '<span class="icon">🔒</span><span class="text">ZERO OVERSELL INVARIANT: <strong>STRICT 0 OVER</strong></span>';
    } else {
      badge.className = 'invariant-badge violation';
      badge.innerHTML = `<span class="icon">⚠️</span><span class="text">INVARIANT VIOLATION: ${metrics.oversoldCount} OVER</span>`;
    }
  }

  if (metrics.p50Ms !== undefined) setVal('valP50', `${metrics.p50Ms} ms`);
  if (metrics.p95Ms !== undefined) setVal('valP95', `${metrics.p95Ms} ms`);
  if (metrics.p99Ms !== undefined) setVal('valP99', `${metrics.p99Ms} ms`);
}

function addLog(text, level = 'info') {
  const container = document.getElementById('terminalLogs');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `log-line ${level}`;

  const now = new Date();
  const timeStr = `[${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}]`;
  div.innerHTML = `<span class="log-time">${timeStr}</span> ${text}`;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function clearLogs() {
  const container = document.getElementById('terminalLogs');
  if (container) container.innerHTML = '';
}

// ==========================================
// 6. BENCHMARK SUITE (COCKPIT SCENARIOS)
// ==========================================
async function run10kBurst() {
  const btn = document.getElementById('btnRun10k');
  if (btn) btn.classList.add('loading');
  addLog('🚀 Launching 10,000 Concurrent Shoppers against 100 Stock units...', 'accent');

  try {
    const res = await fetch('/api/v1/simulation/run-10k-burst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_users: 10000, initial_stock: 100 }),
    });
    const data = await res.json();

    addLog(`✓ 10k Burst Complete in ${data.durationMs}ms (${data.rps} requests/second)!`, 'success');
    addLog(`📊 Results: Granted Reservations: ${data.successfulReservations}/100 | Fast-Fail Sold Out (409): ${data.soldOutCount}`, 'info');
    addLog(`⚡ Latency Profile: P50=${data.p50Ms}ms | P95=${data.p95Ms}ms | P99=${data.p99Ms}ms`, 'accent');
    addLog(`🔒 Zero-Oversell Verification: ${data.invariantPassed ? 'PASSED (0 Oversold) ✓' : 'FAILED ✗'}`, data.invariantPassed ? 'success' : 'danger');
  } catch (err) {
    addLog(`Error executing 10k burst: ${err.message}`, 'danger');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

async function runLifecycleSimulation() {
  const btn = document.getElementById('btnRunLifecycle');
  if (btn) btn.classList.add('loading');
  addLog('🔄 Launching Full Lifecycle Simulation (Failures, Sweeper Restock, Wave 2)...', 'accent');

  try {
    const res = await fetch('/api/v1/simulation/run-lifecycle', { method: 'POST' });
    const data = await res.json();

    for (const log of data.logSummary) {
      addLog(log, log.includes('PASSED') ? 'success' : log.includes('Fail') ? 'warning' : 'info');
    }
  } catch (err) {
    addLog(`Error running lifecycle simulation: ${err.message}`, 'danger');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

async function runIdempotencyTest() {
  const btn = document.getElementById('btnRunIdempotency');
  if (btn) btn.classList.add('loading');
  addLog('🛡️ Testing Idempotency & Replay Attack (500 rapid duplicate calls)...', 'accent');

  try {
    const res = await fetch('/api/v1/simulation/run-idempotency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replays: 500 }),
    });
    const data = await res.json();
    addLog(data.message, data.passed ? 'success' : 'danger');
  } catch (err) {
    addLog(`Error running idempotency test: ${err.message}`, 'danger');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

async function runMultiProductSimulation() {
  const btn1 = document.getElementById('btnRunMultiProduct');
  const btn2 = document.getElementById('btnStoreBurst');
  if (btn1) btn1.classList.add('loading');
  if (btn2) btn2.classList.add('loading');

  addLog('🌐 Launching 10,000 Customers sharded across 1,000 Products in PostgreSQL & Redis...', 'accent');

  try {
    const res = await fetch('/api/v1/simulation/run-multi-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customers: 10000, products: 1000, batch_size: 250 }),
    });
    const data = await res.json();

    addLog(`✓ Multi-Product Simulation Complete in ${data.durationMs}ms (${data.rps} req/sec)!`, 'success');
    addLog(`📊 Products: ${data.totalProductsCatalog} shards | Total Stock Pool: ${data.totalCatalogStock} units`, 'info');
    addLog(`🛒 Granted Checkouts: ${data.successfulCartCheckouts} | Sold-Out (409): ${data.partialOrFailedCarts}`, 'info');
    addLog(`⚡ Latencies: P50=${data.p50Ms}ms | P95=${data.p95Ms}ms | P99=${data.p99Ms}ms`, 'accent');
    addLog(`🔥 Hotspot Shard: ${data.hotspotProductId} (${data.hotspotRejected} rejections)`, 'warning');
    addLog(`🔒 Global Zero-Oversell Invariant across all 1,000 products: ${data.invariantPassed ? 'PASSED (0 Oversold) ✓' : 'FAILED ✗'}`, data.invariantPassed ? 'success' : 'danger');

    loadCatalogProducts();
    loadCatalogSummary();
  } catch (err) {
    addLog(`Error executing multi-product test: ${err.message}`, 'danger');
  } finally {
    if (btn1) btn1.classList.remove('loading');
    if (btn2) btn2.classList.remove('loading');
  }
}

async function resetSale() {
  addLog('🔄 Resetting flash sale to initial 100 units...', 'warning');
  try {
    const res = await fetch('/api/v1/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_stock: 100 }),
    });
    const data = await res.json();
    addLog(data.message, 'success');
    resetCustomerCard();
  } catch (err) {
    addLog(`Reset error: ${err.message}`, 'danger');
  }
}

async function triggerAuditCheck() {
  addLog('🔍 Triggering Zero-Oversell Invariant Verification Audit...', 'info');
  try {
    const res = await fetch('/api/v1/audit/sale-syscrafters-2026');
    const data = await res.json();
    addLog(`Audit Report for ${data.product_name}: Total Stock: ${data.total_initial_stock} | Paid Orders: ${data.paid_orders} | Active Holds: ${data.active_holds}`, 'accent');
    addLog(`Inventory Math: ${data.paid_orders} paid + ${data.active_holds} active holds = ${data.paid_orders + data.active_holds} (Allowed: ${data.total_initial_stock})`, 'info');
    addLog(`Invariant Result: ${data.audit_status} (Oversold: ${data.oversold_count})`, data.zero_oversell_invariant_passed ? 'success' : 'danger');
  } catch (err) {
    addLog(`Audit error: ${err.message}`, 'danger');
  }
}

// Single-user interactive flash sale sandbox
async function reserveSingleItem() {
  const userId = document.getElementById('custUserId')?.value.trim() || 'shopper_alex_01';
  const btn = document.getElementById('btnReserveSingle');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/v1/reservations/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: 'prod_quantum_headset_2026',
        user_id: userId,
        ttl_seconds: 300,
      }),
    });

    const data = await res.json();

    if (res.ok && data.reservation_token) {
      activeReservationToken = data.reservation_token;
      document.getElementById('displayToken').innerText = data.reservation_token;
      document.getElementById('stepReserveCard').classList.add('completed');
      document.getElementById('stepPayCard').classList.remove('disabled');

      currentTtl = 300;
      clearInterval(countdownInterval);
      countdownInterval = setInterval(() => {
        currentTtl--;
        if (currentTtl <= 0) {
          clearInterval(countdownInterval);
          document.getElementById('tokenCountdown').innerText = 'TTL: EXPIRED';
          resetCustomerCard();
        } else {
          document.getElementById('tokenCountdown').innerText = `TTL: ${currentTtl}s`;
        }
      }, 1000);

      addLog(`Reservation GRANTED for ${userId}. Token: ${data.reservation_token}`, 'success');
    } else {
      addLog(`Reservation REJECTED: ${data.message || data.error}`, 'danger');
    }
  } catch (err) {
    addLog(`Network error: ${err.message}`, 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function paySingleOrder(mode) {
  if (!activeReservationToken) return;

  try {
    const chkRes = await fetch('/api/v1/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservation_token: activeReservationToken }),
    });

    const chkData = await chkRes.json();
    if (!chkRes.ok) {
      addLog(`Checkout failed: ${chkData.error}`, 'danger');
      resetCustomerCard();
      return;
    }

    activeOrderId = chkData.order.id;

    const payRes = await fetch('/api/v1/payments/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: activeOrderId,
        simulate_mode: mode,
      }),
    });

    const payData = await payRes.json();
    if (payRes.ok && payData.order?.status === 'PAID') {
      addLog(`Payment SUCCESS! Order ${activeOrderId} finalized in PostgreSQL.`, 'success');
      resetCustomerCard();
    } else {
      addLog(`Payment ${mode}: Order rejected, inventory immediately restocked via compensator.`, 'warning');
      resetCustomerCard();
    }
  } catch (err) {
    addLog(`Payment error: ${err.message}`, 'danger');
  }
}

function resetCustomerCard() {
  activeReservationToken = null;
  activeOrderId = null;
  clearInterval(countdownInterval);
  const dispToken = document.getElementById('displayToken');
  if (dispToken) dispToken.innerText = 'None';
  const countdown = document.getElementById('tokenCountdown');
  if (countdown) countdown.innerText = 'TTL: 300s';
  const resCard = document.getElementById('stepReserveCard');
  if (resCard) resCard.classList.remove('completed');
  const payCard = document.getElementById('stepPayCard');
  if (payCard) payCard.classList.add('disabled');
}

// ==========================================
// 7. INITIALIZATION ON PAGE LOAD
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  loadCatalogSummary();
  loadCatalogProducts();
});
