// Embeds line ranges from GitHub files: <div class="gh-embed" data-target="https://github.com/o/r/blob/ref/path#L10-L20"></div>
// Code is fetched from raw.githubusercontent.com and coloured with the site's own theme variables.
(function () {
  var boxes = document.querySelectorAll(".gh-embed[data-target]");
  if (!boxes.length) return;

  var HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
  var LANGS = { cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp", inl: "cpp", usf: "cpp", ush: "cpp", hlsl: "cpp",
    cs: "csharp", json: "json", uplugin: "json", uproject: "json", py: "python", js: "javascript", ts: "typescript",
    ini: "ini", glsl: "glsl", sh: "bash", md: "markdown", xml: "xml", yml: "yaml", yaml: "yaml" };
  var files = {};

  function loadHljs() {
    if (window.hljs) return Promise.resolve(window.hljs);
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = HLJS; s.async = true;
      s.onload = function () { resolve(window.hljs || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
  }

  function parse(href) {
    var u = new URL(href);
    var m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (!m) return null;
    var lines = (u.hash.match(/^#L(\d+)(?:-L(\d+))?$/) || []);
    var start = lines[1] ? +lines[1] : 1;
    return { href: href, owner: m[1], repo: m[2], ref: m[3], path: decodeURIComponent(m[4]),
      start: start, end: lines[2] ? +lines[2] : (lines[1] ? start : Infinity),
      raw: "https://raw.githubusercontent.com/" + m[1] + "/" + m[2] + "/" + m[3] + "/" + m[4] };
  }

  function fetchFile(url) {
    if (!files[url]) files[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
    return files[url];
  }

  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Split highlighted HTML into lines, closing and reopening spans that cross a line break.
  function splitLines(html) {
    var out = [], open = [], cur = "", re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g, m;
    while ((m = re.exec(html))) {
      if (m[1]) { open.push(m[1]); cur += m[1]; }
      else if (m[2]) { open.pop(); cur += m[2]; }
      else if (m[3]) { out.push(cur + "</span>".repeat(open.length)); cur = open.join(""); }
      else cur += m[4];
    }
    out.push(cur);
    return out;
  }

  // Extra IDE-style colouring for plain identifiers: Unreal type prefixes, macros and function calls.
  function decorate(code) {
    var walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walker.nextNode())) if (n.parentNode.classList.contains("lc")) nodes.push(n);
    nodes.forEach(function (node) {
      var text = node.textContent, re = /\b([A-Za-z_]\w*)\b(\s*\()?/g, m, last = 0, frag = document.createDocumentFragment(), hit = false;
      while ((m = re.exec(text))) {
        var cls = /^[A-Z][A-Z0-9_]{2,}$/.test(m[1]) ? "hl-macro" : /^[FUATEIS][A-Z]\w*$/.test(m[1]) ? "hl-type" : m[2] ? "hl-fn" : "";
        if (!cls) continue;
        hit = true;
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var s = document.createElement("span"); s.className = cls; s.textContent = m[1]; frag.appendChild(s);
        last = m.index + m[1].length;
      }
      if (!hit) return;
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function render(box, info, text, hljs) {
    var all = text.replace(/\r\n?/g, "\n").split("\n");
    if (all.length && all[all.length - 1] === "") all.pop();
    var end = Math.min(info.end, all.length), sel = all.slice(info.start - 1, end).map(function (l) { return l.replace(/\t/g, "    "); });
    var indent = Math.min.apply(null, sel.filter(function (l) { return l.trim(); }).map(function (l) { return l.match(/^ */)[0].length; }).concat([Infinity]));
    if (isFinite(indent) && indent > 0) sel = sel.map(function (l) { return l.slice(indent); });
    var src = sel.join("\n"), ext = info.path.split(".").pop().toLowerCase(), lang = LANGS[ext];
    var html = hljs && lang && hljs.getLanguage(lang) ? hljs.highlight(src, { language: lang, ignoreIllegals: true }).value : esc(src);

    var lines = splitLines(html), name = info.path.split("/").pop(), dir = info.path.slice(0, -name.length);
    var range = info.end === Infinity ? "" : (info.start === end ? "L" + info.start : "L" + info.start + "–" + end);
    var rows = lines.map(function (l, i) {
      return '<span class="ln">' + (info.start + i) + '</span><span class="lc">' + (l || " ") + "</span>";
    }).join("");

    box.innerHTML =
      '<figure class="src">' +
        '<figcaption class="src-head">' +
          '<span class="src-path"><span class="src-dir">‎' + esc(dir) + '‎</span><span class="src-name">' + esc(name) + "</span></span>" +
          '<span class="src-actions">' +
            (range ? '<span class="src-range">' + range + "</span>" : "") +
            '<button type="button" class="src-copy">Copy</button>' +
            '<a class="src-link" href="' + esc(info.href) + '">GitHub</a>' +
          "</span>" +
        "</figcaption>" +
        '<div class="src-body"' + (box.dataset.maxHeight ? ' style="max-height:' + (+box.dataset.maxHeight) + 'px"' : "") + '>' +
          '<pre class="src-code" role="region" tabindex="0" aria-label="' + esc(name + (range ? " " + range : "")) + '"><code class="hljs">' + rows + "</code></pre>" +
        "</div>" +
      "</figure>";

    decorate(box.querySelector("code"));
    var btn = box.querySelector(".src-copy");
    btn.addEventListener("click", function () {
      var done = function (ok) { btn.textContent = ok ? "Copied" : "Copy failed"; setTimeout(function () { btn.textContent = "Copy"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(src).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
  }

  var hljsReady = loadHljs();
  boxes.forEach(function (box) {
    var info = parse(box.dataset.target);
    if (!info) return;
    box.innerHTML = '<p class="src-status">Loading ' + esc(info.path.split("/").pop()) + "…</p>";
    Promise.all([fetchFile(info.raw), hljsReady]).then(function (r) { render(box, info, r[0], r[1]); }, function () {
      box.innerHTML = '<p class="src-status">This code couldn\'t load. <a href="' + esc(info.href) + '">View it on GitHub</a>.</p>';
    });
  });
})();
