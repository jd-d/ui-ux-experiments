// Latest briefings: rich summaries and visual cues
(function () {
  var container = document.getElementById('latest-cards');
  if (!container) return;

  var limitAttr = container.getAttribute('data-limit');
  var limit = parseInt(limitAttr || '6', 10) || 6;

  var postsBase = null;
  var clusterVisuals = {
    SHIPPING: { icon: '🚢', theme: 'ocean' },
    EURO_SOV: { icon: '💶', theme: 'sovereign' },
    US_CRE: { icon: '🏢', theme: 'credit' },
    CHINA_CREDIT: { icon: '💴', theme: 'asia' },
    ODTE: { icon: '📉', theme: 'volatility' },
    AI_POWER: { icon: '⚡', theme: 'energy' },
    AGRITECH: { icon: '🌾', theme: 'growth' },
    DEFAULT: { icon: '📊', theme: 'default' },
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      date = new Date(value);
    }
    if (isNaN(date.getTime())) {
      return escapeHtml(value);
    }
    try {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (_) {
      return escapeHtml(value);
    }
  }

  function formatClusterLabel(value) {
    if (!value) return '';
    var text = String(value);
    if (text === text.toUpperCase()) return text;
    return text.replace(/_/g, ' ').replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function resolveVisual(cluster) {
    var key = (cluster || '').toUpperCase();
    if (clusterVisuals[key]) return clusterVisuals[key];
    return clusterVisuals.DEFAULT;
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

  function setStatus(msg) {
    container.innerHTML = '<p aria-live="polite" style="opacity:.7">' + escapeHtml(msg) + '</p>';
  }

  function renderTags(clusterLabel, tags) {
    var unique = [];
    var seen = {};
    if (clusterLabel) {
      unique.push(clusterLabel);
      seen[clusterLabel.toLowerCase()] = true;
    }
    if (Array.isArray(tags)) {
      for (var i = 0; i < tags.length; i += 1) {
        var label = tags[i] && (tags[i].label || tags[i].name);
        if (!label) continue;
        var key = String(label).toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        unique.push(String(label));
        if (unique.length >= 3) break;
      }
    }
    if (!unique.length) return '';
    return (
      '<ul class="tag-list">' +
      unique
        .map(function (label) {
          return '<li class="tag">' + escapeHtml(label) + '</li>';
        })
        .join('') +
      '</ul>'
    );
  }

  function resolveHref(slug) {
    var target = 'posts/' + slug + '.html';
    if (!slug) return target;
    try {
      var base = ensurePostsBase();
      if (base) {
        return new URL(target, base).toString();
      }
    } catch (error) {
      console.warn('[latest] unable to resolve href', error);
    }
    return target;
  }

  function renderCard(item) {
    var slug = item.slug || '';
    var href = resolveHref(slug);
    var title = item.title || slug || 'Briefing';
    var summary = item.summary || '';
    var cluster = item.cluster || '';
    var clusterLabel = formatClusterLabel(cluster);
    var dateLabel = formatDate(item.as_of || '');
    var visual = resolveVisual(cluster);
    var iconLabel = clusterLabel ? clusterLabel + ' signal' : 'Trigger signal';

    return (
      '<article class="post-card post-card--enhanced post-card--theme-' +
      escapeHtml(visual.theme) +
      '">' +
        '<a class="post-card__visual" href="' +
        escapeHtml(href) +
        '" tabindex="-1" aria-hidden="true">' +
        '<span class="post-card__glyph" aria-hidden="true">' +
        escapeHtml(visual.icon) +
        '</span>' +
        '<span class="sr-only">' + escapeHtml(iconLabel) + '</span>' +
        '</a>' +
        '<div class="post-card__body">' +
        (dateLabel ? '<span class="post-card__date">' + escapeHtml(dateLabel) + '</span>' : '') +
        '<h3><a href="' + escapeHtml(href) + '">' + escapeHtml(title) + '</a></h3>' +
        (summary ? '<p class="post-card__summary">' + escapeHtml(summary) + '</p>' : '') +
        renderTags(clusterLabel, item.tags) +
        '<a class="post-card__cta" href="' + escapeHtml(href) + '">Read the signal</a>' +
        '</div>' +
      '</article>'
    );
  }

  var url = resolveDataUrl();
  setStatus('Loading latest briefings…');

  fetch(url, { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' for ' + url);
      }
      return response.json();
    })
    .then(function (data) {
      var items = (data && Array.isArray(data.items)) ? data.items.slice(0, limit) : [];
      if (!items.length) {
        setStatus('No recent briefings yet.');
        return;
      }
      container.innerHTML = items.map(renderCard).join('');
    })
    .catch(function (error) {
      console.warn('[latest] failed:', error);
      setStatus('Latest briefings unavailable right now.');
    });
})();
