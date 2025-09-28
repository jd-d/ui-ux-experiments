(function () {
  'use strict';

  var currentScript = document.currentScript;

function resolveDataPath(relativePath) {
  if (!relativePath) return relativePath;

  var lastError = null;

  // 1) Try to resolve against the current page URL
  if (typeof window !== 'undefined' && window.location && window.location.href) {
    try {
      return new URL(relativePath, window.location.href).toString();
    } catch (error) {
      lastError = error;
    }
  }

  // 2) Fallback: resolve against the script URL
  if (currentScript && currentScript.src) {
    try {
      return new URL(relativePath, currentScript.src).toString();
    } catch (error) {
      lastError = error;
    }
  }

  // 3) If both failed, warn once with the last captured error
  if (lastError) {
    console.warn('[tag-archive] unable to resolve data path', lastError);
  }

  // 4) Final fallback: return the input unchanged
  return relativePath;
}

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return response.json();
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function normalizeLabel(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    text = text.replace(/[_\-]+/g, ' ');
    var upper = text.toUpperCase();
    if (text === upper) {
      return text;
    }
    return text
      .toLowerCase()
      .replace(/\b\w/g, function (match) {
        return match.toUpperCase();
      });
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      var date = new Date(value + 'T00:00:00Z');
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
    } catch (error) {
      return '';
    }
    return '';
  }

  function collectTagsFromItem(item, event) {
    var tags = [];
    function addTag(label, slugHint) {
      var labelText = normalizeLabel(label);
      var slug = slugify(slugHint || labelText);
      if (!slug || !labelText) return;
      tags.push({ slug: slug, label: labelText });
    }

    if (event) {
      if (event.cluster) {
        addTag(event.cluster, event.cluster);
      } else if (event.fingerprint_fields && event.fingerprint_fields.cluster) {
        addTag(event.fingerprint_fields.cluster, event.fingerprint_fields.cluster);
      }
      if (event.event_type) {
        addTag(event.event_type, event.event_type);
      }
    }

    if (item && item.cluster) {
      addTag(item.cluster, item.cluster);
    }

    if (item && Array.isArray(item.tags)) {
      item.tags.forEach(function (tag) {
        if (tag && tag.slug && tag.label) {
          tags.push({ slug: tag.slug, label: tag.label });
        }
      });
    }

    var seen = Object.create(null);
    return tags.filter(function (tag) {
      if (!tag.slug || seen[tag.slug]) {
        return false;
      }
      seen[tag.slug] = true;
      return true;
    });
  }

  function buildEventMap(eventsPayload) {
    var map = Object.create(null);
    if (!eventsPayload || !Array.isArray(eventsPayload.events)) {
      return map;
    }
    eventsPayload.events.forEach(function (event) {
      if (event && event.uid) {
        map[String(event.uid)] = event;
      }
    });
    return map;
  }

  function createCard(item) {
  var slug = item.slug || '';
  var href = slug ? '../posts/' + slug + '.html' : '#';
  var title = escapeHtml(item.title || slug || 'Untitled briefing');
  var dateLabel = formatDate(item.as_of);
  var cluster = '';
  if (item.cluster) {
    cluster =
      '<ul class="tag-list"><li class="tag">' + escapeHtml(item.cluster) + '</li></ul>';
  }
  var cta = slug ? 'Read the signal' : 'Read more';
  return (
    '<article class="post-card">' +
    '<span class="post-card__date">' + escapeHtml(dateLabel) + '</span>' +
    '<h3><a href="' + escapeHtml(href) + '">' + title + '</a></h3>' +
    cluster +
    '<a class="post-card__cta" href="' + escapeHtml(href) + '">' + escapeHtml(cta) + '</a>' +
    '</article>'
  );
}

  function renderCards(container, items) {
    if (!container) return;
    container.innerHTML = items.map(createCard).join('');
  }

  function labelFromSlug(slug) {
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function (match) {
        return match.toUpperCase();
      });
  }

  var params = new URLSearchParams(window.location.search || '');
  var tagSlug = params.get('tag');
  tagSlug = tagSlug ? tagSlug.toLowerCase().trim() : '';

  var titleEl = document.querySelector('[data-tag-title]');
  var subtitleEl = document.querySelector('[data-tag-subtitle]');
  var summaryEl = document.querySelector('[data-tag-summary]');
  var statusEl = document.querySelector('[data-tag-status]');
  var listEl = document.querySelector('[data-tag-list]');
  var breadcrumbEl = document.querySelector('[data-tag-breadcrumb]');

  if (!tagSlug) {
    if (statusEl) {
      statusEl.textContent = 'Append ?tag=your-topic to the URL to view matching briefings.';
    }
    return;
  }

  if (breadcrumbEl) {
    breadcrumbEl.hidden = false;
    breadcrumbEl.textContent = 'Tag · ' + labelFromSlug(tagSlug);
  }

  if (titleEl) {
    titleEl.textContent = 'Briefings tagged ' + labelFromSlug(tagSlug);
  }

  if (subtitleEl) {
    subtitleEl.textContent =
      'Loading briefings that share this tag. Use the navigation links on any briefing to explore others.';
  }

  Promise.all([
    fetchJson(resolveDataPath('../data/briefings_archive.json')).catch(function (error) {
      console.warn('[tag-archive] unable to load archive', error);
      return null;
    }),
    fetchJson(resolveDataPath('../data/events.json')).catch(function (error) {
      console.warn('[tag-archive] unable to load events', error);
      return null;
    }),
  ])
    .then(function (results) {
      var archivePayload = results[0];
      var eventsPayload = results[1];
      var archiveItems = archivePayload && Array.isArray(archivePayload.items)
        ? archivePayload.items
        : [];
      var eventMap = buildEventMap(eventsPayload);

      var matches = [];
      var tagLabel = '';

      archiveItems.forEach(function (item) {
        if (!item || !item.slug) return;
        var eventUid = item.event_uid ? String(item.event_uid) : null;
        var event = eventUid ? eventMap[eventUid] : null;
        var tags = collectTagsFromItem(item, event);
        if (!tags.length) return;
        tags.forEach(function (tag) {
          if (tag.slug === tagSlug) {
            matches.push(item);
            if (!tagLabel) {
              tagLabel = tag.label;
            }
          }
        });
      });

      if (!tagLabel) {
        tagLabel = labelFromSlug(tagSlug);
      }

      if (!matches.length) {
        if (summaryEl) {
          summaryEl.textContent = '';
        }
        if (statusEl) {
          statusEl.textContent = 'No briefings match the “' + tagLabel + '” tag yet.';
        }
        if (listEl) {
          listEl.innerHTML = '';
        }
        return;
      }

      matches.sort(function (a, b) {
        var aDate = a.as_of || '';
        var bDate = b.as_of || '';
        if (aDate === bDate) {
          return String(b.slug || '').localeCompare(String(a.slug || ''));
        }
        return aDate < bDate ? 1 : -1;
      });

      if (summaryEl) {
        var generated = archivePayload && archivePayload.generated_at
          ? formatDate(archivePayload.generated_at)
          : '';
        var parts = [
          matches.length + (matches.length === 1 ? ' briefing' : ' briefings') + ' tagged ' + tagLabel,
        ];
        if (generated) {
          parts.push('archive updated ' + generated);
        }
        summaryEl.textContent = parts.join(' · ');
      }

      if (statusEl) {
        statusEl.textContent = 'Showing ' + matches.length + ' result' + (matches.length === 1 ? '' : 's') + '.';
      }

      renderCards(listEl, matches);
    })
    .catch(function (error) {
      console.warn('[tag-archive] failed to load tag view', error);
      if (statusEl) {
        statusEl.textContent = 'Unable to load tagged briefings right now. Please try again later.';
      }
    });
})();
