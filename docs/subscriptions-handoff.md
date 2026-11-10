# Subscriptions implementation handoff

The subscription feature is implemented on local `feat/subscriptions` branches in the host and creator repositories. No production deployment or live payment operation was performed.

## Compatible revisions

| Repository | Feature implementation revision | Branch |
| --- | --- | --- |
| CareerSim host | `fe81427f11820ae0b9a62eea5447743a2e2a1bcf` | `feat/subscriptions` |
| CareerSim Studio creator | `7f59a1067f3b2d97a013cbe1a758667e22996fc2` | `feat/subscriptions` |

The creator's overlay CI pins the host implementation revision above. Host extension API v2 and the creator changes must ship together. For remote plugin builds set `CAREERSIM_PLUGIN_REF` to the creator revision after it is published; local development can use `CAREERSIM_PLUGIN_DIR` pointing to that source checkout.

## Implemented behavior

- Free retains configured allowances. Plus is $9/month or $90/year upfront; Supporter is $100/month or $1,000/year upfront. Annual plans advertise two months free and clearly disclose yearly renewal.
- Both paid tiers receive 100 sessions and 3,000 text messages per configured six-hour windows, 250 saved custom simulations, 250 saved custom personas, and 720 voice minutes per UTC day. Pricing renders the effective configuration, including changed window lengths.
- Pricing and account screens include guidance and support from the development team, direct developer chat, and helping decide the project's future together for Supporter. Higher-limit contact works for individuals without requiring a company name.
- Verified paid orders, signed webhooks, authoritative reconciliation, duplicate checkout protection, bounded access/grace, cancellation/refund/dispute handling, and customer payment management are implemented. Closing new purchases preserves existing access and payment management.
- Text/session quotas use atomic admission and shared counters. Creator inventory creation is serialized per owner; downgrades preserve saved work. Voice has call identity, deduplicated checkpoints, daily accounting, bounded failure cutoff, and durable ordering for rapid replacement calls.
- A quota-store outage makes usage metrics unavailable while retaining verified billing management. Entitlement database failures remain errors. Five Redis concurrency tests are configured for CI and require an isolated Redis service.

## Final local verification, 2026-11-11

| Check | Observed result |
| --- | --- |
| Complete host API suite on committed source | 35 files passed, 1 skipped; 355 tests passed, 5 skipped |
| Web suite | 22 files, 126 tests passed |
| Complete Python suite | 433 passed, 2 skipped |
| Creator source unit suite | 8 files, 33 tests passed |
| Creator-enabled API integration | 9 files, 33 tests passed |
| Creator-enabled UI integration | 9 files, 36 tests passed |
| API and web typechecking/lint | Passed |
| Creator source typechecking and plugin lint | Passed |
| API production builds, plugin disabled/enabled | Passed |
| Next.js production builds, plugin disabled/enabled | Passed |
| Served pricing and personal contact HTTP smoke | Passed using fixture catalog; no payment/email sent |
| Independent source/spec and quality review | Passed; no unresolved Critical or Important findings |

All five API skips are the isolated Redis tests because no Redis runtime was available locally; the two Python skips are optional coverage. Real Redis tests are configured in CI. Browser visual/device inspection, actual Polar sandbox purchases/webhooks and deployed LiveKit audio/reconnect behavior were not performed. Earlier concurrent-run failures referenced in scratch logs were reproduced regressions or stale snapshots before fixes; the complete final host run above exited zero on the committed implementation.

## Local branch location and import

The sandbox blocked writes to the original checkout's `.git` directory. Work therefore happened in isolated writable checkouts:

- `/tmp/careersim-subscriptions`
- `/tmp/careersim-studio-subscriptions`

Persistent Git bundles are available under the original host checkout at `docs/superpowers/artifacts/`. Both bundles have been verified against their respective original repositories. They contain the feature commits and require base commits already present locally.

To import the local branch references from a terminal outside the sandbox:

```sh
git -C /Users/lf1up/Projects/careersim fetch /Users/lf1up/Projects/careersim/docs/superpowers/artifacts/careersim-subscriptions.bundle refs/heads/feat/subscriptions:refs/heads/feat/subscriptions
git -C /Users/lf1up/Projects/careersim-studio fetch /Users/lf1up/Projects/careersim/docs/superpowers/artifacts/creator-subscriptions.bundle refs/heads/feat/subscriptions:refs/heads/feat/subscriptions
```

These commands create the branches without switching the current checkout and without force-updating an existing divergent branch. Preserve any current work before switching branches. No remote push is needed to import these bundles.

## Review and release status

Independent source/specification and code-quality review passed with no unresolved Critical or Important findings. Review fixes covered payment/refund identity, fair reconciliation after failures, quota-key migration, account availability during counter outages, voice ordering, and explicit quota-reset display.

Before enabling paid checkout, complete the external evidence in [BILLING.md](BILLING.md): real Polar sandbox catalog/payment/webhook/refund/dispute behavior and portal restrictions. Supporter checkout remains gated on Polar accepting the actual offer and a working private channel with membership controls. Self-service tier/interval switching remains disabled with the approved contact fallback until verified. Actual Redis, browser interaction/layout and deployed LiveKit reconnect/audio behavior require their documented integration checks.

## Implementation decisions

The work used disjoint ownership for parallel agents and isolated checkouts because the original Git metadata was read-only. The cost is importing two feature branches, documented above. The three additive migrations are `0009_subscriptions`, `0010_billing_reconciliation_backoff`, and `0011_voice_call_order`; apply migrations before deploying matching API/worker/plugin code.
