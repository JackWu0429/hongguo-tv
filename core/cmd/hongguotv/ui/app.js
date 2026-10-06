(function () {
  'use strict';

  // TV remote buttons are routed by semantic zones. A geometry-only algorithm
  // can jump from the sidebar to a right-side action just because it is close
  // on screen, which is especially confusing on a TV.
  var zoneSelectors = {
    sidebar: '.side-item',
    channels: '.channel-tab',
    catalog: '.catalog-card',
    actions: '.round-action',
    controls: '.control-button',
    modalActions: '.modal-action',
    episodes: '.detail-episode'
  };
  var status = document.getElementById('core-status');
  var notice = document.getElementById('action-notice');
  var shell = document.querySelector('.app-shell');
  var detailModal = document.getElementById('detail-modal');
  var detailModalOpen = false;
  var detailReturnFocus = null;
  var currentDetail = null;
  var lastContentFocus = null;
  var lastPageFocus = {};
  var catalogGeneration = 0;
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
      if (!element.disabled && style.display !== 'none' && style.visibility !== 'hidden') result.push(element);
    });
    return result;
  }

  function markFocus(element) {
    document.querySelectorAll('.is-focused').forEach(function (node) { node.classList.remove('is-focused'); });
    if (element) element.classList.add('is-focused');
  }

  function zoneOf(element) {
    if (!element) return '';
    if (element.classList.contains('side-item')) return 'sidebar';
    if (element.classList.contains('channel-tab')) return 'channels';
    if (element.classList.contains('catalog-card')) return 'catalog';
    if (element.classList.contains('round-action')) return 'actions';
    if (element.classList.contains('control-button')) return 'controls';
    if (element.classList.contains('detail-episode')) return 'episodes';
    if (element.classList.contains('modal-action')) return 'modalActions';
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
    var remembered = lastPageFocus[pageMode()];
    if (remembered && document.contains(remembered) && !remembered.disabled) return remembered;
    return document.querySelector('.channel-tab.is-active') || document.querySelector('.catalog-card') || document.querySelector('.primary-action');
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

  function moveWithinZone(zone, current, direction) {
    var items = focusables(zoneSelectors[zone]);
    var index = items.indexOf(current);
    if (index < 0) return items[0] || null;
    if (direction === 'up' || direction === 'left') index -= 1;
    if (direction === 'down' || direction === 'right') index += 1;
    return items[index] || null;
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
      if (direction === 'down') return firstCatalog() || document.querySelector('.primary-action');
      if (direction === 'up') return activeSidebar();
      return null;
    }
    if (zone === 'hero') {
      if (direction === 'right') return document.querySelector('.round-action');
      if (direction === 'down') return firstCatalog() || document.querySelector('.control-button');
      if (direction === 'up') return activeChannel();
      if (direction === 'left') return activeSidebar();
      return null;
    }
    if (zone === 'catalog') {
      if (direction === 'left' || direction === 'right') {
        var cardTarget = moveWithinZone(zone, current, direction);
        return cardTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return document.querySelector('.primary-action') || activeChannel();
      if (direction === 'down') return document.querySelector('.control-button');
      return null;
    }
    if (zone === 'actions') {
      if (direction === 'up' || direction === 'down') return moveWithinZone(zone, current, direction);
      if (direction === 'left') return document.querySelector('.primary-action');
      return null;
    }
    if (zone === 'controls') {
      if (direction === 'left' || direction === 'right') {
        var controlTarget = moveWithinZone(zone, current, direction);
        return controlTarget || (direction === 'left' ? activeSidebar() : null);
      }
      if (direction === 'up') return firstCatalog() || document.querySelector('.primary-action');
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

    if (key === 'Enter') {
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
      } else if (zoneOf(current) !== 'sidebar') {
        goFocus(activeSidebar());
      }
      if (detailModalOpen || zoneOf(current) !== 'sidebar') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!direction) return;
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
    showNotice.timer = setTimeout(function () { notice.textContent = '分类、详情和播放接口已接入 Go 核心。'; }, 3200);
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

  function renderCatalog(items) {
    var track = document.getElementById('catalog-track');
    track.innerHTML = '';
    (items || []).slice(0, 9).forEach(function (item) {
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
      card.addEventListener('click', function () { openDetail(item); });
      track.appendChild(card);
    });
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
        renderCatalog(payload.data.items || []);
        if (!payload.data.items || !payload.data.items.length) showNotice('这个分类暂时没有内容。');
        else showNotice('已加载 ' + payload.data.items.length + ' 部短剧。');
      })
      .catch(function (error) {
        if (generation !== catalogGeneration) return;
        renderCatalog([]);
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
    if (item.dataset.page === 'recommend') {
      var active = document.querySelector('.channel-tab.is-active');
      loadCatalog(channelPaths[active && active.dataset.focus] || '/rank/hot-drama', active ? active.textContent : '热播短剧');
    } else {
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
      if (item.dataset.action === 'play' || item.dataset.action === 'pause') toggleVideo();
      else showNotice('已收到操作：' + item.dataset.action + '。');
    });
  });

  document.querySelectorAll('.channel-tab').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.channel-tab').forEach(function (node) { node.classList.toggle('is-active', node === item); });
      loadCatalog(channelPaths[item.dataset.focus] || '/rank/hot-drama', item.textContent);
    });
  });
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-play').addEventListener('click', function () { playEpisode(currentDetail && currentDetail.playingIndex >= 0 ? currentDetail.playingIndex : 0); });

  function loadStatus() {
    fetch('/api/v1/status').then(function (response) { return response.json(); }).then(function (data) {
      status.textContent = data.ok ? 'Go 核心服务已连接' : '核心服务异常';
      status.dataset.ok = data.ok ? 'true' : 'false';
    }).catch(function () {
      status.textContent = '核心服务未连接';
      status.dataset.ok = 'false';
    });
  }

  goFocus(document.querySelector('.side-item.is-active'));
  loadStatus();
  loadCatalog('/rank/hot-drama', '热播短剧');
}());
