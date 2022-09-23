
import { config } from "./config";
import { Env, ExtendedUrl } from "./types";

export async function handleRequest(
    request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let url = new URL(request.url);
    const proxyDomain = env.DOMAIN !== undefined ? env.DOMAIN : config.domain;
    const wwwSiteRegex = new RegExp(`^(${config.siteMatrix})\.${proxyDomain}`, config.flags);
    const apiPathRegex = new RegExp(`^\/api\/`, config.flags);

    // only redirect /, /m/ to /www/ for siteMatrix projects
    if (wwwSiteRegex.test(url.host) &&
        (url.pathname === "/" || /^\/m\/?$/gi.test(url.pathname))) {
        url.pathname = "/www/";
        return Response.redirect(url.toString(), config.redirectStatus);
    }

    if (apiPathRegex.test(url.pathname)) {
        // add region prefix from referer
        url = adjustApiRequestUrl(request, env);
    }

    // convert request.url to real upstreamUrl
    const upstreamUrl = proxiedUrl2UpstreamUrl(url, env);
    const resp = await fetch(upstreamUrl.url.toString());

    // rewrite HTML urls
    const contentType = resp.headers.get("content-type");
    if (contentType !== null && contentType.startsWith("text/html")) {
        const rewriter = new HTMLRewriter()
            .on("a", new AttributeRewriter(env, "href", upstreamUrl))
            .on("img", new AttributeRewriter(env, "src", upstreamUrl))
            .on("script", new AttributeRewriter(env, "src", upstreamUrl));

        return rewriter.transform(resp);
    } else {
        return resp;
    }
}

export function proxiedUrl2UpstreamUrl(url: URL, env: Env): ExtendedUrl {
    // https://wikipedia.example.com/www/
    // https://wikipedia.example.com/en/wiki/Wikipedia
    // https://wikipedia.example.com/zh/m/wiki/维基百科

    const proxyDomain = env.DOMAIN !== undefined ? env.DOMAIN : config.domain;
    const upstreamUrl: ExtendedUrl = { url: url, region: null, mobile: null }
    const wwwPathRegex = new RegExp(`^\/www`, config.flags);
    // consider /static/images/project-logos/enwiki.png and 'st' region
    const regionPathRegex = new RegExp(`^\/(${config.region})\/((m)\/)?`, config.flags);
    // regex for host
    const hostRegex = new RegExp(
        `^(${config.siteMatrix}|${config.wikimedia})\.${proxyDomain}`, config.flags);

    let domain = url.host.replace(hostRegex, "$1.org");
    if (wwwPathRegex.test(url.pathname)) {
        upstreamUrl.url.href = url.pathname.replace(
            wwwPathRegex, `${url.protocol}//www.${domain}`);
        return upstreamUrl;
    }

    // /zh/m/wiki/Wikipedia => [ /zh/m/, zh, m/, m, ...]
    const regionMatch = regionPathRegex.exec(url.pathname);
    if (regionMatch === null) {
        upstreamUrl.url.host = domain;
        return upstreamUrl;
    }

    // regionMatch Array's index 0 is match 1, then capturing group 1, 2, 3, ...
    // we use index 3 for capturing group 3 here
    upstreamUrl.region = regionMatch[1] !== undefined ? regionMatch[1] : null;
    upstreamUrl.mobile = regionMatch[3] !== undefined ? regionMatch[3] : null;
    if (upstreamUrl.region !== null && upstreamUrl.mobile !== null) {
        // mobile, zh.m.wikipedia.org
        upstreamUrl.url.host = `${upstreamUrl.region}.${upstreamUrl.mobile}.${domain}`;
        upstreamUrl.url.pathname = url.pathname.slice(`/${upstreamUrl.region}/${upstreamUrl.mobile}`.length);
    } else if (upstreamUrl.region !== null) {
        // desktop, zh.wikipedia.org
        upstreamUrl.url.host = `${upstreamUrl.region}.${domain}`;
        upstreamUrl.url.pathname = url.pathname.slice(`/${upstreamUrl.region}`.length);
    }
    return upstreamUrl;
}

export function upstreamUrl2ProxiedUrl(url: URL, env: Env): ExtendedUrl {
    // The urls that can be fed into this function should be pre-filtered
    // https://www.wikipedia.org/
    // https://en.wikipedia.org/wiki/Wikipedia
    // https://zh.m.wikipedia.org/wiki/维基百科

    const proxyDomain = env.DOMAIN !== undefined ? env.DOMAIN : config.domain;
    const proxiedUrl: ExtendedUrl = { url: url, region: null, mobile: null };

    const wwwHostRegex = new RegExp(`^www\.(${config.siteMatrix})\.org`, config.flags);
    const regionHostRegex = new RegExp(
        `^((${config.region})(\.(m))?\.)?(${config.siteMatrix}|${config.wikimedia})\.org`, config.flags);
    const upstreamHost = proxiedUrl.url.host;
    const upstreamPathname = proxiedUrl.url.pathname;

    if (wwwHostRegex.test(upstreamHost)) {
        proxiedUrl.url.host = upstreamHost.replace(wwwHostRegex, `$1.${proxyDomain}`);
        proxiedUrl.url.pathname = ("/www" + upstreamPathname);
        return proxiedUrl;
    }

    // zh.m.wikipedia.org => [ zh.m.wikipedia.org, zh.m., zh, .m, m, wikipedia, ... ]
    // upload.wikimedia.org => [ upload.wikimedia.org, ..., (g5) upload.wikimedia, upload., upload, ... ]
    const regionMatch = regionHostRegex.exec(upstreamHost);
    if (regionMatch === null) {
        return proxiedUrl;
    }

    proxiedUrl.url.host = `${regionMatch[5]}.${proxyDomain}`;
    proxiedUrl.region = regionMatch[2] !== undefined ? regionMatch[2] : null;
    proxiedUrl.mobile = regionMatch[4] !== undefined ? regionMatch[4] : null;
    if (proxiedUrl.region !== null && proxiedUrl.mobile !== null) {
        // mobile, remove tailing slashes
        let prefix = `/${proxiedUrl.region}/${proxiedUrl.mobile}`.replace(/\/+$/, "");
        proxiedUrl.url.pathname = prefix + upstreamPathname;
    } else if (proxiedUrl.region !== null) {
        // desktop
        let prefix = `/${proxiedUrl.region}`.replace(/\/+$/, "");
        proxiedUrl.url.pathname = prefix + upstreamPathname;
    }
    return proxiedUrl;
}

function adjustApiRequestUrl(request: Request, env: Env): URL {
    // https://wikipedia.ak1ra.xyz/api/rest_v1/page/summary/Central_Park_West
    const url = new URL(request.url);
    const referer = request.headers.get("referer");
    // if there is no referer header, we can only return the request.url
    if (referer === null) {
        return url;
    }

    const refererUrl = proxiedUrl2UpstreamUrl(new URL(referer), env);
    if (refererUrl.region !== null && refererUrl.mobile !== null) {
        url.pathname = `/${refererUrl.region}/${refererUrl.mobile}` + url.pathname;
    } else if (refererUrl.region !== null) {
        url.pathname = `/${refererUrl.region}` + url.pathname;
    }

    return url;
}

class AttributeRewriter {
    env: Env;
    attributeName: string;
    upstreamUrl: ExtendedUrl;
    wikipediaRegex = new RegExp(
        `(${config.siteMatrix}|${config.wikimedia})\.org`, config.flags);

    constructor(env: Env, attributeName: string, upstreamUrl: ExtendedUrl) {
        this.env = env;
        this.attributeName = attributeName;
        this.upstreamUrl = upstreamUrl;
    }

    element(element: Element) {
        let attribute = element.getAttribute(this.attributeName);
        if (attribute === null) {
            return;
        }

        // Url with host
        // Would someone have a Wikipedia domain with a .org TLD in the pathname?
        // env.REWRITE_IN_PAGE_URL controls whether to enable in-page urls rewrite
        if (this.env.REWRITE_IN_PAGE_URL === "yes" && this.wikipediaRegex.test(attribute)) {
            // fix ERR_INVALID_URL when new URL(attribute)
            // "//upload.wikimedia.org/path/to/file.png"
            if (attribute.startsWith("//")) {
                attribute = this.upstreamUrl.url.protocol + attribute;
            }
            element.setAttribute(
                this.attributeName,
                upstreamUrl2ProxiedUrl(new URL(attribute), this.env).url.toString());
        } else {
            // other url or protocol
            if (!/^\/[^\/]/gi.test(attribute)) {
                return;
            }
            // Url from same origin
            let prefix: string = "";
            if (this.upstreamUrl.region !== null && this.upstreamUrl.mobile !== null) {
                prefix = `/${this.upstreamUrl.region}/${this.upstreamUrl.mobile}`;
            } else if (this.upstreamUrl.region !== null) {
                prefix = `/${this.upstreamUrl.region}`;
            }
            element.setAttribute(this.attributeName, prefix + attribute);
        }
    }
}
