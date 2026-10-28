# SOP 02: Editing the menu

## Purpose
Keep the menu in the app (sections, items, EGP prices, availability) correct, so the floor and the kitchen give guests the same
answer. The menu was first seeded from the public website (`ar/menu.html` of the Mela-Rossa-website repo): 5 sections, 215 items.

## Who does it
- **admin, manager:** add, edit, reorder and hide sections and items, and change prices.
- **kitchen:** only marks an item **Sold out** or **Available**. Kitchen cannot change names or prices; the database refuses it (SOP 06).
- **front_desk:** reads only.

## Data model (what you see in the app)
- **Section**: Breakfast, Food, Cafe, Drinks, Desserts. A section can be limited to one branch (Breakfast = Corniche only).
- **Group** inside a section: for example Pasta, Pizza, Iced coffee.
- **Item**: Arabic name (required), English name (optional), description, **price in EGP** (whole pounds or with piastres, never negative; empty = "ask for price"), sort order, Available / Sold out.
- **Sold out** has two forms: *until end of day* (switches back by itself at midnight, Cairo time) and *no end date* (stays until someone switches it back).

## Steps
### Change a price
1. Menu → search for the item → **Edit**.
2. Type the new price in EGP, digits only, for example `145` or `145.50`.
3. Save. The app shows who changed it and when, and the change is written to the audit log.
4. Tell the manager of the other branch when a price changes for both branches. Prices are shared across branches.

### Add an item
1. Menu → open the section → **Add item**.
2. Fill in the Arabic name and the price. Add the English name and the description when you have them.
3. Choose the group (or type a new one) and save. New items start as **Available**.

### Sold out (kitchen)
1. Menu → tap the item → **Sold out today** (back by itself at midnight) or **Sold out, no end date**.
2. Tell the front desk out loud as well. The app is not a replacement for telling the team.
3. When stock is back: tap the item → **Available**.

### Hide or remove
- To take an item off for a season, set it to *Sold out, no end date*. Only an **admin** can delete an item, and only when it was a mistake.

## Checks
- After a price change, search for the item and confirm the new price shows.
- Once a week (manager): compare the app with the printed menus and the website. If the website has a different price, open a task to update the website; the app does not change it by itself.
- Prices are never 0. An empty price means "ask for price" (one item on the current menu).

## When it goes wrong
- **"Permission denied" when saving:** your role cannot do this change (for example, kitchen editing a price). Ask a manager.
- **A wrong price went out:** fix it straight away. The audit log shows the old value. Tell the shift manager, and honour the price the guest was quoted.
- **Offline:** availability changes queue and sync later (SOP 07). Price and name edits need a connection, so wait until you are back online.

---

## بالمصري (للمطبخ)
- المطبخ بيغيّر حاجة واحدة بس: **خلص** أو **متاح**. الأسعار والأسامي للمدير بس.
- صنف خلص؟ دوس عليه واختار **خلص النهارده** (هيرجع لوحده بالليل الساعة ١٢) أو **خلص لحد ما نرجّعه**.
- قول للـ front desk بصوتك كمان، متعتمدش على الأبلكيشن بس.
- لو الأبلكيشن قالك "مش مسموح"، كلم المدير.
