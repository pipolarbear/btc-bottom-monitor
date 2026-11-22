/* BTC Value Monitor: colour palettes and setup links. Loads first on every page. */
(function () {
  "use strict";
  var KEY = "bbm.pal", root = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  // ----- setup link: #setup=<base64url JSON> copies someone's layout, colours and settings into this browser -----
  var SETUP_KEYS = { l: "bbm.layout", o: "bbm.order", p: "bbm.pal", c: "bbm.cw", s: "bbm.skin", v: "bbm.levels", b: "bbm.cb", w: "bbm.since" };
  function b64e(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64d(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
  function setupLink() {
    var o = {}; Object.keys(SETUP_KEYS).forEach(function (k) { var v = get(SETUP_KEYS[k]); if (v != null) o[k] = v; });
    return location.origin + location.pathname + "#setup=" + b64e(JSON.stringify(o));
  }
  var imported = false;
  try {
    var m = /#setup=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      var o = JSON.parse(b64d(m[1]));
      Object.keys(SETUP_KEYS).forEach(function (k) { put(SETUP_KEYS[k], typeof o[k] === "string" ? o[k] : null); });
      imported = true;
      history.replaceState(null, "", location.pathname + location.search);
      var sk = get("bbm.skin"); if (sk) { if (sk === "auto") sk = matchMedia("(prefers-color-scheme: light)").matches ? "daylight" : "midnight"; root.setAttribute("data-skin", sk); root.setAttribute("data-light", sk === "daylight" || sk === "paper" ? "1" : "0"); }
      root.setAttribute("data-cb", get("bbm.cb") === "1" ? "1" : "0");
    }
  } catch (e) {}
  // a setup link pasted into a tab that already shows the page changes only the #: load the page again to apply it
  window.addEventListener("hashchange", function () { if (/#setup=/.test(location.hash)) location.reload(); });

  // ----- colour maths: sRGB <-> OKLab -----
  function hex2rgb(h) { h = String(h).replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }
  function rgb2hex(c) { return "#" + c.map(function (v) { v = Math.round(Math.max(0, Math.min(1, v)) * 255); return (v < 16 ? "0" : "") + v.toString(16); }).join("").toUpperCase(); }
  function lin(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function gam(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function rgb2lab(c) {
    var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function lab2rgb(L) {
    var l = Math.pow(L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], 3), m = Math.pow(L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], 3), s = Math.pow(L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2], 3);
    return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }
  function mix(a, b, t) { var A = rgb2lab(hex2rgb(a)), B = rgb2lab(hex2rgb(b)); return rgb2hex(lab2rgb([0, 1, 2].map(function (i) { return A[i] + (B[i] - A[i]) * t; }))); }
  // six steps from low to high, through a middle colour if one is given
  function gen(lo, mid, hi) {
    var out = [];
    for (var i = 0; i < 6; i++) {
      var t = i / 5;
      out.push(!mid ? mix(lo, hi, t) : t < 0.5 ? mix(lo, mid, t / 0.5) : mix(mid, hi, (t - 0.5) / 0.5));
    }
    if (mid) { out[2] = mix(lo, mid, 0.8); out[3] = mix(mid, hi, 0.2); }
    return out;
  }
  // keep each step readable on the background: lighten on dark skins, darken on light skins
  function fit(c, light) {
    var L = rgb2lab(hex2rgb(c)); var lo = light ? 0.36 : 0.56, hi = light ? 0.80 : 0.93;
    if (L[0] < lo) L[0] = lo; else if (L[0] > hi) L[0] = hi; else return String(c).toUpperCase();
    return rgb2hex(lab2rgb(L));
  }
  // colour-blind check: smallest gap between neighbouring steps as people with red-green colour blindness see them
  var CVD = { deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]], protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]] };
  function sim(c, M) { var r = hex2rgb(c).map(lin), o = M.map(function (row) { return row[0] * r[0] + row[1] * r[1] + row[2] * r[2]; }); return rgb2lab(o.map(function (v) { return gam(Math.max(0, Math.min(1, v))); })); }
  function de(a, b) { return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)); }
  function check(steps) {
    var res = {};
    ["deutan", "protan"].forEach(function (k) { var s = steps.map(function (c) { return sim(c, CVD[k]); }), m = 9; for (var i = 1; i < s.length; i++) m = Math.min(m, de(s[i - 1], s[i])); res[k] = m; });
    var n = steps.map(function (c) { return rgb2lab(hex2rgb(c)); }), mn = 9; for (var i = 1; i < n.length; i++) mn = Math.min(mn, de(n[i - 1], n[i]));
    res.normal = mn; res.worst = Math.min(res.deutan, res.protan);
    res.word = res.worst >= 0.06 ? "Good" : res.worst >= 0.035 ? "Fair" : "Poor";
    return res;
  }

  // ----- suggested pairings (low = not cheap, high = cheap) -----
  var PRESETS = [
    { id: "default", name: "Red to blue", note: "The default. Warm for not cheap, cool for cheap.", dark: ["#E5484D", "#F08A6C", "#F2C6A9", "#A9CFEF", "#5FA8EA", "#2F7FE0"], light: ["#C62F2C", "#E3755B", "#EDB89E", "#9DC3E6", "#4A8ED2", "#1C5DAD"] },
    { id: "cb", name: "Colour-blind safe", note: "Purple to green (viridis). Safe for all common colour blindness. Same as the eye button.", dark: ["#46337E", "#365C8D", "#277F8E", "#1FA187", "#4AC16D", "#9FDA3A"], light: ["#46337E", "#365C8D", "#277F8E", "#1FA187", "#4AC16D", "#9FDA3A"] },
    { id: "teal", name: "Orange to teal", note: "Warm to cool with a soft middle.", dark: ["#F2711C", "#F79D5C", "#F6CDA8", "#A6DCD3", "#46C1AE", "#13A08E"], light: ["#C2410C", "#E0762F", "#E2AA80", "#80C4B9", "#2A9A89", "#0B7A6E"] },
    { id: "pink", name: "Magenta to green", note: "Classic map pairing (PiYG). Strong ends, easy to tell apart.", dark: ["#E0408A", "#EB7FB0", "#F1BED5", "#BCE2A4", "#86C760", "#58A632"], light: ["#B8165F", "#D45A8E", "#DDA0BC", "#97C67C", "#5FA63F", "#3A7D1F"] },
    { id: "earth", name: "Brown to teal", note: "Earthy and calm (BrBG). Good on paper and print.", dark: ["#D08A3A", "#E0AE6A", "#ECD4A8", "#A8DCD2", "#52B5A8", "#1F8F83"], light: ["#8C510A", "#B97A2A", "#D2B07A", "#7FC4B8", "#35978F", "#01665E"] },
    { id: "mono", name: "Grey to blue", note: "One colour. The deeper the blue, the cheaper. Calm, no red.", dark: ["#6F7785", "#7E8EA6", "#8DA6C8", "#7FB0EE", "#4E95EF", "#2F7FE0"], light: ["#9AA1AC", "#8697B1", "#6F8EBF", "#4F86CF", "#2C6CC8", "#1C5DAD"] },
    { id: "sunset", name: "Plum to gold", note: "Cool for not cheap, warm gold for cheap. A reversed feel.", dark: ["#9B6BD3", "#B98AD6", "#D9B3D8", "#F3D19C", "#F5B44A", "#EE9A12"], light: ["#6C3FA5", "#8E5EB0", "#B98BB8", "#D6A85C", "#C98A1E", "#A86B00"] }
  ];
  function presetById(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return null; }
  function load() { try { var o = JSON.parse(get(KEY) || "null"); if (o && (presetById(o.id) || (o.id === "custom" && o.c))) return o; } catch (e) {} return { id: "default" }; }
  function stepsOf(o, light) {
    if (o.id === "custom") { var c = o.c, base = c.steps && c.steps.length === 6 ? c.steps : gen(c.lo, c.useMid ? c.mid : null, c.hi); return c.fit === false ? base.slice() : base.map(function (x) { return fit(x, light); }); }
    var p = presetById(o.id) || PRESETS[0]; return (light ? p.light : p.dark).slice();
  }
  var st = document.createElement("style"); st.id = "bvm-pal"; (document.head || root).appendChild(st);
  function apply(o) {
    o = o || load();
    if (o.id === "default" || o.id === "cb") { root.removeAttribute("data-pal"); st.textContent = ""; }
    else {
      var d = stepsOf(o, false), l = stepsOf(o, true);
      function css(a) { return a.map(function (c, i) { return "--b" + i + ":" + c; }).join(";"); }
      st.textContent = ':root[data-pal="1"][data-light="0"]{' + css(d) + '}:root[data-pal="1"][data-light="1"]{' + css(l) + "}";
      root.setAttribute("data-pal", "1");
    }
    return o;
  }
  function save(o) { put(KEY, o && o.id !== "default" ? JSON.stringify(o) : null); }
  var cur = load();
  if (cur.id === "cb" && get("bbm.cb") !== "1") cur = { id: "default" };
  apply(cur);
  window.BVMPrefs = { PRESETS: PRESETS, load: load, save: save, apply: apply, stepsOf: stepsOf, gen: gen, fit: fit, check: check, mix: mix, setupLink: setupLink, imported: imported };
})();
