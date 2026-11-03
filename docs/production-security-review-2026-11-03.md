What this repo does: CareerSIM runs AI practice conversations, stores account and conversation data, and supports voice and creator workflows. This review assumes a public service with multiple concurrent users behind hosted reverse proxies.

Review date: 3 November 2026, approximately 21:48–21:54 Asia/Tbilisi.

Follow-up remediation, 3 November 2026: findings 1–4 have source fixes and regression tests in the working tree. Verification passed: 275 API tests, 80 web tests, API/web type checks and lint, and landing checks/build. Coverage includes revoked optional authentication, concurrent credential changes, cross-instance CAPTCHA replay, and authenticated visitor-IP forwarding. These fixes have **not** been deployed. Rollout requires migration `0008_auth_security`, matching server-only `ALTCHA_HMAC_KEY` values, and API client-IP configuration. On DigitalOcean App Platform use `CLIENT_IP_SOURCE=digitalocean` with `TRUSTED_PROXIES` empty. The audit findings below describe the original reviewed state; dependency advisory observations remain unchanged.

Scope: public production checks of `careersim.ai` and its linked `api.careersim.ai`; targeted source review of the active API, web app, agent, and selected creator authorization paths; locked dependency audits; repository history secret scan. Local checkout HEAD: `ea77a099f9a44576d6ee55095184a610f486622b`. The deployed API reports version `1.2.0`, but the exact deployed commit and dependency set were not independently verified.

Production requests were limited to GET, HEAD, and OPTIONS. No production accounts, passwords, sessions, emails, or other records were created or changed. No load testing or production exploitation was performed. Local reproductions used disposable in-memory databases and captured email, with no external delivery.

**Must fix**

1. **High: password recovery does not invalidate existing login tokens.** Confirmed locally against the current source; not exercised on production accounts.
   - **What this is:** The API authenticates signed JSON Web Tokens (JWTs), including tokens stored in its session cookie. [Authentication middleware](/Users/lf1up/Projects/careersim/api/src/plugins/auth.ts:45) checks signature and expiry without consulting a session revocation state.
   - **Problem:** A token issued before a successful password reset still returned HTTP 200 from `/v1/auth/me` afterward in a local reproduction. Logout also left that copied token usable. [Password reset](/Users/lf1up/Projects/careersim/api/src/modules/auth/auth.service.ts:415) updates the password without invalidating sessions; the configured token lifetime defaults to seven days, although production's actual value was not inspected.
   - **Fix:** Add a user authentication version or revocable server-side sessions. Check that state during authentication, invalidate prior sessions on password reset and password change, and revoke the relevant session on logout. Add regression tests that require old tokens to fail.
   - **If we skip it:** Someone who already obtained a session token can retain access after the account owner resets the password or logs out. This is a recovery weakness; the review did not demonstrate an initial token theft.

2. **Medium: browser password changes are blocked by production CORS configuration.** Confirmed on the live API without submitting a password change.
   - **What this is:** The web app calls `PATCH /v1/auth/me/password` across origins, from `https://careersim.ai` to `https://api.careersim.ai`. [Browser client](/Users/lf1up/Projects/careersim/web/src/lib/api.ts:241).
   - **Problem:** An OPTIONS request with the legitimate origin and requested method `PATCH` received HTTP 204 but `Access-Control-Allow-Methods: GET, HEAD, POST, PUT, DELETE`. Browsers consequently refuse the password-change request. [API configuration](/Users/lf1up/Projects/careersim/api/src/server.ts:181).
   - **Fix:** Add `PATCH` to the allowed methods. Add a preflight test that asserts the advertised methods include every cross-origin profile mutation used by the client.
   - **If we skip it:** Users cannot set or change passwords through the profile flow. The email password-reset flow is a different POST route and was not shown to have this CORS failure.

3. **Medium: per-IP throttles use the reverse proxy's address.** Confirmed locally with the current server configuration; production impact inferred from the observed hosted proxy topology.
   - **What this is:** Login and CAPTCHA throttles use `request.ip`. [Rate-limit key](/Users/lf1up/Projects/careersim/api/src/plugins/rate-limit.ts:29).
   - **Problem:** [Fastify construction](/Users/lf1up/Projects/careersim/api/src/server.ts:166) does not configure trusted proxies. Two local requests with the same proxy socket address and different forwarded client IPs consumed one shared CAPTCHA bucket: remaining quota changed from 59 to 58. Live API responses identify Cloudflare and DigitalOcean hosting, but the origin socket addresses and proxy header rewriting were not accessible for verification.
   - **Fix:** Configure trusted proxy addresses or a provider-validated client-IP mechanism that matches the actual ingress chain. Verify that ingress overwrites untrusted forwarding headers. Do not enable unrestricted proxy trust without checking that boundary. [Fastify documentation](https://github.com/fastify/fastify/blob/main/docs/Reference/Server.md).
   - **If we skip it:** Users routed through the same proxy address can exhaust one another's login or challenge allowance. The exact number of affected users depends on the production ingress topology.

4. **Medium: solved CAPTCHA challenges can be reused.** Confirmed locally with real proof-of-work verification and bypass disabled.
   - **What this is:** The API verifies ALTCHA proof-of-work solutions before registration, password login, email-link requests, and password-reset requests. [Verifier](/Users/lf1up/Projects/careersim/api/src/plugins/altcha.ts:77).
   - **Problem:** The identical valid solution was accepted twice. Signature and expiration verification are present, but no consumed-challenge registry exists. The API's default validity window is ten minutes. The apex contact handler uses the same stateless verification pattern, although its replay behavior was not separately reproduced.
   - **Fix:** After cryptographic verification, atomically claim the challenge identifier in shared storage, such as Redis `SET NX` with a TTL covering the remaining signed lifetime. Reject reuse across protected actions. Keep the existing request limits. This follows [ALTCHA's replay-protection requirements](https://altcha.org/docs/integration/security-recommendations/).
   - **If we skip it:** Automation can reuse one solved challenge across repeated requests until expiry, substantially reducing the intended per-request work. CAPTCHA replay does not itself bypass password or email ownership checks, and route throttles still apply.

**Should fix**

5. **Low immediate production risk: two moderate advisories remain in the landing site's dependency chain.** Confirmed against the local lockfile, not the deployed artifact.
   - **What this is:** `@astrojs/vercel` pulls in `@vercel/nft → glob@13.0.6 → minimatch@10.2.6`. [Lockfile](/Users/lf1up/Projects/careersim/landing/pnpm-lock.yaml:1431).
   - **Problem:** The current audit reports [minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) and [glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4). They concern excessive CPU, memory, or filesystem work under particular caller-controlled inputs. No path from a public production request to those vulnerable operations was demonstrated; this chain is associated with build tracing.
   - **Fix:** Update the adapter or its transitive dependency chain to compatible patched releases. The advisories currently identify `minimatch >=11.0.1` and `glob >=14.0.2` as patched; validate compatibility before introducing major-version overrides.
   - **If we skip it:** The known dependency findings remain, chiefly a build-tool exposure based on the reviewed usage. They are not evidence that a visitor can take down the production website.

**Additional observations**

- **Content Security Policy is limited:** the homepage, login, and simulations responses send only `frame-ancestors 'none'`. This protects against framing but imposes no script execution or outbound connection restrictions. Add a tested script policy using nonces or hashes as defense in depth; no exploitable script-injection path was established in this review. [Web headers](/Users/lf1up/Projects/careersim/web/next.config.mjs:126).
- **ChromaDB advisories require explicit ongoing tracking:** the Python audit returned five vulnerability entries in `chromadb==1.5.9`, representing four distinct CVEs because CVE-2026-45829 appeared twice. These are CVE-2026-45829, CVE-2026-45830, CVE-2026-45831, and CVE-2026-45833. The checked-in security workflow already acknowledges them. The reviewed agent uses embedded `chromadb.PersistentClient`, rather than exposing Chroma's Python HTTP server. This supports the existing reachability assessment but does not verify deployed network isolation. The [pre-authentication code-execution advisory](https://github.com/advisories/GHSA-f4j7-r4q5-qw2c) lists no patched version at review time. Keep the affected HTTP server unexposed and revisit as patches become available. [Embedded use](/Users/lf1up/Projects/careersim/agent/src/careersim_agent/services/retrieval_service.py:140).

**Checks that passed**

| Check | Observed result |
| --- | --- |
| HTTP to HTTPS | Apex returned 308; API returned 301 to the corresponding HTTPS URL. |
| TLS certificates | Both hostnames passed standard certificate and hostname verification and negotiated TLS 1.3. Certificate expirations: 16 January 2027 for the apex, 25 January 2027 for the API. Older protocol support was not tested. |
| Web security headers | Homepage, login, and simulations included HSTS with subdomains, `nosniff`, `X-Frame-Options: DENY`, referrer policy, permissions policy, and frame-ancestor restrictions. |
| Anonymous access | Live `/v1/auth/me`, `/v1/sessions`, `/v1/analytics/overview`, and `/v1/creator/me` returned 401. |
| Internal worker boundary | Live `/v1/internal/sessions/00000000-0000-4000-8000-000000000000/state-for-voice` returned 401 without an internal key. |
| Unrelated browser origin | The API did not return `Access-Control-Allow-Origin` for `https://security-check.invalid`. It returned the correct allowed origin for the apex. A public challenge returning 200 without a CORS grant is not a CORS bypass. |
| Development documentation | API `/v1/docs` and `/v1/docs/openapi.json` returned 404. |
| Exposed configuration samples | `/.env` and `/.git/config` returned 404 on both hosts. |
| API production dependencies | pnpm audit: zero reported advisories across 159 dependencies. |
| Web production dependencies | pnpm audit: zero reported advisories across 299 dependencies. |
| Landing production dependencies | pnpm audit: two moderate advisories across 409 dependencies; no high or critical findings. |
| Agent dependency audit | 129 dependency entries audited; findings limited to the ChromaDB issues described above. |
| Secret scan | Gitleaks reported zero matches across 553 commits, approximately 10.4 MB scanned. This is a scanner result, not proof that every possible secret is absent. |
| Selected existing API tests | 107 tests passed across auth, CORS, rate limiting, ALTCHA, session batch access, voice routes, and documentation. |

**Reproduction and evidence**

The standalone local assertion script successfully demonstrated:

1. The same solved CAPTCHA passes verification twice.
2. A pre-reset bearer token authenticates after password reset.
3. That token remains usable after logout.
4. Different forwarded client IPs share a bucket when the socket peer is the same proxy.

The selected existing tests passed despite these gaps; passing them does not invalidate the reproductions.

Temporary evidence is available in this machine's `/tmp` directory: [local reproductions](/tmp/careersim-local-security-check.mts), [public probe results](/tmp/careersim-security-probe.json), [test log](/tmp/careersim-security-tests.log), and the API, web, landing, and agent audit JSON files prefixed `careersim-`. Temporary files may be removed by the operating system. Raw probe results include transient edge-generated cookies and should be sanitized before sharing outside the team.

**Verdict:** Fix session invalidation first, then the live password-change preflight and the CAPTCHA/proxy rate-limit weaknesses. The sampled anonymous boundaries held, but this review does not establish that production is free of vulnerabilities.

**Not checked:** authenticated cross-account behavior on production; exact deployed commits or image contents; hosting account settings, IAM, database exposure, backups, encryption configuration, runtime secrets, security logs, origin bypasses, direct agent/LiveKit/Ghost exposure, exhaustive creator-plugin behavior, port scans, load tests, or every source file. Legacy backend/frontend/rag/transformers directories were excluded from runtime dependency review because the repository marks them deprecated. No application code or deployment was changed.
