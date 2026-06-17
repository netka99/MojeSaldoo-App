# MojeSaldoo — Startup Idea Stress Test

> Based on *The Founder's Playbook: Building an AI-Native Startup* (Anthropic, 2026)

---

## Where You Are in the Playbook

You're past Idea Stage and deep in **MVP Stage** — substantial code is built, but no real paying users or PMF evidence yet.

The playbook's most important warning applies here:

> *"A working prototype is easy to mistake as concrete evidence that you're solving a real problem. Your prototype instead serves as a useful pressure-testing prop for conversations with potential users. These conversations themselves are the real evidence."*

---

## 1. Is the Problem Real and Specific? ✅ Strong Yes

Your strongest validated problem statement:

> **"Van sellers and small Polish producers spend hours each day managing WZ documents, returns, route settlements, and purchase invoices across paper/Excel — and now face a mandatory KSeF obligation they can't meet with iFirma or inFakt because those apps don't track warehouse stock or production costs."**

The **KSeF mandate is a regulatory tailwind** that creates an immediate forcing function. Every business in your target market must solve this. This is your strongest market signal and a real barrier competitors face.

---

## 2. The 3 Assumptions Your Design Depends On Most Heavily

Per the playbook exercise: *"identify the three assumptions your design depends on most heavily, then ask what would have to be true for each assumption to hold."*

---

### Assumption 1: The Three Segments Can Share One App

Van sellers, bakeries, and small manufacturers have meaningfully different daily workflows. Your module table shows this — bakeries need production/recipes, van sellers need offline mode and quick-order templates, manufacturers need cost allocation.

Building for all three simultaneously risks building too much without proving one segment loves you first.

**What needs to be true for it to hold:**
- A single UX doesn't confuse any of the three personas
- Module-level toggling (`CompanyWorkflowSettings`) is enough to differentiate the experience
- Onboarding doesn't overwhelm a baker who doesn't care about van route reconciliation

**Consequence if it doesn't hold:**
You ship a product that's "fine for everyone" but essential to no one — and no segment becomes your reference customer.

---

### Assumption 2: Polish Small Businesses Will Pay for Complexity That Replaces Paper

Your target (1–10 person firms: piekarnie, van sellers, mali producenci) are notoriously price-sensitive. There is **no pricing model anywhere in PROJECT.md**. The "too expensive vs. too simple" gap you identified needs to be confirmed with willingness-to-pay conversations, not just feature gap analysis.

**What needs to be true for it to hold:**
- The time saved per week is significant enough to justify a subscription
- The KSeF compliance angle creates urgency beyond "nice to have"
- The target user is the owner (who feels the pain AND controls the budget)

**Consequence if it doesn't hold:**
You build the right product but can't monetize it. Polish SMBs will use free tools even if they're worse.

---

### Assumption 3: KSeF + Warehouse + WZ in One Mobile App Is a Meaningful Differentiator

This is your claimed moat vs. iFirma/inFakt. But **Subiekt GT (InsERT), WFMag, Wapro Mag** — these cover warehouse + invoicing. You need to be able to answer: *why would a van seller switch from Subiekt to MojeSaldoo, specifically?*

Mobile-first and price are candidates — but they need validation from real users, not assumptions.

**What needs to be true for it to hold:**
- Subiekt/WFMag are genuinely too complex or expensive for 1–10 person firms
- Mobile-first is a real requirement (not just "nice to have") for van sellers
- The integrated KSeF flow in one app saves meaningful time vs. using two tools

**Consequence if it doesn't hold:**
Your target users are already on Subiekt and won't switch — or they use pen and paper and won't pay for anything digital.

---

## 3. Disconfirming Evidence to Take Seriously

The playbook says: *"Ask Claude to argue against your idea, and find disconfirming evidence that refutes your hypothesis."*

---

### Against: Segment A (Van Selling) Is Blocked Before First Real Use

The two most important missing features for van sellers are:

| # | Gap | Impact |
|---|-----|--------|
| 6 | Quick order templates (stały klient) | Van seller spends too long creating orders on the road |
| 7 | Individual pricing per customer | Can't price differently for sieci A vs. sklep B — unusable for real sales |
| 9 | Offline mode | Van seller loses signal → can't issue WZ → delivery stalls |

A van seller who can't work offline on the road **cannot use this app in the field**. The segment that best fits your "core" workflow is blocked from using it in its most important context.

---

### Against: You Have a Data Integrity Bug Affecting All Three Segments

From PROJECT.md:

> **Bug #2:** `_apply_sale_return_deltas_to_stock()` corrects `ProductStock` but does **not decrement `StockBatch.quantity_remaining`** — batches "live" in the system even after being sold via WZ.

**Consequence:** The expiry alerts report can return batches that are already sold. A baker who trusts your expiry alerts could act on phantom stock. This must be fixed before any real user touches production data — a single wrong alert on day 1 destroys trust.

---

### Against: The Dual-Backend Is a Single Point of Failure

The SSAPI backend handles all KSeF communication. If it goes down, invoicing breaks entirely. For a business where sending invoices is **legally required**, this is a real operational risk that enterprise buyers (or even cautious SMB owners) will flag.

---

### Against: No Pricing = No PMF Test

You cannot validate whether people will pay without a price. The playbook's "effort test" — *does the product pull instead of push after PMF?* — requires actual customers who pay. Define a price before your first real user conversation so you can test willingness to pay, not just willingness to try.

---

### Against: Building for Three Segments Simultaneously (Scope Creep Risk)

The playbook specifically names this failure mode:

> *"Zero-friction scope creep: when building feels effortless and is nearly free, there's always one more cool feature to add. Each individual addition is defensible."*

Each segment addition (piekarnie → receptury, producenci → adnotacje kosztowe) feels justified. But you now have a surface area that spans: WZ, MM, ZW, PZ, KSeF, PZ-KOR, production orders, FIFO, cost allocation, van route reconciliation, expiry tracking, P&L, aging receivables. That's a lot to support before you have one paying customer.

---

## 4. Recommended Next Steps

### Exercise 1 — Pick One Segment to Validate First

**Recommended: Segment A (Van Selling)** because:
- The core workflow (załaduj van → jedź trasą → rozlicz trasę) is the most complete in code
- The KSeF → WZ → Invoice connection is clearest and most testable in a single day
- The user (handlowiec/właściciel) carries a phone all day — mobile-first matters most here

Fix the two blockers first (pricing per customer + FIFO bug), then hand the app to one real van seller for one delivery day.

---

### Exercise 2 — Run 5 Real User Conversations Before Building More

Find one actual van seller (drink/food distributor, small chemical supplier, alcohol rep). Ask:

**Good questions (past-facing, specific):**
- "Walk me through yesterday's delivery route — what did you write down, what did you photograph, what did you do at the end of the day?"
- "When a client returns something, what happens? Show me what you do."
- "How do you invoice your clients? How long does it take per month?"
- "What do you use today — paper, Excel, an app? What breaks about it?"

**Avoid (leading, future-facing):**
- ~~"Would you use an app like this?"~~
- ~~"Would this save you time?"~~

After 5 conversations: run the synthesis. If the workflow you built matches what they actually do, you have problem-solution fit. If it doesn't — that's the signal to adjust before adding more features.

---

### Exercise 3 — Fix the One Bug That Blocks Trust

Before any real user sees production data:

**Fix:** `_apply_sale_return_deltas_to_stock()` in `backend/apps/delivery/services.py` must decrement `StockBatch.quantity_remaining` when a WZ is finalized — the same FIFO walk that production uses (`_consume_fifo`).

A user who sees wrong expiry alerts on day 1 won't come back on day 2.

---

### Exercise 4 — Define Your PMF Benchmark Before Launch

Per the playbook: *"Set your retention benchmarks, your activation criteria, and your Day 7 and Day 30 targets before releasing your MVP."*

**Suggested activation criterion for MojeSaldoo:**
> "User issues a WZ for a real delivery and sends the resulting invoice to KSeF — without calling you."

If a van seller completes that full loop (order → WZ → KSeF invoice) independently in week 1, that's your activation event.

**Day 30 PMF test:** Do they come back every delivery day without prompting? Do they ask when the next feature is coming? That's your PMF signal.

---

### Exercise 5 — Define a Price Before First Conversations

Suggested starting point to test in conversations:

| Tier | Price | What's included |
|------|-------|-----------------|
| Starter | 99 PLN/month | Van selling + KSeF (Segment A only) |
| Standard | 149 PLN/month | + Purchasing (PZ) + Reporting |
| Pro | 199 PLN/month | + Production (Segment B/C) + full analytics |

Ask every potential user: *"If this solved the problem you described, what would you expect to pay per month?"* Their answer will tell you more than any feature list.

---

## 5. Summary: Signal vs. Risk

| | Assessment |
|---|---|
| **Strongest signal** | KSeF is mandatory — every SMB must solve this. You have working KSeF integration (SSAPI) already in production. That's a real technical moat. |
| **Strongest segment** | Van Selling (Segment A) — most complete workflow, clearest daily use case, best fit for mobile-first |
| **Biggest risk** | Building for 3 segments simultaneously without PMF evidence for any of them. Each segment addition feels justified but compounds the surface area before you have your first reference customer. |
| **Critical blocker** | FIFO `quantity_remaining` bug must be fixed before real users touch the app |
| **Missing entirely** | Pricing model, willingness-to-pay validation, real user conversations |

---

## 6. Idea Stage Exit Criteria (Check These)

The playbook says you're ready to leave the Idea Stage (and commit to your MVP) when you can answer **yes** to all three:

- [ ] **Is the problem real and specific?** You can name exactly who experiences it (handlowiec w firmie van selling, 1–5 osób), how often (every delivery day), how severely (hours of paperwork per week + KSeF compliance risk), and what they currently do (paper WZ, Excel, Subiekt on a laptop they don't carry).

- [ ] **Does your solution address the actual problem?** Not the problem you assumed — the one the real user conversations reveal. Run exercise 2 first.

- [ ] **Do you have enough signal to justify continuing to build?** At least 3 of 5 user conversations confirm the WZ → KSeF flow is the daily pain point, and at least 1 person says "I'd pay for this."

---

## 7. MVP Stage Exit Criteria (When to Call PMF)

- **The Sean Ellis test:** Ask active users: *"How would you feel if you could no longer use MojeSaldoo?"* If 40%+ say "very disappointed" — that's PMF.
- **The effort test:** Are you still manually walking users through the daily flow, or are they coming back on their own?
- **The referral test:** Has any user told another van seller / baker about you without you asking?

---

*Document created: 2026-06-17*
*Based on: The Founder's Playbook — Building an AI-Native Startup (Anthropic)*
