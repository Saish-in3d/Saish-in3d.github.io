// Procedural marble, a WebGL port of the idea behind FS2L6_ProceduralMarbleCS.
// Colors come from the page's CSS variables, so it follows light and dark mode.
(function () {
  var canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  var gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return; // the CSS gradient on the canvas stays as the fallback

  var vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  var fs = [
    'precision mediump float;',
    'uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uBase; uniform vec3 uVein; uniform vec3 uAccent;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);',
    '}',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes.y;',
    '  float t = uTime * 0.04;',
    '  vec2 q = vec2(fbm(uv * 2.0 + t), fbm(uv * 2.0 - t + 5.2));',
    '  float turb = fbm(uv * 3.0 + 2.5 * q);',
    '  float m = sin((uv.x + uv.y) * 6.0 + turb * 9.0);',
    '  float vein = pow(1.0 - abs(m), 10.0);',
    '  float hot = pow(1.0 - abs(sin((uv.x - uv.y) * 4.0 + turb * 7.0 + 1.3)), 26.0);',
    '  vec3 col = mix(uBase, uVein, vein * 0.85 + turb * 0.12);',
    '  col = mix(col, uAccent, hot * 0.9);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'uRes'), uTime = gl.getUniformLocation(prog, 'uTime');
  var uBase = gl.getUniformLocation(prog, 'uBase'), uVein = gl.getUniformLocation(prog, 'uVein'), uAccent = gl.getUniformLocation(prog, 'uAccent');

  function hex(name) {
    var h = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function setColors() {
    gl.uniform3fv(uBase, hex('--surface'));
    gl.uniform3fv(uVein, hex('--teal'));
    gl.uniform3fv(uAccent, hex('--accent'));
  }
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(uRes, w, h);
  }
  function draw(ms) { resize(); gl.uniform1f(uTime, ms / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  setColors();
  var still = window.matchMedia('(prefers-reduced-motion: reduce)');
  var scheme = window.matchMedia('(prefers-color-scheme: dark)');
  if (scheme.addEventListener) scheme.addEventListener('change', function () { setColors(); draw(performance.now()); });

  var visible = true, raf = 0;
  function loop(ms) { draw(ms); raf = visible ? requestAnimationFrame(loop) : 0; }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting;
      if (visible && !raf && !still.matches) raf = requestAnimationFrame(loop);
    }).observe(canvas);
  }
  window.addEventListener('resize', function () { if (still.matches) draw(20000); });

  if (still.matches) draw(20000); else raf = requestAnimationFrame(loop);
})();
