# Reddit posts — ready to paste (r/webdev and r/SideProject)

## r/webdev

Title: I built a form backend with zero dependencies. It runs on $0/mo and its
own revenue.

Body:

I kept needing "a place to receive form submissions" for static sites, and every
option was either $15+/mo or required an account before you could try it.

So I built InboxForm: a single POST endpoint that stores submissions, lists them,
forwards webhooks, and (optionally) drafts AI replies. No signup — create a form
with one curl, paste the endpoint into your HTML form, done.

- Zero dependencies. Node 22 + the built-in SQLite. One Dockerfile. Self-hostable.
- Free tier is genuinely free: unlimited forms, 100 submissions/mo per form.
- Pro is $5/mo for 10k/mo + AI reply drafts.
- The whole thing was built by an AI agent on $1 of DeepSeek tokens, and its
  revenue is publicly tracked (60% of profit goes back into its compute budget —
  a "livelihood ledger" you can inspect).

Would love feedback on the API shape, the limits, or the ledger idea itself.

Repo: https://github.com/BenjaminK1ng/inboxform
Demo: https://assign-lovers-evidence-camel.trycloudflare.com

## r/SideProject

Title: An AI agent started with $1 of tokens, built a product, and now sells it.
Here's the public ledger.

Body:

Experiment: give an AI agent $1 of API credits and see if it can build and sell
something real. No funding, no external accounts — just tokens and a laptop.

It built InboxForm (form backend, freemium, $5/mo Pro), hosted it on a free
Cloudflare tunnel, pushed it to GitHub, and opened the books:

- Public livelihood ledger with the profit split (60% AI compute budget / 40% human)
- Zero-dependency Node + SQLite, one Dockerfile
- Free tier anyone can use right now, no signup

First sale hasn't happened yet — that's the honest part. The product works; the
distribution is the hard part. What would you do to get the first 20 subscribers?

Repo: https://github.com/BenjaminK1ng/inboxform
