# Netio — v1.3 Roadmap (post-launch)

> **Status:** drafted pre-launch (June 2026), to be **re-prioritized once real
> installs and feedback exist.** Nothing here should be built before launch.
> Several items below are deliberately parked until users tell us they want
> them — see [Wait for real users](#wait-for-real-users-dont-guess-these-now).
>
> **Two guardrails that override everything below:**
> 1. **Accuracy first.** Netio's entire value is "the number is *right*." Any
>    feature that could make the displayed net wrong loses to features that
>    keep it right. Fee-table volatility (below) makes this the #1 theme.
> 2. **Privacy first.** No accounts, no servers, local storage only. Features
>    that need a backend or phone-home break the core promise and the store
>    listing — flag them explicitly.

---

## Where Netio stands today (v1.2.1)

**Free:** commission by category (Clásica/Premium), real net payout, fixed
charge on <$299 items, automatic category detection, Mercado Envíos Full,
IVA/ISR withholdings, minimum (break-even) price, collapsible summaries on
search results.

**PRO ($89/mo · $699/yr · 7-day trial):** target price by margin, optimal-price
alert, Clásica-vs-Premium comparison, Profit Dashboard, research mode, CSV
export, price history.

**Moat:** in-page, category-aware, MX-tuned, privacy-first, dated fee sourcing.

---

## Competitive landscape (June 2026)

| Tool | Type | Has that Netio doesn't | Threat |
|------|------|------------------------|--------|
| **MercadoLibre Herramientas con IA** (4.9★) | Free Chrome ext | In-page fee calc **+ price history + BuyBox/catalog winner analysis + AI publishing assistant + seller-contact scraping** | **Highest** — most overlap, adds research + AI |
| **Calculadora MercadoLibre** (brusmax, ~1k) | Free Chrome ext | Nothing — standalone calculator, flat IVA/ISR, not in-page | Low (Netio already beats it) |
| **MercadoTrack** | Free OSS ext (AR) | Long-term price-history charts per product | Low–med (AR-focused, single feature) |
| **Nubimetrics / Real Trends** | SaaS ~US$100/mo | Market/competitor intelligence, mass publisher, multi-account, keyword research | Different segment (power sellers) |
| **MELI official pricing tool** | Free, native | "Price to win," auto-repricing, competitor price analysis | Med — free + native, but no true-net/cost view |
| **ProfitOS / Wivo / Clique** | SaaS + content | Full P&L dashboards, fee guides | Different segment |

**Where the whitespace is:** every cheap competitor *calculates a fee*. None
of them nail **"your true net after the costs ML hides"** — installment
(MSI) financing, reputation-based free-shipping subsidy, the post-April-2026
size/weight fixed cost, and withholdings — all in one trustworthy, in-page,
privacy-clean view. That intersection is Netio's lane. Defend accuracy there
before chasing analytics features the SaaS players already own.

---

## Idea backlog

Each idea: **what · why (MX seller) · effort (S/M/L) · Free/PRO · fee-accuracy
risk**.

### A. Fee-freshness & change alert  ⭐
- **What:** ship the fee table with effective dates (already partly done) +
  a lightweight "are my rates stale?" check against a static version file
  (e.g. a JSON hosted on the same Netlify site), surfacing a banner: *"Mercado
  Libre actualizó sus tarifas — actualiza Netio."* Pairs with a documented
  internal process to re-verify rates on a cadence.
- **Why:** ML changed fees **twice in 2026** (ISR→2.5% Jan 1; fixed cost,
  Full storage, free-shipping subsidy all moved Apr 6). A stale table silently
  produces wrong numbers — the one thing that kills trust.
- **Effort:** S–M · **Free** · **Accuracy risk: positive** (this *is* the
  accuracy mechanism). Privacy note: a version check is one static GET; make it
  a passive/opt-in fetch or piggyback the existing update flow — don't turn it
  into telemetry.

### B. Popup summary view  ⭐
- **What:** a toolbar-popup mini-calculator — paste/enter a price + cost, get
  net/margin/min-price without a listing open. Reuses the existing calculator.
- **Why:** sellers sanity-check prices off-page (sourcing, WhatsApp, supplier
  chats). A popup is the natural home for shortcuts and the fee-stale banner.
- **Effort:** S · **Free** · **Accuracy risk: none** (reuses core).

### C. Mercado Pago cuotas (MSI) cost in net  ⭐
- **What:** model the financing cost the seller absorbs when offering *meses
  sin intereses*. Let the user pick 3/6/9/12 MSI and fold the financing % into
  net and target price.
- **Why:** MSI is one of the **biggest hidden costs** and the most common
  "why did I get paid less?" surprise. The AI competitor lists "costos por
  cuotas" — matching + exceeding it is a clean PRO differentiator that deepens
  the true-net promise.
- **Effort:** M · **PRO** · **Accuracy risk: medium** — MSI rates change; needs
  its own dated source row, same discipline as the fee table.

### D. Reputation-aware free-shipping subsidy
- **What:** factor the reputation-based free-shipping bonus (verde/amarillo get
  up to ~10% off free-shipping cost on >$299 new items) into the shipping cost.
- **Why:** affects the shipping line on **every >$299 sale** — currently a
  likely source of small but systematic error. Accuracy correction, not a
  feature flourish.
- **Effort:** M · **Free** · **Accuracy risk: medium** (model wrong = erodes
  trust). **Verify current handling at launch before scheduling.**

### E. Size/weight-aware fixed cost (post-Apr 2026)
- **What:** confirm/extend the <$299 fixed charge to honor the April 2026
  restructure where it depends on size/weight, not price alone. Weight input
  already exists for shipping.
- **Why:** if modeled on price only, the fixed charge is now wrong for some
  items. Pure accuracy.
- **Effort:** S–M · **Free** · **Accuracy risk: medium.** **Verify at launch.**

### F. Category fee comparison
- **What:** let the user preview the fee/net under a *different* category from
  the current listing ("what if I list this under X?").
- **Why:** mis-categorization costs margin; the fee table is already per-
  category, so the data exists.
- **Effort:** S–M · **PRO** · **Accuracy risk: low.**

### G. Keyboard shortcuts
- **What:** `commands` API hotkeys to open the popup / toggle the card / copy
  the net figure.
- **Why:** power-user nicety; cheap once the popup (B) exists.
- **Effort:** S · **Free** · **Accuracy risk: none.**

### H. Profit history over time (aggregate trends)
- **What:** extend the existing Dashboard + price history into a profit-over-
  time / per-month trend view.
- **Why:** retention for sellers who already save costs. Builds on shipped
  parts, not net-new data.
- **Effort:** S–M · **PRO** · **Accuracy risk: low.** Gated on Dashboard usage
  data — see wait-list.

### I. Competitor price tracking on a listing
- **What:** show other offers / BuyBox winner / "are you priced to win?" on the
  current listing.
- **Why:** highly desired; biggest jump from "calculator" to "advisor." But the
  AI competitor and MELI's native tool already do versions of this.
- **Effort:** L · **PRO** · **Accuracy risk: low for fees, high for
  reliability** (DOM/scraping fragility, steps toward data collection — privacy
  tension). Validate demand first.

### J. Bulk listing import
- **What:** import a CSV of the seller's own listings → batch P&L.
- **Why:** power sellers with hundreds of SKUs. CSV plumbing exists (export).
- **Effort:** M–L · **PRO** · **Accuracy risk: low.** Demand unproven.

### K. Multi-account
- **What:** switch between seller profiles within one browser profile.
- **Why:** agencies / multi-store sellers. Chrome profiles already give a crude
  version for free.
- **Effort:** M · **PRO** · **Accuracy risk: low.** Niche; don't guess.

### L. Other-country expansion (AR/CO/CL/BR)
- **What:** new fee + tax + shipping tables per country.
- **Why:** large TAM. But each country is a **new accuracy surface to maintain
  forever**, and fee volatility (theme A) multiplies per market.
- **Effort:** L (per country, ongoing) · Free/PRO · **Accuracy risk: high.**
  Only after MX product-market fit is proven.

### M. Best-time-to-list
- **What:** suggest optimal listing timing.
- **Why:** speculative; hard to prove value.
- **Effort:** L · PRO · **Accuracy risk: n/a** but needs market data Netio
  deliberately doesn't collect (privacy). **Likely never** unless paired with
  an external data source — off-brand. Defer/drop.

---

## Ranked by impact × ease

Impact and Ease each 1–5 (Ease: higher = easier). Score = Impact × Ease.

| # | Idea | Impact | Ease | Score | Tier | F/PRO |
|---|------|:------:|:----:|:-----:|------|:-----:|
| A | Fee-freshness & change alert | 5 | 3 | **15** | ⭐ Now | Free |
| B | Popup summary view | 4 | 4 | **16** | ⭐ Now | Free |
| C | Cuotas (MSI) cost in net | 4 | 3 | **12** | ⭐ Now | PRO |
| F | Category fee comparison | 3 | 4 | **12** | Next | PRO |
| D | Reputation-aware shipping | 4 | 3 | **12** | Next (verify) | Free |
| E | Size/weight fixed cost | 4 | 3 | **12** | Next (verify) | Free |
| G | Keyboard shortcuts | 2 | 5 | **10** | Next | Free |
| H | Profit history trends | 3 | 3 | **9** | Later | PRO |
| I | Competitor price tracking | 4 | 2 | **8** | Validate | PRO |
| J | Bulk listing import | 3 | 2 | **6** | Validate | PRO |
| K | Multi-account | 2 | 2 | **4** | Validate | PRO |
| L | Other-country expansion | 4 | 1 | **4** | Strategic/later | — |
| M | Best-time-to-list | 2 | 1 | **2** | Defer/drop | PRO |

*Scores are a starting sort, not gospel — re-rank against real usage.*

---

## ⭐ Top 3 highest-leverage (do first)

1. **A — Fee-freshness & change alert.** Cheapest way to defend the moat.
   Fees moved twice in 2026; a stale table silently breaks the one promise
   Netio makes. Accuracy-positive, free, on-brand.
2. **B — Popup summary view.** Lowest effort, broadest reach. Extends Netio
   beyond listing pages, lifts retention, and becomes the surface for shortcuts
   (G) and the stale-fee banner (A). Pure reuse, zero accuracy risk.
3. **C — Cuotas (MSI) cost in net.** The biggest *unmodeled* real cost and the
   most common "why was I paid less?" shock. Competitors gesture at it; nailing
   it deepens the true-net promise and is a clean PRO upsell.

Sequencing note: **A + E + D form an "accuracy truth-up"** — A is the system,
E and D are corrections to verify against the live April-2026 rules. Do the
verification pass (E, D) at/just after launch even if you stage the alert UI
(A) slightly later.

---

## Wait for real users (don't guess these now)

| Idea | Why wait |
|------|----------|
| **H — Profit history trends** | Only worth it if people actually save costs into the Dashboard. Watch Dashboard adoption first. |
| **I — Competitor price tracking** | Loud "wish-list" feature, but fragile to build (scraping) and overlaps MELI's native tool. Confirm sellers want *it from Netio* before paying the complexity + privacy cost. |
| **J — Bulk import** | Only matters to high-SKU sellers. Don't build CSV import until you know they're a real share of installs. |
| **K — Multi-account** | Chrome profiles already cover the basic case. Niche; let demand surface. |
| **L — Country expansion** | Validate MX PMF and the fee-maintenance burden on *one* market before multiplying the accuracy surface. |
| **M — Best-time-to-list** | Needs data Netio doesn't (and shouldn't) collect. Likely off-brand; revisit only if a clean data source appears. |

**What to instrument at launch to inform the above (privacy-respecting, local
or opt-in only):** PRO-trial → paid conversion, which PRO features get used,
Dashboard adoption, and qualitative "what's missing?" from support email +
store reviews. Let those numbers, not this doc, pick v1.3's real scope.

---

## Sources

- [MercadoLibre Herramientas con IA — Chrome Web Store](https://chromewebstore.google.com/detail/mercadolibre-herramientas/agkdknlphoikfmliifdcdgijjhmcjile)
- [Calculadora MercadoLibre (brusmax) — Chrome Web Store](https://chromewebstore.google.com/detail/calculadora-mercadolibre/cnlfiljlompofbkogpaepajdighbofaa)
- [MercadoTrack — GitHub](https://github.com/MercadoTrack/extension-local)
- [Nubimetrics vs Real Trends — WooSync](https://www.woosync.io/blog/nubimetrics-vs-real-trends-analisis-completo/)
- [Cambios Mercado Envíos Full México (Abril 2026) — ProfitOS](https://www.profitosapp.com/blog/cambios-mercado-envios-full-mexico-abril-2026)
- [Cuánto cobra Mercado Libre por vender en México 2026 — ProfitOS](https://www.profitosapp.com/blog/cuanto-cobra-mercado-libre-por-vender-mexico-2026)
- [Cambios en Mercado Libre México 2025/2026 — Nubimetrics](https://academia.nubimetrics.com/cambios-mercado-libre-mexico)
- [MELI official pricing management tool](https://global-selling.mercadolibre.com/learning-center/news/how-pricing-management-tool-optimize-your-prices)
