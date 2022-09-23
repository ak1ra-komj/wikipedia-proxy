
# wikipedia-proxy

Yet another Wikipedia Proxy running on Cloudflare Workers.

## Quick start

* Clone this repo, `cd wikipedia-proxy/`.
* Install `npm` dependencies, `npm install`
* If you don't have `wrangler` installed, [install it](https://developers.cloudflare.com/workers/#installing-the-workers-cli).
* `cp wrangler.toml.example wrangler.toml`
* edit `config.proxy` to `<your_domain>` in [src/config.ts](src/config.ts),
    or config it via `env.PROXY` environment variable.
* Run `wrangler dev` in your terminal to start a development server, or
    run `wrangler publish` to publish your worker
* Add the following DNS records in [Cloudflare Dashboard](https://dash.cloudflare.com/) [Workers/Triggers/Custom Domains](https://developers.cloudflare.com/workers/platform/routing/custom-domains).

    ```
    wikipedia.example.com
    wiktionary.example.com
    wikibooks.example.com
    wikinews.example.com
    wikiquote.example.com
    wikisource.example.com
    wikiversity.example.com
    wikivoyage.example.com
    commons.wikimedia.example.com
    meta.wikimedia.example.com
    species.wikimedia.example.com
    upload.wikimedia.example.com
    login.wikimedia.example.com
    ```

## Environment variables

### `env.PROXY` (default: `undefined`)

You can configure your domian via this environment variable, run:

    wrangler secret put PROXY

### `env.REWRITE_IN_PAGE_URL` (default: `undefined`)

Due to the poor performance of the in-page URL rewrite (RegExp), see #1,
the `REWRITE_IN_PAGE_URL` function is intentionally disabled.

To enable it, add `REWRITE_IN_PAGE_URL` environment variable to `yes`, run:

    wrangler secret put REWRITE_IN_PAGE_URL

## License

MIT
