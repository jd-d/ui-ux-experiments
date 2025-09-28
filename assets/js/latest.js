// Latest briefings: robust + visible diagnostics (no <script> wrapper)
(function () {
  var container = document.getElementById('latest-cards');
  if (!container) return;

  var limitAttr = container.getAttribute('data-limit');
  var limit = parseInt(limitAttr || '6', 10) || 6;

  var postsBase = null;

  function setStatus(msg) {
    // visible status to help verify on the live site
    container.innerHTML = '<p aria-live="polite" style="opacity:.7">' + msg + '</p>';
  }

  function resolveLocationBase() {
    var loc = window.location;
    var origin = loc.origin || loc.protocol + '//' + loc.host;
    var path = loc.pathname || '/';
    if (!path.endsWith('/')) {
      var lastSlash = path.lastIndexOf('/');
      var lastSegment = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
      if (lastSegment && lastSegment.indexOf('.') === -1) {
        path += '/';
      } else {
        path = path.slice(0, Math.max(0, lastSlash + 1));
      }
    }
    return origin + path;
  }

  function ensurePostsBase() {
    if (postsBase) return postsBase;

    var script = document.currentScript;
    if (script && script.src) {
      try {
        postsBase = new URL('../..', script.src);
        return postsBase;
      } catch (error) {
        console.warn('[latest] unable to resolve base from script src', error);
      }
    }

    try {
      postsBase = resolveLocationBase();
      return postsBase;
    } catch (error) {
      console.warn('[latest] unable to resolve base from location', error);
    }

    return null;
  }

  function resolveDataUrl() {
    var cacheBustValue = Date.now().toString();
    var base = ensurePostsBase();
    if (base) {
      try {
        var dataUrl = new URL('data/latest_briefings.json', base);
        dataUrl.searchParams.set('v', cacheBustValue);
        return dataUrl.toString();
      } catch (error) {
        console.warn('[latest] unable to resolve URL from base', error);
      }
    }

    return 'data/latest_briefings.json?v=' + cacheBustValue;
  }

  var url = resolveDataUrl();

  setStatus('Loading latest briefings…');

  fetch(url, { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    })
    .then(function (data) {
      var items = (data && Array.isArray(data.items)) ? data.items.slice(0, limit) : [];
      if (!items.length) {
        setStatus('No recent briefings yet.');
        return;
      }
      container.innerHTML = items.map(function (it) {
        var date = it.as_of || '';
        var slug = it.slug || '';
        var title = it.title || '';
        var cluster = it.cluster || '';
        var href;
        try {
          var base = ensurePostsBase();
          if (base) {
            href = new URL('posts/' + slug + '.html', base).toString();
          } else {
            href = 'posts/' + slug + '.html';
          }
        } catch (_) {
          href = 'posts/' + slug + '.html';
        }
        return (
          '<article class="post-card">' +
            '<span class="post-card__date">' + date + '</span>' +
            '<h3><a href="' + href + '">' + title + '</a></h3>' +
            '<ul class="tag-list"><li class="tag">' + cluster + '</li></ul>' +
            '<a class="post-card__cta" href="' + href + '">Read the signal</a>' +
          '</article>'
        );
      }).join('');
    })
    .catch(function (err) {
      console.warn('[latest] failed:', err);
      setStatus('Latest briefings unavailable right now.');
    });
})();
