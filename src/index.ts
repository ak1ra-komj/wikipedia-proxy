/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {}

export interface ExtendedUrl {
	url: URL,
	region: string | null,
	mobile: string | null,
}

const config = {
	domain: "ak1ra.xyz",

	redirectStatus: 301,

	// regex pattern
	flags: "gi",

	// ref: https://meta.wikimedia.org/wiki/Special:SiteMatrix
	region: "aa|ab|ace|ady|af|ak|als|alt|am|ami|an|ang|ar|arc|ary|arz|as|ast|atj|av|avk|awa|ay|az|azb|ba|ban|bar|bat-smg|bcl|be|be-tarask|be-x-old|bg|bh|bi|bjn|blk|bm|bn|bo|bpy|br|bs|bug|bxr|ca|cbk-zam|cdo|ce|ceb|ch|cho|chr|chy|ckb|co|cr|crh|cs|csb|cu|cv|cy|da|dag|de|din|diq|dsb|dty|dv|dz|ee|el|eml|en|eo|es|et|eu|ext|fa|ff|fi|fiu-vro|fj|fo|fr|frp|frr|fur|fy|ga|gag|gan|gcr|gd|gl|glk|gn|gom|gor|got|gu|guw|gv|ha|hak|haw|he|hi|hif|ho|hr|hsb|ht|hu|hy|hyw|hz|ia|id|ie|ig|ii|ik|ilo|inh|io|is|it|iu|ja|jam|jbo|jv|ka|kaa|kab|kbd|kbp|kcg|kg|ki|kj|kk|kl|km|kn|ko|koi|kr|krc|ks|ksh|ku|kv|kw|ky|la|lad|lb|lbe|lez|lfn|lg|li|lij|lld|lmo|ln|lo|lrc|lt|ltg|lv|mad|mai|map-bms|mdf|mg|mh|mhr|mi|min|mk|ml|mn|mni|mnw|mo|mr|mrj|ms|mt|mus|mwl|my|myv|mzn|na|nah|nap|nds|nds-nl|ne|new|ng|nia|nl|nn|no|nov|nqo|nrm|nso|nv|ny|oc|olo|om|or|os|pa|pag|pam|pap|pcd|pcm|pdc|pfl|pi|pih|pl|pms|pnb|pnt|ps|pt|pwn|qu|rm|rmy|rn|ro|roa-rup|roa-tara|ru|rue|rw|sa|sah|sat|sc|scn|sco|sd|se|sg|sh|shi|shn|shy|si|simple|sk|skr|sl|sm|smn|sn|so|sq|sr|srn|ss|st|stq|su|sv|sw|szl|szy|ta|tay|tcy|te|tet|tg|th|ti|tk|tl|tn|to|tpi|tr|trv|ts|tt|tum|tw|ty|tyv|udm|ug|uk|ur|uz|ve|vec|vep|vi|vls|vo|wa|war|wo|wuu|xal|xh|xmf|yi|yo|yue|za|zea|zh|zh-classical|zh-min-nan|zh-yue|zu",

	// mediawiki project with region subdomain
	siteMatrix: "wikipedia|wiktionary|wikibooks|wikinews|wikiquote|wikisource|wikiversity|wikivoyage",

	// mediawiki project without region subdomain
	wikimedia: "((commons|meta|species|upload|login)\.)?wikimedia",
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return await handleRequest(request, env, ctx);
	},
}

async function handleRequest(
		request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	let url = new URL(request.url);
	const wwwSiteRegex = new RegExp(
		`^(${config.siteMatrix})\.${config.domain}`, config.flags);
	const apiPathRegex = new RegExp(`^\/api\/`, config.flags);

	// only redirect /, /m/ to /www/ for siteMatrix projects
	if(wwwSiteRegex.test(url.host) &&
			(url.pathname === "/" || /^\/m\/?$/gi.test(url.pathname))) {
		url.pathname = "/www/";
		return Response.redirect(url.toString(), config.redirectStatus);
	}

	if(apiPathRegex.test(url.pathname)) {
		// add region prefix from referer
		url = adjustApiRequestUrl(request);
	}

	// convert request.url to real upstreamUrl
	const upstreamUrl = proxiedUrl2UpstreamUrl(url);
	const resp = await fetch(upstreamUrl.url.toString());

	// rewrite HTML urls
	const contentType = resp.headers.get("content-type");
	if(contentType !== null && contentType.startsWith("text/html")) {
		const rewriter = new HTMLRewriter()
			.on("a", new AttributeRewriter("href", upstreamUrl))
			.on("img", new AttributeRewriter("src", upstreamUrl))
			.on("script", new AttributeRewriter("src", upstreamUrl));

		return rewriter.transform(resp);
	} else {
		return resp;
	}
}

function proxiedUrl2UpstreamUrl(url: URL): ExtendedUrl {
	// https://wikipedia.example.com/www/
	// https://wikipedia.example.com/en/wiki/Wikipedia
	// https://wikipedia.example.com/zh/m/wiki/维基百科

	const upstreamUrl: ExtendedUrl = {url: url, region: null, mobile: null}
	const wwwPathRegex = new RegExp(`^\/www`, config.flags);
	// consider /static/images/project-logos/enwiki.png and 'st' region
	const regionPathRegex = new RegExp(`^\/(${config.region})\/((m)\/)?`, config.flags);
	// regex for host
	const hostRegex = new RegExp(
		`^(${config.siteMatrix}|${config.wikimedia})\.${config.domain}`, config.flags);

	let domain = url.host.replace(hostRegex, "$1.org");
	if(wwwPathRegex.test(url.pathname)) {
		upstreamUrl.url.href = url.pathname.replace(
			wwwPathRegex, `${url.protocol}//www.${domain}`);
		return upstreamUrl;
	}

	// /zh/m/wiki/Wikipedia => [ /zh/m/, zh, m/, m, ...]
	const regionMatch = regionPathRegex.exec(url.pathname);
	if(regionMatch !== null) {
		// regionMatch Array's index 0 is match 1, then capturing group 1, 2, 3, ...
		// we use index 3 for capturing group 3 here
		if(regionMatch[1] !== undefined && regionMatch[3] !== undefined) {
			// mobile, zh.m.wikipedia.org
			upstreamUrl.region = regionMatch[1];
			upstreamUrl.mobile = regionMatch[3];
			upstreamUrl.url.host = `${upstreamUrl.region}.${upstreamUrl.mobile}.${domain}`;
			upstreamUrl.url.pathname = url.pathname.slice(`/${upstreamUrl.region}/${upstreamUrl.mobile}`.length);
		} else if(regionMatch[1] !== undefined) {
			// desktop, zh.wikipedia.org
			upstreamUrl.region = regionMatch[1];
			upstreamUrl.url.host = `${upstreamUrl.region}.${domain}`;
			upstreamUrl.url.pathname = url.pathname.slice(`/${upstreamUrl.region}`.length);
		}
		return upstreamUrl;
	} else {
		upstreamUrl.url.host = domain;
		return upstreamUrl;
	}
}

function upstreamUrl2ProxiedUrl(url: URL): ExtendedUrl {
	// https://www.wikipedia.org/
	// https://en.wikipedia.org/wiki/Wikipedia
	// https://zh.m.wikipedia.org/wiki/维基百科

	const proxiedUrl: ExtendedUrl = {url: url, region: null, mobile: null};

	const wwwHostRegex = new RegExp( `^www\.(${config.siteMatrix})\.org`, config.flags);
	const regionHostRegex = new RegExp(
		`^((${config.region})(\.(m))?\.)?(${config.siteMatrix}|${config.wikimedia})\.org`, config.flags);
	const upstreamHost = proxiedUrl.url.host;
	const upstreamPathname = proxiedUrl.url.pathname;

	if(wwwHostRegex.test(upstreamHost)) {
		proxiedUrl.url.host = upstreamHost.replace(wwwHostRegex, `$1.${config.domain}`);
		proxiedUrl.url.pathname = ("/www" + upstreamPathname);
		return proxiedUrl;
	}

	// zh.m.wikipedia.org => [ zh.m.wikipedia.org, zh.m., zh, .m, m, wikipedia, ... ]
	// upload.wikimedia.org => [ upload.wikimedia.org, ..., (g5) upload.wikimedia, upload., upload, ... ]
	const regionMatch = regionHostRegex.exec(upstreamHost);
	if(regionMatch === null) {
		return proxiedUrl;
	}

	proxiedUrl.url.host = `${regionMatch[5]}.${config.domain}`;
	if(regionMatch[2] !== undefined && regionMatch[4] !== undefined) {
		// mobile, remove tailing slashes
		let prefix = `/${regionMatch[2]}/${regionMatch[4]}`.replace(/\/+$/, "");
		proxiedUrl.url.pathname = prefix + upstreamPathname;
	} else if(regionMatch[2] !== undefined) {
		// desktop
		let prefix = `/${regionMatch[2]}`.replace(/\/+$/, "");
		proxiedUrl.url.pathname = prefix + upstreamPathname;
	}
	return proxiedUrl;
}

function adjustApiRequestUrl(request: Request): URL {
	// https://wikipedia.ak1ra.xyz/api/rest_v1/page/summary/Central_Park_West
	const url = new URL(request.url);

	const referer = request.headers.get("referer");
	// if there is no referer header, we can only return the request.url
	if(referer === null) {
		return url;
	}

	const refererUrl = proxiedUrl2UpstreamUrl(new URL(referer));
	if(refererUrl.region !== null && refererUrl.mobile !== null) {
		url.pathname = `/${refererUrl.region}/${refererUrl.mobile}` + url.pathname;
	} else if(refererUrl.region !== null) {
		url.pathname = `/${refererUrl.region}` + url.pathname;
	}

	return url;
}

class AttributeRewriter {
	attributeName: string;
	upstreamUrl: ExtendedUrl;

	constructor(attributeName: string, upstreamUrl: ExtendedUrl) {
		this.attributeName = attributeName;
		this.upstreamUrl = upstreamUrl;
	}

	element(element: Element) {
		const urlRegex = new RegExp(
			`^(https?:)?\/\/.*(${config.siteMatrix}|${config.wikimedia})\.org.*`, config.flags);

		let attribute = element.getAttribute(this.attributeName);
		if(attribute === null) {
			return;
		}

		// Url with host
		let newAttribute;
		if(urlRegex.test(attribute)) {
			// fix ERR_INVALID_URL when new URL(attribute)
			// "//upload.wikimedia.org/path/to/file.png"
			if(attribute.startsWith("//")) {
				attribute = this.upstreamUrl.url.protocol + attribute;
			}
			newAttribute = upstreamUrl2ProxiedUrl(new URL(attribute)).url.toString();
		} else {
			// third part links
			if(/(https?:)?\/\//gi.test(attribute)) {
				return;
			}
			// // MediaWiki's ResourceLoader: /w/api.php, /w/load.php
			// if(/^\/w\/(api|load)\.php/gi.test(attribute)) {
			// 	return;
			// }
			// Url from same origin
			if(this.upstreamUrl.region !== null && this.upstreamUrl.mobile !== null) {
				newAttribute = `/${this.upstreamUrl.region}/${this.upstreamUrl.mobile}${attribute}`;
			} else if(this.upstreamUrl.region !== null) {
				newAttribute = `/${this.upstreamUrl.region}${attribute}`;
			} else {
				newAttribute = attribute;
			}
		}

		console.log(`AttributeRewriter: ${attribute} -> ${newAttribute}`);

		element.setAttribute(this.attributeName, newAttribute);
	}
}