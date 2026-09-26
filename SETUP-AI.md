# Switch on the AI reader

PileBuild reads photos best with Claude: it recognises real parts in heaps, on carpet and in
full-frame piles, where the built-in detector cannot. On the public site this runs through a
small server that holds your Anthropic API key, so the key never appears in the web page.

It takes about 15 minutes, once. After that, every push to `main` keeps the server up to date.

## What it costs

Claude usage is billed to your Anthropic account (prepaid credit at platform.claude.com),
separately from a claude.ai plan. The page shows the cost of every read right after it.

- **Normal read** (default): Claude Sonnet 5 ($2 / $10 per million input / output tokens), one
  call per photo, answer capped at 4,000 tokens. Expected: about 1-3 US cents a photo.
- **Precise read** (tick box): Claude Opus 5.5 ($4 / $20), about twice as accurate on the test
  bench (EVAL-RESULTS.md). Expected: about 2-6 cents a photo. Counts as 3 reads against the caps.
- **Lots of small pieces** (tick box): if the first read finds a big pile filling the frame, the
  photo is read again in up to 9 parts: up to about 10x the cost of a normal read.

- **Design with AI** (button in "What to build"): Claude Opus 5.5 designs a model from the photo
  or your words, the page checks it, and Claude fixes what the check finds (one extra round at
  most). Measured: 6-15 US cents for a design, up to about 25 cents with a fix round. Counts as
  5 reads against the caps.

Measured on the test bench (EVAL-RESULTS.md): a normal read about 2.5 cents, a precise read
about 4.5 cents.

Daily caps, counted in reads: 60 per visitor and 200 for the whole site (a design counts 5, its fix round 2). To reset today's counters, change `LIMIT_EPOCH` in `worker/wrangler.toml`. Change them in
`worker/wrangler.toml`. With auto-reload off, spending can never exceed the credit you buy.

## 1. Anthropic API key

1. Sign in at https://platform.claude.com and add a payment method or prepaid credit.
2. Create an API key (see https://platform.claude.com/docs/en/get-api-key). Name it `pilebuild`.
3. In the console's billing or limits settings, set a monthly spend limit you are comfortable with.

## 2. Cloudflare (free plan)

1. Create a free account at https://dash.cloudflare.com.
2. Copy your **Account ID**: shown on the Workers & Pages overview page.
3. Create an **API token**: My Profile > API Tokens > Create Token > template
   **Edit Cloudflare Workers** > Continue > Create. Copy the token.

## 3. Add three secrets to GitHub

In https://github.com/Hampshire33/LOGO > Settings > Secrets and variables > Actions >
New repository secret, add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the API key from step 1 |
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the account id from step 2 |

## 4. Deploy

Actions tab > **Deploy AI server** > Run workflow. It deploys the server, stores the key as a
server secret, and rebuilds the site with the server's address. When the site rebuild finishes,
the page says "Photos are read by Claude through the PileBuild AI server".

## Check how well it reads

Actions tab > **Evaluate identification** > Run workflow. It scores the reader on test photos
with known contents (spread out, heaped, on carpet, filling the frame) and shows a table in the
run summary. Run it again after any change to the prompt (`src/identify-prompt.js`), the tiling
(`src/identify.js`) or the model (`MODEL` in `worker/wrangler.toml`), and compare.

To include your own photos, add them to `eval/photos/` with a `truth.json` listing what is in
each one, e.g. `{ "table.jpg": [{ "id": "3001", "color": "red", "qty": 4 }] }`. Only add photos
you took yourself: the repository is public.

## Switching it off

Delete the three secrets, or in Cloudflare delete the `pilebuild-ai` worker. The site then falls
back to the built-in detector.
