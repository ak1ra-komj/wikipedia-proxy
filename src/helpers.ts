
import { config } from "./config";
import { Env, ExtendedUrl } from "./types";

export async function handleRequest(
    request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    const url = new URL(request.url);
    const proxy = env.PROXY !== undefined ? env.PROXY : config.proxy;
    const domain = url.host.replace(proxy, "org");
    if (config.siteMatrixX.includes(domain) && url.pathname === "/") {
        url.pathname = "/www/";
        return Response.redirect(url.toString(), config.redirect);
    }

    const mobile = detectMobileDevice(request);
    const upstreamUrl = toUpstreamUrl(url, domain, mobile);
    const resp = await fetch(upstreamUrl.url.toString());

    // rewrite HTML urls
    const contentType = resp.headers.get("content-type");
    if (contentType !== null && contentType.startsWith("text/html")) {
        const rewriter = new HTMLRewriter()
            .on("a", new AttributeRewriter("href", env, upstreamUrl))
            .on("img", new AttributeRewriter("src", env, upstreamUrl))
            .on("script", new AttributeRewriter("src", env, upstreamUrl));
        return rewriter.transform(resp);
    } else {
        return resp;
    }
}

function detectMobileDevice(request: Request): boolean {
    let userAgent = request.headers.get("user-agent");
    if (userAgent === null) {
        return false;
    }

    userAgent = userAgent.toLowerCase();
    const deviceList = ["android", "iphone", "ipad", "ipod", "symbianos", "windows phone"];
    for (let device of deviceList) {
        return userAgent.includes(device.toLowerCase()) ? true : false;
    }
    return false;
}

export function toUpstreamUrl(url: URL, domain: string, mobile: boolean): ExtendedUrl {
    // domain is upstreamDomain
    const upstreamUrl: ExtendedUrl = {
        url: new URL(url.toString()), region: null, mobile: mobile
    };

    // upload.wikimedia.example.com
    if (config.wikimediaX.includes(domain)) {
        upstreamUrl.url.host = domain;
        return upstreamUrl;
    }

    // wikipedia.example.com/www/
    if (config.siteMatrixX.includes(domain) && url.pathname.startsWith("/www/")) {
        upstreamUrl.url.host = `www.${domain}`;
        upstreamUrl.url.pathname = url.pathname.slice(4);
        return upstreamUrl;
    }

    // wikipedia.example.com/en/
    const split = url.pathname.split("/");
    if (split.length <= 1) {
        return upstreamUrl;
    }
    const region = url.pathname.split("/")[1];
    if (config.siteMatrixX.includes(domain) && config.regionX.includes(region)) {
        upstreamUrl.region = region;
        upstreamUrl.url.host = upstreamUrl.mobile ?
            `${upstreamUrl.region}.m.${domain}` :
            `${upstreamUrl.region}.${domain}`;
        upstreamUrl.url.pathname = url.pathname.slice(upstreamUrl.region.length + 1);
    }

    return upstreamUrl;
}

export function toProxiedUrl(url: URL, proxy: string, mobile: boolean): ExtendedUrl {
    const proxiedUrl: ExtendedUrl = {
        url: new URL(url.toString()), region: null, mobile: mobile
    };

    // upload.wikimedia.org
    if (config.wikimediaX.includes(url.host)) {
        proxiedUrl.url.host = url.host.replace("org", proxy);
        return proxiedUrl;
    }

    // www.wikipedia.org
    let host = url.host.slice(4);
    if (url.host.startsWith("www.") && config.siteMatrixX.includes(host)) {
        proxiedUrl.url.host = host.replace("org", proxy);
        proxiedUrl.url.pathname = "/www" + url.pathname;
        return proxiedUrl;
    }

    // en.wikipedia.org || en.m.wikipedia.org
    const split = url.host.split(".");
    if (split.length < 3 || split.length > 4) {
        return proxiedUrl;
    }
    const region = split[0];
    if (config.regionX.includes(region)) {
        proxiedUrl.region = region;
        proxiedUrl.url.host = `${split.slice(-2)[0]}.${proxy}`;
        proxiedUrl.url.pathname = `/${proxiedUrl.region}${url.pathname}`;
    }

    return proxiedUrl;
}

export class AttributeRewriter {
    env: Env;
    attributeName: string;
    upstreamUrl: ExtendedUrl;
    proxy: string;
    regex = new RegExp(
        `(${config.siteMatrix}|${config.wikimedia})\.org`, config.flags);

    constructor(attributeName: string, env: Env, upstreamUrl: ExtendedUrl) {
        this.env = env;
        this.attributeName = attributeName;
        this.upstreamUrl = upstreamUrl;
        this.proxy = env.PROXY !== undefined ? env.PROXY : config.proxy;
    }

    element(element: Element) {
        let attribute = element.getAttribute(this.attributeName);
        if (attribute === null) {
            return;
        }

        // Url with host
        // Would someone have a Wikipedia domain with a .org TLD in the pathname?
        // env.REWRITE_IN_PAGE_URL controls whether to enable in-page urls rewrite
        if (this.env.REWRITE_IN_PAGE_URL === "yes" && this.regex.test(attribute)) {
            // fix ERR_INVALID_URL when new URL(attribute)
            // "//upload.wikimedia.org/path/to/file.png"
            if (attribute.startsWith("//")) {
                attribute = this.upstreamUrl.url.protocol + attribute;
            }
            element.setAttribute(
                this.attributeName,
                toProxiedUrl(new URL(attribute), this.proxy, this.upstreamUrl.mobile).url.toString());
        } else {
            // other url or protocol
            if (!/^\/[^\/]/gi.test(attribute)) {
                return;
            }
            // Url from same origin
            if (this.upstreamUrl.region !== null) {
                element.setAttribute(
                    this.attributeName, `/${this.upstreamUrl.region}${attribute}`);
            }
        }
    }
}
