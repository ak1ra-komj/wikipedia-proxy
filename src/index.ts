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

	protocol: "https:",
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

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	let url = new URL(request.url);
	const siteMatrixRegex = new RegExp(
		`^(${config.siteMatrix})\.${config.domain}`, config.flags);

	// only redirect /, /m/ to /www/ for siteMatrix projects
	if(siteMatrixRegex.test(url.host) &&
			(url.pathname === "/" || /^\/m\/?$/gi.test(url.pathname))) {
		url.pathname = "/www/";
		return Response.redirect(url.toString(), config.redirectStatus);
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
			.on("script", new AttributeRewriter("src", upstreamUrl))
			.on("link", new AttributeRewriter("href", upstreamUrl))
			.on("meta", new AttributeRewriter("content", upstreamUrl));

		return rewriter.transform(resp);
	} else {
		return resp;
	}
}

function proxiedUrl2UpstreamUrl(url: URL): ExtendedUrl {
	// https://wikipedia.example.com/www/
	// https://wikipedia.example.com/en/wiki/Wikipedia
	// https://wikipedia.example.com/zh/m/wiki/Wikipedia

	const upstreamUrl: ExtendedUrl = {
		url: url, region: null, mobile: null}
	const wwwRegex = new RegExp( `^\/www`, config.flags);
	const regionRegex = new RegExp( `^\/(${config.region})(\/(m))?`, config.flags);
	// regex for host
	const hostRegex = new RegExp(
		`^(${config.siteMatrix}|${config.wikimedia})\.${config.domain}`, config.flags);

	let upstreamHost = url.host.replace(hostRegex, "$1.org");
	if(wwwRegex.test(url.pathname)) {
		upstreamUrl.url.href = url.pathname.replace(
			wwwRegex, `${url.protocol}//www.${upstreamHost}`);
		return upstreamUrl;
	}

	// /zh/m/wiki/Wikipedia => [ /zh/m, zh, /m, m, ...]
	const regionMatch = regionRegex.exec(url.pathname);
	if(regionMatch !== null) {
		// regionMatch Array's index 0 is match 1, then capturing group 1, 2, 3, ...
		// we use index 3 for capturing group 3 here
		if(regionMatch[1] !== undefined && regionMatch[3] !== undefined) {
			// mobile, zh.m.wikipedia.org
			upstreamUrl.region = regionMatch[1];
			upstreamUrl.mobile = regionMatch[3];
			upstreamHost = `${upstreamUrl.region}.${upstreamUrl.mobile}.${upstreamHost}`
		} else if(regionMatch[1] !== undefined) {
			// desktop, zh.wikipedia.org
			upstreamUrl.region = regionMatch[1];
			upstreamHost = `${upstreamUrl.region}.${upstreamHost}`
		}
		upstreamUrl.url.href = url.pathname.replace(
			regionRegex, `${url.protocol}//${upstreamHost}`);
		return upstreamUrl;
	} else {
		upstreamUrl.url.host = upstreamHost;
		return upstreamUrl;
	}
}

function upstreamUrl2ProxiedUrl(url: URL): ExtendedUrl {
	// https://www.wikipedia.org/
	// https://en.wikipedia.org/wiki/Wikipedia
	// https://zh.m.wikipedia.org/wiki/维基百科

	const proxiedUrl: ExtendedUrl = {
		url: url, region: null, mobile: null}

	const wwwRegex = new RegExp( `^www\.(${config.siteMatrix})\.org`, config.flags);
	const regionRegex = new RegExp(
		`^((${config.region})(\.(m))?\.)?(${config.siteMatrix}|${config.wikimedia})\.org`, config.flags);
	const upstreamHost = proxiedUrl.url.host;
	const upstreamPathname = proxiedUrl.url.pathname;

	if(wwwRegex.test(upstreamHost)) {
		proxiedUrl.url.host = upstreamHost.replace(wwwRegex, `$1.${config.domain}`);
		proxiedUrl.url.pathname = ("/www" + upstreamPathname);
		return proxiedUrl;
	}

	// zh.m.wikipedia.org => [ zh.m.wikipedia.org, zh.m., zh, .m, m, wikipedia, ... ]
	// upload.wikimedia.org => [ upload.wikimedia.org, ..., (g5) upload.wikimedia, upload., upload, ... ]
	const regionMatch = regionRegex.exec(upstreamHost);
	if(regionMatch === null) {
		return proxiedUrl;
	}

	proxiedUrl.url.host = `${regionMatch[5]}.${config.domain}`;
	if(regionMatch[2] !== undefined && regionMatch[4] !== undefined) {
		// mobile
		let prefix = `/${regionMatch[2]}/${regionMatch[4]}`.replace(/\/+$/, "");
		proxiedUrl.url.pathname = prefix + upstreamPathname;
	} else if(regionMatch[2] !== undefined) {
		// desktop
		let prefix = `/${regionMatch[2]}`.replace(/\/+$/, "");
		proxiedUrl.url.pathname = prefix + upstreamPathname;
	}
	return proxiedUrl;
}

class AttributeRewriter {
	attributeName: string;
	upstreamUrl: ExtendedUrl;

	constructor(attributeName: string, upstreamUrl: ExtendedUrl) {
		this.attributeName = attributeName;
		this.upstreamUrl = upstreamUrl;
	}

	element(element: Element) {
		const attributeRegex = new RegExp(
			`^(https?:)?\/\/.*(${config.siteMatrix}|${config.wikimedia})\.org.*`, config.flags);

		let attribute = element.getAttribute(this.attributeName);
		if(attribute === null) { return; }

		// Url with host
		let newAttribute;
		if(attributeRegex.test(attribute)) {
			// fix ERR_INVALID_URL when new URL(attribute)
			// "//upload.wikimedia.org/path/to/file.png"
			if(attribute.startsWith("//")) {
				attribute = this.upstreamUrl.url.protocol + attribute;
			}
			newAttribute = upstreamUrl2ProxiedUrl(new URL(attribute)).url.toString();
		// Url from same origin
		} else {
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