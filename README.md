
# wikipedia-proxy

Yet another Wikipedia Proxy running on Cloudflare Workers.

## Quick start

* clone this repo, `cd wikipedia-proxy`.
* install dependencies, `npm install`
* if you don't have `wrangler` installed, [install it](https://developers.cloudflare.com/workers/#installing-the-workers-cli).
* `cp wrangler.toml.example wrangler.toml`, and edit it, set your domain here.
* edit `config.domain` to your domain in [src/index.ts](src/index.ts).
* `wrangler publish`
* add the following DNS records in [Cloudflare Dashboard](https://dash.cloudflare.com/) [Workers/Triggers/Custom Domains](https://developers.cloudflare.com/workers/platform/routing/custom-domains).
    * wikipedia.ak1ra.xyz
    * wiktionary.ak1ra.xyz
    * wikibooks.ak1ra.xyz
    * wikinews.ak1ra.xyz
    * wikiquote.ak1ra.xyz
    * wikisource.ak1ra.xyz
    * wikiversity.ak1ra.xyz
    * wikivoyage.ak1ra.xyz
    * commons.wikimedia.ak1ra.xyz
    * meta.wikimedia.ak1ra.xyz
    * species.wikimedia.ak1ra.xyz
    * upload.wikimedia.ak1ra.xyz
    * login.wikimedia.ak1ra.xyz

## License

MIT
