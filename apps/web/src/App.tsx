import { useEffect, useMemo, useState, type FormEvent } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
type Product = { id: string; name: string; category: string; description: string; pricePence: number; palette: string; symbol: string };
type User = { id: string; name: string; email: string };
type Order = { id: string; status: string; totalPence: number; createdAt: string; items: { productName: string; quantity: number }[] };
type Cart = Record<string, number>;
const pound = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const productPhoto = (product: Product) => {
  if (product.name.includes("Lamp")) return "photo-lamp";
  if (product.name.includes("Scarf")) return "photo-scarf";
  if (product.name.includes("Botanical")) return "photo-botanical";
  return `photo-${product.category.toLowerCase()}`;
};
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...options.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "That didn’t work. Please try again.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart>(() => JSON.parse(localStorage.getItem("oddstock-cart") ?? "{}"));
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [modal, setModal] = useState<"auth" | "cart" | "orders" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [category, setCategory] = useState("Everything");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [declineDemo, setDeclineDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { localStorage.setItem("oddstock-cart", JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    api<Product[]>("/products").then(setProducts).catch(() => setError("We can’t load the listings right now. Please try again shortly."));
    api<{ user: User }>("/auth/me").then((result) => setUser(result.user)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!user) return;
    const refresh = () => api<Order[]>("/orders").then(setOrders).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [user]);

  const categories = useMemo(() => ["Everything", ...new Set(products.map((product) => product.category))], [products]);
  const shown = products.filter((product) => (category === "Everything" || product.category === category) && `${product.name} ${product.description}`.toLowerCase().includes(query.toLowerCase()));
  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const total = products.reduce((sum, product) => sum + product.pricePence * (cart[product.id] ?? 0), 0);
  const updateCart = (id: string, delta: number) => setCart((old) => ({ ...old, [id]: Math.min(10, Math.max(0, (old[id] ?? 0) + delta)) }));

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ user: User }>(`/auth/${authMode === "register" ? "register" : "login"}`, { method: "POST", body: JSON.stringify({ email, password, ...(authMode === "register" ? { name } : {}) }) });
      setUser(result.user); setModal(null); setPassword(""); setMessage(`Good to see you, ${result.user.name.split(" ")[0]}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function checkout() {
    if (!user) { setModal("auth"); setAuthMode("login"); return; }
    const items = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
    if (!items.length) return;
    setBusy(true); setError("");
    try {
      await api("/orders", { method: "POST", body: JSON.stringify({ items, demoOutcome: declineDemo ? "DECLINE" : "APPROVE" }) });
      setCart({}); setModal("orders"); setMessage("Order placed. You can follow its status here.");
      api<Order[]>("/orders").then(setOrders);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t place the order."); }
    finally { setBusy(false); }
  }

  async function logout() { await api("/auth/logout", { method: "POST" }).catch(() => undefined); setUser(null); setOrders([]); setMessage("You’re signed out."); }

  return <>
    <header className="nav wrap">
      <a className="wordmark" href="#top" aria-label="Oddstock home">oddstock</a>
      <nav className="nav-links" aria-label="Main navigation"><a href="#shop">Shop</a><button onClick={() => setModal("orders")}>Orders</button></nav>
      <div className="nav-actions"><button className="account-button" onClick={() => user ? void logout() : (setModal("auth"), setAuthMode("login"))}>{user ? `Hi, ${user.name.split(" ")[0]}` : "Sign in"}</button><button className="bag-button" onClick={() => setModal("cart")}>Bag <b>{count}</b></button></div>
    </header>

    <main id="top">
      <section className="hero wrap">
        <div className="hero-copy"><h1>Good stuff.<br />Turns up.</h1><p className="hero-intro">Useful things, odd finds, and the occasional questionable antique.</p><a className="primary-link" href="#shop">Shop the listings <span aria-hidden="true">↘</span></a></div>
        <figure className="hero-photo"><img src="/market-still-life.jpg" alt="A red lamp, moka pot, glass, striped tote and small plant on a scratched blue workbench" /></figure>
      </section>

      <section className="shop-section wrap" id="shop">
        <div className="section-heading"><h2>Shop all</h2><label className="search"><span className="sr-only">Search products</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search listings" /><span aria-hidden="true">⌕</span></label></div>
        <div className="shop-toolbar"><div className="filters" aria-label="Filter by category">{categories.map((item) => <button key={item} className={category === item ? "filter active" : "filter"} onClick={() => setCategory(item)}>{item}</button>)}</div><span className="result-count">{shown.length} {shown.length === 1 ? "listing" : "listings"}</span></div>
        {error && <div className="toast error" role="alert">{error} <button aria-label="Dismiss" onClick={() => setError("")}>×</button></div>}
        {message && <div className="toast" role="status">{message}<button aria-label="Dismiss" onClick={() => setMessage("")}>×</button></div>}
        <div className="product-grid">{shown.map((product) => <article className="product-card" key={product.id}>
          <div className={`product-art ${productPhoto(product)}`}><button aria-label={`Add ${product.name} to bag`} className="quick-add" onClick={() => updateCart(product.id, 1)}>Add to bag <span aria-hidden="true">+</span></button></div>
          <div className="product-info"><div><span className="product-category">{product.category}</span><h3>{product.name}</h3><p>{product.description}</p></div><strong>{pound(product.pricePence)}</strong></div>
        </article>)}</div>
        {shown.length === 0 && <p className="empty-list">No listings match that search. Try another word or category.</p>}
      </section>

    </main>
    <footer className="footer wrap"><a className="wordmark" href="#top">oddstock</a><span>© 2026 Oddstock</span></footer>

    {modal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
      {modal === "auth" && <><h2 id="modal-title">{authMode === "login" ? "Sign in" : "Create an account"}</h2><p className="modal-intro">{authMode === "login" ? "Sign in to continue with your order." : "Use any email address to create an account."}</p><form onSubmit={authenticate} className="auth-form">{authMode === "register" && <label>Your name<input required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>}<label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required type="password" minLength={authMode === "register" ? 10 : 1} maxLength={128} autoComplete={authMode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="submit-button" disabled={busy}>{busy ? "One moment…" : authMode === "login" ? "Sign in" : "Create account"}<span aria-hidden="true">→</span></button></form><button className="switch-auth" onClick={() => { setError(""); setAuthMode(authMode === "login" ? "register" : "login"); }}>{authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button></>}
      {modal === "cart" && <><h2 id="modal-title">Your picks <span className="bag-total-count">({count})</span></h2><div className="cart-lines">{products.filter((product) => cart[product.id]).map((product) => <div className="cart-line" key={product.id}><div className={`mini-art ${productPhoto(product)}`} /><div className="cart-line-name"><b>{product.name}</b><span>{pound(product.pricePence)}</span></div><div className="quantity"><button onClick={() => updateCart(product.id, -1)} aria-label={`Remove one ${product.name}`}>−</button>{cart[product.id]}<button onClick={() => updateCart(product.id, 1)} aria-label={`Add one ${product.name}`}>+</button></div></div>)}{count === 0 && <p className="empty-state">Nothing in the bag yet. Have a look around.</p>}</div>{count > 0 && <><div className="cart-total"><span>Subtotal</span><b>{pound(total)}</b></div><label className="decline-check"><input type="checkbox" checked={declineDemo} onChange={(event) => setDeclineDemo(event.target.checked)} /> Test a declined payment</label><button className="submit-button" disabled={busy} onClick={() => void checkout()}>{busy ? "Sending order…" : user ? "Place order" : "Sign in to check out"}<span aria-hidden="true">→</span></button><p className="fine-print">No payment will be taken.</p></>}</>}
      {modal === "orders" && <><h2 id="modal-title">Your orders</h2>{!user ? <><p className="modal-intro">Sign in to see your orders.</p><button className="submit-button" onClick={() => { setModal("auth"); setAuthMode("login"); }}>Sign in <span aria-hidden="true">→</span></button></> : orders.length === 0 ? <p className="empty-state">No orders yet.</p> : <div className="order-list">{orders.map((order) => <article className="order-row" key={order.id}><div className="order-top"><strong>{order.items.map((item) => `${item.quantity} × ${item.productName}`).join(", ")}</strong><span className={`status ${order.status.toLowerCase()}`}>{order.status === "PENDING" ? <><span className="spinner" /> Processing</> : order.status === "PAID" ? "Order approved" : "Order declined"}</span></div><div className="order-bottom"><span>{new Date(order.createdAt).toLocaleString()}</span><b>{pound(order.totalPence)}</b></div><code>{order.id}</code></article>)}</div>}<p className="fine-print">Order status updates after checkout.</p></>}
    </section></div>}
  </>;
}
