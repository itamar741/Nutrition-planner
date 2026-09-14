# בדיקת אבטחה מלאה לפני פריסה

## סיכום

נבצע ביקורת קריאה בלבד על כל `nutrition-coach`, ונפיק דוח ממצאים לפני כל שינוי בקוד. בדיקות הבסיס כוללות סריקת סודות, בדיקת פגיעויות בתלויות, בדיקות יחידה ובדיקות build.

## היקף הבדיקה

- מיפוי כל נתיבי ה־API וגבולות האמון בין הדפדפן, Next.js, PostgreSQL, OpenAI ו־USDA.
- בדיקת גישה והרשאות: cookie חתום, תפוגה, CSRF, brute force לקוד הדמו, הפרדת פרופילים, בעלות על מועמדי מזון ו־IDOR.
- בדיקת קלט ונתונים: סכמות Zod, SQL parametrized, טרנזקציות, replay/idempotency, race conditions, stale versions ודליפת שגיאות.
- בדיקת שכבת ה־AI: prompt injection, חריגה מכלים מורשים, טקסט שמנסה לאשר פעולה, שינוי ישיר של Active Plan ונתוני USDA עוינים.
- בדיקת תשתית: סודות והיסטוריית Git, הרשאות קובצי סביבה, headers, תצורת Render, TLS למסד הנתונים, proxy/IP spoofing ומגבלות קצב.
- הרצת בדיקות אבטחה ויחידה קיימות, ותרחישי תקיפה מקומיים ממוקדים ללא קריאות חיות לשירותים חיצוניים.

## תוצר וקריטריוני קבלה

- דוח מדורג `Critical / High / Medium / Low`, עם מיקום מדויק, השפעה, תרחיש ניצול, ראיות והמלצת תיקון.
- כל נתיב API וכל גבול אמון יקבל סטטוס: תקין, ממצא, או לא ניתן לאימות.
- לא יישאר ממצא קריטי או גבוה ללא הסבר ודרך תיקון ברורה.
- לאחר אישור הדוח, תיקונים יבוצעו בסבב נפרד עם בדיקות רגרסיה ובדיקה חוזרת.

## ממשקים והנחות

- שלב הבדיקה אינו משנה קוד, API, סכמות או מסד נתונים.
- הבדיקה מתמקדת בענף הנוכחי המלא, לא רק ב־diff מול ענף הבסיס.
- בדיקות Render חיות ייכללו רק אם קיימת גישה מורשית; אחרת הן יסומנו כשער פריסה שטרם אומת.
- קובצי סביבה ייבדקו לפי שמות משתנים, הרשאות ומעקב Git בלבד; ערכי סודות לא יוצגו בדוח.

## סטטוס

הביקורת הושלמה בדוח נפרד. ממצאי High הובילו לתוכנית תיקון מדורגת; סטטוס התיקון והאימות מתועד להלן וב־`SECURITY_REMEDIATION_NOTE.md`.

## Remediation status

- **Phase 1 — historical PostgreSQL credential:** the project owner confirmed rotation or disablement. The academic submission uses a history-free archive that excludes `.git` and local environment files. External rotation was not independently verified.
- **Phase 2 — browser-authoritative plans:** public state actions can no longer submit Drafts, target snapshots, validation decisions, activation times, or replacement Active Plans. Approval loads and validates the current server-stored proposal.
- **Phase 3 — AI and transcript trust boundary:** browser actions cannot write assistant messages or arbitrary closed-answer labels/patches. `/api/coach/message` is the only public AI entry point; seven direct AI routes were removed.
- **Phase 4 — access and identity:** production access fails closed, access-code attempts are limited, forged cookies do not create identities, and client-controlled forwarding headers are ignored.
- **Phase 5 — deployment safeguards:** production security headers, verified PostgreSQL TLS configuration, generic public errors, and bounded final-archive inspection were added.
- **Phase 6 — live verification:** the public health endpoint and browser-to-Render TLS passed on 2026-09-14. The required production headers were absent, internal PostgreSQL TLS was not verified, and the exact final submission ZIP was not yet checked. Phase 6 therefore remains open.

No Critical finding remains. High findings have an implemented remediation or, for the historical credential, an owner-confirmed containment record and submission control. Known academic-demo tradeoffs and the remaining live gates are documented in `SECURITY_REMEDIATION_NOTE.md` and `docs/verification-results/phase-6.md`.
