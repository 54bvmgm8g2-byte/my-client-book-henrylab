alter table public.customers
  drop constraint if exists customers_phone_last4_check;

alter table public.customers
  add constraint customers_phone_last4_check
  check (
    phone_last4 = ''
    or phone_last4 ~ '^[0-9]{4}$'
    or phone_last4 ~ '^[0-9]{10,11}$'
  );
