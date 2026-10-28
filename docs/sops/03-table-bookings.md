# SOP 03: Handling a table booking

## Purpose
Record every table booking once, with the date, the time, the number of guests, the branch and a status, so both branches
and the kitchen know what to expect. A booking moves through these statuses:

`pending → confirmed → seated → completed`, or it ends as `cancelled` or `no_show`.

## Who does it
- **front_desk:** creates, confirms, changes and cancels bookings for their own branch.
- **manager:** the same for their branch, and handles disputes and large groups (more than 12 guests).
- **admin:** all branches. Only an admin can delete a booking, and only when it was entered by mistake. Everyone else cancels.
- **kitchen:** does not see guest details, only today's cover count per branch.

## Steps
### New booking (phone, walk-in, WhatsApp or website)
1. Bookings → **New**.
2. Fill in the branch, date, time (10:00 to 22:00, the last seating an hour before closing), number of guests (1 to 40), guest name, guest phone and source (phone, walk_in, whatsapp, website). Add notes only for things the guest asked for (high chair, birthday, allergy).
3. Save. The booking starts as **Pending**.
4. Confirm with the guest in the same conversation (on the phone, or with the WhatsApp reply in SOP 04), then set **Confirmed**.

### Change
1. Open the booking → **Edit** → change the date, time, guests or branch.
2. Tell the guest the new details in the same channel they used. Moving to another branch needs the guest's yes first.

### Cancel
1. Open the booking → **Cancel** and pick a reason (guest cancelled, restaurant cancelled, duplicate).
2. If the restaurant cancelled, the manager calls the guest. Cancelled bookings are never deleted.

### Arrival and end
- Guest arrives: **Seated**. Guest leaves: **Completed**.
- 20 minutes after the booking time and no word from the guest: call once. If there is no answer, mark **No-show**. Do not send a WhatsApp message as well (SOP 04).

## Checks
- No double booking: the app warns when the same phone already has a booking at the same branch on the same day.
- Over 12 guests: a manager confirms it.
- At closing, nothing from today is Pending, Confirmed or Seated (SOP 01).

## When it goes wrong
- **The guest says they booked, but there is no booking:** search by phone across both branches. If you still find nothing, seat them if you can and add the booking with source walk_in and a note.
- **Saved offline:** the booking shows a clock icon until it syncs (SOP 07). Do not enter it a second time.
- **Wrong branch:** edit the branch. Do not create a second booking.
- **Repeat no-show:** the manager may ask the guest for confirmation the day before next time. Do not record personal judgements about the guest in notes.

---

## بالمصري (للـ front desk)
١. **حجز جديد:** الفرع، اليوم، الساعة، عدد الأفراد، الاسم، الموبايل، جه منين. احفظ، هيبقى "مستني".
٢. أكد مع الضيف وبعدين خليه **متأكد**.
٣. **تغيير:** عدّل نفس الحجز، متعملش حجز جديد. وبلّغ الضيف بنفس الطريقة اللي كلمك بيها.
٤. **إلغاء:** دوس "إلغاء" واختار السبب، والحجز مبيتمسحش.
٥. الضيف وصل: **قعد**. مشي: **خلص**.
٦. عدّى ٢٠ دقيقة ومجاش: كلمه مرة واحدة بس. مردش؟ **مجاش**. ومتبعتلوش واتساب كمان.
٧. أكتر من ١٢ فرد: المدير لازم يوافق.
