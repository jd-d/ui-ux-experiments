(function () {
  var highlightRoot = document.querySelector('[data-hero-highlight]');
  if (!highlightRoot) return;

  var card = highlightRoot.querySelector('[data-hero-card]');
  if (!card) return;

  var scoreEl = card.querySelector('[data-hero-score]');
  var phaseEl = card.querySelector('[data-hero-phase]');
  var titleEl = card.querySelector('[data-hero-title]');
  var summaryEl = card.querySelector('[data-hero-summary]');
  var clusterEl = card.querySelector('[data-hero-cluster]');
  var updatedEl = card.querySelector('[data-hero-updated]');
  var meterEl = card.querySelector('[data-hero-meter]');
  var sourcesEl = card.querySelector('[data-hero-sources]');
  var linkEl = card.querySelector('[data-hero-link]');
  var dotsEl = card.querySelector('[data-hero-dots]');
  var statsRoot = document.querySelector('[data-hero-stats]');

  var statCountEl = statsRoot && statsRoot.querySelector('[data-hero-stat="count"]');
  var statScoreEl = statsRoot && statsRoot.querySelector('[data-hero-stat="top-score"]');
  var statAsOfEl = statsRoot && statsRoot.querySelector('[data-hero-stat="as-of"]');

  var state = {
    items: [],
    index: 0,
    timer: null,
  };

  var MS_IN_SECOND = 1000;
  var ROTATE_INTERVAL = 7 * MS_IN_SECOND;

  function resolveDataUrl(path) {
    var cacheBustValue = Date.now().toString();
    try {
      var base = window.location && window.location.href;
      if (base) {
        var url = new URL(path, base);
        url.searchParams.set('v', cacheBustValue);
        return url.toString();
      }
    } catch (error) {
      console.warn('[hero-highlight] unable to resolve URL for', path, error);
    }
    return path + '?v=' + cacheBustValue;
  }

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
    if (isNaN(date.getTime())) return value;
    try {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (error) {
      return value;
    }
  }

  function formatPhase(value) {
    if (!value) return 'Watch';
    var text = String(value).toLowerCase();
    if (text === 'critical') return 'Critical';
    if (text === 'elevated') return 'Elevated';
    if (text === 'watch') return 'Watch';
    return text.replace(/_/g, ' ').replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
  }

  function clampScore(value) {
    var num = Number(value);
    if (!isFinite(num)) return 0;
    if (num < 0) return 0;
    if (num > 100) return 100;
    return num;
  }

  function setStats(metadata, items) {
    if (statCountEl) {
      statCountEl.textContent = items.length ? String(items.length) : '--';
    }
    if (statScoreEl) {
      var topScore = items.reduce(function (max, item) {
        var score = clampScore(item.score);
        return score > max ? score : max;
      }, 0);
      statScoreEl.textContent = topScore ? Math.round(topScore).toString() : '--';
    }
    if (statAsOfEl) {
      statAsOfEl.textContent = metadata && metadata.as_of ? formatDate(metadata.as_of) : '--';
    }
  }

  function renderSources(sources) {
    if (!sourcesEl) return;
    sourcesEl.innerHTML = '';
    if (!Array.isArray(sources) || !sources.length) {
      sourcesEl.textContent = '';
      return;
    }
    var fragment = document.createDocumentFragment();
    sources.slice(0, 2).forEach(function (src) {
      if (!src) return;
      var url;
      try {
        url = new URL(src);
      } catch (error) {
        return;
      }
      var anchor = document.createElement('a');
      anchor.href = url.toString();
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = url.hostname.replace(/^www\./i, '');
      fragment.appendChild(anchor);
    });
    sourcesEl.appendChild(fragment);
  }

  function clearTimer() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  function activateTimer() {
    clearTimer();
    if (state.items.length <= 1) return;
    state.timer = window.setInterval(function () {
      showHighlight((state.index + 1) % state.items.length);
    }, ROTATE_INTERVAL);
  }

  function updateDots() {
    if (!dotsEl) return;
    dotsEl.querySelectorAll('.hero-highlight__dot').forEach(function (dot, idx) {
      dot.setAttribute('aria-current', idx === state.index ? 'true' : 'false');
    });
  }

  function createDots() {
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    var fragment = document.createDocumentFragment();
    state.items.forEach(function (_, idx) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'hero-highlight__dot';
      button.setAttribute('aria-label', 'Show highlight ' + (idx + 1));
      button.addEventListener('click', function () {
        showHighlight(idx);
        activateTimer();
      });
      fragment.appendChild(button);
    });
    dotsEl.appendChild(fragment);
  }

  function setPhaseClass(phase) {
    var normalized = String(phase || '').toLowerCase();
    card.classList.remove(
      'hero-highlight__card--phase-watch',
      'hero-highlight__card--phase-elevated',
      'hero-highlight__card--phase-critical'
    );
    if (normalized === 'critical') {
      card.classList.add('hero-highlight__card--phase-critical');
    } else if (normalized === 'elevated') {
      card.classList.add('hero-highlight__card--phase-elevated');
    } else if (normalized) {
      card.classList.add('hero-highlight__card--phase-watch');
    }
  }

  function showHighlight(index) {
    if (!state.items.length) return;
    var safeIndex = index % state.items.length;
    if (safeIndex < 0) {
      safeIndex = 0;
    }
    var item = state.items[safeIndex];
    state.index = safeIndex;

    if (scoreEl) {
      scoreEl.textContent = Math.round(clampScore(item.score)).toString();
    }
    if (phaseEl) {
      var phaseText = formatPhase(item.phase);
      phaseEl.textContent = phaseText;
      phaseEl.className = 'hero-highlight__badge';
      if (item.phase) {
        phaseEl.classList.add('hero-highlight__badge--' + String(item.phase).toLowerCase());
      }
    }
    if (titleEl) {
      titleEl.textContent = item.name || 'Trigger risk update';
    }
    if (summaryEl) {
      summaryEl.textContent = item.summary || 'Fresh trigger risk intelligence will display here soon.';
    }
    if (clusterEl) {
      clusterEl.textContent = item.cluster ? 'Cluster: ' + item.cluster : '';
    }
    if (updatedEl) {
      updatedEl.textContent = item.last_updated ? 'Updated ' + formatDate(item.last_updated) : '';
    }
    if (meterEl) {
      meterEl.style.width = clampScore(item.score) + '%';
    }
    renderSources(item.sources);
    if (linkEl) {
      if (item.slug) {
        linkEl.href = 'posts/' + item.slug + '.html';
        linkEl.setAttribute('aria-label', 'Open "' + item.name + '" briefing');
      } else {
        linkEl.href = '#leaderboard';
        linkEl.setAttribute('aria-label', 'View leaderboard for more detail');
      }
    }

    setPhaseClass(item.phase);
    updateDots();
  }

  function enrichHighlights(items, archive) {
    if (!archive || !Array.isArray(archive.items)) {
      return items;
    }
    var byTitle = {};
    archive.items.forEach(function (entry) {
      if (!entry || !entry.title) return;
      byTitle[String(entry.title).toLowerCase()] = entry;
    });
    return items.map(function (item) {
      var key = String(item.name || '').toLowerCase();
      var match = byTitle[key];
      if (!match) return item;
      return Object.assign({}, item, {
        summary: match.summary || item.summary,
        slug: match.slug || item.slug,
      });
    });
  }

  function ingestData(payload, archive) {
    if (!payload || !Array.isArray(payload.risks)) {
      return;
    }
    var top = payload.risks.slice(0, 5).map(function (risk) {
      return {
        id: risk.id,
        name: risk.name,
        score: risk.score,
        phase: risk.phase,
        cluster: risk.cluster,
        last_updated: risk.last_updated,
        sources: risk.sources || [],
        summary: risk.summary || '',
        slug: risk.slug,
      };
    });
    var enriched = enrichHighlights(top, archive);
    state.items = enriched;
    setStats(payload, enriched);
    createDots();
    showHighlight(0);
    activateTimer();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimer();
    } else {
      activateTimer();
    }
  }

  function fetchJson(path) {
    return fetch(resolveDataUrl(path), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status + ' for ' + path);
        }
        return response.json();
      })
      .catch(function (error) {
        console.warn('[hero-highlight] failed to load', path, error);
        return null;
      });
  }

  Promise.all([
    fetchJson('data/leaderboard.json'),
    fetchJson('data/briefings_archive.json'),
  ]).then(function (results) {
    var leaderboard = results[0];
    var archive = results[1];
    if (!leaderboard) {
      if (summaryEl) {
        summaryEl.textContent = 'Leaderboard data is temporarily unavailable.';
      }
      return;
    }
    ingestData(leaderboard, archive);
  });

  document.addEventListener('visibilitychange', handleVisibilityChange);
})();
