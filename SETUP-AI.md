# Switch on the AI reader

PileBuild reads photos best with Claude: it recognises real parts in heaps, on carpet and in
full-frame piles, where the built-in detector cannot. On the public site this runs through a
small server that holds your Anthropic API key, so the key never appears in the web page.

It takes about 15 minutes, once. After that, every push to `main` keeps the server up to date.

## What it costs

Claude usage is billed to your Anthropic account, separately from a claude.ai plan (and not
covered by Claude Code cloud credits). The server uses Claude Opus 5.5 ($4 / $20 per million
input / output tokens), which identified parts about twice as well as Sonnet 5 on the test
bench (see EVAL-RESULTS.md). Measured costs:

- a small photo (web image, few hundred pixels): about 5-6 US cents
- a clear table photo (1-2 megapixels): about 20-25 cents
- a busy phone photo that fills the frame: an overview plus up to 9 tiles, up to about $1-2

The server has daily caps counted in reads: 20 per visitor and 200 for the whole site (at most
roughly $50 a day). Change them in `worker/wrangler.toml`. To spend about a third as much, set
`MODEL = "claude-sonnet-5"` there (lower accuracy). Always set a monthly spend limit in the
console as the backstop.

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
