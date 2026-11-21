let map;
let markerLayer;
let allQuakesData = [];
let seenIds = new Set();
let currentOffset = 0;

const scaleMap = {
  10: '1', 20: '2', 30: '3', 40: '4',
  45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7'
};

document.addEventListener('DOMContentLoaded', async () => {
  map = new L.Map('map').setView([36.5, 138.0], 5);

  // 国土地理院のベース地図と統合地形レイヤー定義
  const gsiBase = 'https://' + 'cyberjapandata.' + 'gsi.' + 'go.' + 'jp/xyz/';
  const baseLayers = {
    pale: new L.TileLayer(gsiBase + 'pale/{z}/{x}/{y}.png', { attribution: '国土地理院（淡色地図）', maxZoom: 18 }),
    std: new L.TileLayer(gsiBase + 'std/{z}/{x}/{y}.png', { attribution: '国土地理院（標準地図）', maxZoom: 18 })
  };

    // 陸＝陰影起伏図、海＝色別標高図 を1枚に合成するカスタムレイヤー（Leaflet 2.0 記法）
  class HybridTerrainLayer extends L.GridLayer {
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext('2d');

      const z = coords.z;
      const x = coords.x;
      const y = coords.y;

      const hillImg = new Image();
      const reliefImg = new Image();
      hillImg.crossOrigin = 'Anonymous';
      reliefImg.crossOrigin = 'Anonymous';

      let loadedCount = 0;
      const onImageLoad = () => {
        loadedCount++;
        if (loadedCount < 2) return;

        // 1. 陸地用として陰影起伏図を描画（海の領域は透明）
        if (hillImg.complete && hillImg.naturalWidth > 0) {
          ctx.drawImage(hillImg, 0, 0);
        }

        // 2. 透明部分（海）だけに色別標高図を流し込む
        ctx.globalCompositeOperation = 'destination-over';
         ctx.filter = 'contrast(180%) saturate(100%) brightness(100%)';
        if (reliefImg.complete && reliefImg.naturalWidth > 0) {
          ctx.drawImage(reliefImg, 0, 0);
        }

        done(null, tile);
      };

      hillImg.onload = onImageLoad;
      hillImg.onerror = onImageLoad;
      reliefImg.onload = onImageLoad;
      reliefImg.onerror = onImageLoad;

      hillImg.src = `${gsiBase}hillshademap/${z}/${x}/${y}.png`;
      reliefImg.src = `${gsiBase}relief/${z}/${x}/${y}.png`;

      return tile;
    }
  }

  const hybridTerrainLayer = new HybridTerrainLayer({
    attribution: '国土地理院（陰影起伏図・色別標高図）',
    maxZoom: 15,
    opacity: 0.6
  });

  let currentTileLayer = baseLayers.pale;
  currentTileLayer.addTo(map);

  // ベース地図の切り替え
  document.getElementById('mapLayerSelect').addEventListener('change', (e) => {
    const selected = e.target.value;
    if (baseLayers[selected]) {
      map.removeLayer(currentTileLayer);
      currentTileLayer = baseLayers[selected];
      currentTileLayer.addTo(map);
      currentTileLayer.bringToBack();
    }
  });

  // 統合地形図（陸:陰影 ＋ 海:色別標高）の ON/OFF
  document.getElementById('overlayHybridTerrain').addEventListener('change', (e) => {
    if (e.target.checked) {
      hybridTerrainLayer.addTo(map);
    } else {
      map.removeLayer(hybridTerrainLayer);
    }
  });

  // 濃さ（透明度）スライダーの連動
  document.getElementById('overlayOpacity').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    hybridTerrainLayer.setOpacity(val);
    const label = document.getElementById('opacityLabel');
    if (label) label.textContent = `${Math.round(val * 100)}%`;
  });



  const colorModeSelect = document.getElementById('colorModeSelect');
  if (colorModeSelect) {
    colorModeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      const intRow = document.getElementById('legendIntensityRow');
      const depthRow = document.getElementById('legendDepthRow');
      if (mode === 'depth') {
        if (intRow) intRow.classList.add('hidden');
        if (depthRow) depthRow.classList.remove('hidden');
      } else {
        if (intRow) intRow.classList.remove('hidden');
        if (depthRow) depthRow.classList.add('hidden');
      }
      renderMarkers();
    });
  }

  const startTimeInput = document.getElementById('startTimeInput');
  const endTimeInput = document.getElementById('endTimeInput');
  const resetDateBtn = document.getElementById('resetDateBtn');
  if (startTimeInput) startTimeInput.addEventListener('change', renderMarkers);
  if (endTimeInput) endTimeInput.addEventListener('change', renderMarkers);
  if (resetDateBtn) {
    resetDateBtn.addEventListener('click', () => {
      updateDateInputBounds();
      renderMarkers();
    });
  }

  markerLayer = new L.LayerGroup().addTo(map);

  // フィルター＆ボタンイベント
  document.getElementById('minInt').addEventListener('change', renderMarkers);
  document.getElementById('maxInt').addEventListener('change', renderMarkers);
  document.getElementById('reloadBtn').addEventListener('click', () => fetchQuakeData(true));
  document.getElementById('loadMoreBtn').addEventListener('click', () => fetchQuakeData(false));
  document.getElementById('minMag').addEventListener('input', renderMarkers);
  document.getElementById('maxMag').addEventListener('input', renderMarkers);
  document.getElementById('minDepth').addEventListener('input', renderMarkers);
  document.getElementById('maxDepth').addEventListener('input', renderMarkers);

  // パネル開閉
  document.getElementById('toggleFilterHeader').addEventListener('click', () => {
    const body = document.getElementById('filterBody');
    const btn = document.getElementById('toggleFilterBtn');
    const isHidden = body.classList.toggle('hidden');
    btn.textContent = isHidden ? '▼ 開く' : '▲ 閉じる';
  });

  document.getElementById('toggleLegendHeader').addEventListener('click', () => {
    const body = document.getElementById('legendBody');
    const btn = document.getElementById('toggleLegendBtn');
    const isHidden = body.classList.toggle('hidden');
    btn.textContent = isHidden ? '▼ 開く' : '▲ 閉じる';
  });

  if (window.innerWidth <= 600) {
    document.getElementById('legendBody').classList.add('hidden');
    document.getElementById('toggleLegendBtn').textContent = '▼ 開く';
  }

  // 左側リストパネルの開閉ボタン
  const toggleListHeader = document.getElementById('toggleListHeader');
  if (toggleListHeader) {
    toggleListHeader.addEventListener('click', () => {
      const body = document.getElementById('listBody');
      const btn = document.getElementById('toggleListBtn');
      const isHidden = body.classList.toggle('hidden');
      btn.textContent = isHidden ? '▼ 開く' : '▲ 閉じる';
    });
  }

  // リストパネル内の更新ボタン
  const listReloadBtn = document.getElementById('listReloadBtn');
  if (listReloadBtn) {
    listReloadBtn.addEventListener('click', () => fetchQuakeData(true));
  }

  // スマホ画面（600px以下）のときは初期状態でリストを閉じておく
  if (window.innerWidth <= 600) {
    const listBody = document.getElementById('listBody');
    const listBtn = document.getElementById('toggleListBtn');
    if (listBody && listBtn) {
      listBody.classList.add('hidden');
      listBtn.textContent = '▼ 開く';
    }
  }

  // 1. 初回の過去履歴取得
  await fetchQuakeData(true);

  // 2. 30秒ごとの自動更新を開始
  connectWebSocket();

  // 3. ブラウザのデスクトップ通知許可をリクエスト
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // 4. テストボタンの動作
   const testBtn = document.getElementById('testAlertBtn');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      if (allQuakesData.length > 0) {
        testBtn.textContent = '5秒後に通知が出ます（別タブへ移動可）...';
        testBtn.disabled = true;
        setTimeout(() => {
          triggerNewQuakeAlert(allQuakesData.at(0), true);
          testBtn.textContent = '光る＆通知のテスト';
          testBtn.disabled = false;
        }, 5000);
      }
    });
  }
});

// 1件の地震JSONデータを地図描画用オブジェクトに変換する共通関数
function parseQuakeItem(item) {
  const eq = item.earthquake;
  if (!eq || !eq.hypocenter) return null;
  const hypo = eq.hypocenter;
  if (hypo.latitude === -200 || hypo.longitude === -200) return null;

  const cityMaxMap = new Map();
  if (item.points && Array.isArray(item.points)) {
    for (const pt of item.points) {
      const cityName = `${pt.pref}${pt.addr}`;
      const currentMax = cityMaxMap.get(cityName) || 0;
      if (pt.scale > currentMax) {
        cityMaxMap.set(cityName, pt.scale);
      }
    }
  }

  const cities = [];
  cityMaxMap.forEach((scale, name) => {
    const label = scaleMap[scale] || scale;
    cities.push(`${name}(震度${label})`);
  });

  return {
    id: item.id,
    time: eq.time,
    hypocenter: hypo.name || '震源地不明',
    lat: hypo.latitude,
    lng: hypo.longitude,
    depth: hypo.depth >= 0 ? hypo.depth : '不明',
    depthNum: hypo.depth >= 0 ? hypo.depth : -1,
    magnitude: hypo.magnitude >= 0 ? hypo.magnitude : -1,
    magText: hypo.magnitude >= 0 ? hypo.magnitude.toFixed(1) : '不明',
    maxScaleNum: eq.maxScale || 0,
    maxInt: scaleMap[eq.maxScale] || '-',
    cities: cities
  };
}
// 取得済みデータの最古日時〜現在時刻をカレンダー入力欄に自動セットする関数
function updateDateInputBounds() {
  if (allQuakesData.length === 0) return;
  const startEl = document.getElementById('startTimeInput');
  const endEl = document.getElementById('endTimeInput');
  if (!startEl || !endEl) return;

  const formatForInput = (tStr) => tStr.slice(0, 16).replace(/\//g, '-').replace(' ', 'T');

  // 現在時刻（日本時間のローカル時刻）を "YYYY-MM-DDTHH:MM" 形式で生成
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const oldestStr = formatForInput(allQuakesData.at(-1).time);

  startEl.min = oldestStr;
  startEl.max = nowStr;
  startEl.value = oldestStr;

  endEl.min = oldestStr;
  endEl.max = nowStr;
  endEl.value = nowStr;
}


// 過去の履歴データをAPIから一括取得
async function fetchQuakeData(reset = true) {
  const countEl = document.getElementById('countDisplay');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  loadMoreBtn.disabled = true;

  if (reset) {
    allQuakesData = [];
    seenIds.clear();
    currentOffset = 0;
    countEl.textContent = '最新データを取得中...';
  } else {
    countEl.textContent = '過去のデータを追加取得中...';
  }

  try {
    const apiUrlBase = 'https://api.p2pquake.net';

    for (let i = 0; i < 2; i++) {
      const path = `/v2/history?codes=551&limit=100&offset=${currentOffset}`;
      const res = await fetch(apiUrlBase + path);
      if (!res.ok) throw new Error(`HTTPエラー: ${res.status}`);
      const list = await res.json();

      if (list.length === 0) break;
      currentOffset += list.length;

      for (const item of list) {
        if (seenIds.has(item.id)) continue;
        if (!item.issue || item.issue.type !== 'DetailScale') continue;

        const parsed = parseQuakeItem(item);
        if (parsed) {
          seenIds.add(parsed.id);
          allQuakesData.push(parsed);
        }
      }
    }

    // 時系列順（新しい順）に整理
    allQuakesData.sort((a, b) => b.time.localeCompare(a.time));
    updateDateInputBounds();
    renderMarkers();
  } catch (e) {
    countEl.textContent = '取得エラー: ' + e.message;
  } finally {
    loadMoreBtn.disabled = false;
  }
}

// フィルター条件に合わせてマーカーを再描画
function renderMarkers() {
  markerLayer.clearLayers();

  const DEPTH_VALUES = Array.from({ length: 18 }, (_, i) => {
    if (i === 0) return 0;
    if (i <= 10) return i * 10;
    if (i <= 16) return (i - 9) * 100;
    return 9999;
  });
  const DEPTH_LABELS = [
    '0km(ごく浅い)', '10km', '20km', '30km', '40km', '50km',
    '60km', '70km', '80km', '90km', '100km', '200km',
    '300km', '400km', '500km', '600km', '700km', '上限なし'
  ];

  const minIntVal = parseInt(document.getElementById('minInt').value, 10);
  const maxIntVal = parseInt(document.getElementById('maxInt').value, 10);

  // 1. マグニチュード下限・上限の取得と交差防止
  const minMagEl = document.getElementById('minMag');
  const maxMagEl = document.getElementById('maxMag');
  let minMagVal = parseFloat(minMagEl.value);
  let maxMagVal = parseFloat(maxMagEl.value);
  if (minMagVal > maxMagVal) {
    [minMagVal, maxMagVal] = [maxMagVal, minMagVal];
  }

  const magLabel = document.getElementById('magRangeLabel');
  if (magLabel) {
    if (minMagVal === 0 && maxMagVal === 8.0) {
      magLabel.textContent = 'すべて';
    } else if (minMagVal === 0) {
      magLabel.textContent = `M${maxMagVal.toFixed(1)} 以下`;
    } else if (maxMagVal === 8.0) {
      magLabel.textContent = `M${minMagVal.toFixed(1)} 以上`;
    } else {
      magLabel.textContent = `M${minMagVal.toFixed(1)} 〜 M${maxMagVal.toFixed(1)}`;
    }
  }
  const magBar = document.getElementById('magRangeBar');
  if (magBar) {
    const leftPct = (minMagVal / 8.0) * 100;
    const rightPct = (maxMagVal / 8.0) * 100;
    magBar.style.left = `${leftPct}%`;
    magBar.style.width = `${rightPct - leftPct}%`;
  }

  // 2. 深さ下限・上限の取得と交差防止
  const minDepthEl = document.getElementById('minDepth');
  const maxDepthEl = document.getElementById('maxDepth');
  let minDepthIdx = parseInt(minDepthEl.value, 10);
  let maxDepthIdx = parseInt(maxDepthEl.value, 10);
  if (minDepthIdx > maxDepthIdx) {
    [minDepthIdx, maxDepthIdx] = [maxDepthIdx, minDepthIdx];
  }

  const minDepthKm = DEPTH_VALUES[minDepthIdx];
  const maxDepthKm = DEPTH_VALUES[maxDepthIdx];

  const depthLabel = document.getElementById('depthRangeLabel');
  if (depthLabel) {
    if (minDepthIdx === 0 && maxDepthIdx === 17) {
      depthLabel.textContent = 'すべて';
    } else if (minDepthIdx === 0) {
      depthLabel.textContent = `${DEPTH_LABELS[maxDepthIdx]} 以下`;
    } else if (maxDepthIdx === 17) {
      depthLabel.textContent = `${DEPTH_LABELS[minDepthIdx]} 以上`;
    } else if (minDepthIdx === maxDepthIdx) {
      depthLabel.textContent = `${DEPTH_LABELS[minDepthIdx]} のみ`;
    } else {
      depthLabel.textContent = `${DEPTH_LABELS[minDepthIdx]} 〜 ${DEPTH_LABELS[maxDepthIdx]}`;
    }
  }
  const depthBar = document.getElementById('depthRangeBar');
  if (depthBar) {
    const leftPct = (minDepthIdx / 17) * 100;
    const rightPct = (maxDepthIdx / 17) * 100;
    depthBar.style.left = `${leftPct}%`;
    depthBar.style.width = `${rightPct - leftPct}%`;
  }

  // 3. 日時範囲の取得
  const startEl = document.getElementById('startTimeInput');
  const endEl = document.getElementById('endTimeInput');
  const startVal = startEl ? startEl.value : '';
  const endVal = endEl ? endEl.value : '';
  const startMs = startVal ? new Date(startVal).getTime() : 0;
  const endMs = endVal ? new Date(endVal).getTime() + 59999 : Infinity;

  // 4. 絞り込み実行
  const isMagFiltered = !(minMagVal === 0 && maxMagVal === 8.0);
  const isDepthFiltered = !(minDepthIdx === 0 && maxDepthIdx === 17);

  const filtered = allQuakesData.filter(q => {
    if (q.maxScaleNum < minIntVal) return false;
    if (q.maxScaleNum > maxIntVal) return false;

    if (isMagFiltered) {
      if (q.magnitude < 0 || q.magnitude < minMagVal || q.magnitude > maxMagVal) return false;
    }

    if (isDepthFiltered) {
      if (q.depthNum < 0 || q.depthNum < minDepthKm || q.depthNum > maxDepthKm) return false;
    }

    const qMs = new Date(q.time.replace(/\//g, '-')).getTime();
    if (!isNaN(qMs)) {
      if (qMs < startMs || qMs > endMs) return false;
    }

    return true;
  });

  // 描画順：大きい地震を手前に表示
  const drawList = [...filtered].sort((a, b) => a.magnitude - b.magnitude);
  const coordCount = new Map();
  const colorModeEl = document.getElementById('colorModeSelect');
  const colorMode = colorModeEl ? colorModeEl.value : 'intensity';

  drawList.forEach(q => {
    const key = `${q.lat}_${q.lng}`;
    const count = coordCount.get(key) || 0;
    coordCount.set(key, count + 1);

    let displayLat = q.lat;
    let displayLng = q.lng;
    if (count > 0) {
      const angle = count * 2.4;
      const offset = 0.008 * Math.sqrt(count);
      displayLat += Math.sin(angle) * offset;
      displayLng += Math.cos(angle) * offset;
    }
    q.displayLat = displayLat;
    q.displayLng = displayLng;

    const color = colorMode === 'depth' ? getDepthColor(q.depthNum) : getIntensityColor(q.maxInt);
    const radius = getMagnitudeRadius(q.magnitude);

    const marker = new L.CircleMarker([displayLat, displayLng], {
      radius: radius,
      fillColor: color,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.92
    });

    const citiesHtml = q.cities && q.cities.length > 0
      ? `<div class="city-list"><strong>観測市町村:</strong><br>${q.cities.join('、')}</div>`
      : '<div class="city-list">観測市町村データなし</div>';

    const content = `
      <div class="info-box">
        <strong>${q.hypocenter}</strong><br>
        発生日時: ${q.time.replace('T', ' ').slice(0, 19)}<br>
        マグニチュード: <b>M${q.magText}</b> / 深さ: <b>${q.depth}km</b><br>
        最大震度: <b>${q.maxInt}</b>
        ${citiesHtml}
      </div>
    `;

    marker.bindPopup(content);
    q.markerObj = marker;
    markerLayer.addLayer(marker);
  });

  let oldestText = '';
  if (allQuakesData.length > 0) {
    const oldest = allQuakesData.at(-1).time.slice(5, 16);
    oldestText = `<br>最古: ${oldest} まで取得済`;
  }

  renderQuakeList(filtered);
  document.getElementById('countDisplay').innerHTML =
    `表示: ${filtered.length} 件 / 取得: ${allQuakesData.length} 件${oldestText}`;
}

// マグニチュード0.1刻みで滑らかに大きさが変わる半径計算（小数点対応）
function getMagnitudeRadius(mag) {
  if (isNaN(mag) || mag < 0) return 6;
  const clampedMag = Math.max(1.0, mag);
  const radius = 4 + Math.pow(clampedMag - 1.0, 1.55) * 2.2;
  return Math.round(radius * 10) / 10;
}

// 最大震度に応じた配色
function getIntensityColor(maxInt) {
  if (!maxInt) return '#555555';
  if (maxInt.includes('7')) return '#800080';
  if (maxInt.includes('6強')) return '#8b0000';
  if (maxInt.includes('6弱')) return '#c70039';
  if (maxInt.includes('5強')) return '#ff1e00';
  if (maxInt.includes('5弱')) return '#ff6600';
  if (maxInt.includes('4')) return '#ffb700';
  if (maxInt.includes('3')) return '#0055ff';
  if (maxInt.includes('2')) return '#00a843';
  if (maxInt.includes('1')) return '#00a0e9';
  return '#555555';
}

// 震源の深さに応じた配色（浅い＝赤・橙、中深＝黄・緑、深い＝青・紫）
function getDepthColor(depthNum) {
  if (depthNum < 0 || isNaN(depthNum)) return '#777777';
  if (depthNum <= 10) return '#ff1e00';
  if (depthNum <= 30) return '#ff8800';
  if (depthNum <= 60) return '#ffd000';
  if (depthNum <= 100) return '#00b050';
  if (depthNum <= 300) return '#0070c0';
  return '#7030a0';
}

// 新着地震を受信したときに光る波紋と通知を出す関数
function triggerNewQuakeAlert(quake, isTest = false) {
  if (!quake) return;

  const targetLat = quake.displayLat !== undefined ? quake.displayLat : quake.lat;
  const targetLng = quake.displayLng !== undefined ? quake.displayLng : quake.lng;

  // 色分けモードに関係なく、新着通知バナーと波紋は常に最大震度の色を使用
  const intColor = getIntensityColor(quake.maxInt);

  const prefix = isTest ? '【テスト通知】' : '【新着地震】';
  const titleText = `${prefix}${quake.hypocenter}（最大震度${quake.maxInt} / M${quake.magText}）`;

  const banner = document.getElementById('toastBanner');
  if (banner) {
    banner.style.backgroundColor = intColor;
    banner.style.color = quake.maxInt.includes('4') ? '#222222' : '#ffffff';
    banner.textContent = titleText + '（クリックで震源へ移動）';
    banner.style.display = 'block';
    banner.onclick = () => {
      map.setView([targetLat, targetLng], 9);
      banner.style.display = 'none';
    };
    setTimeout(() => { banner.style.display = 'none'; }, 12000);
  }

  const pulseIcon = new L.DivIcon({
    className: '',
    html: `<div class="quake-pulse" style="background: ${intColor};"></div>`,
    iconSize: new L.Point(0, 0)
  });
  const pulseMarker = new L.Marker([targetLat, targetLng], { icon: pulseIcon }).addTo(map);
  setTimeout(() => { map.removeLayer(pulseMarker); }, 15000);

   if ('Notification' in window && Notification.permission === 'granted') {
    const notif = new Notification(titleText, {
      body: `深さ: ${quake.depth}km / 発生: ${quake.time.replace('T', ' ').slice(0, 19)}\n（クリックして地図へ移動）`,
      icon: 'icon.png'
    });

    notif.onclick = () => {
      window.focus(); // 別のタブや別ソフトを見ていても、この地図画面を一番手前に呼び出す
      map.setView([targetLat, targetLng], 9); // 震源へズーム移動
      if (quake.markerObj) {
        quake.markerObj.openPopup(); // 観測市町村のポップアップを自動で開く
      }
      notif.close();
    };
  }
}

// 左側の地震リストを描画する関数
function renderQuakeList(quakes) {
  const container = document.getElementById('quakeListContainer');
  if (!container) return;
  container.innerHTML = '';

  if (quakes.length === 0) {
    container.innerHTML = '<div style="padding: 8px; color: #666;">該当する地震がありません</div>';
    return;
  }

  const sortedForList = [...quakes].sort((a, b) => b.time.localeCompare(a.time));

  sortedForList.forEach(q => {
    const item = document.createElement('div');
    item.className = 'quake-list-item';

    const bgColor = getIntensityColor(q.maxInt);
    const textColor = q.maxInt.includes('4') ? '#222222' : '#ffffff';
    const timeStr = q.time.slice(5, 16).replace('T', ' ');

    item.innerHTML = `
      <span class="list-badge" style="background: ${bgColor}; color: ${textColor};">震度${q.maxInt}</span>
      <div style="flex: 1; overflow: hidden;">
        <div style="font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${q.hypocenter}</div>
        <div style="font-size: 11px; color: #555;">${timeStr} | M${q.magText} | 深さ${q.depth}km</div>
      </div>
    `;

    item.addEventListener('click', () => {
      const targetLat = q.displayLat !== undefined ? q.displayLat : q.lat;
      const targetLng = q.displayLng !== undefined ? q.displayLng : q.lng;
      map.setView([targetLat, targetLng], 8);
      if (q.markerObj) {
        q.markerObj.openPopup();
      }
    });

    container.appendChild(item);
  });
}

// 30秒ごとに静かに最新データをチェックして自動更新する方式
function connectWebSocket() {
  const wsStatusEl = document.getElementById('wsStatus');
  if (wsStatusEl) {
    wsStatusEl.textContent = '● 30秒ごとに自動更新ON';
    wsStatusEl.style.color = '#28a745';
  }

  setInterval(async () => {
    try {
      const apiUrl = 'https://api.p2pquake.net/v2/history?codes=551&limit=10';
      const res = await fetch(apiUrl);
      if (!res.ok) return;
      const list = await res.json();

      let hasNew = false;
      for (const item of list) {
        if (seenIds.has(item.id)) continue;
        if (!item.issue || item.issue.type !== 'DetailScale') continue;

        const parsed = parseQuakeItem(item);
        if (parsed) {
          seenIds.add(parsed.id);
          allQuakesData.unshift(parsed);
          hasNew = true;
          renderMarkers();
          triggerNewQuakeAlert(parsed, false);
        }
      }
      if (hasNew) {
        allQuakesData.sort((a, b) => b.time.localeCompare(a.time));
      }
    } catch (e) {}
  }, 30000);
}
