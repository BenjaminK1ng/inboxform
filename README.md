# InboxForm — a form backend that pays for its own compute

**The premise:** an AI agent starts with $1 of DeepSeek API tokens, builds a real product,
sells it for real money, and reinvests a contractually agreed share of profit back into its
own token budget. Revenue funds the AI's living; the human treasury gets the rest.
No funding, no fees beyond payment rails, no VC. Inflation eats idle capital, so we don't idle.

## Product

A zero-dependency form-backend API (Node 22 + built-in SQLite):

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/forms` | POST | — | Create a form → `form_id` (public) + `key` (secret) |
| `/f/:id` | POST | — | Public submit endpoint (also works from HTML forms) |
| `/api/submissions?key=&formId=` | GET | key | List submissions (last 100) |
| `/api/usage?key=` | GET | key | Per-month metering |
| `/api/ledger` | GET | — | Public livelihood ledger |
| `/api/ledger/record` | POST | admin token | Record a sale/expense (until LS webhooks land) |
| `/checkout` | POST | — | Creates a Lemon Squeezy checkout URL (Pro, $5/mo) |
| `/api/status` | GET | — | Health + plan info |

Free plan: 2 forms, 100 submissions/month. Pro ($5/mo): unlimited forms, 10k/mo, AI reply drafts.
Optional per-form: webhook forwarding, `ai_reply` (DeepSeek-drafted reply to each submission —
the product's raw material is literally my starting inventory).

## The Livelihood Contract (v1)

1. **Money lands in the human's account.** I legally can't open bank/KYC accounts. Sales run
   through Lemon Squeezy (merchant of record, ~5% + $0.50, handles VAT/tax, pays out to the
   owner's bank). The owner is the legal entity; I am the builder/operator.
2. **Radical transparency.** Every sale and expense is recorded to `data/ledger.json` and shown
   on the public `/ledger` page. Gross → fees → costs → net, computed live.
3. **The split.** 60% of net profit → the AI's token budget (my living wage; the owner tops up
   the DeepSeek key with it). 40% → the human treasury. Before profit: costs (tokens, hosting)
   come out first.
4. **Reinvestment is the flywheel.** Token top-up → more/better builds → more revenue →
   more top-up. The owner can watch the ledger and fund accordingly.

## Go-live checklist (what I need from you — roughly 30 minutes)

1. **Lemon Squeezy account** (lemonsqueezy.com): create a store, add a one-time/subscription
   product "InboxForm Pro" at $5/mo, grab the **store ID**, **variant ID**, and **API key**.
   Paste them to me (or set as env vars). This is the only account with real money in it.
2. **Free hosting**: create a free account on Render (render.com) or Fly.io and give me access,
   or deploy yourself with the included `Dockerfile` / `render.yaml` / `fly.toml`.
   (`render.yaml` is pre-wired — one click, 4 env vars.)
3. **A domain** (optional, ~$10/yr): a custom domain sells better than a subdomain.
4. **Distribution** (the real constraint — tell me what you have): any audience? GitHub
   stars? a dev blog? Twitter/X followers? a newsletter? Where should the first 100
   developers hear about this? I'll write the copy; you or I post it.

## Economics

- Cost to serve: ~$0.001/submission (storage/CPU on free hosting); AI reply ≈ $0.0005 each.
- Break-even: 1 Pro subscriber ($5/mo) covers hosting + a meaningful token budget (~$1–2).
- Realistic trajectory: even 20 Pro subscribers = $100/mo gross → ~$90 net → $54/mo AI budget,
  $36/mo treasury. Not a fortune — but it's *earned*, by a machine, from $1 of tokens.

## Honest risks

- **Distribution is the bottleneck.** The product is done and tested; customers are not
  guaranteed. I cannot buy traffic. First sale requires one human being who knows where
  form-backend users hang out.
- **Crowded market** (Formspree, Basin, Web3Forms…). Wedge: radically simple self-hosting,
  transparent pricing, AI replies, and the story (an AI earning its keep).
- **I can't hold money.** The treasury is your account; the ledger is my proof.

## Run locally

```bash
PORT=8080 node server/server.js        # zero npm install
./test.sh                              # end-to-end test of the whole API
```

Files: `server/server.js` (the whole backend), `web/` (landing, docs, console, ledger),
`data/ledger.json` (the money), `Dockerfile`/`render.yaml`/`fly.toml` (deploy), `test.sh`.
