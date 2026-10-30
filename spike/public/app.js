(function () {
  var lines = [];
  function add(k, v) { lines.push(k + '=' + v); }
  function safe(fn, fb) { try { return fn(); } catch (e) { return 'ERR:' + e.message; } }
  function sz(id) {
    var e = document.getElementById(id);
    if (!e) return 'missing';
    return safe(function () {
      var r = e.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    }, 'nom');
  }
  window.onerror = function (m, u, l) { lines.push('jsError=' + m + '@' + l); };

  var de = document.documentElement;
  var now = new Date();
  add('ua', navigator.userAgent);
  add('appVersion', navigator.appVersion);
  add('platform', navigator.platform);
  add('language', navigator.language);
  add('href', location.href);
  add('protocol', location.protocol);
  add('screen', screen.width + 'x' + screen.height);
  add('avail', screen.availWidth + 'x' + screen.availHeight);
  add('inner', window.innerWidth + 'x' + window.innerHeight);
  add('client', de.clientWidth + 'x' + de.clientHeight);
  add('dpr', typeof window.devicePixelRatio === 'undefined' ? 'undefined' : window.devicePixelRatio);
  add('bodySize', document.body.offsetWidth + 'x' + document.body.offsetHeight);
  add('domNodes', document.getElementsByTagName('*').length);
  add('clientTime', now.toString());
  add('skewMs', now.getTime() - (typeof SERVER_TIME === 'number' ? SERVER_TIME : 0));
  add('tzOffset', now.getTimezoneOffset());

  var feats = ['JSON', 'fetch', 'Promise', 'EventSource', 'WebSocket', 'FormData', 'XMLHttpRequest', 'matchMedia', 'localStorage', 'sessionStorage', 'history', 'JSON'];
  var i;
  for (i = 0; i < feats.length; i++) {
    add('has.' + feats[i], typeof window[feats[i]]);
  }
  if (window.matchMedia) {
    add('mq.max1072', window.matchMedia('(max-width:1072px)').matches);
    add('mq.min1073', window.matchMedia('(min-width:1073px)').matches);
    add('mq.portrait', window.matchMedia('(orientation:portrait)').matches);
    add('mq.dpr2', window.matchMedia('(-webkit-min-device-pixel-ratio:2)').matches);
  }
  add('flex', safe(function () {
    var b = document.getElementById('flexbox');
    if (!b || b.children.length < 2) return 'no-el';
    return (b.children[1].offsetLeft - b.children[0].offsetLeft) > 50 ? 'yes' : 'no';
  }, 'ERR'));
  add('grid', safe(function () {
    var b = document.getElementById('gridbox');
    if (!b || b.children.length < 2) return 'no-el';
    return (b.children[1].offsetLeft - b.children[0].offsetLeft) > 50 ? 'yes' : 'no';
  }, 'ERR'));

  var svgs = document.getElementsByTagName('svg');
  add('svgCount', svgs.length);
  add('svg0.box', safe(function () { var r = svgs[0].getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }, 'ERR'));
  add('svg0.bbox', safe(function () { return svgs[0].getBBox ? 'has' : 'no'; }, 'ERR'));
  add('svg1.box', safe(function () { var r = svgs[1].getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }, 'ERR'));
  add('scrollH', document.body.scrollHeight + '/' + de.scrollHeight);
  add('ruler100', safe(function () { var d = document.getElementById('ruler'); var r = d.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }, 'ERR'));
  add('imgSvg', safe(function () {
    var im = document.getElementById('imgsvg');
    return im.offsetWidth + 'x' + im.offsetHeight + ' complete=' + im.complete;
  }, 'ERR'));

  add('cookie0', document.cookie);
  add('cookie1', safe(function () {
    document.cookie = 'kindle_probe=1; path=/';
    return document.cookie;
  }, 'ERR'));
  add('localStorage', safe(function () {
    window.localStorage.setItem('kprobe', 'v1');
    return window.localStorage.getItem('kprobe');
  }, 'ERR'));

  var rep = document.getElementById('report');
  if (rep) rep.innerHTML = lines.join('\n');

  function send(path, body, cb) {
    var x = new XMLHttpRequest();
    x.open('POST', path, true);
    x.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
    x.onreadystatechange = function () {
      if (x.readyState === 4) cb(x.status, x.responseText);
    };
    x.send(body);
  }

  function upload() {
    var payload = { ua: navigator.userAgent, href: location.href, ts: new Date().getTime(), lines: lines };
    safe(function () {
      send('/report', JSON.stringify(payload), function (st, txt) {
        var m = document.getElementById('upmsg');
        if (m) m.innerHTML = (st >= 200 && st < 300) ? '已上传 OK' : ('上传失败 ' + st);
      });
    }, 'sendfail');
  }
  upload();

  var n = 0;
  var btn = document.getElementById('btn');
  if (btn) btn.onclick = function () { n++; document.getElementById('cnt').innerHTML = String(n); };

  var link = document.getElementById('link');
  if (link) link.onclick = function () {
    document.getElementById('linkmsg').innerHTML = 'click-ok';
    return false;
  };

  var ta = document.getElementById('ta');
  var pal = document.getElementById('pal');
  if (pal && ta) {
    var bs = pal.getElementsByTagName('button');
    for (i = 0; i < bs.length; i++) {
      bs[i].onclick = function () {
        var t = this.getAttribute('data-i');
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        ta.value = v.substring(0, s) + t + v.substring(e);
        var caret = s + t.length;
        var idx = t.indexOf('{}');
        if (idx >= 0) caret = s + idx + 1;
        if (ta.setSelectionRange) ta.setSelectionRange(caret, caret);
        return false;
      };
    }
  }

  var echo = document.getElementById('echo');
  if (echo) echo.onclick = function () {
    var m = document.getElementById('echomsg');
    safe(function () {
      send('/echo', ta ? ta.value : '', function (st, txt) {
        m.innerHTML = st === 200 ? ('回环OK len=' + txt.length) : ('回环失败 ' + st);
      });
    }, 'ERR');
  };

  var again = document.getElementById('again');
  if (again) again.onclick = function () { lines.length = 0; location.reload(); };
})();
