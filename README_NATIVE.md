# MY CLIENT BOOK Native 1.1

Paid, local-first iOS customer record app for beauty professionals.

## Product changes

- Removed trial, activation code, subscriber and admin features from the native app.
- Added email account sign-up and login so records can move to a new device.
- Supabase is used only for account authentication and private per-user sync.
- Customer data is cached locally and synchronized to the signed-in account.
- Added customer/visit records, calendar, callback queue, full monthly dashboard, JSON backup and Face ID lock.
- Customer phone input accepts blank, last 4 digits, or a full 10/11-digit number. Search accepts full or partial digits.
- Each visit stores its own next planned visit date; the old customer-level revisit cycle and discount input are no longer used.
- Main navigation is an upper-right menu. The upper-left MY CLIENT BOOK logo always returns home.
- Password reset and verification resend are available from the authentication screen.
- No customer photo feature or photo permission is included.
- App Store paid-app pricing is configured in App Store Connect; no in-app purchase SDK is required.

The previous PWA files remain in the repository for migration reference.

## Supabase Auth redirect

Add `myclientbook://reset-password` and `myclientbook://verified` to Authentication → URL Configuration → Redirect URLs before testing password reset on a device.
