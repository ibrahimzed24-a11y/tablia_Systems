# SOP 04: Handling WhatsApp booking requests

## Purpose
Guests reach Mela Rossa on WhatsApp at **01280060772** (`https://wa.me/201280060772`). The website's booking form also builds a
prefilled message to that number. This SOP covers how those requests are logged, answered and turned into bookings.

**Rules that never change:**
- **The app never sends WhatsApp messages by itself.** No automatic sending, no bulk sending, no templates sent in the background.
  A person presses the reply button, reads the message, and sends it themselves in WhatsApp.
- **Never message the same guest twice without a reason.** The app records every reply. Within 24 hours of the last one, it blocks a
  second reply to that guest unless you type a reason (for example "guest asked a new question", "booking time changed").

## Who does it
- **front_desk:** works the inbox for their branch.
- **manager:** the same, and handles complaints and groups of more than 12 guests.
- kitchen: no access.

## How the reply link works
In the inbox, **Reply on WhatsApp** opens `https://wa.me/20XXXXXXXXXX?text=...`, using the **guest's** number and a prefilled Arabic or English text.
It opens on the front desk device that is signed in to the restaurant's WhatsApp, 01280060772, so the guest sees the reply from the
restaurant's number, the same chat they started at `wa.me/201280060772`. Nothing is sent until the staff member presses Send in WhatsApp.

## Steps
1. **Log it:** when a WhatsApp message asks for a table, open WhatsApp inbox → **New request**. Paste or type the guest name, the phone
   (Egyptian mobile, for example 01xxxxxxxxx), the branch, and the requested date, time, guests and message. Status **New**.
2. **Check availability** for that branch and time in Bookings.
3. **Reply:** press **Reply on WhatsApp**, choose the text (confirm / suggest another time / ask for details), edit it if needed and send it in WhatsApp.
   Back in the app, the request becomes **Replied** and the reply is counted.
4. **Convert:** when the guest agrees, press **Create booking**. The booking is filled from the request, with source whatsapp and status Confirmed,
   and the request becomes **Converted**.
5. **Close:** if it is not a booking (a question, a complaint for the manager, spam), set **Closed** with a short reason.

## Checks
- Every New request gets a reply within 30 minutes during opening hours.
- Within 24 hours of the last reply, the app asks for a reason before a second one. If you cannot write a real reason, do not send it.
- The phone number is stored once per request and only used to reply to that guest. Never add guests to broadcast lists from here.

## When it goes wrong
- **The reply link opens the wrong WhatsApp account:** stop. Do not send from a personal number. Use the front desk device that is signed in to 01280060772.
- **Two requests from the same guest:** close the older one as "duplicate" and work from the newer one.
- **The guest complains about too many messages:** the manager reviews the reply history on the request, apologises once, and sets the request to Closed.
- **You sent the reply but forgot to mark it in the app:** press **Mark replied** without opening WhatsApp again.

---

## بالمصري (للـ front desk)
- الأبلكيشن **عمره ما بيبعت واتساب لوحده.** إنت اللي بتدوس "رد على واتساب" وبتشوف الرسالة وبتبعتها بنفسك من موبايل المطعم (01280060772).
- **متبعتش لنفس الضيف مرتين** من غير سبب. لو بعتله في آخر ٢٤ ساعة، الأبلكيشن هيطلب منك تكتب السبب.
- الخطوات: سجّل الطلب ← شوف المكان فاضي ولا لأ ← رد ← لو وافق دوس "اعمل حجز" ← لو مش حجز اقفله واكتب السبب.
- رد على أي طلب جديد في خلال نص ساعة.
- اوعى تبعت من موبايلك الشخصي.
