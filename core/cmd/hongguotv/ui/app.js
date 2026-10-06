(function () {
  'use strict';

  // TV remote buttons are routed by semantic zones. A geometry-only algorithm
  // can jump from the sidebar to a right-side action just because it is close
  // on screen, which is especially confusing on a TV.
  var zoneSelectors = {
    sidebar: '.side-item',
    channels: '.channel-tab',
    feed: '.hero-feed-focus',
    catalog: '.catalog-card',
    actions: '.round-action',
    controls: '.control-button',
    searchInput: '#search-input',
    searchActions: '.search-action',
    searchFilters: '.search-filter',
    searchResults: '.search-result-card',
    modalActions: '.modal-action',
    episodes: '.detail-episode'
  };
  var status = document.getElementById('core-status');
  var notice = document.getElementById('action-notice');
  var shell = document.querySelector('.app-shell');
  var mainSurface = document.getElementById('main-surface');
  var pagePlaceholder = document.getElementById('page-placeholder');
  var detailModal = document.getElementById('detail-modal');
  var detailModalOpen = false;
  var detailReturnFocus = null;
  var currentDetail = null;
  var lastContentFocus = null;
  var lastPageFocus = {};
  var catalogGeneration = 0;
  var featuredItem = null;
  var feedItems = [];
  var feedIndex = -1;
  var feedGeneration = 0;
  var searchGeneration = 0;
  var searchInput = document.getElementById('search-input');
  var searchPage = document.getElementById('search-page');
  var searchResults = document.getElementById('search-results');
  var playerReturnPage = null;
  var playerReturnFocus = null;
  var keyNames = {
    19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft', 22: 'ArrowRight',
    23: 'Enter', 66: 'Enter', 4: 'Escape', 111: 'Escape'
  };
  var channelPaths = {
    'channel-follow': '/rank/hot-drama',
    'channel-comic': '/category/comic-drama',
    'channel-real': '/category/real-drama',
    'channel-recommend': '/rank/hot-drama'
  };

  function pageMode() {
    return shell && shell.dataset.mode ? shell.dataset.mode : 'recommend';
  }

  function focusables(selector) {
    var result = [];
    var query = selector || Object.keys(zoneSelectors).map(function (zone) { return zoneSelectors[zone]; }).join(',');
    Array.prototype.forEach.call(document.querySelectorAll(query), function (element) {
      var style = window.getComputedStyle(element);
      var insideModal = element.closest && element.closest('#detail-modal');
      if (detailModalOpen ? !insideModal : insideModal) return;
      if (!element.getClientRects || !element.getClientRects().length) return;
      if (!element.disabled && style.display !== 'none' && style.visibility !== 'hidden') result.push(element);
    });
    return result;
  }

  function firstVisible(selector) {
    return focusables(selector)[0] || null;
  }

  function markFocus(element) {
    document.querySelectorAll('.is-focused').forEach(function (node) { node.classList.remove('is-focused'); });
    if (element) element.classList.add('is-focused');
  }

  function zoneOf(element) {
    if (!element) return '';
    if (element.classList.contains('side-item')) return 'sidebar';
    if (element.classList.contains('channel-tab')) return 'channels';
    if (element.classList.contains('hero-feed-focus')) return 'feed';
    if (element.classList.contains('catalog-card')) return 'catalog';
    if (element.classList.contains('round-action')) return 'actions';
    if (element.classList.contains('control-button')) return 'controls';
    if (element.id === 'search-input') return 'searchInput';
    if (element.classList.contains('search-action')) return 'searchActions';
    if (element.classList.contains('search-filter')) return 'searchFilters';
    if (element.classList.contains('search-result-card')) return 'searchResults';
    if (element.classList.contains('detail-episode')) return 'episodes';
    if (element.classList.contains('modal-action')) return 'modalActions';
    if (element.classList.contains('page-placeholder-action')) return 'placeholder';
    if (element.classList.contains('primary-action')) return 'hero';
    return '';
  }

  function goFocus(element) {
    if (!element) return;
    element.focus({ preventScroll: false });
    markFocus(element);
    if (!detailModalOpen && zoneOf(element) !== 'sidebar') {
      lastContentFocus = element;
      lastPageFocus[pageMode()] = element;
    }
  }

  function firstContentFocus() {
    if (pageMode() === 'search') return searchInput || document.querySelector('.search-submit');
    if (pageMode() === 'player') return document.querySelector('.hero-feed-focus');
    if (pageMode() !== 'recommend') return document.querySelector('.page-placeholder-action');
    var remembered = lastPageFocus[pageMode()];
    if (remembered && document.contains(remembered) && !remembered.disabled) return remembered;
    return document.querySelector('.hero-feed-focus') || document.querySelector('.channel-tab.is-active') || document.querySelector('.catalog-card') || firstVisible('.primary-action');
  }

  function activeSidebar() {
    return document.querySelector('.side-item.is-active') || document.querySelector('.side-item');
  }

  function activeChannel() {
    return document.querySelector('.channel-tab.is-active') || document.querySelector('.channel-tab');
  }

  function firstCatalog() {
    return document.querySelector('.catalog-card');
  }

  function firstSearchFilter() {
    return firstVisible('.search-filter');
  }

  function firstSearchResult() {
    return firstVisible('.search-result-card');
  }

  function moveSearchFilter(current, direction) {
    var row = current && current.closest ? current.closest('.filter-row') : null;
    if (!row) return null;
    var items = focusables('.filter-row[data-filter-group="' + row.dataset.filterGroup + '"] .search-filter');
    if (direction === 'left' || direction === 'right') {
      var index = items.indexOf(current);
      if (index < 0) return items[0] || null;
      index += direction === 'left' ? -1 : 1;
      return items[index] || null;
    }
    var rows = [];
    document.querySelectorAll('.filter-row[data-filter-group]').forEach(function (node) { rows.push(node); });
    var rowIndex = rows.indexOf(row);
    var targetRowIndex = rowIndex + (direction === 'up' ? -1 : 1);
    if (targetRowIndex < 0) return searchInput;
    if (targetRowIndex >= rows.length) return firstSearchResult();
    var targetItems = focusables('.filter-row[data-filter-group="' + rows[targetRowIndex].dataset.filterGroup + '"] .search-filter');
    if (!targetItems.length) return null;
    var currentRect = current.getBoundingClientRect();
    var best = targetItems[0];
    var bestDistance = Infinity;
    targetItems.forEach(function (node) {
      var distance = Math.abs(node.getBoundingClientRect().left - currentRect.left);
      if (distance < bestDistance) { bestDistance = distance; best = node; }
    });
    return best;
  }

  function moveWithinZone(zone, current, direction) {
    var items = focusables(zoneSelectors[zone]);
    var index = items.indexOf(current);
    if (index < 0) return items[0] || null;
    if (direction === 'up' || direction === 'left') index -= 1;
    if (direction === 'down' || direction === 'right') index += 1;
    return items[index] || null;
  }

  function moveGrid(selector, current, direction) {
    var currentRect = current && current.getBoundingClientRect ? current.getBoundingClientRect() : null;
    if (!currentRect) return null;
    var candidates = focusables(selector).filter(function (node) { return node !== current; });
    var vertical = direction === 'up' || direction === 'down';
    var best = null;
    var bestScore = Infinity;
    candidates.forEach(function (node) {
      var rect = node.getBoundingClientRect();
      var rowDelta = direction === 'down' ? rect.top - currentRect.top : currentRect.top - rect.top;
      if (vertical && rowDelta <= 8) return;
      if (!vertical) return;
      var horizontal = Math.abs(rect.left - currentRect.left);
      var score = rowDelta * 100 + horizontal;
      if (score < bestScore) { bestScore = score; best = node; }
    });
    return best;
  }

  function moveModalFrom(current, direction) {
    var zone = zoneOf(current);
    if (zone === 'modalActions') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction);
      if (direction === 'down') return document.querySelector('.detail-episode');
      return null;
    }
    if (zone === 'episodes') {
      if (direction === 'left' || direction === 'right') {
        var episodeTarget = moveWithinZone(zone, current, direction);
        return episodeTarget || (direction === 'left' ? document.querySelector('.detail-close') : null);
      }
      if (direction === 'up') return document.querySelector('.detail-play') || document.querySelector('.detail-close');
      return null;
    }
    return null;
  }

  function moveFrom(current, direction) {
    if (detailModalOpen) return moveModalFrom(current, direction);
    var zone = zoneOf(current);
    if (zone === 'sidebar') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'right') return firstContentFocus();
      return null;
    }
    if (zone === 'channels') {
      if (direction === 'left' || direction === 'right') {
        var channelTarget = moveWithinZone(zone, current, direction);
        return channelTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'down') return firstVisible('.hero-feed-focus') || firstCatalog() || firstVisible('.primary-action');
      if (direction === 'up') return activeSidebar();
      return null;
    }
    if (zone === 'feed') {
      if (direction === 'left') return activeSidebar();
      if (direction === 'right') return firstVisible('.round-action') || firstVisible('.control-button');
      if (direction === 'down') return firstVisible('.control-button');
      if (direction === 'up') return pageMode() === 'player' ? null : activeChannel();
      return null;
    }
    if (zone === 'hero') {
      if (direction === 'right') return document.querySelector('.round-action');
      if (direction === 'down') return firstCatalog() || firstVisible('.control-button');
      if (direction === 'up') return activeChannel();
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'placeholder') {
      if (direction === 'up') return activeSidebar();
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'catalog') {
      if (direction === 'left' || direction === 'right') {
        var cardTarget = moveWithinZone(zone, current, direction);
        return cardTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return firstVisible('.primary-action') || activeChannel();
      if (direction === 'down') return document.querySelector('.control-button');
      return null;
    }
    if (zone === 'actions') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return firstVisible('.primary-action') || firstCatalog();
      return null;
    }
    if (zone === 'controls') {
      if (direction === 'left' || direction === 'right') {
        var controlTarget = moveWithinZone(zone, current, direction);
        return controlTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return firstVisible('.hero-feed-focus') || firstCatalog() || firstVisible('.primary-action');
      return null;
    }
    if (zone === 'searchInput') {
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstSearchFilter() || firstVisible('.search-submit');
      if (direction === 'right') return firstVisible('.search-submit');
      return null;
    }
    if (zone === 'searchActions') {
      if (direction === 'left') return searchInput;
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstSearchFilter() || firstSearchResult();
      return null;
    }
    if (zone === 'searchFilters') {
      return moveSearchFilter(current, direction);
    }
    if (zone === 'searchResults') {
      if (direction === 'left' || direction === 'right') {
        var resultTarget = moveWithinZone(zone, current, direction);
        return resultTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return moveGrid('.search-result-card', current, direction) || firstSearchFilter() || searchInput;
      if (direction === 'down') return moveGrid('.search-result-card', current, direction);
      return null;
    }
    return direction === 'right' ? firstContentFocus() : activeSidebar();
  }

  function normalizedKey(event) {
    var key = event.key;
    if (!key || key === 'Unidentified' || key === 'Unknown') key = keyNames[event.keyCode] || '';
    if (key === 'GoBack' || key === 'BrowserBack') key = 'Escape';
    return key;
  }

  function handleKey(event) {
    var key = normalizedKey(event);
    var current = document.activeElement;
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[key];

    if (current && current.id === 'search-input' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;

    if (key === 'Enter') {
      if (current && current.id === 'search-input') {
        submitSearch();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (current && typeof current.click === 'function') {
        current.click();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (key === 'Escape' || key === 'Backspace') {
      if (detailModalOpen) {
        closeDetail();
      } else if (pageMode() === 'player') {
        leavePlayer();
      } else if (zoneOf(current) !== 'sidebar') {
        goFocus(activeSidebar());
      }
      if (detailModalOpen || pageMode() === 'player' || zoneOf(current) !== 'sidebar') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!direction) return;
    if (!detailModalOpen && pageMode() === 'recommend' && zoneOf(current) === 'feed' && (direction === 'up' || direction === 'down')) {
      playFeedItem(feedIndex + (direction === 'up' ? -1 : 1));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    var target = moveFrom(current, direction);
    if (target) {
      goFocus(target);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.remove('is-hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(function () { notice.textContent = 'Go 核心已连接，选择短剧开始播放。'; }, 3200);
  }

  function setCatalogHeading(text) {
    document.getElementById('catalog-heading').textContent = text || '热播短剧';
  }

  function catalogMeta(item) {
    var values = [];
    if (item.episode_count) values.push(item.episode_count + ' 集');
    if (item.score) values.push(item.score + ' 分');
    return values.join(' · ') || '红果短剧';
  }

  function setFeatured(item) {
    if (!item || !item.series_id) return;
    featuredItem = item;
    var backdrop = document.getElementById('hero-backdrop');
    var title = document.querySelector('.hero-title');
    var episode = document.querySelector('.hero-episode');
    var summary = document.querySelector('.hero-summary');
    var topTitle = document.getElementById('hero-top-title');
    var topEpisode = document.getElementById('hero-top-episode');
    var placeholderTitle = document.getElementById('hero-placeholder-title');
    var placeholderSummary = document.getElementById('hero-placeholder-summary');
    var action = document.querySelector('[data-action="featured"]');
    if (backdrop) {
      backdrop.src = item.cover || '';
      backdrop.alt = item.title || '';
    }
    if (title) title.textContent = item.title || '红果短剧';
    if (episode) episode.textContent = item.episode_count ? item.episode_count + ' 集' : '短剧';
    if (summary) summary.textContent = item.intro || '打开详情查看完整集数。';
    if (topTitle) topTitle.textContent = item.title || '红果短剧';
    if (topEpisode) topEpisode.textContent = item.episode_count ? item.episode_count + ' 集' : '短剧';
    if (placeholderTitle) placeholderTitle.textContent = item.title || '红果短剧';
    if (placeholderSummary) placeholderSummary.textContent = item.intro || '打开详情查看完整集数和播放状态。';
    if (action) action.textContent = '查看详情';
  }

  function updateFeedCounter() {
    var counter = document.getElementById('hero-top-count');
    if (counter) counter.textContent = feedItems.length ? (feedIndex + 1) + ' / ' + feedItems.length : '0 / 0';
  }

  function firstVid(item) {
    if (!item) return '';
    if (item.vid) return item.vid;
    if (item.vid_list && item.vid_list.length) return item.vid_list[0];
    return '';
  }

  function playFeedItem(index) {
    if (!feedItems.length) return;
    if (index < 0) index = feedItems.length - 1;
    if (index >= feedItems.length) index = 0;
    var item = feedItems[index];
    if (!item || !item.series_id) return;
    feedIndex = index;
    updateFeedCounter();
    setFeatured(item);
    var hero = document.getElementById('hero');
    var video = document.getElementById('hero-video');
    var placeholder = document.getElementById('hero-placeholder');
    var generation = ++feedGeneration;
    hero.classList.add('is-feed');
    video.classList.remove('has-source');
    video.removeAttribute('src');
    video.load();
    placeholder.classList.remove('is-hidden');
    showNotice('正在准备第 1 集…');
    fetch('/api/v1/play/info?series_id=' + encodeURIComponent(item.series_id) + '&vid=' + encodeURIComponent(firstVid(item)))
      .then(function (response) { if (!response.ok) throw new Error('播放 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        if (!payload.ok || !payload.data || !payload.data.path) throw new Error(payload.error || '播放服务没有返回地址');
        video.src = payload.data.path;
        video.classList.add('has-source');
        placeholder.classList.add('is-hidden');
        video.load();
        video.play().catch(function () { showNotice('视频已准备好，请按确认键开始播放。'); });
        showNotice('正在播放 ' + (item.title || '红果短剧'));
      })
      .catch(function (error) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        placeholder.classList.remove('is-hidden');
        showNotice('播放地址获取失败：' + error.message);
      });
  }

  function renderFeed(items) {
    feedItems = (items || []).filter(function (item) { return item && item.series_id; }).slice(0, 15);
    feedIndex = feedItems.length ? 0 : -1;
    updateFeedCounter();
    if (!feedItems.length) {
      document.getElementById('hero-placeholder-title').textContent = '暂时没有推荐内容';
      document.getElementById('hero-placeholder-summary').textContent = '请稍后刷新红果短剧推荐。';
      document.getElementById('hero-placeholder').classList.remove('is-hidden');
      return;
    }
    playFeedItem(0);
  }

  function startPlayer(item, returnFocus) {
    if (!item || !item.series_id) return;
    playerReturnPage = pageMode();
    playerReturnFocus = returnFocus || document.activeElement;
    shell.dataset.mode = 'player';
    shell.classList.add('is-player');
    mainSurface.classList.remove('has-search', 'has-placeholder');
    searchPage.classList.add('is-hidden');
    pagePlaceholder.classList.add('is-hidden');
    document.getElementById('page-context').textContent = '← 返回';
    document.getElementById('hero').classList.add('is-feed');
    feedItems = [item];
    feedIndex = 0;
    playFeedItem(0);
    goFocus(document.getElementById('hero-feed-focus'));
  }

  function leavePlayer() {
    var page = playerReturnPage || 'search';
    var target = playerReturnFocus;
    playerReturnPage = null;
    playerReturnFocus = null;
    var item = document.querySelector('.side-item[data-page="' + page + '"]');
    if (!item) item = document.querySelector('.side-item[data-page="recommend"]');
    if (item) activatePage(item);
    if (target && document.contains(target)) goFocus(target);
    else goFocus(firstContentFocus());
  }

  function renderCatalog(items) {
    var track = document.getElementById('catalog-track');
    document.getElementById('hero-placeholder').classList.remove('is-hidden');
    track.innerHTML = '';
    var visibleItems = (items || []).slice(0, 9);
    visibleItems.forEach(function (item) {
      if (!item || !item.series_id) return;
      var card = document.createElement('button');
      card.className = 'catalog-card';
      card.dataset.seriesId = item.series_id;
      card.dataset.focus = 'catalog-' + item.series_id;
      var image = document.createElement('img');
      image.className = 'catalog-card-image';
      image.alt = item.title || '';
      image.src = item.cover || '';
      image.onerror = function () { image.classList.add('is-empty'); };
      var title = document.createElement('span');
      title.className = 'catalog-card-title';
      title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span');
      meta.className = 'catalog-card-meta';
      meta.textContent = catalogMeta(item);
      card.appendChild(image);
      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () {
        setFeatured(item);
        try { card.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (ignore) { card.scrollIntoView(false); }
      });
      track.appendChild(card);
    });
    if (visibleItems.length) setFeatured(visibleItems[0]);
  }

  function renderSearchResults(items) {
    searchResults.innerHTML = '';
    var list = (items || []).filter(function (item) { return item && item.series_id; });
    document.getElementById('search-result-count').textContent = list.length ? list.length + ' 部' : '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'search-result-empty';
      empty.textContent = '没有找到匹配的短剧，换个关键词试试。';
      searchResults.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var card = document.createElement('button');
      card.className = 'search-result-card';
      card.dataset.seriesId = item.series_id;
      card.dataset.focus = 'search-result-' + item.series_id;
      var image = document.createElement('img');
      image.className = 'search-result-card-image';
      image.alt = item.title || '';
      image.src = item.cover || '';
      image.onerror = function () { image.classList.add('is-empty'); };
      var title = document.createElement('span');
      title.className = 'search-result-card-title';
      title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span');
      meta.className = 'search-result-card-meta';
      meta.textContent = catalogMeta(item);
      card.appendChild(image);
      card.appendChild(title);
      card.appendChild(meta);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () {
        try { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (ignore) { card.scrollIntoView(false); }
      });
      searchResults.appendChild(card);
    });
  }

  function submitSearch() {
    var query = searchInput ? searchInput.value.trim() : '';
    if (!query) {
      showNotice('请输入剧名或关键词。');
      goFocus(searchInput);
      return;
    }
    var generation = ++searchGeneration;
    document.getElementById('search-result-title').textContent = '搜索：' + query;
    document.getElementById('search-result-count').textContent = '';
    searchResults.innerHTML = '<div class="search-result-empty">正在读取红果剧库…</div>';
    showNotice('正在搜索“' + query + '”…');
    fetch('/api/v1/search?q=' + encodeURIComponent(query))
      .then(function (response) { if (!response.ok) throw new Error('搜索 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== searchGeneration) return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '搜索响应无效');
        renderSearchResults(payload.data.items || []);
        showNotice(payload.data.items && payload.data.items.length ? '已找到 ' + payload.data.items.length + ' 部短剧。' : '没有找到匹配的短剧。');
        var first = firstSearchResult();
        if (first) goFocus(first);
      })
      .catch(function (error) {
        if (generation !== searchGeneration) return;
        searchResults.innerHTML = '<div class="search-result-empty">搜索失败：' + error.message + '</div>';
        showNotice('搜索失败：' + error.message);
      });
  }

  function selectSearchFilter(item) {
    var row = item && item.parentElement;
    if (!row) return;
    row.querySelectorAll('.search-filter').forEach(function (node) { node.classList.toggle('is-active', node === item); });
    var label = item.textContent || '全部';
    document.getElementById('filter-state').textContent = label;
    showNotice('已选择：' + label + '。输入关键词后按搜索。');
  }

  function loadCatalog(path, title) {
    var generation = ++catalogGeneration;
    setCatalogHeading(title || '热播短剧');
    showNotice('正在读取' + (title || '红果短剧') + '…');
    fetch('/api/v1/category?path=' + encodeURIComponent(path || '/rank/hot-drama'))
      .then(function (response) { if (!response.ok) throw new Error('分类 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== catalogGeneration) return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '分类响应无效');
        if (pageMode() === 'recommend') renderFeed(payload.data.items || []);
        else renderCatalog(payload.data.items || []);
        if (!payload.data.items || !payload.data.items.length) showNotice('这个分类暂时没有内容。');
        else if (pageMode() !== 'recommend') showNotice('已加载 ' + payload.data.items.length + ' 部短剧。');
      })
      .catch(function (error) {
        if (generation !== catalogGeneration) return;
        if (pageMode() === 'recommend') renderFeed([]);
        else renderCatalog([]);
        showNotice('分类加载失败：' + error.message);
      });
  }

  function detailElements() {
    return {
      title: document.getElementById('detail-title'),
      name: document.getElementById('detail-name'),
      cover: document.getElementById('detail-cover'),
      meta: document.getElementById('detail-meta'),
      intro: document.getElementById('detail-intro'),
      play: document.getElementById('detail-play'),
      episodes: document.getElementById('detail-episodes')
    };
  }

  function renderDetail(item) {
    var nodes = detailElements();
    nodes.title.textContent = item.title || '短剧详情';
    nodes.name.textContent = item.title || '未命名短剧';
    nodes.cover.src = item.cover || '';
    nodes.cover.onerror = function () { nodes.cover.removeAttribute('src'); };
    nodes.meta.textContent = [item.episode_count ? item.episode_count + ' 集' : '', item.score ? item.score + ' 分' : '', item.accessible_episode_cnt ? '可播放 ' + item.accessible_episode_cnt + ' 集' : ''].filter(Boolean).join(' · ');
    nodes.intro.textContent = item.intro || '暂无简介';
    nodes.play.textContent = '播放第一集';
    nodes.play.disabled = false;
    nodes.episodes.innerHTML = '';
    (item.episodes || []).forEach(function (episode) {
      var button = document.createElement('button');
      button.className = 'detail-episode' + (episode.locked ? ' is-locked' : '');
      button.dataset.index = String(Math.max(0, episode.index - 1));
      button.textContent = String(episode.index);
      button.title = episode.locked ? '接口标记为锁定，仍尝试使用播放服务解析' : '播放第' + episode.index + '集';
      button.addEventListener('click', function () { playEpisode(Number(button.dataset.index)); });
      nodes.episodes.appendChild(button);
    });
  }

  function openDetail(item) {
    if (!item || !item.series_id) return;
    detailReturnFocus = document.activeElement;
    detailModalOpen = true;
    currentDetail = null;
    detailModal.classList.remove('is-hidden');
    detailModal.setAttribute('aria-hidden', 'false');
    var nodes = detailElements();
    nodes.title.textContent = '正在读取详情…';
    nodes.name.textContent = '正在读取详情…';
    nodes.intro.textContent = '请稍候…';
    nodes.play.disabled = true;
    nodes.episodes.innerHTML = '';
    goFocus(document.querySelector('.detail-close'));
    fetch('/api/v1/series/detail?series_id=' + encodeURIComponent(item.series_id))
      .then(function (response) { if (!response.ok) throw new Error('详情 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (!detailModalOpen) return;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '详情响应无效');
        currentDetail = payload.data;
        renderDetail(currentDetail);
        goFocus(document.querySelector('.detail-play'));
      })
      .catch(function (error) {
        if (!detailModalOpen) return;
        detailElements().title.textContent = '详情加载失败';
        detailElements().intro.textContent = error.message;
        showNotice('详情加载失败：' + error.message);
        goFocus(document.querySelector('.detail-close'));
      });
  }

  function closeDetail() {
    detailModalOpen = false;
    currentDetail = null;
    detailModal.classList.add('is-hidden');
    detailModal.setAttribute('aria-hidden', 'true');
    var target = detailReturnFocus && document.contains(detailReturnFocus) ? detailReturnFocus : firstCatalog() || activeChannel();
    detailReturnFocus = null;
    goFocus(target);
  }

  function updateEpisodeHighlight(index) {
    document.querySelectorAll('.detail-episode').forEach(function (node) {
      node.classList.toggle('is-playing', Number(node.dataset.index) === index);
    });
  }

  function playEpisode(index) {
    if (!currentDetail || !currentDetail.episodes || !currentDetail.episodes[index]) return;
    var episode = currentDetail.episodes[index];
    var nodes = detailElements();
    nodes.play.disabled = true;
    nodes.play.textContent = '正在解析第' + episode.index + '集…';
    updateEpisodeHighlight(index);
    showNotice('正在准备第' + episode.index + '集…');
    fetch('/api/v1/play/info?series_id=' + encodeURIComponent(currentDetail.series_id) + '&vid=' + encodeURIComponent(episode.video_id))
      .then(function (response) { if (!response.ok) throw new Error('播放 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (!payload.ok || !payload.data || !payload.data.path) throw new Error(payload.error || '播放服务没有返回地址');
        var video = document.getElementById('hero-video');
        video.src = payload.data.path;
        video.classList.add('has-source');
        document.getElementById('hero-placeholder').classList.add('is-hidden');
        video.load();
        video.play().catch(function () { showNotice('地址已准备好，请按确认键开始播放。'); });
        document.querySelector('.hero-title').textContent = currentDetail.title || '红果短剧';
        document.querySelector('.hero-episode').textContent = '第' + episode.index + '集' + (payload.data.quality ? ' · ' + payload.data.quality : '');
        nodes.play.textContent = '继续第' + episode.index + '集';
        nodes.play.disabled = false;
        currentDetail.playingIndex = index;
        closeDetail();
      })
      .catch(function (error) {
        nodes.play.disabled = false;
        nodes.play.textContent = '重试第' + episode.index + '集';
        showNotice('播放地址获取失败：' + error.message);
      });
  }

  function toggleVideo() {
    var video = document.getElementById('hero-video');
    if (!video.src) { showNotice('请先打开一部短剧并选择集数。'); return; }
    if (video.paused) video.play().catch(function () { showNotice('播放被设备阻止，请再次确认。'); });
    else video.pause();
  }

  function activatePage(item) {
    document.querySelectorAll('.side-item').forEach(function (node) { node.classList.toggle('is-active', node === item); });
    var label = item.querySelector('span:last-child');
    shell.dataset.mode = item.dataset.page || 'recommend';
    document.getElementById('page-context').textContent = label ? label.textContent : '页面';
    shell.classList.remove('is-player');
    mainSurface.classList.remove('has-search');
    searchPage.classList.add('is-hidden');
    if (item.dataset.page === 'recommend') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      document.getElementById('hero').classList.add('is-feed');
      var active = document.querySelector('.channel-tab.is-active');
      loadCatalog(channelPaths[active && active.dataset.focus] || '/rank/hot-drama', active ? active.textContent : '热播短剧');
    } else if (item.dataset.page === 'search') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      mainSurface.classList.add('has-search');
      searchPage.classList.remove('is-hidden');
      goFocus(searchInput);
    } else {
      mainSurface.classList.add('has-placeholder');
      pagePlaceholder.classList.remove('is-hidden');
      document.getElementById('page-placeholder-title').textContent = label ? label.textContent : '页面';
      document.getElementById('page-placeholder-copy').textContent = (label ? label.textContent : '这个页面') + '的数据和交互正在接入。';
      showNotice((label ? label.textContent : '页面') + '页面已进入，下一步接入对应数据。');
    }
  }

  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('focusin', function (event) {
    markFocus(event.target);
    if (!detailModalOpen && zoneOf(event.target) !== 'sidebar') {
      lastContentFocus = event.target;
      lastPageFocus[pageMode()] = event.target;
    }
  });

  document.querySelectorAll('.side-item').forEach(function (item) {
    item.addEventListener('click', function () {
      activatePage(item);
      if (item.dataset.page === 'recommend') goFocus(firstContentFocus());
    });
  });

  document.querySelectorAll('[data-action]').forEach(function (item) {
    item.addEventListener('click', function () {
      if (item.dataset.action === 'search-submit') {
        submitSearch();
      } else if (item.dataset.action === 'featured') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      } else if (item.dataset.action === 'play' || item.dataset.action === 'pause') toggleVideo();
      else if (item.dataset.action === 'episodes') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      }
      else if (item.dataset.action === 'return-recommend') {
        var recommend = document.querySelector('.side-item[data-page="recommend"]');
        if (recommend) {
          activatePage(recommend);
          goFocus(firstContentFocus());
        }
      }
      else showNotice('已收到操作：' + item.dataset.action + '。');
    });
  });

  document.querySelectorAll('.channel-tab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.channel-tab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      loadCatalog(channelPaths[item.dataset.focus] || '/rank/hot-drama', item.textContent);
    });
  });
  document.querySelectorAll('.search-filter').forEach(function (item) {
    item.addEventListener('click', function () { selectSearchFilter(item); });
  });
  if (searchInput) {
    searchInput.addEventListener('keydown', function (event) {
      if (normalizedKey(event) === 'Enter') {
        submitSearch();
        event.preventDefault();
      }
    });
  }
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-play').addEventListener('click', function () { playEpisode(currentDetail && currentDetail.playingIndex >= 0 ? currentDetail.playingIndex : 0); });
  document.getElementById('hero-feed-focus').addEventListener('click', toggleVideo);

  function loadStatus() {
    fetch('/api/v1/status').then(function (response) { return response.json(); }).then(function (data) {
      status.textContent = data.ok ? 'Go 核心服务已连接' : '核心服务异常';
      status.dataset.ok = data.ok ? 'true' : 'false';
    }).catch(function () {
      status.textContent = '核心服务未连接';
      status.dataset.ok = 'false';
    });
  }

  document.getElementById('hero-video').addEventListener('ended', function () {
    if (pageMode() === 'recommend' && feedItems.length) playFeedItem(feedIndex + 1);
  });

  goFocus(document.querySelector('.side-item.is-active'));
  loadStatus();
  loadCatalog('/rank/hot-drama', '热播短剧');
}());
