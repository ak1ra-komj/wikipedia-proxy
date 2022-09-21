
# wikipedia-proxy

Yet another Wikipedia Proxy running on Cloudflare Workers.

## Quick start

* clone this repo, `cd wikipedia-proxy`.
* install dependencies, `npm install`
* if you don't have `wrangler` installed, [install it](https://developers.cloudflare.com/workers/#installing-the-workers-cli).
* `cp wrangler.toml.example wrangler.toml`, and edit it.
* edit `config.domain` to your domain in [src/index.ts](src/index.ts).
* `wrangler publish`
* add the following DNS records in [Cloudflare Dashboard](https://dash.cloudflare.com/) `Workers/Triggers/Custom Domains`.
    * wikipedia.example.com
    * wiktionary.example.com
    * wikibooks.example.com
    * wikinews.example.com
    * wikiquote.example.com
    * wikisource.example.com
    * wikiversity.example.com
    * wikivoyage.example.com

## License

MIT
