# MY CLIENT BOOK Native v3

Paid, local-first iOS customer record app for beauty professionals.

## Product changes

- Removed sign-up, login, trial, activation code, subscriber and admin features.
- Supabase is used only for account authentication and private per-user sync.
- Customer data is cached locally and synchronized to the signed-in account.
- Added customer/visit records, callback queue, monthly dashboard, JSON backup and Face ID lock.
- No customer photo feature or photo permission is included.
- App Store paid-app pricing is configured in App Store Connect; no in-app purchase SDK is required.

The previous PWA files remain in the repository for migration reference.
