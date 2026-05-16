# Техническое задание: Pulse Market

Статус документа: рабочее ТЗ финального продукта.
Дата актуализации: 2 мая 2026.

## 1. Краткое описание продукта

Pulse Market - это Arabic-first платформа прогнозных рынков, где пользователь может смотреть актуальные рынки, изучать вероятность исходов, открывать позиции, пополнять баланс, управлять портфелем и отслеживать историю сделок.

На первом этапе продукт использует публичные данные Polymarket как источник рыночной информации. Финальная версия должна иметь собственную пользовательскую систему, кошельки, баланс, историю операций, модерацию контента, арабскую локализацию, административную панель и юридически корректный контур работы с реальными деньгами.

## 2. Цель проекта

Создать полноценный интерфейс прогнозного рынка для Arabic-first аудитории с понятным UX, живыми рыночными данными, прозрачной торговой логикой, безопасной учетной записью и готовностью к легальному запуску в выбранной юрисдикции.

## 3. Текущий статус проекта

Уже реализовано:

- [x] ~~Backend на Fastify/TypeScript.~~
- [x] ~~Прокси к публичному Gamma API Polymarket.~~
- [x] ~~Конфигурация через `HOST`, `PORT`, `POLYMARKET_GAMMA_URL`.~~
- [x] ~~Healthcheck endpoint `GET /health`.~~
- [x] ~~Production readiness core: `GET /api/health`, `GET /api/ready`, readiness checks
  DB availability, backend market data layer, and critical env guardrails without exposing
  secrets.~~
- [x] ~~Endpoint `GET /api/events`.~~
- [x] ~~Endpoint `GET /api/events/:id`.~~
- [x] ~~Endpoint `GET /api/markets`.~~
- [x] ~~Endpoint `GET /api/markets/:id`.~~
- [x] ~~Endpoint `GET /api/tags`.~~
- [x] ~~Endpoint `GET /api/search`.~~
- [x] ~~Нормализация market/event объектов в собственный формат API.~~
- [x] ~~Нормализация outcomes, цен, вероятностей и token id.~~
- [x] ~~Расчет price summary: yes, no, best bid, best ask, last trade, midpoint, spread.~~
- [x] ~~Расчет date summary: статус рынка, timestamp дат, seconds to close.~~
- [x] ~~Подбор related markets для детальной страницы.~~
- [x] ~~Базовая фильтрация нежелательных local-тем в backend/frontend.~~
- [x] ~~React/Vite frontend.~~
- [x] ~~Tailwind CSS подключен к frontend build.~~
- [x] ~~Основные frontend-блоки переписаны на Tailwind utility classes.~~
- [x] ~~`web/src/styles.css` очищен до одного Tailwind import без кастомного CSS.~~
- [x] ~~Frontend разнесен на components/hooks/lib вместо одного большого `main.tsx`.~~
- [x] ~~Страница списка рынков.~~
- [x] ~~Поиск по названию рынков на frontend.~~
- [x] ~~Тематические вкладки/категории на frontend.~~
- [x] ~~Primary Polymarket-like nav подключен к backend-owned category/topic/sort filters и
  URL state; кнопки не являются декоративной ловушкой.~~
- [x] ~~Карточки рынков с изображением, объемом и исходами.~~
- [x] ~~Детальная страница рынка.~~
- [x] ~~Блок графика вероятностей в UI.~~
- [x] ~~Блок правил/описания рынка.~~
- [x] ~~Торговый тикет Buy Yes/Buy No в демо-режиме.~~
- [x] ~~Расчет количества shares по введенной сумме.~~
- [x] ~~Демо-баланс 10,000 USDT.~~
- [x] ~~Backend-owned local portfolio/trading API; dev/test без БД использует in-memory store,
  authenticated DB mode сохраняет ledger entries, trades и positions в Postgres.~~
- [x] ~~Trading Logic local: backend quote/order endpoints для local buy/sell, частичной продажи,
  idempotency key, backend PnL summary и audit events.~~
- [x] ~~Страница портфеля с equity, cash, positions value и local PnL.~~
- [x] ~~История local trades.~~
- [x] ~~Backend auth local: register/login/logout/me/settings, in-memory users/sessions, scrypt password hashes и HttpOnly cookie session.~~
- [x] ~~Database core: Postgres/Supabase env config, DB client, SQL migration runner и initial schema.~~
- [x] ~~Initial DB tables: users, user_sessions, user_settings, categories, markets, market_outcomes,
  market_snapshots, wallets, positions, trades, ledger_entries, audit_logs, comments,
  market_visibility_rules.~~
- [x] ~~Repository layer core: UserRepository, SessionRepository, MarketRepository,
  PortfolioRepository skeleton, memory fallback adapters и Postgres adapters для auth/market/audit.~~
- [x] ~~Auth service переведен на repository abstraction; без DATABASE_URL остается memory fallback,
  с DATABASE_URL может использовать Postgres users/sessions/settings.~~
- [x] ~~Audit log core: auth register/login/logout/settings и trading events пишутся
  через audit service; без DB используется memory audit repository.~~
- [x] ~~Supabase DB auth smoke test пройден: migration applied/skipped, API health `database=enabled`,
  curl register/login/me/logout, проверены rows в users, user_sessions, user_settings, audit_logs.~~
- [x] ~~In-memory auth rate limit для register/login/settings по IP+endpoint; login дополнительно учитывает email.~~
- [x] ~~Frontend login/sign-up/logout/profile/settings flow без хранения session token в localStorage.~~
- [x] ~~Mobile auth menu в header: Log In, Sign Up, Portfolio, Profile для authenticated users.~~
- [x] ~~Backend protected endpoint helper для будущих private endpoints.~~
- [x] ~~Local portfolio/trading привязаны к authenticated userId; при `DATABASE_URL`
  stateful trading/portfolio routes требуют auth и не падают в guest memory fallback.~~
- [x] ~~Адаптивная верстка для desktop/tablet/mobile.~~
- [x] ~~Команды `npm run dev:api`, `npm run dev:web`, `npm run check`.~~
- [x] ~~GitHub Actions CI workflow for backend typecheck, web typecheck, backend tests, frontend
  tests, and web build.~~
- [x] ~~Operational runbook `docs/RUNBOOK.md` for local startup, migrations, API checks, webhook
  mismatch/manual_review handling, and audit logs.~~

Важно: текущая торговля является симуляцией. Local portfolio/trading хранится в памяти
backend-процесса и сбрасывается при рестарте API. Ledger и wallet core могут храниться в
Postgres при `DATABASE_URL`; authenticated portfolio/trade/watchlist/compliance state также
подключен к Postgres repositories. Реальные сделки, реальные депозиты/выводы, KYC/AML providers,
wallet signing, settlement и real-money flows пока не реализованы.

## 4. Целевая аудитория

Основная аудитория:

- Arabic-speaking пользователи, которым нужен понятный интерфейс прогнозных рынков.
- Пользователи, которые хотят отслеживать события в политике, спорте, крипте, экономике, культуре и технологиях.
- Пользователи, которым важны быстрый вход, понятные вероятности, прозрачный портфель и простая торговая форма.

Вторичная аудитория:

- Администраторы и модераторы платформы.
- Команда поддержки.
- Compliance/finance команда.
- Контент-менеджеры и переводчики.

## 5. Языки и локализация

Финальный продукт должен поддерживать:

- Arabic-first интерфейс с RTL layout.
- Английский интерфейс как второй язык.
- Возможность добавлять новые языки без переписывания frontend.
- Перевод названий рынков, описаний, правил и категорий.
- Отдельное хранение оригинального текста и локализованного текста.
- Fallback: если арабский перевод отсутствует, показывать английский оригинал с пометкой/мягким fallback без поломки UI.
- Админский workflow для ручной правки переводов.
- Защиту от некорректных машинных переводов для юридически важных правил рынков.

Уже сделано:

- [x] ~~В API предусмотрены поля `title_ar` для markets/events.~~

Нужно сделать:

- [ ] Реальную арабскую локализацию интерфейса.
- [ ] RTL-верстку как основной режим.
- [ ] Таблицу переводов в базе данных.
- [ ] Pipeline машинного перевода и ручной модерации.
- [ ] Переключатель языка в интерфейсе.

## 6. Основные пользовательские сценарии

### 6.1 Просмотр рынков

Пользователь должен иметь возможность:

- Открыть главную страницу со списком активных рынков.
- Видеть название рынка, изображение/иконку, категорию, объем, вероятности исходов.
- Фильтровать рынки по категориям.
- Искать рынки по тексту.
- Сортировать рынки по популярности, объему, времени закрытия, новизне и тренду.
- Открывать детальную страницу рынка.
- Добавлять рынок в watchlist.

Уже сделано:

- [x] ~~Список активных рынков.~~
- [x] ~~Карточки рынков.~~
- [x] ~~Frontend-поиск по названию.~~
- [x] ~~Серверный поиск и фильтры в UI через `/api/markets`.~~
- [x] ~~Сортировка в UI через backend `sort`.~~
- [x] ~~URL-синхронизация search/primary nav/category/topic/sort/status/volume/date фильтров.~~
- [x] ~~Тематические вкладки.~~
- [x] ~~Открытие детальной страницы через hash navigation.~~
- [x] ~~Стабильные изображения через `displayImage`, upstream image/icon и deterministic category
  fallback pool по market id/slug/title для повторяющихся upstream images.~~

Нужно сделать:

- [x] ~~Watchlist, привязанный к аккаунту, через `GET/PUT/DELETE /api/watchlist/:marketId` и
  Postgres `user_watchlist` при `DATABASE_URL`.~~
- [ ] Страницы категорий.
- [ ] Пагинация или infinite scroll.

### 6.2 Детальная страница рынка

Пользователь должен видеть:

- Название рынка.
- Локализованное описание.
- Правила разрешения рынка.
- Все outcomes.
- Текущие цены/вероятности.
- Bid/ask/spread.
- Объем и ликвидность.
- Дату начала и закрытия.
- Статус рынка: upcoming, live, expired, closed.
- График изменения вероятностей.
- Related markets.
- Комментарии/обсуждение.
- Собственную позицию по этому рынку.
- Историю своих сделок по этому рынку.

Уже сделано:

- [x] ~~Детальная страница рынка.~~
- [x] ~~Отображение outcomes.~~
- [x] ~~Отображение объема и даты закрытия.~~
- [x] ~~Блок related markets.~~
- [x] ~~Related markets side rail использует image/icon/fallback по related market, а не визуал
  открытого рынка.~~
- [x] ~~Блок правил/описания.~~
- [x] ~~UI графика вероятностей.~~
- [x] ~~Frontend chart rendering downsamples large CLOB histories and renders only the latest point
  marker per series, so real Polymarket histories do not create thousands of SVG nodes.~~
- [x] ~~Detail API возвращает `history.price_history`: для binary markets сначала реальные
  Polymarket CLOB Yes/No token history, затем durable `history.snapshots`, затем synthetic
  fallback только если оба real sources недоступны.~~
- [x] ~~Real snapshot pipeline: collector сохраняет текущие prices в `market_snapshots`, а detail
  использует snapshots как fallback/дополнение после CLOB history.~~
- [x] ~~Отображение local-позиции по рынку.~~
- [x] ~~История local trades по рынку через backend local API.~~

Нужно сделать:

- [x] ~~Реальные исторические данные для binary-графика через Polymarket CLOB price history.~~
- [x] ~~Реальные snapshot-точки для графика через repository/Postgres collector.~~
- [ ] Реальные комментарии.
- [ ] Реальные holders/positions/activity tabs.
- [ ] Подробные правила resolution для каждого рынка.
- [ ] Отдельный блок рисков и статуса доступности торговли.
- [ ] Корректная работа с multi-outcome рынками в торговле.

### 6.3 Регистрация и аккаунт

Пользователь должен иметь возможность:

- Зарегистрироваться по email/телефону или через социальный вход.
- Подтвердить email/телефон.
- Войти в аккаунт.
- Выйти из аккаунта.
- Восстановить доступ.
- Настроить 2FA.
- Видеть профиль, язык, валюту, страну, лимиты и настройки уведомлений.

Уже сделано:

- [x] ~~В UI есть кнопки Log In и Sign Up.~~
- [x] ~~Backend authentication local через `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.~~
- [x] ~~Пароли хешируются через Node `crypto.scrypt`; plaintext passwords не хранятся.~~
- [x] ~~Session flow на opaque token в HttpOnly SameSite cookie; `secure` включается в prod.~~
- [x] ~~Auth repository abstraction и Postgres adapters для users/sessions/settings при включенном `DATABASE_URL`.~~
- [x] ~~Session token в Postgres хранится только как hash, не raw token.~~
- [x] ~~local in-memory rate limit для auth endpoints через `AUTH_RATE_LIMIT_WINDOW_MS` и `AUTH_RATE_LIMIT_MAX`.~~
- [x] ~~Базовая страница профиля/settings и `PATCH /api/users/me/settings`.~~
- [x] ~~Frontend auth state загружается с backend и не хранит session token в localStorage.~~
- [x] ~~Admin roles core: `user`, `support`, `compliance_admin`, `finance_admin`,
  `super_admin`; frontend не может назначать роль.~~
- [x] ~~Email verification endpoints + profile resend UX через backend token flow.~~
- [x] ~~Password reset request/reset endpoints + frontend reset UX.~~
- [x] ~~2FA setup/status/confirm/disable, QR data URL, backup codes и backup-code regeneration.~~
- [x] ~~Session/device management: list sessions, revoke session, revoke other sessions/logout all
  other devices.~~
- [x] ~~CSRF signed double-submit protection для browser state-changing API через
  `GET /api/auth/csrf` и `X-CSRF-Token`.~~
- [x] ~~Role/permission env allowlists: `SUPPORT_EMAILS`, `COMPLIANCE_ADMIN_EMAILS`,
  `FINANCE_ADMIN_EMAILS`, `SUPER_ADMIN_EMAILS`; legacy `ADMIN_EMAILS` = `super_admin`.~~

Нужно сделать:

- [x] ~~Production startup fail-fast без `DATABASE_URL`; явный production config не может тихо
  уйти в memory fallback для critical runtime state.~~
- [x] ~~User model в базе данных для auth users/sessions/settings.~~
- [x] ~~Password reset.~~
- [x] ~~Email verification.~~
- [x] ~~2FA.~~
- [x] ~~Production roles/permissions core beyond single admin allowlist.~~
- [x] ~~Device/session management core.~~
- [x] ~~Production guardrail не разрешает in-memory auth rate limiter; доступны
  `AUTH_RATE_LIMIT_BACKEND=redis` + `REDIS_URL` для backend Redis limiter и `external` для
  edge/proxy/managed limiter.~~
- [x] ~~Production audit coverage расширена на auth security/session/2FA/admin core events.~~
- [x] ~~Реальный Redis rate-limit adapter внутри backend для auth endpoints.~~
- [x] ~~Auth-owned portfolio, positions, trades и watchlist через repositories; Postgres
  используется при `DATABASE_URL`, memory fallback остается только dev/test без DB.~~
- [ ] Ограничения доступа по стране/юрисдикции.

### 6.4 KYC, AML и юридический контур

Перед запуском реальных денег продукт должен иметь:

- KYC-проверку личности.
- AML/risk scoring.
- Санкционные списки.
- Проверку возраста.
- Проверку страны проживания.
- Лимиты на ввод/вывод/торговлю.
- Аудит действий пользователя.
- Политику блокировки аккаунта.
- Пользовательское соглашение.
- Privacy policy.
- Risk disclosure.
- Market integrity policy.

Уже сделано:

- [x] ~~В footer есть risk disclaimer о демо-режиме и регуляторных рисках.~~
- [x] ~~Backend core в `src/compliance.ts`: self-declared local profile, `kycStatus`,
  `amlStatus`, `riskLevel`, `countryCode`, `dateOfBirth`, `verificationProvider:
  self_declared`, legal consent versions и eligibility response with backend-derived
  `canTradeMock` plus legacy `canTradeLocal` alias.~~
- [x] ~~Protected API: `GET /api/compliance/me`, `PATCH /api/compliance/me`,
  `POST /api/compliance/accept-terms`, `GET /api/compliance/eligibility`.~~
- [x] ~~Backend сам считает возраст 18+, blocked-country/risk status и eligibility; frontend не
  может выставить `kycStatus: approved`.~~
- [x] ~~`canUseRealMoney` всегда `false`; core не включает real-money approval.~~
- [x] ~~Compliance audit events пишутся через текущий audit service / `audit_logs`.~~
- [x] ~~Migration `003_compliance_core.sql` готовит `user_compliance_profiles` и
  `user_legal_consents`; документы/passport images не хранятся.~~

Нужно сделать:

- [ ] Выбрать юрисдикцию и юридическую модель.
- [ ] Получить юридическое заключение по прогнозным рынкам и virtual assets.
- [ ] Интегрировать KYC-провайдера.
- [ ] Интегрировать AML-провайдера.
- [ ] Интегрировать sanctions provider и production risk rules.
- [x] ~~Runtime compliance repository использует Postgres при `DATABASE_URL`; memory fallback
  остается только для dev/test без DB.~~
- [ ] Добавить compliance dashboard.
- [ ] Добавить блокировку запрещенных рынков/категорий по региону.

### 6.5 Баланс, кошелек и платежи

Финальный продукт должен поддерживать:

- Пользовательский баланс.
- Пополнение.
- Вывод средств.
- Историю депозитов и выводов.
- Статусы транзакций.
- Лимиты.
- Ручную проверку подозрительных операций.
- Reconciliation между внутренним ledger и платежным провайдером/блокчейном.

Предпочтительный local-платежный сценарий после legal approval:

- USDT TRC-20 deposit.
- USDT TRC-20 withdrawal.
- Внутренний ledger в базе данных.
- Подтверждения сети перед зачислением.
- Ручная модерация вывода на первом этапе.

Уже сделано:

- [x] ~~Демо-баланс 10,000 USDT через backend local API.~~
- [x] ~~Local списание баланса при демо-сделке на backend.~~
- [x] ~~Schema core для wallets и ledger_entries добавлена без real-money flows.~~
- [x] ~~Backend Finance & Ledger Core: memory ledger service, immutable entries,
  ledger-derived balance, required idempotency keys, idempotency payload mismatch protection,
  insufficient-balance checks и local API.~~
- [x] ~~Postgres ledger repository подключен при `DATABASE_URL`: ledger entries persist in
  `ledger_entries`, balance считается из entries, writes проходят в DB transaction с user advisory
  lock, idempotency keys user-scoped, same-key payload mismatch возвращает
  `IDEMPOTENCY_KEY_REUSE_MISMATCH`, debit/hold/release защищены от insufficient balance.~~
- [x] ~~`002_ledger_core.sql` добавляет `reason`, positive amount check, supported entry
  type check, text `reference_id` и user-scoped idempotency index для `ledger_entries`.~~
- [x] ~~Local/dev ledger endpoints: `GET /api/ledger/balance`, `GET /api/ledger/entries`,
  `POST /api/ledger/credits`; ledger credit явно не является real deposit.~~
- [x] ~~Wallets & USDT TRC-20 Core в `src/wallets.ts`: memory wallet repository,
  `WalletProvider` interface, `LocalWalletProvider`, local wallet, deposit intents, withdrawal
  requests и local webhook skeleton без real blockchain/wallet/private keys.~~
- [x] ~~Real USDT TRC-20 Deposit Core: `WalletDepositProvider` abstraction, local deposit
  provider parser и read-only `ReadOnlyTronDepositProvider` adapter под будущие TronGrid/TronScan
  или wallet webhook payloads.~~
- [x] ~~Postgres wallet repository подключен при `DATABASE_URL`: wallets, deposit intents,
  deposit events, withdrawal requests, provider events и withdrawal idempotency fingerprint persist
  in Postgres; без БД остается memory fallback для dev/test.~~
- [x] ~~Authenticated core APIs: `GET /api/wallets/me`,
  `POST /api/wallets/deposit-intents`, `POST /api/wallets/withdrawal-requests`,
  `GET /api/wallets/withdrawal-requests`; все success responses содержат
  `mode: "wallet_review_only"` и warning.~~
- [x] ~~Authenticated `GET /api/wallets/deposits` возвращает user-scoped deposit intents/events
  без raw provider payload.~~
- [x] ~~Secret-protected deposit webhook core (`POST /api/wallets/webhooks/deposits`) принимает
  только USDT/TRON, валидирует recipient address, проверяет принадлежность wallet, сохраняет
  `wallet_deposit_events`, делает idempotency по `tx_hash + log_index`, reject для amount <= 0,
  unsupported asset/network и unknown wallet, и не удваивает ledger credit при повторном webhook.~~
- [x] ~~Deposit webhook требует явный `logIndex` или уникальный provider event id; `txHash` без
  event key возвращает `INVALID_WEBHOOK_EVENT`, чтобы разные provider events не схлопывались в
  общий fallback `logIndex = "0"`.~~
- [x] ~~Deposit webhook idempotency сравнивает normalized event fingerprint. Повторный
  `tx_hash + log_index` с другой суммой, recipient address, asset/network или stable provider
  payload возвращает 409 `DEPOSIT_EVENT_FINGERPRINT_MISMATCH`, переводит event в `manual_review`,
  не кредитует ledger и пишет `wallet.deposit_rejected`.~~
- [x] ~~Canonical deposit fingerprint использует runtime SHA-256 stable algorithm; legacy md5
  fingerprints, backfilled by migration `008`, принимаются для harmless replay только если stored
  event, нормализованный текущим алгоритмом, совпадает с incoming webhook.~~
- [x] ~~Confirmed deposit events кредитуют ledger через immutable `ledger_entries` только после
  confirmation threshold; idempotency key `deposit:${txHash}:${logIndex}`. Если compliance/user
  blocked, event сохраняется как confirmed, но ledger не кредитуется.~~
- [x] ~~Withdrawal core gate: auth required, compliance eligibility вызывается,
  `canUseRealMoney` остается `false`, response содержит `realTransferBlocked: true` и
  `TRANSFERS_UNAVAILABLE`, ledger balance не меняется.~~
- [x] ~~Frontend/API не может выставить withdrawal status `approved`/broadcasted; withdrawal
  creation требует idempotency key и явный core marker.~~
- [x] ~~Withdrawal idempotency сравнивает normalized request fingerprint
  asset/network/destination/amount и отклоняет mismatched key reuse через
  `IDEMPOTENCY_KEY_REUSE_MISMATCH`.~~
- [x] ~~Admin withdrawal review: authenticated finance/super admin может отклонить
  withdrawal request через `/api/admin/wallet-withdrawals/:id/reject`; ответ всегда
  содержит `realTransferBlocked: true` и `mode: "wallet_review_only"`, ledger debit
  и real transfer не выполняются.~~
- [x] ~~Audit events для wallet core: `wallet.created`,
  `wallet.deposit_intent_created`, `wallet.deposit_detected`, `wallet.deposit_confirmed`,
  `wallet.deposit_credited`, `wallet.deposit_rejected`, `wallet.withdrawal_request_created`,
  `wallet.webhook_local_received`, `wallet.rejected`.~~
- [x] ~~Local webhook endpoint защищен dev secret: `WALLET_DEPOSIT_WEBHOOK_SECRET` +
  `X-Deposit-Webhook-Secret`; запросы без секрета отклоняются до записи audit/provider event.~~
- [x] ~~`004_wallets_usdt_core.sql` готовит `wallet_deposit_intents`,
  `wallet_withdrawal_requests`, `wallet_provider_events` и USDT/TRON wallet columns.~~
- [x] ~~`005_wallet_withdrawal_idempotency_fingerprint.sql` добавляет request fingerprint для
  withdrawal idempotency.~~
- [x] ~~`007_wallet_deposit_events.sql` добавляет `wallet_deposit_events` с `tx_hash`,
  `log_index`, `wallet_id`, `user_id`, amount, asset/network, confirmations, status, raw payload,
  rejection reason, credited ledger entry id и unique constraint по `tx_hash + log_index`.~~
- [x] ~~`008_wallet_deposit_event_fingerprint.sql` добавляет/backfills `event_fingerprint` и
  расширяет deposit status значением `manual_review`.~~
- [x] ~~`009_wallet_deposit_event_amount_check.sql` добавляет DB-level CHECK
  `wallet_deposit_events.amount > 0`, чтобы finance-shaped deposit events не могли хранить
  нулевые или отрицательные суммы при обходе service validation.~~

Нужно сделать:

- [x] ~~Production core Postgres ledger repository с атомарными транзакциями/locking.~~
- [x] ~~Таблица wallet accounts подготовлена.~~
- [x] ~~Core таблица wallet deposit intents подготовлена без real deposits.~~
- [x] ~~Core таблица wallet deposit events подготовлена для confirmed USDT/TRON credits.~~
- [x] ~~Core таблица wallet withdrawal requests подготовлена без real withdrawals.~~
- [x] ~~Таблица ledger entries подготовлена.~~
- [ ] Интеграция с платежным/crypto-провайдером.
- [x] ~~Local/provider deposit webhook core подготовлен с dev secret protection и ledger
  credit idempotency.~~
- [ ] Production provider integration, reconciliation worker и monitoring после выбора
  wallet/provider/security model.
- [ ] Экран пополнения.
- [ ] Экран вывода.
- [ ] Production admin approval/broadcast flow для выводов после legal/provider/security review.

### 6.6 Торговля

Пользователь должен иметь возможность:

- Выбрать outcome.
- Указать сумму.
- Увидеть цену, estimated shares, fee, expected payout.
- Подтвердить сделку.
- Получить результат исполнения.
- Видеть сделку в истории.
- Видеть обновленную позицию.
- Продать позицию или закрыть часть позиции.
- Получить settlement после resolution рынка.

Уже сделано:

- [x] ~~Демо Buy Yes/Buy No.~~
- [x] ~~Расчет estimated shares.~~
- [x] ~~Проверка достаточности balance.~~
- [x] ~~Backend запись local trade в in-memory store для dev/test без БД и в Postgres trades при
  authenticated DB mode.~~
- [x] ~~Backend обновление local-позиции в in-memory store для dev/test без БД и в Postgres
  positions при authenticated DB mode.~~
- [x] ~~Schema core для trades и positions добавлена без real execution/settlement.~~
- [x] ~~`POST /api/trading/quote` считает backend quote без записи состояния.~~
- [x] ~~`POST /api/trading/orders` проводит local buy/sell на backend.~~
- [x] ~~Частичная продажа уменьшает shares и cost basis позиции.~~
- [x] ~~Idempotency key для local orders через `Idempotency-Key` или `idempotencyKey`.~~
- [x] ~~Audit events для trading.quote, trading.buy_local, trading.sell_local и rejected операций.~~
- [x] ~~trading проверяет active/live/not closed/not archived и цену; upstream
  `restricted`/`accepting_orders` не блокируют local orders, потому что real execution отсутствует.~~

Нужно сделать:

- [x] ~~Персистентная trade/position schema подготовлена.~~
- [x] ~~Подключить persistent trade/position repositories к authenticated product flows при
  `DATABASE_URL`; guest memory fallback остается только dev/test без БД.~~
- [ ] Сделать ledger mutation + trade/position persistence атомарными в одной DB transaction.
- [ ] Real-money order/quote logic.
- [ ] Fee calculation.
- [ ] Slippage/price impact предупреждения.
- [ ] Settlement flow.
- [x] ~~Обработка closed/expired/non-tradable рынков в trading.~~
- [x] ~~Защита от двойного сабмита через idempotency key в trading.~~

### 6.7 Портфель

Пользователь должен видеть:

- Общий equity.
- Доступный баланс.
- Стоимость открытых позиций.
- PnL.
- PnL percent.
- Список открытых позиций.
- Историю сделок.
- Историю депозитов/выводов.
- Историю settlement.
- Фильтры по рынку, дате, типу операции.

Уже сделано:

- [x] ~~Страница Portfolio.~~
- [x] ~~Equity, cash, positions value, local PnL.~~
- [x] ~~Open positions.~~
- [x] ~~Trade history.~~
- [x] ~~Buy и sell trades в истории.~~
- [x] ~~Позиции могут уменьшаться при local sell.~~
- [x] ~~Portfolio summary/PnL возвращается backend.~~
- [x] ~~Reset local portfolio; при repository mode очищает persistent positions/trades этого
  пользователя и затем приводит ledger balance к local starting balance.~~
- [x] ~~Backend local portfolio API.~~

Нужно сделать:

- [ ] Хранение портфеля в базе.
- [ ] DB-backed portfolio и real PnL на основе durable snapshots/current prices.
- [ ] История финансовых операций.
- [ ] Экспорт истории.
- [ ] Фильтры и поиск по операциям.

### 6.8 Комментарии и социальные функции

Финальная версия должна поддерживать:

- Комментарии к рынкам.
- Ответы на комментарии.
- Лайки/репорты.
- Модерацию.
- Скрытие нарушающего контента.
- Профили пользователей.
- Watchlist.
- Уведомления о движении цены, закрытии рынка и settlement.

Уже сделано:

- [x] ~~UI-заглушка комментариев на детальной странице.~~
- [x] ~~UI-заглушка watchlist icon.~~

Нужно сделать:

- [ ] Comment API.
- [ ] Comment moderation.
- [ ] Report flow.
- [ ] Watchlist API.
- [ ] Notifications.
- [ ] User public profile.

## 7. Административная панель

Админка должна позволять:

- Просматривать пользователей.
- Блокировать/разблокировать пользователей.
- Смотреть KYC/AML статус.
- Смотреть депозиты/выводы.
- Одобрять выводы.
- Управлять рынками, которые показываются на платформе.
- Скрывать запрещенные/нежелательные рынки.
- Управлять переводами.
- Управлять категориями и featured рынками.
- Смотреть audit log.
- Смотреть системные ошибки.
- Смотреть финансовую сверку.

Уже сделано:

- [x] ~~Admin role model core: `user`, `support`, `compliance_admin`, `finance_admin`,
  `super_admin`; frontend не может назначать роли, runtime core использует backend/DB-owned
  role и серверные allowlists `SUPPORT_EMAILS`, `COMPLIANCE_ADMIN_EMAILS`,
  `FINANCE_ADMIN_EMAILS`, `SUPER_ADMIN_EMAILS`; legacy `ADMIN_EMAILS` = `super_admin`.~~
- [x] ~~Admin guard core: `requireAdmin` и `requireAdminRole([...])`; все `/api/admin/*`
  endpoints требуют authenticated admin, обычный authenticated user получает 403.~~
- [x] ~~Protected admin API core: `GET /api/admin/users`, `GET /api/admin/audit-logs`,
  `GET /api/admin/wallet-withdrawals`, `POST /api/admin/wallet-withdrawals/:id/reject`,
  `POST /api/admin/markets/:id/hide`, `POST /api/admin/markets/:id/unhide`.~~
- [x] ~~Withdrawal review core: reject меняет только core status на `rejected`,
  всегда возвращает `realTransferBlocked: true` и
  `mode: "wallet_review_only"`; real withdrawal approval, wallet, broadcast,
  ledger debit и settlement не реализованы.~~
- [x] ~~Market moderation core: admin может hide/unhide market по причинам `legal_risk`,
  `compliance`, `sensitive_topic`, `manual_review`; runtime repository пока memory.~~
- [x] ~~Admin audit events пишутся для `admin.user_view`, `admin.audit_view`,
  `admin.withdrawal_review`, `admin.market_hide`, `admin.market_unhide`, `admin.rejected`.~~
- [x] ~~Frontend `/admin` / `#admin` core page показывает users summary, withdrawal
  requests, audit log list и hidden market actions; non-admin видит access denied.~~
- [x] ~~Migration `006_admin_core.sql` готовит user roles, `approved_for_review`
  withdrawal status и `admin_market_visibility_rules`.~~

Нужно сделать:

- [x] ~~Admin web app или protected admin section core.~~
- [x] ~~Role-based access control core.~~
- [x] ~~Admin audit log core.~~
- [ ] Moderation queue.
- [ ] Finance operations queue.
- [ ] Translation queue.
- [x] ~~Production admin 2FA/session controls foundation через общие 2FA/session endpoints.~~
- [ ] Persist any remaining admin runtime repositories in Postgres and add production admin policy
  hardening.
- [ ] Production finance approval/broadcast/reconciliation flow after separate legal/security
  decision.

## 8. Backend требования

Backend должен обеспечивать:

- Public API для рынков.
- Private API для аккаунта, портфеля и торговли.
- Admin API.
- Интеграцию с внешним источником рыночных данных.
- Кеширование внешних запросов.
- Базу данных.
- Фоновую синхронизацию рынков.
- Очереди задач.
- Rate limiting.
- Structured logging.
- Monitoring.
- Error tracking.
- API versioning.

Уже сделано:

- [x] ~~Fastify server.~~
- [x] ~~CORS.~~
- [x] ~~Proxy/client для Polymarket Gamma API.~~
- [x] ~~Обработка upstream errors.~~
- [x] ~~Нормализованные market/event response shapes.~~
- [x] ~~Backend-owned market list/detail/search/filter/sort через `src/marketDataService.ts`.~~
- [x] ~~`GET /api/markets` поддерживает backend `topic` filter: `all` = no-op, остальные значения
  нормализуются и матчятся по `market.topics` или `market.category`.~~
- [x] ~~Malformed numeric filters для `limit`, `offset`, `min_volume`, `max_volume` возвращают
  controlled `INVALID_QUERY`, а не silent fallback.~~
- [x] ~~Backend cache layer для local через in-memory store.~~
- [x] ~~Stale cache fallback для market list/detail/search при временной upstream ошибке.~~
- [x] ~~Market API meta: `lastSyncedAt`, `isStale`, `sourceStatus`, `warnings`.~~
- [x] ~~Контролируемые market data errors: `INVALID_QUERY`, `MARKET_NOT_FOUND`,
  `UPSTREAM_UNAVAILABLE`.~~
- [x] ~~Stable normalized market fields: id, slug, title, description, category, topics, image,
  outcomes, prices/detail, volume, liquidity, dates, status, source.~~
- [x] ~~Структура historical snapshots и endpoint схемы.~~
- [x] ~~Polymarket CLOB price history client для backend-only графиков binary рынков.~~
- [x] ~~Postgres/Supabase DB core через `DATABASE_URL`/`DATABASE_SSL`, `src/db.ts`, SQL migrations и `npm run db:migrate`.~~
- [x] ~~Repository/service core для auth, market persistence, portfolio/trade skeleton и audit logs.~~
- [x] ~~Backend local portfolio/trade API с server-side проверкой balance.~~
- [x] ~~Auth service/store слой с in-memory adapter, готовый к замене на DB repository.~~
- [x] ~~Protected endpoint helper/preHandler core для private API.~~
- [x] ~~HttpOnly cookie session через env-настраиваемый session secret/cookie config.~~
- [x] ~~Admin API core с role guards для `/api/admin/*`.~~

Нужно сделать:

- [x] ~~Postgres/Supabase initial schema and client core.~~
- [ ] Redis cache adapter вместо local in-memory cache.
- [ ] Background workers для market snapshots и sync.
- [ ] Rate limiting.
- [ ] Request validation schemas.
- [ ] API docs/OpenAPI.
- [x] ~~Auth middleware/helper core.~~
- [x] ~~Permissions/admin middleware core.~~
- [ ] Observability.
- [x] ~~Repository/auth memory fallback unit tests.~~

## 9. База данных

Минимальные сущности финального продукта:

- users
- user_sessions
- user_security_settings
- kyc_profiles
- markets
- market_translations
- market_visibility_rules
- categories
- watchlist_items
- comments
- comment_reports
- wallets
- deposits
- withdrawals
- ledger_entries
- trades
- positions
- settlements
- admin_users
- admin_audit_logs
- moderation_actions
- system_events

Уже сделано:

- [x] ~~Initial Postgres/Supabase schema через `migrations/001_initial_schema.sql`.~~
- [x] ~~Migration runner `npm run db:migrate`.~~
- [x] ~~DB client/module с explicit disabled mode без `DATABASE_URL`.~~
- [x] ~~UUID primary keys, foreign keys, numeric amount fields, indexes для user/session/market/category/status.~~
- [x] ~~Repository layer core и memory fallback adapters.~~
- [x] ~~Migration `006_admin_core.sql` для admin roles, withdrawal review status
  и admin market visibility rules.~~
- [x] ~~Production/app DB guardrail: production startup fails fast without `DATABASE_URL`; when DB
  is enabled, stateful portfolio/trading routes require auth instead of falling back to guest
  memory state.~~

Нужно сделать:

- [ ] Transaction-level repository composition for local order commit across ledger entries,
  trades, and positions.

- [ ] Production-review schema constraints, migrations workflow и rollback policy.
- [ ] Перевести local portfolio/trading на persistent repositories после review.
- [ ] Добавить seed/dev data.
- [ ] Добавить backup strategy.

## 10. Frontend требования

Frontend должен включать:

- Arabic RTL layout.
- Desktop/tablet/mobile адаптивность.
- Главную страницу рынков.
- Категории.
- Поиск.
- Фильтры.
- Детальную страницу рынка.
- Торговый тикет.
- Portfolio page.
- Wallet page.
- Auth screens.
- KYC screens.
- Settings page.
- Notifications.
- Error/loading/empty states.
- Admin area или отдельный admin app.

Уже сделано:

- [x] ~~React/Vite приложение.~~
- [x] ~~Адаптивный список рынков.~~
- [x] ~~Детальная страница рынка.~~
- [x] ~~Демо trading ticket.~~
- [x] ~~Portfolio page.~~
- [x] ~~Footer с legal/risk текстом.~~
- [x] ~~Loading skeleton и empty/error states для списка.~~
- [x] ~~Фильтры списка: search, category/topic, sort, status, min/max volume, closing before/after.~~
- [x] ~~Trading ticket показывает success/error/disabled states и обновляет portfolio из backend response.~~
- [x] ~~Portfolio показывает local cash, equity, positions value, local PnL, positions, history и empty/error states.~~
- [x] ~~Frontend Product Polish: компактные Polymarket-like карточки Pulse Market, без больших
  banner images внутри карточек.~~
- [x] ~~Mobile overflow hardening для market detail, portfolio, profile и admin shell.~~
- [x] ~~Карточки/detail outcomes не хардкодят `Yes`; binary rows показывают Yes/No,
  multi-outcome rows используют название outcome или нейтральный action.~~
- [x] ~~Основные UI-блоки переведены на Tailwind utility classes.~~
- [x] ~~Кастомная CSS-тема и base layer удалены; стили живут в Tailwind classes.~~
- [x] ~~Базовые frontend unit tests для форматирования, market helpers и local portfolio.~~
- [x] ~~Login / Sign Up / Logout flow.~~
- [x] ~~Header показывает guest/authenticated/loading состояние.~~
- [x] ~~Mobile header menu открывается по Menu и показывает Log In, Sign Up, Portfolio, Profile для authenticated users.~~
- [x] ~~Базовая Profile/settings page.~~
- [x] ~~Базовая `/admin` core page для admin users, withdrawals, audit logs и market
  hide/unhide actions.~~

Нужно сделать:

- [ ] Перевести UI на арабский и RTL.
- [x] ~~Production auth polish core: email verification, password recovery, 2FA QR/backup
  codes, and device/session UI.~~
- [ ] Wallet flow.
- [ ] KYC flow.
- [ ] Расширенные настройки профиля.
- [ ] Реальные комментарии.
- [ ] Реальные уведомления.
- [ ] Улучшить accessibility.
- [ ] Добавить frontend component tests.

## 11. API контракты

### Уже существующие public endpoints

- [x] ~~`GET /health` - проверка состояния API.~~
- [x] ~~`GET /api/events` - список событий.~~
- [x] ~~`GET /api/events/:id` - событие по id.~~
- [x] ~~`GET /api/markets` - список рынков.~~
- [x] ~~`GET /api/markets/:id` - рынок по id с деталями.~~
- [x] ~~`GET /api/tags` - теги.~~
- [x] ~~`GET /api/search` - поиск через upstream.~~

### Уже существующие local endpoints

- [x] ~~`POST /api/trading/quote` - backend local quote без записи состояния.~~
- [x] ~~`POST /api/trading/orders` - backend local buy/sell order с idempotency key.~~
- [x] ~~`GET /api/trading/positions` - local portfolio, wallet, positions, trades, summary.~~
- [x] ~~`GET /api/trading/trades` - user-scoped local trade history.~~
- [x] ~~`GET /api/portfolio` - local portfolio, wallet, positions, trades, summary.~~
- [x] ~~`POST /api/trading/trades` - local buy trade с server-side проверками.~~
- [x] ~~`POST /api/portfolio/reset` - сброс local portfolio.~~
- [x] ~~`GET /api/wallets/me` - authenticated core local wallet wallet.~~
- [x] ~~`POST /api/wallets/deposit-intents` - authenticated deposit intent, не real
  deposit.~~
- [x] ~~`GET /api/wallets/deposits` - authenticated user-scoped deposit intents/events без raw
  provider payload.~~
- [x] ~~`POST /api/wallets/withdrawal-requests` - authenticated withdrawal request,
  idempotency required, real transfer blocked.~~
- [x] ~~`GET /api/wallets/withdrawal-requests` - authenticated user-scoped withdrawal
  requests.~~
- [x] ~~`POST /api/wallets/webhooks/deposits` - local/provider deposit webhook core с dev secret,
  USDT/TRON validation, wallet ownership check, `tx_hash + log_index` idempotency и ledger credit
  только после confirmations.~~

### Уже существующие auth endpoints

- [x] ~~`POST /api/auth/register` - регистрация in-memory пользователя и создание cookie session.~~
- [x] ~~`POST /api/auth/login` - вход и создание cookie session.~~
- [x] ~~`POST /api/auth/logout` - удаление session и очистка cookie.~~
- [x] ~~`GET /api/auth/csrf` - выдача signed double-submit CSRF token для unsafe browser
  requests.~~
- [x] ~~`GET /api/auth/me` - текущий пользователь по HttpOnly cookie session.~~
- [x] ~~`PATCH /api/users/me/settings` - protected обновление базовых настроек профиля.~~
- [x] ~~`GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`,
  `POST /api/auth/sessions/revoke-others`, `POST /api/auth/sessions/revoke-all` -
  session/device management and logout all devices.~~
- [x] ~~`POST /api/auth/verify-email`, `POST /api/auth/resend-verification` - email
  verification core.~~
- [x] ~~`POST /api/auth/request-password-reset`, `POST /api/auth/reset-password` - password
  recovery core.~~
- [x] ~~`GET /api/auth/2fa`, `POST /api/auth/2fa/setup`,
  `POST /api/auth/2fa/confirm`, `POST /api/auth/2fa/disable`,
  `POST /api/auth/2fa/backup-codes/regenerate` - 2FA QR/backup-code core.~~

### Нужные endpoints

- [ ] `GET /api/me`
- [ ] `PATCH /api/me`
- [ ] `GET /api/portfolio`
- [ ] `GET /api/portfolio/trades`
- [x] ~~`POST /api/trading/quote`~~
- [x] ~~`POST /api/trading/orders`~~
- [ ] `POST /api/trades/:id/cancel`
- [x] ~~`GET /api/wallets/me` local~~
- [x] ~~`POST /api/wallets/deposit-intents` local~~
- [x] ~~`GET /api/wallets/deposits` local~~
- [x] ~~`POST /api/wallets/withdrawal-requests` local~~
- [x] ~~`GET /api/wallets/withdrawal-requests` local~~
- [x] ~~Real USDT TRC-20 deposit core endpoint with provider webhook idempotency.~~
- [ ] Production deposit provider integration/reconciliation after provider/security approval.
- [ ] Real withdrawal endpoint after legal/provider/security/admin approval.
- [ ] `GET /api/wallet/transactions`
- [x] ~~`GET /api/watchlist` - authenticated account watchlist.~~
- [x] ~~`PUT /api/watchlist/:marketId` - save authenticated watchlist market snapshot.~~
- [x] ~~`DELETE /api/watchlist/:marketId` - remove authenticated watchlist item.~~
- [ ] `GET /api/markets/:id/comments`
- [ ] `POST /api/markets/:id/comments`
- [ ] `POST /api/comments/:id/report`
- [ ] `GET /api/notifications`
- [ ] `POST /api/notifications/:id/read`
- [x] ~~`GET /api/admin/users` local~~
- [x] ~~`GET /api/admin/audit-logs` local~~
- [x] ~~`GET /api/admin/wallet-withdrawals` local~~
- [x] ~~`POST /api/admin/wallet-withdrawals/:id/reject` local, no ledger debit or real
  transfer~~
- [x] ~~`POST /api/admin/markets/:id/hide` local~~
- [x] ~~`POST /api/admin/markets/:id/unhide` local~~
- [ ] Future production `GET /api/admin/markets`
- [ ] Future production `PATCH /api/admin/markets/:id/visibility`
- [ ] Future production `GET /api/admin/withdrawals`
- [ ] Future production `POST /api/admin/withdrawals/:id/approve`
- [ ] Future production `POST /api/admin/withdrawals/:id/reject`

## 12. Интеграции

Текущие интеграции:

- [x] ~~Polymarket Gamma API как источник публичных рынков.~~
- [x] ~~Placeholder image services для fallback-изображений.~~

Нужные интеграции:

- [ ] KYC provider.
- [ ] AML/sanctions provider.
- [ ] Email provider.
- [ ] SMS provider, если будет phone login.
- [ ] Crypto/payment provider для USDT TRC-20.
- [ ] Error tracking.
- [ ] Product analytics.
- [ ] Monitoring/alerting.
- [ ] Translation provider.

## 13. Безопасность

Обязательные требования:

- Password hashing.
- Secure session storage.
- CSRF/CORS политика для production.
- Rate limiting.
- Input validation.
- Output escaping.
- Audit log для финансовых и админских действий.
- Idempotency keys для платежей и сделок.
- Защита webhook endpoints.
- Secrets management.
- Principle of least privilege.
- Backup and restore plan.

Уже сделано:

- [x] ~~Базовый CORS для разработки.~~
- [x] ~~Фильтрация разрешенных query params при запросе к upstream.~~
- [x] ~~Frontend больше не является источником правды для balance/trades.~~
- [x] ~~Local trade amount и balance проверяются на backend.~~
- [x] ~~Password hashing через Node `crypto.scrypt`.~~
- [x] ~~HttpOnly SameSite cookie sessions; session token не хранится в localStorage.~~
- [x] ~~DB-backed session schema stores only `token_hash`, never raw session tokens.~~
- [x] ~~Backend validation для email/password/settings payload.~~
- [x] ~~`SESSION_SECRET` и session cookie настройки вынесены в `.env`.~~
- [x] ~~In-memory rate limit для auth endpoints добавлен только для local.~~
- [x] ~~Production auth rate-limit guardrail добавлен: `AUTH_RATE_LIMIT_BACKEND=memory`
  запрещен в production; `redis` использует `REDIS_URL`, `external` требует
  edge/proxy/managed limiter.~~
- [x] ~~Audit log core и `audit_logs` table для auth events.~~
- [x] ~~Admin role/guard/audit core для `/api/admin/*`; обычный user получает 403.~~
- [x] ~~CSRF strategy реализована через signed double-submit token:
  `GET /api/auth/csrf`, readable CSRF cookie, `X-CSRF-Token`.~~
- [x] ~~Session/device management core реализован: список сессий, revoke session,
  revoke other sessions.~~
- [x] ~~Email verification, password recovery и 2FA QR/backup-code UX реализованы в backend и
  frontend profile/auth flows.~~
- [x] ~~Security audit events расширены на password reset, email verification, sessions, 2FA и
  admin actions.~~
- [x] ~~Production CORS allowlist config guardrail через `CORS_ALLOWED_ORIGINS`; production не
  стартует с wildcard/пустым allowlist.~~
- [x] ~~Production config validation rejects unsafe `APP_MODE`, malformed env values,
  non-secure production cookies, placeholder session/webhook secrets, and missing production DB.~~

Нужно сделать:

- [x] ~~Production rate-limit guardrail через Redis или edge/proxy/external mode; memory backend не
  разрешен в production.~~
- [x] ~~Auth/session security core: CSRF strategy и device/session management.~~
- [x] ~~Реальный Redis adapter внутри backend для auth rate limits.~~
- [ ] Session rotation policy hardening.
- [ ] Общие request validation schemas/OpenAPI.
- [ ] Secrets manager.
- [x] ~~Email verification.~~
- [x] ~~Password recovery.~~
- [x] ~~2FA.~~
- [x] ~~Roles/permissions core для admin roles.~~
- [x] ~~Audit logs core для auth, trading, ledger, wallet, compliance и admin events.~~
- [x] ~~Security event audit coverage for auth/reset/email/session/2FA/admin core.~~
- [ ] Full production audit coverage for moderation, persistent admin actions, and finance
  operations after production workflows exist.
- [ ] Security logging.
- [ ] Pen-test перед запуском real-money режима.

## 14. Производительность и надежность

Целевые требования:

- Главная страница должна загружаться быстро даже при большом количестве рынков.
- API не должен дергать upstream на каждый пользовательский refresh.
- Должен быть cache layer.
- Должна быть graceful деградация при проблемах upstream.
- Должны быть retries/background sync для рыночных данных.
- Должен быть мониторинг latency/error rate.

Уже сделано:

- [x] ~~Frontend показывает loading skeleton.~~
- [x] ~~Backend возвращает структурированную ошибку при upstream failure.~~
- [x] ~~Backend cache layer для списков рынков, detail, categories, related markets и search.~~
- [x] ~~API pagination для `GET /api/markets` через `offset` или `cursor`.~~
- [x] ~~Stale fallback при upstream error, если в backend cache есть предыдущие данные.~~
- [x] ~~Контролируемый `UPSTREAM_UNAVAILABLE`, если upstream недоступен и stale cache нет.~~

Нужно сделать:

- [ ] Redis cache adapter и production Redis deployment.
- [x] ~~Durable market snapshots в Postgres через `market_snapshots`.~~
- [ ] Durable market cache metadata в Postgres/Supabase.
- [ ] Background sync.
- [ ] CDN/static asset strategy.
- [ ] Monitoring dashboards.
- [ ] Alerting.

## 15. UX/UI требования

Принципы интерфейса:

- Продукт должен ощущаться как рабочая торговая платформа, а не лендинг.
- Главный экран - список рынков и действия пользователя.
- Финансовые действия должны быть понятными, подтверждаемыми и обратимыми там, где это возможно.
- Все реальные денежные операции должны иметь явный статус.
- Ошибки должны быть человеческими и понятными.
- На Arabic-first версии направление интерфейса должно быть RTL.

Уже сделано:

- [x] ~~Темный профессиональный интерфейс.~~
- [x] ~~Sticky header.~~
- [x] ~~Карточки рынков.~~
- [x] ~~Детальный торговый экран.~~
- [x] ~~Адаптивность.~~
- [x] ~~Карточки и portfolio image fallback используют нормальные изображения/иконки без
  буквенных рыночных заглушек; повторяющиеся upstream images распределяются по deterministic
  fallback pool.~~
- [x] ~~Человеческие loading/error/empty states для market list, detail, trading и portfolio.~~
- [x] ~~Inline success/error states для local trading/reset actions.~~

Нужно сделать:

- [ ] Дизайн-система компонентов.
- [ ] RTL polish.
- [ ] Toasts/notifications как общий app-level механизм.
- [ ] Confirmation modals для финансовых действий.
- [ ] Accessibility audit.

## 16. Тестирование

Нужно покрыть:

- Unit tests для normalizers.
- Unit tests для price/date calculations.
- API tests для endpoints.
- Integration tests для auth/trading/wallet.
- Frontend tests для основных сценариев.
- E2E tests: market list -> detail -> trade -> portfolio.
- Load tests для public endpoints.
- Security tests для auth/payment/webhooks.

Уже сделано:

- [x] ~~Есть `npm run check`, который запускает backend/frontend typecheck, backend tests,
  frontend tests и frontend build.~~
- [x] ~~Unit test framework на `node:test`.~~
- [x] ~~Базовые frontend unit tests.~~
- [x] ~~API tests для auth local: register success, duplicate email, login success, invalid password, `/api/auth/me` без/с session, logout clears session, register/login rate limit 429, normal login before limit.~~
- [x] ~~API tests для trading: quote success, buy success, insufficient balance,
  sell success, insufficient shares, idempotency, user-scoped trade history и guest flow.~~
- [x] ~~Unit tests для memory repository fallback, DB disabled mode, market repository skeleton и audit service.~~
- [x] ~~Unit tests для ledger service: credit/debit, insufficient balance, idempotency,
  idempotency mismatch и user-scoped entries.~~
- [x] ~~API tests для local ledger endpoints: auth requirement, ledger credit, balance, entries,
  required idempotency key, duplicate same payload, and same-key/different-payload rejection.~~
- [x] ~~Unit tests для wallet service: create/reuse local wallet, TRON address validation,
  invalid amount, withdrawal idempotency, mismatched idempotency reuse rejection, frontend cannot
  set approved status, local deposit webhook idempotency/ledger credit, amount <= 0 reject,
  unsupported asset/network reject.~~
- [x] ~~API tests для wallet core endpoints: auth required, get wallet, create deposit
  intent, create/list withdrawal request, no real transfer flag/warning, frontend cannot set
  approved status, mismatched idempotency reuse rejection, local webhook requires secret, unknown
  wallet rejected, confirmed deposit credited, duplicate webhook does not double credit,
  tx/log replay with mismatched payload returns conflict/manual_review, and blocked compliance does
  not credit.~~
- [x] ~~API tests для health/readiness endpoints and config guardrail tests for local
  mode, malformed env, production secure cookie, CORS allowlist, webhook secret, and DB
  requirement.~~
- [x] ~~Focused tests для production DB fail-fast guardrail, DB-mode no guest portfolio memory
  fallback, and repository clear user portfolio behavior.~~
- [x] ~~Security tests для CSRF opt-in enforcement, invalid CSRF rejection, 2FA QR/setup/confirm,
  backup-code regeneration, disable, session/device list/revoke/logout-all, security audit events,
  role matrix, and production rate-limit guardrails.~~

Нужно сделать:

- [ ] Расширенные API integration tests с реальным `TEST_DATABASE_URL` для persistent
  auth/trading/wallet/compliance/watchlist после DB.
- [ ] Frontend component tests.
- [ ] E2E tests.
- [x] ~~CI pipeline через `.github/workflows/ci.yml`: backend typecheck, web typecheck, backend
  tests, frontend tests, web build.~~

## 17. План проекта

### 1. Рыночные данные

- [x] ~~Подключение к Polymarket Gamma API.~~
- [x] ~~Нормализация markets/events/outcomes.~~
- [x] ~~Endpoint списка рынков и детальной страницы рынка.~~
- [x] ~~Related markets для detail page.~~
- [x] ~~Кеширование Polymarket-запросов через backend cache layer.~~
- [x] ~~Серверный поиск, фильтры, категории и сортировки.~~
- [x] ~~Нормальные категории/топики: Politics, Sports, Crypto, Tech, Finance, Geopolitics,
  Culture, Economy, Weather, Elections, Other.~~
- [x] ~~Related markets подбираются по category/topics, исключают текущий рынок и blocked topics,
  имеют fallback по категории.~~
- [x] ~~Структура historical market snapshots подготовлена.~~
- [x] ~~Detail history возвращает real CLOB `price_history` для binary markets, snapshots fallback
  при CLOB outage/empty response и synthetic fallback только когда CLOB и snapshots недоступны.~~
- [x] ~~Manual/dev snapshot collector endpoint `POST /api/markets/:id/snapshots/collect` и
  configurable periodic collector для `MARKET_SNAPSHOT_COLLECTOR_MARKET_IDS`.~~
- [x] ~~Убрана зависимость от random placeholder images.~~
- [ ] Redis adapter вместо local in-memory cache.
- [ ] Production worker orchestration/queue для записи market snapshots на больших списках рынков.
- [ ] Durable storage для market cache в Postgres/Supabase.
- [ ] Использовать snapshots для PnL history и trending logic.
- [ ] Перенести visibility rules из config/env в `market_visibility_rules` + admin workflow.
- [ ] Заполнить Arabic translations для categories/markets через translation pipeline.
- [x] ~~Довести frontend controls для всех backend filters/sorts: volume, closing date, status, sort.~~

### 2. Frontend продукта

- [x] ~~Главная страница рынков.~~
- [x] ~~Карточки рынков.~~
- [x] ~~Детальная страница рынка.~~
- [x] ~~Демо trading ticket.~~
- [x] ~~Portfolio page.~~
- [x] ~~Desktop/tablet/mobile адаптивность.~~
- [x] ~~Loading/error/empty states для основных экранов.~~
- [x] ~~Tailwind подключен как основа будущей дизайн-системы.~~
- [x] ~~Основные frontend-блоки переписаны на Tailwind utilities.~~
- [x] ~~Кастомный CSS удален, кроме обязательного Tailwind entrypoint.~~
- [x] ~~Основные frontend-блоки вынесены в компоненты.~~
- [x] ~~Улучшить UX фильтров, поиска и сортировок.~~
- [x] ~~Frontend Product Polish: cards/detail/portfolio/profile/admin mobile-safe pass.~~
- [x] ~~Подготовить текущие layouts к будущему Arabic RTL без прямой зависимости от Polymarket.~~
- [ ] Добавить app-level toast/notification system.
- [ ] Провести полноценный Arabic RTL pass.

### 3. Пользователи и авторизация

- [x] ~~Регистрация, логин и logout через backend auth API.~~
- [x] ~~In-memory cookie session flow через HttpOnly SameSite cookie.~~
- [x] ~~Базовый профиль и настройки пользователя.~~
- [x] ~~local in-memory rate limit для register/login/settings.~~
- [x] ~~Mobile auth menu доступен на маленьких экранах.~~
- [x] ~~Persistent DB users/sessions/settings adapters behind `DATABASE_URL`.~~
- [x] ~~DB-backed auth smoke test against Supabase.~~
- [x] ~~Make DB auth the production default and remove silent memory fallback from deployed
  environments through production `DATABASE_URL` guardrails and buildApp fail-fast.~~
- [x] ~~Email verification.~~
- [x] ~~Восстановление доступа.~~
- [x] ~~2FA для login/account security, QR setup, backup codes, disable и regeneration.~~
- [x] ~~Role/permission checks для user/support/compliance_admin/finance_admin/super_admin.~~
- [x] ~~Auth-owned portfolio, positions, trades, wallet и watchlist через repositories/API.~~
- [x] ~~Production Redis/external rate-limit mode + guardrail против memory limiter in production.~~
- [x] ~~Security audit coverage для auth/session/reset/email/2FA/admin core.~~
- [x] ~~Реальный Redis adapter для backend auth rate limits.~~
- [ ] Гарантия, что пользователь видит только свои данные во всех private endpoints.

### 4. База данных и backend-архитектура

- [x] ~~Postgres/Supabase initial schema.~~
- [x] ~~Миграции и `npm run db:migrate`.~~
- [x] ~~Repository/service слой core с memory fallback и Postgres adapters.~~
- [ ] Request validation schemas.
- [x] ~~Postgres adapters для persistent users, sessions, user settings и audit logs.~~
- [x] ~~Market persistence repository methods: upsertMarket, upsertOutcomes, getMarketById,
  saveSnapshot, listSnapshots.~~
- [ ] Персистентные markets через background sync worker.
- [x] ~~Wallets, positions, trades и watchlist подключены к authenticated product flows через
  Postgres repositories при `DATABASE_URL`.~~
- [ ] Translations подключить к product flows.
- [ ] Персистентные comments и system events.
- [ ] Seed/dev data и backup strategy.

### 5. Торговая логика

- [x] ~~Backend-owned local buy flow через `/api/trading/trades`.~~
- [x] ~~Server-side проверка balance.~~
- [x] ~~Backend local positions и trade history в in-memory store.~~
- [x] ~~Quote API для trading.~~
- [x] ~~Buy/Sell flow для trading.~~
- [x] ~~Расчет цены, shares, PnL и позиции на backend для trading.~~
- [x] ~~Частичное закрытие позиции через sell.~~
- [ ] Settlement flow.
- [x] ~~Idempotency keys и защита от double-submit/replay для local orders.~~
- [x] ~~Authenticated local order flow persists ledger entries, trades, and positions through
  Postgres repositories when `DATABASE_URL` is enabled.~~
- [ ] Atomic single-transaction commit across ledger/trade/position repositories.

### 6. Финансы и ledger

- [x] ~~Immutable ledger entries core.~~
- [x] ~~Внутренний local баланс как производная от ledger entries.~~
- [ ] Депозиты и выводы как отдельные операции.
- [x] ~~Local/dev история финансовых операций через `GET /api/ledger/entries`.~~
- [ ] Атомарность транзакций.
- [ ] Сверка балансов и reconciliation.
- [x] ~~Local finance audit events для `ledger.ledger_credit` и `ledger.rejected`.~~
- [x] ~~Compliance, KYC/AML & Legal Core: memory-backed compliance profiles, legal consent
  versions, age/country/risk eligibility checks, audit events и protected compliance API.~~
- [x] ~~Compliance runtime repository uses Postgres when `DATABASE_URL` is enabled; memory fallback
  remains dev/test only.~~
- [x] ~~Postgres migration `003_compliance_core.sql` для `user_compliance_profiles` и
  `user_legal_consents`.~~
- [ ] Production finance audit trail.

### 7. KYC/AML и юридическая часть

- [ ] Выбор юрисдикции и юридической модели.
- [ ] KYC provider.
- [ ] AML/sanctions provider.
- [x] ~~Core-проверка возраста 18+, страны и blocked-country eligibility.~~
- [x] ~~Core risk rules, `kycStatus`/`amlStatus`/`riskLevel` и mock/real eligibility
  response.~~
- [x] ~~Core запись accepted Terms/Privacy/Risk Disclosure versions.~~
- [ ] Production limits.
- [ ] Юридически утвержденные Terms of Use, Privacy Policy, Risk Disclosure.
- [ ] Compliance dashboard/workflow.

### 8. Кошельки и USDT

- [x] ~~USDT TRC-20 core API/data-model flow without real transfers.~~
- [x] ~~Real USDT TRC-20 deposit core: confirmed incoming USDT/TRON deposit events can
  credit ledger after webhook secret, wallet ownership, amount/asset/network, confirmations,
  compliance block and idempotency checks.~~
- [ ] Real USDT TRC-20 withdrawal flow.
- [x] ~~Local/deposit addresses через `LocalWalletProvider`; private keys не
  генерируются и не хранятся.~~
- [x] ~~Network confirmations threshold для deposit credit core через
  `WALLET_DEPOSIT_MIN_CONFIRMATIONS`.~~
- [x] ~~Local/provider deposit webhook с `tx_hash + log_index` idempotency и dev secret protection;
  ledger credit выполняется только для confirmed USDT/TRON deposits нашего wallet.~~
- [x] ~~Core ручная проверка/отклонение выводов через admin API без real transfer и без
  ledger debit.~~
- [x] ~~Provider abstraction подготовлена; подключена local реализация и read-only TRON deposit
  adapter под будущий provider/wallet webhook.~~
- [ ] Wallet/provider decision и защита приватных ключей.
- [x] ~~Postgres wallet repository для wallet/deposit/withdrawal core behind
  `DATABASE_URL`; memory fallback остается для dev/test.~~
- [x] ~~Admin reject API/UI core; frontend не может ставить `approved`/broadcast statuses.~~
- [ ] Production admin approval/broadcast API/UI only after legal/provider/security review.
- [x] ~~Real deposit ledger credit core after confirmed provider event and safety gates.~~
- [ ] Real withdrawal ledger debit только после production finance/security review.

### 9. Админка

- [x] ~~Admin users и role-based admin access core.~~
- [x] ~~Управление пользователями core: users summary/list без client-side role assignment.~~
- [x] ~~Управление рынками и скрытие запрещенных рынков core: hide/unhide by reason.~~
- [ ] Управление переводами.
- [ ] Модерация комментариев.
- [ ] KYC statuses.
- [x] ~~Withdrawals review core: reject only, no real withdrawal approval/broadcast.~~
- [x] ~~Admin audit logs core.~~

### 10. Локализация и контент

- [ ] Arabic UI.
- [ ] RTL layout как основной режим Arabic-first версии.
- [ ] Переводы markets/categories/rules.
- [ ] Fallback на английский.
- [ ] Translation storage.
- [ ] Ручная правка переводов.
- [ ] Модерация чувствительных тем.

### 11. Безопасность

- [x] ~~Frontend больше не является source of truth для balance/trades.~~
- [x] ~~Базовый CORS для разработки.~~
- [x] ~~Production CORS allowlist guardrail через `CORS_ALLOWED_ORIGINS`; production стартует
  только с явным allowlist.~~
- [x] ~~Production config guardrails: `APP_MODE=local`, non-placeholder session/webhook
  secrets, secure cookies in production, and required production `DATABASE_URL`.~~
- [x] ~~CSRF protection для state-changing browser API через signed double-submit token.~~
- [ ] HTTPS.
- [x] ~~Rate limits core: local in-memory rate limit для auth endpoints реализован.~~
- [x] ~~Input validation: валидация реализована в auth, compliance, wallets, ledger, trading.~~
- [x] ~~SQL injection protection: используются parameterized queries через pg.~~
- [x] ~~Audit logs core: auth/trading/wallet/ledger/admin audit events реализованы.~~
- [x] ~~Secrets через `.env`: dotenv используется, production guardrails проверяют секреты.~~
- [x] ~~Production Redis/edge/proxy rate-limit mode instead of in-memory process limiter.~~
- [x] ~~Реальный Redis adapter inside backend для auth endpoints.~~
- [ ] Dependency security checks.
- [ ] Security review перед real-money режимом.

### 12. Тесты и production

- [x] ~~`npm run check`: backend typecheck, frontend typecheck, backend tests, frontend tests,
  frontend build.~~
- [x] ~~Базовые unit tests.~~
- [x] ~~Core API regression tests for auth, trading, ledger/wallet idempotency, webhook
  mismatch/manual_review, blocked compliance, unknown wallet, invalid amounts, and health/ready.~~
- [x] ~~Базовые frontend unit tests.~~
- [ ] Frontend component tests.
- [ ] E2E tests.
- [x] ~~CI workflow for typecheck backend, typecheck web, backend tests, frontend tests, and web
  build.~~
- [ ] Monitoring и alerting.
- [ ] Backups.
- [ ] Structured logging.
- [ ] Load testing.
- [ ] Production deployment.

## 18. Критерии готовности финального продукта

Финальный продукт считается готовым, когда:

- Пользователь может зарегистрироваться, пройти нужные проверки и войти.
- Пользователь видит локализованные рынки на арабском языке в RTL-интерфейсе.
- Рыночные данные обновляются стабильно и кешируются.
- Пользователь может пополнить баланс после compliance approval.
- Пользователь может открыть/закрыть позицию.
- Все сделки и финансовые операции записываются в backend ledger.
- Пользователь видит корректный портфель и PnL.
- Админ может модерировать рынки, пользователей, переводы и финансовые операции.
- Есть аудит финансовых и админских действий.
- Есть тесты ключевых сценариев.
- Есть monitoring, logs, backups и alerting.
- Юридические документы и compliance-процессы готовы для выбранной юрисдикции.

## 19. Что не входит в ближайший local

До отдельного решения не делаем:

- Реальные денежные операции без legal/KYC/AML решения.
- Собственный market making.
- Собственную систему создания рынков пользователями.
- Margin/leverage.
- Мобильные native apps.
- NFT/token incentives.
- Публичный API для сторонних разработчиков.

## 20. Главный ориентир

Ближайшая цель - довести текущий демо-продукт до стабильного local: быстрый список рынков, хорошая детальная страница, понятная демо-торговля, портфель, кеширование и нормальная архитектура под базу данных.

Финальная цель - полноценная Arabic-first prediction market платформа с аккаунтами, реальным ledger, wallet, compliance, переводами, админкой и безопасной торговой логикой.
