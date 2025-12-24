// Create or load unique device ID
let deviceId = localStorage.getItem("deviceId");

if (!deviceId) {
    deviceId = "dev-" + Math.random().toString(36).substr(2, 10);
    localStorage.setItem("deviceId", deviceId);
}


// ===== Final E-Menu.js (Fixed + Robust) =====

// ------------------ Global state ------------------
let menuItems = [];

let cart = {};
let orderCounter = Number(localStorage.getItem("orderCounter")) || 1001;
let lastOrder = null; // for "view previous order"

// db & storage are expected to be defined in the HTML before this script
// (your E-Menu.html correctly initializes firebase and sets `const db` and `const storage`)

// ------------------ Utility helpers ------------------
function safeText(s){ return String(s || ""); }
function formatRupee(n){ return "₹" + Number(n || 0).toFixed(2); }

// ------------------ Category UI ------------------
function showCategory(category) {
    document.querySelectorAll('.category-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const section = document.getElementById(category);
    if (section) section.classList.add('active');

    // mark clicked button active (best-effort)
    try {
        if (window.event && window.event.currentTarget) {
            window.event.currentTarget.classList.add('active');
        }
    } catch(e){ /* ignore */ }
}

// ===== FIRESTORE ORDER COUNTER (NEW SYSTEM) =====
async function getNextOrderNumber() {
    const counterRef = db.collection("appConfig").doc("orderCounter");

    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(counterRef);

        if (!doc.exists) {
            throw "orderCounter document missing in Firestore!";
        }

        const current = doc.data().counter || 1001;
        const next = current + 1;

        transaction.update(counterRef, { counter: next });

        return current; // <-- orderNumber returned
    });
}


// ------------------ Cart management ------------------
function addToCart(itemName, price) {
    if (!itemName || isNaN(price)) return;

    // 🔑 CHECK: item already exists?
    if (cart[itemName]) {
        cart[itemName].quantity++;   // quantity increase
        updateCart();
        return; // ❌ NO POPUP
    }

    // ✅ FIRST TIME ADD
    cart[itemName] = { price: Number(price), quantity: 1 };
    updateCart();

    // 🔔 popup ONLY for first add
     showToast(`🛒 ${itemName} added to cart`);
}


function removeFromCart(itemName) {
    if (!cart[itemName]) return;
    if (cart[itemName].quantity > 1) cart[itemName].quantity--;
    else delete cart[itemName];
    updateCart();
}

function updateCart(){
    const cartItems = document.getElementById("cartItems");
    const cartCount = document.getElementById("cartCount");
    const cartTotalBox = document.getElementById("cartTotal");
    const paymentSection = document.getElementById("paymentSection");
    const placeOrderBtn = document.getElementById("placeOrderBtn");
    const totalSpan = document.getElementById("total");

    if (!cartItems || !cartCount || !cartTotalBox || !paymentSection || !placeOrderBtn || !totalSpan) return;

    const keys = Object.keys(cart);
    if (keys.length === 0) {
        cartItems.innerHTML = `
            <div class="empty-cart">
                <p>Your cart is empty</p>
                <p>Add some delicious items!</p>
            </div>`;
        cartTotalBox.style.display = "none";
        paymentSection.style.display = "none";
        placeOrderBtn.disabled = true;
        cartCount.innerText = "0";
        totalSpan.innerText = "₹0";
        return;
    }

    let html = "";
    let totalItems = 0, total = 0;
    keys.forEach(name => {
        const it = cart[name];
        totalItems += it.quantity;
        total += it.price * it.quantity;
        const safeName = name.replace(/'/g,"&#39;");
        html += `
            <div class="cart-item">
                <div>
                    <div style="font-weight:600">${name}</div>
                    <div style="opacity:0.8">₹${it.price} × ${it.quantity}</div>
                </div>
                <div class="quantity-controls">
                    <button class="qty-btn" onclick="removeFromCart('${safeName}')">-</button>
                    <span style="min-width:22px;text-align:center;display:inline-block">${it.quantity}</span>
                    <button class="qty-btn" onclick="addToCart('${safeName}', ${it.price})">+</button>
                </div>
            </div>
        `;
    });

    cartItems.innerHTML = html;
    cartTotalBox.style.display = "block";
    paymentSection.style.display = "block";
    placeOrderBtn.disabled = false;
    cartCount.innerText = totalItems;
    totalSpan.innerText = formatRupee(total);

    updatePartialPayment();
}

function updatePartialPayment(){
    const partialRadio = document.getElementById("partialPayment");
    const partialDiv = document.getElementById("partialPaymentDiv");
    const partialInput = document.getElementById("partialAmount");
    const totalSpan = document.getElementById("total");
    if (!partialRadio || !partialDiv || !partialInput || !totalSpan) return;

    if (partialRadio.checked) {
        partialDiv.style.display = "block";
        const total = parseFloat(totalSpan.textContent.replace('₹','')) || 0;
        const min = (total * 0.3).toFixed(2);
        partialInput.placeholder = `Minimum ₹${min}`;
    } else {
        partialDiv.style.display = "none";
        partialInput.value = "";
        const err = document.getElementById("partialError");
        if (err) err.style.display = "none";
    }
}

// ------------------ Bill generation & download ------------------
function generateBill(order){
    try {
        document.getElementById("orderNumber").innerText = order.orderNumber;
        document.getElementById("billCustomerName").innerText = order.customerName;
        document.getElementById("billContactNumber").innerText = order.contactNumber;
        document.getElementById("billTableNumber").innerText = order.tableNumber;

        let itemsHTML = "";
        Object.keys(order.cart).forEach(name => {
            const it = order.cart[name];
            itemsHTML += `<div style="display:flex;justify-content:space-between;margin:5px 0;"><span>${name} × ${it.quantity}</span><span>${formatRupee(it.price * it.quantity)}</span></div>`;
        });

        const status = order.remaining > 0 ? "Partially Paid" : "Paid";

        document.getElementById("billDetails").innerHTML = `
            <hr>
            <h3>Order Items:</h3>
            ${itemsHTML}
            <hr>
            <strong>Total:</strong> ${formatRupee(order.total)}<br><br>

            <h3>Payment Details:</h3>
            <strong>Payment Type:</strong> ${order.paymentType === "full" ? "Full Payment" : "Partial Payment"}<br>
            <strong>Amount Paid:</strong> ${formatRupee(order.amountPaid)}<br>
            <strong>Remaining:</strong> ${formatRupee(order.remaining)}<br>
            <strong>Status:</strong> ${status}<br>
            <strong>Payment Method:</strong> ${order.paymentMethod || "-"}<br><br>

            <div style="text-align:center;opacity:0.8;">${order.date}</div>
        `;
    } catch(e){ console.warn("generateBill error:", e); }
}

function openBill(){ const m = document.getElementById("billModal"); if(m) m.style.display = "block"; }
function closeBill(){ const m = document.getElementById("billModal"); if(m) m.style.display = "none"; }

function viewPreviousOrder(){
    if (!lastOrder) lastOrder = JSON.parse(localStorage.getItem("lastOrder") || "null");
    if (!lastOrder) { alert("No previous order available!"); return; }
    generateBill(lastOrder);
    openBill();
}

// Download bill — safe attach
(function attachDownloadHandler(){
    const btn = document.getElementById("downloadBillBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
        const billCard = document.querySelector(".bill-content") || document.querySelector(".bill-content");
        if (!billCard) return alert("Bill area not found");
        // temporarily remove transform/position if any
        const orig = { transform: billCard.style.transform, position: billCard.style.position, top: billCard.style.top, left: billCard.style.left };
        billCard.style.transform = "none"; billCard.style.position = "static"; billCard.style.top = "0"; billCard.style.left = "0";

        html2canvas(billCard, { scale:3, backgroundColor: "#ffffff" }).then(canvas => {
            const link = document.createElement("a");
            link.download = "Order_Bill.png";
            link.href = canvas.toDataURL("image/png");
            link.click();
            // restore
            billCard.style.transform = orig.transform;
            billCard.style.position = orig.position;
            billCard.style.top = orig.top;
            billCard.style.left = orig.left;
        }).catch(err => console.error("html2canvas failed:", err));
    });
})();

// ------------------ Menu rendering ------------------
function createMenuCard(item){
    const card = document.createElement("div");
    card.className = "food-item";

    const imgSrc = item.imageUrl || item.image || "";
    card.innerHTML = `
        <div class="food-image">
            ${ imgSrc ? `<img src="${imgSrc}" style="width:60px;height:60px;border-radius:10px;object-fit:cover;">` : "🍽️" }
        </div>
        <div class="food-details">
            <div class="food-name">${item.name || ""}</div>
            <div class="food-description">${item.description || ""}</div>
            <div class="food-price">${formatRupee(item.price || 0)}</div>
        </div>
        <button class="add-btn">Add to Cart</button>
    `;

    const btn = card.querySelector(".add-btn");
    if (btn) {
        btn.addEventListener("click", () => addToCart(item.name, Number(item.price || 0)));
    }

    return card;
}

function loadMenuFromFirebase(){
    const appetizers = document.getElementById("appetizers");
    const mains = document.getElementById("mains");
    const desserts = document.getElementById("desserts");
    const beverages = document.getElementById("beverages");

    if (!appetizers || !mains || !desserts || !beverages) return;

    // realtime listener
    try {
        db.collection("menuItems").where("status","==","available")
          .orderBy("createdAt","asc")
          .onSnapshot(snapshot => {
              // clear
              appetizers.innerHTML = ""; mains.innerHTML = ""; desserts.innerHTML = ""; beverages.innerHTML = "";
              const list = [];
              snapshot.forEach(doc => {
                  const d = { id: doc.id, ...doc.data() };
                  list.push(d);
                  const item = {
                      name: d.name || "",
                      price: Number(d.price) || 0,
                      description: d.description || "",
                      image: d.image || "",
                      imageUrl: d.imageUrl || "",
                      category: d.category || "appetizers",
                      status: d.status || "available"
                  };
                  if (item.status !== "available") return;
                  let container = appetizers;
                  switch (item.category) {
                      case "appetizers": container = appetizers; break;
                      case "mains": container = mains; break;
                      case "desserts": container = desserts; break;
                      case "beverages": container = beverages; break;
                      default: container = appetizers;
                  }
                  container.appendChild(createMenuCard(item));
              });
              menuItems = list;
              // show appetizers by default if nothing active
              showCategory('appetizers');
          }, err => {
              console.error("Menu listener error:", err);
              // fallback to localStorage menu if present
              try {
                  const menuFromLocal = JSON.parse(localStorage.getItem("menuItems") || "[]");
                  appetizers.innerHTML = ""; mains.innerHTML = ""; desserts.innerHTML = ""; beverages.innerHTML = "";
                  menuFromLocal.forEach(d => {
                      if (d.status !== "available") return;
                      let container = appetizers;
                      switch (d.category) {
                          case "appetizers": container = appetizers; break;
                          case "mains": container = mains; break;
                          case "desserts": container = desserts; break;
                          case "beverages": container = beverages; break;
                      }
                      container.appendChild(createMenuCard(d));
                  });
                  showCategory('appetizers');
              } catch(e){ console.warn("No fallback menu available", e); }
          });
    } catch(e){
        console.error("loadMenuFromFirebase failed:", e);
    }
}

// ------------------ Place Order ------------------
async function placeOrder(){
    if (Object.keys(cart).length === 0) {
        alert("Your cart is empty!");
        return;
    }

    const totalSpan = document.getElementById("total");
    const total = parseFloat(totalSpan ? totalSpan.textContent.replace('₹','') : "0") || 0;
    const paymentType = (document.getElementById("fullPayment") && document.getElementById("fullPayment").checked) ? "full" : "partial";
    let amountPaid = total;
    let remaining = 0;

    if (paymentType === "partial") {
        const partialAmountInput = document.getElementById("partialAmount");
        const partialError = document.getElementById("partialError");
        const partialAmount = parseFloat(partialAmountInput ? partialAmountInput.value : NaN);
        const minPartial = total * 0.3;
        if (isNaN(partialAmount) || partialAmount < minPartial || partialAmount > total) {
            if (partialError) {
                partialError.textContent = `Please pay between ₹${minPartial.toFixed(2)} and ₹${total.toFixed(2)}.`;
                partialError.style.display = "block";
            }
            return;
        } else {
            if (partialError) partialError.style.display = "none";
        }
        amountPaid = partialAmount;
        remaining = total - partialAmount;
    }

    // If payment modal exists, open it and wait for confirm button.
    const paymentModal = document.getElementById("paymentGatewayModal");
    const confirmBtn = document.getElementById("confirmPaymentBtn");

    const doSaveOrder = async () => {
        const customerName = (document.getElementById("customerName") && document.getElementById("customerName").value) || "Customer";
        const contactNumber = (document.getElementById("contactNumber") && document.getElementById("contactNumber").value) || "-";
        const tableNumber = (document.getElementById("tableNumber") && document.getElementById("tableNumber").value) || "-";
        const paymentMethod = (document.getElementById("paymentMethod") && document.getElementById("paymentMethod").value) || "upi";

       const orderNumber = await getNextOrderNumber();


        const order = {
            orderNumber,
            customerName,
            contactNumber,
            tableNumber,
            paymentType,
            paymentMethod,
            amountPaid,
            remaining,
            total,
            cart: JSON.parse(JSON.stringify(cart)),
            date: new Date().toLocaleString()
        };

        lastOrder = order;
        localStorage.setItem("lastOrder", JSON.stringify(order));

        const rawOrder = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            contactNumber: order.contactNumber,
            tableNumber: order.tableNumber,
            paymentType: order.paymentType,
            paymentMethod: order.paymentMethod,
            total: order.total,
            partialAmount: order.amountPaid,
            remaining: order.remaining,
            cart: order.cart,
            date: order.date,
            adminStatus: "pending",
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            deviceId: deviceId
        };

        try {
            await db.collection("orders").add(rawOrder);
            console.log("Order saved to Firebase");
        } catch (err) {
            console.error("Error saving order:", err);
            alert("Failed to save order: " + (err.message || err));
        }

        generateBill(order);
        closePaymentGatewayIfPresent();
        openBill();

        // reset cart
        cart = {};
        updateCart();
        const fullRadio = document.getElementById("fullPayment");
        if (fullRadio) fullRadio.checked = true;
        updatePartialPayment();
    };

    // If modal exists and confirm button exists, use it
    if (paymentModal && confirmBtn) {
        // open modal
        paymentModal.style.display = "block";

        // remove previous handlers to avoid duplicates
        confirmBtn.onclick = null;
        confirmBtn.onclick = function(){
           // --- Step 1: Validate partial payment if needed ---
    if (paymentType === "partial") {
        const partialAmountInput = document.getElementById("partialAmount");
        const val = parseFloat(partialAmountInput ? partialAmountInput.value : NaN);
        const minPartial = total * 0.3;

        if (isNaN(val) || val < minPartial || val > total) {
            const err = document.getElementById("partialError");
            if (err) {
                err.textContent = `Please pay between ₹${minPartial.toFixed(2)} and ₹${total.toFixed(2)}.`;
                err.style.display = "block";
            }
            return;
        }
    }

    // --- Step 2: Open Razorpay ---
    let payAmount = paymentType === "full" ? total : amountPaid;

    var options = {
        "key": "rzp_test_RoErjy7teUMAps",   // your partner's test key
        "amount": payAmount * 100,          // Razorpay amount in paise
        "currency": "INR",
        "name": "Digital Menu",
        "description": "Order Payment",
        "handler": function (response) {
            console.log("Payment Success:", response);
            // Payment successful → save order in Firestore
            doSaveOrder();
        },
        "prefill": {
            "name": document.getElementById("customerName").value,
            "contact": document.getElementById("contactNumber").value
        },
        "theme": {
            "color": "#28a745"
        }
    };

    var rzp = new Razorpay(options);

    rzp.open();   // Open Razorpay popup
        };
    } else {
        // no modal in HTML — proceed directly (fallback)
        doSaveOrder();
    }
}

function openPaymentGateway(){ const m = document.getElementById("paymentGatewayModal"); if (m) m.style.display = "block"; }
function closePaymentGatewayIfPresent(){ const m = document.getElementById("paymentGatewayModal"); if (m) m.style.display = "none"; }

// ------------------ Order history UI ------------------
function openOrderHistory(){
    const orderHistoryDiv = document.getElementById("orderHistoryList");
    if (!orderHistoryDiv) return alert("Order history area missing in HTML");
    orderHistoryDiv.innerHTML = "<p>Loading order history...</p>";

    // prefer createdAt for accurate ordering
db.collection("orders")
  .where("deviceId", "==", deviceId)
 .orderBy("createdAt", "desc")
  .limit(50)
  .get()
      .then(snapshot => {
          const docs = [];
          snapshot.forEach(doc => docs.push(doc.data()));
          if (docs.length > 0) {
              let html = "";
              docs.forEach(o => {
                  const orderNumber = o.orderNumber || o.orderId || "N/A";
                  const total = (typeof o.total !== 'undefined') ? o.total : 0;
                  const date = o.date || "";
                  const status = (typeof o.remaining !== 'undefined' && o.remaining > 0) ? "Partially Paid" : "Paid";
                  const method = o.paymentMethod || "-";
                  let itemsText = "No items";
                  if (o.cart && typeof o.cart === 'object' && Object.keys(o.cart).length > 0) {
                      try {
                          itemsText = Object.entries(o.cart).map(([name, obj]) => `${name} × ${obj.quantity || obj.qty || 1}`).join(", ");
                      } catch(e){ itemsText = "Items unavailable"; }
                  }
                  const escaped = JSON.stringify(o).replace(/'/g,"&#39;");
                  html += `
                    <div style="border:1px solid #ddd;padding:12px;margin-bottom:10px;border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;">
                            <strong>Order #${orderNumber}</strong>
                            <span>${formatRupee(total)}</span>
                        </div>
                        <div style="font-size:13px;opacity:0.8;">${date}</div>
                        <div style="margin:6px 0;color:#444;">${itemsText}</div>
                        <div style="font-size:13px;">Status: ${status} | Method: ${method}</div>
                        <button onclick='viewSpecificBill(${escaped})' style="margin-top:6px;padding:6px 14px;background:#0d6efd;color:white;border:none;border-radius:6px;">
                            View Bill
                        </button>
                    </div>
                  `;
              });
              orderHistoryDiv.innerHTML = html;
              const modal = document.getElementById("orderHistoryModal");
              if (modal) modal.style.display = "block";
          } else {
              loadOrderHistoryFromLocal();
          }
      })
      .catch(err => {
          console.error("Order history fetch failed:", err);
          loadOrderHistoryFromLocal();
      });
}

function loadOrderHistoryFromLocal(){
    let all = JSON.parse(localStorage.getItem("orders") || "[]");
    if ((!Array.isArray(all) || all.length === 0)) {
        const backup = JSON.parse(localStorage.getItem("order") || "[]");
        if (Array.isArray(backup) && backup.length > 0) all = backup;
    }
    if (!Array.isArray(all) || all.length === 0) return alert("No previous orders found!");

    let html = "";
    all.forEach(o => {
        const orderNumber = o.orderNumber || o.orderId || "N/A";
        const total = (typeof o.total !== 'undefined') ? o.total : 0;
        const date = o.date || "";
        const status = (typeof o.remaining !== 'undefined' && o.remaining > 0) ? "Partially Paid" : "Paid";
        const method = o.paymentMethod || "-";
        let itemsText = "No items";
        if (o.cart && typeof o.cart === 'object' && Object.keys(o.cart).length > 0) {
            try { itemsText = Object.entries(o.cart).map(([name,obj]) => `${name} × ${obj.quantity || obj.qty || 1}`).join(", "); } catch(e){ itemsText = "Items unavailable"; }
        }
        const escaped = JSON.stringify(o).replace(/'/g,"&#39;");
        html += `
            <div style="border:1px solid #ddd;padding:12px;margin-bottom:10px;border-radius:8px;">
                <div style="display:flex;justify-content:space-between;">
                    <strong>Order #${orderNumber}</strong>
                    <span>${formatRupee(total)}</span>
                </div>
                <div style="font-size:13px;opacity:0.8;">${date}</div>
                <div style="margin:6px 0;color:#444;">${itemsText}</div>
                <div style="font-size:13px;">Status: ${status} | Method: ${method}</div>
                <button onclick='viewSpecificBill(${escaped})' style="margin-top:6px;padding:6px 14px;background:#0d6efd;color:white;border:none;border-radius:6px;">
                    View Bill
                </button>
            </div>
        `;
    });

    const div = document.getElementById("orderHistoryList");
    if (div) div.innerHTML = html;
    const modal = document.getElementById("orderHistoryModal");
    if (modal) modal.style.display = "block";
}

function closeOrderHistory(){ const m = document.getElementById("orderHistoryModal"); if(m) m.style.display = "none"; }

function viewSpecificBill(order){
    generateBill(order);
    closeOrderHistory();
    openBill();
}

// ------------------ Initial setup ------------------
document.addEventListener("DOMContentLoaded", () => {
    // attach payment radio events
    const full = document.getElementById("fullPayment");
    const partial = document.getElementById("partialPayment");
    if (full) full.addEventListener("change", updatePartialPayment);
    if (partial) partial.addEventListener("change", updatePartialPayment);

    // start firebase menu listener
    loadMenuFromFirebase();

    // initial cart render
    updateCart();

    // attach previous-order button(s) if present (your HTML calls functions directly; this is just defensive)
    const viewBtn = document.querySelector(".history-buttons button");
    // no need to attach if HTML already uses inline onclick

    // fallback: ensure download button exists handler attached earlier via IIFE
});


function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.innerText = message;
    toast.style.visibility = "visible";
    toast.style.opacity = "1";

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.visibility = "hidden";
    }, 1000); // 👈 ONLY 1 second
}

