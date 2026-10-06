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
    controls: '.playback-buttons .control-button, #player-retry',
    timeline: '#control-progress',
    searchInput: '#search-input',
    searchActions: '.search-action',
    searchFilters: '.search-filter',
    searchResults: '.search-result-card',
    listRetry: '.list-retry',
    rankPanels: '.rank-panel',
    discussion: '.discussion-item, .discussion-close',
    reservationItems: '.reservation-row',
    publicationActions: '.publication-action',
    rankTabs: '.rank-tab',
    rankSubnav: '.rank-subtab',
    rankItems: '.rank-row',
    rankActions: '.rank-row-play, .rank-row-detail',
    newTabs: '.new-tab',
    newFilters: '.new-filter',
    newItems: '.new-card',
    calendarDays: '.calendar-day',
    calendarItems: '.calendar-row',
    reservationTabs: '.reservation-tab',
    libraryActions: '.library-toolbar-button',
    libraryItems: '.library-card',
    libraryRemovals: '.library-remove',
    accountInputs: '.account-input',
    accountActions: '.account-action',
    confirmation: '.confirm-button',
    playerOptions: '.player-option',
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
  var discussionOpen = false;
  var discussionReturn = null;
  var danmakuEnabled = false;
  var danmakuGeneration = 0;
  var danmakuRequest = null;
  var danmakuRows = [];
  var danmakuWindow = -1;
  var danmakuBusy = false;
  var danmakuLane = 0;
  var danmakuLast = -1;
  var detailGeneration = 0;
  var detailReturnFocus = null;
  var detailSeriesID = '';
  var currentDetail = null;
  var lastContentFocus = null;
  var lastPageFocus = {};
  var featuredItem = null;
  var feedItems = [];
  var feedIndex = -1;
  var feedGeneration = 0;
  var continuationGeneration = 0;
  var searchInput = document.getElementById('search-input');
  var searchPage = document.getElementById('search-page');
  var searchResults = document.getElementById('search-results');

  var filterRows = [];
  var searchPanelPending = false;
  var searchFilters = { genre: '', sort: 'hot_score' };
  var searchKind = 'browse';
  var searchItems = [];
  var rankPage = document.getElementById('rank-page');
  var rankList = document.getElementById('rank-list');
  var newPage = document.getElementById('new-page');
  var newGrid = document.getElementById('new-grid');
  var calendarList = document.getElementById('calendar-list');
  var dateStrip = document.getElementById('new-date-strip');
  var reservationPage = document.getElementById('reservation-page');
  var rankItems = [];
  var newItems = [];
  var newMode = 'recommend';
  var newGender = 'all';
  var calendarDate = '';
  var calendarSchema = null;
  var rankOptions = [];
  var rankSelection = { rank: 'all', rank_sub: 'ranklist_hot_play_sc', rank_panel: '' };
  var reservationMode = 'online';
  var activeSearchQuery = '';
  var tailTimer = null;
  var playerReturnPage = null;
  var playerReturnFocus = null;
  var libraryPage = document.getElementById('library-page');
  var accountPage = document.getElementById('account-page');
  var accountData = null;
  var accountBusy = false;
  var accountNotice = '';
  var accountLeftFocus = null;
  var accountPollBusy = false;
  var accountEpoch = 0;
  var accountRequestGeneration = 0;
  var accountPollTimer = null;
  var accountVerifyTimer = null;
  var accountVerifyGeneration = 0;
  var accountCountdownUntil = 0;
  var libraryData = { entries: [] };
  var libraryLoaded = false;
  var libraryError = '';
  var libraryEditing = false;
  var libraryQueue = Promise.resolve();
  var libraryReady;
  var confirmOpen = false;
  var confirmReturnFocus = null;
  var confirmOperation = null;
  var confirmationGeneration = 0;
  var activePlayback = null;
  var detailCache = {};
  var playerOptionsOpen = false;
  var playerOptionsReturn = null;
  var controlsTimer = null;
  var lastPlaybackControl = null;
  var nativeFullscreen = false;
  var fullscreenExitKeepsHidden = false;
  var playbackQuality = '';
  var playbackRequest = null;
  var applicationInBackground = false;
  var playbackPreferences = { speed: 1, volume: 100 };
  var playbackSpeeds = [.5, .75, 1, 1.25, 1.5, 2];
  var keyNames = {
    19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft', 22: 'ArrowRight',
    23: 'Enter', 66: 'Enter', 4: 'Escape', 111: 'Escape'
  };

  function fetchData(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || '连接失败（' + response.status + '）');
        return payload.data || payload;
      });
    });
  }
  function listStatus(pager, id) {
    var node = document.getElementById(id);
    if (!node) return;
    // Keep the retry node stable while it owns focus.
    if (pager.error) {
      var text = node.querySelector('span');
      if (!text) { node.innerHTML = ''; text = document.createElement('span'); node.appendChild(text); }
      text.textContent = '加载失败：' + pager.error;
      var retry = node.querySelector('button');
      if (!retry) {
        retry = document.createElement('button'); retry.className = 'list-retry'; retry.textContent = '重试'; retry.dataset.focus = id + '-retry'; retry.__pager = pager;
        retry.addEventListener('click', function () {
          var current = document.activeElement; var generation = pager.generation;
          pager.load(true).then(function (added) {
            if (generation !== pager.generation || document.activeElement !== current && document.activeElement !== document.body) return;
            if (!pager.error) { var cards = focusables(pager.selector); goFocus(cards[cards.length - added.length] || cards[cards.length - 1] || firstContentFocus()); }
          });
        });
        node.appendChild(retry);
      }
      retry.disabled = pager.busy;
    } else {
      var oldRetry = node.querySelector('button');
      if (oldRetry && document.activeElement === oldRetry && pager.busy) { oldRetry.disabled = true; return; }
      node.textContent = pager.busy ? '正在加载…' : pager.loaded && !pager.hasMore() && pager.items.length ? '已显示全部' : '';
    }
    node.setAttribute('aria-busy', String(pager.busy));
  }
  function createListPager(endpoint, container, selector, id, render, metadata) {
    var pager = HongguoPagination.create({
      request: function (params, signal) { return fetchData((pager.endpoint || endpoint) + '?' + new URLSearchParams(params).toString(), signal ? { signal: signal } : {}); },
      clear: function () { if (container) renderMessage(container, 'list-empty', '正在加载…'); },
      render: function (items, append, p) {
        if (items.length && container) container.querySelectorAll('.list-empty, .calendar-empty, .search-result-empty, .rank-empty').forEach(function (node) { node.remove(); });
        render(items, append, p);
      },
      metadata: metadata,
      cursor: endpoint === '/api/v1/lists/recommend' ? function (data, old) { return { offset: Number(data.next_offset) || 0, session_id: data.session_id || old.session_id || '', feed_cell: data.feed_cell || old.feed_cell || '', feed_plan: data.feed_plan || old.feed_plan || '' }; } : null,
      status: function (p) { listStatus(p, id); },
      after: queueTailCheck
    });
    pager.container = container; pager.selector = selector; pager.statusID = id;
    return pager;
  }
  var searchPager = (function () {
    var pager;
    // A single endpoint wrapper handles both contracts without changing cursors.
    pager = HongguoPagination.create({
      request: function (params, signal) { return fetchData((params.q ? '/api/v1/lists/search' : '/api/v1/category') + '?' + new URLSearchParams(params).toString(), signal ? { signal: signal } : {}); },
      clear: function () { searchItems = []; document.getElementById('search-result-count').textContent = ''; renderMessage(searchResults, 'list-empty', '正在读取短剧…'); },
      render: function (items, append) { if (items.length) searchResults.querySelectorAll('.list-empty, .search-result-empty').forEach(function (node) { node.remove(); }); renderSearchResults(items, append); },
      metadata: function (data) {
        if (searchKind === 'browse') {
          if (searchPanelPending && (!data.filters || !data.filters.length)) throw new Error('筛选条件未返回');
          if (data.filters && data.filters.length) { searchPanelPending = false; renderFilterRows(data.filters); }
          document.getElementById('search-result-title').textContent = filterSummary(); document.getElementById('filter-state').textContent = filterSummary();
        }
      },
      status: function (p) { listStatus(p, 'search-pagination'); }, after: queueTailCheck
    });
    pager.container = searchResults; pager.selector = '.search-result-card'; pager.statusID = 'search-pagination'; return pager;
  })();
  var rankPager = createListPager('/api/v1/lists/rank', rankList, '.rank-row', 'rank-pagination', renderRank, function (data, pager) { if (!pager.loaded) renderRankSelectors(data.ranks); });
  var newPager = createListPager('/api/v1/lists/new', newGrid, '.new-card', 'new-pagination', renderNew);
  var calendarPager = createListPager('/api/v1/lists/calendar', calendarList, '.calendar-row', 'calendar-pagination', function (items, append) { renderPublications(items, append, false); }, function (data) { renderCalendarDays(data.calendar); });
  var reservationPager = createListPager('/api/v1/lists/reservations', document.getElementById('reservation-list'), '.reservation-row', 'reservation-pagination', function (items, append) { renderPublications(items, append, true); });
  var libraryPager = createListPager('', document.getElementById('library-grid'), '.library-card', 'library-pagination', function () { renderLibrary(true); });
  var feedPager = createListPager('/api/v1/lists/recommend', null, '.hero-feed-focus', '', function (items, append) {
    if (!append) renderFeed(items);
    else if (feedIndex < 0 && items.length) renderFeed(items);
    else { feedItems = feedItems.concat(items); updateFeedCounter(); }
  });
  var discussionPager = HongguoPagination.create({
    key: function (item) { return item.comment_id; },
    cursor: function (data) { return data.next_cursor ? { cursor: data.next_cursor } : {}; },
    request: function (params, signal) { return fetchData('/api/v1/comments?' + new URLSearchParams(params), signal ? { signal: signal } : {}); },
    clear: function () { renderMessage(document.getElementById('discussion-list'), 'list-empty', '正在读取评论…'); },
    render: renderDiscussion,
    status: function (p) { listStatus(p, 'discussion-pagination'); }, after: queueTailCheck
  });
  discussionPager.container = document.getElementById('discussion-list'); discussionPager.selector = '.discussion-item'; discussionPager.statusID = 'discussion-pagination';
  var allPagers = [searchPager, rankPager, newPager, calendarPager, reservationPager, libraryPager, feedPager, discussionPager];

  function visiblePager() {
    if (discussionOpen) return discussionPager;
    if (detailModalOpen || confirmOpen || playerOptionsOpen) return null;
    if (pageMode() === 'search') return searchPager;
    if (pageMode() === 'rank') return rankPager;
    if (pageMode() === 'new') return newMode === 'calendar' ? calendarPager : newPager;
    if (pageMode() === 'reservations') return reservationPager;
    if (isLibraryPage()) return libraryPager;
    return null;
  }
  function queueTailCheck() {
    clearTimeout(tailTimer); tailTimer = setTimeout(checkListTail, 80);
  }
  function checkListTail() {
    var pager = visiblePager();
    if (!pager || !pager.loaded || pager.busy || pager.error || !pager.hasMore()) return;
    var cards = pager.container.querySelectorAll(pager.selector);
    var last = cards[cards.length - 1];
    if (!last) { pager.load(); return; }
    var bottom = discussionOpen ? document.getElementById('discussion-scroll').getBoundingClientRect().bottom : mainSurface.getBoundingClientRect().bottom;
    var page = pager.container.closest('.page-workspace');
    if (page) bottom = Math.min(bottom, page.getBoundingClientRect().bottom);
    if (last.getBoundingClientRect().bottom < bottom + 280) pager.load();
  }
  function listBoundary(pager, current, direction, focusAnchor) {
    focusAnchor = focusAnchor || current;
    if (pager.error) return firstVisible('#' + pager.statusID + ' .list-retry');
    if (pager.hasMore()) {
      var generation = pager.generation; var mode = pageMode();
      pager.load().then(function () {
        if (generation !== pager.generation || pageMode() !== mode || focusAnchor !== document.activeElement) return;
        var target = moveGrid(pager.selector, current, direction);
        if (target) goFocus(target);
        else if (pager.error) goFocus(firstVisible('#' + pager.statusID + ' .list-retry'));
      });
    }
    return null;
  }

  function renderDiscussion(items, append) {
    var list = document.getElementById('discussion-list');
    if (!append) list.innerHTML = '';
    if (items.length) list.querySelectorAll('.list-empty').forEach(function (node) { node.remove(); });
    if (!items.length && !list.children.length) renderMessage(list, 'list-empty', '本集暂无评论');
    items.forEach(function (item) {
      var row = document.createElement('div'); row.className = 'discussion-item'; row.tabIndex = 0; row.dataset.focus = 'comment-' + item.comment_id;
      var author = document.createElement('strong'); author.textContent = item.author || '红果用户';
      var copy = document.createElement('p'); copy.textContent = item.text;
      var meta = document.createElement('small'); meta.textContent = (item.created ? new Date(item.created * 1000).toLocaleDateString() + ' · ' : '') + item.likes + ' 赞' + (item.replies ? ' · ' + item.replies + ' 回复' : '');
      row.appendChild(author); row.appendChild(copy); row.appendChild(meta);
      row.addEventListener('focus', function () { row.scrollIntoView({ block: 'nearest' }); }); list.appendChild(row);
    });
  }
  function openDiscussion(button) {
    if (!activePlayback || !activePlayback.vid) { showNotice('开始播放后可查看本集评论'); return; }
    clearTimeout(controlsTimer); discussionOpen = true; discussionReturn = button;
    var panel = document.getElementById('discussion-panel'); panel.classList.remove('is-hidden'); panel.setAttribute('aria-hidden', 'false');
    document.getElementById('discussion-title').textContent = '第' + activePlayback.episode + '集评论';
    discussionPager.reset({ series_id: activePlayback.item.series_id, vid: activePlayback.vid });
    goFocus(document.getElementById('discussion-close'));
  }
  function closeDiscussion(restore) {
    if (!discussionOpen) return;
    discussionOpen = false; discussionPager.cancel();
    document.getElementById('discussion-panel').classList.add('is-hidden'); document.getElementById('discussion-panel').setAttribute('aria-hidden', 'true');
    if (restore !== false) { goFocus(discussionReturn || document.getElementById('hero-feed-focus')); scheduleControlsHide(); }
    discussionReturn = null;
  }
  function resetDanmaku() {
    ++danmakuGeneration; if (danmakuRequest) danmakuRequest.abort(); danmakuRequest = null;
    danmakuRows = []; danmakuWindow = -1; danmakuBusy = false; danmakuLast = -1;
    document.getElementById('danmaku-layer').innerHTML = '';
  }
  function toggleDanmaku() {
    danmakuEnabled = !danmakuEnabled; resetDanmaku();
    var button = document.querySelector('[data-action="danmaku"]'); button.setAttribute('aria-pressed', String(danmakuEnabled)); button.querySelector('small').textContent = danmakuEnabled ? '弹幕开' : '弹幕关'; tickDanmaku();
  }
  function tickDanmaku() {
    var video = document.getElementById('hero-video');
    if (!danmakuEnabled || !activePlayback || !activePlayback.vid || video.paused || !isPlaybackPage() || document.hidden || applicationInBackground) return;
    var now = Math.floor(video.currentTime * 1000); var windowStart = Math.floor(now / 30000) * 30000;
    if (danmakuWindow !== windowStart && !danmakuBusy) {
      danmakuWindow = windowStart; danmakuBusy = true; danmakuRows = [];
      var generation = danmakuGeneration;
      danmakuRequest = typeof AbortController === 'function' ? new AbortController() : null;
      var params = new URLSearchParams({ series_id: activePlayback.item.series_id, vid: activePlayback.vid, start: String(windowStart), duration: String(Math.max(1, Math.floor((video.duration || 600) * 1000))) });
      fetchData('/api/v1/danmaku?' + params, danmakuRequest ? { signal: danmakuRequest.signal } : {}).then(function (data) {
        if (generation !== danmakuGeneration) return;
        danmakuRows = (data.items || []).filter(function (item) { return item.offset_ms >= now - 1500 && item.offset_ms < windowStart + 30000; });
      }).catch(function (error) { if (generation === danmakuGeneration && error.name !== 'AbortError') showNotice('弹幕暂时不可用，可关闭后重试'); })
        .then(function () { if (generation === danmakuGeneration) { danmakuBusy = false; danmakuRequest = null; } });
    }
    var layer = document.getElementById('danmaku-layer'); var last = danmakuLast;
    danmakuRows.forEach(function (item) {
      if (item.shown || item.offset_ms > now || now - last < 700 || layer.children.length >= 8) return;
      item.shown = true; last = now; danmakuLast = now;
      if (item.offset_ms < now - 2000) return;
      var line = document.createElement('span'); line.className = 'danmaku-line'; line.textContent = item.text.slice(0, 120); line.style.top = (danmakuLane++ % 4) * 38 + 'px';
      line.addEventListener('animationend', function () { line.remove(); }); layer.appendChild(line);
    });
  }

  function pageMode() {
    return shell && shell.dataset.mode ? shell.dataset.mode : 'recommend';
  }

  function focusables(selector) {
    var result = [];
    var query = selector || Object.keys(zoneSelectors).map(function (zone) { return zoneSelectors[zone]; }).join(',');
    Array.prototype.forEach.call(document.querySelectorAll(query), function (element) {
      var style = window.getComputedStyle(element);
      var insideModal = element.closest && element.closest('#detail-modal');
      if (confirmOpen) { if (!element.closest('#confirm-modal')) return; }
      else if (playerOptionsOpen) { if (!element.closest('#player-options')) return; }
      else if (discussionOpen) { if (!element.closest('#discussion-panel')) return; }
      else if (element.closest('#discussion-panel')) return;
      else if (detailModalOpen ? !insideModal : insideModal) return;
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
    if (element.classList.contains('discussion-item') || element.classList.contains('discussion-close')) return 'discussion';
    if (element.classList.contains('side-item')) return 'sidebar';
    if (element.classList.contains('channel-tab')) return 'channels';
    if (element.classList.contains('hero-feed-focus')) return 'feed';
    if (element.classList.contains('catalog-card')) return 'catalog';
    if (element.classList.contains('round-action')) return 'actions';
    if (element.id === 'control-progress') return 'timeline';
    if (element.classList.contains('control-button')) return 'controls';
    if (element.id === 'search-input') return 'searchInput';
    if (element.classList.contains('search-action')) return 'searchActions';
    if (element.classList.contains('search-filter')) return 'searchFilters';
    if (element.classList.contains('search-result-card')) return 'searchResults';
    if (element.classList.contains('list-retry')) return 'listRetry';
    if (element.classList.contains('rank-panel')) return 'rankPanels';
    if (element.classList.contains('reservation-row')) return 'reservationItems';
    if (element.classList.contains('publication-action')) return 'publicationActions';
    if (element.classList.contains('rank-tab')) return 'rankTabs';
    if (element.classList.contains('rank-subtab')) return 'rankSubnav';
    if (element.classList.contains('rank-row')) return 'rankItems';
    if (element.classList.contains('rank-row-play') || element.classList.contains('rank-row-detail')) return 'rankActions';
    if (element.classList.contains('new-tab')) return 'newTabs';
    if (element.classList.contains('new-filter')) return 'newFilters';
    if (element.classList.contains('new-card')) return 'newItems';
    if (element.classList.contains('calendar-day')) return 'calendarDays';
    if (element.classList.contains('calendar-row')) return 'calendarItems';
    if (element.classList.contains('reservation-tab')) return 'reservationTabs';
    if (element.classList.contains('library-toolbar-button')) return 'libraryActions';
    if (element.classList.contains('library-card')) return 'libraryItems';
    if (element.classList.contains('library-remove')) return 'libraryRemovals';
    if (element.classList.contains('account-input')) return 'accountInputs';
    if (element.classList.contains('account-action')) return 'accountActions';
    if (element.classList.contains('confirm-button')) return 'confirmation';
    if (element.classList.contains('player-option')) return 'playerOptions';
    if (element.classList.contains('detail-episode')) return 'episodes';
    if (element.classList.contains('modal-action')) return 'modalActions';
    if (element.classList.contains('page-placeholder-action')) return 'placeholder';
    if (element.classList.contains('primary-action')) return 'hero';
    return '';
  }

  function goFocus(element) {
    if (!element || element.disabled || !element.getClientRects().length) return;
    if (window.getComputedStyle(element).visibility !== 'visible') return;
    element.focus({ preventScroll: false });
    markFocus(element);
    if (!detailModalOpen && !confirmOpen && !playerOptionsOpen && !discussionOpen && zoneOf(element) !== 'sidebar') {
      lastContentFocus = element;
      lastPageFocus[pageMode()] = element;
    }
  }

  function firstContentFocus() {
    if (pageMode() === 'player') return document.querySelector('.hero-feed-focus');
    var remembered = lastPageFocus[pageMode()];
    if (remembered && focusables().indexOf(remembered) >= 0) return remembered;
    if (pageMode() === 'search') return searchInput || document.querySelector('.search-submit');
    if (pageMode() === 'account') return firstVisible('.account-input') || firstVisible('.account-action');
    if (isLibraryPage()) return firstVisible('.library-card') || firstVisible('[data-action="library-discover"]') || firstVisible('.library-toolbar-button');
    if (pageMode() === 'rank') return firstVisible('.rank-tab.is-active') || firstRankTab();
    if (pageMode() === 'new') return firstVisible('.new-tab.is-active') || firstNewTab();
    if (pageMode() === 'reservations') return firstVisible('.reservation-tab.is-active');
    if (pageMode() !== 'recommend') return document.querySelector('.page-placeholder-action');
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

  function firstRankTab() { return firstVisible('.rank-tab'); }
  function firstRankSubtab() { return firstVisible('.rank-subtab'); }
  function firstRankRow() { return firstVisible('.rank-row'); }
  function firstNewTab() { return firstVisible('.new-tab'); }
  function firstNewFilter() { return firstVisible('.new-filter'); }
  function firstNewCard() { return firstVisible('.new-card'); }
  function firstCalendarDay() { return firstVisible('.calendar-day.is-active') || firstVisible('.calendar-day'); }
  function firstCalendarRow() { return firstVisible('.calendar-row'); }

  function hideWorkspacePages() {
    [rankPage, newPage, reservationPage, libraryPage, accountPage].forEach(function (page) {
      if (page) page.classList.add('is-hidden');
    });
  }

  function moveSearchFilter(current, direction) {
    var row = current && current.closest ? current.closest('.filter-row') : null;
    if (!row) return null;
    var items = focusables('.filter-row[data-filter-group="' + row.dataset.filterGroup + '"] .search-filter');
    if (direction === 'left' || direction === 'right') {
      var index = items.indexOf(current);
      if (index < 0) return items[0] || null;
      index += direction === 'left' ? -1 : 1;
      return items[index] || (direction === 'left' ? activeSidebar() : null);
    }
    var rows = [];
    document.querySelectorAll('.filter-row[data-filter-group]').forEach(function (node) { rows.push(node); });
    var rowIndex = rows.indexOf(row);
    var targetRowIndex = rowIndex + (direction === 'up' ? -1 : 1);
    if (targetRowIndex < 0) return searchInput;
    if (targetRowIndex >= rows.length) return firstSearchResult() || firstVisible('.search-more');
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
    var currentX = currentRect.left + currentRect.width / 2;
    var currentY = currentRect.top + currentRect.height / 2;
    var vertical = direction === 'up' || direction === 'down';
    var best = null;
    var bestScore = Infinity;
    candidates.forEach(function (node) {
      var rect = node.getBoundingClientRect();
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var rowDelta = direction === 'down' ? y - currentY : currentY - y;
      if (vertical && rowDelta <= 16) return;
      if (!vertical) {
        if (Math.abs(y - currentY) > 16) return;
        var columnDelta = direction === 'right' ? x - currentX : currentX - x;
        if (columnDelta > 8 && columnDelta < bestScore) { bestScore = columnDelta; best = node; }
        return;
      }
      var horizontal = Math.abs(x - currentX);
      var score = rowDelta * 100 + horizontal;
      if (score < bestScore) { bestScore = score; best = node; }
    });
    return best;
  }

  function moveModalFrom(current, direction) {
    var zone = zoneOf(current);
    if (zone === 'modalActions') {
      if (current.id === 'detail-close') return direction === 'down' ? document.getElementById('detail-play') : null;
      if (direction === 'left') return current.id === 'detail-save' ? document.getElementById('detail-play') : null;
      if (direction === 'right') return current.id === 'detail-play' ? document.getElementById('detail-save') : null;
      if (direction === 'up') return document.getElementById('detail-close');
      if (direction === 'down') return document.querySelector('.detail-episode.is-playing') || document.querySelector('.detail-episode');
      return null;
    }
    if (zone === 'episodes') {
      if (direction === 'left' || direction === 'right') {
        var episodeTarget = moveGrid('.detail-episode', current, direction);
        return episodeTarget || (direction === 'left' ? document.querySelector('.detail-close') : null);
      }
      if (direction === 'up') return moveGrid('.detail-episode', current, direction) || document.querySelector('.detail-play') || document.querySelector('.detail-close');
      if (direction === 'down') return moveGrid('.detail-episode', current, direction);
      return null;
    }
    return null;
  }

  function moveFrom(current, direction) {
    if (confirmOpen) return direction === 'left' || direction === 'right' ? moveWithinZone('confirmation', current, direction) : null;
    if (playerOptionsOpen) {
      if (current.id === 'player-options-close') return direction === 'down' ? document.querySelector('.player-option.is-selected') || firstVisible('#player-options-list .player-option') : null;
      return moveGrid('#player-options-list .player-option', current, direction) || (direction === 'up' ? document.getElementById('player-options-close') : null);
    }
    if (detailModalOpen) return moveModalFrom(current, direction);
    if (discussionOpen) {
      if (zoneOf(current) === 'listRetry') return direction === 'up' ? focusables('.discussion-item').slice(-1)[0] || document.getElementById('discussion-close') : null;
      if (current.id === 'discussion-close') return direction === 'down' ? firstVisible('.discussion-item') || firstVisible('#discussion-pagination .list-retry') : null;
      if (direction === 'up') return moveGrid('.discussion-item', current, 'up') || document.getElementById('discussion-close');
      if (direction === 'down') return moveGrid('.discussion-item', current, 'down') || listBoundary(discussionPager, current, 'down');
      return direction === 'left' ? document.getElementById('discussion-close') : null;
    }
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
      if (direction === 'left') return shell.classList.contains('is-cinema') ? firstVisible('.playback-buttons .control-button') : activeSidebar();
      if (direction === 'right') return firstVisible('.round-action') || firstVisible('.playback-buttons .control-button');
      if (direction === 'down') return firstVisible('.playback-buttons .control-button');
      if (direction === 'up') return pageMode() === 'player' ? null : activeChannel();
      return null;
    }
    if (zone === 'hero') {
      if (direction === 'right') return document.querySelector('.round-action');
      if (direction === 'down') return firstCatalog() || firstVisible('.playback-buttons .control-button');
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
      if (direction === 'down') return firstVisible('.playback-buttons .control-button');
      return null;
    }
    if (zone === 'actions') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return firstVisible('.hero-feed-focus') || firstVisible('.primary-action') || firstCatalog();
      return null;
    }
    if (zone === 'controls') {
      if (direction === 'left' || direction === 'right') {
        var controlTarget = moveWithinZone(zone, current, direction);
        return controlTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return firstVisible('#control-progress') || firstVisible('.hero-feed-focus') || firstCatalog() || firstVisible('.primary-action');
      return null;
    }
    if (zone === 'searchInput') {
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstSearchFilter() || firstVisible('.search-submit');
      if (direction === 'right') return firstVisible('.search-submit');
      return null;
    }
    if (zone === 'searchActions') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? searchInput : null);
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstSearchFilter() || firstSearchResult();
      return null;
    }
    if (zone === 'searchFilters') {
      return moveSearchFilter(current, direction);
    }
    if (zone === 'searchResults') {
      if (direction === 'left' || direction === 'right') {
        var resultTarget = moveGrid('.search-result-card', current, direction);
        return resultTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return moveGrid('.search-result-card', current, direction) || lastSearchFilter() || searchInput;
      if (direction === 'down') return moveGrid('.search-result-card', current, direction) || listBoundary(searchPager, current, direction);
      return null;
    }
    if (zone === 'listRetry') {
      var pager = current.__pager;
      if (direction === 'up') { var cards = focusables(pager.selector); return cards[cards.length - 1] || firstContentFocus(); }
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'rankPanels') {
      var target = moveGrid('.rank-panel', current, direction);
      if (target) return target;
      if (direction === 'down') return firstRankRow();
      if (direction === 'up') return firstVisible('.rank-tab.is-active');
      if (direction === 'left') return firstVisible('.rank-subtab.is-active');
      return null;
    }
    if (zone === 'publicationActions') {
      var row = current.closest('.publication-row');
      if (!row) return direction === 'left' || direction === 'up' ? firstVisible('.reservation-tab.is-active') : null;
      if (direction === 'left') return row;
      if (direction === 'up' || direction === 'down') {
        var reservations = row.classList.contains('reservation-row');
        var selector = reservations ? '.reservation-row' : '.calendar-row';
        return moveGrid(selector, row, direction) || (direction === 'down'
          ? listBoundary(reservations ? reservationPager : calendarPager, row, direction, current)
          : firstVisible(reservations ? '.reservation-tab.is-active' : '.calendar-day.is-active'));
      }
      return null;
    }
    if (zone === 'reservationItems') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.reservation-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction) || listBoundary(reservationPager, current, direction);
      if (direction === 'right') return current.querySelector('.publication-action');
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'libraryActions') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'down') return firstVisible('.library-card') || firstVisible('[data-action="library-discover"]');
      if (direction === 'up') return firstVisible('.library-card') || activeSidebar();
      return null;
    }
    if (zone === 'accountInputs' || zone === 'accountActions') {
      var leftSelector = '#account-login-form .account-input, #account-login-form .account-action, #account-mfa .account-action, #account-profile .account-action';
      if (current.id === 'account-sync') return direction === 'left' ? (focusables(leftSelector).indexOf(accountLeftFocus) >= 0 ? accountLeftFocus : firstVisible(leftSelector)) : null;
      var target = moveGrid(leftSelector, current, direction);
      if (target) return target;
      if (direction === 'right' && firstVisible('#account-sync')) { accountLeftFocus = current; return document.getElementById('account-sync'); }
      return direction === 'left' || direction === 'up' ? activeSidebar() : null;
    }
    if (zone === 'libraryItems') {
      if (direction === 'left' || direction === 'right') return moveGrid('.library-card', current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return moveGrid('.library-card', current, direction) || firstVisible('.library-toolbar-button');
      if (direction === 'down') return libraryEditing ? current.parentElement.querySelector('.library-remove') : moveGrid('.library-card', current, direction) || listBoundary(libraryPager, current, direction);
      return null;
    }
    if (zone === 'libraryRemovals') {
      if (direction === 'up') return current.parentElement.querySelector('.library-card');
      if (direction === 'down') { var card = current.parentElement.querySelector('.library-card'); return moveGrid('.library-card', card, 'down') || listBoundary(libraryPager, card, 'down', current); }
      if (direction === 'left' || direction === 'right') return moveGrid('.library-remove', current, direction) || (direction === 'left' ? activeSidebar() : null);
      return null;
    }
    if (zone === 'rankTabs') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstVisible('.rank-subtab.is-active') || firstRankSubtab() || firstRankRow();
      return null;
    }
    if (zone === 'rankSubnav') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.rank-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return activeSidebar();
      if (direction === 'right') return firstVisible('.rank-panel.is-active') || firstVisible('.rank-panel') || firstRankRow();
      return moveWithinZone(zone, current, direction);
    }
    if (zone === 'rankItems') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstVisible('.rank-panel.is-active') || firstVisible('.rank-panel') || firstVisible('.rank-tab.is-active');
      if (direction === 'down') return moveWithinZone(zone, current, direction) || listBoundary(rankPager, current, direction);
      if (direction === 'left') return firstVisible('.rank-subtab.is-active');
      if (direction === 'right') return current.querySelector('.rank-row-play');
      return null;
    }
    if (zone === 'rankActions') {
      var row = current.closest('.rank-row');
      if (direction === 'left') return row;
      if (direction === 'up' && current.classList.contains('rank-row-detail')) return row.querySelector('.rank-row-play');
      if (direction === 'down' && current.classList.contains('rank-row-play')) return row.querySelector('.rank-row-detail');
      if (direction === 'up' || direction === 'down') return moveGrid('.rank-row', row, direction) || (direction === 'down' ? listBoundary(rankPager, row, direction, current) : firstVisible('.rank-panel.is-active') || firstVisible('.rank-tab.is-active'));
      return null;
    }
    if (zone === 'newTabs') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : firstNewFilter());
      if (direction === 'up') return activeSidebar();
      if (direction === 'down') return firstNewFilter() || (newMode === 'calendar' ? firstCalendarDay() : firstNewCard());
      return null;
    }
    if (zone === 'newFilters') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? firstVisible('.new-tab.is-active') : null);
      if (direction === 'up') return firstNewTab();
      if (direction === 'down') return newMode === 'calendar' ? firstCalendarDay() : firstNewCard();
      return null;
    }
    if (zone === 'newItems') {
      if (direction === 'left' || direction === 'right') return moveGrid('.new-card', current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return moveGrid('.new-card', current, direction) || firstNewFilter() || firstNewTab();
      if (direction === 'down') return moveGrid('.new-card', current, direction) || listBoundary(newPager, current, direction);
      return null;
    }
    if (zone === 'calendarDays') {
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return firstNewTab();
      if (direction === 'down') return firstCalendarRow();
      return null;
    }
    if (zone === 'calendarItems') {
      if (direction === 'up') return moveWithinZone(zone, current, direction) || firstCalendarDay();
      if (direction === 'down') return moveWithinZone(zone, current, direction) || listBoundary(calendarPager, current, direction);
      if (direction === 'right') return current.querySelector('.publication-action');
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'reservationTabs') {
      if (direction === 'down') return firstVisible('.reservation-row') || firstVisible('#reservation-page .publication-action') || firstVisible('#reservation-page .list-retry');
      if (direction === 'left' || direction === 'right') return moveWithinZone(zone, current, direction) || (direction === 'left' ? activeSidebar() : null);
      if (direction === 'up') return activeSidebar();
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
    if (current && current.classList.contains('account-input')) {
      if (key === 'Backspace' || key === 'Delete' || key === 'ArrowLeft' || key === 'ArrowRight') return;
      if (key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        if (current.id === 'account-code') accountLogin();
        else if (accountData && accountData.phase === 'code') goFocus(document.getElementById('account-code'));
        else accountSendCode();
        return;
      }
    }
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[key];

    var command = ({ MediaPlayPause: 'toggle', MediaPlay: 'play', MediaPause: 'pause', MediaFastForward: 'forward', MediaRewind: 'rewind', ' ': 'toggle' })[key];
    if (command && (!event.repeat || command === 'forward' || command === 'rewind') && handleMediaCommand(command)) {
      event.preventDefault(); event.stopPropagation(); return;
    }

    if (current && current.id === 'search-input' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;

    if (key === 'Enter') {
      if (event.repeat) { event.preventDefault(); return; }
      if (zoneOf(current) === 'feed' && shell.classList.contains('is-controls-hidden')) {
        revealControls(); goFocus(firstVisible('.playback-buttons .control-button'));
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (current && current.id === 'control-progress') {
        goFocus(lastPlaybackControl || firstVisible('.playback-buttons .control-button'));
        event.preventDefault(); event.stopPropagation(); return;
      }
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
      if (handleBack()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!direction) return;
    if (!detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && current && current.id === 'control-progress') {
      if (direction === 'left' || direction === 'right') seekBy(direction === 'left' ? -10 : 10);
      else goFocus(direction === 'up' ? document.getElementById('hero-feed-focus') : lastPlaybackControl || firstVisible('.playback-buttons .control-button'));
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (!detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && shell.classList.contains('is-controls-hidden') && pageMode() === 'recommend' && zoneOf(current) === 'feed' && (direction === 'up' || direction === 'down')) {
      playFeedItem(feedIndex + (direction === 'up' ? -1 : 1));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isPlaybackPage() && !detailModalOpen && !playerOptionsOpen && !confirmOpen && !discussionOpen && (direction !== 'left' || shell.classList.contains('is-cinema') || zoneOf(current) !== 'feed')) revealControls();
    if (zoneOf(current) === 'feed' && pageMode() === 'player' && (direction === 'up' || direction === 'down')) {
      goFocus(firstVisible('.playback-buttons .control-button'));
      event.preventDefault(); event.stopPropagation(); return;
    }
    var target = moveFrom(current, direction);
    if (target) {
      goFocus(target);
    }
    // Consume boundary keys too; WebView must not scroll the page or perform
    // its own focus search when the remote reaches the end of a zone.
    event.preventDefault();
    event.stopPropagation();
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.remove('is-hidden');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(function () { notice.classList.add('is-hidden'); }, 3200);
  }

  function isPlaybackPage() { return pageMode() === 'recommend' || pageMode() === 'player'; }
  function scheduleControlsHide() {
    clearTimeout(controlsTimer);
    var video = document.getElementById('hero-video');
    if (!isPlaybackPage() || shell.classList.contains('is-controls-hidden') || video.paused || video.ended || detailModalOpen || confirmOpen || playerOptionsOpen || discussionOpen || zoneOf(document.activeElement) === 'sidebar') return;
    controlsTimer = setTimeout(function () { hideControls(); }, 4000);
  }
  function revealControls() {
    shell.classList.remove('is-controls-hidden');
    scheduleControlsHide();
  }
  function hideControls() {
    clearTimeout(controlsTimer);
    if (!isPlaybackPage() || detailModalOpen || confirmOpen || playerOptionsOpen || discussionOpen || zoneOf(document.activeElement) === 'sidebar') return;
    shell.classList.add('is-controls-hidden');
    goFocus(document.getElementById('hero-feed-focus'));
  }
  function setPlayerStatus(message, failed) {
    var panel = document.getElementById('player-status');
    panel.classList.toggle('is-hidden', !message);
    document.getElementById('player-status-text').textContent = message || '';
    panel.querySelector('.player-spinner').classList.toggle('is-hidden', !!failed);
    document.getElementById('player-retry').classList.toggle('is-hidden', !failed);
    if (failed) {
      revealControls();
      if (zoneOf(document.activeElement) === 'feed') goFocus(document.getElementById('player-retry'));
    }
  }
  function updatePlaybackControls() {
    var video = document.getElementById('hero-video');
    var duration = Number.isFinite(video.duration) ? video.duration : 0;
    var position = Math.min(duration, Number(video.currentTime) || 0);
    var progress = document.getElementById('control-progress');
    document.querySelector('.time-label').textContent = clockText(position) + ' / ' + clockText(duration);
    progress.disabled = !duration;
    progress.setAttribute('aria-valuemax', String(Math.floor(duration)));
    progress.setAttribute('aria-valuenow', String(Math.floor(position)));
    progress.setAttribute('aria-valuetext', clockText(position) + ' / ' + clockText(duration));
    progress.querySelector('span').style.width = (duration ? position / duration * 100 : 0) + '%';
    var pause = document.querySelector('[data-action="pause"]');
    pause.textContent = video.paused || video.ended ? '播放' : '暂停';
    pause.setAttribute('aria-label', pause.textContent);
    document.querySelector('[data-action="speed"]').textContent = video.playbackRate + 'x';
    document.querySelector('[data-action="volume"]').textContent = video.muted || !video.volume ? '静音' : '音量 ' + Math.round(video.volume * 100) + '%';
    document.querySelector('[data-action="quality"]').textContent = playbackQuality || '清晰度 · 自动';
    document.querySelector('[data-action="fullscreen"]').textContent = shell.classList.contains('is-cinema') ? '退出全屏' : '全屏';
  }
  function savePlaybackPreferences() {
    try { localStorage.setItem('hongguo-tv-playback', JSON.stringify(playbackPreferences)); } catch (error) { showNotice('播放设置未保存'); }
  }
  function restorePlaybackPreferences() {
    try {
      var saved = JSON.parse(localStorage.getItem('hongguo-tv-playback') || '{}');
      if (playbackSpeeds.indexOf(saved.speed) >= 0) playbackPreferences.speed = saved.speed;
      if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 100) playbackPreferences.volume = saved.volume;
    } catch (error) { /* Invalid preferences fall back to normal playback. */ }
    var video = document.getElementById('hero-video');
    video.playbackRate = playbackPreferences.speed;
    video.defaultPlaybackRate = playbackPreferences.speed;
    video.volume = playbackPreferences.volume / 100;
    video.muted = playbackPreferences.volume === 0;
    updatePlaybackControls();
  }
  function closePlayerOptions(restoring) {
    playerOptionsOpen = false;
    document.getElementById('player-options').classList.add('is-hidden');
    var target = playerOptionsReturn;
    playerOptionsReturn = null;
    if (restoring !== false) goFocus(target && document.contains(target) ? target : document.getElementById('hero-feed-focus'));
    scheduleControlsHide();
  }
  function openPlayerOptions(kind, entry) {
    if (!isPlaybackPage()) return;
    revealControls(); clearTimeout(controlsTimer);
    playerOptionsReturn = entry;
    playerOptionsOpen = true;
    var video = document.getElementById('hero-video');
    var values = kind === 'speed' ? playbackSpeeds : [0, 25, 50, 75, 100];
    var selected = kind === 'speed' ? video.playbackRate : video.muted ? 0 : Math.round(video.volume * 100);
    document.getElementById('player-options-title').textContent = kind === 'speed' ? '播放倍速' : '音量';
    var list = document.getElementById('player-options-list'); list.innerHTML = '';
    values.forEach(function (value, index) {
      var option = document.createElement('button');
      option.className = 'player-option' + (value === selected ? ' is-selected' : '');
      option.dataset.focus = 'player-option-' + index;
      option.textContent = kind === 'speed' ? value + 'x' : value === 0 ? '静音' : value + '%';
      option.addEventListener('click', function () {
        try {
          if (kind === 'speed') { video.playbackRate = value; video.defaultPlaybackRate = value; playbackPreferences.speed = value; }
          else { video.volume = value / 100; video.muted = value === 0; playbackPreferences.volume = value; }
          updatePlaybackControls(); savePlaybackPreferences(); closePlayerOptions();
        } catch (error) { showNotice(kind === 'speed' ? '设备不支持这个倍速' : '请用遥控器音量键调整音量'); }
      });
      list.appendChild(option);
    });
    document.getElementById('player-options').classList.remove('is-hidden');
    goFocus(list.querySelector('.is-selected') || list.querySelector('.player-option'));
  }
  function seekTo(position) {
    var video = document.getElementById('hero-video');
    if (!activePlayback || !Number.isFinite(position) || !Number.isFinite(video.duration) || video.duration <= 0) return false;
    video.currentTime = Math.max(0, Math.min(position, Math.max(0, video.duration - .25)));
    updatePlaybackControls(); revealControls();
    return true;
  }
  function seekBy(delta) { return seekTo(document.getElementById('hero-video').currentTime + delta); }
  function setCinema(enabled) { shell.classList.toggle('is-cinema', enabled); updatePlaybackControls(); }
  function exitCinema(keepHidden) {
    fullscreenExitKeepsHidden = !!keepHidden;
    setCinema(false);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }
  function toggleCinema() {
    if (shell.classList.contains('is-cinema')) exitCinema();
    else {
      setCinema(true);
      // Android already fills the display. Keep the CSS layout if the browser
      // Fullscreen API is unavailable; never fullscreen the video alone.
      if (shell.requestFullscreen) shell.requestFullscreen().catch(function () {});
    }
    revealControls();
  }
  function handleBack() {
    if (confirmOpen) closeConfirmation();
    else if (playerOptionsOpen) closePlayerOptions();
    else if (detailModalOpen) closeDetail();
    else if (discussionOpen) closeDiscussion();
    else if (pageMode() === 'account' && accountData && accountData.phase === 'mfa') { cancelAccountVerification(true); }
    else if (isPlaybackPage() && zoneOf(document.activeElement) !== 'sidebar' && !shell.classList.contains('is-controls-hidden')) hideControls();
    else if (shell.classList.contains('is-cinema')) { exitCinema(true); hideControls(); }
    else if (pageMode() === 'player') leavePlayer();
    else if (zoneOf(document.activeElement) !== 'sidebar') goFocus(activeSidebar());
    else return false;
    return true;
  }
  function handleMediaCommand(command) {
    var video = document.getElementById('hero-video');
    if (applicationInBackground || !isPlaybackPage() || !video.getAttribute('src')) return false;
    if (command === 'toggle') toggleVideo();
    else if (command === 'play') video.play().catch(function () { showNotice('请按确认键开始播放'); });
    else if (command === 'pause') video.pause();
    else if (command === 'forward') seekBy(10);
    else if (command === 'rewind') seekBy(-10);
    else return false;
    revealControls();
    return true;
  }
  function pauseForBackground() {
    applicationInBackground = true;
    ++continuationGeneration;
    if (activePlayback && activePlayback.continuationPending) setPlayerStatus('');
    saveProgress(true);
    document.getElementById('hero-video').pause();
    clearTimeout(controlsTimer);
  }
  function resumeFromBackground() {
    applicationInBackground = false;
    updatePlaybackControls();
  }
  function resetPlayerUI() {
    closeDiscussion(false); resetDanmaku();
    closePlayerOptions(false); clearTimeout(controlsTimer);
    shell.classList.remove('is-controls-hidden'); exitCinema();
    setPlayerStatus('');
  }
  window.HongguoTV = { requestBack: handleBack, mediaCommand: handleMediaCommand, pauseForBackground: pauseForBackground, resumeFromBackground: resumeFromBackground };

  function isLibraryPage() { return ['history', 'favorites', 'likes'].indexOf(pageMode()) >= 0; }
  function libraryEntry(id) { return libraryData.entries.filter(function (entry) { return entry.drama.series_id === id; })[0] || null; }
  function libraryTime(entry, kind) { return entry[({ history: 'last_played_at', favorites: 'favorite_at', likes: 'liked_at' })[kind]] || 0; }
  function resumeEpisode(entry, item) {
    if (!entry || !entry.last_played_at || !entry.episode) return 1;
    if (!entry.completed) return entry.episode;
    return item.episode_count && entry.episode >= item.episode_count ? 1 : entry.episode + 1;
  }
  function clockText(value) { value = Math.max(0, Math.floor(value || 0)); return Math.floor(value / 60) + ':' + ('0' + value % 60).slice(-2); }
  function basicDrama(item) {
    var result = {};
    ['series_id', 'title', 'cover', 'cover_fallback', 'intro', 'score', 'episode_count', 'tags', 'season_index', 'is_multi_season'].forEach(function (key) { if (item[key] !== undefined) result[key] = item[key]; });
    return result;
  }
  function updateSavedButtons() {
    var entry = featuredItem && libraryEntry(featuredItem.series_id);
    ['favorite', 'like'].forEach(function (kind) {
      var button = document.querySelector('.round-action[data-action="' + kind + '"]');
      var saved = !!(entry && (kind === 'favorite' ? entry.favorite_at : entry.liked_at));
      button.classList.toggle('is-saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.querySelector('small').textContent = kind === 'favorite' ? saved ? '已收藏' : '收藏' : saved ? '已点赞' : '点赞';
    });
    var detailEntry = currentDetail && libraryEntry(currentDetail.series_id);
    var detailButton = document.getElementById('detail-save');
    detailButton.textContent = detailEntry && detailEntry.favorite_at ? '已收藏' : '收藏';
    detailButton.classList.toggle('is-saved', !!(detailEntry && detailEntry.favorite_at));
    detailButton.setAttribute('aria-pressed', String(!!(detailEntry && detailEntry.favorite_at)));
  }
  function loadLibrary() {
    var ownerEpoch = accountEpoch;
    libraryError = '';
    return fetch('/api/v1/library')
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (ownerEpoch !== accountEpoch) return false;
        if (!payload.ok || !payload.data) throw new Error(payload.error || '记录响应无效');
        libraryData = payload.data;
        libraryLoaded = true;
        updateSavedButtons();
        if (isLibraryPage()) renderLibrary(true);
        return true;
      }).catch(function (error) { libraryError = error.message; if (isLibraryPage()) renderLibrary(true); return false; });
  }
  function changeLibrary(change, quiet) {
    change.owner_id = libraryData.owner_id || '';
    var ownerEpoch = accountEpoch;
    var ready = libraryReady;
    var operation = libraryQueue.catch(function () {}).then(function () { return ready; }).then(function () {
      if (ownerEpoch !== accountEpoch) return false;
      return fetch('/api/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
        .then(function (response) {
          return response.json().then(function (payload) { if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '记录保存失败'); return payload; });
        }).then(function (payload) {
          if (ownerEpoch !== accountEpoch || (payload.data.owner_id || '') !== (libraryData.owner_id || '')) return false;
          libraryData = payload.data;
          libraryLoaded = true;
          updateSavedButtons();
          updateDetailProgress();
          if (isLibraryPage()) renderLibrary(!!quiet);
          return true;
        });
    });
    libraryQueue = operation;
    return operation.catch(function (error) { showNotice('本机记录未保存：' + error.message); return false; });
  }
  function toggleSaved(item, kind, button) {
    if (!item || !item.series_id || !libraryLoaded || button.disabled) return;
    var entry = libraryEntry(item.series_id);
    var saved = !!(entry && (kind === 'favorite' ? entry.favorite_at : entry.liked_at));
    var wasFocused = document.activeElement === button;
    button.disabled = true;
    changeLibrary({ action: kind, drama: basicDrama(item), value: !saved }).then(function (ok) {
      button.disabled = false;
      if (wasFocused && document.activeElement === document.body && button.getClientRects().length) goFocus(button);
      if (ok) showNotice(saved ? kind === 'favorite' ? '已取消收藏' : '已取消点赞' : kind === 'favorite' ? '已收藏到本机' : '已保存到本机点赞');
    });
  }
  function renderLibrary(restoring) {
    var kind = pageMode();
    if (!isLibraryPage()) return;
    var label = ({ history: '历史', favorites: '收藏', likes: '点赞' })[kind];
    document.getElementById('library-title').textContent = label;
    var storageLabel = libraryData.owner_id && kind !== 'likes' ? '当前账号 · 云同步' : '保存在本机';
    document.getElementById('library-hint').textContent = storageLabel + (kind === 'history' ? ' · 自动记住集数和进度 · 最多 200 部' : ' · 最多 300 部');
    var grid = document.getElementById('library-grid');
    var entries = libraryData.entries.filter(function (entry) { return libraryTime(entry, kind) > 0; });
    entries.sort(function (a, b) { return libraryTime(b, kind) - libraryTime(a, kind); });
    var existing = {};
    Array.prototype.forEach.call(grid.children, function (tile, index) { existing[tile.dataset.seriesId] = { tile: tile, index: index }; });
    if (restoring) entries.sort(function (a, b) { return (existing[a.drama.series_id] ? existing[a.drama.series_id].index : 10000) - (existing[b.drama.series_id] ? existing[b.drama.series_id].index : 10000); });
    var totalEntries = entries.length;
    var count = libraryPager.params.kind === kind ? Math.max(20, libraryPager.items.length) : 20;
    if (libraryPager.params.kind !== kind) libraryPager.cancel();
    libraryPager.params.kind = kind;
    libraryPager.local(entries.map(function (entry) { return entry.drama; }), count);
    entries = entries.slice(0, count);
    var current = document.activeElement;
    var currentTile = current.closest && current.closest('.library-tile');
    var priorIndex = currentTile && existing[currentTile.dataset.seriesId] ? existing[currentTile.dataset.seriesId].index : 0;
    var keep = {};
    entries.forEach(function (entry, index) {
      var id = entry.drama.series_id;
      var tile = existing[id] ? existing[id].tile : document.createElement('div');
      if (!existing[id]) {
        tile.className = 'library-tile';
        tile.dataset.seriesId = id;
        var card = document.createElement('button');
        card.className = 'library-card';
        card.dataset.focus = 'library-' + id;
        var image = document.createElement('img'); image.loading = 'lazy'; card.appendChild(image);
        ['title', 'meta', 'time'].forEach(function (name) { var span = document.createElement('span'); span.className = 'library-card-' + name; card.appendChild(span); });
        var progress = document.createElement('span'); progress.className = 'library-progress'; progress.appendChild(document.createElement('span')); card.appendChild(progress);
        card.addEventListener('click', function () { if (libraryEditing) goFocus(tile.querySelector('.library-remove')); else startPlayer(tile.__entry.drama, card); });
        card.addEventListener('focus', function () { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        tile.appendChild(card);
        var remove = document.createElement('button'); remove.className = 'library-remove'; remove.dataset.focus = 'library-remove-' + id; remove.textContent = '移除';
        remove.addEventListener('click', function () {
          var kind = pageMode();
          var index = Array.prototype.indexOf.call(grid.children, tile);
          var wasFocused = document.activeElement === remove;
          remove.disabled = true;
          changeLibrary({ action: 'remove', kind: kind, series_id: id }).then(function (ok) {
            remove.disabled = false;
            if (ok && wasFocused && pageMode() === kind && document.activeElement === document.body) {
              var cards = focusables('.library-card');
              goFocus(cards[Math.min(index, cards.length - 1)] || firstVisible('[data-action="library-discover"]'));
            }
          });
        });
        tile.appendChild(remove);
      }
      tile.__entry = entry;
      keep[id] = true;
      var card = tile.querySelector('.library-card');
      if (card.querySelector('img').alt !== entry.drama.title) setCover(card.querySelector('img'), entry.drama);
      card.querySelector('.library-card-title').textContent = entry.drama.title;
      card.querySelector('.library-card-meta').textContent = entry.last_played_at ? entry.completed && entry.drama.episode_count && entry.episode >= entry.drama.episode_count ? '已看完 · 全' + entry.episode + '集' : '继续第' + resumeEpisode(entry, entry.drama) + '集' + (!entry.completed && entry.position ? ' · ' + clockText(entry.position) : '') : entry.drama.episode_count ? '全' + entry.drama.episode_count + '集' : '从第一集播放';
      card.querySelector('.library-card-time').textContent = new Date(libraryTime(entry, kind)).toLocaleDateString();
      card.querySelector('.library-progress').classList.toggle('is-hidden', !entry.last_played_at || !entry.duration);
      card.querySelector('.library-progress > span').style.width = Math.min(100, entry.duration ? entry.position / entry.duration * 100 : 0) + '%';
      tile.querySelector('.library-remove').classList.toggle('is-hidden', !libraryEditing);
      if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);
    });
    Array.prototype.slice.call(grid.children).forEach(function (tile) { if (!keep[tile.dataset.seriesId]) tile.remove(); });
    document.getElementById('library-count').textContent = totalEntries ? totalEntries + ' 部 · 已显示 ' + entries.length + ' 部' : '';
    document.getElementById('library-manage').textContent = libraryError ? '重试' : libraryEditing ? '完成' : '管理';
    document.getElementById('library-manage').disabled = !libraryError && !entries.length;
    document.getElementById('library-clear').disabled = !entries.length;
    document.getElementById('library-empty').classList.toggle('is-hidden', entries.length > 0);
    document.getElementById('library-empty-title').textContent = libraryError ? '读取本机记录失败' : !libraryLoaded ? '正在读取本机记录…' : kind === 'history' ? '还没有观看记录' : '还没有' + label + '的短剧';
    document.getElementById('library-empty-copy').textContent = libraryError || (kind === 'history' ? '开始播放后，会自动保存集数和进度' : '在播放页点' + label + '，以后可从这里继续观看');
    if (currentTile && !document.contains(current)) {
      var cards = focusables('.library-card');
      goFocus(cards[Math.min(priorIndex, cards.length - 1)] || firstVisible('[data-action="library-discover"]'));
    } else if (currentTile && document.activeElement !== current) {
      goFocus(current);
    }
  }
  function closeConfirmation() {
    ++confirmationGeneration;
    confirmOpen = false;
    confirmOperation = null;
    document.getElementById('confirm-modal').classList.add('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'true');
    var target = confirmReturnFocus;
    confirmReturnFocus = null;
    goFocus(target && focusables().indexOf(target) >= 0 ? target : firstContentFocus());
  }
  function confirmClearLibrary() {
    ++confirmationGeneration;
    var kind = pageMode();
    var label = ({ history: '历史', favorites: '收藏', likes: '点赞' })[kind];
    confirmReturnFocus = document.activeElement;
    confirmOperation = function () { return changeLibrary({ action: 'clear', kind: kind }); };
    confirmOpen = true;
    document.getElementById('confirm-title').textContent = '清空全部' + label + '？';
    document.getElementById('confirm-accept').textContent = '清空';
    document.getElementById('confirm-copy').textContent = kind === 'history' ? '观看进度也会移除，收藏和点赞会保留。' : '只清空本机' + label + '，观看历史和其它记录会保留。';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    goFocus(document.getElementById('confirm-cancel'));
  }

  function setCatalogHeading(text) {
    document.getElementById('catalog-heading').textContent = text || '热播短剧';
  }

  function acceptAccountStatus(data) {
    var previous = accountData;
    var owner = data.profile && data.profile.uid || '';
    var previousOwner = previous && previous.profile && previous.profile.uid || '';
    accountData = data;
    accountCountdownUntil = Date.now() + (data.retry_after || 0) * 1000;
    if (owner !== previousOwner || owner !== (libraryData.owner_id || '')) {
      ++accountEpoch;
      allPagers.forEach(function (pager) { pager.cancel(); pager.loaded = false; pager.items = []; pager.buffer = []; if (pager.container) pager.container.innerHTML = ''; });
      closeDiscussion(false); resetDanmaku();
      calendarSchema = null;
      if (pageMode() === 'reservations') renderReservations(reservationMode);
      else if (pageMode() === 'new') { if (newMode === 'calendar') loadCalendar(); else loadNew(); }
      else if (pageMode() === 'rank') loadRank();
      else if (pageMode() === 'search') { if (searchKind === 'keyword') submitSearch(); else loadBrowse(false, !filterRows.length); }
      else if (pageMode() === 'recommend') loadCatalog(activeChannel().textContent);
      libraryData = { entries: [], owner_id: owner };
      libraryLoaded = false;
      libraryReady = libraryQueue.catch(function () {}).then(loadLibrary);
      updateSavedButtons();
      updateDetailProgress();
    } else if (data.logged_in && data.sync && previous && previous.sync && data.sync.last_sync !== previous.sync.last_sync) {
      libraryQueue.catch(function () {}).then(loadLibrary);
    }
    renderAccount();
  }
  function renderAccount() {
    var data = accountData || { phase: 'phone', logged_in: false, sync: { state: 'local' } };
    var logged = !!data.logged_in;
    var mfa = !logged && data.phase === 'mfa';
    document.getElementById('account-login-form').classList.toggle('is-hidden', logged || mfa);
    document.getElementById('account-profile').classList.toggle('is-hidden', !logged);
    document.getElementById('account-mfa').classList.toggle('is-hidden', !mfa);
    document.getElementById('account-code-field').classList.toggle('is-hidden', data.phase !== 'code');
    document.getElementById('account-login').classList.toggle('is-hidden', data.phase !== 'code');
    document.getElementById('account-change-phone').classList.toggle('is-hidden', data.phase !== 'code');
    var phoneInput = document.getElementById('account-phone');
    phoneInput.readOnly = accountBusy || data.phase === 'code' && /^1[3-9]\d{9}$/.test(phoneInput.value);
    phoneInput.placeholder = data.phase === 'code' && !phoneInput.value && data.phone ? '请重新输入 ' + data.phone + ' 的完整手机号' : '请输入手机号';
    document.querySelectorAll('.account-input').forEach(function (node) { node.disabled = accountBusy; });
    document.querySelectorAll('.account-action').forEach(function (node) { node.disabled = accountBusy; });
    document.getElementById('account-cancel').disabled = false;
    document.getElementById('account-change-phone').disabled = false;
    var remaining = Math.max(0, Math.ceil((accountCountdownUntil - Date.now()) / 1000));
    var send = document.getElementById('account-send-code');
    send.disabled = accountBusy || remaining > 0;
    send.textContent = remaining > 0 ? remaining + ' 秒后重发' : data.phase === 'code' ? '重新发送' : '获取验证码';
    document.getElementById('account-sync').disabled = !logged || accountBusy || data.sync && data.sync.state === 'syncing';
    if (logged) {
      document.getElementById('account-name').textContent = data.profile.name;
      document.getElementById('account-phone-mask').textContent = data.profile.phone || '';
    }
    document.getElementById('account-sms-number').textContent = data.sms_number || '';
    document.getElementById('account-sms-content').textContent = data.sms_content || '';
    var sync = data.sync || {};
    var syncLabel = !logged ? '未登录 · 记录保存在本机' : ({ syncing: '正在同步…', pending: '等待同步', error: '同步暂未完成', idle: sync.last_sync ? '已同步' : '尚未同步' })[sync.state] || '等待同步';
    document.getElementById('account-sync-state').textContent = syncLabel;
    document.getElementById('account-sync-detail').textContent = sync.error || (logged ? (sync.pending ? sync.pending + ' 项记录待同步。' : '收藏与观看进度会自动同步。') + (sync.last_sync ? ' 最近同步：' + new Date(sync.last_sync).toLocaleTimeString() : '') : '收藏、观看历史和播放进度会与红果账号同步。');
    document.getElementById('account-message').textContent = accountBusy ? '正在连接红果，请稍候…' : accountNotice || data.error || '';
    document.querySelector('.side-item[data-page="account"] span:last-child').textContent = logged ? '我的账号' : '我的 / 登录';
    if (pageMode() === 'account') document.getElementById('page-context').textContent = logged ? '我的账号' : '我的 / 登录';
    var current = document.activeElement;
    if (!accountBusy && !confirmOpen && pageMode() === 'account' && current && /accountInputs|accountActions/.test(zoneOf(current)) && focusables().indexOf(current) < 0) goFocus(firstContentFocus());
  }
  function setAccountMessage(message) { accountNotice = message; renderAccount(); }
  function pollAccount() {
    if (accountPollBusy || accountBusy) return Promise.resolve();
    accountPollBusy = true;
    var epoch = accountEpoch;
    var generation = accountRequestGeneration;
    return fetch('/api/v1/account').then(function (response) { return response.json(); }).then(function (payload) {
      if (epoch !== accountEpoch || generation !== accountRequestGeneration || accountBusy) return;
      if (!payload.ok || !payload.data) throw new Error(payload.error || '账号状态读取失败');
      acceptAccountStatus(payload.data);
    }).catch(function (error) { if (pageMode() === 'account') setAccountMessage(error.message); })
      .then(function () { accountPollBusy = false; });
  }
  function accountRequest(action, value) {
    if (accountBusy && action !== 'cancel') return Promise.resolve(false);
    var returnFocus = document.activeElement;
    function restoreRequestFocus() {
      if (pageMode() === 'account' && !confirmOpen && document.activeElement === document.body) goFocus(focusables().indexOf(returnFocus) >= 0 ? returnFocus : firstContentFocus());
    }
    accountBusy = true;
    accountNotice = '';
    var generation = ++accountRequestGeneration;
    renderAccount();
    return fetch('/api/v1/account/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value || {}) })
      .then(function (response) { return response.json(); }).then(function (payload) {
        if (generation !== accountRequestGeneration) return false;
        accountBusy = false;
        if (payload.data) acceptAccountStatus(payload.data);
        restoreRequestFocus();
        if (!payload.ok) throw new Error(payload.error || '账号请求失败');
        return true;
      }).catch(function (error) {
        if (generation !== accountRequestGeneration) return false;
        accountBusy = false; renderAccount();
        setAccountMessage(error.message);
        restoreRequestFocus();
        return false;
      });
  }
  function accountSendCode() {
    var phone = document.getElementById('account-phone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { setAccountMessage('请输入正确的手机号'); goFocus(document.getElementById('account-phone')); return; }
    accountRequest('send-code', { phone: phone }).then(function (ok) {
      if (pageMode() === 'account') goFocus(ok ? document.getElementById('account-code') : firstVisible('.account-input'));
    });
  }
  function accountLogin() {
    var phone = document.getElementById('account-phone').value.trim();
    var code = document.getElementById('account-code').value.trim();
    if (!/^\d{4,8}$/.test(code)) { setAccountMessage('请输入短信验证码'); goFocus(document.getElementById('account-code')); return; }
    accountRequest('login', { phone: phone, code: code }).then(function (ok) {
      if (!ok) { if (pageMode() === 'account') goFocus(document.getElementById('account-code')); return; }
      document.getElementById('account-code').value = '';
      if (pageMode() === 'account') goFocus(accountData.logged_in ? document.getElementById('account-logout') : document.getElementById('account-verify'));
    });
  }
  function cancelAccountVerification(returnToSidebar) {
    ++accountVerifyGeneration;
    clearTimeout(accountVerifyTimer);
    return accountRequest('cancel').then(function () {
      document.getElementById('account-code').value = '';
      if (pageMode() === 'account') goFocus(returnToSidebar === true ? activeSidebar() : document.getElementById('account-phone'));
    });
  }
  function verifyAccountSMS() {
    if (accountBusy) return;
    var generation = ++accountVerifyGeneration;
    var deadline = Date.now() + 90000;
    var count = 0;
    function verify() {
      if (generation !== accountVerifyGeneration || pageMode() !== 'account' || document.hidden) return;
      accountRequest('verify').then(function (ok) {
        if (generation !== accountVerifyGeneration) return;
        if (!ok || accountData.logged_in) { if (pageMode() === 'account') goFocus(accountData.logged_in ? document.getElementById('account-logout') : document.getElementById('account-verify')); return; }
        if (++count >= 30 || Date.now() >= deadline) { setAccountMessage('暂未确认短信，请检查收件号码和内容后重试'); goFocus(document.getElementById('account-verify')); return; }
        setAccountMessage('正在等待短信验证，可以按返回取消');
        accountVerifyTimer = setTimeout(verify, 3000);
      });
    }
    verify();
  }
  function confirmAccountLogout() {
    ++confirmationGeneration;
    confirmReturnFocus = document.activeElement;
    confirmOperation = function () {
      ++accountVerifyGeneration; clearTimeout(accountVerifyTimer);
      return accountRequest('logout').then(function (ok) { if (ok) { document.getElementById('account-phone').value = ''; document.getElementById('account-code').value = ''; } return ok; });
    };
    confirmOpen = true;
    document.getElementById('confirm-title').textContent = '退出当前账号？';
    document.getElementById('confirm-accept').textContent = '退出';
    document.getElementById('confirm-copy').textContent = '云端记录会保留。待同步记录留在当前账号的本机目录，再次登录这个账号后继续同步。退出后显示登录前的本机记录。';
    document.getElementById('confirm-modal').classList.remove('is-hidden');
    document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
    goFocus(document.getElementById('confirm-cancel'));
  }

  function catalogMeta(item) {
    var values = [];
    if (item.episode_count) values.push(item.episode_count + ' 集');
    if (item.score) values.push(item.score + ' 分');
    return values.join(' · ') || '红果短剧';
  }

  function setCover(image, item) {
    image.alt = item.title || '';
    image.src = item.cover_fallback || item.cover || '';
    image.onerror = function () { image.removeAttribute('src'); image.alt = ''; image.classList.add('is-empty'); };
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
      setCover(backdrop, item);
    }
    if (title) title.textContent = item.title || '红果短剧';
    if (episode) episode.textContent = '第' + (item.start_episode || 1) + '集' + (item.episode_count ? ' · 全' + item.episode_count + '集' : '');
    if (summary) summary.textContent = item.intro || '打开详情查看完整集数。';
    if (topTitle) topTitle.textContent = item.title || '红果短剧';
    if (topEpisode) topEpisode.textContent = '第' + (item.start_episode || 1) + '集';
    if (placeholderTitle) placeholderTitle.textContent = item.title || '红果短剧';
    if (placeholderSummary) placeholderSummary.textContent = item.intro || '打开详情查看完整集数和播放状态。';
    if (action) { action.textContent = '查看详情'; action.disabled = false; }
    updateSavedButtons();
    document.querySelector('[data-action="episodes"]').textContent = '选集 · ' + (item.episode_count || '--') + ' 集';
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

  function getDetail(item) {
    if (detailCache[item.series_id]) return Promise.resolve(detailCache[item.series_id]);
    return fetch('/api/v1/series/detail?series_id=' + encodeURIComponent(item.series_id))
      .then(function (response) { if (!response.ok) throw new Error('详情 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (!payload.ok || !payload.data) throw new Error(payload.error || '详情响应无效');
        var keys = Object.keys(detailCache);
        if (keys.length >= 24) delete detailCache[keys[0]];
        detailCache[item.series_id] = payload.data;
        return payload.data;
      });
  }

  function saveProgress(force, completed) {
    var playback = activePlayback;
    if (!playback || !playback.started) return Promise.resolve(false);
    var video = document.getElementById('hero-video');
    var now = Date.now();
    if (!force && now - playback.lastWrite < 10000) return Promise.resolve(false);
    playback.lastWrite = now;
    if (completed) playback.completed = true;
    return changeLibrary({ action: 'progress', drama: basicDrama(playback.item), episode: playback.episode, video_id: playback.vid,
      position: Math.max(0, Number(video.currentTime) || 0), duration: Number.isFinite(video.duration) ? video.duration : 0, completed: !!playback.completed }, true);
  }

  function canContinuePlayback(playback) {
    return activePlayback === playback && playback.generation === feedGeneration && isPlaybackPage() &&
      (!playback.continuationToken || playback.continuationToken === continuationGeneration) && !applicationInBackground && !document.hidden;
  }

  function continueAfterEpisode(playback) {
    if (!canContinuePlayback(playback) || playback.continuationPending) return;
    // Android 6 WebViews can support Promise without Promise.finally.
    function finishContinuation() { playback.continuationPending = false; playback.continuationToken = 0; }
    playback.continuationPending = true;
    playback.continuationToken = ++continuationGeneration;
    setPlayerStatus('正在读取下一集…');
    getDetail(playback.item).then(function (detail) {
      if (!canContinuePlayback(playback)) return;
      if (detail.vid_list && detail.vid_list[playback.episode]) {
        playFeedItem(feedIndex, playback.episode + 1, 0);
        return;
      }
      // Missing/incomplete episode data must not be mistaken for season end.
      if (!detail.vid_list || !detail.vid_list.length || playback.episode < Math.max(detail.episode_count || 0, detail.vid_list.length)) {
        throw new Error('本季集列表不完整');
      }
      setPlayerStatus('正在确认下一季…');
      return fetch('/api/v1/series/next-season?series_id=' + encodeURIComponent(playback.item.series_id))
        .then(function (response) { return response.json().then(function (payload) {
          if (!response.ok || !payload.ok || !payload.data || !Object.prototype.hasOwnProperty.call(payload.data, 'next')) throw new Error(payload.error || '季关系响应无效');
          return payload.data;
        }); })
        .then(function (result) {
          if (!canContinuePlayback(playback)) return;
          var next = result.next;
          if (next) {
            if (!next.series_id || next.series_id === playback.item.series_id || !next.vid || !(result.current_season > 0) || !(next.season_index > result.current_season) || !(next.episode_count > 0)) throw new Error('下一季数据无效');
            // Keep the original page/card return target, but start the new
            // series from episode 1 even when that series has old progress.
            feedItems[feedIndex] = next;
            playFeedItem(feedIndex, 1, 0);
            refreshDetailAfterSeason(playback.item.series_id, next);
            showNotice('继续播放第' + next.season_index + '季');
          } else if (pageMode() === 'recommend' && feedItems.length > 1) {
            playFeedItem(feedIndex + 1);
          } else {
            setPlayerStatus(''); revealControls(); showNotice('本剧已播放完，暂无可播放的下一季');
          }
        });
    }).catch(function (error) {
      if (!canContinuePlayback(playback)) return;
      setPlayerStatus(''); revealControls();
      showNotice('连续播放已暂停：' + error.message);
    }).then(finishContinuation, finishContinuation);
  }

  function refreshDetailAfterSeason(previousID, next) {
    if (!detailModalOpen || detailSeriesID !== previousID) return;
    var focused = document.activeElement;
    var index = focused && focused.classList.contains('detail-episode') ? 0 : -1;
    var generation = ++detailGeneration;
    detailSeriesID = next.series_id;
    currentDetail = next;
    renderDetail(next);
    if (index >= 0) goFocus(detailElements().play);
    getDetail(next).then(function (detail) {
      if (!detailModalOpen || generation !== detailGeneration || !currentDetail || currentDetail.series_id !== next.series_id) return;
      currentDetail = Object.assign({}, next, detail);
      renderDetail(currentDetail);
      if (index >= 0 && document.activeElement === detailElements().play && detailElements().episodes.firstElementChild) goFocus(detailElements().episodes.firstElementChild);
    }).catch(function () { if (detailModalOpen && generation === detailGeneration) showNotice('下一季选集暂时读取失败，可关闭后重试'); });
  }

  function playFeedItem(index, forcedEpisode, forcedPosition) {
    closeDiscussion(false); resetDanmaku();
    if (!feedItems.length) return;
    if (index < 0) index = feedItems.length - 1;
    if (index >= feedItems.length && pageMode() === 'recommend') {
      var pendingIndex = feedIndex;
      if (feedPager.error) { showNotice('推荐加载失败，请再按向下重试'); }
      if (feedPager.hasMore() || feedPager.error) {
        feedPager.load(!!feedPager.error).then(function () { if (pageMode() === 'recommend' && feedIndex === pendingIndex && index < feedItems.length) playFeedItem(index); });
      } else showNotice('已浏览全部推荐');
      return;
    }
    if (index >= feedItems.length) return;
    var item = feedItems[index];
    if (!item || !item.series_id) return;
    saveProgress(true);
    activePlayback = null;
    playbackRequest = { index: index, episode: forcedEpisode, position: forcedPosition };
    playbackQuality = '';
    feedIndex = index;
    if (pageMode() === 'recommend' && feedIndex >= feedItems.length - 3 && !feedPager.error) feedPager.load();
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
    placeholder.classList.add('is-hidden');
    setPlayerStatus('正在准备播放…');
    updatePlaybackControls();
    Promise.resolve(libraryReady).then(function () { return libraryQueue.catch(function () {}); }).then(function () {
      if (generation !== feedGeneration) return null;
      var entry = libraryEntry(item.series_id);
      var episode = forcedEpisode || resumeEpisode(entry, item);
      var position = forcedPosition !== undefined ? forcedPosition : entry && episode === entry.episode && !entry.completed ? entry.position || 0 : 0;
      playbackRequest.episode = episode; playbackRequest.position = position;
      var source = episode === 1 && firstVid(item) ? Promise.resolve(item) : getDetail(item);
      return source.then(function (detail) {
        if (generation !== feedGeneration) return null;
        var vid = episode === 1 ? firstVid(detail) : detail.vid_list && detail.vid_list[episode - 1];
        if (!vid) throw new Error('第' + episode + '集暂无视频数据');
        var playing = Object.assign({}, item, detail, { start_episode: episode, vid: vid });
        activePlayback = { item: playing, episode: episode, vid: vid, position: position, generation: generation, started: false, lastWrite: 0, completed: false };
        setFeatured(playing);
        setPlayerStatus('正在准备第 ' + episode + ' 集…');
        return fetch('/api/v1/play/info?series_id=' + encodeURIComponent(item.series_id) + '&vid=' + encodeURIComponent(vid));
      });
    })
      .then(function (response) { if (!response) return null; if (!response.ok) throw new Error('播放 HTTP ' + response.status); return response.json(); })
      .then(function (payload) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        if (!payload) return;
        if (!payload.ok || !payload.data || !payload.data.path) throw new Error(payload.error || '播放服务没有返回地址');
        video.src = payload.data.path;
        playbackQuality = payload.data.quality || '';
        updatePlaybackControls();
        video.classList.add('has-source');
        placeholder.classList.add('is-hidden');
        video.load();
        setPlayerStatus('正在加载视频…');
        if (!document.hidden && !applicationInBackground) video.play().catch(function () { setPlayerStatus(''); revealControls(); showNotice('视频已准备好，请按确认键开始播放'); });
        else { setPlayerStatus(''); revealControls(); }
      })
      .catch(function (error) {
        if (generation !== feedGeneration || (pageMode() !== 'recommend' && pageMode() !== 'player')) return;
        setPlayerStatus('暂时无法播放这集', true);
      });
  }

  function renderFeed(items) {
    feedItems = (items || []).filter(function (item) { return item && item.series_id; });
    feedIndex = feedItems.length ? 0 : -1;
    updateFeedCounter();
    if (!feedItems.length) {
      featuredItem = null;
      document.querySelector('[data-action="featured"]').disabled = true;
      document.getElementById('hero-placeholder-title').textContent = '暂时没有推荐内容';
      document.getElementById('hero-placeholder-summary').textContent = '请稍后刷新红果短剧推荐。';
      document.getElementById('hero-placeholder').classList.remove('is-hidden');
      return;
    }
    playFeedItem(0);
  }

  function startPlayer(item, returnFocus) {
    if (!item || !item.series_id) return;
    allPagers.forEach(function (pager) { pager.cancel(); });
    if (!isPlaybackPage()) resetPlayerUI();
    if (pageMode() !== 'player') {
      playerReturnPage = pageMode();
      playerReturnFocus = returnFocus || document.activeElement;
    }
    shell.dataset.mode = 'player';
    shell.classList.add('is-player');
    mainSurface.classList.remove('has-search', 'has-placeholder', 'has-workspace');
    hideWorkspacePages();
    searchPage.classList.add('is-hidden');
    pagePlaceholder.classList.add('is-hidden');
    document.getElementById('page-context').textContent = '← 返回';
    document.getElementById('hero').classList.add('is-feed');
    feedItems = [item];
    feedIndex = 0;
    playFeedItem(0, item.__explicitEpisode ? item.start_episode : undefined, item.__explicitEpisode ? 0 : undefined);
    goFocus(document.getElementById('hero-feed-focus'));
  }

  function leavePlayer() {
    var page = playerReturnPage || 'search';
    var target = playerReturnFocus;
    playerReturnPage = null;
    playerReturnFocus = null;
    var item = document.querySelector('.side-item[data-page="' + page + '"]');
    if (!item) item = document.querySelector('.side-item[data-page="recommend"]');
    if (item) activatePage(item, true);
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
      setCover(image, item);
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

  function renderSearchResults(items, append) {
    if (!append) { searchResults.innerHTML = ''; searchItems = []; }
    var seen = {};
    searchItems.forEach(function (item) { seen[item.series_id] = true; });
    var list = (items || []).filter(function (item) {
      if (!item || !item.series_id || seen[item.series_id]) return false;
      seen[item.series_id] = true;
      return true;
    });
    searchItems = searchItems.concat(list);
    document.getElementById('search-result-count').textContent = searchItems.length ? '已加载 ' + searchItems.length + ' 部' : '';
    if (!searchItems.length) {
      var empty = document.createElement('div');
      empty.className = 'search-result-empty';
      empty.textContent = searchKind === 'browse' ? '没有符合这些条件的短剧，试试放宽筛选。' : '没有找到匹配的短剧，换个关键词试试。';
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
      image.loading = 'lazy';
      setCover(image, item);
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
    return list;
  }

  function lastSearchFilter() {
    var rows = document.querySelectorAll('.filter-row[data-filter-group]');
    var row = rows[rows.length - 1];
    return row && !document.getElementById('filter-panel').classList.contains('is-hidden') ? row.querySelector('.is-active') || row.querySelector('button') : null;
  }

  function filterSummary() {
    var labels = [];
    filterRows.forEach(function (row) {
      var value = searchFilters[row.type];
      row.options.forEach(function (option) { if (value === option.id) labels.push(option.label); });
    });
    return labels.join(' · ') || '全部短剧';
  }

  function renderFilterRows(rows) {
    var current = document.activeElement;
    var focusKey = zoneOf(current) === 'searchFilters' ? current.dataset.focus : '';
    filterRows = rows;
    var container = document.getElementById('filter-rows');
    container.innerHTML = '';
    rows.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'filter-row';
      line.dataset.filterGroup = row.type;
      var label = document.createElement('strong');
      label.textContent = row.label;
      line.appendChild(label);
      var options = document.createElement('div');
      options.className = 'filter-options';
      [{ id: '', label: '全部' }].concat(row.options).forEach(function (option) {
        var button = document.createElement('button');
        button.className = 'search-filter';
        button.dataset.filterType = row.type;
        button.dataset.filterValue = option.id;
        button.dataset.focus = 'filter-' + row.type + '-' + (option.id || 'all');
        button.textContent = option.label;
        var active = (searchFilters[row.type] || '') === option.id;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.addEventListener('click', function () { selectSearchFilter(button); });
        button.addEventListener('focus', function () { button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        options.appendChild(button);
      });
      line.appendChild(options);
      container.appendChild(line);
    });
    if (focusKey) goFocus(container.querySelector('[data-focus="' + focusKey + '"]') || firstSearchFilter());
    document.getElementById('filter-state').textContent = filterSummary();
  }

  function loadBrowse(append, refreshFilters) {
    if (append) return searchPager.load(searchPager.error !== '');
    var path = ({ comic_series: '/category/comic-drama', ai_series: '/category/ai-drama' })[searchFilters.genre] || '/category/real-drama';
    if (refreshFilters || !filterRows.length) searchPanelPending = true;
    var params = Object.assign({ path: path }, searchFilters);
    if (searchPanelPending) params.selectors = '1';
    searchKind = 'browse';
    document.getElementById('filter-panel').classList.remove('is-hidden');
    document.getElementById('search-browse').classList.add('is-hidden');
    document.getElementById('search-result-title').textContent = filterSummary();
    return searchPager.reset(params);
  }

  function beginBrowse() {
    searchInput.value = '';
    loadBrowse(false, !filterRows.length);
    goFocus(firstSearchFilter() || searchInput);
  }

  function dramaMeta(item) {
    var values = [];
    if (item.score) values.push(item.score + '分');
    if (item.episode_count) values.push('全' + item.episode_count + '集');
    if (item.tags && item.tags.length) values.push(item.tags.slice(0, 2).join(' · '));
    return values.join(' · ') || '红果短剧';
  }

  function rankLabel() {
    var active = document.querySelector('.rank-subtab.is-active');
    return active ? active.textContent : '热播榜';
  }

  function renderMessage(container, className, message) {
    container.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = className;
    empty.textContent = message;
    container.appendChild(empty);
  }

  function renderRankSelectors(data) {
    if (!data || !data.length) return;
    rankOptions = data;
    var key = document.activeElement && document.activeElement.dataset.focus;
    var priorZone = zoneOf(document.activeElement);
    var root = document.getElementById('rank-tabs');
    var subnav = document.getElementById('rank-subnav');
    var panels = document.getElementById('rank-panels');
    root.innerHTML = ''; subnav.innerHTML = ''; panels.innerHTML = '';
    var active = data.filter(function (x) { return x.id === rankSelection.rank; })[0] || data[0];
    rankSelection.rank = active.id;
    var children = active.children || [];
    var sub = children.filter(function (x) { return x.id === rankSelection.rank_sub; })[0] || children.filter(function (x) { return x.selected; })[0] || children[0];
    if (sub) rankSelection.rank_sub = sub.id;
    function button(option, cls, selected, target, handler) {
      var node = document.createElement('button'); node.className = cls + (selected ? ' is-active' : '');
      node.dataset.focus = cls + '-' + (option.id || 'all'); node.textContent = option.label;
      node.setAttribute('aria-pressed', String(selected));
      node.addEventListener('click', handler); target.appendChild(node); return node;
    }
    data.forEach(function (option) {
      button(option, 'rank-tab', option === active, root, function () {
        rankSelection = { rank: option.id, rank_sub: '', rank_panel: '' };
        var child = (option.children || []).filter(function (x) { return x.label === '热播榜'; })[0] || (option.children || [])[0];
        if (child) rankSelection.rank_sub = child.id;
        renderRankSelectors(rankOptions); loadRank();
      });
    });
    children.forEach(function (option) { button(option, 'rank-subtab', option === sub, subnav, function () { rankSelection.rank_sub = option.id; rankSelection.rank_panel = ''; renderRankSelectors(rankOptions); loadRank(); }); });
    (sub && sub.panels || []).forEach(function (group) {
      var line = document.createElement('div'); line.className = 'rank-panel-row';
      var label = document.createElement('span'); label.textContent = group.label; line.appendChild(label);
      group.options.forEach(function (option) { button(option, 'rank-panel', option.id === rankSelection.rank_panel, line, function () { rankSelection.rank_panel = option.id; renderRankSelectors(rankOptions); loadRank(); }); });
      panels.appendChild(line);
    });
    if (['rankTabs', 'rankSubnav', 'rankPanels'].indexOf(priorZone) >= 0) {
      var match = Array.prototype.filter.call(document.querySelectorAll('[data-focus]'), function (node) { return node.dataset.focus === key; })[0];
      goFocus(match || firstVisible('.rank-tab.is-active'));
    }
  }

  function renderRank(items, append) {
    if (!append) { rankItems = []; rankList.innerHTML = ''; }
    var start = rankItems.length;
    rankItems = rankItems.concat(items || []);
    document.getElementById('rank-list-title').textContent = rankLabel();
    document.getElementById('rank-list-update').textContent = rankItems.length ? '已加载 ' + rankItems.length + (rankSelection.rank === 'ranklist_celebrity' ? '位' : '部') : '暂时没有榜单内容';
    if (!rankItems.length) {
      rankList.innerHTML = '<div class="rank-empty">暂时没有榜单内容，请稍后刷新。</div>';
      return;
    }
    (items || []).forEach(function (item, localIndex) {
      var index = start + localIndex;
      var row = document.createElement('div');
      row.className = 'rank-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', (item.actor_id ? '演员：' : '播放：') + item.title);
      row.dataset.index = String(index);
      row.dataset.focus = 'rank-item-' + item.series_id;
      var rank = document.createElement('span');
      rank.className = 'rank-row-rank';
      rank.textContent = String(item.rank || index + 1);
      var image = document.createElement('img');
      image.className = 'rank-row-image';
      setCover(image, item);
      var copy = document.createElement('span');
      copy.className = 'rank-row-copy';
      var title = document.createElement('span');
      title.className = 'rank-row-title';
      title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span');
      meta.className = 'rank-row-meta';
      meta.textContent = dramaMeta(item);
      var intro = document.createElement('span');
      intro.className = 'rank-row-intro';
      intro.textContent = item.intro || '暂无简介';
      var heat = document.createElement('span');
      heat.className = 'rank-row-heat';
      heat.textContent = item.heat || item.favorite_text || item.like_text || '';
      copy.appendChild(title); copy.appendChild(meta); copy.appendChild(intro); copy.appendChild(heat);
      var side = document.createElement('span');
      side.className = 'rank-row-side';
      var play = document.createElement('button');
      play.className = 'rank-row-play';
      play.textContent = '▶ 播放';
      var detail = document.createElement('button');
      detail.className = 'rank-row-detail';
      detail.textContent = '详情';
      play.addEventListener('click', function (event) { event.stopPropagation(); startPlayer(item, play); });
      detail.addEventListener('click', function (event) { event.stopPropagation(); openDetail(item); });
      if (!item.actor_id) { side.appendChild(play); side.appendChild(detail); }
      row.appendChild(rank); row.appendChild(image); row.appendChild(copy); row.appendChild(side);
      row.addEventListener('click', function (event) { if (!item.actor_id && !event.target.closest('button')) startPlayer(item, row); });
      row.addEventListener('focus', function () { try { row.scrollIntoView({ block: 'nearest' }); } catch (ignore) {} });
      rankList.appendChild(row);
    });
  }

  function loadRank() { return rankPager.reset(Object.assign({}, rankSelection)); }

  function renderNew(items, append) {
    if (!append) { newItems = []; newGrid.innerHTML = ''; }
    newItems = newItems.concat(items || []);
    if (!newItems.length) {
      newGrid.innerHTML = '<div class="search-result-empty">暂时没有新剧内容。</div>';
      return;
    }
    (items || []).forEach(function (item) {
      var card = document.createElement('button');
      card.className = 'new-card';
      card.dataset.focus = 'new-item-' + item.series_id;
      var poster = document.createElement('span'); poster.className = 'new-card-poster';
      var image = document.createElement('img');
      image.className = 'new-card-image'; setCover(image, item);
      var episodeCount = document.createElement('span'); episodeCount.className = 'new-card-episodes'; episodeCount.textContent = item.episode_count ? '共' + item.episode_count + '集' : '';
      poster.appendChild(image); if (episodeCount.textContent) poster.appendChild(episodeCount);
      var title = document.createElement('span'); title.className = 'new-card-title'; title.textContent = item.title || '未命名短剧';
      var meta = document.createElement('span'); meta.className = 'new-card-meta'; meta.textContent = (item.tags || []).slice(0, 3).join(' · ') || '新剧';
      var score = document.createElement('span'); score.className = 'new-card-score'; score.textContent = item.score ? item.score + ' 分' : (item.episode_count ? '共' + item.episode_count + '集' : '');
      card.appendChild(poster); card.appendChild(title); card.appendChild(meta); card.appendChild(score);
      card.addEventListener('click', function () { startPlayer(item, card); });
      card.addEventListener('focus', function () { try { card.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (ignore) {} });
      newGrid.appendChild(card);
    });
  }

  function renderCalendarDays(schema) {
    if (!schema || !schema.dates || !schema.dates.length) return;
    if (calendarSchema && JSON.stringify(calendarSchema.dates) === JSON.stringify(schema.dates)) return;
    calendarSchema = schema;
    if (!calendarDate) calendarDate = schema.default_date;
    var key = document.activeElement && document.activeElement.dataset.focus;
    var onDays = zoneOf(document.activeElement) === 'calendarDays';
    dateStrip.innerHTML = '';
    schema.dates.forEach(function (value) {
      var date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
      var day = document.createElement('button'); day.className = 'calendar-day' + (value === calendarDate ? ' is-active' : '');
      day.dataset.focus = 'calendar-day-' + value; day.dataset.date = value;
      var week = document.createElement('span'); week.textContent = value === schema.current_date ? '今天' : '周' + ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
      var label = document.createElement('strong'); label.textContent = (date.getMonth() + 1) + '/' + date.getDate();
      day.appendChild(week); day.appendChild(label);
      day.addEventListener('click', function () { calendarDate = value; document.querySelectorAll('.calendar-day').forEach(function (node) { node.classList.toggle('is-active', node === day); }); loadCalendar(); });
      day.addEventListener('focus', function () { day.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      dateStrip.appendChild(day);
    });
    if (onDays) goFocus(dateStrip.querySelector('[data-focus="' + key + '"]') || firstCalendarDay());
    else { var selected = dateStrip.querySelector('.is-active'); if (selected) selected.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }

  function changeReservation(item, button) {
    if (!item.reservation_id || button.disabled) return;
    if (!accountData || !accountData.logged_in) {
      showNotice('请先登录红果账号'); activatePage(document.querySelector('.side-item[data-page="account"]')); return;
    }
    var epoch = accountEpoch; var reserve = !item.reserved;
    var originPage = pageMode(); var hadFocus = document.activeElement === button;
    button.disabled = true; button.textContent = reserve ? '正在预约…' : '正在取消…';
    fetchData('/api/v1/reservation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: item.reservation_id, reserved: reserve }) })
      .then(function () {
        if (epoch !== accountEpoch) return;
        item.reserved = reserve;
        document.querySelectorAll('.publication-row').forEach(function (row) { if (row.__item && row.__item.reservation_id === item.reservation_id) { row.__item.reserved = reserve; var b = row.querySelector('.publication-action'); if (b) b.textContent = reserve ? '取消预约' : '预约'; } });
        if (!reserve && pageMode() === 'reservations') {
          var row = button.closest('.publication-row'); var next = row.nextElementSibling || row.previousElementSibling;
          var focused = hadFocus && (document.activeElement === button || document.activeElement === document.body);
          reservationPager.items = reservationPager.items.filter(function (x) { return x.reservation_id !== item.reservation_id; });
          reservationPager.buffer = reservationPager.buffer.filter(function (x) { return x.reservation_id !== item.reservation_id; });
          row.remove(); if (focused) goFocus(next || firstVisible('.reservation-tab.is-active'));
          if (!reservationPager.items.length) renderPublications([], false, true);
        }
        showNotice(reserve ? '已预约，上线后可在预约中查看' : '已取消预约');
      }).catch(function (error) { if (epoch === accountEpoch) showNotice(error.message); })
      .then(function () {
        if (epoch !== accountEpoch) return;
        button.disabled = false; button.textContent = item.reserved ? '取消预约' : '预约';
        if (hadFocus && pageMode() === originPage && document.contains(button) && document.activeElement === document.body) goFocus(button);
      });
  }
  function renderPublications(items, append, reservations) {
    var container = reservations ? document.getElementById('reservation-list') : calendarList;
    if (!append) container.innerHTML = '';
    if (!items.length && !container.children.length) renderMessage(container, 'calendar-empty', reservations ? '暂无' + (reservationMode === 'online' ? '已上线' : '待上线') + '的预约' : '这一天暂无上新安排');
    items.forEach(function (item) {
      var row = document.createElement('div'); row.className = 'publication-row ' + (reservations ? 'reservation-row' : 'calendar-row'); row.tabIndex = 0;
      row.dataset.focus = (reservations ? 'reservation-' : 'calendar-') + (item.reservation_id || item.series_id); row.__item = item;
      var image = document.createElement('img'); image.loading = 'lazy'; setCover(image, item); row.appendChild(image);
      var copy = document.createElement('div'); copy.className = 'publication-copy';
      var title = document.createElement('strong'); title.textContent = item.title;
      var meta = document.createElement('span'); meta.textContent = dramaMeta(item);
      var summary = document.createElement('p'); summary.textContent = item.intro || '';
      var schedule = document.createElement('span'); schedule.className = 'publication-date';
      schedule.textContent = (item.upcoming ? '待上线 · ' : '已上线 · ') + (item.publish_text || (item.publish_time ? new Date(item.publish_time * 1000).toLocaleString() : '上线时间待定'));
      copy.appendChild(title); copy.appendChild(meta); copy.appendChild(summary); copy.appendChild(schedule); row.appendChild(copy);
      if (item.reservation_id) {
        var action = document.createElement('button'); action.className = 'publication-action'; action.dataset.focus = row.dataset.focus + '-reserve'; action.textContent = item.reserved ? '取消预约' : '预约';
        action.addEventListener('click', function (event) { event.stopPropagation(); changeReservation(item, action); }); row.appendChild(action);
      }
      row.addEventListener('click', function (event) { if (event.target.closest('button')) return; if (item.upcoming) { var action = row.querySelector('button'); if (action) goFocus(action); else showNotice('这部短剧尚未上线'); } else startPlayer(item, row); });
      row.addEventListener('focus', function () { row.scrollIntoView({ block: 'nearest' }); });
      container.appendChild(row);
    });
  }
  function genderParam() { return ({ male: '1', female: '0' })[newGender] || '2'; }
  function loadCalendar() { return calendarPager.reset({ date: calendarDate, gender: genderParam() }); }
  function loadNew() { return newPager.reset({ gender: genderParam() }); }
  function renderNewMode() {
    var calendar = newMode === 'calendar';
    dateStrip.classList.toggle('is-hidden', !calendar); newGrid.classList.toggle('is-hidden', calendar); calendarList.classList.toggle('is-hidden', !calendar);
    document.getElementById('new-pagination').classList.toggle('is-hidden', calendar);
    document.getElementById('calendar-pagination').classList.toggle('is-hidden', !calendar);
  }
  function switchNewMode(mode) {
    newMode = mode === 'calendar' ? 'calendar' : 'recommend';
    document.querySelectorAll('.new-tab').forEach(function (node) { node.classList.toggle('is-active', node.dataset.newMode === newMode); });
    newPager.cancel(); calendarPager.cancel(); renderNewMode();
    if (newMode === 'calendar') { if (!calendarPager.loaded) loadCalendar(); else queueTailCheck(); }
    else { if (!newPager.loaded) loadNew(); else queueTailCheck(); }
  }
  function renderReservations(mode, restoring) {
    reservationMode = mode || reservationMode;
    document.querySelectorAll('.reservation-tab').forEach(function (node) { node.classList.toggle('is-active', node.dataset.reservationMode === reservationMode); });
    if (restoring && reservationPager.loaded) { queueTailCheck(); return; }
    if (!accountData || !accountData.logged_in) {
      reservationPager.cancel(); reservationPager.items = []; reservationPager.loaded = false;
      renderMessage(document.getElementById('reservation-list'), 'calendar-empty', '登录后查看你的预约');
      var login = document.createElement('button'); login.className = 'publication-action'; login.textContent = '登录红果账号'; login.addEventListener('click', function () { activatePage(document.querySelector('.side-item[data-page="account"]')); });
      document.getElementById('reservation-list').appendChild(login); return;
    }
    reservationPager.reset({ mode: reservationMode });
  }

  function submitSearch() {
    var query = searchInput ? searchInput.value.trim() : '';
    if (!query) { showNotice('请输入剧名或关键词'); goFocus(searchInput); return; }
    var returnTarget = document.activeElement;
    activeSearchQuery = query; searchKind = 'keyword';
    document.getElementById('filter-panel').classList.add('is-hidden'); document.getElementById('search-browse').classList.remove('is-hidden');
    document.getElementById('search-result-title').textContent = '搜索：' + query;
    searchPager.reset({ q: query }).then(function () { if (activeSearchQuery === query && pageMode() === 'search' && !searchPager.error && document.activeElement === returnTarget) goFocus(firstSearchResult() || searchInput); });
  }

  function loadCatalog(title) {
    saveProgress(true); activePlayback = null; ++feedGeneration;
    document.getElementById('hero-video').pause();
    document.getElementById('hero-video').removeAttribute('src');
    resetDanmaku(); closeDiscussion(false);
    var channel = activeChannel();
    var tab = ({ 'channel-follow': '45', 'channel-comic': '36', 'channel-real': '39', 'channel-recommend': '16' })[channel && channel.dataset.focus] || '16';
    if (tab === '45' && (!accountData || !accountData.logged_in)) {
      feedPager.cancel(); renderFeed([]);
      document.getElementById('hero-placeholder-title').textContent = '登录后查看关注内容';
      document.getElementById('hero-placeholder-summary').textContent = '在我的账号中登录红果账号。'; return Promise.resolve([]);
    }
    setCatalogHeading(title || '推荐');
    return feedPager.reset({ channel: tab }).then(function firstContent() {
      if (pageMode() !== 'recommend' || feedPager.params.channel !== tab) return;
      if (!feedPager.items.length && feedPager.hasMore() && !feedPager.error) return feedPager.load().then(firstContent);
      if (pageMode() === 'recommend' && feedPager.error) {
        document.getElementById('hero-placeholder-title').textContent = '推荐加载失败';
        document.getElementById('hero-placeholder-summary').textContent = feedPager.error + '，重新选择频道可重试。';
        document.getElementById('hero-placeholder').classList.remove('is-hidden');
      }
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
    setCover(nodes.cover, item);
    nodes.meta.textContent = [item.episode_count ? item.episode_count + ' 集' : '', item.score ? item.score + ' 分' : ''].filter(Boolean).join(' · ');
    nodes.intro.textContent = item.intro || '暂无简介';
    var entry = libraryEntry(item.series_id);
    var episode = resumeEpisode(entry, item);
    nodes.play.textContent = entry && entry.last_played_at ? entry.completed && episode === 1 ? '重新播放' : '继续第' + episode + '集' : '播放第一集';
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
    if (entry && entry.episode) updateEpisodeHighlight(entry.episode - 1);
    updateSavedButtons();
  }

  function updateDetailProgress() {
    if (!detailModalOpen || !currentDetail) return;
    var entry = libraryEntry(currentDetail.series_id);
    var episode = resumeEpisode(entry, currentDetail);
    detailElements().play.textContent = entry && entry.last_played_at ? entry.completed && episode === 1 ? '重新播放' : '继续第' + episode + '集' : '播放第一集';
    updateEpisodeHighlight(entry && entry.episode ? entry.episode - 1 : -1);
  }

  function openDetail(item) {
    if (!item || !item.series_id) return;
    closePlayerOptions(false); clearTimeout(controlsTimer); revealControls();
    detailReturnFocus = document.activeElement;
    detailModalOpen = true;
    detailSeriesID = item.series_id;
    currentDetail = null;
    var generation = ++detailGeneration;
    detailModal.classList.remove('is-hidden');
    detailModal.setAttribute('aria-hidden', 'false');
    var nodes = detailElements();
    nodes.title.textContent = '正在读取详情…';
    nodes.name.textContent = '正在读取详情…';
    nodes.intro.textContent = '请稍候…';
    nodes.play.disabled = true;
    nodes.episodes.innerHTML = '';
    goFocus(document.querySelector('.detail-close'));
    getDetail(item).then(function (detail) {
        if (!detailModalOpen || generation !== detailGeneration) return;
        currentDetail = Object.assign({}, item, detail);
        renderDetail(currentDetail);
        goFocus(document.querySelector('.detail-play'));
      })
      .catch(function (error) {
        if (!detailModalOpen || generation !== detailGeneration) return;
        detailElements().title.textContent = '详情加载失败';
        detailElements().intro.textContent = error.message;
        showNotice('详情加载失败：' + error.message);
        goFocus(document.querySelector('.detail-close'));
      });
  }

  function closeDetail() {
    detailModalOpen = false;
    detailSeriesID = '';
    currentDetail = null;
    detailModal.classList.add('is-hidden');
    detailModal.setAttribute('aria-hidden', 'true');
    var target = detailReturnFocus && document.contains(detailReturnFocus) ? detailReturnFocus : firstCatalog() || activeChannel();
    detailReturnFocus = null;
    goFocus(target);
    scheduleControlsHide();
  }

  function updateEpisodeHighlight(index) {
    document.querySelectorAll('.detail-episode').forEach(function (node) {
      node.classList.toggle('is-playing', Number(node.dataset.index) === index);
    });
  }

  function playEpisode(index) {
    if (!currentDetail || !currentDetail.episodes || !currentDetail.episodes[index]) return;
    var episode = currentDetail.episodes[index];
    var item = Object.assign({}, currentDetail, { vid: episode.video_id, start_episode: episode.index, __explicitEpisode: true });
    var returnFocus = detailReturnFocus;
    closeDetail();
    startPlayer(item, returnFocus);
  }

  function toggleVideo() {
    var video = document.getElementById('hero-video');
    if (!video.src) { showNotice('请先打开一部短剧并选择集数。'); return; }
    if (video.paused) video.play().catch(function () { showNotice('播放被设备阻止，请再次确认。'); });
    else video.pause();
  }

  function activatePage(item, restoring) {
    saveProgress(true);
    allPagers.forEach(function (pager) { pager.cancel(); });
    activePlayback = null;
    ++feedGeneration;
    document.getElementById('hero-video').pause();
    resetPlayerUI();
    document.querySelectorAll('.side-item').forEach(function (node) { node.classList.toggle('is-active', node === item); });
    var label = item.querySelector('span:last-child');
    shell.dataset.mode = item.dataset.page || 'recommend';
    document.getElementById('page-context').textContent = label ? label.textContent : '页面';
    shell.classList.remove('is-player');
    mainSurface.classList.remove('has-search', 'has-workspace', 'has-placeholder');
    searchPage.classList.add('is-hidden');
    pagePlaceholder.classList.add('is-hidden');
    hideWorkspacePages();
    if (item.dataset.page === 'recommend') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      document.getElementById('hero').classList.add('is-feed');
      var active = document.querySelector('.channel-tab.is-active');
      loadCatalog(active ? active.textContent : '推荐');
    } else if (item.dataset.page === 'search') {
      mainSurface.classList.remove('has-placeholder');
      pagePlaceholder.classList.add('is-hidden');
      mainSurface.classList.add('has-search');
      searchPage.classList.remove('is-hidden');
      if (!searchPager.loaded) { if (searchKind === 'keyword' && activeSearchQuery) submitSearch(); else loadBrowse(false, !filterRows.length); } else queueTailCheck();
    } else if (item.dataset.page === 'rank') {
      mainSurface.classList.add('has-workspace');
      rankPage.classList.remove('is-hidden');
      if (!rankPager.loaded) loadRank(); else queueTailCheck();
    } else if (item.dataset.page === 'new') {
      mainSurface.classList.add('has-workspace');
      newPage.classList.remove('is-hidden');
      renderNewMode(); if (newMode === 'recommend' && !newPager.loaded) loadNew(); else if (newMode === 'calendar' && !calendarPager.loaded) loadCalendar(); else queueTailCheck();
    } else if (item.dataset.page === 'reservations') {
      mainSurface.classList.add('has-workspace');
      reservationPage.classList.remove('is-hidden');
      var reservationTab = document.querySelector('.reservation-tab.is-active');
      renderReservations(reservationTab ? reservationTab.dataset.reservationMode : 'online', restoring);
    } else if (['history', 'favorites', 'likes'].indexOf(item.dataset.page) >= 0) {
      mainSurface.classList.add('has-workspace');
      libraryPage.classList.remove('is-hidden');
      if (!restoring) libraryEditing = false;
      renderLibrary(!!restoring);
    } else if (item.dataset.page === 'account') {
      mainSurface.classList.add('has-workspace');
      accountPage.classList.remove('is-hidden');
      renderAccount();
      pollAccount();
    } else {
      mainSurface.classList.add('has-placeholder');
      pagePlaceholder.classList.remove('is-hidden');
      document.getElementById('page-placeholder-title').textContent = label ? label.textContent : '页面';
      document.getElementById('page-placeholder-copy').textContent = (label ? label.textContent : '这个页面') + '的数据和交互正在接入。';
      showNotice((label ? label.textContent : '页面') + '页面已进入，下一步接入对应数据。');
    }
    if (!restoring) goFocus(firstContentFocus());
  }

  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('scroll', queueTailCheck, true);
  window.addEventListener('resize', queueTailCheck);
  document.addEventListener('focusin', function (event) {
    markFocus(event.target);
    queueTailCheck();
    var zone = zoneOf(event.target);
    if (zone === 'controls' && event.target.closest('.playback-buttons')) lastPlaybackControl = event.target;
    if (zone === 'sidebar') clearTimeout(controlsTimer);
    else if (isPlaybackPage() && ['controls', 'timeline', 'actions', 'channels'].indexOf(zone) >= 0) revealControls();
    if (!detailModalOpen && !confirmOpen && !playerOptionsOpen && !discussionOpen && zone !== 'sidebar') {
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
      } else if (item.dataset.action === 'search-browse') {
        beginBrowse();
      } else if (item.dataset.action === 'favorite' || item.dataset.action === 'like') {
        toggleSaved(featuredItem, item.dataset.action, item);
      } else if (item.dataset.action === 'library-discover') {
        activatePage(document.querySelector('.side-item[data-page="search"]'));
      } else if (item.dataset.action === 'comment') openDiscussion(item);
      else if (item.dataset.action === 'danmaku') toggleDanmaku();
      else if (item.dataset.action === 'featured') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      } else if (item.dataset.action === 'play' || item.dataset.action === 'pause') toggleVideo();
      else if (item.dataset.action === 'episodes') {
        if (featuredItem) openDetail(featuredItem);
        else showNotice('当前还没有可打开的短剧。');
      }
      else if (item.dataset.action === 'speed' || item.dataset.action === 'volume') openPlayerOptions(item.dataset.action, item);
      else if (item.dataset.action === 'fullscreen') toggleCinema();
      else if (item.dataset.action === 'quality') showNotice(playbackQuality ? '当前清晰度 ' + playbackQuality + ' · 自动选择' : '播放后显示实际清晰度');
      else if (item.dataset.action === 'retry') {
        if (playbackRequest) { goFocus(document.getElementById('hero-feed-focus')); playFeedItem(playbackRequest.index, playbackRequest.episode, playbackRequest.position); }
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
      loadCatalog(item.textContent);
    });
  });
  document.querySelectorAll('.new-tab').forEach(function (item) {
    item.addEventListener('click', function () { switchNewMode(item.dataset.newMode); });
  });
  document.querySelectorAll('.new-filter').forEach(function (item) {
    item.addEventListener('click', function () {
      newGender = item.dataset.newGender;
      newItems = [];
      document.querySelectorAll('.new-filter').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      newPager.cancel(); calendarPager.cancel();
      newPager.loaded = false; calendarPager.loaded = false;
      if (newMode === 'recommend') loadNew(); else loadCalendar();
    });
  });
  document.querySelectorAll('.reservation-tab').forEach(function (item) {
    item.addEventListener('click', function () { renderReservations(item.dataset.reservationMode); });
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
  document.getElementById('account-send-code').addEventListener('click', accountSendCode);
  document.getElementById('account-login').addEventListener('click', accountLogin);
  document.getElementById('account-verify').addEventListener('click', verifyAccountSMS);
  document.getElementById('account-cancel').addEventListener('click', cancelAccountVerification);
  document.getElementById('account-change-phone').addEventListener('click', cancelAccountVerification);
  document.getElementById('account-logout').addEventListener('click', confirmAccountLogout);
  document.getElementById('account-sync').addEventListener('click', function () { accountRequest('sync').then(function () { if (pageMode() === 'account') goFocus(document.getElementById('account-logout')); }); });
  setInterval(function () { if (pageMode() === 'account' && !accountBusy) renderAccount(); }, 1000);
  document.getElementById('detail-play').addEventListener('click', function () {
    if (!currentDetail) return;
    var item = Object.assign({}, currentDetail);
    var returnFocus = detailReturnFocus;
    closeDetail();
    startPlayer(item, returnFocus);
  });
  document.getElementById('discussion-close').addEventListener('click', function () { closeDiscussion(); });
  document.getElementById('detail-save').addEventListener('click', function () { toggleSaved(currentDetail, 'favorite', this); });
  document.getElementById('library-manage').addEventListener('click', function () {
    if (libraryError) { libraryReady = loadLibrary(); return; }
    libraryEditing = !libraryEditing;
    renderLibrary(true);
  });
  document.getElementById('library-clear').addEventListener('click', confirmClearLibrary);
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirmation);
  document.getElementById('confirm-accept').addEventListener('click', function () {
    if (!confirmOperation || this.disabled) return;
    var button = this;
    var generation = confirmationGeneration;
    button.disabled = true;
    confirmOperation().then(function (ok) { button.disabled = false; if (ok && confirmOpen && generation === confirmationGeneration) closeConfirmation(); });
  });
  document.getElementById('hero-feed-focus').addEventListener('click', toggleVideo);
  document.getElementById('player-options-close').addEventListener('click', function () { closePlayerOptions(); });
  document.getElementById('control-progress').addEventListener('click', function (event) {
    if (!event.detail) return;
    var rect = this.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width * document.getElementById('hero-video').duration);
  });
  document.addEventListener('pointermove', function (event) { if (isPlaybackPage() && event.target.closest('#hero')) revealControls(); });
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement) { nativeFullscreen = true; setCinema(true); }
    else if (nativeFullscreen) {
      nativeFullscreen = false; setCinema(false);
      if (fullscreenExitKeepsHidden) hideControls(); else revealControls();
      fullscreenExitKeepsHidden = false;
    }
  });

  function loadStatus() {
    fetch('/api/v1/status').then(function (response) { return response.json(); }).then(function (data) {
      status.textContent = data.ok ? '已连接' : '连接异常';
      status.dataset.ok = data.ok ? 'true' : 'false';
    }).catch(function () {
      status.textContent = '连接失败';
      status.dataset.ok = 'false';
    });
  }

  var media = document.getElementById('hero-video');
  media.addEventListener('loadedmetadata', function () {
    if (!activePlayback || activePlayback.generation !== feedGeneration) return;
    var position = activePlayback.position;
    if (position > 0 && Number.isFinite(media.duration)) media.currentTime = Math.min(position, Math.max(0, media.duration - .25));
    media.playbackRate = playbackPreferences.speed;
    updatePlaybackControls();
  });
  media.addEventListener('playing', function () {
    document.getElementById('danmaku-layer').classList.remove('is-paused'); tickDanmaku();
    if (!activePlayback || activePlayback.generation !== feedGeneration) return;
    if (applicationInBackground || document.hidden) { media.pause(); return; }
    activePlayback.started = true;
    setPlayerStatus(''); updatePlaybackControls(); scheduleControlsHide();
    saveProgress(true);
  });
  media.addEventListener('timeupdate', function () {
    tickDanmaku();
    if (!activePlayback || !activePlayback.started) return;
    updatePlaybackControls();
    saveProgress(false);
  });
  media.addEventListener('pause', function () {
    document.getElementById('danmaku-layer').classList.add('is-paused');
    saveProgress(true); updatePlaybackControls();
    if (activePlayback && activePlayback.started && media.getAttribute('src') && media.paused && !media.ended) revealControls();
  });
  media.addEventListener('ratechange', updatePlaybackControls);
  media.addEventListener('volumechange', updatePlaybackControls);
  media.addEventListener('emptied', updatePlaybackControls);
  media.addEventListener('waiting', function () { if (activePlayback) setPlayerStatus(activePlayback.started ? '正在缓冲…' : '正在加载视频…'); });
  media.addEventListener('canplay', function () { if (media.paused) setPlayerStatus(''); });
  media.addEventListener('seeked', function () { resetDanmaku(); tickDanmaku(); updatePlaybackControls(); saveProgress(true); if (media.paused) setPlayerStatus(''); });
  media.addEventListener('error', function () { if (activePlayback && media.getAttribute('src')) setPlayerStatus('这集未能正常播放', true); });
  media.addEventListener('ended', function () {
    var playback = activePlayback;
    if (!playback || !playback.started || playback.generation !== feedGeneration) return;
    saveProgress(true, true);
    continueAfterEpisode(playback);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseForBackground(); else resumeFromBackground(); });

  goFocus(document.querySelector('.side-item.is-active'));
  restorePlaybackPreferences();
  loadStatus();
  libraryReady = loadLibrary();
  pollAccount();
  accountPollTimer = setInterval(function () { if (!document.hidden) pollAccount(); }, 8000);
  loadCatalog('推荐');
}());
